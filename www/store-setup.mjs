const form = document.querySelector("#store-form");
const rows = document.querySelector("#menu-rows");
const message = document.querySelector("#setup-message");
let server;
let busy = false;
let menuId = 0;

function notify(text, error = false) {
  message.textContent = text;
  message.toggleAttribute("data-error", error);
}

async function request(action, data = {}) {
  const response = await fetch("/api/store-setup", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, setupToken: server?.setupToken, ...data }), signal: AbortSignal.timeout(10000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "서버 설정을 확인해 주세요.");
  return result;
}

function addMenu(name = "", price = "") {
  if (rows.children.length >= 20) { notify("메뉴는 20개까지 등록할 수 있어요."); return; }
  const row = document.createElement("div");
  row.className = "setup-menu-row";
  const index = ++menuId;
  row.innerHTML = `<label>메뉴 이름<input data-menu="name" aria-label="메뉴 ${index} 이름" required maxlength="40"></label><label>가격 (원)<input data-menu="price" aria-label="메뉴 ${index} 가격" type="number" min="1" max="1000000" required></label><label>분류<select data-menu="kind" aria-label="메뉴 ${index} 분류"><option value="drink">음료</option><option value="food">디저트</option></select></label><button class="button text" type="button" data-remove-menu aria-label="메뉴 ${index} 삭제">삭제</button>`;
  row.querySelector('[data-menu="name"]').value = name;
  row.querySelector('[data-menu="price"]').value = price;
  rows.append(row);
}

function showConnection() {
  const base = document.querySelector("#connection-url").value;
  const url = base + "/?live=1";
  document.querySelector("#customer-url").value = url;
  document.querySelector("#android-url").value = base;
  const qr = window.qrcode(0, "M");
  qr.addData(url);
  qr.make();
  document.querySelector("#customer-qr").src = qr.createDataURL(5, 20);
  document.querySelector("#customer-qr").hidden = !server.serverUrls.length;
}

function render() {
  document.querySelector("#registration").hidden = server.configured;
  document.querySelector("#ready").hidden = !server.configured;
  if (!server.configured) return;
  document.querySelector("#store-title").textContent = server.shop.name + " 서버가 준비됐어요";
  document.querySelector("#pos-link").href = server.posUrl;
  document.querySelector("#customer-link").href = server.localCustomerUrl;
  const pin = server.pin || sessionStorage.getItem("moa-store-pin:" + server.id);
  const pinElement = document.querySelector("#owner-pin");
  pinElement.textContent = pin || "저장해 둔 PIN을 사용하거나 다시 발급해 주세요.";
  pinElement.classList.toggle("no-pin", !pin);
  if (server.pin) sessionStorage.setItem("moa-store-pin:" + server.id, server.pin);
  const select = document.querySelector("#connection-url");
  select.replaceChildren();
  const urls = server.serverUrls.length ? server.serverUrls : [location.origin];
  for (const url of urls) select.add(new Option(url, url));
  document.querySelector("#network-note").textContent = server.serverUrls.length
    ? "주소가 여러 개라면 휴대폰과 같은 와이파이의 주소를 선택하세요."
    : "현재는 PC에서 연결할 주소입니다. 휴대폰용 주소는 와이파이에 연결한 뒤 이 페이지를 새로고침하면 확인할 수 있어요.";
  showConnection();
}

async function run(action) {
  if (busy) return;
  busy = true;
  document.querySelectorAll("button").forEach(button => { button.disabled = true; });
  try { await action(); }
  catch (error) { notify(error.message, true); }
  finally { busy = false; document.querySelectorAll("button").forEach(button => { button.disabled = false; }); }
}

document.querySelector("#add-menu").addEventListener("click", () => addMenu());
rows.addEventListener("click", event => {
  if (!event.target.closest("[data-remove-menu]")) return;
  if (rows.children.length === 1) { notify("적립 보상으로 제공할 음료 메뉴가 한 개 이상 필요해요."); return; }
  event.target.closest(".setup-menu-row").remove();
});
form.addEventListener("submit", event => {
  event.preventDefault();
  run(async () => {
    const values = Object.fromEntries(new FormData(form));
    const menu = [...rows.children].map(row => [row.querySelector('[data-menu="name"]').value,
      Number(row.querySelector('[data-menu="price"]').value), ...(row.querySelector('[data-menu="kind"]').value === "food" ? ["food"] : [])]);
    try { server = await request("create", { shop: { ...values, goal: Number(values.goal), menu } }); }
    catch (error) {
      server = await request("status");
      if (!server.configured) throw error;
    }
    render();
    notify("매장이 등록됐어요. 점주 POS에서 PIN을 입력해 시작하세요.");
    window.scrollTo(0, 0);
  });
});
document.querySelector("#rotate-pin").addEventListener("click", () => run(async () => {
  server = await request("rotatePin");
  render();
  notify("새 PIN을 발급했어요. 점주 POS에 다시 로그인해 주세요.");
}));
document.querySelector("#connection-url").addEventListener("change", showConnection);
document.querySelector("#copy-url").addEventListener("click", async () => {
  const input = document.querySelector("#customer-url");
  try { await navigator.clipboard.writeText(input.value); notify("고객 접속 주소를 복사했어요."); }
  catch { input.select(); notify("주소를 선택했어요. 복사해서 전달해 주세요."); }
});
addMenu("아메리카노", "3000");
addMenu("카페라떼", "3800");
run(async () => { server = await request("status"); render(); });
