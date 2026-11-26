const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { chromium } = require(process.env.MOA_PLAYWRIGHT || 'playwright');
const origin = process.env.MOA_TEST_ORIGIN;
if (!process.env.MOA_PACKAGED_HTML || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin || '')) throw new Error('Set MOA_PACKAGED_HTML and an isolated QA origin.');
const btn = (page, name) => page.getByRole('button', { name, exact: true });
const nav = (page, name) => page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name, exact: true });
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.MOA_BROWSER_EXE, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 393, height: 900 } }), errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000);
    await page.exposeFunction('nativeSend', async (server, path, body, token) => {
      assert.equal(server, origin);
      const response = await fetch(server + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body });
      return { status: response.status, body: await response.json() };
    });
    await page.addInitScript(() => window.TagGoAndroid = {
      request(id, server, path, body, token) { window.nativeSend(server, path, body, token).then(result => window.tagGoReply(id, result.status, result.body)); },
      stampFeedback() {}, startScan() { return 'QA'; },
    });
    await page.route('**/*', route => {
      if (route.request().url() === 'https://appassets.androidplatform.net/index.html') return route.fulfill({ contentType: 'text/html', body: readFileSync(process.env.MOA_PACKAGED_HTML, 'utf8') });
      external.push(route.request().url()); return route.abort();
    });
    await page.goto('https://appassets.androidplatform.net/index.html');
    await nav(page, '마이').click(); await btn(page, '수신 설정 관리').click();
    await btn(page, '팬도로시 혜택 받기').click(); await btn(page, '팬도로시 혜택 받지 않기').waitFor();
    await btn(page, '닫기').click(); await btn(page, '점주 POS').click(); await btn(page, 'POS 열기').click();
    await page.getByRole('heading', { name: '오늘의 고객 관리', exact: true }).waitFor();
    await btn(page, '프로 파일럿 안내').click(); await page.getByLabel('무료 파일럿 범위와 기간을 확인했습니다', { exact: true }).check();
    await btn(page, '30일 무료 파일럿 시작').click();
    await page.locator('.retention-action').first().getByRole('button', { name: '재방문 혜택 만들기', exact: true }).click();
    await page.getByLabel('대상 메뉴 변동비 (선택)', { exact: true }).fill('1000');
    await page.locator('#campaign-estimate').filter({ hasText: '1,500원' }).waitFor();
    await btn(page, '닫기').click(); await btn(page, '적립·픽업 바로가기').click();
    assert.equal(await page.locator('[data-form="tag"] input').evaluate(element => element === document.activeElement), true);
    await nav(page, '마이').click(); await page.locator('details.settings > summary').click();
    await page.getByLabel('서버 주소', { exact: true }).fill(origin); await btn(page, '서버 연결').click();
    await nav(page, '홈').click(); await page.getByLabel('닉네임', { exact: true }).fill('APK 재방문 QA'); await btn(page, '시작하기').click();
    await nav(page, '마이').click(); await btn(page, '수신 설정 관리').click();
    await btn(page, '팬도로시 혜택 받기').click(); await btn(page, '팬도로시 혜택 받지 않기').waitFor();
    await btn(page, '닫기').click(); await page.reload(); await nav(page, '마이').click(); await btn(page, '수신 설정 관리').click();
    await btn(page, '팬도로시 혜택 받지 않기').waitFor();
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    console.log('PASS: actual Android bundled page, offline consent, sample retention segments, trial, cost preview, counter shortcut, native server bridge and persisted consent; no external resources.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
