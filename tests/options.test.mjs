import { browserOptions } from '../scripts/browser.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import '../extension/core.js';
const C = globalThis.ADCore;
const root = path.resolve(import.meta.dirname, '..'), extension = path.join(root, 'extension');
const artifacts = path.join(root, '.test-artifacts');
await fs.mkdir(artifacts, { recursive: true });
const results = [];
for (const language of ['en', 'ja']) {
 const locale = language === 'ja' ? 'ja-JP' : 'en-US';
 const profile = await fs.mkdtemp(path.join(artifacts, `options-${language}-`));
 const context = await chromium.launchPersistentContext(profile, {
  ...browserOptions(),
  headless: true, viewport: { width: 1280, height: 1000 }, locale,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run', `--lang=${locale}`]
 });
 const errors = [], pass = name => { console.log(`PASS ${language}: ${name}`); results.push({ language, name, passed: true }); };
 context.on('page', page => page.on('pageerror', e => errors.push(e.message)));
 try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const t = await worker.evaluate(() => Object.fromEntries(['settingsTab', 'soundHouse', 'popupScope', 'usingDefaults', 'usingSiteSettings', 'saved', 'resetSaved', 'autoSave'].map(k => [k, chrome.i18n.getMessage(k)])));
  const legacy = { mode: 'auto', brightness: 22, contrast: 7, suppressImages: false };
  await worker.evaluate(legacy => chrome.storage.local.set({ preferences: { global: { enabled: true }, sites: { 'www.youtube.com': legacy } } }), legacy);
  const hosts = ['www.youtube.com', 'www.soundhouse.co.jp', 'plain.example.test'];
  const websites = [], tabIds = [];
  for (const host of hosts) {
   await context.route(`https://${host}/**`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><style>body{background:#fff;color:#111;font:18px sans-serif;padding:40px}.card{background:#eee;color:#222;padding:30px}</style></head><body><h1>Website fixture</h1><div class="card">Product listing</div></body></html>' }));
   const page = await context.newPage(); await page.goto(`https://${host}/`); websites.push(page);
   tabIds.push(await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, `https://${host}/`));
  }
  const prefs = async () => (await worker.evaluate(() => chrome.storage.local.get('preferences'))).preferences;
  async function wait(check, label) {
   const end = Date.now() + 15000;
   while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 70)); }
   throw Error(`Timeout: ${label}`);
  }
  const status = index => worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { type: 'AD_GET_STATUS' }, { frameId: 0 }), tabIds[index]);
  await wait(async () => (await status(2)).state === 'active', 'content ready');
  const options = await context.newPage(); await options.goto(`chrome-extension://${id}/options.html`);
  await options.waitForFunction(() => !document.getElementById('controls').disabled);
  assert.deepEqual(await options.locator('[role=tab]').allTextContents(), [t.settingsTab, 'YouTube']);
  assert.deepEqual((await prefs()).sites['www.youtube.com'], legacy);
  assert.equal(await options.locator('html').getAttribute('lang'), language);
  assert.equal(await options.locator('#saved').textContent(), t.autoSave);
  assert.equal(await options.locator('[data-i18n]').evaluateAll(es => es.filter(e => !e.textContent.trim()).length), 0);
  pass('localized options page and legacy settings load unchanged');
  async function slider(page, key, value) {
   await page.locator(`#${key}`).evaluate((e, value) => { e.value = String(value); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, value);
   await page.waitForFunction(() => document.getElementById('saved').textContent === chrome.i18n.getMessage('saved'));
  }
  await slider(options, 'brightness', 24); await slider(options, 'temperature', -40);
  await wait(async () => (await status(2)).config.brightness === 24 && (await status(0)).config.temperature === -40, 'defaults propagate');
  assert.equal((await status(0)).config.brightness, 22);
  assert.equal((await status(2)).config.temperature, -40);
  pass('global changes propagate across sites while retaining legacy overrides');
  const pageColors = () => options.evaluate(() => ({ bg: getComputedStyle(document.documentElement).backgroundColor, fg: getComputedStyle(document.documentElement).color, muted: getComputedStyle(document.querySelector('.description')).color, panel: getComputedStyle(document.querySelector('.master')).backgroundColor }));
  const expected = C.appearance({ brightness: 24, temperature: -40 });
  assert.deepEqual(C.parse((await pageColors()).bg), C.parse(expected.bg));
  assert.equal((await pageColors()).bg, await websites[2].locator('body').evaluate(e => getComputedStyle(e).backgroundColor));
  const before = await pageColors();
  await options.locator('#brightness').evaluate(e => { e.value = '28'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.notEqual((await pageColors()).bg, before.bg);
  assert.equal((await prefs()).global.brightness, 24, 'Preview must not save until slider change');
  await options.locator('#brightness').evaluate(e => e.dispatchEvent(new Event('change', { bubbles: true })));
  await options.locator('#contrast').selectOption('7');
  await wait(async () => (await prefs()).global.contrast === 7, 'contrast demo saved');
  const high = await pageColors();
  assert.ok(C.contrast(C.parse(high.muted), C.parse(high.panel)) >= 7);
  await options.locator('#contrast').selectOption('4.5');
  await wait(async () => (await prefs()).global.contrast === 4.5, 'standard contrast saved');
  const standard = await pageColors();
  assert.ok(C.contrast(C.parse(standard.muted), C.parse(standard.panel)) >= 4.5);
  assert.notEqual(high.muted, standard.muted);
  await slider(options, 'brightness', 24);
  pass('entire options page previews brightness, tone and contrast using the website color mapping');
  const popup = await context.newPage();
  await popup.addInitScript(tabId => { const query = chrome.tabs.query.bind(chrome.tabs); chrome.tabs.query = opts => opts.active ? chrome.tabs.get(tabId).then(tab => [tab]) : query(opts); }, tabIds[1]);
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.waitForFunction(() => !document.getElementById('adjustments').disabled);
  assert.equal(await popup.locator('header p').textContent(), t.popupScope);
  assert.equal(await popup.locator('#scopeStatus').textContent(), t.usingDefaults);
  assert.equal(await popup.locator('#enabled').count(), 0);
  await slider(popup, 'temperature', 100);
  await wait(async () => (await prefs()).sites['www.soundhouse.co.jp']?.temperature === 100, 'site save');
  assert.deepEqual((await prefs()).sites['www.soundhouse.co.jp'], { temperature: 100 });
  await options.waitForFunction(() => document.querySelectorAll('[role=tab]').length === 3);
  assert.deepEqual(await options.locator('[role=tab]').allTextContents(), [t.settingsTab, t.soundHouse, 'YouTube']);
  await slider(options, 'brightness', 25);
  await wait(async () => (await status(1)).config.brightness === 25, 'new site inherits');
  await popup.waitForFunction(() => document.getElementById('brightness').value === '25');
  assert.equal((await status(1)).config.temperature, 100);
  assert.equal((await status(2)).config.temperature, -40);
  assert.equal(await popup.locator('#scopeStatus').textContent(), t.usingSiteSettings);
  pass('popup edits only one site; unmodified fields continue following defaults');
  await options.locator('[data-hostname="www.soundhouse.co.jp"]').click();
  await options.waitForFunction(() => document.getElementById('globalEnable').hidden && document.getElementById('temperature').value === '100');
  assert.equal(await options.locator('[data-setting=temperature]').textContent(), t.usingSiteSettings);
  assert.equal(await options.locator('[data-setting=brightness]').textContent(), t.usingDefaults);
  await slider(options, 'brightness', 27);
  await wait(async () => (await status(1)).config.brightness === 27, 'site tab save');
  assert.equal((await status(2)).config.brightness, 25);
  // A currently open site tab must switch to defaults when asked by the popup.
  await popup.locator('#editDefaults').click();
  await options.waitForFunction(() => document.querySelector('[role=tab][aria-selected=true]').dataset.hostname === '');
  assert.ok((await worker.evaluate(() => chrome.tabs.query({}))).some(tab => tab.url?.endsWith('/options.html')));
  pass('saved-site tabs edit their own scope; Edit defaults opens the global tab');
  await options.locator('[data-hostname="www.soundhouse.co.jp"]').click();
  await options.waitForFunction(() => document.getElementById('siteHost').textContent === 'www.soundhouse.co.jp');
  await options.locator('[role=tab][aria-selected=true]').focus(); await options.keyboard.press('End');
  await options.waitForFunction(() => document.getElementById('siteHost').textContent === 'www.youtube.com');
  await options.keyboard.press('Home');
  await options.waitForFunction(() => document.querySelector('[role=tab][aria-selected=true]').dataset.hostname === '');
  pass('tab keyboard navigation selects global and website settings');
  await options.screenshot({ path: path.join(artifacts, `options-${language}.png`), fullPage: true });
  await options.locator('[data-hostname="www.soundhouse.co.jp"]').click();
  await options.waitForFunction(() => document.getElementById('siteHost').textContent === 'www.soundhouse.co.jp');
  await options.screenshot({ path: path.join(artifacts, `options-site-${language}.png`), fullPage: true });
  await options.locator('#resetSites').click();
  await wait(async () => !(await prefs()).sites['www.soundhouse.co.jp'], 'one site deleted');
  await wait(async () => (await status(1)).config.temperature === -40 && (await status(1)).config.brightness === 25, 'reset effective');
  assert.ok((await prefs()).sites['www.youtube.com']);
  await popup.waitForFunction(() => document.getElementById('scopeStatus').textContent === chrome.i18n.getMessage('usingDefaults'));
  pass('deleting one website restores current defaults without affecting other sites');
  await options.locator('#enabled').uncheck();
  await wait(async () => (await status(0)).state === 'off' && (await status(1)).state === 'off' && (await status(2)).state === 'off', 'master pause');
  assert.equal(await popup.locator('#temperature').isDisabled(), true);
  await options.locator('#enabled').check();
  await wait(async () => (await status(1)).state === 'active', 'resume');
  pass('global enable switch pauses all sites, including custom ones');
  await options.locator('#resetSites').click();
  await wait(async () => Object.keys((await prefs()).sites).length === 0, 'all sites deleted');
  await options.waitForFunction(() => document.querySelectorAll('[role=tab]').length === 1);
  assert.ok(await options.locator('#resetSites').isDisabled());
  assert.equal((await prefs()).global.brightness, 25);
  assert.equal((await prefs()).global.temperature, -40);
  await wait(async () => (await status(0)).config.brightness === 25 && (await status(0)).config.contrast === 4.5, 'legacy site reset');
  pass('delete all resets individual records, keeps global settings and removes site tabs');
  // Store values equal to the defaults remove an override rather than freezing
  // the rest of the settings, and multiple extension pages cannot lose writes.
  await Promise.all([
   options.evaluate(() => chrome.runtime.sendMessage({ type: 'AD_PATCH', scope: 'site', hostname: 'www.soundhouse.co.jp', patch: { brightness: 27 } })),
   popup.evaluate(() => chrome.runtime.sendMessage({ type: 'AD_PATCH', scope: 'site', hostname: 'other.example.test', patch: { contrast: 7 } }))
  ]);
  assert.equal((await prefs()).sites['www.soundhouse.co.jp'].brightness, 27);
  assert.equal((await prefs()).sites['other.example.test'].contrast, 7);
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'AD_PATCH', scope: 'site', hostname: 'www.soundhouse.co.jp', patch: { brightness: 25 } }));
  assert.ok(!(await prefs()).sites['www.soundhouse.co.jp']);
  pass('concurrent saves retain both sites; matching defaults removes redundant overrides');
  await options.setViewportSize({ width: 390, height: 844 });
  await options.screenshot({ path: path.join(artifacts, `options-mobile-${language}.png`), fullPage: true });
  assert.ok(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await popup.locator('body').screenshot({ path: path.join(artifacts, `options-popup-${language}.png`) });
  assert.ok((await popup.locator('body').boundingBox()).height <= 600);
  const unsupported = await context.newPage();
  await unsupported.addInitScript(() => chrome.tabs.query = async () => [{ id: -1, url: 'brave://settings/' }]);
  await unsupported.goto(`chrome-extension://${id}/popup.html`);
  assert.equal(await unsupported.locator('#editDefaults').isEnabled(), true);
  assert.equal(await unsupported.locator('#controls').evaluate(e => e.disabled), true);
  assert.deepEqual(errors, []);
  pass('responsive layout, compact popup and protected-page defaults access have no script errors');
 } finally { await context.close(); }
}
await fs.writeFile(path.join(artifacts, 'options-results.json'), JSON.stringify({ date: new Date().toISOString(), results }, null, 2));
