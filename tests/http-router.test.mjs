import { browserOptions } from '../scripts/browser.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import '../extension/core.js';
const C = globalThis.ADCore;
const root = path.resolve(import.meta.dirname, '..'), artifacts = path.join(root, '.test-artifacts');
await fs.mkdir(artifacts, { recursive: true });
const before = process.argv.includes('--before');
const extension = path.join(root, before ? '.test-artifacts/router-before-extension' : 'extension');
const context = await chromium.launchPersistentContext(await fs.mkdtemp(path.join(artifacts, 'http-router-')), {
  ...browserOptions(), headless: true,
  viewport: { width: 1280, height: 900 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run', '--disable-background-networking']
});
const results = [], errors = [], requests = [];
const pass = (name, detail) => { results.push({ name, detail, passed: true }); console.log('PASS', name, JSON.stringify(detail ?? '')); };
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
const fixture = `<!doctype html><style>html{background:#fafafa;color:#111}body{margin:0;background:#f2f2f2;color:#111}main{padding:30px;background:white;color:black}input{background:white;color:black}main::before{content:'Settings';background:#eee;color:#222}</style>
  <main><h1>Router test page</h1><p id="inline" style="background:#fefefe!important;color:#222!important">Local administration</p><input id="label" value="Sample label"><table><tr><td bgcolor="#ffffff"><font color="#000000">Legacy markup</font></td></tr></table></main>`;
try {
  // Every HTTP(S) request is intercepted. No connection to a real router, no
  // authentication, no form submission and no actual router setting changes.
  await context.route(/^https?:\/\//, route => {
    const request = route.request(), url = new URL(request.url());
    requests.push({ method: request.method(), url: request.url() });
    assert.equal(request.method(), 'GET');
    if (!['192.168.11.1', '192.168.11.2', 'router.example.test'].includes(url.hostname)) return route.abort();
    if (url.pathname === '/frameset') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><style>html{background:white;color:black}</style></head><frameset cols="25%,75%"><frame src="/menu"><frame src="http://192.168.11.2/content"></frameset></html>' });
    if (url.pathname === '/iframes') return route.fulfill({ contentType: 'text/html', body: fixture + '<iframe src="/menu"></iframe><iframe srcdoc="&lt;style&gt;body{background:white;color:black}&lt;/style&gt;&lt;p&gt;Inline frame&lt;/p&gt;"></iframe>' });
    return route.fulfill({ contentType: 'text/html', body: fixture });
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const prefs = (global = {}, sites = {}) => worker.evaluate(({ global, sites }) => chrome.storage.local.set({ preferences: { global, sites } }), { global, sites });
  const status = (page, frameUrl) => worker.evaluate(async ({ url, frameUrl }) => {
    const tab = (await chrome.tabs.query({})).find(t => t.url === url);
    return chrome.tabs.sendMessage(tab.id, { type: 'AD_GET_STATUS', frameUrl }, frameUrl ? undefined : { frameId: 0 });
  }, { url: page.url(), frameUrl });
  const waitState = async (page, expected, frameUrl) => {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) { try { const s = await status(page, frameUrl); if (s?.state === expected) return s; } catch {} await page.waitForTimeout(70); }
    assert.equal((await status(page, frameUrl))?.state, expected);
  };
  const inspect = (page, selector) => page.locator(selector).first().evaluate(e => ({ bg: getComputedStyle(e).backgroundColor, fg: getComputedStyle(e).color, style: e.getAttribute('style') }));
  const original = async page => {
    const body = await inspect(page, 'body'), inline = await inspect(page, '#inline');
    assert.equal(body.bg, 'rgb(242, 242, 242)'); assert.equal(body.fg, 'rgb(17, 17, 17)'); assert.ok(!body.style);
    assert.equal(inline.bg, 'rgb(254, 254, 254)'); assert.equal(inline.fg, 'rgb(34, 34, 34)');
    assert.equal(await page.locator('#inline').evaluate(e => e.style.getPropertyPriority('background-color')), 'important');
    assert.equal(await page.locator('main').evaluate(e => getComputedStyle(e, '::before').backgroundColor), 'rgb(238, 238, 238)');
    assert.equal(await page.locator('style[data-ad-sheet]').count(), 0);
    assert.equal(await page.locator('#label').inputValue(), 'Sample label');
  };
  const page = await context.newPage();
  await prefs({ mode: 'on' }, { '192.168.11.1': { mode: 'off' } });
  await page.goto('http://192.168.11.1/');
  const capabilities = await page.evaluate(() => ({ secure: isSecureContext, randomUUID: typeof crypto.randomUUID, getRandomValues: typeof crypto.getRandomValues }));
  assert.deepEqual(capabilities, { secure: false, randomUUID: 'undefined', getRandomValues: 'function' });
  if (before) {
    await page.waitForTimeout(400);
    assert.ok(errors.some(message => message.includes('randomUUID')));
    assert.equal(await page.locator('html').getAttribute('data-ad-started'), null);
    assert.ok(C.luminance(C.parse((await inspect(page, 'body')).bg)) < .15);
    pass('1.5.3 reproduces startup failure and stuck dark CSS despite site OFF', capabilities);
  } else {
    await waitState(page, 'off'); await original(page);
    pass('HTTP private-IP site OFF releases startup CSS and preserves original colors', capabilities);
    await prefs({ mode: 'on' }); await waitState(page, 'active');
    assert.ok(C.luminance(C.parse((await inspect(page, 'body')).bg)) < .15);
    assert.match(await page.locator('html').getAttribute('data-ad-started'), /^ad-[a-f0-9]{32}$/);
    const popup = await context.newPage(), id = new URL(worker.url()).host;
    await popup.addInitScript(({ targetUrl }) => {
      const query = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = options => options.active ? query({}).then(tabs => tabs.filter(t => t.url === targetUrl)) : query(options);
    }, { targetUrl: page.url() });
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.locator('input[value="off"]').check(); await waitState(page, 'off');
    // CSS serialization may normalize spacing after a real ON/OFF round trip;
    // compare actual properties and priorities, not formatting of the string.
    assert.equal((await inspect(page, 'body')).bg, 'rgb(242, 242, 242)');
    assert.equal((await inspect(page, 'body')).fg, 'rgb(17, 17, 17)');
    assert.equal((await inspect(page, '#inline')).bg, 'rgb(254, 254, 254)');
    assert.equal((await inspect(page, '#inline')).fg, 'rgb(34, 34, 34)');
    assert.equal(await page.locator('#inline').evaluate(e => e.style.getPropertyPriority('background-color')), 'important');
    assert.equal(await page.locator('style[data-ad-sheet]').count(), 0);
    assert.equal(await page.locator('#label').inputValue(), 'Sample label');
    pass('real popup OFF restores HTTP page background/text, inline important colors and decorations');
    await page.reload(); await waitState(page, 'off'); await original(page);
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<p id="added" style="background:white;color:black">New content</p>'));
    await page.waitForTimeout(350); assert.equal((await inspect(page, '#added')).bg, 'rgb(255, 255, 255)');
    pass('saved OFF survives reload and new content remains unmodified');
    await prefs({ enabled: false, mode: 'on' }); await waitState(page, 'off');
    await page.goto('http://192.168.11.1/global-off'); await waitState(page, 'off'); await original(page);
    pass('global OFF also works on an HTTP private-IP page');
    await prefs({ mode: 'on' });
    await page.goto('http://192.168.11.1/frameset');
    for (const frame of page.frames().filter(f => f.parentFrame())) await waitState(page, 'active', frame.url());
    await prefs({ mode: 'on' }, { '192.168.11.1': { mode: 'off' } });
    for (const frame of page.frames().filter(f => f.parentFrame())) {
      const s = await waitState(page, 'off', frame.url()); assert.equal(s.hostname, '192.168.11.1');
      assert.equal(await frame.locator('body').evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(242, 242, 242)');
      assert.equal(await frame.locator('style[data-ad-sheet]').count(), 0);
    }
    pass('legacy same-origin/cross-origin frames restore using the top router site preference');
    await page.goto('http://192.168.11.1/iframes');
    for (const frame of page.frames().filter(f => f.parentFrame())) {
      await waitState(page, 'off', frame.url());
      assert.equal(await frame.locator('style[data-ad-sheet]').count(), 0);
    }
    pass('HTTP iframe and inherited-origin srcdoc both start correctly with site OFF');
    await prefs({ mode: 'on' }); await page.goto('https://router.example.test/'); await waitState(page, 'active');
    await prefs({ mode: 'off' }); await waitState(page, 'off');
    assert.equal((await inspect(page, 'body')).bg, 'rgb(242, 242, 242)');
    pass('HTTPS pages still support ON-to-OFF restoration');
    assert.deepEqual(errors, []);
  }
} finally {
  await fs.writeFile(path.join(artifacts, before ? 'http-router-before.json' : 'http-router-results.json'), JSON.stringify({ results, errors, requests }, null, 2));
  await context.close();
}
