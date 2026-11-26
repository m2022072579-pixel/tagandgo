import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { networkInterfaces } from "node:os";
import { validateShopCatalog } from "./www/core.mjs";

function credentials() {
  const pin = String(randomInt(100000, 1000000));
  const salt = randomBytes(16).toString("hex");
  return { pin, salt, pinHash: scryptSync(pin, salt, 32).toString("hex") };
}

export function createMerchantServer(state, input) {
  if (state.merchantServer) throw new Error("이미 매장이 등록된 서버예요. 점주 화면을 열어 주세요.");
  const shop = validateShopCatalog([{ ...input, id: "store-" + randomBytes(6).toString("hex"), reward: undefined }])[0];
  const { pin, salt, pinHash } = credentials();
  state.merchantServer = { id: randomBytes(12).toString("hex"), shop, salt, pinHash, createdAt: Date.now() };
  return { pin };
}

export function rotateMerchantPin(state) {
  if (!state.merchantServer) throw new Error("먼저 매장을 등록해 주세요.");
  let next;
  do { next = credentials(); } while (verifyMerchantPin(state.merchantServer, next.pin));
  state.merchantServer.salt = next.salt;
  state.merchantServer.pinHash = next.pinHash;
  return { pin: next.pin };
}

export function verifyMerchantPin(configuration, pin) {
  if (!configuration || typeof pin !== "string" || !/^\d{6}$/.test(pin)) return false;
  return timingSafeEqual(scryptSync(pin, configuration.salt, 32), Buffer.from(configuration.pinHash, "hex"));
}

export function isLocalOwner(request) {
  const address = request.socket.remoteAddress;
  const hostname = new URL("http://" + request.headers.host).hostname;
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address) && ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

export function merchantConnectionInfo(configuration, port, host) {
  const addresses = new Set();
  if (host === "0.0.0.0") {
    for (const records of Object.values(networkInterfaces())) {
      for (const entry of records ?? []) {
        if (entry.family !== "IPv4" || entry.internal) continue;
        const [first, second] = entry.address.split(".").map(Number);
        if (first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)) addresses.add(entry.address);
      }
    }
  }
  const serverUrls = [...addresses].sort((a, b) => Number(b.startsWith("192.168.")) - Number(a.startsWith("192.168."))).map(address => "http://" + address + ":" + port);
  return {
    configured: Boolean(configuration), id: configuration?.id, shop: configuration?.shop,
    serverUrls, customerUrls: serverUrls.map(url => url + "/?live=1"),
    localCustomerUrl: "http://localhost:" + port + "/?live=1", posUrl: "http://localhost:" + port + "/?pos=1",
  };
}
