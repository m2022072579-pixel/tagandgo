import test from "node:test";
import assert from "node:assert/strict";
import { newState, createMember, memberAction, posAction, newReference, recoverMember } from "../www/core.mjs";
import { quoteSavedMenu } from "../www/customer.mjs";

function checkoutFixture() {
  const state = newState();
  const account = createMember(state, "커피 메이트");
  const member = state.members[account.token];
  posAction(state, "pando", "register", { tag: "ORDER1001", code: member.code });
  const request = (action, data = {}) => memberAction(state, account.token, action, data);
  const reward = () => {
    const coupon = { id: newReference(), shop: "pando", expires: Date.now() + 86400000, used: null };
    member.coupons.push(coupon); return coupon;
  };
  const campaign = (type = "first", discountAmount = 1000) => {
    const created = posAction(state, "pando", "campaignCreate", { reference: newReference(), type, title: "오늘의 커피 혜택", item: 0,
      discountAmount, minPurchase: 3000, fee: 500, quantity: 10, budget: 50000, startsAt: Date.now() - 1000, endsAt: Date.now() + 86400000,
      ...(type === "sponsor" ? { sponsor: "학교 시연" } : {}) });
    request("claimCampaign", { id: created.id, code: created.inviteCode });
    return member.coupons.find(coupon => coupon.campaign === created.id);
  };
  const order = (data = {}) => request("order", { shop: "pando", lines: [{ item: 0, qty: 1 }], reference: newReference(), ...data }).orders[0];
  const ready = order => { for (const status of ["preparing", "ready"]) posAction(state, "pando", "orderStatus", { id: order.id, status }); };
  return { state, account, member, request, reward, campaign, order, ready };
}

test("checkout recommends the largest valid owned discount and explains menu and minimum conditions", () => {
  const f = checkoutFixture(), discount = f.campaign(), reward = f.reward();
  const quote = f.request("quoteOrder", { shop: "pando", lines: [{ item: 0, qty: 1 }, { item: 1, qty: 1 }] });
  assert.equal(quote.coupon.id, reward.id);
  assert.equal(quote.subtotal, 6800); assert.equal(quote.total, 3800); assert.equal(quote.stampQty, 1);
  assert.equal(f.request("quoteOrder", { shop: "pando", lines: [{ item: 0, qty: 1 }], coupon: discount.id }).total, 2000);
  const unavailable = f.request("quoteOrder", { shop: "pando", lines: [{ item: 1, qty: 1 }] });
  assert.equal(unavailable.coupon, null); assert.ok(unavailable.candidates.every(coupon => /담아 주세요/.test(coupon.reason)));
  assert.throws(() => f.request("quoteOrder", { shop: "pando", lines: [{ item: 0, qty: 1 }], coupon: "another-member" }), /사용 가능한 쿠폰/);
  assert.equal(Object.keys(f.state.orders).length, 0); assert.equal(reward.used, null);
});

test("pickup holds the selected coupon and blocks QR, manual redemption and a second order", () => {
  const f = checkoutFixture(), coupon = f.reward();
  const oldPass = f.request("pass", { coupon: coupon.id });
  const order = f.order({ coupon: coupon.id, expectedTotal: 0 });
  assert.equal(f.request("profile").coupons[0].reservedOrder, order.id);
  assert.equal(coupon.reservedOrder, undefined);
  assert.throws(() => f.request("pass", { coupon: coupon.id }), /픽업 주문에 적용/);
  assert.throws(() => posAction(f.state, "pando", "identify", { tag: oldPass.code }), /픽업 주문에 적용/);
  assert.throws(() => posAction(f.state, "pando", "redeem", { tag: "ORDER1001", coupon: coupon.id, reference: newReference() }), /픽업 주문에 적용/);
  assert.throws(() => f.order({ coupon: coupon.id }), /다른 픽업 주문/);
  assert.equal(posAction(f.state, "pando", "identify", { tag: "ORDER1001" }).coupons.length, 0);
  assert.equal(coupon.used, null); assert.equal(Object.keys(f.state.orders).length, 1);
});

test("request and merchant cancellation release a held coupon without recording use or fees", () => {
  const f = checkoutFixture(), coupon = f.campaign();
  const first = f.order({ coupon: coupon.id });
  f.request("cancelOrder", { id: first.id });
  assert.equal(f.request("profile").coupons[0].reservedOrder, undefined);
  const second = f.order({ coupon: coupon.id });
  f.ready(second);
  posAction(f.state, "pando", "orderStatus", { id: second.id, status: "cancelled" });
  assert.equal(coupon.used, null); assert.equal(Object.keys(f.state.campaignRedemptions).length, 0);
  assert.ok(f.request("pass", { coupon: coupon.id }).code);
});

test("coupon pickup verifies purchase once and stamps only paid drink units", () => {
  const f = checkoutFixture(), coupon = f.reward();
  const order = f.order({ coupon: coupon.id, lines: [{ item: 0, qty: 2 }, { item: 1, qty: 1 }] });
  assert.equal(order.total, 6800); assert.equal(order.stampQty, 2);
  f.ready(order);
  assert.throws(() => posAction(f.state, "pando", "orderStatus", { id: order.id, status: "pickedUp" }), /매장 결제/);
  const approved = { id: order.id, status: "pickedUp", purchaseConfirmed: true };
  posAction(f.state, "pando", "orderStatus", approved); posAction(f.state, "pando", "orderStatus", approved);
  assert.equal(f.member.stamps.pando, 2); assert.equal(coupon.savedAmount, 3000);
  assert.equal(f.member.activity.filter(activity => activity.type === "coupon").length, 1);
});

test("campaign pickup requires receipt and first-visit confirmation, then commits one fee and stamp batch", () => {
  const f = checkoutFixture(), coupon = f.campaign();
  const order = f.order({ coupon: coupon.id, lines: [{ item: 0, qty: 2 }] }); f.ready(order);
  const approved = { id: order.id, status: "pickedUp", purchaseConfirmed: true, receiptNumber: "20261119-PICKUP" };
  assert.throws(() => posAction(f.state, "pando", "orderStatus", approved), /첫 방문/);
  assert.equal(coupon.used, null); assert.equal(f.state.orders[order.id].status, "ready");
  posAction(f.state, "pando", "orderStatus", { ...approved, firstVisitConfirmed: true });
  posAction(f.state, "pando", "orderStatus", { ...approved, firstVisitConfirmed: true });
  const records = Object.values(f.state.campaignRedemptions);
  assert.equal(records.length, 1); assert.equal(records[0].feeAmount, 500); assert.equal(records[0].source, "pickup");
  assert.equal(records[0].purchaseAmount, 6000); assert.equal(f.member.stamps.pando, 2);
});

test("a valid reservation honors expiry and later stock changes without unlocking the coupon elsewhere", t => {
  let now = 1800000000000; t.mock.method(Date, "now", () => now);
  const f = checkoutFixture(), coupon = f.campaign("sponsor", 3000);
  coupon.expires = now + 1000;
  const order = f.order({ coupon: coupon.id }); f.ready(order);
  now += 2000;
  posAction(f.state, "pando", "availability", { item: 0, soldOut: true });
  assert.equal(f.request("profile").coupons[0].reservedOrder, order.id);
  assert.throws(() => f.request("pass", { coupon: coupon.id }), /사용 기간/);
  posAction(f.state, "pando", "orderStatus", { id: order.id, status: "pickedUp", purchaseConfirmed: true, receiptNumber: "20261119-EXPIRED" });
  assert.equal(f.state.orders[order.id].total, 0); assert.equal(f.member.stamps.pando ?? 0, 0);
  assert.equal(Object.values(f.state.campaignRedemptions)[0].time, now);
});

test("first-visit purchase eligibility is checked again before completing a held pickup", () => {
  const f = checkoutFixture(), coupon = f.campaign();
  const order = f.order({ coupon: coupon.id }); f.ready(order);
  posAction(f.state, "pando", "stamp", { tag: "ORDER1001", qty: 1, reference: newReference() });
  assert.throws(() => posAction(f.state, "pando", "orderStatus", { id: order.id, status: "pickedUp", purchaseConfirmed: true, firstVisitConfirmed: true, receiptNumber: "20261119-NOTFIRST" }), /이전 구매/);
  assert.equal(coupon.used, null); assert.equal(f.member.stamps.pando, 1); assert.equal(Object.keys(f.state.campaignRedemptions).length, 0);
});

test("legacy order requests keep full price and changed totals, coupons or malformed payloads cannot be accepted", () => {
  const f = checkoutFixture(), coupon = f.reward();
  const old = f.order(); assert.equal(old.total, 3000); assert.equal(old.couponId, "");
  assert.throws(() => f.order({ coupon: coupon.id, expectedTotal: 100 }), /금액이나 쿠폰/);
  assert.throws(() => f.order({ coupon: [coupon.id] }), /사용할 쿠폰/);
  assert.throws(() => f.order({ lines: [null] }), /메뉴/);
  const ref = newReference(); f.order({ reference: ref, coupon: coupon.id, expectedTotal: 0 });
  assert.equal(f.order({ reference: ref, coupon: coupon.id, expectedTotal: 0 }).id, ref);
  assert.throws(() => f.order({ reference: ref, coupon: "" }), /이전 요청/);
  assert.throws(() => posAction(f.state, "dict", "orderStatus", { id: ref, status: "preparing" }), /이 매장/);
  assert.equal(Object.keys(f.state.orders).length, 2);
});

test("stamp reversal cannot void a reward currently held by a pickup order", () => {
  const f = checkoutFixture(), reference = newReference();
  posAction(f.state, "pando", "stamp", { tag: "ORDER1001", qty: 8, reference });
  const coupon = f.member.coupons[0], order = f.order({ coupon: coupon.id });
  const transaction = posAction(f.state, "pando", "overview", {}).sales.find(sale => sale.id === "pando:" + reference);
  assert.equal(transaction.reversible, false);
  assert.throws(() => posAction(f.state, "pando", "reverse", { id: transaction.id }));
  assert.equal(coupon.voided, undefined);
  f.request("cancelOrder", { id: order.id });
  assert.equal(posAction(f.state, "pando", "overview", {}).sales.find(sale => sale.id === transaction.id).reversible, true);
  assert.equal(posAction(f.state, "pando", "reverse", { id: transaction.id }).cancelled, true);
});

test("saved menus persist per member, upsert equivalent configurations and survive account recovery", () => {
  const f = checkoutFixture();
  const payload = { shop: "pando", lines: [{ item: 1, qty: 1 }, { item: 0, qty: 2 }], note: "  개인 컵  ", title: "오전 루틴" };
  f.request("saveMenu", payload);
  const saved = f.request("saveMenu", { ...payload, lines: payload.lines.slice().reverse(), title: "아침 커피" }).savedMenus;
  assert.equal(saved.length, 1); assert.equal(saved[0].title, "아침 커피"); assert.equal(saved[0].note, "개인 컵");
  const other = createMember(f.state, "다른 고객");
  assert.equal(other.profile.savedMenus.length, 0);
  assert.throws(() => memberAction(f.state, other.token, "deleteSavedMenu", { id: saved[0].id }), /삭제할 나의 메뉴/);
  const key = f.request("recovery").key, restored = recoverMember(f.state, key);
  assert.equal(restored.profile.savedMenus[0].id, saved[0].id);
  assert.equal(memberAction(f.state, restored.token, "deleteSavedMenu", { id: saved[0].id }).savedMenus.length, 0);
});

test("saved-menu quotes use current menu data, and save operations cannot access foreign or unfinished orders", () => {
  const f = checkoutFixture(), order = f.order();
  assert.throws(() => f.request("saveMenu", { order: order.id, title: "완료 전" }), /내 완료 주문/);
  f.ready(order); posAction(f.state, "pando", "orderStatus", { id: order.id, status: "pickedUp" });
  posAction(f.state, "pando", "availability", { item: 0, soldOut: true });
  const saved = f.request("saveMenu", { order: order.id, title: "나의 커피" }).savedMenus[0];
  const other = createMember(f.state, "다른 고객");
  assert.throws(() => memberAction(f.state, other.token, "saveMenu", { order: order.id, title: "남의 주문" }), /내 완료 주문/);
  const shop = { id: "pando", menu: [["아메리카노", 3500]] };
  assert.equal(quoteSavedMenu(saved, shop).total, 3500);
  assert.throws(() => quoteSavedMenu(saved, shop, { 0: true }), /품절이거나 변경/);
  assert.equal(Object.keys(f.state.orders).length, 1);
});

test("saved-menu limits and validation prevent unbounded records and invalid content", () => {
  const f = checkoutFixture();
  for (let qty = 1; qty <= 12; qty++) f.request("saveMenu", { shop: "pando", lines: [{ item: 0, qty }], title: "커피 " + qty });
  assert.throws(() => f.request("saveMenu", { shop: "pando", lines: [{ item: 0, qty: 13 }], title: "열세 번째" }), /12개/);
  assert.throws(() => f.request("saveMenu", { shop: "pando", lines: [{ item: 0, qty: 1 }], title: [] }), /메뉴 이름/);
  assert.throws(() => f.request("saveMenu", { order: [], title: "커피" }), /내 완료 주문/);
  assert.throws(() => f.request("saveMenu", { shop: "pando", lines: [{ item: 0, qty: 1 }], title: "커피", note: "가".repeat(101) }), /100자/);
  assert.equal(f.member.savedMenus.length, 12);
});
