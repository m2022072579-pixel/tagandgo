// Store-scoped, opt-in, in-app retention. No external messages or billing.
const retentionDay = 86400000;
const retentionValues = object => Object.values(object ?? {});
const retentionDateKey = time => new Date(time + 9 * 3600000).toISOString().slice(0, 10);

export function retentionVisits(state, shopId, now = Date.now()) {
  const records = new Map();
  const recorded = new Set();
  const add = (member, time) => {
    if (!Number.isFinite(time) || time > now || time < 0) return;
    if (!records.has(member)) records.set(member, new Map());
    const days = records.get(member), key = retentionDateKey(time);
    days.set(key, Math.max(days.get(key) ?? 0, time));
  };
  for (const entry of retentionValues(state.transactions)) {
    if (entry.shop !== shopId) continue;
    recorded.add(entry.member);
    if (!entry.cancelled && entry.source) add(entry.member, entry.time);
  }
  for (const entry of retentionValues(state.campaignRedemptions)) if (entry.shop === shopId) add(entry.member, entry.time);
  for (const entry of retentionValues(state.orders)) if (entry.shop === shopId && entry.status === "pickedUp") {
    const confirmation = state.transactions?.["pickup:" + entry.id]?.time ?? retentionValues(state.campaignRedemptions).find(use => use.source === "pickup" && use.coupon === entry.couponId && use.shop === shopId)?.time;
    add(entry.member, entry.pickedUpAt ?? confirmation ?? entry.time);
  }
  for (const member of retentionValues(state.members)) {
    if (recorded.has(member.code) || records.has(member.code)) continue;
    const history = (member.activity ?? []).filter(entry => entry.shop === shopId);
    // Do not resurrect cancelled legacy visits when their original record is absent.
    if (history.some(entry => entry.type === "cancel")) continue;
    for (const entry of history) if (entry.type === "stamp") add(member.code, entry.time);
  }
  return records;
}

export function retentionEnabled(state, shopId, now = Date.now()) {
  return (state.retentionTrials?.[shopId]?.endsAt ?? 0) > now;
}

export function retentionOverview(state, shopId, now = Date.now()) {
  const visits = retentionVisits(state, shopId, now);
  const rows = retentionValues(state.members).flatMap(member => {
    const days = visits.get(member.code);
    if (!days?.size) return [];
    const times = [...days.values()].sort((a, b) => a - b);
    const firstAt = times[0], lastAt = times.at(-1);
    const absentDays = Math.floor((now - lastAt) / retentionDay);
    const segment = times.length === 1 && absentDays >= 7 ? "second" : times.length >= 2 && absentDays >= 21 ? "lapsed" : "active";
    return [{ code: member.code, name: member.name, days: times.length, firstAt, lastAt, absentDays, segment,
      consent: member.storeConsents?.[shopId]?.enabled === true }];
  }).sort((a, b) => b.absentDays - a.absentDays);
  const segments = ["second", "lapsed"].map(id => ({ id, count: rows.filter(row => row.segment === id).length,
    eligible: rows.filter(row => row.segment === id && row.consent).length }));
  const trial = state.retentionTrials?.[shopId];
  return { segments, customers: rows.length, returned: rows.filter(row => row.days >= 2).length,
    consented: rows.filter(row => row.consent).length,
    rows: retentionEnabled(state, shopId, now) ? rows : [],
    trial: { status: retentionEnabled(state, shopId, now) ? "active" : trial ? "expired" : "available", endsAt: trial?.endsAt ?? null },
    channel: "in_app" };
}

export function retentionAudience(state, shopId, segment, now = Date.now()) {
  if (!["second", "lapsed"].includes(segment)) throw new Error("재방문 대상 조건을 확인해 주세요.");
  if (!retentionEnabled(state, shopId, now)) throw new Error("무료 프로 파일럿을 시작한 뒤 재방문 혜택을 등록해 주세요.");
  return retentionOverview(state, shopId, now).rows.filter(row => row.segment === segment && row.consent).map(row => row.code);
}

export function startRetentionTrial(state, shopId, data, now = Date.now()) {
  if (data.accepted !== true) throw new Error("무료 파일럿 조건을 확인해 주세요.");
  state.retentionTrials ??= {};
  if (!Object.hasOwn(state.retentionTrials, shopId)) state.retentionTrials[shopId] = { startedAt: now, endsAt: now + 30 * retentionDay, termsVersion: "pilot-v1" };
  return retentionOverview(state, shopId, now);
}

export function setStoreConsent(member, shopId, data, now = Date.now()) {
  if (typeof data.enabled !== "boolean") throw new Error("혜택 수신 설정을 확인해 주세요.");
  member.storeConsents ??= {};
  const previous = member.storeConsents[shopId];
  if (previous?.enabled === data.enabled) return;
  member.storeConsents[shopId] = { enabled: data.enabled, updatedAt: now, scope: "in_app", version: "in-app-v1" };
  member.consentHistory ??= [];
  member.consentHistory.push({ shop: shopId, enabled: data.enabled, time: now, scope: "in_app", version: "in-app-v1" });
}

export function retentionTargetAllowed(state, campaign, member, now = Date.now()) {
  if (!retentionEnabled(state, campaign.shop, now) || !member || member.storeConsents?.[campaign.shop]?.enabled !== true || !campaign.recipients?.includes(member.code)) return false;
  // Stop suggesting an unclaimed offer after a later recorded visit.
  return ![...(retentionVisits(state, campaign.shop, now).get(member.code)?.values() ?? [])].some(time => time > campaign.createdAt);
}

export function campaignWindowReason(terms, now = Date.now()) {
  const local = new Date(now + 9 * 3600000);
  if (terms.weekdays?.length && !terms.weekdays.includes(local.getUTCDay())) return "사용 가능한 요일을 확인해 주세요";
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  if (terms.dailyStart !== undefined && terms.dailyStart !== null && (minute < terms.dailyStart || minute >= terms.dailyEnd)) return "사용 가능한 시간대를 확인해 주세요";
  return "";
}

export function campaignDailyIssued(state, campaignId, now = Date.now()) {
  const today = retentionDateKey(now);
  return retentionValues(state.campaignClaims).filter(claim => claim.campaign === campaignId && retentionDateKey(claim.time) === today).length;
}

export function campaignContribution(campaign) {
  if (campaign.variableCost === null || campaign.variableCost === undefined) return null;
  const fee = campaign.feeMode === "rate" ? Math.floor((campaign.price - campaign.discountAmount) * campaign.fee / 10000) : campaign.fee;
  return campaign.price - (campaign.type === "sponsor" ? 0 : campaign.discountAmount) - campaign.variableCost - fee;
}
