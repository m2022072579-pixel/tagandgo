import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { newState, createMember, memberAction, posAction, newReference } from "../www/core.mjs";
import { campaignFeed } from "../www/campaigns.mjs";
import { openStore } from "../storage.mjs";

function fixture() {
  const state = newState();
  const account = createMember(state, "테스트 고객");
  posAction(state, "pando", "register", { tag: "NFC1001", code: account.profile.code });
  return { state, account };
}

function create(state, overrides = {}) {
  return posAction(state, "pando", "campaignCreate", {
    reference: newReference(), type: "first", title: "첫 방문 혜택", item: 0, discountAmount: 1000,
    minPurchase: 3000, fee: 500, startsAt: Date.now() - 1000, endsAt: Date.now() + 86400000,
    quantity: 3, budget: 10000, ...overrides,
  });
}

function claim(state, account, campaign, code) {
  return memberAction(state, account.token, "claimCampaign", { id: campaign.id, code });
}

function redeem(state, coupon, overrides = {}) {
  return posAction(state, "pando", "redeem", {
    tag: "NFC1001", coupon: coupon.id, reference: newReference(), receiptNumber: "20261119-001",
    purchaseAmount: 3000, item: 0, purchaseConfirmed: true, firstVisitConfirmed: true, ...overrides,
  });
}

test("legacy accounts and earned reward coupons continue to work", () => {
  const { state, account } = fixture();
  delete state.campaigns;
  delete state.campaignClaims;
  delete state.campaignRedemptions;
  assert.deepEqual(memberAction(state, account.token, "profile", {}).campaigns, []);
  posAction(state, "pando", "stamp", { tag: "NFC1001", qty: 8, reference: newReference() });
  const reward = state.members[account.token].coupons[0];
  assert.equal(reward.kind, undefined);
  assert.deepEqual(posAction(state, "pando", "redeem", { tag: "NFC1001", coupon: reward.id, reference: newReference() }), { used: true });
});

test("malformed JSON types cannot bypass campaign eligibility or accounting keys", () => {
  const { state, account } = fixture();
  assert.throws(() => create(state, { type: ["first"] }), /혜택 종류/);
  assert.throws(() => create(state, { reference: [newReference()] }), /등록 정보/);
  const campaign = create(state);
  assert.throws(() => memberAction(state, account.token, "claimCampaign", { id: [campaign.id] }), /혜택을 확인/);
  assert.equal(Object.keys(state.campaignClaims).length, 0);
});

test("campaign creation retries, claim retries, quota and budget are idempotent", () => {
  const { state, account } = fixture();
  const reference = newReference();
  const startsAt = Date.now() - 1000;
  const endsAt = Date.now() + 86400000;
  const terms = { reference, startsAt, endsAt, quantity: 10, budget: 1500 };
  const campaign = create(state, terms);
  assert.equal(create(state, terms).id, campaign.id);
  assert.equal(Object.keys(state.campaigns).length, 1);
  const first = claim(state, account, campaign);
  assert.equal(claim(state, account, campaign).coupons.length, 1);
  const second = createMember(state, "다른 고객");
  assert.throws(() => claim(state, second, campaign), /수량 마감/);
  assert.equal(first.coupons[0].discountAmount, 1000);
  const stats = posAction(state, "pando", "campaignList", {})[0].stats;
  assert.equal(stats.committed, 1500);
  assert.equal(stats.fees, 0);
});

test("first-visit verification includes existing purchases and rechecks at redemption", () => {
  const { state, account } = fixture();
  const campaign = create(state);
  const coupon = claim(state, account, campaign).coupons[0];
  posAction(state, "pando", "stamp", { tag: "NFC1001", qty: 1, reference: newReference() });
  assert.throws(() => redeem(state, coupon), /이전 구매 내역/);
  const another = create(state);
  assert.throws(() => claim(state, account, another), /첫 방문/);
  assert.equal(Object.keys(state.campaignRedemptions).length, 0);
});

test("QR redemption confirms purchase, accrues once and rejects changed retries", () => {
  const { state, account } = fixture();
  const campaign = create(state);
  const coupon = claim(state, account, campaign).coupons[0];
  const pass = memberAction(state, account.token, "pass", {});
  assert.throws(() => redeem(state, coupon, { firstVisitConfirmed: false }), /매장 기준/);
  const request = { tag: pass.code, reference: newReference() };
  const result = redeem(state, coupon, request);
  assert.equal(result.feeAmount, 500);
  assert.equal(result.stampEarned, true);
  assert.deepEqual(redeem(state, coupon, request), result);
  assert.equal(state.members[account.token].stamps.pando, 1);
  assert.throws(() => redeem(state, coupon, { ...request, purchaseAmount: 4000 }), /이전 승인/);
  const stats = posAction(state, "pando", "campaignList", {})[0].stats;
  assert.equal(stats.fees, 500);
  assert.equal(stats.newCustomers, 1);
  assert.equal(stats.used, 1);
  assert.equal(stats.customerPaid, 2000);
  assert.throws(() => posAction(state, "pando", "identify", { tag: pass.code }), /이미 사용/);
});

test("unconfirmed purchases, wrong menus, amounts, locked tags and duplicate receipts are rejected", () => {
  const { state, account } = fixture();
  const campaign = create(state, { type: "time", fee: 700 });
  const coupon = claim(state, account, campaign).coupons[0];
  assert.throws(() => redeem(state, coupon, { purchaseConfirmed: false }), /영수증/);
  assert.throws(() => redeem(state, coupon, { item: 1 }), /영수증/);
  assert.throws(() => redeem(state, coupon, { purchaseAmount: 2000 }), /구매금액/);
  memberAction(state, account.token, "lock", { locked: true });
  assert.throws(() => redeem(state, coupon), /키링 또는 QR/);
  memberAction(state, account.token, "lock", { locked: false });
  assert.equal(redeem(state, coupon).feeAmount, 140);
  const second = create(state, { type: "time", fee: 700 });
  const nextCoupon = claim(state, account, second).coupons.find(entry => entry.campaign === second.id);
  assert.throws(() => redeem(state, nextCoupon), /이미 혜택/);
  assert.equal(state.members[account.token].coupons.filter(entry => entry.used).length, 1);
});

test("sponsor access codes remain private and free drinks earn no purchase stamps", () => {
  const { state, account } = fixture();
  const campaign = create(state, { type: "sponsor", sponsor: "행사 지원 기관", discountAmount: 3000, fee: 300 });
  assert.equal(JSON.stringify(campaignFeed(state, null, [{ id: "pando", menu: [["아메리카노", 3000]] }])).includes(campaign.inviteCode), false);
  assert.throws(() => claim(state, account, campaign, "WRONG"), /참여 코드/);
  const coupon = claim(state, account, campaign, campaign.inviteCode).coupons[0];
  assert.equal(redeem(state, coupon).stampEarned, false);
  assert.equal(state.members[account.token].stamps.pando, undefined);
  const stats = posAction(state, "pando", "campaignList", {})[0].stats;
  assert.equal(stats.fees, 300);
  assert.equal(stats.spent, 3300);
});

test("campaign windows and sold-out menus are checked on use", () => {
  const { state, account } = fixture();
  const campaign = create(state, { type: "time", fee: 700 });
  const coupon = claim(state, account, campaign).coupons[0];
  state.members[account.token].coupons[0].expires = Date.now() - 1;
  assert.throws(() => redeem(state, coupon), /사용 가능한 쿠폰/);
  coupon.expires = Date.now() + 60000;
  state.soldOut.pando = { 0: true };
  assert.throws(() => redeem(state, coupon), /품절/);
  assert.equal(Object.keys(state.campaignRedemptions).length, 0);
  const future = create(state, { startsAt: Date.now() + 60000 });
  assert.throws(() => claim(state, account, future), /시작 전/);
});

test("a first purchase prevents a second first-visit coupon and later visits are counted", () => {
  const { state, account } = fixture();
  const first = create(state);
  const second = create(state);
  const coupon = claim(state, account, first).coupons[0];
  const secondCoupon = claim(state, account, second).coupons.find(entry => entry.campaign === second.id);
  redeem(state, coupon);
  assert.throws(() => redeem(state, secondCoupon, { receiptNumber: "20261119-002" }), /이전 구매/);
  const key = "pando:" + newReference();
  state.transactions[key] = { shop: "pando", member: account.profile.code, source: "nfc", time: Date.now() + 1 };
  const report = posAction(state, "pando", "campaignList", {}).find(entry => entry.id === first.id);
  assert.equal(report.stats.returning, 1);
});

test("edits preserve issued terms and stopping issuance honors existing coupons", () => {
  const { state, account } = fixture();
  const campaign = create(state);
  const coupon = claim(state, account, campaign).coupons[0];
  assert.throws(() => posAction(state, "pando", "campaignEdit", { ...campaign, discountAmount: 1500 }), /발급 후/);
  const edited = posAction(state, "pando", "campaignEdit", { ...campaign, title: "바뀐 제목", quantity: 5 });
  assert.equal(edited.title, "바뀐 제목");
  assert.equal(coupon.title, campaign.title);
  assert.throws(() => posAction(state, "pando", "campaignEdit", { ...campaign, title: "충돌" }), /변경됐어요/);
  assert.throws(() => posAction(state, "dict", "campaignEnd", { id: edited.id, version: edited.version }), /이 매장/);
  const stopped = posAction(state, "pando", "campaignEnd", { id: edited.id, version: edited.version });
  assert.equal(stopped.status, "ended");
  assert.throws(() => claim(state, createMember(state, "신규 고객"), stopped), /종료/);
  assert.equal(redeem(state, coupon).used, true);
});

test("SQLite imports legacy JSON once, rolls back failures and reopens persisted state", () => {
  const directory = mkdtempSync(join(tmpdir(), "moa-storage-"));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + "\\moa-storage-") || resolve(directory).startsWith(resolve(tmpdir()) + "/moa-storage-"));
  const legacy = join(directory, "pilot.json");
  const database = join(directory, "pilot.sqlite");
  const { state, account } = fixture();
  const original = JSON.stringify(state);
  writeFileSync(legacy, original);
  const store = openStore(database, legacy, newState);
  try {
    assert.equal(store.read().members[account.token].name, "테스트 고객");
    assert.throws(() => store.update(next => { next.members[account.token].name = "실패"; throw new Error("rollback"); }), /rollback/);
    assert.equal(store.read().members[account.token].name, "테스트 고객");
    store.update(next => { next.members[account.token].name = "저장됨"; });
    assert.equal(readFileSync(legacy, "utf8"), original);
    const other = openStore(database, legacy, newState);
    try {
      assert.equal(other.read().members[account.token].name, "저장됨");
      other.update(next => { next.testCounter = (next.testCounter ?? 0) + 1; });
      store.update(next => { next.testCounter = (next.testCounter ?? 0) + 1; });
      assert.equal(other.read().testCounter, 2);
    } finally { other.close(); }
  } finally { store.close(); rmSync(directory, { recursive: true }); }
});
