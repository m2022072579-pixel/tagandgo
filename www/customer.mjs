export function rankStampBooks(profile, catalog, favorites = []) {
  return catalog.map(shop => {
    const stored = Number(profile?.stamps[shop.id] ?? 0);
    const count = Number.isSafeInteger(stored) && stored >= 0 ? Math.min(stored, shop.goal) : 0;
    return { shop, count, remaining: shop.goal - count, favorite: favorites.includes(shop.id), active: count > 0 || favorites.includes(shop.id) };
  }).sort((a, b) => Number(b.active) - Number(a.active) || a.remaining - b.remaining || Number(b.favorite) - Number(a.favorite) || a.shop.name.localeCompare(b.shop.name, "ko"));
}

export function filterBenefits(campaigns, catalog, options = {}) {
  const { type = "all", eligibleOnly = false, favoritesOnly = false, favorites = [], query = "", now = Date.now() } = options;
  const normalize = value => String(value ?? "").normalize("NFKC").toLocaleLowerCase("ko").replace(/\s/g, "");
  const search = normalize(query);
  return campaigns.filter(campaign => {
    const shop = catalog.find(entry => entry.id === campaign.shop);
    if (!shop || campaign.startsAt > now || campaign.endsAt <= now) return false;
    if (type !== "all" && campaign.type !== type) return false;
    if (eligibleOnly && (campaign.reason || campaign.coupon || campaign.remaining < 1)) return false;
    if (favoritesOnly && !favorites.includes(campaign.shop)) return false;
    return !search || normalize([shop.name, shop.area, campaign.title, campaign.itemName, campaign.sponsor].join(" ")).includes(search);
  }).sort((a, b) => Number(favorites.includes(b.shop)) - Number(favorites.includes(a.shop)) || a.endsAt - b.endsAt || b.discountAmount - a.discountAmount);
}

export function selectHomeDeals(campaigns, catalog, profile, now = Date.now(), soldOut = {}) {
  const available = filterBenefits(campaigns, catalog, { now }).filter(campaign => {
    if (soldOut[campaign.shop]?.[campaign.item]) return false;
    if (!Number.isSafeInteger(campaign.price) || !Number.isSafeInteger(campaign.discountAmount) || campaign.discountAmount < 1 || campaign.discountAmount > campaign.price) return false;
    if (campaign.coupon) {
      const owned = profile?.coupons?.find(coupon => coupon.id === campaign.coupon && coupon.shop === campaign.shop);
      return owned && !owned.used && !owned.voided && !owned.reservedOrder && owned.expires > now && (!owned.startsAt || owned.startsAt <= now) &&
        (!campaign.reason || campaign.reason === "발급 완료");
    }
    return !campaign.reason && campaign.remaining > 0;
  }).sort((a, b) => {
    const priority = campaign => campaign.type === "time" ? 0 : campaign.type === "first" ? 1 : 2;
    return priority(a) - priority(b) || b.discountAmount - a.discountAmount || a.endsAt - b.endsAt;
  });
  const featured = [], seen = new Set();
  for (const campaign of available) {
    if (seen.has(campaign.shop)) continue;
    featured.push(campaign); seen.add(campaign.shop);
    if (featured.length === 3) break;
  }
  for (const campaign of available) {
    if (featured.length === 3) break;
    if (!featured.includes(campaign)) featured.push(campaign);
  }
  return featured;
}

export function quoteRepeatOrder(order, shop, soldOut = {}) {
  if (!order || order.status !== "pickedUp" || !shop || order.shop !== shop.id) throw new Error("이 매장의 완료된 주문을 선택해 주세요.");
  return quoteStoredMenuLines(order, shop, soldOut);
}

export function quoteSavedMenu(menu, shop, soldOut = {}) {
  if (!menu || !shop || menu.shop !== shop.id) throw new Error("저장한 메뉴의 매장을 확인해 주세요.");
  return quoteStoredMenuLines(menu, shop, soldOut);
}

function quoteStoredMenuLines(order, shop, soldOut) {
  const cart = {};
  const skipped = [];
  let priceChanged = false;
  for (const line of order.lines ?? []) {
    let item = Number(line.item);
    if (typeof line.name !== "string" || shop.menu[item]?.[0] !== line.name) {
      const matches = shop.menu.map((menu, index) => menu[0] === line.name ? index : -1).filter(index => index >= 0);
      item = matches.length === 1 ? matches[0] : -1;
    }
    if (item < 0 || !shop.menu[item] || soldOut[item]) { skipped.push(line.name || "현재 없는 메뉴"); continue; }
    const qty = Number(line.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new Error("주문 수량을 확인해 주세요.");
    cart[item] = (cart[item] ?? 0) + qty;
    if (line.price !== undefined && Number(line.price) !== shop.menu[item][1]) priceChanged = true;
  }
  const count = Object.values(cart).reduce((sum, qty) => sum + qty, 0);
  if (!count) throw new Error("이전 메뉴가 품절이거나 변경됐어요. 매장 메뉴에서 다시 선택해 주세요.");
  if (count > 20) throw new Error("한 번에 20개까지 담을 수 있어요.");
  const lines = Object.entries(cart).map(([item, qty]) => ({ item: Number(item), name: shop.menu[item][0], price: shop.menu[item][1], qty }));
  return { cart, lines, skipped, priceChanged, total: lines.reduce((sum, line) => sum + line.price * line.qty, 0) };
}
