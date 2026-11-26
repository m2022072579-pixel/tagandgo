import { shops, setShopCatalog, resetShopCatalog, memberAction, posAction, newReference, demoState, seedDemoHistory, seedDemoRetention } from "./core.mjs";
import { shell, cafeResults, dialogContent, usableCoupons, orderLabels, icon } from "./views.mjs";
import { seedDemoCampaigns } from "./campaigns.mjs";
import { quoteRepeatOrder, quoteSavedMenu } from "./customer.mjs";
import { quotePickupOrder } from "./checkout.mjs";

const root = document.querySelector("#app");
const notices = document.querySelector("#notice");
const dialog = document.querySelector("#sheet");
const native = window.TagGoAndroid;
const launch = new URLSearchParams(location.search);
const desktopPos = location.pathname === "/pos" || location.pathname.startsWith("/pos/") || launch.get("pos") === "1";
const storage = {
  read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  },
  write(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
};
const demo = storage.read("taggo-demo-v1", null) ?? demoState();
seedDemoCampaigns(demo.state, shops);
seedDemoHistory(demo.state, demo.secret);
seedDemoRetention(demo.state);
storage.write("taggo-demo-v1", demo);
const initialServer = native ? storage.read("taggo-server-v1", "") : location.origin;
const state = {
  native, server: initialServer, memberToken: storage.read("taggo-member-v1:" + initialServer, ""),
  page: desktopPos ? "pos" : "home", profile: initialServer ? null : memberAction(demo.state, demo.secret, "profile", {}),
  catalog: initialServer ? {} : demo.state.soldOut, staff: null, overview: {}, selectedTag: "", found: null,
  posNote: "", receipt: null, issued: null, pass: null, dialog: null, recoveryKey: "",
  query: "", cafeFilter: "all", mapMode: false, couponTab: "active", historyFilter: "",
  favorites: storage.read("coffee-favorites", []), reminder: storage.read("coffee-reminder", 7),
  shop: "", cart: {}, orderReference: "", issueReference: newReference(),
  campaigns: [], managedCampaigns: [], benefitFilter: "all", campaignDraft: null,
  campaignType: "first", campaignFormValues: null, campaignReference: "",
  cafesView: "shops", benefitEligible: true, benefitFavorites: false, walletShop: "", walletKind: "all",
  orderNotes: {}, repeatQuote: null,
  featuredDeal: "",
  features: initialServer ? [] : ["pickup-coupons-v1", "saved-menus-v1", "retention-v1"], orderQuote: null, orderCoupons: {}, savedMenuSource: null,
  retentionSegment: "second",
};
let busy = false;
let polling = false;
let changes = 0;
let messageTimer;
let stampTimer;
let lastStamp = stampKey(state.profile);
let counterFocusRequested = false;
let stampFocusRequested = false;
let bridgeId = 0;
const requests = new Map();

const hangulToQwerty = {
  "ㅂ": "Q", "ㅃ": "Q", "ㅈ": "W", "ㅉ": "W", "ㄷ": "E", "ㄸ": "E", "ㄱ": "R", "ㄲ": "R", "ㅅ": "T", "ㅆ": "T",
  "ㅛ": "Y", "ㅕ": "U", "ㅑ": "I", "ㅐ": "O", "ㅒ": "O", "ㅔ": "P", "ㅖ": "P",
  "ㅁ": "A", "ㄴ": "S", "ㅇ": "D", "ㄹ": "F", "ㅎ": "G", "ㅗ": "H", "ㅓ": "J", "ㅏ": "K", "ㅣ": "L",
  "ㅋ": "Z", "ㅌ": "X", "ㅊ": "C", "ㅍ": "V", "ㅠ": "B", "ㅜ": "N", "ㅡ": "M",
};
function normalizeReaderInput(raw) {
  return String(raw ?? "").split("").map(ch => hangulToQwerty[ch] ?? ch).join("").trim().toUpperCase();
}

window.tagGoReply = (id, status, body) => {
  const request = requests.get(id);
  if (!request) return;
  requests.delete(id);
  clearTimeout(request.timer);
  if (status >= 200 && status < 300) request.resolve(body);
  else request.reject(Object.assign(new Error(body.error || "서버에 연결하지 못했어요."), { status }));
};

function notice(message) {
  notices.textContent = message;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => { notices.textContent = ""; }, 4500);
}

function stampKey(profile) {
  const stamp = profile?.activity.find(entry => entry.type === "stamp");
  return stamp ? JSON.stringify([profile.code, stamp.time, stamp.shop, stamp.qty, stamp.source]) : "";
}

function stampFeedback(qty) {
  const feedback = document.querySelector("#stamp-feedback");
  feedback.innerHTML = '<span class="stamp-feedback-icon is-stamping" aria-hidden="true">' + icon("mark") + '</span><strong>스탬프 적립 완료</strong><p></p>';
  feedback.querySelector("p").textContent = "스탬프 " + qty + "개를 모았어요.";
  feedback.hidden = false;
  clearTimeout(stampTimer);
  stampTimer = setTimeout(() => { feedback.hidden = true; }, 2200);
  try {
    if (native?.stampFeedback) native.stampFeedback();
    else navigator.vibrate?.(35);
  } catch {
  }
}

function updateProfile(profile) {
  const nextStamp = stampKey(profile);
  const sameMember = state.profile?.code === profile?.code;
  const received = sameMember && nextStamp && nextStamp !== lastStamp;
  const couponUsed = sameMember && profile?.coupons.some(coupon => coupon.used &&
    !state.profile?.coupons.some(previous => previous.id === coupon.id && previous.used));
  state.profile = profile;
  lastStamp = nextStamp;
  if (state.dialog?.kind === "pass" && (received || couponUsed)) closeDialog();
  if (couponUsed && state.page !== "pos") notice("쿠폰을 사용했어요.");
  if (received && state.page !== "pos") {
    stampFeedback(profile.activity.find(entry => entry.type === "stamp").qty);
  }
}

async function api(path, body, secret = "", address = state.server) {
  if (native) return new Promise((resolve, reject) => {
    const id = ++bridgeId;
    const timer = setTimeout(() => {
      requests.delete(id);
      reject(new Error("서버 응답이 지연됐어요. 연결을 확인하고 다시 시도해 주세요."));
    }, 11000);
    requests.set(id, { resolve, reject, timer });
    try { native.request(id, address, path, JSON.stringify(body), secret); }
    catch (error) { requests.delete(id); clearTimeout(timer); reject(error); }
  });
  try {
    const response = await fetch(address + path, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + secret },
      body: JSON.stringify(body), signal: AbortSignal.timeout(7000),
    });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status });
    return result;
  } catch (error) {
    if (error.status) throw error;
    throw new Error("서버에 연결하지 못했어요. 주소와 연결 상태를 확인해 주세요.");
  }
}

const memberRequest = async (action, data = {}) => {
  if (state.server) return api("/api/member", { action, ...data }, state.memberToken);
  const result = memberAction(demo.state, demo.secret, action, data);
  if (!["profile", "quoteOrder"].includes(action)) storage.write("taggo-demo-v1", demo);
  return result;
};

async function submitPickupOrder(data) {
  try { return await memberRequest("order", data); }
  catch (error) {
    if ((error.status && error.status < 500) || !state.server) throw error;
    const profile = await memberRequest("profile").catch(() => null);
    if (profile?.orders.some(order => order.id === data.reference && order.shop === data.shop)) return profile;
    throw error;
  }
}

const cartLines = () => Object.entries(state.cart[state.shop] ?? {}).map(([item, qty]) => ({ item: Number(item), qty }));

async function prepareOrderQuote(coupon = state.orderCoupons[state.shop]) {
  const data = { shop: state.shop, lines: cartLines(), ...(coupon === undefined ? {} : { coupon }) };
  if (!state.features.includes("pickup-coupons-v1")) {
    state.orderQuote = quotePickupOrder({ soldOut: state.catalog }, { ...state.profile, coupons: [] }, shops.find(shop => shop.id === state.shop), { ...data, coupon: "" });
    return;
  }
  try { state.orderQuote = await memberRequest("quoteOrder", data); }
  catch (error) {
    if (!coupon || (error.status && error.status !== 400)) throw error;
    state.orderQuote = await memberRequest("quoteOrder", { ...data, coupon: "" });
    state.orderCoupons[state.shop] = "";
    notice("쿠폰 조건이 바뀌어 적용을 해제했어요. 금액과 다른 쿠폰을 확인해 주세요.");
  }
}

const posRequest = async (action, data = {}) => {
  if (state.server) return api("/api/counter", { action, ...data }, state.staff.token);
  const result = posAction(demo.state, state.staff.shop, action, data);
  if (!["overview", "identify"].includes(action)) storage.write("taggo-demo-v1", demo);
  return result;
};

function setMember(result) {
  state.memberToken = result.token;
  state.profile = result.profile;
  lastStamp = stampKey(result.profile);
  storage.write("taggo-member-v1:" + state.server, state.memberToken);
}

async function refreshMember() {
  if (state.server && !state.memberToken) return;
  try { updateProfile(await memberRequest("profile")); }
  catch (error) {
    if (error.status !== 401) throw error;
    setMember({ token: "", profile: null });
    notice("계정 연결이 만료됐어요. 복구 키로 다시 로그인할 수 있어요.");
  }
}

async function refresh() {
  const work = [refreshMember()];
  if (state.server) work.push(api("/api/catalog", {}).then(result => {
    if (result.shops) setShopCatalog(result.shops);
    else resetShopCatalog();
    state.catalog = result.soldOut;
    state.campaigns = result.campaigns ?? [];
    state.features = result.features ?? [];
  }));
  else { state.catalog = demo.state.soldOut; state.features = ["pickup-coupons-v1", "saved-menus-v1", "retention-v1"]; }
  if (state.page === "pos" && state.staff) {
    work.push(posRequest("overview").then(result => { state.overview = result; state.managedCampaigns = result.campaigns ?? []; }));
  }
  await Promise.all(work);
}

async function afterCounterAction() {
  try { await refresh(); }
  catch { notice("처리 결과가 저장됐어요. 화면을 새로고침해 주세요."); }
}

async function redeemSelected(data = {}) {
  const result = await posRequest("redeem", {
    tag: state.selectedTag, coupon: state.dialog.id, reference: state.receipt.redemption, ...data,
  });
  closeDialog();
  clearScan();
  state.posNote = "쿠폰 사용을 완료했어요." + (result.stampEarned ? " 음료 1잔이 자동 적립됐어요." : "");
  await afterCounterAction();
  if (result.stampEarned) stampFeedback(1);
}

async function showPass(coupon = "") {
  if (!state.profile) { await navigate("home"); return; }
  const result = await memberRequest("pass", coupon ? { coupon } : {});
  state.pass = { ...result, requestedCoupon: coupon };
  openDialog("pass");
}

function selectCouponForRedemption(id) {
  if (!state.receipt || !state.found?.coupons.some(coupon => coupon.id === id)) throw new Error("고객과 쿠폰을 다시 조회해 주세요.");
  if (state.receipt.coupon !== id) {
    state.receipt.coupon = id;
    state.receipt.redemption = newReference();
  }
  openDialog("redeem", id);
}

function clearScan() {
  state.selectedTag = "";
  state.found = null;
  state.receipt = null;
  state.posNote = "";
}

function openDialog(kind, id = "") {
  state.dialog = { kind, id };
}

function closeDialog() {
  state.dialog = null;
  state.recoveryKey = "";
}

function updateTimer() {
  const timer = dialog.querySelector("#qr-timer");
  if (!timer || !state.pass) return;
  const seconds = Math.max(0, Math.ceil((state.pass.expires - Date.now()) / 1000));
  if (!seconds) {
    renderDialog();
    return;
  }
  timer.textContent = Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}

function drawQR() {
  const canvas = dialog.querySelector("#pass-qr");
  if (!canvas) return;
  const code = window.qrcode(0, "M");
  code.addData(state.pass.code);
  code.make();
  const cells = code.getModuleCount();
  const dimension = canvas.width;
  const scale = Math.floor(dimension / (cells + 8));
  const offset = Math.floor((dimension - cells * scale) / 2);
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, dimension, dimension);
  context.fillStyle = "#171412";
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      if (code.isDark(y, x)) context.fillRect(offset + x * scale, offset + y * scale, scale, scale);
    }
  }
  updateTimer();
}

function renderDialog() {
  if (!state.dialog) {
    if (dialog.open) dialog.close();
    return;
  }
  const [title, content] = dialogContent(state);
  dialog.querySelector("#sheet-title").textContent = title;
  dialog.querySelector("#sheet-body").innerHTML = content;
  dialog.querySelector("#sheet-error").textContent = "";
  if (!dialog.open) dialog.showModal();
  drawQR();
  updateCampaignEstimate();
}

function updateCampaignEstimate() {
  const form = dialog.querySelector('[data-form="campaign"]');
  if (!form) return;
  const data = Object.fromEntries(new FormData(form)), original = state.campaignDraft;
  const output = form.querySelector('#campaign-estimate');
  const rawCost = data.variableCost ?? original?.variableCost;
  if (rawCost === '' || rawCost === undefined || rawCost === null) { output.textContent = '변동비를 입력하면 등록 전 잔당 금액을 확인할 수 있어요.'; return; }
  const kind = data.type ?? original?.type;
  const price = shops.find(shop => shop.id === state.staff.shop).menu[Number(data.item ?? original?.item ?? 0)][1];
  const discount = Number(data.discountAmount ?? original?.discountAmount ?? 0);
  const fee = kind === 'return' ? 0 : data.fee === undefined ? original?.fee ?? 0 : kind === 'time' ? Math.floor((price - discount) * Number(data.fee) / 100) : Number(data.fee);
  const amount = price - (kind === 'sponsor' ? 0 : discount) - Number(rawCost) - fee;
  const minimum = Number(data.minContribution ?? original?.minContribution ?? 0);
  output.textContent = '대상 메뉴 잔당 공헌이익 추정 ' + amount.toLocaleString('ko-KR') + '원' + (amount < minimum ? ' · 최소 금액 미달: 할인·비용을 조정하세요.' : '') + ' · 고정비·세금 등 미반영' + (kind === 'sponsor' ? ' · 지원금 수령 가정' : '');
}

function render() {
  const focus = document.activeElement;
  const focusId = root.contains(focus) ? focus.id : "";
  const serverDetailsOpen = state.page === "account" && root.querySelector("details.settings")?.open;
  const retentionDetailsOpen = state.page === "pos" && root.querySelector(".retention-details")?.open;
  root.innerHTML = shell(state);
  if (!desktopPos) {
    root.querySelectorAll('[data-action="navigate"][data-page="pos"]').forEach(el => el.remove());
  } else {
    root.querySelectorAll('[data-action="navigate"]:not([data-page="pos"])').forEach(el => el.remove());
  }
  if (serverDetailsOpen && state.page === "account") root.querySelector("details.settings").open = true;
  if (retentionDetailsOpen && state.page === "pos") root.querySelector(".retention-details").open = true;
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  renderDialog();
  if (stampFocusRequested) {
    stampFocusRequested = false;
    const stampBtn = document.querySelector("#pos-stamp-submit");
    if (stampBtn) {
      stampBtn.focus();
      stampBtn.scrollIntoView({ block: "center", behavior: "smooth" });
    } else {
      document.querySelector('[data-form="register"] input')?.focus();
    }
  } else if (counterFocusRequested) {
    counterFocusRequested = false;
    document.querySelector('[data-form="tag"] input')?.focus();
    document.querySelector('[data-form="tag"]')?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

async function run(task) {
  if (busy) return;
  busy = true;
  root.setAttribute("aria-busy", "true");
  changes++;
  try { await task(); render(); }
  catch (error) {
    if (error.status === 401 && state.page === "pos") {
      state.staff = null;
      clearScan();
      closeDialog();
      render();
    }
    if (dialog.open) dialog.querySelector("#sheet-error").textContent = error.message;
    else notice(error.message);
  } finally { busy = false; root.removeAttribute("aria-busy"); }
}

async function navigate(page) {
  if (desktopPos && page !== "pos") page = "pos";
  if (!desktopPos && page === "pos") {
    notice("점주용 POS는 전용 주소(/pos)에서 접속해 주세요.");
    return;
  }
  state.page = page;
  closeDialog();
  window.scrollTo(0, 0);
  try { await refresh(); }
  catch (error) {
    if (error.status === 401 && page === "pos") { state.staff = null; clearScan(); }
    notice(error.message);
  }
}

async function scan(value) {
  const normalized = normalizeReaderInput(value);
  clearScan();
  try {
    state.found = await posRequest("identify", { tag: normalized });
    state.selectedTag = normalized;
    state.receipt = { reference: newReference(), qty: null };
    stampFocusRequested = true;
    if (state.found.selectedCoupon) selectCouponForRedemption(state.found.selectedCoupon);
  } catch (error) {
    render();
    throw error;
  }
}

async function connect(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("서버의 기본 주소를 입력해 주세요.");
  }
  if (!native && url.origin !== location.origin) throw new Error("PC에서는 서버 주소를 브라우저에서 직접 열어 주세요.");
  const result = await api("/api/catalog", {}, "", url.origin);
  if (result.shops) setShopCatalog(result.shops);
  else resetShopCatalog();
  if (state.server !== url.origin) {
    state.memberToken = storage.read("taggo-member-v1:" + url.origin, "");
    state.profile = null;
    state.staff = null;
    state.cart = {};
    state.orderNotes = {};
    state.orderCoupons = {};
    state.orderQuote = null;
    state.walletShop = "";
  }
  state.server = url.origin;
  state.catalog = result.soldOut;
  state.features = result.features ?? [];
  storage.write("taggo-server-v1", state.server);
  await navigate(desktopPos ? "pos" : "home");
  notice("테스트 서버에 연결했어요.");
}

document.addEventListener("submit", event => {
  const form = event.target;
  const action = form.dataset.form;
  if (!action) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  run(async () => {
    switch (action) {
      case "join":
        setMember(await api("/api/join", data));
        notice("스탬프북을 만들었어요.");
        break;
      case "retention-trial":
        await posRequest("retentionTrial", { accepted: data.accepted === "on" });
        closeDialog();
        await refresh();
        notice("30일 무료 파일럿을 시작했어요. 자동 결제는 없어요.");
        break;
      case "restore":
        if (!state.server) throw new Error("마이에서 원래 사용하던 서버에 연결해 주세요.");
        setMember(await api("/api/recover", data));
        await navigate("home");
        notice("스탬프북을 복구했어요.");
        break;
      case "server":
        await connect(data.url);
        break;
      case "pos":
        state.staff = state.server ? await api("/api/pos", data) : { shop: data.shop };
        clearScan();
        state.issued = null;
        state.overview = await posRequest("overview");
        state.managedCampaigns = state.overview.campaigns ?? [];
        break;
      case "tag":
        await scan(data.tag);
        break;
      case "register":
        state.found = await posRequest("register", { tag: state.selectedTag, code: data.code });
        state.posNote = "키링을 등록했어요.";
        stampFocusRequested = true;
        break;
      case "stamp": {
        const qty = Number(data.qty);
        if (state.receipt.qty !== null && state.receipt.qty !== qty) throw new Error("이전 승인 요청과 같은 수량으로 다시 시도해 주세요.");
        state.receipt.qty = qty;
        const result = await posRequest("stamp", { tag: state.selectedTag, ...state.receipt });
        clearScan();
        state.posNote = "스탬프 " + qty + "개 적립 완료" + (result.earned ? " · 쿠폰 " + result.earned + "장 발급" : "");
        await afterCounterAction();
        stampFeedback(qty);
        break;
      }
      case "issue":
        state.issued = await posRequest("issueReceipt", { qty: data.qty, reference: state.issueReference });
        state.issueReference = newReference();
        break;
      case "claim":
        updateProfile(await memberRequest("claim", data));
        closeDialog();
        notice("사후 적립이 완료됐어요.");
        break;
      case "claim-campaign":
        updateProfile(await memberRequest("claimCampaign", { id: state.dialog.id, code: data.code }));
        closeDialog();
        notice("쿠폰함에 혜택을 담았어요.");
        break;
      case "save-menu":
        updateProfile(await memberRequest("saveMenu", { ...state.savedMenuSource, title: data.title }));
        closeDialog();
        notice("나의 메뉴에 저장했어요.");
        break;
      case "complete-pickup":
        await posRequest("orderStatus", { id: state.dialog.id, status: "pickedUp", receiptNumber: data.receiptNumber,
          purchaseConfirmed: data.purchaseConfirmed === "on", firstVisitConfirmed: data.firstVisitConfirmed === "on" });
        closeDialog();
        notice("쿠폰 사용과 결제·픽업 확인을 완료했어요.");
        await afterCounterAction();
        break;
      case "redeem-campaign": {
        const coupon = state.found.coupons.find(entry => entry.id === state.dialog.id);
        await redeemSelected({ ...data, item: coupon.item, purchaseAmount: Number(data.purchaseAmount), purchaseConfirmed: data.purchaseConfirmed === "on", firstVisitConfirmed: data.firstVisitConfirmed === "on" });
        break;
      }
      case "campaign": {
        const previous = state.campaignDraft;
        const type = data.type ?? previous?.type;
        const dateValue = (value, original) => {
          if (!value) return original;
          const timestamp = new Date(value).getTime();
          return original && Math.floor(original / 60000) * 60000 === timestamp ? original : timestamp;
        };
        const payload = { ...previous, ...data, reference: state.campaignReference, type,
          item: Number(data.item ?? previous?.item), startsAt: dateValue(data.startsAt, previous?.startsAt),
          endsAt: dateValue(data.endsAt, previous?.endsAt), discountAmount: Number(data.discountAmount ?? previous?.discountAmount),
          minPurchase: Number(data.minPurchase ?? previous?.minPurchase), quantity: Number(data.quantity), budget: Number(data.budget),
          fee: type === "return" ? 0 : data.fee === undefined ? previous?.fee ?? 0 : Math.round(Number(data.fee) * (type === "time" ? 100 : 1)),
          segment: data.segment ?? previous?.segment ?? state.retentionSegment,
          weekdays: data.weekdays === undefined ? previous?.weekdays ?? [] : data.weekdays === "weekdays" ? [1, 2, 3, 4, 5] : data.weekdays === "weekend" ? [0, 6] : [],
          dailyStart: data.dailyStart === undefined ? previous?.dailyStart ?? null : data.dailyStart ? Number(data.dailyStart.slice(0, 2)) * 60 + Number(data.dailyStart.slice(3)) : null,
          dailyEnd: data.dailyEnd === undefined ? previous?.dailyEnd ?? null : data.dailyEnd ? Number(data.dailyEnd.slice(0, 2)) * 60 + Number(data.dailyEnd.slice(3)) : null,
          dailyLimit: Number(data.dailyLimit ?? previous?.dailyLimit ?? 0),
          variableCost: data.variableCost === undefined ? previous?.variableCost ?? null : data.variableCost === "" ? null : Number(data.variableCost),
          minContribution: Number(data.minContribution ?? previous?.minContribution ?? 0),
        };
        await posRequest(previous ? "campaignEdit" : "campaignCreate", payload);
        closeDialog();
        await refresh();
        notice(previous ? "캠페인을 수정했어요." : "캠페인을 등록했어요.");
        break;
      }
    }
  });
});

document.addEventListener("click", event => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const { action, page, id, value, item, change } = target.dataset;
  run(async () => {
    switch (action) {
      case "navigate":
        await navigate(page);
        break;
      case "dialog":
        if (["claim", "order"].includes(target.dataset.dialog) && !state.profile) { await navigate("home"); break; }
        if (target.dataset.dialog === "order") { state.orderReference ||= newReference(); await prepareOrderQuote(); }
        openDialog(target.dataset.dialog);
        break;
      case "close-dialog": closeDialog(); break;
      case "show-pass":
        await showPass(target.dataset.coupon || "");
        break;
      case "use-coupon":
        if (usableCoupons(state.profile).some(coupon => coupon.id === id)) await showPass(id);
        else notice("사용 가능 기간이 지났어요.");
        break;
      case "coupon-tab": state.couponTab = value; break;
      case "stamp-wallet":
        state.couponTab = "stamps";
        state.walletShop = "";
        await navigate("coupons");
        break;
      case "shop-wallet":
        state.couponTab = "active";
        state.walletShop = id;
        state.walletKind = "all";
        await navigate("coupons");
        break;
      case "reset-wallet": state.walletShop = ""; state.walletKind = "all"; break;
      case "all-benefits":
        state.cafesView = "benefits";
        state.query = "";
        state.benefitFilter = "all";
        state.benefitEligible = true;
        state.benefitFavorites = false;
        await navigate("cafes");
        break;
      case "cafes-view": state.cafesView = value; state.query = ""; break;
      case "cafe-filter": state.cafeFilter = value; break;
      case "map": state.mapMode = !state.mapMode; break;
      case "favorite":
        state.favorites = state.favorites.includes(id) ? state.favorites.filter(shop => shop !== id) : [...state.favorites, id];
        storage.write("coffee-favorites", state.favorites);
        break;
      case "benefit-filter": state.benefitFilter = value; break;
      case "featured-deal": state.featuredDeal = id; break;
      case "claim-campaign":
        if (!state.profile) { await navigate("home"); notice("닉네임으로 시작한 뒤 혜택을 받아보세요."); break; }
        openDialog("claim-campaign", id);
        break;
      case "new-campaign":
        state.campaignDraft = null;
        state.campaignFormValues = null;
        state.campaignType = "first";
        state.campaignReference = newReference();
        openDialog("campaign");
        break;
      case "retention-campaign":
        state.retentionSegment = value;
        state.campaignDraft = null;
        state.campaignFormValues = { type: "return", segment: value, fee: 0, title: "다시 만나는 커피, 500원 할인", discountAmount: 500 };
        state.campaignType = "return";
        state.campaignReference = newReference();
        openDialog("campaign");
        break;
      case "store-consent":
        updateProfile(await memberRequest("storeConsent", { shop: id, enabled: value === "true" }));
        notice(value === "true" ? "이 카페의 앱 내 혜택을 받아요." : "이 카페의 앱 내 혜택 수신을 중단했어요.");
        break;
      case "counter-focus":
        counterFocusRequested = true;
        break;
      case "edit-campaign":
        state.campaignDraft = state.managedCampaigns.find(campaign => campaign.id === id);
        state.campaignFormValues = null;
        openDialog("campaign");
        break;
      case "end-campaign": openDialog("end-campaign", id); break;
      case "confirm-end-campaign": {
        const campaign = state.managedCampaigns.find(campaign => campaign.id === state.dialog.id);
        await posRequest("campaignEnd", { id: campaign.id, version: campaign.version });
        closeDialog();
        await refresh();
        notice("새 쿠폰 발급을 종료했어요.");
        break;
      }
      case "shop":
        state.shop = id;
        state.orderReference = "";
        await navigate("shop");
        break;
      case "quantity": {
        const cart = state.cart[state.shop] ??= {};
        const count = Object.values(cart).reduce((sum, qty) => sum + qty, 0);
        if (Number(change) > 0 && count >= 20) throw new Error("주문 한 건에 최대 20개까지 담을 수 있어요.");
        const qty = (cart[item] ?? 0) + Number(change);
        if (qty > 0) cart[item] = qty;
        else delete cart[item];
        state.orderReference = "";
        delete state.orderCoupons[state.shop];
        break;
      }
      case "place-order": {
        const lines = cartLines();
        try { state.profile = await submitPickupOrder({ shop: state.shop, lines, reference: state.orderReference, note: state.orderNotes[state.shop] ?? "",
          ...(state.features.includes("pickup-coupons-v1") ? { coupon: state.orderQuote?.coupon?.id ?? "", expectedTotal: state.orderQuote.total } : {}) }); }
        catch (error) {
          if (error.message.includes("금액이나 쿠폰 조건")) { await refresh(); await prepareOrderQuote(""); render(); }
          if (error.message.includes("품절")) {
            await refresh();
            for (const { item: soldItem } of lines) {
              if (state.catalog[state.shop]?.[soldItem]) delete state.cart[state.shop][soldItem];
            }
            state.orderReference = "";
            closeDialog();
            render();
          }
          throw error;
        }
        delete state.cart[state.shop];
        delete state.orderNotes[state.shop];
        delete state.orderCoupons[state.shop];
        state.orderQuote = null;
        state.orderReference = "";
        await navigate("orders");
        notice("픽업 요청을 보냈어요.");
        break;
      }
      case "repeat-order": {
        await refresh();
        const order = state.profile?.orders.find(entry => entry.id === id);
        const shop = shops.find(entry => entry.id === order?.shop);
        state.repeatQuote = { ...quoteRepeatOrder(order, shop, state.catalog[shop?.id] ?? {}), order: id, shop: shop.id, note: order.note ?? "" };
        openDialog("repeat-order");
        break;
      }
      case "save-cart":
        state.savedMenuSource = { shop: state.shop, lines: cartLines(), note: state.orderNotes[state.shop] ?? "" };
        openDialog("save-menu");
        break;
      case "save-order":
        state.savedMenuSource = { order: id };
        openDialog("save-menu");
        break;
      case "load-saved-menu": {
        await refresh();
        const menu = state.profile?.savedMenus?.find(entry => entry.id === id);
        const shop = shops.find(entry => entry.id === menu?.shop);
        state.repeatQuote = { ...quoteSavedMenu(menu, shop, state.catalog[shop?.id] ?? {}), saved: id, shop: shop.id, note: menu.note ?? "" };
        openDialog("repeat-order");
        break;
      }
      case "confirm-delete-menu": openDialog("delete-menu", id); break;
      case "delete-menu":
        updateProfile(await memberRequest("deleteSavedMenu", { id: state.dialog.id }));
        closeDialog();
        notice("나의 메뉴에서 삭제했어요.");
        break;
      case "confirm-repeat-order": {
        const previous = state.repeatQuote;
        await refresh();
        const order = state.profile?.orders.find(entry => entry.id === previous.order);
        const shop = shops.find(entry => entry.id === previous.shop);
        const next = previous.saved
          ? quoteSavedMenu(state.profile?.savedMenus?.find(menu => menu.id === previous.saved), shop, state.catalog[shop?.id] ?? {})
          : quoteRepeatOrder(order, shop, state.catalog[shop?.id] ?? {});
        if (JSON.stringify(next) !== JSON.stringify({ cart: previous.cart, lines: previous.lines, skipped: previous.skipped, priceChanged: previous.priceChanged, total: previous.total })) {
          state.repeatQuote = { ...previous, ...next };
          notice("가격이나 품절 상태가 바뀌었어요. 구성을 다시 확인해 주세요.");
          break;
        }
        state.cart[shop.id] = next.cart;
        state.orderNotes[shop.id] = previous.note;
        state.shop = shop.id;
        state.orderReference = "";
        delete state.orderCoupons[shop.id];
        state.repeatQuote = null;
        await navigate("shop");
        notice("이전 메뉴를 담았어요. 수량을 확인하고 픽업을 요청하세요.");
        break;
      }
      case "confirm-cancel-order": openDialog("cancel-order", id); break;
      case "cancel-order":
        state.profile = await memberRequest("cancelOrder", { id: state.dialog.id });
        closeDialog();
        notice("픽업 요청을 취소했어요.");
        break;
      case "refresh": await refresh(); break;
      case "lock":
        state.profile = await memberRequest("lock", { locked: !state.profile.locked });
        closeDialog();
        notice(state.profile.locked ? "키링을 잠갔어요." : "키링 잠금을 해제했어요.");
        break;
      case "recover-key": {
        const result = await memberRequest("recovery");
        state.profile = result.profile;
        state.recoveryKey = result.key.match(/.{1,8}/g).join("-");
        break;
      }
      case "demo":
        resetShopCatalog();
        state.server = "";
        state.memberToken = "";
        state.staff = null;
        state.cart = {};
        state.orderNotes = {};
        state.orderCoupons = {};
        state.orderQuote = null;
        state.walletShop = "";
        storage.write("taggo-server-v1", "");
        await navigate("home");
        break;
      case "logout": state.staff = null; clearScan(); break;
      case "clear-scan": clearScan(); break;
      case "sample": await scan("TAG2026"); break;
      case "native-scan": notice(native.startScan()); break;
      case "confirm-redeem":
        selectCouponForRedemption(id);
        break;
      case "redeem":
        await redeemSelected();
        break;
      case "confirm-reverse": openDialog("reverse", id); break;
      case "reverse":
        await posRequest("reverse", { id: state.dialog.id });
        closeDialog();
        clearScan();
        state.posNote = "적립을 취소했어요.";
        await afterCounterAction();
        break;
      case "order-step":
        if (value === "pickedUp" && state.overview.orders.find(order => order.id === id)?.couponId) { openDialog("complete-pickup", id); break; }
        await posRequest("orderStatus", { id, status: value });
        notice(orderLabels[value] + " 상태로 변경했어요.");
        await afterCounterAction();
        break;
      case "availability": {
        const result = await posRequest("availability", { item: Number(item), soldOut: !state.catalog[state.staff.shop]?.[item] });
        state.catalog[state.staff.shop] = result.soldOut;
        if (result.soldOut[item]) delete state.cart[state.staff.shop]?.[item];
        break;
      }
    }
  });
});

root.addEventListener("input", event => {
  if (event.target.id === "cafe-query") {
    state.query = event.target.value;
    root.querySelector("#cafe-results").innerHTML = cafeResults(state);
  }
  if (event.target.name === "tag") {
    event.target.value = normalizeReaderInput(event.target.value);
  }
});
root.addEventListener("change", event => {
  if (event.target.id === "wallet-shop") { state.walletShop = event.target.value; render(); }
  if (event.target.id === "wallet-kind") { state.walletKind = event.target.value; render(); }
  if (event.target.id === "benefit-eligible") { state.benefitEligible = event.target.checked; render(); }
  if (event.target.id === "benefit-favorites") { state.benefitFavorites = event.target.checked; render(); }
  if (event.target.id === "history-filter") { state.historyFilter = event.target.value; render(); }
  if (event.target.id === "reminder") {
    state.reminder = Number(event.target.value);
    storage.write("coffee-reminder", state.reminder);
    render();
  }
});

dialog.addEventListener("input", event => {
  if (event.target.id === "order-note") state.orderNotes[state.shop] = event.target.value;
  if (event.target.closest('[data-form="campaign"]')) updateCampaignEstimate();
});

dialog.addEventListener("change", event => {
  if (event.target.id === "order-coupon") {
    const coupon = event.target.value;
    state.orderCoupons[state.shop] = coupon;
    run(async () => { await prepareOrderQuote(coupon); });
    return;
  }
  if (event.target.id !== "campaign-type") return;
  const data = Object.fromEntries(new FormData(event.target.form));
  state.campaignType = data.type;
  state.campaignFormValues = { ...data, item: Number(data.item), startsAt: new Date(data.startsAt).getTime(),
    endsAt: new Date(data.endsAt).getTime(), fee: data.type === "time" ? 700 : data.type === "sponsor" ? 300 : data.type === "return" ? 0 : 500,
    weekdays: data.weekdays === "weekdays" ? [1, 2, 3, 4, 5] : data.weekdays === "weekend" ? [0, 6] : [],
    dailyStart: data.dailyStart ? Number(data.dailyStart.slice(0, 2)) * 60 + Number(data.dailyStart.slice(3)) : null,
    dailyEnd: data.dailyEnd ? Number(data.dailyEnd.slice(0, 2)) * 60 + Number(data.dailyEnd.slice(3)) : null };
  renderDialog();
});

dialog.addEventListener("cancel", event => {
  event.preventDefault();
  closeDialog();
  renderDialog();
});

window.tagGoRead = value => {
  if (state.page === "pos" && state.staff && !state.dialog) run(() => scan(value));
};
let buffer = "";
let lastKey = 0;
function keyCharFromCode(event) {
  if (event.code?.startsWith("Key") && event.code.length === 4) return event.code.slice(3);
  if (event.code?.startsWith("Digit") && event.code.length === 6) return event.code.slice(5);
  if (event.code?.startsWith("Numpad") && event.code.length === 7 && /\d/.test(event.code[6])) return event.code[6];
  if (event.code === "Minus" || event.code === "NumpadSubtract") return "-";
  if (event.code === "Semicolon" && event.shiftKey) return ":";
  if (event.code === "Space") return " ";
  const mapped = normalizeReaderInput(event.key);
  return /^[A-Z0-9 :\-]$/.test(mapped) ? mapped : "";
}
window.addEventListener("keydown", event => {
  if (state.page !== "pos" || !state.staff || state.dialog ||
      event.target.closest?.("input, textarea, select, [contenteditable]") || event.ctrlKey || event.altKey || event.metaKey) return;
  const now = Date.now();
  if (now - lastKey > 180) buffer = "";
  lastKey = now;
  if (event.key === "Enter") {
    if (buffer.length >= 4) { event.preventDefault(); window.tagGoRead(buffer); }
    buffer = "";
  } else {
    const ch = keyCharFromCode(event);
    if (ch && buffer.length < 64) buffer += ch;
  }
});

render();
if (state.server) run(refresh);
setInterval(updateTimer, 1000);
setInterval(async () => {
  if (document.hidden || !state.server || busy || polling || (state.dialog && state.dialog.kind !== "pass") ||
      document.activeElement.matches("input, select, textarea")) return;
  const before = changes;
  const counter = state.page === "pos" && state.staff;
  if (!counter && (!state.memberToken || !["home", "orders", "coupons", "history", "cafes", "shop", "account"].includes(state.page))) return;
  polling = true;
  try {
    const next = await (counter ? posRequest("overview") : memberRequest("profile"));
    if (before !== changes || (state.dialog && state.dialog.kind !== "pass") || document.activeElement.matches("input, select, textarea")) return;
    const field = counter ? "overview" : "profile";
    if (JSON.stringify(next) !== JSON.stringify(state[field])) {
      if (counter) { state.overview = next; state.managedCampaigns = next.campaigns ?? []; }
      else updateProfile(next);
      render();
    }
  } catch (error) {
    if (before === changes && error.status === 401) {
      if (counter) { state.staff = null; clearScan(); }
      else setMember({ token: "", profile: null });
      render();
      notice(error.message);
    }
  } finally { polling = false; }
}, 3500);