import { browserOptions } from '../scripts/browser.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import '../extension/core.js';
const C = globalThis.ADCore;
const root = path.resolve(import.meta.dirname, '..'), artifacts = path.join(root, '.test-artifacts');
const baseline = process.argv.includes('--before');
await fs.mkdir(artifacts, { recursive: true });
const directory = await fs.mkdtemp(path.join(artifacts, 'scroll-'));
const extension = path.join(directory, 'extension');
await fs.cp(path.join(root, baseline ? '.test-artifacts/hololive-before-extension' : 'extension'), extension, { recursive: true });
const source = await fs.readFile(path.join(extension, 'content.js'), 'utf8');
await fs.writeFile(path.join(extension, 'content.js'), source.replace('function run() {', `function run() {
  const start=performance.now();try{return measuredRun();}finally{performance.measure('adaptive-dark-pass',{start,end:performance.now()});}
}function measuredRun(){`));
const context = await chromium.launchPersistentContext(path.join(directory, 'profile'), {
  ...browserOptions(), headless: true,
  viewport: { width: 1280, height: 900 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run']
});
const report = [], errors = [];
const pass = (name, detail) => { console.log('PASS', name, JSON.stringify(detail ?? '')); report.push({ name, detail }); };
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const prefs = global => worker.evaluate(global => chrome.storage.local.set({ preferences: { global } }), global);
  await context.route('https://scroll.example.test/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
    <style>html,body{margin:0;background:white;color:black}header{height:100px}#all{background:#fafafa;padding:20px}
    article{height:160px;background:white;color:black;padding:15px;box-sizing:border-box}a{color:blue}input{background:white;color:black}
    #decor:hover::before{content:'New decoration';background:white;color:black}#decor:hover{border:2px solid white;box-shadow:0 0 5px white}
    #ancestor:hover::after{content:'Ancestor decoration';background:white;color:black}</style><header>Schedule</header>
    <main id="all" class="active"><section id="ancestor"><a id="decor" href="#">Hover detail</a><input></section><div id="shadow"></div>
    ${Array.from({ length: 80 }, (_, i) => `<article><a href="#">Stream ${i}</a><p>Schedule entry</p></article>`).join('')}</main>
    <script>window.resets=0;window.panelWrites=0;
    document.getElementById('shadow').attachShadow({mode:'open'}).innerHTML='<style>a{display:block;padding:15px;background:white;color:black}a:hover::before{content:"Shadow decoration";background:white;color:black}</style><a id="shadow-hover">Shadow control</a><input>';
    // The live site's observer also reacts to EVERY attribute on #all and
    // scrolls back to its selected stream. This reproduces that side effect.
    addEventListener('load',()=>new MutationObserver(changes=>{window.resets++;window.panelWrites+=changes.length;scrollTo(0,100)}).observe(document.getElementById('all'),{attributes:true}));</script>` }));
  await prefs({ mode: 'on' });
  const page = await context.newPage(); await page.goto('https://scroll.example.test/');
  await page.waitForFunction(() => document.querySelector('article:last-child').style.getPropertyPriority('background-color') === 'important');
  await page.waitForTimeout(900);
  await page.evaluate(() => { scrollTo(0, 100); window.resets = window.panelWrites = 0; performance.clearMeasures(); });
  await page.mouse.move(650, 700); await page.waitForTimeout(350);
  const positions = [];
  for (let i = 0; i < 4; i++) { const start = await page.evaluate(() => scrollY); await page.mouse.wheel(0, 550); await page.waitForTimeout(420); positions.push({ start, end: await page.evaluate(() => scrollY) }); }
  const measured = await page.evaluate(() => ({ resets: window.resets, writes: window.panelWrites, passes: performance.getEntriesByName('adaptive-dark-pass').map(e => e.duration) }));
  if (baseline) {
    assert.ok(measured.resets > 0); assert.ok(positions.some(p => p.end <= p.start)); pass('old version reproduces scroll resets from paint attribute writes', { positions, ...measured });
  } else {
    assert.equal(measured.resets, 0); assert.equal(measured.writes, 0); assert.ok(positions.every(p => p.end > p.start));
    pass('wheel/pointer crossings preserve scrolling without touching panel attributes', { positions, ...measured });
    await page.evaluate(() => scrollTo(0, 0)); await page.locator('#decor').hover(); await page.waitForTimeout(400);
    const decoration = await page.locator('#decor').evaluate(e => ({ bg: getComputedStyle(e, '::before').backgroundColor, border: getComputedStyle(e).borderTopColor, shadow: getComputedStyle(e).boxShadow, ancestor: getComputedStyle(e.parentElement, '::after').backgroundColor }));
    for (const value of [decoration.bg, decoration.border, decoration.ancestor]) assert.ok(C.luminance(C.parse(value)) < .15, JSON.stringify(decoration));
    assert.ok(!decoration.shadow.includes('255, 255, 255'));
    pass('new hover pseudo-elements, ancestor decorations, borders and shadows are still dark', decoration);
    await page.mouse.move(1100, 80); await page.waitForTimeout(400);
    assert.equal(await page.locator('#decor').evaluate(e => getComputedStyle(e).boxShadow), 'none');
    pass('transient hover shadows disappear again when the pointer exits');
    await page.locator('#ancestor input').focus(); await page.waitForTimeout(350); assert.equal(await page.evaluate(() => window.resets), 0);
    pass('focus changes do not write unrelated scroll containers');
    await page.locator('#shadow #shadow-hover').hover(); await page.waitForTimeout(400);
    assert.ok(C.luminance(C.parse(await page.locator('#shadow #shadow-hover').evaluate(e => getComputedStyle(e, '::before').backgroundColor))) < .15);
    assert.equal(await page.evaluate(() => window.resets), 0);
    pass('open Shadow DOM interactions paint new decorations without waking container observers');
    await worker.evaluate(() => chrome.storage.local.set({ preferences: { global: { mode: 'on' }, sites: { 'other.example.test': { brightness: 28 } } } }));
    await page.waitForTimeout(500); assert.equal(await page.evaluate(() => window.resets), 0);
    pass('settings changes on an unrelated site do not repaint this page');
    await page.locator('#all').evaluate(e => e.classList.remove('active')); await page.waitForTimeout(400);
    assert.ok(await page.evaluate(() => window.resets) >= 1);
    pass('the site remains free to react to its own actual tab changes');
    await prefs({ mode: 'off' }); await page.waitForFunction(() => !document.querySelector('style[data-ad-sheet]'));
    await page.locator('#decor').hover(); assert.equal(await page.locator('#decor').evaluate(e => getComputedStyle(e, '::before').backgroundColor), 'rgb(255, 255, 255)');
    pass('OFF restores new decoration and original styles');
  }
  if (process.argv.includes('--live')) {
    const live = await context.newPage();
    for (const mode of ['off', 'on', 'auto']) {
      await prefs({ enabled: true, mode });
      await live.goto('https://schedule.hololive.tv/', { waitUntil: 'load', timeout: 45000 });
      await live.waitForTimeout(1800);
      await live.waitForFunction(() => !window.jQuery?.('html,body').is(':animated'), null, { timeout: 15000 });
      await live.mouse.move(720, 700); await live.waitForTimeout(500);
      await live.waitForFunction(() => !window.jQuery?.('html,body').is(':animated'), null, { timeout: 15000 });
      await live.evaluate(() => { window.panelChanges=0;performance.clearMeasures();new MutationObserver(changes=>window.panelChanges+=changes.length).observe(document.getElementById('all'),{attributes:true});scrollTo(0,800); });
      await live.waitForTimeout(300);
      const positions = [];
      for (let i = 0; i < 4; i++) { const start = await live.evaluate(() => scrollY); await live.mouse.wheel(0, 650); await live.waitForTimeout(450); positions.push({ start, end: await live.evaluate(() => scrollY) }); }
      const metrics = await live.evaluate(() => ({ panelChanges: window.panelChanges, paintMs: performance.getEntriesByName('adaptive-dark-pass').map(e => e.duration), overflow: getComputedStyle(document.body).overflow }));
      if (!baseline) { assert.ok(positions.every(p => p.end > p.start), JSON.stringify({ mode, positions, metrics })); assert.equal(metrics.panelChanges, 0); }
      pass(`official Holodule page scroll: ${mode}`, { positions, ...metrics });
      await live.screenshot({ path: path.join(artifacts, `hololive-${baseline ? 'before' : 'after'}-${mode}.png`) });
    }
  }
  assert.deepEqual(errors, []);
} finally {
  await fs.writeFile(path.join(artifacts, baseline ? 'scroll-before.json' : 'scroll-report.json'), JSON.stringify({ date: new Date().toISOString(), report, errors }, null, 2));
  await context.close();
}
