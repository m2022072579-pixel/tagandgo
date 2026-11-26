import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { request as rawRequest } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { newReference, createMember } from "../www/core.mjs";
import { openStore } from "../storage.mjs";
import { newState } from "../www/core.mjs";

async function start(database, merchant = false) {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL("..", import.meta.url), env: { ...process.env, MOA_STORE_MODE: merchant ? "1" : "0", TAGGO_HOST: "127.0.0.1", TAGGO_PORT: String(port), TAGGO_PIN: "672510", MOA_DATABASE: database, TAGGO_DATA: database + ".legacy.json" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("server startup timed out")), 10000);
    child.stdout.on("data", data => { if (data.toString().includes("테스트 서버가 시작")) { clearTimeout(timeout); resolve(); } });
    child.once("exit", code => { clearTimeout(timeout); reject(new Error("server exited " + code)); });
  });
  return { child, origin: "http://127.0.0.1:" + port };
}

async function request(server, path, data, token = "") {
  const response = await fetch(server.origin + path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(data) });
  return { status: response.status, body: await response.json() };
}

test("retention pilot scopes merchants and serializes targeted daily limits across servers", async () => {
  const directory = mkdtempSync(join(tmpdir(), "moa-retention-http-")), database = join(directory, "state.sqlite"), servers = [];
  const db = openStore(database, database + ".json", newState);
  const accounts = db.update(state => Array.from({ length: 2 }, (_, index) => {
    const account = createMember(state, "파일럿 고객 " + index);
    state.transactions["past-" + index] = { member: account.profile.code, shop: "pando", source: "nfc", time: Date.now() - 8 * 86400000, qty: 1 };
    return account;
  }));
  db.close();
  try {
    servers.push(await start(database), await start(database));
    const owners = await Promise.all(servers.map(server => request(server, "/api/pos", { shop: "pando", pin: "672510" })));
    const foreign = await request(servers[0], "/api/pos", { shop: "dict", pin: "672510" });
    assert.equal((await request(servers[0], "/api/counter", { action: "retentionTrial", accepted: true })).status, 401);
    assert.equal((await request(servers[0], "/api/counter", { action: "retentionTrial", accepted: false }, owners[0].body.token)).status, 400);
    const trials = await Promise.all(servers.map((server, index) => request(server, "/api/counter", { action: "retentionTrial", accepted: true, shop: "dict" }, owners[index].body.token)));
    assert.equal(trials[0].body.trial.endsAt, trials[1].body.trial.endsAt);
    assert.equal((await request(servers[0], "/api/counter", { action: "overview" }, foreign.body.token)).body.retention.trial.status, "available");
    for (const account of accounts) assert.equal((await request(servers[0], "/api/member", { action: "storeConsent", shop: "pando", enabled: true }, account.token)).status, 200);
    const campaign = await request(servers[0], "/api/counter", { action: "campaignCreate", reference: newReference(), type: "return", segment: "second", title: "다시 만나요",
      item: 0, discountAmount: 500, minPurchase: 3000, fee: 0, quantity: 10, dailyLimit: 1, budget: 5000,
      variableCost: 1000, minContribution: 1000, startsAt: Date.now() - 1000, endsAt: Date.now() + 86400000 }, owners[0].body.token);
    assert.equal(campaign.status, 200);
    assert.equal((await request(servers[1], "/api/catalog", {})).body.campaigns.length, 0);
    const claims = await Promise.all(accounts.map((account, index) => request(servers[index], "/api/member", { action: "claimCampaign", id: campaign.body.id }, account.token)));
    assert.equal(claims.filter(result => result.status === 200).length, 1);
    assert.equal(claims.filter(result => result.status === 400).length, 1);
    const winner = accounts[claims.findIndex(result => result.status === 200)];
    assert.equal((await request(servers[1], "/api/member", { action: "claimCampaign", id: campaign.body.id }, winner.token)).body.coupons.length, 1);
    assert.equal((await request(servers[0], "/api/counter", { action: "campaignEnd", id: campaign.body.id, version: 1 }, foreign.body.token)).status, 400);
    const scoped = (await request(servers[0], "/api/counter", { action: "overview" }, foreign.body.token)).body.retention;
    assert.equal(scoped.customers, 0); assert.deepEqual(scoped.rows, []);
    servers.push(await start(database));
    const restored = (await request(servers[2], "/api/member", { action: "profile" }, winner.token)).body;
    assert.equal(restored.storeConsents.pando.enabled, true);
    assert.equal(restored.coupons.length, 1);
  } finally {
    await Promise.all(servers.map(async server => { const exited = once(server.child, "exit"); server.child.kill(); await exited; }));
    assert.ok(resolve(directory).startsWith(resolve(tmpdir())) && resolve(directory).includes("moa-retention-http-"));
    rmSync(directory, { recursive: true });
  }
});

test("two processes reserve a pickup coupon once, complete it once and persist saved menus", async () => {
  const directory = mkdtempSync(join(tmpdir(), "moa-checkout-"));
  const database = join(directory, "state.sqlite"), servers = [];
  try {
    servers.push(await start(database), await start(database));
    const owners = await Promise.all(servers.map(server => request(server, "/api/pos", { shop: "pando", pin: "672510" })));
    const account = (await request(servers[0], "/api/join", { name: "동시 주문 고객" })).body;
    const qr = (await request(servers[0], "/api/member", { action: "pass" }, account.token)).body;
    assert.equal((await request(servers[0], "/api/counter", { action: "stamp", tag: qr.code, qty: 8, reference: newReference() }, owners[0].body.token)).status, 200);
    const profile = (await request(servers[0], "/api/member", { action: "profile" }, account.token)).body;
    const attempts = Array.from({ length: 10 }, () => ({ action: "order", shop: "pando", lines: [{ item: 0, qty: 1 }], coupon: profile.coupons[0].id, expectedTotal: 0, reference: newReference() }));
    const responses = await Promise.all(attempts.map((payload, index) => request(servers[index % 2], "/api/member", payload, account.token)));
    assert.equal(responses.filter(response => response.status === 200).length, 1);
    assert.equal(responses.filter(response => response.status === 400).length, 9);
    const winner = attempts[responses.findIndex(response => response.status === 200)];
    const retry = await Promise.all(servers.map(server => request(server, "/api/member", winner, account.token)));
    assert.ok(retry.every(response => response.status === 200 && response.body.orders.length === 1));
    const reservedQr = await request(servers[1], "/api/member", { action: "pass", coupon: profile.coupons[0].id }, account.token);
    assert.equal(reservedQr.status, 400);
    for (const status of ["preparing", "ready"]) assert.equal((await request(servers[0], "/api/counter", { action: "orderStatus", id: winner.reference, status }, owners[0].body.token)).status, 200);
    const uses = await Promise.all(servers.map((server, index) => request(server, "/api/counter", { action: "orderStatus", id: winner.reference, status: "pickedUp", purchaseConfirmed: true }, owners[index].body.token)));
    assert.ok(uses.every(response => response.status === 200));
    const used = (await request(servers[1], "/api/member", { action: "profile" }, account.token)).body;
    assert.equal(used.activity.filter(activity => activity.type === "coupon").length, 1);
    assert.equal(used.stamps.pando, 0); assert.ok(used.coupons[0].used);
    const saves = await Promise.all(servers.map(server => request(server, "/api/member", { action: "saveMenu", order: winner.reference, title: "매일의 커피" }, account.token)));
    assert.ok(saves.every(response => response.status === 200 && response.body.savedMenus.length === 1));
    const third = await start(database); servers.push(third);
    const restored = (await request(third, "/api/member", { action: "profile" }, account.token)).body;
    assert.equal(restored.savedMenus.length, 1); assert.equal(restored.orders[0].status, "pickedUp");
    const foreign = (await request(third, "/api/join", { name: "다른 계정" })).body;
    assert.equal((await request(third, "/api/member", { action: "deleteSavedMenu", id: restored.savedMenus[0].id }, foreign.token)).status, 400);
  } finally {
    await Promise.all(servers.map(async server => { const exited = once(server.child, "exit"); server.child.kill(); await exited; }));
    assert.ok(resolve(directory).startsWith(resolve(tmpdir())) && resolve(directory).includes("moa-checkout-"));
    rmSync(directory, { recursive: true });
  }
});

test("two server processes serialize last-stock claims and preserve shop authorization", async () => {
  const directory = mkdtempSync(join(tmpdir(), "moa-http-"));
  assert.ok(resolve(directory).includes("moa-http-"));
  const database = join(directory, "state.sqlite");
  const servers = [];
  try {
    servers.push(await start(database), await start(database));
    const [one, two] = servers;
    const owner = (await request(one, "/api/pos", { shop: "pando", pin: "672510" })).body;
    const otherOwner = (await request(two, "/api/pos", { shop: "dict", pin: "672510" })).body;
    const payload = { action: "campaignCreate", reference: newReference(), type: "first", title: "마지막 한 장", item: 0,
      discountAmount: 1000, minPurchase: 3000, fee: 500, quantity: 1, budget: 1500, startsAt: Date.now() - 1000, endsAt: Date.now() + 86400000 };
    assert.equal((await request(one, "/api/counter", payload)).status, 401);
    const campaign = (await request(one, "/api/counter", payload, owner.token)).body;
    assert.equal((await request(one, "/api/counter", payload, owner.token)).body.id, campaign.id);
    const foreign = await request(two, "/api/counter", { action: "campaignEnd", id: campaign.id, version: campaign.version, shop: "pando" }, otherOwner.token);
    assert.equal(foreign.status, 400);
    const members = await Promise.all(Array.from({ length: 12 }, (_, index) => request(servers[index % 2], "/api/join", { name: "고객 " + index })));
    const results = await Promise.all(members.map((member, index) => request(servers[index % 2], "/api/member", { action: "claimCampaign", id: campaign.id }, member.body.token)));
    assert.equal(results.filter(result => result.status === 200).length, 1);
    assert.equal(results.filter(result => result.status === 400).length, 11);
    const winner = results.findIndex(result => result.status === 200);
    const retries = await Promise.all(servers.map(server => request(server, "/api/member", { action: "claimCampaign", id: campaign.id }, members[winner].body.token)));
    assert.ok(retries.every(result => result.body.coupons.length === 1));
    const stats = (await request(one, "/api/counter", { action: "campaignList" }, owner.token)).body[0].stats;
    assert.equal(stats.issued, 1);
    assert.equal(stats.committed, 1500);
    assert.equal(stats.fees, 0);
    const publicFeed = (await request(two, "/api/catalog", {})).body;
    assert.equal(publicFeed.campaigns[0].remaining, 0);
    assert.equal(publicFeed.campaigns[0].budget, undefined);
    const secondStaff = (await request(two, "/api/pos", { shop: "pando", pin: "672510" })).body;
    const pass = (await request(one, "/api/member", { action: "pass" }, members[winner].body.token)).body;
    const coupon = retries[0].body.coupons[0];
    const redemption = { action: "redeem", tag: pass.code, coupon: coupon.id, reference: newReference(),
      item: 0, receiptNumber: "20261119-CONCURRENT", purchaseAmount: 3000, purchaseConfirmed: true, firstVisitConfirmed: true };
    const uses = await Promise.all([request(one, "/api/counter", redemption, owner.token), request(two, "/api/counter", redemption, secondStaff.token)]);
    assert.ok(uses.every(result => result.status === 200 && result.body.used));
    const afterUse = (await request(one, "/api/counter", { action: "campaignList" }, owner.token)).body[0].stats;
    assert.equal(afterUse.used, 1);
    assert.equal(afterUse.fees, 500);
    const third = await start(database);
    servers.push(third);
    const restored = await request(third, "/api/member", { action: "profile" }, members[winner].body.token);
    assert.equal(restored.body.coupons.length, 1);
    assert.ok(restored.body.coupons[0].used);
    assert.equal(restored.body.stamps.pando, 1);
  } finally {
    await Promise.all(servers.map(async server => {
      const exited = once(server.child, "exit");
      server.child.kill();
      await exited;
    }));
    assert.ok(resolve(directory).startsWith(resolve(tmpdir())) && resolve(directory).includes("moa-http-"));
    rmSync(directory, { recursive: true });
  }
});


test("merchant setup, private credentials, custom catalog and persisted transactions work end to end", async () => {
  const directory = mkdtempSync(join(tmpdir(), "moa-merchant-"));
  const database = join(directory, "store.sqlite");
  const servers = [];
  try {
    const server = await start(database, true);
    servers.push(server);
    const pending = await fetch(server.origin + "/", { redirect: "manual" });
    assert.equal(pending.status, 302);
    assert.equal(pending.headers.get("location"), "/setup");
    assert.equal((await request(server, "/api/catalog", {})).status, 409);
    const badHost = await new Promise((resolve, reject) => {
      const outgoing = rawRequest(server.origin + "/api/store-setup", { method: "POST", headers: { Host: "outside.invalid", "Content-Type": "application/json" } }, response => {
        response.resume(); response.once("end", () => resolve(response.statusCode));
      });
      outgoing.once("error", reject);
      outgoing.end(JSON.stringify({ action: "status" }));
    });
    assert.equal(badHost, 403);
    const bootstrap = (await request(server, "/api/store-setup", { action: "status" })).body;
    assert.equal(bootstrap.configured, false);
    const shopInput = { name: "모아 & <카페>", area: "왕십리", hours: "10:00–20:00", goal: 5, menu: [["에스프레소", 2800], ["라떼", 3800], ["쿠키", 2500, "food"]] };
    assert.equal((await request(server, "/api/store-setup", { action: "create", shop: shopInput })).status, 403);
    const created = (await request(server, "/api/store-setup", { action:"create", setupToken:bootstrap.setupToken, shop:shopInput })).body;
    assert.equal(created.configured, true);
    assert.match(created.pin, /^\d{6}$/);
    assert.equal(created.shop.reward, "에스프레소 1잔");
    assert.equal(created.shop.pinHash, undefined);
    assert.equal((await request(server, "/api/store-setup", {action:"create", setupToken:bootstrap.setupToken, shop:shopInput})).status, 400);
    const catalog = (await request(server, "/api/catalog", {})).body;
    assert.equal(catalog.shops.length, 1);
    assert.equal(catalog.shops[0].name, shopInput.name);
    assert.equal(catalog.setupToken, undefined);
    assert.equal(catalog.pin, undefined);
    const status = (await request(server, "/api/store-setup", {action:"status"})).body;
    assert.equal(status.pin, undefined);
    assert.equal(status.pinHash, undefined);
    assert.equal((await request(server, "/api/pos", {shop:created.shop.id,pin:"000000"})).status, 403);
    assert.equal((await request(server, "/api/pos", {shop:"pando",pin:created.pin})).status, 400);
    const staff = (await request(server, "/api/pos", {shop:created.shop.id,pin:created.pin})).body;
    const customer = (await request(server, "/api/join", {name:"새 매장 고객"})).body;
    assert.equal((await request(server, "/api/counter", {action:"register",tag:"AABB1122",code:customer.profile.code},staff.token)).status, 200);
    assert.equal((await request(server, "/api/counter", {action:"stamp",tag:"AABB1122",qty:5,reference:newReference()},staff.token)).status, 200);
    const profile = (await request(server, "/api/member", {action:"profile"}, customer.token)).body;
    assert.equal(profile.coupons.length, 1);
    assert.equal(profile.coupons[0].shop, created.shop.id);
    const second = await start(database, true);
    servers.push(second);
    const secondStaff = (await request(second, "/api/pos", {shop:created.shop.id,pin:created.pin})).body;
    assert.ok(secondStaff.token);
    const restored = (await request(second, "/api/member", {action:"profile"},customer.token)).body;
    assert.equal(restored.coupons.length,1);
    const setupAgain = (await request(second, "/api/store-setup", {action:"status"})).body;
    const rotated = (await request(second, "/api/store-setup", {action:"rotatePin",setupToken:setupAgain.setupToken})).body;
    assert.notEqual(rotated.pin,created.pin);
    assert.equal((await request(server, "/api/counter", {action:"overview"},staff.token)).status,401);
    assert.equal((await request(server, "/api/pos", {shop:created.shop.id,pin:created.pin})).status,403);
    assert.ok((await request(server, "/api/pos", {shop:created.shop.id,pin:rotated.pin})).body.token);
  } finally {
    await Promise.all(servers.map(async server => {
      const exited=once(server.child,"exit");
      server.child.kill();
      await exited;
    }));
    assert.ok(resolve(directory).startsWith(resolve(tmpdir())) && resolve(directory).includes("moa-merchant-"));
    rmSync(directory,{recursive:true});
  }
});
