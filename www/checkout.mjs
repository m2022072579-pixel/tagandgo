import { hasVisited } from "./campaigns.mjs";
import { campaignWindowReason } from "./retention.mjs";

const checkoutActiveStatuses = ["submitted", "preparing", "ready"];

export function heldCouponOrder(state, member, couponId) {
  if (!member) return undefined;
  return Object.values(state.orders ?? {}).find(order => order.member === member.code &&
    order.couponId === couponId && checkoutActiveStatuses.includes(order.status));
}

export function quotePickupOrder(state, member, shop, data, now = Date.now()) {
  if (!Array.isArray(data.lines) || !data.lines.length || data.lines.length > shop.menu.length) throw new Error("메뉴를 선택해 주세요.");
  const seen = new Set();
  const lines = data.lines.map(line => {
    if (!line || typeof line !== "object" || Array.isArray(line)) throw new Error("메뉴를 확인해 주세요.");
    const item = Number(line.item), qty = Number(line.qty);
    if (!Number.isInteger(item) || !shop.menu[item] || seen.has(item)) throw new Error("메뉴를 확인해 주세요.");
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new Error("음료 수량은 1~20개로 입력해 주세요.");
    if (state.soldOut[shop.id]?.[item]) throw new Error(shop.menu[item][0] + " 메뉴가 품절됐어요.");
    seen.add(item);
    return { item, name: shop.menu[item][0], price: shop.menu[item][1], qty };
  });
  if (lines.reduce((sum, line) => sum + line.qty, 0) > 20) throw new Error("주문 한 건에 최대 20개까지 담을 수 있어요.");
  const subtotal = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
  const candidates = member.coupons.filter(coupon => coupon.shop === shop.id && !coupon.used && !coupon.voided && coupon.expires > now).map(coupon => {
    const campaign = coupon.kind === "campaign";
    const item = campaign ? coupon.item : 0;
    const discountAmount = campaign ? coupon.discountAmount : shop.menu[0][1];
    const line = lines.find(entry => entry.item === item);
    let reason = "";
    if (heldCouponOrder(state, member, coupon.id)) reason = "다른 픽업 주문에 적용 중";
    else if (coupon.startsAt > now) reason = "사용 시작 전";
    else if (campaignWindowReason(coupon, now)) reason = campaignWindowReason(coupon, now);
    else if (!line) reason = (campaign ? coupon.itemName : shop.menu[0][0]) + "를 담아 주세요";
    else if (campaign && line.price !== coupon.price) reason = "대상 메뉴 가격이 바뀌었어요. 매장에 문의해 주세요";
    else if (campaign && subtotal < coupon.minPurchase) reason = "할인 전 " + coupon.minPurchase.toLocaleString("ko-KR") + "원 이상 주문 시 사용";
    else if (campaign && subtotal > 1000000) reason = "혜택 적용 주문은 할인 전 100만원까지 가능해요";
    else if (coupon.campaignType === "first" && hasVisited(state, member, shop.id)) reason = "첫 방문 구매 내역을 확인해 주세요";
    else if (coupon.campaignType === "first" && Object.values(state.orders ?? {}).some(order => order.member === member.code && order.shop === shop.id && checkoutActiveStatuses.includes(order.status))) reason = "진행 중 주문을 먼저 완료해 주세요";
    return { id: coupon.id, title: coupon.title ?? shop.reward, kind: coupon.kind ?? "reward", campaignType: coupon.campaignType,
      item, discountAmount, minPurchase: campaign ? coupon.minPurchase : 0, expires: coupon.expires, reason };
  }).sort((a, b) => Number(Boolean(a.reason)) - Number(Boolean(b.reason)) || b.discountAmount - a.discountAmount || a.expires - b.expires);
  if (data.coupon !== undefined && typeof data.coupon !== "string") throw new Error("사용할 쿠폰을 다시 선택해 주세요.");
  const selectedId = data.coupon === undefined ? candidates.find(coupon => !coupon.reason)?.id ?? "" : data.coupon;
  const selected = selectedId ? candidates.find(coupon => coupon.id === selectedId) : null;
  if (selectedId && (!selected || selected.reason)) throw new Error(selected?.reason || "사용 가능한 쿠폰을 다시 확인해 주세요.");
  const discountAmount = selected?.discountAmount ?? 0;
  const stampQty = lines.reduce((sum, line) => sum + (shop.menu[line.item][2] === "food" ? 0 : line.qty - (selected && selected.item === line.item && discountAmount >= line.price ? 1 : 0)), 0);
  return { shop: shop.id, lines, subtotal, discountAmount, total: subtotal - discountAmount, stampQty,
    coupon: selected ?? null, candidates };
}
