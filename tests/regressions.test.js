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
const profile = await fs.mkdtemp(path.join(artifacts, 'regression-profile-'));
const extension = path.join(root, 'extension');
const context = await chromium.launchPersistentContext(profile, {
 ...browserOptions(), headless: true,
 viewport: { width: 1280, height: 940 }, locale: 'ja-JP',
 args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run']
});
const report = [], errors = [];
context.on('page', page => page.on('pageerror', e => errors.push(e.message)));
const pass = (name, detail = '') => { report.push({ name, passed: true, detail }); console.log('PASS', name, detail); };
try {
 const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
 const prefs = global => worker.evaluate(global => chrome.storage.local.set({ preferences: { global } }), global);
 const tabStatus = async page => {
  const id = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url)?.id, page.url());
  return worker.evaluate(async id => chrome.tabs.sendMessage(id, { type: 'AD_GET_STATUS' }, { frameId: 0 }), id);
 };
 async function waitState(page, state) {
  const until = Date.now() + 15000;
  while (Date.now() < until) { const s = await tabStatus(page); if (s.state === state) return s; await new Promise(r => setTimeout(r, 100)); }
  throw Error(`Expected ${state}: ${JSON.stringify(await tabStatus(page))}`);
 }
 await context.route('https://hover.example.test/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>
 body{margin:0;background:white;color:black;font:18px sans-serif;padding:60px}
 aside{background:#eee;width:280px;padding:15px}.row{display:block;color:#1676c5;padding:12px;text-decoration:none;border-bottom:1px solid #aaa}
 .row:hover,.row:focus{background:#f6f6f6!important;color:#0079d0!important}
 #gradient:hover{background-image:linear-gradient(white,#eee)!important}
 #animated{transition:background-color .35s,color .35s,transform .15s}#animated:hover{transform:translateX(2px)}
 #all{transition:all .35s}#all:hover{transform:translateX(2px)}
 #menu{display:none;background:white;color:black;padding:10px}#dropdown:hover #menu{display:block}
 </style><aside><a id="plain" class="row" href="#">モニターアーム</a><a id="gradient" class="row" href="#">タブとグラデーション</a><a id="animated" class="row" href="#">色のトランジション</a><a id="all" class="row" href="#">allのトランジション</a><div id="dropdown" class="row">非表示のメニュー<div id="menu">ホバーで表示される項目</div></div></aside>` }));
 const fixture = await context.newPage(); await fixture.goto('https://hover.example.test/'); await waitState(fixture, 'active');
 for (const selector of ['#plain', '#gradient', '#animated', '#all', '#dropdown']) {
  await fixture.mouse.move(600, 700); await fixture.waitForTimeout(350);
  await fixture.locator(selector).evaluate(e => {
   window.hoverSamples = []; window.hoverFinished = false;
   const start = performance.now();
   function sample() {
    const s = getComputedStyle(e); window.hoverSamples.push({ time: performance.now() - start, bg: s.backgroundColor, image: s.backgroundImage, fg: s.color });
    if (performance.now() - start < 650) requestAnimationFrame(sample); else window.hoverFinished = true;
   }
   requestAnimationFrame(sample);
  });
  await fixture.locator(selector).hover();
  await fixture.waitForFunction(() => window.hoverFinished);
  const frames = await fixture.evaluate(() => window.hoverSamples);
  assert.ok(frames.length >= 10);
  for (const f of frames) {
   const bg = C.parse(f.bg);
   assert.ok(bg[3] === 0 || C.luminance(bg) < .15, `${selector} flashed: ${JSON.stringify(f)}`);
   const stops = [...f.image.matchAll(/rgba?\([^)]*\)/g)].map(m => C.parse(m[0]));
   assert.ok(stops.every(c => c[3] === 0 || C.luminance(c) < .15), `${selector} gradient flashed: ${f.image}`);
  }
  if (selector === '#dropdown') {
   const bg = await fixture.locator('#menu').evaluate(e => getComputedStyle(e).backgroundColor);
   assert.ok(C.luminance(C.parse(bg)) < .15);
  }
  pass('no bright frame on hover: ' + selector, `${frames.length} frames / 650ms`);
 }
 assert.ok((await fixture.locator('#animated').evaluate(e => getComputedStyle(e).transitionProperty)).includes('transform'));
 assert.equal(await fixture.locator('#animated').evaluate(e => getComputedStyle(e).transitionDuration), '0.15s');
 await prefs({ enabled: false }); await waitState(fixture, 'off');
 assert.equal(await fixture.locator('#animated').evaluate(e => getComputedStyle(e).transitionProperty), 'background-color, color, transform');
 assert.equal(await fixture.locator('#all').evaluate(e => getComputedStyle(e).transitionProperty), 'all');
 pass('layout/transform transitions preserved; original transitions restored on OFF');
 await context.route('https://wrapper.example.test/**', route => route.fulfill({ contentType:'text/html', body:'<!doctype html><style>html,body{margin:0;color:black}main{position:fixed;inset:0;background:#222;padding:40px;font:20px sans-serif}h1,p{color:#ddd}</style><main><h1>検索結果</h1><p>サイト標準のダークテーマ</p></main>' }));
 const wrapper = await context.newPage(); await prefs({ enabled:true }); await wrapper.goto('https://wrapper.example.test/'); await waitState(wrapper,'native');
 assert.equal(await wrapper.locator('main').evaluate(e => getComputedStyle(e).backgroundColor),'rgb(34, 34, 34)');
 pass('native dark app wrapper detected without requiring html/body background');
 const live = await context.newPage();
 try {
  await live.goto('https://kakaku.com/pc/', { waitUntil: 'domcontentloaded', timeout:45000 }); await waitState(live,'active');
  const arm = live.getByRole('link', { name:'モニターアーム', exact:true }).first(); await arm.scrollIntoViewIfNeeded(); await live.waitForTimeout(1500);
  await arm.evaluate(e => { window.liveHover=[]; window.liveDone=false; const start=performance.now(); function sample(){ const s=getComputedStyle(e);window.liveHover.push({bg:s.backgroundColor,image:s.backgroundImage});if(performance.now()-start<800)requestAnimationFrame(sample);else window.liveDone=true;} requestAnimationFrame(sample); });
  await arm.hover(); await live.waitForFunction(() => window.liveDone);
  const samples = await live.evaluate(() => window.liveHover);
  assert.ok(samples.every(s => {const c=C.parse(s.bg);return c[3]===0||C.luminance(c)<.15;}), JSON.stringify(samples));
  await live.screenshot({path:path.join(artifacts,'kakaku-hover-sepia.png')});
  pass('live kakaku.com monitor-arm hover', `${samples.length} sampled frames`);
 } catch(e) { console.log('LIVE UNVERIFIED Kakaku',e.message);report.push({name:'live Kakaku hover',passed:false,detail:e.message}); }
 const ddg = await context.newPage();
 try {
  await prefs({ enabled:false });
  await ddg.goto('https://duckduckgo.com/?q=ssd&kae=d&ia=web', { waitUntil:'domcontentloaded',timeout:45000 });
  await ddg.waitForTimeout(3000);
  const baseline = await ddg.evaluate(() => ({ title:document.title, roots:[document.documentElement,document.body].map(e=>({tag:e.tagName,cls:e.className,bg:getComputedStyle(e).backgroundColor,fg:getComputedStyle(e).color})),results:document.querySelectorAll('[data-testid="result"],.result').length }));
  console.log('DDG baseline',JSON.stringify(baseline));
  await ddg.screenshot({path:path.join(artifacts,'duckduckgo-native-before.png')});
  if(!baseline.results) throw Error('Search results not received (bot verification); cannot verify real search theme');
  const original = await ddg.locator('body').evaluate(e => getComputedStyle(e).backgroundColor);
  await prefs({ enabled:true }); await waitState(ddg,'native');
  assert.equal(await ddg.locator('body').evaluate(e => getComputedStyle(e).backgroundColor),original);
  await ddg.screenshot({path:path.join(artifacts,'duckduckgo-native-after.png')});
  pass('live DuckDuckGo native dark search results kept intact',JSON.stringify(baseline));
 } catch(e) {console.log('LIVE UNVERIFIED DuckDuckGo',e.message);report.push({name:'live DuckDuckGo native',passed:false,detail:e.message});}
 assert.deepEqual(errors, []);pass('no browser script errors');
} finally {
 await fs.writeFile(path.join(artifacts,'regression-results.json'),JSON.stringify({date:new Date().toISOString(),report,errors},null,2));
 await context.close();
}
