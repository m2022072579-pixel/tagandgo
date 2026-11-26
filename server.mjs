import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { networkInterfaces } from "node:os";
import { randomInt, randomBytes, timingSafeEqual } from "node:crypto";
import { shops, setShopCatalog, newState, createMember, recoverMember, memberAction, posAction } from "./www/core.mjs";
import { campaignFeed } from "./www/campaigns.mjs";
import { openStore } from "./storage.mjs";
import { createMerchantServer, rotateMerchantPin, verifyMerchantPin, isLocalOwner, merchantConnectionInfo } from "./merchant-server.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const merchantMode = process.env.MOA_STORE_MODE === "1";
const database = resolve(process.env.TAGGO_DATA || resolve(root, "data", merchantMode ? "merchant-test.json" : "pilot.json"));
const port = Number(process.env.TAGGO_PORT || (merchantMode ? 8890 : 8787));
const host = process.env.TAGGO_HOST || "0.0.0.0";
const pin = process.env.TAGGO_PIN || String(randomInt(100000, 1000000));
const pinBytes = Buffer.from(pin);
const sessions = new Map();
const attempts = new Map();
const hour = 60 * 60 * 1000;
const store = openStore(resolve(process.env.MOA_DATABASE || database.replace(/\.json$/i, "") + ".sqlite"), database, newState);
const update = operation => store.update(operation);
const setupToken = randomBytes(24).toString("hex");
if (merchantMode && store.read().merchantServer) setShopCatalog([store.read().merchantServer.shop]);

const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/pos", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/manifest.json", ["manifest.json", "application/manifest+json; charset=utf-8"]],
  ["/sw.js", ["sw.js", "text/javascript; charset=utf-8"]],
  ["/icon-192.png", ["icon-192.png", "image/png"]],
  ["/icon-512.png", ["icon-512.png", "image/png"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/app.mjs", ["app.mjs", "text/javascript; charset=utf-8"]],
  ["/core.mjs", ["core.mjs", "text/javascript; charset=utf-8"]],
  ["/campaigns.mjs", ["campaigns.mjs", "text/javascript; charset=utf-8"]],
  ["/customer.mjs", ["customer.mjs", "text/javascript; charset=utf-8"]],
  ["/checkout.mjs", ["checkout.mjs", "text/javascript; charset=utf-8"]],
  ["/retention.mjs", ["retention.mjs", "text/javascript; charset=utf-8"]],
  ["/views.mjs", ["views.mjs", "text/javascript; charset=utf-8"]],
  ["/qrcode.js", ["qrcode.js", "text/javascript; charset=utf-8"]],
  ["/qrcode-LICENSE.txt", ["qrcode-LICENSE.txt", "text/plain; charset=utf-8"]],
  ["/coffee-daylight.webp", ["coffee-daylight.webp", "image/webp"]],
  ["/fonts/PretendardVariable.woff2", ["fonts/PretendardVariable.woff2", "font/woff2"]],
  ["/fonts/Pretendard-LICENSE.txt", ["fonts/Pretendard-LICENSE.txt", "text/plain; charset=utf-8"]],
  ["/store-setup.mjs", ["store-setup.mjs", "text/javascript; charset=utf-8"]],
  ["/store-setup.css", ["store-setup.css", "text/css; charset=utf-8"]],
]);

const json = (response, status, data) => {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(data));
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function parse(request) {
  if (!request.headers["content-type"]?.startsWith("application/json")) throw new HttpError(415, "JSON 요청을 사용해 주세요.");
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size <= 8192) chunks.push(chunk);
  }
  if (size > 8192) throw new HttpError(413, "요청이 너무 큽니다.");
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "요청을 확인해 주세요.");
  return body;
}

function authenticatePos(data, address, configuration) {
  const now = Date.now();
  const attempt = attempts.get(address) ?? { count: 0, expires: now + 60000 };
  if (attempt.expires <= now) { attempt.count = 0; attempt.expires = now + 60000; }
  if (attempt.count >= 8) throw new HttpError(429, "잠시 후 POS 로그인을 다시 시도해 주세요.");
  const candidate = Buffer.from(String(data.pin ?? ""));
  const valid = merchantMode ? verifyMerchantPin(configuration, data.pin) : candidate.length === pinBytes.length && timingSafeEqual(candidate, pinBytes);
  if (!valid) {
    attempt.count++;
    attempts.set(address, attempt);
    throw new HttpError(403, "POS PIN이 일치하지 않습니다.");
  }
  const shop = shops.find(entry => entry.id === data.shop);
  if (!shop) throw new HttpError(400, "매장을 선택해 주세요.");
  attempts.delete(address);
  for (const [id, session] of sessions) if (session.expires <= now) sessions.delete(id);
  const secret = randomBytes(24).toString("hex");
  sessions.set(secret, { shop: shop.id, expires: now + 8 * hour, credentialVersion: merchantMode ? configuration.pinHash : undefined });
  return { token: secret, shop: shop.id };
}

function execute(path, request, data) {
  const state = store.read();
  if (path === "/api/store-setup") {
    if (!merchantMode || !isLocalOwner(request)) throw new HttpError(403, "서버를 실행한 PC에서 localhost 점주 설정을 열어 주세요.");
    if (data.action === "status") return { ...merchantConnectionInfo(state.merchantServer, port, host), setupToken };
    if (data.setupToken !== setupToken) throw new HttpError(403, "점주 설정을 새로고침한 뒤 다시 시도해 주세요.");
    let result;
    if (data.action === "create") result = update(next => createMerchantServer(next, data.shop));
    else if (data.action === "rotatePin") result = update(rotateMerchantPin);
    else throw new HttpError(400, "점주 설정 요청을 확인해 주세요.");
    const configuration = store.read().merchantServer;
    setShopCatalog([configuration.shop]);
    sessions.clear();
    attempts.clear();
    return { ...merchantConnectionInfo(configuration, port, host), ...result, setupToken };
  }
  if (merchantMode && !state.merchantServer) throw new HttpError(409, "서버 PC에서 매장 설정을 먼저 완료해 주세요.");
  if (merchantMode) setShopCatalog([state.merchantServer.shop]);
  const secret = (request.headers.authorization ?? "").match(/^Bearer ([a-f0-9]{48})$/)?.[1];
  switch (path) {
    case "/api/catalog": return { soldOut: state.soldOut, campaigns: campaignFeed(state, null, shops), shops, features: ["pickup-coupons-v1", "saved-menus-v1", "retention-v1"] };
    case "/api/join": return update(next => createMember(next, data.name));
    case "/api/recover": return update(next => recoverMember(next, data.key));
    case "/api/member":
      if (!secret || !Object.hasOwn(state.members, secret)) throw new HttpError(401, "회원 연결이 만료되었습니다.");
      if (["profile", "quoteOrder"].includes(data.action)) return memberAction(state, secret, data.action, data);
      return update(next => memberAction(next, secret, data.action, data));
    case "/api/pos": return authenticatePos(data, request.socket.remoteAddress, state.merchantServer);
    case "/api/counter": {
      const session = sessions.get(secret);
      if (!session || session.expires <= Date.now()) throw new HttpError(401, "POS에 다시 로그인해 주세요.");
      if (merchantMode && session.credentialVersion !== state.merchantServer.pinHash) throw new HttpError(401, "점주 PIN이 변경됐어요. 다시 로그인해 주세요.");
      if (["identify", "overview", "campaignList"].includes(data.action)) return posAction(state, session.shop, data.action, data);
      return update(next => posAction(next, session.shop, data.action, data));
    }
    default: throw new HttpError(404, "요청을 찾을 수 없습니다.");
  }
}

createServer(async (request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  try {
    const path = new URL(request.url, "http://localhost").pathname;
    if (request.method === "GET" && path === "/setup") {
      if (!merchantMode || !isLocalOwner(request)) throw new HttpError(403, "점주 서버 실행 파일을 열고 PC의 localhost:8890/setup에 접속해 주세요.");
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" });
      response.end(readFileSync(resolve(root, "www", "store-setup.html")));
      return;
    }
    if (request.method === "GET" && path === "/" && merchantMode && !store.read().merchantServer) {
      if (isLocalOwner(request)) { response.writeHead(302, { Location: "/setup" }); response.end(); }
      else json(response, 409, { error: "점주가 매장을 설정하고 있어요. 잠시 후 다시 접속해 주세요." });
      return;
    }
    if (request.method === "GET" && files.has(path)) {
      const [file, type] = files.get(path);
      response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; manifest-src 'self'; worker-src 'self'; base-uri 'none'; frame-ancestors 'none'; connect-src 'self'");
      response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
      response.end(readFileSync(resolve(root, "www", file)));
      return;
    }
    if (request.method !== "POST" || !path.startsWith("/api/")) {
      json(response, 404, { error: "요청을 찾을 수 없습니다." });
      return;
    }
    if (request.headers.origin) {
      const originHost = new URL(request.headers.origin).host;
      if (originHost !== request.headers.host) throw new HttpError(403, "이 서버에서 연 화면을 사용해 주세요.");
    }
    json(response, 200, execute(path, request, await parse(request)));
  } catch (error) {
    const systemError = Boolean(error.code);
    if (systemError) console.error(error);
    json(response, error.status || (systemError ? 500 : 400), { error: systemError ? "저장하지 못했습니다." : error.message });
  }
}).listen(port, host, () => {
  console.log("MOA 서버가 시작됐습니다.");
  console.log("손님용 앱  http://localhost:" + port + "/");
  console.log("점주용 POS http://localhost:" + port + "/pos");
  if (merchantMode) console.log("점주 서버 설정  http://localhost:" + port + "/setup");
  else console.log("POS PIN  " + pin);
  if (host === "0.0.0.0") {
    for (const addresses of Object.values(networkInterfaces())) {
      for (const address of addresses ?? []) {
        if (address.family === "IPv4" && !address.internal) console.log("휴대폰에서 서버 연결  http://" + address.address + ":" + port);
      }
    }
  }
}).on("error", error => {
  store.close();
  if (error.code !== "EADDRINUSE") throw error;
  console.error(port + " 포트를 사용 중입니다.");
  process.exitCode = 1;
});