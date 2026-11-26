// Run against an isolated local QA server; do not point this at an existing store.
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { resolve } = require("node:path");
const { chromium } = require(process.env.MOA_PLAYWRIGHT || "playwright");
const origin = process.env.MOA_TEST_ORIGIN;
if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error("Set MOA_TEST_ORIGIN to your isolated 127.0.0.1 QA server.");
const ref = () => randomBytes(12).toString("hex");
const button = (page, name) => page.getByRole("button", { name, exact: true });
const tab = (page, name) => page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name, exact: true });
async function request(path, body, token = "") {
  const response = await fetch(origin + path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) });
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
}
(async () => {
  const browser = await chromium.launch({ ...(process.env.MOA_BROWSER_EXE ? { executablePath: process.env.MOA_BROWSER_EXE } : {}), headless: true });
  const errors = [];
  try {
    const suffix = ref().slice(0, 5);
    const owner = await request("/api/pos", { shop: "pando", pin: process.env.MOA_TEST_PIN || "672510" });
    for (const item of [0, 1]) await request("/api/counter", { action: "availability", item, soldOut: false }, owner.token);
    const offer = await request("/api/counter", { action: "campaignCreate", reference: ref(), type: "first", title: "함께 마시는 첫 커피 " + suffix,
      item: 0, discountAmount: 1000, minPurchase: 6000, fee: 500, quantity: 10, budget: 15000, startsAt: Date.now() - 1000, endsAt: Date.now() + 86400000 }, owner.token);
    const customer = await browser.newPage({ viewport: { width: 393, height: 900 } });
    const counter = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    for (const page of [customer, counter]) { page.setDefaultTimeout(10000); page.on("pageerror", error => errors.push(error.message)); }
    await customer.goto(origin + "/?live=1");
    await button(customer, "가입 전에 카페 둘러보기").click();
    await customer.locator(".cafe-card").first().waitFor();
    assert.equal(await customer.locator(".cafe-card").count(), 3);
    await tab(customer, "홈").click();
    await customer.getByLabel("닉네임", { exact: true }).fill("커피 메이트 " + suffix); await button(customer, "시작하기").click();
    await button(customer, "모든 혜택").click();
    await customer.locator(".benefit-row").filter({ hasText: offer.title }).getByRole("button", { name: "쿠폰 받기", exact: true }).click();
    await button(customer, "혜택 쿠폰 받기").click();
    const token = await customer.evaluate(address => JSON.parse(localStorage.getItem("taggo-member-v1:" + address)), origin);
    await button(customer, "매장").click(); await customer.getByRole("searchbox").fill("팬도로시");
    await button(customer, "메뉴 및 픽업").click(); await button(customer, "아메리카노 담기").click(); await button(customer, "픽업 요청").click();
    assert.equal(await customer.getByLabel("쿠폰 적용", { exact: true }).inputValue(), "");
    assert.ok((await customer.getByLabel("쿠폰 적용", { exact: true }).innerText()).includes("6,000원 이상"));
    await button(customer, "닫기").click(); await button(customer, "카페라떼 담기").click(); await button(customer, "픽업 요청").click();
    await customer.getByRole("dialog").waitFor();
    const coupon = (await request("/api/member", { action: "profile" }, token)).coupons[0];
    assert.equal(await customer.getByLabel("쿠폰 적용", { exact: true }).inputValue(), coupon.id);
    assert.ok((await customer.locator("#sheet .price-total").innerText()).includes("5,800원"));
    await customer.getByLabel("매장 요청사항 (선택)", { exact: true }).fill("개인 컵 사용할게요");
    await customer.getByLabel("쿠폰 적용", { exact: true }).selectOption("");
    await customer.getByText("6,800원", { exact: true }).last().waitFor();
    await customer.getByLabel("쿠폰 적용", { exact: true }).selectOption(coupon.id);
    await customer.locator("#sheet .price-total").filter({ hasText: "5,800원" }).waitFor();
    assert.equal(await customer.getByLabel("매장 요청사항 (선택)", { exact: true }).inputValue(), "개인 컵 사용할게요");
    assert.equal(await customer.locator(".checkout-submit").evaluate(element => { const rect = element.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight; }), true);
    await customer.screenshot({ path: resolve("dist/MOA-Checkout-Preview.png") });
    let lost = false;
    await customer.route("**/api/member", async route => {
      if (route.request().postDataJSON().action === "order" && !lost) { lost = true; await route.fetch(); await route.abort("failed"); }
      else await route.continue();
    });
    await button(customer, "픽업 요청 보내기").click(); await customer.getByText("접수 대기", { exact: true }).waitFor();
    await customer.unroute("**/api/member"); assert.equal(lost, true);
    let profile = await request("/api/member", { action: "profile" }, token);
    assert.equal(profile.orders.length, 1); assert.equal(profile.orders[0].total, 5800); assert.equal(profile.orders[0].stampQty, 2);
    assert.equal(profile.coupons[0].used, null); assert.equal(profile.coupons[0].reservedOrder, profile.orders[0].id);
    await tab(customer, "쿠폰함").click(); await customer.getByText("픽업 주문에 적용", { exact: true }).waitFor();
    assert.equal(await customer.locator('.ticket-card [data-action="use-coupon"]').count(), 0);
    await counter.goto(origin + "/?pos=1"); await counter.getByLabel("POS PIN", { exact: true }).fill(process.env.MOA_TEST_PIN || "672510"); await button(counter, "POS 열기").click();
    const row = counter.locator(".pos-order").filter({ hasText: "커피 메이트 " + suffix });
    await row.getByText("매장 결제 5,800원", { exact: true }).waitFor();
    await row.getByRole("button", { name: "접수하기", exact: true }).click(); await row.getByRole("button", { name: "픽업 준비 완료", exact: true }).click();
    await tab(customer, "홈").click(); await customer.getByText("픽업할 커피가 준비됐어요", { exact: true }).waitFor();
    await row.getByRole("button", { name: "결제·픽업 확인", exact: true }).click();
    await counter.getByRole("heading", { name: "결제·쿠폰·픽업 확인", exact: true }).waitFor();
    await counter.getByLabel("영수증 번호", { exact: true }).fill("20261119-" + suffix);
    await counter.getByLabel("메뉴 제공과 표시된 매장 결제를 확인했습니다", { exact: true }).check();
    await counter.getByLabel("매장 기준 첫 방문 고객임을 확인했습니다", { exact: true }).check();
    await button(counter, "결제·쿠폰 사용·픽업 완료").click();
    await tab(customer, "마이").click(); await button(customer, "픽업 주문 내역").click(); await customer.getByText("픽업 완료", { exact: true }).waitFor();
    profile = await request("/api/member", { action: "profile" }, token);
    assert.equal(profile.stamps.pando, 2); assert.equal(profile.coupons[0].savedAmount, 1000);
    const report = (await request("/api/counter", { action: "campaignList" }, owner.token)).find(entry => entry.id === offer.id);
    assert.equal(report.stats.used, 1); assert.equal(report.stats.fees, 500);
    await button(customer, "나의 메뉴 저장").click(); await customer.getByLabel("나의 메뉴 이름", { exact: true }).fill("나의 아침"); await button(customer, "저장하기").click();
    await tab(customer, "홈").click(); await customer.getByRole("heading", { name: "나의 메뉴", exact: true }).waitFor();
    await customer.getByText("나의 아침", { exact: true }).waitFor();
    await customer.reload(); await customer.getByText("나의 아침", { exact: true }).waitFor();
    await customer.screenshot({ path: resolve("dist/MOA-Final-Home.png") });
    await request("/api/counter", { action: "availability", item: 1, soldOut: true }, owner.token);
    await button(customer, "나의 아침 담기").click(); await customer.getByRole("heading", { name: "나의 메뉴 담기", exact: true }).waitFor();
    await customer.getByText(/현재 없는 메뉴·품절 메뉴는 제외했어요/).waitFor();
    await button(customer, "담고 메뉴 보기").click(); await customer.getByText("담은 메뉴 1개", { exact: true }).waitFor();
    await button(customer, "픽업 요청").click();
    assert.equal(await customer.getByLabel("매장 요청사항 (선택)", { exact: true }).inputValue(), "개인 컵 사용할게요");
    await button(customer, "닫기").click();
    assert.equal((await request("/api/member", { action: "profile" }, token)).orders.length, 1);
    await tab(customer, "마이").click(); await button(customer, "나의 아침 삭제").click(); await button(customer, "나의 메뉴 삭제").click();
    assert.equal((await request("/api/member", { action: "profile" }, token)).savedMenus.length, 0);
    await tab(customer, "주변 카페").click(); await customer.getByRole("searchbox").fill("팬도로시"); await button(customer, "메뉴 및 픽업").click();
    await button(customer, "나의 메뉴 저장").click(); await customer.getByLabel("나의 메뉴 이름", { exact: true }).fill("한 잔의 여유"); await button(customer, "저장하기").click();
    for (const width of [320, 393, 800, 1440]) {
      await customer.setViewportSize({ width, height: 900 });
      for (const name of ["홈", "주변 카페", "쿠폰함", "마이"]) {
        await tab(customer, name).click(); assert.equal(await customer.evaluate(() => document.documentElement.scrollWidth), width, name + " overflow at " + width);
      }
    }
    await request("/api/counter", { action: "availability", item: 1, soldOut: false }, owner.token);
    assert.deepEqual(errors, []);
    console.log("PASS: Browse before joining, coupon eligibility and best-discount quote, opt out, note preservation, lost-response pickup recovery, held-coupon wallet, verified coupon pickup and fees, saved-menu persistence/current stock/deletion/cart save, and responsive layouts.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
