import test from "node:test";
import assert from "node:assert/strict";
import { newState, createMember, memberAction, posAction, newReference, shops, seedDemoRetention } from "../www/core.mjs";
import { retentionVisits, retentionOverview, startRetentionTrial, setStoreConsent, campaignWindowReason, campaignContribution } from "../www/retention.mjs";
import { manageCampaign, claimCampaign, campaignFeed, redeemCampaign } from "../www/campaigns.mjs";
import { quotePickupOrder } from "../www/checkout.mjs";

const day = 86400000;
const now = Date.UTC(2026, 10, 23, 5); // Monday 14:00 KST
const shop = shops[0];
function fixture() {
  const state = newState();
  const account = createMember(state, "재방문 고객");
  const member = state.members[account.token];
  state.transactions.old = { shop: shop.id, member: member.code, source: "nfc", time: now - 8 * day, qty: 1 };
  member.stamps[shop.id] = 1;
  setStoreConsent(member, shop.id, { enabled: true }, now - day);
  startRetentionTrial(state, shop.id, { accepted: true }, now - day);
  return { state, member, account };
}
function offer(state, changes = {}) {
  return manageCampaign(state, shop, "create", { reference: newReference(), type: "return", segment: "second", title: "다시 만나는 커피",
    item: 0, discountAmount: 500, minPurchase: shop.menu[0][1], quantity: 10, budget: 5000, fee: 0,
    startsAt: now - 1000, endsAt: now + 40 * day, ...changes }, now);
}

test("retention merges records by Korean calendar day and keeps cancelled and foreign visits out", () => {
  const { state, member } = fixture();
  state.transactions.same = { ...state.transactions.old, time: now - 8 * day + 1000 };
  state.transactions.cancelled = { ...state.transactions.old, time: now - day, cancelled: now };
  state.transactions.foreign = { ...state.transactions.old, shop: "dict", time: now - day };
  state.campaignRedemptions.receipt = { ...state.transactions.old, time: now - 8 * day + 2000 };
  assert.equal(retentionVisits(state, shop.id, now).get(member.code).size, 1);
  assert.equal(retentionOverview(state, shop.id, now).segments[0].eligible, 1);
  state.transactions.next = { ...state.transactions.old, time: now - 6 * day };
  assert.equal(retentionOverview(state, shop.id, now).returned, 1);
  assert.equal(retentionOverview(state, shop.id, now).segments[0].count, 0);
  state.transactions.next.time = now - 30 * day;
  state.transactions.old.time = now - 22 * day;
  state.transactions.same.time = now - 22 * day + 1000;
  state.campaignRedemptions.receipt.time = now - 22 * day + 2000;
  assert.equal(retentionOverview(state, shop.id, now).segments[1].count, 1);
});

test("KST midnight separates two visits even within 24 hours and uses pickup completion time", () => {
  const { state, member } = fixture();
  state.transactions = {};
  state.orders = {
    one: { shop: shop.id, member: member.code, status: "pickedUp", time: now - 10 * day, pickedUpAt: Date.UTC(2026, 10, 22, 14, 59) },
    two: { shop: shop.id, member: member.code, status: "pickedUp", time: now - 10 * day, pickedUpAt: Date.UTC(2026, 10, 22, 15, 1) },
    pending: { shop: shop.id, member: member.code, status: "ready", time: now },
  };
  assert.equal(retentionVisits(state, shop.id, now).get(member.code).size, 2);
});

test("legacy pickup stamp confirmation avoids counting its earlier request as a second visit", () => {
  const { state, member } = fixture();
  state.transactions = { 'pickup:old-order': { shop: shop.id, member: member.code, source: 'pickup', time: now - 8 * day } };
  state.orders['old-order'] = { id: 'old-order', shop: shop.id, member: member.code, status: 'pickedUp', time: now - 9 * day };
  assert.equal(retentionVisits(state, shop.id, now).get(member.code).size, 1);
});

test("offline sample retention data is explicit and seeded once without granting a trial", () => {
  const state = newState();
  seedDemoRetention(state);
  const snapshot = JSON.stringify(state);
  seedDemoRetention(state);
  assert.equal(JSON.stringify(state), snapshot);
  assert.equal(Object.keys(state.members).length, 3);
  assert.ok(Object.values(state.members).every(member => member.name.startsWith('시연 ·')));
  const report = retentionOverview(state, shop.id);
  assert.equal(report.trial.status, 'available');
  assert.equal(report.segments[0].count, 2);
  assert.equal(report.segments[0].eligible, 1);
  assert.equal(report.segments[1].eligible, 1);
});

test("in-app consent defaults off, is store scoped, auditable and idempotent", () => {
  const state = newState(), account = createMember(state, "동의 고객"), member = state.members[account.token];
  assert.deepEqual(account.profile.storeConsents, {});
  memberAction(state, account.token, "storeConsent", { shop: shop.id, enabled: true });
  memberAction(state, account.token, "storeConsent", { shop: shop.id, enabled: true });
  assert.equal(member.consentHistory.length, 1);
  assert.equal(member.storeConsents.dict, undefined);
  assert.throws(() => memberAction(state, account.token, "storeConsent", { shop: "missing", enabled: true }));
  assert.throws(() => memberAction(state, account.token, "storeConsent", { shop: shop.id, enabled: "true" }));
  memberAction(state, account.token, "storeConsent", { shop: shop.id, enabled: false });
  assert.equal(member.consentHistory.length, 2);
});

test("trial needs acceptance, cannot renew itself and never changes basic stamps or coupons", () => {
  const { state, member } = fixture();
  const snapshot = JSON.stringify([member.stamps, member.coupons]);
  assert.throws(() => startRetentionTrial(state, "dict", {}, now));
  const endsAt = state.retentionTrials[shop.id].endsAt;
  startRetentionTrial(state, shop.id, { accepted: true }, now + 40 * day);
  assert.equal(state.retentionTrials[shop.id].endsAt, endsAt);
  assert.equal(retentionOverview(state, shop.id, now + 40 * day).trial.status, "expired");
  assert.deepEqual(retentionOverview(state, shop.id, now + 40 * day).rows, []);
  assert.equal(JSON.stringify([member.stamps, member.coupons]), snapshot);
  assert.equal(retentionOverview(state, "dict", now).customers, 0);
});

test("targeted offers use server-selected consented recipients, stay private and deduplicate claims", () => {
  const { state, member } = fixture();
  const outsider = state.members[createMember(state, "다른 고객").token];
  const campaign = offer(state, { recipients: [outsider.code] });
  assert.deepEqual(campaign.recipients, [member.code]);
  assert.equal(campaignFeed(state, null, shops, now).length, 0);
  assert.equal(campaignFeed(state, outsider, shops, now).length, 0);
  assert.equal(campaignFeed(state, member, shops, now)[0].recipients, undefined);
  assert.throws(() => claimCampaign(state, outsider, shops, { id: campaign.id }, now));
  claimCampaign(state, member, shops, { id: campaign.id }, now);
  claimCampaign(state, member, shops, { id: campaign.id }, now);
  assert.equal(member.coupons.length, 1);
  assert.throws(() => offer(state, { fee: 100 }));
});

test("consent withdrawal and later visits stop unclaimed offers; already-issued coupons remain usable", () => {
  const { state, member } = fixture();
  const campaign = offer(state);
  setStoreConsent(member, shop.id, { enabled: false }, now + 1);
  assert.equal(campaignFeed(state, member, shops, now + 1).length, 0);
  assert.throws(() => claimCampaign(state, member, shops, { id: campaign.id }, now + 1));
  setStoreConsent(member, shop.id, { enabled: true }, now + 2);
  claimCampaign(state, member, shops, { id: campaign.id }, now + 3);
  setStoreConsent(member, shop.id, { enabled: false }, now + 4);
  const coupon = member.coupons[0];
  state.retentionTrials[shop.id].endsAt = now + 4;
  redeemCampaign(state, member, shop, coupon, { item: 0, purchaseAmount: 3000, receiptNumber: "20261123-RETURN", purchaseConfirmed: true }, "qr", now + 5);
  assert.equal(Object.values(state.campaignRedemptions).length, 1);
  assert.equal(coupon.feeAmount, 0);
  const second = fixture();
  const waiting = offer(second.state);
  second.state.transactions.later = { ...second.state.transactions.old, time: now + 1 };
  assert.equal(campaignFeed(second.state, second.member, shops, now + 2).length, 0);
  assert.throws(() => claimCampaign(second.state, second.member, shops, { id: waiting.id }, now + 2));
});

test("expired trial prevents new campaigns and unclaimed issuance while preserving accepted coupons", () => {
  const { state, member } = fixture();
  const campaign = offer(state);
  state.retentionTrials[shop.id].endsAt = now;
  assert.throws(() => offer(state));
  assert.throws(() => claimCampaign(state, member, shops, { id: campaign.id }, now + 1));
  assert.equal(campaignFeed(state, member, shops, now + 1).length, 0);
  assert.equal(manageCampaign(state, shop, "end", { id: campaign.id, version: campaign.version }, now + 1).status, "ended");
});

test("daily issuance limits reset at KST midnight and same-member retries consume no extra budget", () => {
  const { state, member } = fixture();
  const other = state.members[createMember(state, "또 다른 고객").token];
  state.transactions.other = { ...state.transactions.old, member: other.code };
  setStoreConsent(other, shop.id, { enabled: true }, now);
  const campaign = offer(state, { dailyLimit: 1 });
  claimCampaign(state, member, shops, { id: campaign.id }, now);
  claimCampaign(state, member, shops, { id: campaign.id }, now);
  assert.throws(() => claimCampaign(state, other, shops, { id: campaign.id }, now));
  claimCampaign(state, other, shops, { id: campaign.id }, now + day);
  assert.equal(Object.values(state.campaignClaims).length, 2);
});

test("weekday and time restrictions apply to claiming, checkout and use with reservation-time protection", () => {
  const { state, member } = fixture();
  const campaign = offer(state, { weekdays: [1, 2, 3, 4, 5], dailyStart: 13 * 60, dailyEnd: 15 * 60 });
  assert.equal(campaignWindowReason(campaign, now), "");
  assert.ok(campaignWindowReason(campaign, now + 2 * 3600000));
  assert.ok(campaignWindowReason(campaign, now + 5 * day));
  assert.throws(() => claimCampaign(state, member, shops, { id: campaign.id }, now + 2 * 3600000));
  claimCampaign(state, member, shops, { id: campaign.id }, now);
  const coupon = member.coupons[0], data = { lines: [{ item: 0, qty: 1 }], coupon: coupon.id };
  assert.equal(quotePickupOrder(state, member, shop, data, now).discountAmount, 500);
  assert.throws(() => quotePickupOrder(state, member, shop, data, now + 2 * 3600000));
  const receipt = { item: 0, purchaseAmount: 3000, receiptNumber: "20261123-WINDOW", purchaseConfirmed: true };
  assert.throws(() => redeemCampaign(state, member, shop, coupon, receipt, "qr", now + 2 * 3600000));
  redeemCampaign(state, member, shop, coupon, receipt, "pickup", now + 2 * 3600000, now);
  assert.throws(() => offer(state, { dailyStart: 900, dailyEnd: 800 }));
  assert.throws(() => offer(state, { weekdays: [1, 1] }));
});

test("margin guard validates variable costs, fees and immutable issued terms without asserting incrementality", () => {
  const { state, member } = fixture();
  const campaign = offer(state, { variableCost: 1200, minContribution: 1000 });
  assert.equal(campaignContribution(campaign), 1300);
  assert.equal(campaignContribution({ ...campaign, type: "sponsor" }), 1800);
  assert.throws(() => offer(state, { variableCost: 2600 }));
  assert.throws(() => offer(state, { minContribution: 1 }));
  claimCampaign(state, member, shops, { id: campaign.id }, now);
  assert.throws(() => manageCampaign(state, shop, "edit", { ...campaign, variableCost: 1100 }, now));
  assert.throws(() => manageCampaign(state, shop, "edit", { ...campaign, dailyLimit: 1 }, now));
  const edited = manageCampaign(state, shop, "edit", { ...campaign, title: "제목만 수정" }, now);
  assert.equal(edited.title, "제목만 수정");
  assert.equal(edited.stats.observedContribution, 0);
  assert.equal(edited.stats.incrementalRevenue, undefined);
});
