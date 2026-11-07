import { browserOptions } from '../scripts/browser.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import '../extension/core.js';
const C = globalThis.ADCore;
const root = path.resolve(import.meta.dirname, '..');
const artifacts = path.join(root, '.test-artifacts');
const directory = await fs.mkdtemp(path.join(artifacts, 'loading-'));
const extension = path.join(directory, 'extension');
await fs.cp(path.join(root, 'extension'), extension, { recursive: true });
// A suspended/cold service worker should not expose white content while the
// renderer waits for its context. Production code contains no artificial delay.
const background = await fs.readFile(path.join(extension, 'background.js'), 'utf8');
await fs.writeFile(path.join(extension, 'background.js'), background.replace('read(hostname).then', 'new Promise(resolve => setTimeout(resolve, 1500)).then(() => read(hostname)).then'));
const context = await chromium.launchPersistentContext(path.join(directory, 'profile'), {
 ...browserOptions(),
 headless: true, viewport: { width: 1280, height: 900 },
 args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run']
});
const results = [], errors = [];
const pass = (name, detail = {}) => { results.push({ name, detail, passed: true }); console.log('PASS', name, JSON.stringify(detail)); };
context.on('page', page => page.on('pageerror', e => errors.push(e.message)));
try {
 const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
 const prefs = global => worker.evaluate(global => chrome.storage.local.set({ preferences: { global } }), global);
 let release;
 await context.route('https://loading.example.test/hold.js', async route => { await new Promise(resolve => release = resolve); await route.fulfill({ contentType: 'text/javascript', body: 'window.unblocked=true;' }); });
 const html = `<!doctype html><html><head><style>html,body{margin:0;background:white;color:black;font:18px sans-serif}.content{min-height:100vh;background:#fff;color:#000}</style><script>
 window.samples=[];function sample(){const html=getComputedStyle(document.documentElement);const body=document.body&&getComputedStyle(document.body);window.samples.push({html:html.backgroundColor,body:body?.backgroundColor,at:performance.now()});requestAnimationFrame(sample)}requestAnimationFrame(sample);
 </script><script src="/hold.js"></script></head><body><main id="content" class="content"><h1>Loading fixture</h1><p>Text and photos remain visible after rendering.</p><input id="search"><img id="photo" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10'%3E%3Crect width='10' height='10' fill='red'/%3E%3C/svg%3E"></main></body></html>`;
 await context.route('https://loading.example.test/page*', route => route.fulfill({ contentType: 'text/html', body: html }));
 await prefs({ enabled: true, mode: 'auto', brightness: 28, temperature: 100 });
 const page = await context.newPage(); await page.goto('https://loading.example.test/page1', { waitUntil: 'commit' });
 await page.waitForFunction(() => window.samples && !document.body);
 const emptySamples = await page.evaluate(async () => { const values=[];for(let i=0;i<6;i++){values.push(getComputedStyle(document.documentElement).backgroundColor);await new Promise(r=>setTimeout(r,40));}return values; });
 assert.ok(emptySamples.every(bg => C.luminance(C.parse(bg)) < .15), JSON.stringify(emptySamples));
 pass('parser-blocked document has a dark canvas before body creation and service-worker response', { samples: emptySamples.length });
 release(); await page.waitForLoadState('load');
 await page.screenshot({ path: path.join(artifacts, 'loading-start.png') });
 await page.waitForFunction(() => document.documentElement.dataset.adPhase === 'active');
 const startup = await page.evaluate(() => samples.filter(s => s.body));
 assert.ok(startup.length>0);
 assert.ok(startup.every(s => C.luminance(C.parse(s.html)) < .15 && C.luminance(C.parse(s.body)) < .15), JSON.stringify(startup));
 pass('initial body frames remain dark until normal rendering takes over', { frames: startup.length });
 const tabId = await worker.evaluate(async () => (await chrome.tabs.query({})).find(t => t.url?.startsWith('https://loading.example.test/page1')).id);
 const status = () => worker.evaluate(id => chrome.tabs.sendMessage(id, { type: 'AD_GET_STATUS' }, { frameId: 0 }), tabId);
 // A SPA replaces its white body, including inline !important, between frames.
 const replacement = await page.evaluate(async () => {
  const body=document.createElement('body');body.style.cssText='margin:0;background-color:white!important;color:black!important';
  body.innerHTML='<main id="content" class="content"><h1>Changed selection</h1><div id="inline" style="min-height:300px;background-color:white!important;color:black!important">Inline surface</div></main>';
  document.body.replaceWith(body);
  const colors=[];
  for(let i=0;i<25;i++){await new Promise(requestAnimationFrame);colors.push({body:getComputedStyle(body).backgroundColor,main:getComputedStyle(document.getElementById('content')).backgroundColor,inline:getComputedStyle(document.getElementById('inline')).backgroundColor});}
  return colors;
 });
 assert.ok(replacement.every(s => Object.values(s).every(bg => C.luminance(C.parse(bg)) < .15)), JSON.stringify(replacement));
 pass('body replacement and inline important surfaces never paint white', { frames: replacement.length });
 // Content replacement happens while Japanese input is composing; the heavy
 // scan waits, while CSS provides a readable dark fallback without hiding it.
 const duringInput = await page.evaluate(async () => {
  const input=document.createElement('input');input.id='search';document.body.append(input);
  input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'あ'}));
  const section=document.createElement('section');section.id='new-content';section.className='content';section.innerHTML='<h2>New results</h2><p>Read before the full scan finishes.</p>';document.body.append(section);
  const colors=[];for(let i=0;i<20;i++){await new Promise(requestAnimationFrame);const s=getComputedStyle(section);colors.push({bg:s.backgroundColor,fg:s.color});}
  input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'あ'}));return colors;
 });
 assert.ok(duringInput.every(s => C.luminance(C.parse(s.bg)) < .15 && C.contrast(C.parse(s.fg),C.parse(s.bg)) >= 4.5));
 pass('new results stay dark and readable while IME postpones the full scan', { frames: duringInput.length });
 await page.waitForFunction(() => document.getElementById('new-content').style.getPropertyPriority('background-color') === 'important');
 await prefs({ enabled: false });
 await page.waitForFunction(() => !document.querySelector('style[data-ad-sheet]'));
 assert.equal(await page.locator('body').evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(255, 255, 255)');
 assert.equal(await page.locator('#inline').evaluate(e => e.style.getPropertyPriority('background-color')), 'important');
 assert.equal(await page.locator('html').getAttribute('data-ad-phase'), null);
 pass('global OFF removes fallback, restores original colors and preserves important declarations');
 await prefs({ enabled: true, mode: 'auto' });
 await page.evaluate(() => { document.documentElement.classList.add('dark');document.head.append(Object.assign(document.createElement('style'),{textContent:'html,body,.content{background:#151515!important;color:#eee!important}'}));document.body.style.cssText='margin:0;background:#151515!important;color:#eee!important';document.getElementById('inline').remove(); });
 const until=Date.now()+15000;while(Date.now()<until){if((await status()).state==='native')break;await new Promise(r=>setTimeout(r,80));}
 assert.equal((await status()).state,'native');
 assert.equal(await page.locator('html').evaluate(e => getComputedStyle(e).backgroundColor),'rgb(21, 21, 21)');
 assert.equal(await page.locator('body').evaluate(e => getComputedStyle(e).backgroundColor),'rgb(21, 21, 21)');
 assert.equal(await page.locator('style[data-ad-sheet]').count(),0);
 pass('native dark detection reads original colors and releases the loading fallback');
 // A second ordinary navigation gets its own document-start guard.
 await prefs({ enabled: true, mode: 'on', brightness: 10, temperature: -100 });
 await page.goto('https://loading.example.test/page2',{waitUntil:'commit'});
 await page.waitForFunction(() => window.samples && !document.body);
 assert.ok(C.luminance(C.parse(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor))) < .15);
 release();await page.waitForLoadState('load');await page.waitForFunction(() => document.documentElement.dataset.adPhase==='active');
 assert.equal(await page.locator('#photo').evaluate(e=>getComputedStyle(e).filter),'none');
 pass('new navigation receives the guard again and image colors are preserved');
 await prefs({enabled:false});
 await page.goto('https://loading.example.test/page-off',{waitUntil:'commit'});
 await page.waitForFunction(()=>window.samples && !document.body && !document.querySelector('style[data-ad-sheet]'));
 assert.equal(await page.locator('html').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
 release();await page.waitForLoadState('load');await page.waitForTimeout(100);
 const offSamples=await page.evaluate(()=>samples);
 assert.ok(offSamples.length>0 && offSamples.every(s=>C.luminance(C.parse(s.html))>.8 && (!s.body || C.luminance(C.parse(s.body))>.8)));
 pass('disabled extension releases startup CSS before the original body is first painted',{frames:offSamples.length});
 assert.deepEqual(errors,[]);
} finally { await fs.writeFile(path.join(artifacts,'loading-results.json'),JSON.stringify({date:new Date().toISOString(),results,errors},null,2));await context.close(); }
