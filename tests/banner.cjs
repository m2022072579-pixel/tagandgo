const assert = require("node:assert/strict");
const { resolve } = require("node:path");
const { chromium } = require(process.env.MOA_PLAYWRIGHT || "playwright");
const origin = process.env.MOA_TEST_ORIGIN || "http://127.0.0.1:8787";
const button = (page, name) => page.getByRole("button", { name, exact: true });
const tab = (page, name) => page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name, exact: true });
(async () => {
  const browser = await chromium.launch({ ...(process.env.MOA_BROWSER_EXE ? { executablePath: process.env.MOA_BROWSER_EXE } : {}), headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 393, height: 900 } });
    page.setDefaultTimeout(8000); page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin, { waitUntil: "networkidle" });
    // All claim/use actions below operate in an isolated browser's offline demo.
    await page.getByText("체험 모드", { exact: true }).waitFor();
    await page.getByRole("heading", { name: "오늘의 카페 혜택", exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready.then(() => true));
    assert.equal(await page.locator("main > section").first().getAttribute("aria-label"), "오늘의 카페 혜택");
    const banner = page.locator(".daily-deals");
    assert.ok((await banner.innerText()).includes("700원 할인"));
    assert.ok((await banner.innerText()).includes("2,300원"));
    assert.equal(await banner.locator(".daily-deal-tabs button").count(), 2);
    await page.screenshot({ path: resolve("dist/MOA-Home-Deals.png") });
    await button(page, "카페띠아모 혜택 보기").click();
    await banner.getByText("주최 기관 참여 코드 필요", { exact: false }).waitFor();
    assert.ok((await banner.innerText()).includes("3,500원 지원"));
    for (const width of [320, 393, 800, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      await button(page, "팬도로시 혜택 보기").click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      await button(page, "카페띠아모 혜택 보기").click();
    }
    await button(page, "팬도로시 혜택 보기").click();
    await page.screenshot({ path: resolve("dist/MOA-Home-Deals-Desktop.png") });
    await page.setViewportSize({ width: 393, height: 900 });
    await banner.getByRole("button", { name: "쿠폰 받기", exact: true }).click();
    await page.getByRole("dialog").getByRole("heading", { name: "오늘의 커피, 조금 더 가볍게", exact: true }).waitFor();
    await button(page, "혜택 쿠폰 받기").click();
    await banner.getByRole("button", { name: "보유 쿠폰 보기", exact: true }).waitFor();
    await banner.getByRole("button", { name: "보유 쿠폰 보기", exact: true }).click();
    const ticket = page.locator(".ticket-card").filter({ hasText: "오늘의 커피, 조금 더 가볍게" });
    await ticket.getByRole("button", { name: "사용하기", exact: true }).click();
    await page.getByRole("heading", { name: "쿠폰 사용 QR", exact: true }).waitFor();
    await button(page, "닫기").click();
    await tab(page, "홈").click(); await banner.getByRole("button", { name: "전체 혜택", exact: true }).click();
    await page.getByRole("button", { name: "혜택 모아보기", exact: true }).waitFor();
    assert.equal(await page.getByLabel("받을 수 있는 혜택만", { exact: true }).isChecked(), true);
    const guest = await browser.newPage({ viewport: { width: 393, height: 900 } });
    guest.on("pageerror", error => errors.push(error.message));
    await guest.goto(origin + "/?live=1");
    await guest.getByLabel("닉네임", { exact: true }).waitFor();
    // A server without published offers keeps the existing signup flow.
    assert.equal(await guest.locator(".daily-deals").count(), 0);
    assert.deepEqual(errors, []);
    console.log("PASS: Above-the-fold cafe offers, price/conditions, manual cafe switching, responsive layout, exact coupon claim to wallet and QR, all-benefits route, and empty-offer signup fallback.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
