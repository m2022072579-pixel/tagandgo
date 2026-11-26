import test from "node:test";
import assert from "node:assert/strict";
import { newState, createMember, memberAction, posAction, newReference, shops } from "../www/core.mjs";
import { rankStampBooks, filterBenefits, quoteRepeatOrder, selectHomeDeals } from "../www/customer.mjs";
import { seedDemoCampaigns } from "../www/campaigns.mjs";

function accountFixture() {
  const state = newState();
  const account = createMember(state, "소비자 테스트");
  posAction(state, "pando", "register", { tag: "MOA10001", code: account.profile.code });
  return { state, account };
}

test("selected-coupon QR binds redemption and cannot consume a different coupon or stamp", () => {
  const { state, account } = accountFixture();
  posAction(state, "pando", "stamp", { tag: "MOA10001", qty: 16, reference: newReference() });
  const coupons = memberAction(state, account.token, "profile", {}).coupons;
  const pass = memberAction(state, account.token, "pass", { coupon: coupons[1].id });
  assert.equal(pass.coupon, coupons[1].id);
  assert.equal(posAction(state, "pando", "identify", { tag: pass.code }).selectedCoupon, coupons[1].id);
  assert.throws(() => posAction(state, "dict", "identify", { tag: pass.code }), /선택한 쿠폰의 매장/);
  assert.throws(() => posAction(state, "pando", "stamp", { tag: pass.code, qty: 1, reference: newReference() }), /쿠폰 사용용 QR/);
  assert.throws(() => posAction(state, "pando", "redeem", { tag: pass.code, coupon: coupons[0].id, reference: newReference() }), /고객이 QR에서 선택/);
  assert.equal(state.passes[pass.code].used, undefined);
  const request = { tag: pass.code, coupon: coupons[1].id, reference: newReference() };
  assert.equal(posAction(state, "pando", "redeem", request).used, true);
  assert.equal(posAction(state, "pando", "redeem", request).used, true);
  assert.equal(coupons[0].used, null);
  assert.ok(coupons[1].used);
  assert.equal(coupons[1].savedAmount, 3000);
  assert.equal(state.members[account.token].stamps.pando, 0);
});

test("coupon QR validates ownership, preserves existing QR on invalid selection and respects coupon expiry", () => {
  const { state, account } = accountFixture();
  const generic = memberAction(state, account.token, "pass", {});
  assert.throws(() => memberAction(state, account.token, "pass", { coupon: "other-customer-coupon" }), /선택한 쿠폰/);
  assert.equal(posAction(state, "pando", "identify", { tag: generic.code }).selectedCoupon, null);
  const expires = Date.now() + 10000;
  state.members[account.token].coupons.push({ id: "legacy-coupon-id", shop: "pando", expires, used: null });
  const chosen = memberAction(state, account.token, "pass", { coupon: "legacy-coupon-id" });
  assert.equal(chosen.expires, expires);
  state.members[account.token].coupons[0].expires = Date.now() - 1;
  assert.throws(() => posAction(state, "pando", "identify", { tag: chosen.code }), /기간/);
});

test("pickup requests retain notes and changed retries cannot create or silently amend an order", () => {
  const { state, account } = accountFixture();
  const request = { shop: "pando", lines: [{ item: 0, qty: 1 }], note: "  빨대는 빼 주세요  ", reference: newReference() };
  memberAction(state, account.token, "order", request);
  assert.equal(memberAction(state, account.token, "order", request).orders.length, 1);
  assert.equal(posAction(state, "pando", "overview", {}).orders[0].note, "빨대는 빼 주세요");
  assert.throws(() => memberAction(state, account.token, "order", { ...request, note: "다른 요청" }), /이전 요청/);
  assert.throws(() => memberAction(state, account.token, "order", { ...request, lines: [{ item: 0, qty: 2 }] }), /이전 요청/);
  assert.throws(() => memberAction(state, account.token, "order", { ...request, note: "가".repeat(101), reference: newReference() }), /100자/);
  assert.throws(() => memberAction(state, account.token, "order", { ...request, lines: [null], reference: newReference() }), /메뉴/);
  assert.equal(Object.keys(state.orders).length, 1);
  delete state.orders[request.reference].note;
  assert.equal(memberAction(state, account.token, "order", { ...request, note: undefined }).orders[0].note, "");
});

test("stamp books prioritize almost-complete active cafes and do not change source balances", () => {
  const profile = { stamps: { pando: 7, dict: 9, tiamo: 0 } };
  const sorted = rankStampBooks(profile, shops, ["pando"]);
  assert.deepEqual(sorted.map(book => book.shop.id), ["pando", "dict", "tiamo"]);
  assert.equal(sorted[0].remaining, 1);
  assert.equal(profile.stamps.pando, 7);
  assert.ok(rankStampBooks({ stamps: { pando: 100 } }, shops)[0].remaining >= 0);
});

test("eligible benefits exclude claimed, exhausted and unavailable offers while search and favorites compose", () => {
  const now = Date.now();
  const base = { shop: "pando", type: "time", title: "라떼 한 잔", itemName: "LATTE", startsAt: now - 1000, endsAt: now + 10000, remaining: 3, discountAmount: 1000, reason: "", coupon: null };
  const feed = [{ ...base, id: "usable" }, { ...base, id: "claimed", coupon: "coupon-id", reason: "발급 완료" },
    { ...base, id: "sold", reason: "대상 메뉴 품절" }, { ...base, id: "gone", remaining: 0 }, { ...base, id: "expired", endsAt: now - 1 }];
  assert.deepEqual(filterBenefits(feed, shops, { eligibleOnly: true, now }).map(campaign => campaign.id), ["usable"]);
  assert.equal(filterBenefits(feed, shops, { eligibleOnly: true, favoritesOnly: true, favorites: ["dict"], now }).length, 0);
  assert.equal(filterBenefits(feed, shops, { eligibleOnly: true, query: "ｌａｔｔｅ", now }).length, 1);
  assert.equal(filterBenefits(feed, shops, { eligibleOnly: true, query: "없는 메뉴", now }).length, 0);
  assert.deepEqual(feed.map(campaign => campaign.id), ["usable", "claimed", "sold", "gone", "expired"]);
});

test("repeat-order quotes use current prices and exclude sold-out or missing products", () => {
  const order = { shop: "pando", status: "pickedUp", lines: [{ item: 0, name: "아메리카노", price: 2800, qty: 2 }, { item: 1, name: "카페라떼", price: 3800, qty: 1 }] };
  const quote = quoteRepeatOrder(order, shops[0], { 1: true });
  assert.deepEqual(quote.cart, { 0: 2 });
  assert.equal(quote.total, 6000);
  assert.equal(quote.priceChanged, true);
  assert.deepEqual(quote.skipped, ["카페라떼"]);
  assert.equal(order.lines[0].price, 2800);
  assert.throws(() => quoteRepeatOrder({ ...order, status: "ready" }, shops[0]), /완료된 주문/);
  assert.throws(() => quoteRepeatOrder(order, shops[0], { 0: true, 1: true }), /품절이거나 변경/);
});

test("repeat orders handle catalog reordering and never substitute an ambiguous menu", () => {
  const order = { shop: "shop", status: "pickedUp", lines: [{ item: 0, name: "라떼", price: 4000, qty: 1 }] };
  const reordered = { id: "shop", menu: [["티", 3000], ["라떼", 4500]] };
  assert.deepEqual(quoteRepeatOrder(order, reordered).cart, { 1: 1 });
  assert.throws(() => quoteRepeatOrder(order, { id: "shop", menu: [["티", 3000], ["라떼", 4500], ["라떼", 5000]] }), /품절이거나 변경/);
});

test("sold-out campaign menus cannot consume issuance stock", () => {
  const { state, account } = accountFixture();
  const campaign = posAction(state, "pando", "campaignCreate", { reference: newReference(), type: "time", title: "타임딜", item: 0, discountAmount: 500, minPurchase: 3000, fee: 700, startsAt: Date.now() - 1000, endsAt: Date.now() + 60000, quantity: 1, budget: 1000 });
  posAction(state, "pando", "availability", { item: 0, soldOut: true });
  assert.throws(() => memberAction(state, account.token, "claimCampaign", { id: campaign.id }), /품절/);
  assert.equal(Object.keys(state.campaignClaims).length, 0);
  posAction(state, "pando", "availability", { item: 0, soldOut: false });
  assert.equal(memberAction(state, account.token, "claimCampaign", { id: campaign.id }).coupons.length, 1);
});

test("home deals prioritize general discounts, diversify cafes and exclude expired or ineligible offers", () => {
  const now = Date.now();
  const base = { id: "time", shop: "pando", item: 0, type: "time", price: 3000, discountAmount: 700, remaining: 5, reason: "", startsAt: now - 1000, endsAt: now + 10000 };
  const list = [base, { ...base, id: "second", discountAmount: 500 },
    { ...base, id: "sponsor", shop: "tiamo", type: "sponsor", price: 3500, discountAmount: 3500 },
    { ...base, id: "first", shop: "dict", type: "first", price: 4000, discountAmount: 1000 },
    { ...base, id: "expired", endsAt: now }, { ...base, id: "empty", remaining: 0 },
    { ...base, id: "visited", reason: "첫 방문 고객만 받을 수 있어요" }, { ...base, id: "invalid", discountAmount: 4000 }];
  assert.deepEqual(selectHomeDeals(list, shops, null, now).map(entry => entry.id), ["time", "first", "sponsor"]);
  assert.equal(selectHomeDeals(list, shops, null, now, { pando: { 0: true } }).some(entry => entry.shop === "pando"), false);
  assert.equal(list[0], base);
});

test("home deals retain usable owned coupons but hide used, reserved, foreign and sold-out coupons", () => {
  const now = Date.now();
  const offer = { id: "offer", shop: "pando", item: 0, type: "time", price: 3000, discountAmount: 700, remaining: 0, reason: "발급 완료", coupon: "owned", startsAt: now - 1000, endsAt: now + 10000 };
  const coupon = { id: "owned", shop: "pando", expires: now + 10000 };
  assert.equal(selectHomeDeals([offer], shops, { coupons: [coupon] }, now).length, 1);
  for (const extra of [{ used: now }, { reservedOrder: "order" }, { shop: "dict" }, { expires: now }]) {
    assert.equal(selectHomeDeals([offer], shops, { coupons: [{ ...coupon, ...extra }] }, now).length, 0);
  }
  assert.equal(selectHomeDeals([offer], shops, null, now).length, 0);
  assert.equal(selectHomeDeals([offer], shops, { coupons: [coupon] }, now, { pando: { 0: true } }).length, 0);
});

test("expired demo campaigns refresh without extending existing coupons or deleting claims", () => {
  const state = newState(); seedDemoCampaigns(state, shops);
  const account = createMember(state, "체험 고객");
  const offer = Object.values(state.campaigns).find(campaign => campaign.type === "time");
  memberAction(state, account.token, "claimCampaign", { id: offer.id });
  const originalCoupon = structuredClone(state.members[account.token].coupons[0]);
  const claims = structuredClone(state.campaignClaims);
  for (const campaign of Object.values(state.campaigns)) campaign.endsAt = Date.now() - 1;
  seedDemoCampaigns(state, shops);
  assert.equal(Object.values(state.campaigns).filter(campaign => campaign.endsAt > Date.now()).length, 3);
  assert.deepEqual(state.campaignClaims, claims);
  assert.deepEqual(state.members[account.token].coupons[0], originalCoupon);
  const count = Object.keys(state.campaigns).length; seedDemoCampaigns(state, shops);
  assert.equal(Object.keys(state.campaigns).length, count);
});
