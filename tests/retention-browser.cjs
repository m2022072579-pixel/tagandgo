// This suite seeds ONLY an isolated retention-qa SQLite database.
const assert = require('node:assert/strict');
const { resolve, basename } = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.MOA_PLAYWRIGHT || 'playwright');
const origin = process.env.MOA_TEST_ORIGIN, database = process.env.MOA_TEST_DATABASE;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin || '') || !/^retention-qa-[a-f0-9]+\.sqlite$/.test(basename(database || ''))) throw new Error('Use a dedicated retention-qa database and localhost QA server.');
const btn = (page, name) => page.getByRole('button', { name, exact: true });
const nav = (page, name) => page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name, exact: true });
async function api(path, body, token = '') {
  const response = await fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
}
(async () => {
  const { openStore } = await import(pathToFileURL(resolve('storage.mjs')));
  const { newState } = await import(pathToFileURL(resolve('www/core.mjs')));
  const suffix = Date.now().toString(36), name = '재방문 QA ' + suffix, title = '다시 만나는 커피 ' + suffix;
  const account = await api('/api/join', { name });
  const db = openStore(database, database + '.legacy.json', newState);
  db.update(state => {
    state.transactions['qa-' + suffix] = { shop: 'pando', member: account.profile.code, source: 'nfc', qty: 1, time: Date.now() - 8 * 86400000 };
    state.members[account.token].stamps.pando = 1;
  }); db.close();
  const browser = await chromium.launch({ executablePath: process.env.MOA_BROWSER_EXE, headless: true });
  const errors = [];
  try {
    const customer = await browser.newPage({ viewport: { width: 393, height: 900 } });
    const merchant = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    for (const page of [customer, merchant]) { page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message)); }
    await customer.addInitScript(({ origin, token }) => localStorage.setItem('taggo-member-v1:' + origin, JSON.stringify(token)), { origin, token: account.token });
    await customer.goto(origin + '/?live=1');
    await nav(customer, '마이').click(); await btn(customer, '수신 설정 관리').click();
    await btn(customer, '팬도로시 혜택 받기').click();
    await btn(customer, '팬도로시 혜택 받지 않기').waitFor();
    assert.equal((await api('/api/member', { action: 'profile' }, account.token)).storeConsents.pando.enabled, true);
    await btn(customer, '닫기').click();
    await merchant.goto(origin + '/?pos=1');
    await merchant.getByLabel('POS PIN', { exact: true }).fill(process.env.MOA_TEST_PIN || '672510'); await btn(merchant, 'POS 열기').click();
    await merchant.getByRole('heading', { name: '오늘의 고객 관리', exact: true }).waitFor();
    if (await btn(merchant, '프로 파일럿 안내').count()) {
      await btn(merchant, '프로 파일럿 안내').click();
      await merchant.getByLabel('무료 파일럿 범위와 기간을 확인했습니다', { exact: true }).check();
      await btn(merchant, '30일 무료 파일럿 시작').click();
    }
    await merchant.locator('.retention-action').first().getByRole('button', { name: '재방문 혜택 만들기', exact: true }).click();
    await merchant.getByLabel('캠페인 제목', { exact: true }).fill(title);
    await merchant.getByLabel('대상 메뉴 변동비 (선택)', { exact: true }).fill('1200');
    await merchant.getByLabel('잔당 최소 공헌이익', { exact: true }).fill('2000');
    await merchant.getByLabel('하루 발급 한도 (0은 별도 제한 없음)', { exact: true }).fill('1');
    await merchant.getByText(/최소 금액 미달/).waitFor();
    await btn(merchant, '캠페인 등록하기').click();
    await merchant.locator('#sheet-error').filter({ hasText: '최소 금액보다 적어요' }).waitFor();
    await merchant.getByLabel('잔당 최소 공헌이익', { exact: true }).fill('1000');
    await btn(merchant, '캠페인 등록하기').click();
    await merchant.locator('.campaign-report').filter({ hasText: title }).waitFor();
    assert.ok((await merchant.locator('.campaign-report').filter({ hasText: title }).innerText()).includes('1,300원'));
    await merchant.locator('.retention-details summary').click();
    await merchant.getByText(name, { exact: true }).waitFor();
    await merchant.screenshot({ path: resolve('dist/MOA-Retention-Merchant.png'), fullPage: true });
    await nav(customer, '홈').click(); await customer.reload();
    await customer.getByRole('heading', { name: '내 카페의 초대', exact: true }).waitFor();
    await customer.screenshot({ path: resolve('dist/MOA-Retention-Customer.png'), fullPage: true });
    await btn(customer, '초대 쿠폰 받기').click(); await btn(customer, '혜택 쿠폰 받기').click();
    let profile = await api('/api/member', { action: 'profile' }, account.token);
    assert.equal(profile.coupons.length, 1); assert.equal(profile.coupons[0].feeAmount, 0);
    await nav(customer, '마이').click(); await btn(customer, '수신 설정 관리').click();
    await btn(customer, '팬도로시 혜택 받지 않기').click(); await btn(customer, '팬도로시 혜택 받기').waitFor();
    await btn(customer, '닫기').click(); await nav(customer, '쿠폰함').click();
    await customer.locator('.ticket-card').filter({ hasText: title }).locator('[data-action="use-coupon"]').click();
    const code = await customer.locator('.qr-code').innerText();
    await merchant.getByLabel('키링 ID 또는 QR 코드', { exact: true }).fill(code); await btn(merchant, '조회').click();
    await merchant.getByRole('heading', { name: '혜택 사용·구매 확인', exact: true }).waitFor();
    await merchant.getByLabel('영수증 번호', { exact: true }).fill('20261123-' + suffix);
    await merchant.getByLabel('대상 메뉴 제공과 실제 영수증을 확인했습니다', { exact: true }).check();
    await btn(merchant, '구매 확인·혜택 사용 승인').click();
    profile = await api('/api/member', { action: 'profile' }, account.token);
    assert.ok(profile.coupons[0].used); assert.equal(profile.stamps.pando, 2);
    const owner = await api('/api/pos', { shop: 'pando', pin: process.env.MOA_TEST_PIN || '672510' });
    const report = await api('/api/counter', { action: 'overview' }, owner.token);
    assert.ok(report.retention.returned >= 1);
    assert.equal(report.campaigns.find(campaign => campaign.title === title).stats.used, 1);
    assert.equal(report.campaigns.find(campaign => campaign.title === title).stats.fees, 0);
    await btn(customer, '닫기').click();
    for (const width of [320, 393, 1440]) {
      for (const page of [customer, merchant]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow at ' + width);
      }
    }
    assert.deepEqual(errors, []);
    console.log('PASS: consent → trial → margin guard → private invitation → coupon → opt-out → QR use → repeat-day report; 320/393/1440px.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
