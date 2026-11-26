import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { networkInterfaces } from "node:os";
import { randomInt, randomBytes, timingSafeEqual } from "node:crypto";
import { deflateSync } from "node:zlib";
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

function makeOriginalMoaPng(size) {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c;
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (let i = 0; i < body.length; i++) crc = crcTable[(crc ^ body[i]) & 0xff] ^ (crc >>> 8);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
    return Buffer.concat([len, body, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const rowSize = 1 + size * 3;
  const raw = Buffer.alloc(rowSize * size);

  const distSeg = (px, py, x1, y1, x2, y2) => {
    const dx = x2 - x1, dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  };

  for (let y = 0; y < size; y++) {
    const rowOffset = y * rowSize;
    raw[rowOffset] = 0;
    const ny = (y / size) * 108;
    for (let x = 0; x < size; x++) {
      const nx = (x / size) * 108;
      let white = false;
      const stroke = 3.2;

      // 1. 커피잔 몸통 테두리 (M28,46 H70 V57 Q70,74 52,74 H46 Q28,74 28,57 Z)
      if (distSeg(nx, ny, 28, 46, 70, 46) <= stroke) white = true;
      if (distSeg(nx, ny, 28, 46, 28, 57) <= stroke) white = true;
      if (distSeg(nx, ny, 70, 46, 70, 57) <= stroke) white = true;
      if (distSeg(nx, ny, 45, 74, 53, 74) <= stroke) white = true;
      if (nx <= 45 && ny >= 57 && Math.abs(Math.hypot(nx - 45, ny - 57) - 17) <= stroke) white = true;
      if (nx >= 53 && ny >= 57 && Math.abs(Math.hypot(nx - 53, ny - 57) - 17) <= stroke) white = true;

      // 2. 손잡이 (M70,50 H76 A8,8 0,0 1,76 66 H68)
      if (distSeg(nx, ny, 70, 50, 76, 50) <= stroke) white = true;
      if (distSeg(nx, ny, 68, 66, 76, 66) <= stroke) white = true;
      if (nx >= 76 && Math.abs(Math.hypot(nx - 76, ny - 58) - 8) <= stroke) white = true;

      // 3. 받침선 (M27,82 H76)
      if (distSeg(nx, ny, 27, 82, 76, 82) <= stroke) white = true;

      // 4. 커피 김 2줄 (M44,29 C38,33 38,36 42,39 / M57,25 C51,30 51,35 55,39)
      if (distSeg(nx, ny, 44, 29, 39, 34) <= 2.6 || distSeg(nx, ny, 39, 34, 42, 39) <= 2.6) white = true;
      if (distSeg(nx, ny, 57, 25, 52, 32) <= 2.6 || distSeg(nx, ny, 52, 32, 55, 39) <= 2.6) white = true;

      const px = rowOffset + 1 + x * 3;
      // 원래 MOA 파란색 배경 (#0B46C7) + 흰색 (#FFFFFF) 로고
      raw[px] = white ? 255 : 11;
      raw[px + 1] = white ? 255 : 70;
      raw[px + 2] = white ? 255 : 199;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const icon192 = makeOriginalMoaPng(192);
const icon512 = makeOriginalMoaPng(512);

const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/pos", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/manifest.json", ["manifest.json", "application/manifest+json; charset=utf-8"]],
  ["/sw.js", ["sw.js", "text/javascript; charset=utf-8"]],
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
    if (request.method === "GET" && (path === "/icon-192.png" || path === "/icon-512.png")) {
      response.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-cache" });
      response.end(path === "/icon-192.png" ? icon192 : icon512);
      return;
    }
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