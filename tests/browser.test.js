import { browserOptions } from '../scripts/browser.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import '../extension/core.js';
const C = globalThis.ADCore;
const root = path.resolve(import.meta.dirname, '..');
const artifacts = path.join(root, '.test-artifacts');
await fs.mkdir(artifacts, { recursive: true });
const profile = await fs.mkdtemp(path.join(artifacts, 'profile-'));
const extension = path.join(root, 'extension');
const context = await chromium.launchPersistentContext(profile, {
  ...browserOptions(),
  headless: true, viewport: { width: 1280, height: 940 }, locale: 'ja-JP',
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run', '--disable-background-networking']
});
const errors = [], results = [];
const record = (name, detail = '') => { results.push({ name, passed: true, detail }); console.log(`PASS ${name}${detail ? `: ${detail}` : ''}`); };
context.on('page', page => page.on('pageerror', e => errors.push(e.message)));
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const fixture = await fs.readFile(path.join(root, 'tests/fixtures/catalog.html'), 'utf8');
  await context.route('https://catalog.example.test/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await context.route('https://frame.example.test/**', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0;background:white;color:black"><p>iframe text</p></body>' }));
  async function prefs(global = {}, sites = {}) {
    await worker.evaluate(({ global, sites }) => chrome.storage.local.set({ preferences: { global, sites } }), { global, sites });
  }
  const page = await context.newPage();
  const tabId = async () => worker.evaluate(async () => (await chrome.tabs.query({})).find(t => t.url?.startsWith('https://catalog.example.test/'))?.id);
  const status = async () => worker.evaluate(async tab => chrome.tabs.sendMessage(tab, { type: 'AD_GET_STATUS' }, { frameId: 0 }), await tabId());
  async function waitState(expected) {
    const until = Date.now() + 15000;
    while (Date.now() < until) { const s = await status(); if (s.state === expected) return s; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error(`Expected ${expected}, got ${JSON.stringify(await status())}`);
  }
  const inspect = selector => page.locator(selector).first().evaluate(e => { const s = getComputedStyle(e); return { bg: s.backgroundColor, fg: s.color, fill: s.webkitTextFillColor, image: s.backgroundImage, filter: s.filter }; });
  function readable(pair, target = 4.5) { assert.ok(C.contrast(C.parse(pair.fg), C.parse(pair.bg)) >= target, JSON.stringify(pair)); }
  await prefs({ enabled: false });
  await page.goto('https://catalog.example.test/catalog');
  await waitState('off');
  const original = await inspect('#legacy');
  await page.screenshot({ path: path.join(artifacts, 'catalog-before.png'), fullPage: true });
  await prefs({ enabled: true });
  await waitState('active');
  for (const selector of ['body', '.card', '#legacy', 'input', 'button']) { const pair = await inspect(selector); assert.ok(C.luminance(C.parse(pair.bg)) < .14); readable(pair); }
  const brand = await page.locator('.brand').first().evaluate(e => ({ fg: getComputedStyle(e).color, bg: getComputedStyle(e.parentElement).backgroundColor }));
  readable(brand);
  assert.ok(C.contrast(C.parse((await inspect('#legacy')).fill), C.parse((await inspect('#legacy')).bg)) >= 4.5);
  const strip = await inspect('.strip');
  assert.ok(!strip.image.includes('255, 255, 255'));
  const pseudo = await page.locator('.badge').first().evaluate(e => ({ fg: getComputedStyle(e, '::before').color, bg: getComputedStyle(e, '::before').backgroundColor }));
  readable(pseudo);
  const placeholder = await page.locator('input').evaluate(e => ({ fg: getComputedStyle(e, '::placeholder').color, bg: getComputedStyle(e).backgroundColor }));
  readable(placeholder);
  const shadow = await page.locator('#shadow .surface').evaluate(e => ({ fg: getComputedStyle(e).color, bg: getComputedStyle(e).backgroundColor }));
  readable(shadow);
  assert.ok(C.luminance(C.parse(shadow.bg)) < .14);
  assert.equal(await page.locator('img').first().evaluate(e => getComputedStyle(e).filter), 'none');
  await page.screenshot({ path: path.join(artifacts, 'catalog-after.png'), fullPage: true });
  record('cards, inline !important, text-fill, gradients, pseudos, placeholder, shadow DOM; images retained');
  await page.evaluate(() => { const e = document.createElement('div'); e.id = 'dynamic'; e.className = 'dynamic'; e.textContent = '後から追加された黒い文字'; document.getElementById('added').append(e); });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('dynamic')).backgroundColor !== 'rgb(255, 255, 255)');
  readable(await inspect('#dynamic'));
  await page.evaluate(() => { const e = document.getElementById('dynamic'); e.style.setProperty('background-color', 'rgb(240, 244, 248)', 'important'); e.style.setProperty('color', 'rgb(20, 30, 40)', 'important'); });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('dynamic')).backgroundColor !== 'rgb(240, 244, 248)');
  await prefs({ enabled: false }); await waitState('off');
  assert.deepEqual(await inspect('#legacy'), original);
  assert.equal((await inspect('#dynamic')).bg, 'rgb(240, 244, 248)');
  assert.equal((await inspect('#dynamic')).fg, 'rgb(20, 30, 40)');
  assert.equal(await page.locator('style[data-ad-sheet]').count(), 0);
  assert.equal((await page.locator('body').getAttribute('style')) || null, null);
  record('dynamic content and later inline edits retained when disabled');
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  const native = await inspect('.card');
  await prefs({ enabled: true }); await waitState('native');
  assert.deepEqual(await inspect('.card'), native);
  assert.equal(await page.locator('style[data-ad-sheet]').count(), 0);
  record('native dark theme skipped without altering colors');
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await waitState('active');
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await waitState('native');
  assert.deepEqual(await inspect('.card'), native);
  await prefs({ enabled: true }, { 'catalog.example.test': { mode: 'on', contrast: 7 } });
  await waitState('active');
  readable(await inspect('.card'), 7);
  await prefs({ enabled: false }, { 'catalog.example.test': { mode: 'on', enabled: true } });
  await waitState('off');
  await prefs({ enabled: true }, { 'catalog.example.test': { mode: 'off' } });
  await waitState('off');
  record('live native theme switches, forced ON, per-site OFF, global disable precedence');
  await page.evaluate(() => { document.documentElement.classList.remove('dark'); document.body.classList.add('mixed'); });
  await prefs({ enabled: true }); await waitState('active');
  assert.ok(C.luminance(C.parse((await inspect('.card')).bg)) < .14);
  record('mixed dark surround and white catalog does not falsely count as native dark');
  const navigation = page.waitForEvent('framenavigated', { predicate: f => f.url().includes('frame.example.test'), timeout: 15000 });
  await page.evaluate(() => { const frame = document.createElement('iframe'); frame.src = 'https://frame.example.test/frame'; frame.id = 'frame'; document.body.append(frame); });
  const frame = await navigation;
  const embedded = frame || page.frames().find(f => f.url().includes('frame.example.test'));
  await embedded.waitForLoadState('domcontentloaded');
  await page.locator('#frame').scrollIntoViewIfNeeded();
  await embedded.waitForFunction(() => document.body.style.getPropertyPriority('background-color') === 'important').catch(async error => {
    console.log('Frame diagnostic', await worker.evaluate(async tab => chrome.tabs.sendMessage(tab, { type: 'AD_GET_STATUS', frameUrl: 'https://frame.example.test/frame' }), await tabId()), await embedded.locator('body').getAttribute('style'), errors);
    throw error;
  });
  await prefs({ enabled: true }, { 'catalog.example.test': { mode: 'off' } }); await waitState('off');
  await embedded.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(255, 255, 255)');
  record('cross-origin frame follows the top-site preference');
  await prefs({ enabled: true }, { 'catalog.example.test': { mode: 'on', suppressImages: true } }); await waitState('active');
  await page.evaluate(() => { const e = document.createElement('div'); e.id = 'photo-background'; e.style.cssText = 'background:white url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22/%3E") no-repeat;color:black;padding:20px'; e.textContent = '背景画像対策'; document.body.append(e); });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('photo-background')).backgroundImage === 'none');
  assert.equal(await page.locator('img').first().evaluate(e => getComputedStyle(e).filter), 'none');
  record('optional CSS image suppression leaves product images intact');
  // Exercise the shipped popup against an active website tab.
  const popup = await context.newPage();
  // A headless extension tab becomes the active tab itself. Reproduce the
  // toolbar popup's originating-tab context while retaining real storage,
  // messaging, background worker, and the shipped popup scripts.
  await popup.addInitScript(({ websiteId }) => {
    const query = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = options => options.active ? chrome.tabs.get(websiteId).then(tab => [tab]) : query(options);
  }, { websiteId: await tabId() });
  await page.bringToFront();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.waitForFunction(() => !document.getElementById('controls').disabled);
  await popup.locator('input[name=mode][value=off]').check();
  await waitState('off');
  await popup.locator('input[name=mode][value=auto]').check();
  await waitState('active');
  await popup.locator('#contrast').selectOption('7');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.card')).color !== 'rgb(0, 0, 0)');
  const options = await context.newPage(); await options.goto(`chrome-extension://${id}/options.html`);
  await options.waitForFunction(() => !document.getElementById('controls').disabled);
  await options.locator('#enabled').uncheck(); await waitState('off');
  await options.locator('#enabled').check(); await waitState('active');
  await popup.locator('body').screenshot({ path: path.join(artifacts, 'popup.png') });
  await popup.locator('#reset').click();
  await popup.waitForFunction(() => document.getElementById('contrast').value === '4.5');
  record('popup site settings, options global toggle, and site reset persist');
  await popup.close();
  // A large DOM catches accidental per-element read/write layout thrashing.
  await page.evaluate(() => { const box = document.createElement('div'); box.id = 'large'; box.innerHTML = '<div style="background:white;color:black">追加行</div>'.repeat(2000); document.body.append(box); });
  const start = Date.now();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#large div:last-child')).backgroundColor !== 'rgb(255, 255, 255)', null, { timeout: 20000 });
  record('2,000 added elements processed', `${Date.now() - start} ms`);
  // Real network verification is kept separate from deterministic fixtures.
  const live = await context.newPage();
  try {
    await prefs({ enabled: false });
    await live.goto('https://kakaku.com/pc/ssd/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await live.waitForTimeout(1500);
    await live.screenshot({ path: path.join(artifacts, 'kakaku-before.png'), fullPage: false });
    await prefs({ enabled: true });
    await live.waitForFunction(() => [...document.querySelectorAll('.contType001,.contTtl,.contMain,.boxSearch')].length > 5 && [...document.querySelectorAll('.contType001,.contTtl,.contMain,.boxSearch')].every(e => getComputedStyle(e).backgroundImage === 'none'), null, { timeout: 20000 });
    const liveTab = await worker.evaluate(async () => (await chrome.tabs.query({})).find(t => t.url?.startsWith('https://kakaku.com/pc/ssd/'))?.id);
    const liveStatus = await worker.evaluate(async tab => chrome.tabs.sendMessage(tab, { type: 'AD_GET_STATUS' }, { frameId: 0 }), liveTab);
    assert.equal(liveStatus.state, 'active');
    const scan = await live.evaluate(() => {
      const sample = [...document.querySelectorAll('body *')].filter(e => !e.closest('svg') && !['IMG','SCRIPT','STYLE','VIDEO','CANVAS','IFRAME'].includes(e.tagName));
      let white = 0, visible = 0;
      for (const e of sample) { const r = e.getBoundingClientRect(); if (r.width < 50 || r.height < 20 || r.top > innerHeight || r.bottom < 0) continue; visible++; const s = getComputedStyle(e); if (/rgb\(25[0-5], 25[0-5], 25[0-5]\)/.test(s.backgroundColor)) white++; }
      return { title: document.title, visible, white, cards: document.querySelectorAll('img').length };
    });
    assert.ok(scan.title.includes('SSD') && scan.cards > 10, 'Real catalog not received');
    assert.equal(scan.white, 0, JSON.stringify(scan));
    await live.screenshot({ path: path.join(artifacts, 'kakaku-live.png'), fullPage: false });
    await live.locator('#ct087').scrollIntoViewIfNeeded();
    await live.screenshot({ path: path.join(artifacts, 'kakaku-catalog.png'), fullPage: false });
    record('live kakaku.com SSD catalog', JSON.stringify({ ...scan, elements: liveStatus.elements }));
  } catch (error) {
    results.push({ name: 'live kakaku.com SSD catalog', passed: false, detail: error.message });
    console.log(`LIVE CHECK UNVERIFIED: ${error.message}`);
    await live.screenshot({ path: path.join(artifacts, 'kakaku-unverified.png') }).catch(() => {});
  }
  assert.deepEqual(errors, [], 'browser script errors');
  record('no browser script errors');
} finally {
  await fs.writeFile(path.join(artifacts, 'results.json'), JSON.stringify({ browser: 'Brave / Chromium', date: new Date().toISOString(), results, errors }, null, 2));
  await context.close();
  const relativeProfile = path.relative(artifacts, profile);
  if (!relativeProfile.startsWith('..') && !path.isAbsolute(relativeProfile) && relativeProfile.startsWith('profile-')) {
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}
