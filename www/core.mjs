import { campaignFeed, manageCampaign, claimCampaign, redeemCampaign, seedDemoCampaigns } from "./campaigns.mjs";
import { heldCouponOrder, quotePickupOrder } from "./checkout.mjs";
import { retentionOverview, startRetentionTrial, setStoreConsent } from "./retention.mjs";

const sampleShops = [
  { id: "pando", name: "팬도로시", area: "한양대 앞", goal: 8, reward: "아메리카노 1잔", tone: "peach", initials: "P", hours: "09:00–21:00", menu: [["아메리카노", 3000], ["카페라떼", 3800], ["바닐라라떼", 4200]] },
  { id: "dict", name: "딕셔너리", area: "왕십리", goal: 10, reward: "아메리카노 1잔", tone: "sage", initials: "D", hours: "10:00–22:00", menu: [["아메리카노", 4000], ["플랫화이트", 4800], ["얼그레이", 4500]] },
  { id: "tiamo", name: "카페띠아모", area: "한양대 앞", goal: 8, reward: "아메리카노 1잔", tone: "sand", initials: "T", hours: "09:00–22:00", menu: [["아메리카노", 3500], ["카페모카", 4500], ["젤라또", 5000, "food"]] },
];
export const shops = structuredClone(sampleShops);

export function validateShopCatalog(catalog) {
  if (!Array.isArray(catalog) || !catalog.length || catalog.length > 50) throw new Error("매장 정보를 확인해 주세요.");
  const seen = new Set();
  return catalog.map(shop => {
    if (!shop || typeof shop.id !== "string" || !/^[a-z0-9-]{1,40}$/.test(shop.id) || seen.has(shop.id)) throw new Error("매장 ID를 확인해 주세요.");
    seen.add(shop.id);
    const label = (value, limit, name) => {
      if (typeof value !== "string" || !value.trim() || value.trim().length > limit) throw new Error(name + "을 확인해 주세요.");
      return value.trim();
    };
    if (!Number.isInteger(shop.goal) || shop.goal < 1 || shop.goal > 20) throw new Error("적립 기준은 1~20개로 입력해 주세요.");
    if (!Array.isArray(shop.menu) || !shop.menu.length || shop.menu.length > 20) throw new Error("메뉴를 1~20개 등록해 주세요.");
    const menu = shop.menu.map(line => {
      if (!Array.isArray(line) || !Number.isSafeInteger(line[1]) || line[1] < 1 || line[1] > 1000000 || (line[2] && line[2] !== "food")) throw new Error("메뉴 가격과 분류를 확인해 주세요.");
      return [label(line[0], 40, "메뉴 이름"), line[1], ...(line[2] === "food" ? ["food"] : [])];
    });
    if (menu[0][2] === "food") throw new Error("첫 메뉴는 적립 보상으로 제공할 음료로 등록해 주세요.");
    return { id: shop.id, name: label(shop.name, 40, "매장명"), area: label(shop.area, 40, "지역"),
      hours: label(shop.hours, 40, "영업시간"), goal: shop.goal, menu,
      reward: shop.reward ? label(shop.reward, 60, "적립 보상") : menu[0][0] + " 1잔",
      tone: ["peach", "sage", "sand"].includes(shop.tone) ? shop.tone : "peach",
      initials: typeof shop.initials === "string" ? Array.from(shop.initials).slice(0, 2).join("") : Array.from(shop.name.trim())[0] };
  });
}

export function setShopCatalog(catalog) {
  shops.splice(0, shops.length, ...validateShopCatalog(catalog));
}

export function resetShopCatalog() {
  shops.splice(0, shops.length, ...structuredClone(sampleShops));
}

const day = 24 * 60 * 60 * 1000;
const couponDays = 30 * day;
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, "0")).join("");
export const newReference = () => token().slice(0, 24);
const normalizeTag = value => String(value ?? "").trim().replace(/[: -]/g, "").toUpperCase();
const tagOf = value => {
  const tag = normalizeTag(value);
  if (!/^[A-Z0-9]{4,48}$/.test(tag)) throw new Error("리더기로 읽은 올바른 태그 ID를 입력해 주세요.");
  return tag;
};
const getShop = id => {
  const shop = shops.find(entry => entry.id === id);
  if (!shop) throw new Error("매장을 선택해 주세요.");
  return shop;
};

export function newState() {
  return { members: {}, tags: {}, transactions: {}, soldOut: {}, passes: {}, receipts: {}, orders: {}, campaigns: {}, campaignClaims: {}, campaignRedemptions: {} };
}

export function createMember(state, name) {
  const cleaned = String(name ?? "").trim();
  if (!cleaned || cleaned.length > 24) throw new Error("닉네임을 1~24자로 입력해 주세요.");
  let secret = token();
  while (Object.values(state.members).some(member => member.code === secret.slice(0, 10).toUpperCase())) secret = token();
  const member = {
    name: cleaned, code: secret.slice(0, 10).toUpperCase(), tag: null, locked: false,
    stamps: {}, coupons: [], activity: [],
  };
  state.members[secret] = member;
  return { token: secret, profile: profileOf(state, member) };
}

const profileOf = (state, member) => ({
  name: member.name, code: member.code, hasTag: Boolean(member.tag), locked: member.locked,
  hasRecovery: Boolean(member.recovery), stamps: member.stamps, coupons: member.coupons.map(coupon => {
    const order = heldCouponOrder(state, member, coupon.id);
    return order ? { ...coupon, reservedOrder: order.id } : coupon;
  }), activity: member.activity.slice(0, 50),
  orders: Object.values(state.orders ?? {}).filter(order => order.member === member.code).slice(-30).reverse().map(orderDetails),
  savedMenus: member.savedMenus ?? [],
  storeConsents: member.storeConsents ?? {},
  campaigns: campaignFeed(state, member, shops),
});

const entries = (object, key) => Object.prototype.hasOwnProperty.call(object, key) ? object[key] : null;
const memberForCode = (state, code) => Object.values(state.members).find(member => member.code === code);
const normalizeCode = value => String(value ?? "").trim().toUpperCase().replace(/\s/g, "");
const activeCoupon = (coupon, now) => !coupon.used && !coupon.voided && coupon.expires > now && (!coupon.startsAt || coupon.startsAt <= now);
const orderDetails = ({ id, shop, time, lines, total, status, note = "", subtotal = total, discountAmount = 0, couponId = "", couponTitle = "", couponType = "", stampQty }) =>
  ({ id, shop, time, lines, total, status, note, subtotal, discountAmount, couponId, couponTitle, couponType, stampQty });

export function recoverMember(state, value) {
  const key = normalizeCode(value).replace(/-/g, "");
  if (!/^[0-9A-F]{32}$/.test(key)) throw new Error("32자리 복구 키를 확인해 주세요.");
  const match = Object.entries(state.members).find(([, member]) => member.recovery === key);
  if (!match) throw new Error("유효한 복구 키를 찾지 못했어요.");
  const [oldSecret, member] = match;
  const secret = token();
  delete state.members[oldSecret];
  state.members[secret] = member;
  if (member.tag) state.tags[member.tag] = secret;
  return { token: secret, profile: profileOf(state, member) };
}

export function memberAction(state, secret, action, data) {
  const member = entries(state.members, secret);
  if (!member) throw new Error("회원 연결이 만료되었습니다.");
  const now = Date.now();
  if (action === "storeConsent") {
    const shop = getShop(data.shop);
    setStoreConsent(member, shop.id, data, now);
    return profileOf(state, member);
  }
  if (action === "recovery") {
    member.recovery = token().slice(0, 32).toUpperCase();
    return { key: member.recovery, profile: profileOf(state, member) };
  }
  if (action === "pass") {
    let selected;
    if (data.coupon !== undefined) {
      if (typeof data.coupon !== "string") throw new Error("사용할 쿠폰을 다시 선택해 주세요.");
      selected = member.coupons.find(coupon => coupon.id === data.coupon && activeCoupon(coupon, now));
      if (!selected) throw new Error("선택한 쿠폰의 사용 기간을 확인해 주세요.");
      if (heldCouponOrder(state, member, selected.id)) throw new Error("픽업 주문에 적용 중인 쿠폰이에요. 주문 내역을 확인해 주세요.");
    }
    state.passes ??= {};
    for (const [code, pass] of Object.entries(state.passes)) {
      if (pass.expires <= now || pass.used || pass.member === member.code) delete state.passes[code];
    }
    const code = "CP-" + newReference().slice(0, 12).toUpperCase();
    const expires = Math.min(now + 120000, selected?.expires ?? Infinity);
    state.passes[code] = { member: member.code, expires, ...(selected ? { coupon: selected.id } : {}) };
    return { code, expires, ...(selected ? { coupon: selected.id } : {}) };
  }
  if (action === "claim") {
    const code = normalizeCode(data.code);
    const receipt = entries(state.receipts ?? {}, code);
    if (receipt?.member === member.code) return profileOf(state, member);
    if (!receipt || receipt.expires <= now || receipt.member) throw new Error("사용할 수 있는 사후 적립 코드를 확인해 주세요.");
    const shop = getShop(receipt.shop);
    grant(state, member, shop, receipt.qty, "receipt:" + code, "receipt", now);
    receipt.member = member.code;
    return profileOf(state, member);
  }
  if (action === "order") return createOrder(state, member, data, now);
  if (action === "quoteOrder") return quotePickupOrder(state, member, getShop(data.shop), data, now);
  if (action === "saveMenu") {
    if (typeof data.title !== "string" || !data.title.trim() || data.title.trim().length > 24) throw new Error("메뉴 이름을 1~24자로 입력해 주세요.");
    if (data.order !== undefined && typeof data.order !== "string") throw new Error("내 완료 주문에서 메뉴를 저장해 주세요.");
    const source = data.order ? entries(state.orders ?? {}, data.order) : null;
    if (data.order && (!source || source.member !== member.code || source.status !== "pickedUp")) throw new Error("내 완료 주문에서 메뉴를 저장해 주세요.");
    const shop = getShop(source?.shop ?? data.shop);
    const note = source?.note ?? data.note ?? "";
    if (typeof note !== "string" || note.trim().length > 100) throw new Error("매장 요청사항은 100자 이내로 입력해 주세요.");
    if (source?.lines.some(line => shop.menu[line.item]?.[0] !== line.name)) throw new Error("메뉴가 변경됐어요. 현재 매장 메뉴에서 다시 저장해 주세요.");
    const quote = quotePickupOrder({ ...state, soldOut: {} }, member, shop, { lines: source?.lines ?? data.lines, coupon: "" }, now);
    const intent = JSON.stringify([shop.id, quote.lines.map(line => [line.item, line.qty]).sort((a, b) => a[0] - b[0]), note.trim()]);
    member.savedMenus ??= [];
    const previous = member.savedMenus.find(menu => menu.intent === intent);
    if (previous) { previous.title = data.title.trim(); previous.time = now; }
    else {
      if (member.savedMenus.length >= 12) throw new Error("나의 메뉴는 12개까지 저장할 수 있어요. 사용하지 않는 메뉴를 정리해 주세요.");
      member.savedMenus.unshift({ id: newReference(), shop: shop.id, title: data.title.trim(), lines: quote.lines, note: note.trim(), intent, time: now });
    }
    return profileOf(state, member);
  }
  if (action === "deleteSavedMenu") {
    if (typeof data.id !== "string" || !member.savedMenus?.some(menu => menu.id === data.id)) throw new Error("삭제할 나의 메뉴를 확인해 주세요.");
    member.savedMenus = member.savedMenus.filter(menu => menu.id !== data.id);
    return profileOf(state, member);
  }
  if (action === "claimCampaign") {
    claimCampaign(state, member, shops, data, now);
    return profileOf(state, member);
  }
  if (action === "cancelOrder") {
    const order = entries(state.orders ?? {}, data.id);
    if (!order || order.member !== member.code) throw new Error("주문을 찾지 못했어요.");
    if (order.status === "cancelled") return profileOf(state, member);
    if (order.status !== "submitted") throw new Error("매장이 접수한 주문은 매장에 문의해 주세요.");
    order.status = "cancelled";
    return profileOf(state, member);
  }
  if (action === "lock") {
    if (!member.tag) throw new Error("먼저 매장에서 키링을 등록해 주세요.");
    member.locked = data.locked === true;
  } else if (action !== "profile") {
    throw new Error("요청을 확인해 주세요.");
  }
  return profileOf(state, member);
}

function memberForTag(state, tag) {
  const secret = entries(state.tags, tag);
  return secret ? state.members[secret] : null;
}

function resolveCustomer(state, data, now) {
  const raw = normalizeCode(data.tag);
  if (raw.startsWith("CP-") || data.method === "qr") {
    const pass = entries(state.passes ?? {}, raw);
    if (!pass || pass.used || pass.expires <= now) throw new Error("QR이 만료됐거나 이미 사용됐어요. 고객에게 새 QR을 요청해 주세요.");
    return { member: memberForCode(state, pass.member), pass, source: "qr", code: raw };
  }
  const code = tagOf(data.tag);
  return { member: memberForTag(state, code), pass: null, source: "nfc", code };
}

function identify(state, shop, customer, now) {
  const { member, pass } = customer;
  if (!member) return { status: "unregistered" };
  if (!pass && member.locked) return { status: "locked" };
  if (pass?.coupon && !member.coupons.some(coupon => coupon.id === pass.coupon && coupon.shop === shop.id && activeCoupon(coupon, now))) throw new Error("선택한 쿠폰의 매장과 사용 기간을 확인해 주세요.");
  if (pass?.coupon && heldCouponOrder(state, member, pass.coupon)) throw new Error("픽업 주문에 적용 중인 쿠폰이에요. 주문 내역을 확인해 주세요.");
  return {
    status: "ready", name: member.name, stamps: member.stamps[shop.id] ?? 0,
    selectedCoupon: pass?.coupon ?? null,
    coupons: member.coupons.filter(coupon => coupon.shop === shop.id && activeCoupon(coupon, now) && !heldCouponOrder(state, member, coupon.id))
      .map(coupon => ({ ...coupon })),
  };
}

function quantity(value) {
  const qty = Number(value);
  if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new Error("음료 수량은 1~20잔이어야 해요.");
  return qty;
}

function requestId(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{24}$/.test(value)) throw new Error("구매 정보를 다시 확인해 주세요.");
  return value;
}

function grant(state, member, shop, qty, key, source, now) {
  const before = member.stamps[shop.id] ?? 0;
  const total = before + qty;
  const earned = Math.floor(total / shop.goal);
  member.stamps[shop.id] = total % shop.goal;
  const coupons = [];
  for (let index = 0; index < earned; index++) {
    const id = newReference();
    coupons.push(id);
    member.coupons.push({ id, shop: shop.id, expires: now + couponDays, used: null });
  }
  member.activity.unshift({ shop: shop.id, time: now, qty, type: "stamp", source });
  const result = { stamps: member.stamps[shop.id], earned };
  state.transactions[key] = { member: member.code, shop: shop.id, qty, before, coupons, time: now, source, result };
  return result;
}

function createOrder(state, member, data, now) {
  const id = requestId(data.reference);
  const note = data.note === undefined ? "" : data.note;
  if (typeof note !== "string" || note.trim().length > 100) throw new Error("매장 요청사항은 100자 이내로 입력해 주세요.");
  if (data.coupon !== undefined && typeof data.coupon !== "string") throw new Error("사용할 쿠폰을 다시 선택해 주세요.");
  if (!Array.isArray(data.lines) || !data.lines.length || data.lines.some(line => !line || typeof line !== "object" || Array.isArray(line))) throw new Error("메뉴를 선택해 주세요.");
  state.orders ??= {};
  const previous = entries(state.orders, id);
  if (previous?.member === member.code && previous.shop === data.shop) {
    const intent = lines => JSON.stringify(lines.map(line => [Number(line.item), Number(line.qty)]).sort((a, b) => a[0] - b[0]));
    if ((previous.note ?? "") !== note.trim() || intent(previous.lines) !== intent(data.lines) || (previous.couponId ?? "") !== (data.coupon ?? "")) throw new Error("이전 요청과 같은 메뉴·수량·요청사항·쿠폰으로 다시 시도해 주세요.");
    return profileOf(state, member);
  }
  if (previous) throw new Error("주문을 다시 확인해 주세요.");
  const shop = getShop(data.shop);
  const quote = quotePickupOrder(state, member, shop, { ...data, coupon: data.coupon ?? "" }, now);
  if (data.expectedTotal !== undefined && (!Number.isSafeInteger(data.expectedTotal) || data.expectedTotal !== quote.total)) throw new Error("금액이나 쿠폰 조건이 바뀌었어요. 주문 확인 화면에서 다시 확인해 주세요.");
  state.orders[id] = { id, shop: shop.id, member: member.code, name: member.name, lines: quote.lines, total: quote.total,
    subtotal: quote.subtotal, discountAmount: quote.discountAmount, couponId: quote.coupon?.id ?? "", couponTitle: quote.coupon?.title ?? "",
    couponType: quote.coupon?.campaignType ?? "", stampQty: quote.stampQty, note: note.trim(), status: "submitted", time: now };
  return profileOf(state, member);
}

function counterSummary(state, shopId) {
  const now = Date.now();
  const members = Object.values(state.members);
  const transactions = Object.entries(state.transactions).reverse()
    .filter(([, transaction]) => transaction.shop === shopId);
  const visits = members.map(member => member.activity.filter(entry => entry.shop === shopId && entry.type === "stamp").length -
    member.activity.filter(entry => entry.shop === shopId && entry.type === "cancel").length);
  return {
    campaigns: manageCampaign(state, getShop(shopId), "list", {}),
    retention: retentionOverview(state, shopId, now),
    orders: Object.values(state.orders ?? {}).filter(order => order.shop === shopId && !["pickedUp", "cancelled"].includes(order.status))
      .map(order => ({ ...orderDetails(order), name: order.name })),
    sales: transactions.slice(0, 12).map(([id, transaction], index) => ({
      id, time: transaction.time, qty: transaction.qty, cancelled: Boolean(transaction.cancelled),
      source: transaction.source, name: memberForCode(state, transaction.member)?.name ?? "",
      reversible: !["pickup", "campaign"].includes(transaction.source) && !transaction.cancelled && now - transaction.time < day &&
        !(transaction.coupons ?? []).some(id => heldCouponOrder(state, memberForCode(state, transaction.member), id)) &&
        !transactions.slice(0, index).some(([, newer]) => newer.member === transaction.member && !newer.cancelled),
    })),
    customers: visits.filter(count => count > 0).length,
    returning: visits.filter(count => count > 1).length,
    usedCoupons: members.reduce((count, member) => count + member.coupons.filter(coupon => coupon.shop === shopId && coupon.used).length, 0),
  };
}

export function posAction(state, shopId, action, data) {
  const shop = getShop(shopId);
  const now = Date.now();
  if (action === "overview") return counterSummary(state, shopId);
  if (action === "retentionTrial") return startRetentionTrial(state, shopId, data, now);
  const campaignActions = { campaignList: "list", campaignCreate: "create", campaignEdit: "edit", campaignEnd: "end" };
  if (Object.hasOwn(campaignActions, action)) return manageCampaign(state, shop, campaignActions[action], data, now);
  if (action === "availability") {
    const item = Number(data.item);
    if (!Number.isInteger(item) || !shop.menu[item]) throw new Error("메뉴를 확인해 주세요.");
    state.soldOut[shopId] ??= {};
    state.soldOut[shopId][item] = data.soldOut === true;
    return { soldOut: state.soldOut[shopId] };
  }

  if (action === "issueReceipt") {
    const qty = quantity(data.qty);
    const reference = requestId(data.reference);
    state.receipts ??= {};
    const previous = Object.entries(state.receipts).find(([, receipt]) => receipt.shop === shopId && receipt.reference === reference);
    if (previous) {
      if (previous[1].qty !== qty) throw new Error("이미 발행된 영수증 코드예요.");
      return { code: previous[0], expires: previous[1].expires };
    }
    const code = "RC-" + newReference().slice(0, 12).toUpperCase();
    const expires = now + 7 * day;
    state.receipts[code] = { shop: shopId, qty, expires, reference };
    return { code, expires };
  }
  if (action === "reverse") {
    const transaction = entries(state.transactions, data.id);
    if (!transaction || transaction.shop !== shopId || ["pickup", "campaign"].includes(transaction.source)) throw new Error("취소할 적립을 확인해 주세요.");
    if (transaction.cancelled) return { cancelled: true };
    const entry = counterSummary(state, shopId).sales.find(sale => sale.id === data.id);
    if (!entry?.reversible) throw new Error("같은 고객의 최근 24시간 내 마지막 적립부터 취소할 수 있어요.");
    const member = memberForCode(state, transaction.member);
    const coupons = member.coupons.filter(coupon => transaction.coupons.includes(coupon.id));
    if (coupons.some(coupon => heldCouponOrder(state, member, coupon.id))) throw new Error("이 적립의 교환권이 픽업 주문에 적용 중이에요. 해당 주문을 먼저 취소해 주세요.");
    if (coupons.some(coupon => coupon.used)) throw new Error("이 적립으로 발행된 쿠폰이 사용됐어요.");
    for (const coupon of coupons) coupon.voided = now;
    member.stamps[shopId] = transaction.before;
    member.activity.unshift({ shop: shopId, time: now, qty: transaction.qty, type: "cancel" });
    transaction.cancelled = now;
    return { cancelled: true };
  }
  if (action === "orderStatus") {
    const order = entries(state.orders ?? {}, data.id);
    if (!order || order.shop !== shopId) throw new Error("이 매장의 주문을 확인해 주세요.");
    if (order.status === data.status) return { status: order.status };
    const next = { submitted: ["preparing", "cancelled"], preparing: ["ready", "cancelled"], ready: ["pickedUp", "cancelled"] };
    if (!next[order.status]?.includes(data.status)) throw new Error("주문 단계가 바뀌었어요. 주문을 다시 확인해 주세요.");
    if (data.status === "pickedUp") {
      const member = memberForCode(state, order.member);
      if (!member) throw new Error("주문의 고객을 확인해 주세요.");
      if (order.couponId) {
        const coupon = member.coupons.find(entry => entry.id === order.couponId && entry.shop === shop.id);
        if (!coupon || coupon.used || coupon.voided || heldCouponOrder(state, member, coupon.id)?.id !== order.id) throw new Error("주문에 적용한 쿠폰을 확인해 주세요.");
        if (data.purchaseConfirmed !== true) throw new Error("메뉴 제공과 매장 결제를 확인해 주세요.");
        if (coupon.kind === "campaign") redeemCampaign(state, member, shop, coupon, {
          item: coupon.item, purchaseAmount: order.subtotal, receiptNumber: data.receiptNumber,
          purchaseConfirmed: data.purchaseConfirmed, firstVisitConfirmed: data.firstVisitConfirmed,
        }, "pickup", now, order.time);
        coupon.used = now;
        coupon.savedAmount = order.discountAmount;
        member.activity.unshift({ shop: shop.id, time: now, type: "coupon", value: order.discountAmount });
      }
      const qty = order.stampQty ?? order.lines.reduce((sum, line) => sum + (shop.menu[line.item]?.[2] === "food" ? 0 : line.qty), 0);
      if (qty) grant(state, member, shop, qty, "pickup:" + order.id, "pickup", now);
      order.pickedUpAt = now;
    }
    order.status = data.status;
    return { status: order.status };
  }

  if (action === "identify") return identify(state, shop, resolveCustomer(state, data, now), now);
  if (action === "register") {
    const tag = tagOf(data.tag);
    if (memberForTag(state, tag)) throw new Error("이미 등록된 키링입니다.");
    const code = String(data.code ?? "").trim().toUpperCase();
    const match = Object.entries(state.members).find(([, member]) => member.code === code);
    if (!match) throw new Error("고객 앱의 연결 코드를 확인해 주세요.");
    const [secret, member] = match;
    if (member.tag && !member.locked) throw new Error("키링을 교체하려면 고객이 기존 키링을 분실 잠금해야 합니다.");
    if (member.tag) delete state.tags[member.tag];
    member.tag = tag;
    member.locked = false;
    state.tags[tag] = secret;
    return identify(state, shop, { member }, now);
  }

  if (action === "stamp") {
    const qty = quantity(data.qty);
    const reference = requestId(data.reference);
    const key = shopId + ":" + reference;
    const previous = state.transactions[key];
    const supplied = normalizeCode(data.tag);
    const code = supplied.startsWith("CP-") ? supplied : tagOf(data.tag);
    if (previous) {
      if (previous.tag !== code || previous.qty !== qty || previous.cancelled) throw new Error("이미 처리된 승인입니다.");
      return previous.result;
    }
    const { member, pass, source } = resolveCustomer(state, data, now);
    if (!member || (!pass && member.locked)) throw new Error("키링 또는 QR을 다시 확인해 주세요.");
    if (pass?.coupon) throw new Error("쿠폰 사용용 QR이에요. 선택한 쿠폰의 사용을 승인해 주세요.");
    const result = grant(state, member, shop, qty, key, source, now);
    state.transactions[key].tag = code;
    if (pass) pass.used = now;
    return result;
  }
  if (action === "redeem") {
    const identifier = normalizeCode(data.tag);
    const tracksRequest = Boolean(data.reference) || identifier.startsWith("CP-");
    const key = tracksRequest ? "redeem:" + shopId + ":" + requestId(data.reference) : "";
    const previous = key ? entries(state.transactions, key) : null;
    const payload = JSON.stringify([data.item, data.receiptNumber, data.purchaseAmount, data.purchaseConfirmed, data.firstVisitConfirmed]);
    if (previous?.tag === identifier && previous.coupon === data.coupon) {
      if (previous.payload && previous.payload !== payload) throw new Error("이전 승인과 같은 구매 정보를 사용해 주세요.");
      return previous.result ?? { used: true };
    }
    if (previous) throw new Error("이미 처리된 승인입니다.");
    const { member, pass, source } = resolveCustomer(state, data, now);
    if (!member || (!pass && member.locked)) throw new Error("키링 또는 QR을 다시 확인해 주세요.");
    if (pass?.coupon && pass.coupon !== data.coupon) throw new Error("고객이 QR에서 선택한 쿠폰을 사용해 주세요.");
    const coupon = member.coupons.find(entry => entry.id === data.coupon && entry.shop === shopId);
    if (!key && coupon?.used && coupon.expires > now) return { used: true };
    if (!coupon || !activeCoupon(coupon, now)) throw new Error("사용 가능한 쿠폰을 확인해 주세요.");
    if (heldCouponOrder(state, member, coupon.id)) throw new Error("픽업 주문에 적용 중인 쿠폰이에요. 주문 내역에서 처리해 주세요.");
    let result = { used: true };
    if (coupon.kind === "campaign") {
      if (!key) throw new Error("구매 확인 정보를 다시 입력해 주세요.");
      const purchase = redeemCampaign(state, member, shop, coupon, data, source, now);
      const earnedStamp = purchase.netAmount > 0 && shop.menu[coupon.item][2] !== "food";
      if (earnedStamp) grant(state, member, shop, 1, "campaign-stamp:" + key, "campaign", now);
      result = { used: true, stampEarned: earnedStamp, feeAmount: purchase.feeAmount };
    }
    coupon.used = now;
    coupon.savedAmount = coupon.discountAmount ?? shop.menu[0][1];
    member.activity.unshift({ shop: shopId, time: now, type: "coupon", value: coupon.discountAmount ?? shop.menu[0][1] });
    if (key) state.transactions[key] = { tag: identifier, coupon: data.coupon, payload, result };
    if (pass) pass.used = now;
    return result;
  }
  throw new Error("요청을 확인해 주세요.");
}

export function seedDemoHistory(state, secret) {
  const member = state.members[secret];
  if (!member || Object.values(state.orders ?? {}).some(order => order.member === member.code)) return;
  const shop = sampleShops[0];
  const id = newReference();
  state.orders ??= {};
  state.orders[id] = { id, shop: shop.id, member: member.code, name: member.name, time: Date.now() - day,
    lines: [{ item: 0, name: shop.menu[0][0], price: shop.menu[0][1], qty: 1 }], total: shop.menu[0][1],
    status: "pickedUp", note: "빨대는 빼 주세요" };
}

export function seedDemoRetention(state) {
  if (state.demoRetentionVersion) return;
  state.demoRetentionVersion = 1;
  const now = Date.now(), shop = sampleShops[0];
  for (const example of [
    { name: "시연 · 첫 커피 고객", days: [8], consent: true },
    { name: "시연 · 오랜 단골", days: [35, 22], consent: true },
    { name: "시연 · 수신 미동의", days: [9], consent: false },
  ]) {
    const account = createMember(state, example.name), member = state.members[account.token];
    member.stamps[shop.id] = example.days.length;
    setStoreConsent(member, shop.id, { enabled: example.consent }, now - day);
    for (const [index, ago] of example.days.entries()) {
      const time = now - ago * day;
      state.transactions["demo-retention:" + member.code + ":" + index] = { member: member.code, shop: shop.id, source: "nfc", time, qty: 1, before: index, coupons: [] };
      member.activity.unshift({ shop: shop.id, source: "nfc", type: "stamp", time, qty: 1 });
    }
  }
}

export function demoState() {
  const state = newState();
  seedDemoCampaigns(state, shops);
  const { token: secret } = createMember(state, "카페러버");
  const member = state.members[secret];
  member.stamps = { pando: 7, dict: 4, tiamo: 2 };
  member.tag = "TAG2026";
  state.tags[member.tag] = secret;
  const now = Date.now();
  member.coupons = [{ id: newReference(), shop: "dict", expires: now + 5 * day, used: null }];
  member.activity = [{ shop: "pando", time: now, qty: 1, type: "stamp" }];
  seedDemoHistory(state, secret);
  return { state, secret };
}
