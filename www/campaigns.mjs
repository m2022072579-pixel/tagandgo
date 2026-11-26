import { retentionAudience, retentionEnabled, retentionTargetAllowed, campaignWindowReason, campaignDailyIssued, campaignContribution } from "./retention.mjs";

export const campaignTypes = { first: "첫 방문", time: "타임딜", sponsor: "기관 지원", return: "다시 방문" };

const own = (object, key) => Object.hasOwn(object ?? {}, key) ? object[key] : null;
const id = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), byte => byte.toString(16).padStart(2, "0")).join("");
const values = object => Object.values(object ?? {});

function integer(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(label + "을 확인해 주세요.");
  return number;
}

function text(value, limit, label) {
  const result = String(value ?? "").trim();
  if (!result || result.length > limit) throw new Error(label + "을 확인해 주세요.");
  return result;
}

export function campaignStats(state, campaign) {
  const claims = values(state.campaignClaims).filter(claim => claim.campaign === campaign.id);
  const uses = values(state.campaignRedemptions).filter(use => use.campaign === campaign.id);
  const customers = new Set(uses.map(use => use.member));
  const returned = new Set(uses.filter(use => values(state.transactions).some(transaction =>
    transaction.member === use.member && transaction.shop === campaign.shop && transaction.time > use.time &&
    !transaction.cancelled && transaction.source
  ) || values(state.campaignRedemptions).some(later => later.member === use.member && later.shop === use.shop && later.time > use.time)).map(use => use.member));
  return {
    issued: claims.length, used: uses.length, customers: customers.size,
    conversion: claims.length ? Math.round(uses.length / claims.length * 1000) / 10 : 0,
    newCustomers: campaign.type === "first" ? customers.size : 0, returning: returned.size,
    committed: claims.reduce((sum, claim) => sum + claim.cost, 0),
    spent: uses.reduce((sum, use) => sum + use.discountAmount + use.feeAmount, 0),
    fees: uses.reduce((sum, use) => sum + use.feeAmount, 0),
    customerPaid: uses.reduce((sum, use) => sum + use.netAmount, 0),
    supported: uses.reduce((sum, use) => sum + use.discountAmount, 0),
    contributionPerUse: campaignContribution(campaign),
    observedContribution: campaignContribution(campaign) === null ? null : uses.length * campaignContribution(campaign),
  };
}

function feeFor(campaign) {
  return campaign.feeMode === "rate" ? Math.floor((campaign.price - campaign.discountAmount) * campaign.fee / 10000) : campaign.fee;
}

export function hasVisited(state, member, shopId) {
  if (values(state.campaignRedemptions).some(use => use.member === member.code && use.shop === shopId)) return true;
  if (values(state.transactions).some(transaction => transaction.member === member.code && transaction.shop === shopId &&
    transaction.source && !transaction.cancelled)) return true;
  // Preserve first-visit eligibility for legacy accounts whose history predates transaction storage.
  const activity = member.activity.filter(entry => entry.shop === shopId);
  return (member.stamps[shopId] ?? 0) > 0 || activity.filter(entry => entry.type === "stamp").length > activity.filter(entry => entry.type === "cancel").length;
}

function availability(state, campaign, member, now) {
  const stats = campaignStats(state, campaign);
  const cost = campaign.discountAmount + feeFor(campaign);
  const remaining = Math.max(0, Math.min(campaign.quantity - stats.issued, Math.floor((campaign.budget - stats.committed) / cost),
    campaign.dailyLimit ? campaign.dailyLimit - campaignDailyIssued(state, campaign.id, now) : Infinity));
  const claim = member && own(state.campaignClaims, campaign.id + ":" + member.code);
  let reason = "";
  if (claim) reason = campaignWindowReason(campaign, now) || "발급 완료";
  else if (campaign.status !== "active" || now >= campaign.endsAt) reason = "종료된 혜택";
  else if (now < campaign.startsAt) reason = "시작 전";
  else if (campaign.type === "return" && !retentionTargetAllowed(state, campaign, member, now)) reason = "이 매장의 재방문 대상 고객 전용";
  else if (campaignWindowReason(campaign, now)) reason = campaignWindowReason(campaign, now);
  else if (campaign.type === "first" && member && hasVisited(state, member, campaign.shop)) reason = "첫 방문 고객 전용";
  else if (state.soldOut[campaign.shop]?.[campaign.item]) reason = "대상 메뉴 품절";
  else if (!remaining) reason = "수량 마감";
  return { remaining, reason, coupon: claim?.coupon ?? null };
}

export function campaignFeed(state, member, shops, now = Date.now()) {
  return values(state.campaigns).filter(campaign => campaign.status === "active" && campaign.startsAt <= now && now < campaign.endsAt &&
    (campaign.type !== "return" || retentionTargetAllowed(state, campaign, member, now)))
    .sort((a, b) => a.endsAt - b.endsAt).map(campaign => ({
      id: campaign.id, shop: campaign.shop, type: campaign.type, title: campaign.title, description: campaign.description,
      sponsor: campaign.sponsor, item: campaign.item, itemName: shops.find(shop => shop.id === campaign.shop)?.menu[campaign.item]?.[0],
      discountAmount: campaign.discountAmount, price: campaign.price, minPurchase: campaign.minPurchase,
      startsAt: campaign.startsAt, endsAt: campaign.endsAt, ...availability(state, campaign, member, now),
      weekdays: campaign.weekdays, dailyStart: campaign.dailyStart, dailyEnd: campaign.dailyEnd, dailyLimit: campaign.dailyLimit,
    }));
}

export function manageCampaign(state, shop, action, data, now = Date.now()) {
  state.campaigns ??= {};
  if (action === "list") return values(state.campaigns).filter(campaign => campaign.shop === shop.id)
    .sort((a, b) => b.createdAt - a.createdAt).map(campaign => ({ ...campaign, stats: campaignStats(state, campaign) }));
  if (action === "create" && (typeof data.reference !== "string" || !/^[a-f0-9]{24}$/.test(data.reference))) throw new Error("캠페인 등록 정보를 다시 열어 주세요.");
  if (action !== "create" && (typeof data.id !== "string" || !/^[a-f0-9]{24}$/.test(data.id))) throw new Error("캠페인을 확인해 주세요.");
  const previous = own(state.campaigns, action === "create" ? data.reference : data.id);
  const creationRequest = JSON.stringify([data.type, data.title, data.description ?? "", data.sponsor ?? "", data.item, data.startsAt, data.endsAt, data.discountAmount, data.minPurchase, data.quantity, data.budget, data.fee,
    data.segment ?? "", data.weekdays ?? [], data.dailyStart ?? null, data.dailyEnd ?? null, data.dailyLimit ?? 0, data.variableCost ?? null, data.minContribution ?? 0]);
  if (action === "create" && previous) {
    if (previous.shop !== shop.id || previous.creationRequest !== creationRequest) throw new Error("이미 처리된 등록 요청이에요.");
    return { ...previous, stats: campaignStats(state, previous) };
  }
  if (action !== "create" && (!previous || previous.shop !== shop.id)) throw new Error("이 매장의 캠페인을 확인해 주세요.");
  if (action === "end" && previous.status === "ended") return { ...previous, stats: campaignStats(state, previous) };
  if (action !== "create" && data.version !== previous.version) throw new Error("캠페인이 변경됐어요. 새로고침 후 다시 시도해 주세요.");
  if (action === "end") {
    previous.status = "ended";
    previous.version++;
    previous.updatedAt = now;
    return { ...previous, stats: campaignStats(state, previous) };
  }
  if (!["create", "edit"].includes(action)) throw new Error("캠페인 요청을 확인해 주세요.");
  if (previous?.status === "ended") throw new Error("종료한 캠페인은 새로 등록해 주세요.");
  if (typeof data.type !== "string" || !Object.hasOwn(campaignTypes, data.type)) throw new Error("혜택 종류를 확인해 주세요.");
  const item = integer(data.item, 0, shop.menu.length - 1, "대상 메뉴");
  const price = shop.menu[item][1];
  const startsAt = Number(data.startsAt);
  const endsAt = Number(data.endsAt);
  if (!Number.isSafeInteger(startsAt) || !Number.isSafeInteger(endsAt) || startsAt >= endsAt || endsAt <= now) throw new Error("캠페인 시작·종료 시간을 확인해 주세요.");
  const weekdays = data.weekdays ?? previous?.weekdays ?? [];
  if (!Array.isArray(weekdays) || weekdays.length > 7 || new Set(weekdays).size !== weekdays.length || weekdays.some(value => !Number.isInteger(value) || value < 0 || value > 6)) throw new Error("사용 요일을 확인해 주세요.");
  const dailyStart = Object.hasOwn(data, "dailyStart") ? data.dailyStart : previous?.dailyStart ?? null;
  const dailyEnd = Object.hasOwn(data, "dailyEnd") ? data.dailyEnd : previous?.dailyEnd ?? null;
  if ((dailyStart !== null || dailyEnd !== null) && (!Number.isInteger(dailyStart) || !Number.isInteger(dailyEnd) || dailyStart < 0 || dailyEnd > 1440 || dailyStart >= dailyEnd)) throw new Error("같은 날의 시작·종료 시간대를 확인해 주세요.");
  const variableCost = Object.hasOwn(data, "variableCost") ? data.variableCost : previous?.variableCost ?? null;
  const segment = data.segment ?? previous?.segment ?? "";
  if (previous && previous.type !== data.type && [previous.type, data.type].includes("return")) throw new Error("재방문 혜택은 새 캠페인으로 등록해 주세요.");
  const recipients = data.type === "return" ? previous?.recipients ?? retentionAudience(state, shop.id, segment, now) : [];
  if (data.type === "return" && !retentionEnabled(state, shop.id, now)) throw new Error("무료 프로 파일럿 기간을 확인해 주세요.");
  if (previous?.type === "return" && data.type === "return" && segment !== previous.segment) throw new Error("재방문 대상은 새 캠페인에서 선택해 주세요.");
  if (data.type === "return" && !previous && !recipients.length) throw new Error("해당 조건과 앱 내 혜택 수신 동의를 충족하는 고객이 없어요.");
  const next = {
    id: previous?.id ?? data.reference, shop: shop.id, type: data.type,
    creationRequest: previous?.creationRequest ?? creationRequest,
    title: text(data.title, 60, "제목"), description: String(data.description ?? "").trim().slice(0, 200),
    sponsor: data.type === "sponsor" ? text(data.sponsor, 60, "지원 기관명") : "",
    item, price, startsAt, endsAt, discountAmount: integer(data.discountAmount, 1, price, "할인·지원 금액"),
    minPurchase: integer(data.minPurchase, price, 1000000, "최소 구매금액"),
    quantity: integer(data.quantity, 1, 100000, "발급 수량"), budget: integer(data.budget, 1, 1000000000, "예산"),
    feeMode: data.type === "time" ? "rate" : "fixed",
    fee: integer(data.fee, 0, data.type === "time" ? 10000 : 100000, "수수료"),
    inviteCode: data.type === "sponsor" ? previous?.inviteCode ?? id().slice(0, 10).toUpperCase() : "",
    status: "active", version: (previous?.version ?? 0) + 1, createdAt: previous?.createdAt ?? now, updatedAt: now,
    segment: data.type === "return" ? segment : "", recipients,
    weekdays, dailyStart, dailyEnd,
    dailyLimit: integer(data.dailyLimit ?? previous?.dailyLimit ?? 0, 0, 100000, "하루 발급 한도"),
    variableCost: variableCost === null ? null : integer(variableCost, 0, 1000000, "메뉴 변동비"),
    minContribution: integer(data.minContribution ?? previous?.minContribution ?? 0, 0, 1000000, "잔당 최소 공헌이익"),
  };
  if (next.type === "return" && next.fee !== 0) throw new Error("내 매장 재방문 혜택에는 유입 수수료를 중복 부과하지 않아요.");
  if (next.minContribution && next.variableCost === null) throw new Error("최소 공헌이익을 설정하려면 변동비를 입력해 주세요.");
  if (campaignContribution(next) !== null && campaignContribution(next) < next.minContribution) throw new Error("할인 후 잔당 공헌이익이 설정한 최소 금액보다 적어요.");
  const stats = previous ? campaignStats(state, previous) : { issued: 0, committed: 0 };
  if (next.quantity < stats.issued || next.budget < stats.committed) throw new Error("발급된 수량과 확보된 예산보다 줄일 수 없어요.");
  if (next.budget < next.discountAmount + feeFor(next)) throw new Error("쿠폰 1장의 혜택과 수수료를 충당할 예산이 필요해요.");
  if (stats.issued) {
    const terms = ["type", "item", "price", "startsAt", "discountAmount", "minPurchase", "fee", "feeMode", "sponsor", "segment", "dailyStart", "dailyEnd", "dailyLimit", "variableCost", "minContribution"];
    if (terms.some(field => (next[field] ?? null) !== (previous[field] ?? (field === "segment" ? "" : ["dailyLimit", "minContribution"].includes(field) ? 0 : null))) || JSON.stringify(next.weekdays) !== JSON.stringify(previous.weekdays ?? []) || endsAt < previous.endsAt) throw new Error("발급 후에는 수량·예산, 제목·설명과 종료 연장만 수정할 수 있어요.");
  }
  state.campaigns[next.id] = next;
  return { ...next, stats: campaignStats(state, next) };
}

export function claimCampaign(state, member, shops, data, now = Date.now()) {
  if (typeof data.id !== "string" || !/^[a-f0-9]{24}$/.test(data.id)) throw new Error("혜택을 확인해 주세요.");
  const campaign = own(state.campaigns, data.id);
  if (!campaign) throw new Error("혜택을 찾지 못했어요.");
  state.campaignClaims ??= {};
  const key = campaign.id + ":" + member.code;
  if (own(state.campaignClaims, key)) return;
  const status = availability(state, campaign, member, now);
  if (status.reason) throw new Error(status.reason);
  if (campaign.type === "sponsor" && String(data.code ?? "").trim().toUpperCase() !== campaign.inviteCode) throw new Error("기관에서 받은 참여 코드를 확인해 주세요.");
  const feeAmount = feeFor(campaign);
  const coupon = {
    id: id(), shop: campaign.shop, kind: "campaign", campaign: campaign.id, campaignType: campaign.type,
    title: campaign.title, item: campaign.item, itemName: shops.find(shop => shop.id === campaign.shop).menu[campaign.item][0],
    price: campaign.price, discountAmount: campaign.discountAmount, minPurchase: campaign.minPurchase,
    feeAmount, sponsor: campaign.sponsor, startsAt: campaign.startsAt, expires: campaign.endsAt, used: null,
    weekdays: campaign.weekdays, dailyStart: campaign.dailyStart, dailyEnd: campaign.dailyEnd,
  };
  member.coupons.push(coupon);
  state.campaignClaims[key] = { campaign: campaign.id, member: member.code, coupon: coupon.id, time: now, cost: coupon.discountAmount + feeAmount };
}

export function redeemCampaign(state, member, shop, coupon, data, source, now = Date.now(), reservationTime) {
  const validAt = reservationTime ?? now;
  if (coupon.startsAt > validAt || coupon.expires <= validAt || coupon.used || coupon.voided) throw new Error("쿠폰을 사용할 수 있는 시간을 확인해 주세요.");
  if (campaignWindowReason(coupon, validAt)) throw new Error(campaignWindowReason(coupon, validAt));
  if (coupon.campaignType === "first" && hasVisited(state, member, shop.id)) throw new Error("첫 방문 혜택은 이전 구매 내역이 없는 고객만 사용할 수 있어요.");
  if (coupon.campaignType === "first" && data.firstVisitConfirmed !== true) throw new Error("매장 기준의 첫 방문 고객 여부도 확인해 주세요.");
  if (reservationTime === undefined && state.soldOut[shop.id]?.[coupon.item]) throw new Error("대상 메뉴가 품절됐어요.");
  if (data.purchaseConfirmed !== true || Number(data.item) !== coupon.item) throw new Error("대상 메뉴 제공과 실제 영수증을 확인해 주세요.");
  const purchaseAmount = integer(data.purchaseAmount, coupon.minPurchase, 1000000, "할인 전 구매금액");
  const receipt = text(data.receiptNumber, 64, "영수증 번호").toUpperCase();
  if (!/^[A-Z0-9가-힣_-]{4,64}$/.test(receipt)) throw new Error("날짜를 포함한 영수증 번호를 4~64자리로 입력해 주세요.");
  state.campaignRedemptions ??= {};
  const key = shop.id + ":" + receipt;
  if (own(state.campaignRedemptions, key)) throw new Error("이 영수증에는 이미 혜택을 적용했어요.");
  const record = {
    campaign: coupon.campaign, coupon: coupon.id, member: member.code, shop: shop.id, source,
    receiptNumber: receipt, purchaseAmount, item: coupon.item, discountAmount: coupon.discountAmount,
    feeAmount: coupon.feeAmount, netAmount: coupon.price - coupon.discountAmount,
    time: now, verification: "staff_confirmed", billingStatus: "unbilled",
  };
  state.campaignRedemptions[key] = record;
  return record;
}

export function seedDemoCampaigns(state, shops) {
  const now = Date.now();
  const existing = values(state.campaigns);
  // Refresh expired sample campaigns only; retain old claims and coupon terms.
  if (existing.length && !existing.every(campaign => campaign.endsAt <= now)) return;
  const examples = [
    { shop: "dict", type: "first", title: "첫 만남, 커피 한 잔의 여유", discountAmount: 1000, fee: 500, sponsor: "" },
    { shop: "pando", type: "time", title: "오늘의 커피, 조금 더 가볍게", discountAmount: 700, fee: 700, sponsor: "" },
    { shop: "tiamo", type: "sponsor", title: "시험기간 커피 지원", discountAmount: 3500, fee: 300, sponsor: "학교 행사 · 시연" },
  ];
  for (const example of examples) {
    const shop = shops.find(shop => shop.id === example.shop);
    const created = manageCampaign(state, shop, "create", {
      ...example, reference: id(), description: "체험 모드의 시연 혜택입니다.", item: 0, minPurchase: shop.menu[0][1],
      startsAt: now - 60000, endsAt: now + 86400000, quantity: 20, budget: 100000,
    }, now);
    if (example.type === "sponsor") state.campaigns[created.id].inviteCode = "MOADEMO26";
  }
}
