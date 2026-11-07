import { browserOptions } from '../scripts/browser.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..');
const artifacts = path.join(root, '.test-artifacts');
await fs.mkdir(artifacts, { recursive: true });
const baseline = process.argv.includes('--baseline');
const extension = path.join(root, baseline ? '.test-artifacts/native-before-extension' : 'extension');
const context = await chromium.launchPersistentContext(await fs.mkdtemp(path.join(artifacts, 'native-stability-')), {
  ...browserOptions(),
  headless: true, viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run']
});
const report = [];
const pass = (name, detail) => { report.push({ name, detail }); console.log('PASS', name, JSON.stringify(detail ?? '')); };
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const prefs = global => worker.evaluate(global => chrome.storage.local.set({ preferences: { global } }), global);
  const status = async page => worker.evaluate(async url => {
    const tab = (await chrome.tabs.query({})).find(t => t.url === url);
    return chrome.tabs.sendMessage(tab.id, { type: 'AD_GET_STATUS' }, { frameId: 0 });
  }, page.url());
  const waitState = async (page, expected) => {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) { if ((await status(page)).state === expected) return; await page.waitForTimeout(80); }
    assert.equal((await status(page)).state, expected);
  };
  await context.route('https://stability.example.test/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
    <style>html,body{margin:0;background:white;color:black}main{background:transparent}
    section{height:1300px;box-sizing:border-box;padding:80px;background:white;color:black}
    section:nth-child(even){background:#151515;color:#eee}
    html.dark,html.dark body,html.dark section{background:#151515;color:#eee;color-scheme:dark}
    .native, .native body{background:#151515;color:#eee} .native section:first-child{background:#151515;color:#eee}
    </style><main>${Array.from({ length: 6 }, (_, i) => `<section><h1>Section ${i}</h1><p>Readable content with a different local background.</p></section>`).join('')}</main>
    <script>addEventListener('scroll',()=>{document.body.classList.toggle('header-hide',scrollY>200);document.body.classList.toggle('scroll-up',scrollY%2600<1300)});</script>` }));
  await prefs({ enabled: true, mode: 'auto' });
  const page = await context.newPage(); await page.goto('https://stability.example.test/'); await waitState(page, 'active');
  // Observe actual renderer changes, including short-lived changes between
  // status samples. Continuous scrolling mutates sticky-header body classes.
  await page.evaluate(() => {
    window.phases = [];
    new MutationObserver(() => window.phases.push(document.documentElement.getAttribute('data-ad-phase') || 'native')).observe(document.documentElement, { attributes: true, attributeFilter: ['data-ad-phase'] });
  });
  const states = [];
  for (const y of [1400, 2700, 4000, 5300, 6600, 5300, 4000, 2700, 1400, 0]) {
    await page.evaluate(y => scrollTo(0, y), y); await page.waitForTimeout(380); states.push((await status(page)).state);
  }
  const transitions = states.filter((s, i) => s !== (i ? states[i - 1] : 'active')).length;
  if (baseline) { assert.ok(transitions >= 4, JSON.stringify(states)); pass('old version reproduces viewport-dependent mode changes', { states, transitions }); }
  else {
    assert.ok(states.every(s => s === 'active'), JSON.stringify(states));
    assert.ok(!(await page.evaluate(() => window.phases)).includes('native'));
    pass('mixed sections and sticky-header mutations keep active detection stable', { scrolls: states.length, transitions });
    // Resize and hash links only change the visible area, not the page theme.
    await page.evaluate(() => { scrollTo(0, 1400); location.hash = 'section-1'; });
    await page.setViewportSize({ width: 1040, height: 780 }); await page.waitForTimeout(600); assert.equal((await status(page)).state, 'active');
    await prefs({ enabled: true, mode: 'auto', brightness: 24, temperature: 90, contrast: 7 }); await page.waitForTimeout(600); assert.equal((await status(page)).state, 'active');
    pass('resize, anchor navigation and appearance settings preserve the decision');
    const rescan = () => worker.evaluate(async url => {
      const tab = (await chrome.tabs.query({})).find(t => t.url === url);
      return chrome.tabs.sendMessage(tab.id, { type: 'AD_RESCAN' }, { frameId: 0 });
    }, page.url());
    await rescan(); await waitState(page, 'native');
    await page.evaluate(() => scrollTo(0, 0)); await rescan(); await waitState(page, 'active');
    pass('explicit rescan refreshes the retained decision');
    await page.evaluate(() => document.documentElement.classList.add('dark')); await waitState(page, 'native');
    assert.equal(await page.locator('section').first().evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(21, 21, 21)');
    await page.evaluate(() => { scrollTo(0, 0); document.documentElement.classList.remove('dark'); }); await waitState(page, 'active');
    pass('real site-wide dark/light theme changes still take effect');
    await page.evaluate(() => { document.documentElement.classList.add('native'); scrollTo(0, 0); }); await waitState(page, 'native');
    await page.evaluate(() => window.phases.length = 0);
    for (const y of [2700, 5300, 2700, 0]) { await page.evaluate(y => scrollTo(0, y), y); await page.waitForTimeout(400); assert.equal((await status(page)).state, 'native'); }
    await page.evaluate(() => scrollTo(0, 2700)); await page.waitForTimeout(5400); assert.equal((await status(page)).state, 'native');
    assert.ok(!(await page.evaluate(() => window.phases)).includes('active'));
    pass('native detection stays stable on light sections and across polling');
    // App background changes without a root marker must still be detected.
    await context.route('https://app-stability.example.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>html,body{margin:0}main{position:fixed;inset:0;background:#222;color:#eee;padding:30px}</style><main><h1>Dark app</h1><p>Readable native theme</p></main>' }));
    const app = await context.newPage(); await app.goto('https://app-stability.example.test/'); await waitState(app, 'native');
    await app.locator('main').evaluate(e => { e.style.backgroundColor = '#fff'; e.style.color = '#000'; }); await waitState(app, 'active');
    pass('unmarked app-wrapper theme switches remain detectable');
    await prefs({ enabled: true, mode: 'on' }); await waitState(page, 'active');
    await prefs({ enabled: true, mode: 'off' }); await waitState(page, 'off');
    pass('explicit ON/OFF override cached automatic detection');
    await prefs({ enabled: true, mode: 'auto' }); await waitState(page, 'native');
    await page.evaluate(() => history.pushState({}, '', '/new-route')); await page.waitForTimeout(5500); await waitState(page, 'active');
    pass('SPA route changes re-evaluate the new page');
  }
  if (process.argv.includes('--live')) {
    await prefs({ enabled: true, mode: 'auto' });
    const live = await context.newPage();
    const url = 'https://toyotagazooracing.com/jp/gr/cp-gr/gryaris_26_01/';
    await live.goto(url, { waitUntil: 'load', timeout: 45000 }); await live.waitForTimeout(1000);
    const initial = (await status(live)).state; assert.ok(['native', 'active'].includes(initial));
    await live.evaluate(() => { window.states = []; new MutationObserver(() => { const phase = document.documentElement.getAttribute('data-ad-phase'); if (phase !== 'analyzing') window.states.push(phase || 'native'); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-ad-phase'] }); });
    const height = await live.evaluate(() => document.documentElement.scrollHeight);
    const liveStates = [];
    for (const y of [...Array.from({ length: 13 }, (_, i) => (height - 900) * i / 12), ...Array.from({ length: 13 }, (_, i) => (height - 900) * (12 - i) / 12)]) {
      await live.evaluate(y => scrollTo(0, y), y); await live.waitForTimeout(400); liveStates.push((await status(live)).state);
    }
    await live.waitForTimeout(5400); liveStates.push((await status(live)).state);
    assert.ok(liveStates.every(s => s === initial), JSON.stringify(liveStates));
    const phases = await live.evaluate(() => window.states);
    assert.ok(!phases.includes(initial === 'native' ? 'active' : 'native'), JSON.stringify(phases));
    await live.screenshot({ path: path.join(artifacts, 'toyota-stable.png') });
    pass('official GR Yaris page keeps one decision through down/up scrolling and polling', { initial, checks: liveStates.length, height });
  }
  await fs.writeFile(path.join(artifacts, baseline ? 'native-stability-before.json' : 'native-stability-report.json'), JSON.stringify(report, null, 2));
} finally { await context.close(); }
