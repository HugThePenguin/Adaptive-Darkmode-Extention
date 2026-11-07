import { browserOptions } from '../scripts/browser.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import '../extension/core.js';
import '../extension/support-config.js';
const root = path.resolve(import.meta.dirname, '..'), artifacts = path.join(root, '.test-artifacts');
const extension = path.join(root, 'extension'), results = [];
for (const language of ['en', 'ja']) {
  const context = await chromium.launchPersistentContext(await fs.mkdtemp(path.join(artifacts, `support-${language}-`)), {
    ...browserOptions(language), headless: true, viewport: { width: 1280, height: 900 }, locale: language === 'ja' ? 'ja-JP' : 'en-US',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run', `--lang=${language}`]
  });
  const errors = [], outgoing = [];
  const pass = name => { console.log(`PASS ${language}: ${name}`); results.push({ language, name, passed: true }); };
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route(/^https?:\/\//, route => {
    outgoing.push(route.request().url());
    assert.equal(route.request().method(), 'GET');
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{background:white;color:black}main{background:#eee}</style><main>Private text: SECRET_CONTENT<input value="SECRET_INPUT"></main>' });
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
    await worker.evaluate(() => chrome.storage.local.set({ preferences: { global: { brightness: 18, temperature: -100 }, sites: {
      'private.example.test': { mode: 'on', brightness: 24, temperature: 65, contrast: 7 }, 'other-private.example.test': { mode: 'off' }
    } } }));
    const website = await context.newPage(); await website.goto('https://private.example.test/account?token=SECRET_TOKEN');
    await website.waitForFunction(() => document.body.style.getPropertyPriority('background-color') === 'important');
    const tabId = await worker.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url?.includes('SECRET_TOKEN')).id);
    const popup = await context.newPage();
    await popup.addInitScript(({ tabId }) => { const query = chrome.tabs.query.bind(chrome.tabs); chrome.tabs.query = opts => opts.active ? chrome.tabs.get(tabId).then(tab => [tab]) : query(opts); }, { tabId });
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.waitForFunction(() => document.getElementById('support').href.includes('?tab='));
    const link = await popup.locator('#support').getAttribute('href');
    assert.equal(link, `support.html?tab=${tabId}`);
    const popupHeight = (await popup.locator('body').boundingBox()).height;
    assert.ok(popupHeight <= 600, `Popup height: ${popupHeight}`);
    await popup.locator('#support').scrollIntoViewIfNeeded();
    pass('compact popup passes only a local tab ID to Support');
    const outgoingBefore = outgoing.length;
    const support = await context.newPage(); await support.goto(`chrome-extension://${id}/${link}`);
    await support.waitForFunction(() => !document.getElementById('copyDiagnostics').disabled);
    assert.equal(await support.locator('html').getAttribute('lang'), language);
    assert.equal(outgoing.length, outgoingBefore);
    assert.equal(await support.locator('[data-sponsor-section]').isVisible(), false);
    pass('localized Support loads without external requests and hides unconfigured Sponsors');
    const json = await support.locator('#diagnostics').inputValue(), report = JSON.parse(json);
    assert.equal(report.scope, 'page'); assert.equal(report.state, 'active');
    assert.match(report.chromiumVersion, /^\d+\./);
    assert.equal(report.settings.brightness, 24); assert.equal(report.settings.temperature, 65); assert.equal(report.settings.contrast, 7);
    for (const forbidden of ['private.example', 'other-private', 'SECRET', 'token=', 'hostname', 'tabId', 'url', 'userAgent']) assert.ok(!json.includes(forbidden), json);
    pass('diagnostics include the correct site appearance but exclude URLs, page/input text and other sites');
    for (const [topic, label] of [['bug', language === 'ja' ? '不具合報告' : 'Bug Report'], ['feature', language === 'ja' ? '機能のご要望' : 'Feature Request']]) {
      const url = new URL(await support.locator(`[data-feedback="${topic}"]`).getAttribute('href'));
      assert.equal(url.origin + url.pathname, ADSupport.forms[language]);
      assert.equal(url.searchParams.get('entry.1236763802'), label);
      assert.deepEqual([...url.searchParams.keys()], ['usp', 'entry.1236763802']);
    }
    assert.equal(await support.locator('#englishForm').getAttribute('href'), ADSupport.forms.en);
    assert.equal(await support.locator('#japaneseForm').getAttribute('href'), ADSupport.forms.ja);
    const pending = support.waitForEvent('popup'); await support.locator('[data-feedback="bug"]').click(); const form = await pending;
    await form.waitForLoadState('domcontentloaded');
    assert.equal(new URL(form.url()).searchParams.get('entry.1236763802'), language === 'ja' ? '不具合報告' : 'Bug Report');
    assert.equal(await form.evaluate(() => window.opener === null), true); await form.close();
    pass('form links open the correct language and prefill only the topic');
    await support.bringToFront();
    await support.evaluate(() => { const write = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = async text => { window.copied = text; return write(text); }; });
    await support.locator('#copyDiagnostics').click();
    await support.waitForFunction(() => document.getElementById('copyStatus').textContent === chrome.i18n.getMessage('diagnosticsCopied'));
    assert.equal(await support.evaluate(() => window.copied), json);
    await support.evaluate(() => { navigator.clipboard.writeText = async () => { throw Error('Clipboard unavailable'); }; });
    await support.locator('#copyDiagnostics').click();
    await support.waitForFunction(() => document.getElementById('copyStatus').textContent === chrome.i18n.getMessage('diagnosticsManualCopy'));
    assert.ok(await support.locator('#diagnostics').evaluate(e => e.selectionEnd > e.selectionStart));
    pass('clipboard copying works without extra permissions and has a manual-copy fallback');
    const options = await context.newPage(); await options.goto(`chrome-extension://${id}/options.html`);
    await options.waitForFunction(() => !document.getElementById('controls').disabled);
    assert.equal(await options.locator('[data-feedback="bug"]').getAttribute('href'), ADSupport.formUrl(language, 'bug'));
    assert.equal(await options.locator('[data-source]').getAttribute('href'), ADSupport.sourceUrl);
    await options.locator('input[value="off"]').check();
    assert.equal(await options.locator('.help-section').isVisible(), true);
    pass('settings feedback links remain accessible when adjustments are OFF');
    const defaults = await context.newPage(); await defaults.goto(`chrome-extension://${id}/support.html?tab=not-a-number`);
    await defaults.waitForFunction(() => !document.getElementById('copyDiagnostics').disabled);
    const fallback = JSON.parse(await defaults.locator('#diagnostics').inputValue());
    assert.equal(fallback.scope, 'defaults'); assert.equal(fallback.settings.mode, 'off');
    pass('protected/missing-page context safely falls back to global settings');
    await support.setViewportSize({ width: 390, height: 850 });
    await support.locator('#diagnostics').evaluate(e => { e.blur(); e.setSelectionRange(0, 0); e.scrollTop = 0; });
    assert.ok(await support.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await support.screenshot({ path: path.join(artifacts, `support-${language}-mobile.png`), fullPage: true });
    await support.setViewportSize({ width: 1280, height: 900 });
    await support.screenshot({ path: path.join(artifacts, `support-${language}.png`), fullPage: true });
    const privacy = await context.newPage(); await privacy.goto(`chrome-extension://${id}/privacy.html`);
    assert.ok((await privacy.locator('body').innerText()).includes('Google Forms'));
    assert.ok((await privacy.locator('body').innerText()).includes('Googleフォーム'));
    assert.deepEqual(errors, []);
    pass('responsive support and updated bilingual privacy have no script errors');
  } finally { await context.close(); }
}
await fs.writeFile(path.join(artifacts, 'support-results.json'), JSON.stringify({ results }, null, 2));
