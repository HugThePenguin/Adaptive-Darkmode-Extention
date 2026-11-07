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
const profile = await fs.mkdtemp(path.join(artifacts, 'popup-profile-'));
const extension = path.join(root, 'extension');
const context = await chromium.launchPersistentContext(profile, {
 ...browserOptions(),
 headless: true, viewport: { width: 1280, height: 940 }, locale: 'ja-JP',
 args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run']
});
const errors = [], results = [];
context.on('page', page => page.on('pageerror', e => errors.push(e.message)));
const pass = name => { results.push({ name, passed: true }); console.log('PASS', name); };
try {
 const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
 const extensionId = new URL(worker.url()).host;
 const translated=await worker.evaluate(()=>Object.fromEntries(['autoExplanation','disabledNative'].map(key=>[key,chrome.i18n.getMessage(key)])));
 await context.route('https://pane.example.test/**', route => route.fulfill({ contentType:'text/html', body:`<!doctype html><html><style>
 body{margin:0;background:white;color:#111;font:18px sans-serif;padding:40px}.card{background:#eee;color:#333;padding:30px;margin:10px}
 html.dark{color-scheme:dark}.dark body{background:#171b22;color:#ddd}.dark .card{background:#222a36;color:#eee}
 </style><body><h1>設定ペインの検証</h1><div class="card">商品一覧の背景・文字・明るさ・色温度を確認します。</div><p>サイト標準のテーマ切り替え</p></body></html>` }));
 // A v1.1 site record has no temperature; all existing settings must survive.
 await worker.evaluate(() => chrome.storage.local.set({ preferences: { global:{ enabled:true }, sites:{ 'pane.example.test':{mode:'auto',brightness:22,contrast:7,suppressImages:false} } } }));
 const page = await context.newPage(); await page.goto('https://pane.example.test/');
 const websiteId = await worker.evaluate(async () => (await chrome.tabs.query({})).find(t=>t.url==='https://pane.example.test/')?.id);
 async function status() { return worker.evaluate(async id=>chrome.tabs.sendMessage(id,{type:'AD_GET_STATUS'},{frameId:0}),websiteId); }
 async function waitState(state) {
  const end=Date.now()+15000;
  while(Date.now()<end){if((await status()).state===state)return;await new Promise(r=>setTimeout(r,100));}
  throw Error(`Expected ${state}; ${JSON.stringify(await status())}`);
 }
 await waitState('active');
 const popup = await context.newPage();
 // Reproduce a toolbar popup's originating website tab in a headless tab.
 await popup.addInitScript(({websiteId})=>{
  const query=chrome.tabs.query.bind(chrome.tabs);
  chrome.tabs.query=options=>options.active?chrome.tabs.get(websiteId).then(tab=>[tab]):query(options);
 },{websiteId});
 await page.bringToFront(); await popup.goto(`chrome-extension://${extensionId}/popup.html`);
 await popup.waitForFunction(()=>!document.getElementById('adjustments').disabled);
 assert.equal(await popup.locator('input[value=on] + span').textContent(),'ON');
 assert.equal(await popup.locator('.hint').first().textContent(),translated.autoExplanation);
 assert.ok(await popup.locator('header img').evaluate(e=>e.complete && e.naturalWidth===64));
 const manifest=await worker.evaluate(()=>chrome.runtime.getManifest());
 assert.equal(manifest.icons['128'],'icons/icon128.png');
 assert.equal(manifest.action.default_icon['64'],'icons/icon64.png');
 for(const name of ['icon128.png','icon64.png']) {
  const icon=await fs.readFile(path.join(extension,'icons',name));
  assert.equal(icon.subarray(1,4).toString(),'PNG');
 }
 pass('user icons load unchanged and requested mode labels are displayed');
 assert.equal(await popup.locator('#brightness').inputValue(),'22');
 assert.equal(await popup.locator('#contrast').inputValue(),'7');
 assert.equal(await popup.locator('#temperature').inputValue(),'-100');
 pass('v1.1 settings retained and default warm temperature adopted');
 const paneBg=()=>popup.locator('body').evaluate(()=>getComputedStyle(document.documentElement).backgroundColor);
 const pageColors=()=>page.locator('.card').evaluate(e=>({bg:getComputedStyle(e).backgroundColor,fg:getComputedStyle(e).color}));
 const warmPane=await paneBg(); const warmPage=await pageColors();
 assert.ok(C.parse(warmPane)[0]>C.parse(warmPane)[2]); assert.ok(C.parse(warmPage.bg)[0]>C.parse(warmPage.bg)[2]);
 await popup.locator('body').screenshot({path:path.join(artifacts,'pane-warm.png')});
 // input previews the pane; change commits the page/site preference.
 await popup.locator('#temperature').evaluate(e=>{e.value='100';e.dispatchEvent(new Event('input',{bubbles:true}));});
 const coolPreview=await paneBg(); assert.ok(C.parse(coolPreview)[0]<C.parse(coolPreview)[2]);
 assert.equal((await status()).config.temperature,-100);
 await popup.locator('#temperature').evaluate(e=>e.dispatchEvent(new Event('change',{bubbles:true})));
 await page.waitForFunction(()=>{const s=getComputedStyle(document.querySelector('.card'));const v=s.backgroundColor.match(/[\d.]+/g).map(Number);return v[0]<v[2];});
 assert.equal((await status()).config.temperature,100);
 const coolPage=await pageColors(); assert.ok(C.contrast(C.parse(coolPage.fg),C.parse(coolPage.bg))>=7);
 await popup.locator('body').screenshot({path:path.join(artifacts,'pane-cool.png')});
 pass('temperature slider previews pane immediately and saves matching page colors');
 await popup.reload(); await popup.waitForFunction(()=>!document.getElementById('adjustments').disabled);
 assert.equal(await popup.locator('#temperature').inputValue(),'100'); assert.equal(await paneBg(),coolPreview);
 await popup.locator('#temperature').evaluate(e=>{e.value='0';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));});
 await page.waitForFunction(()=>{const v=getComputedStyle(document.querySelector('.card')).backgroundColor.match(/[\d.]+/g).map(Number);return v[0]===v[2];});
 const neutralPane=C.parse(await paneBg()); assert.equal(neutralPane[0],neutralPane[2]);
 await popup.locator('body').screenshot({path:path.join(artifacts,'pane-neutral.png')});
 pass('temperature persists on reopening and midpoint is neutral');
 await popup.locator('input[name=mode][value=off]').check();
 assert.ok(await popup.locator('#temperature').isDisabled());
 assert.ok(await popup.locator('#brightness').isDisabled());
 assert.ok(await popup.locator('#contrast').isDisabled());
 assert.ok(await popup.locator('#suppressImages').isDisabled());
 assert.ok(await popup.locator('#rescan').isDisabled());
 assert.equal(await popup.locator('input[name=mode][value=on]').isEnabled(),true);
 assert.equal(await popup.locator('#reset').isEnabled(),true);
 await waitState('off');
 await popup.waitForFunction(()=>getComputedStyle(document.documentElement).backgroundColor==='rgb(255, 255, 255)');
 await popup.locator('body').screenshot({path:path.join(artifacts,'pane-off.png')});
 const lightText=await popup.locator('body').evaluate(()=>getComputedStyle(document.documentElement).color);
 assert.ok(C.contrast(C.parse(lightText),C.parse(await paneBg()))>=4.5);
 pass('OFF uses the unmodified light site background with readable pane text');
 const storedBefore=await worker.evaluate(()=>chrome.storage.local.get('preferences'));
 await popup.locator('body').evaluate(e=>{e.tabIndex=-1;e.focus();});
 await popup.locator('#temperature').focus(); await popup.keyboard.press('ArrowLeft');
 assert.notEqual(await popup.evaluate(()=>document.activeElement.id),'temperature');
 assert.deepEqual(await worker.evaluate(()=>chrome.storage.local.get('preferences')),storedBefore);
 pass('forced OFF disables all unused inputs immediately and preserves preferences');
 await popup.locator('input[name=mode][value=auto]').check(); await waitState('active');
 await popup.waitForFunction(()=>!document.getElementById('adjustments').disabled);
 await page.evaluate(()=>document.documentElement.classList.add('dark')); await waitState('native');
 await popup.waitForFunction(()=>document.getElementById('adjustments').disabled);
 assert.ok(await popup.locator('#temperature').isDisabled());
 assert.equal(await popup.locator('#adjustmentReason').textContent(),translated.disabledNative);
 assert.equal(await popup.locator('#temperature').inputValue(),'0');
 assert.deepEqual((await status()).siteBackground,[23,27,34,1]);
 await popup.waitForFunction(()=>getComputedStyle(document.documentElement).backgroundColor==='rgb(29, 33, 40)');
 assert.equal(await page.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(23, 27, 34)');
 await popup.locator('body').screenshot({path:path.join(artifacts,'pane-native.png')});
 // A native theme may change its color without leaving the native state.
 await page.locator('body').evaluate(e=>e.style.backgroundColor='#282016');
 await popup.waitForFunction(()=>getComputedStyle(document.documentElement).backgroundColor==='rgb(46, 38, 28)');
 assert.ok(await popup.locator('#temperature').isDisabled());
 pass('native pane is slightly brighter than the site and follows native background changes');
 await popup.locator('input[name=mode][value=on]').check(); await waitState('active');
 await popup.waitForFunction(()=>!document.getElementById('adjustments').disabled);
 pass('automatic native detection grays out settings; forced ON re-enables them');
 const options=await context.newPage();await options.goto(`chrome-extension://${extensionId}/options.html`);
 await options.waitForFunction(()=>!document.getElementById('controls').disabled);
 await options.locator('#enabled').uncheck();
 await popup.waitForFunction(()=>document.getElementById('adjustments').disabled);
 assert.ok(await popup.locator('#temperature').isDisabled()); await waitState('off');
 await options.locator('#enabled').check(); await waitState('active');
 await popup.waitForFunction(()=>!document.getElementById('adjustments').disabled);
 await popup.locator('#reset').click();
 await popup.waitForFunction(()=>document.getElementById('temperature').value==='-100');
 await waitState('native'); await popup.waitForFunction(()=>document.getElementById('adjustments').disabled);
 await popup.waitForFunction(()=>getComputedStyle(document.documentElement).backgroundColor==='rgb(46, 38, 28)');
 assert.ok(C.parse(await paneBg())[0]>C.parse(await paneBg())[2]);
 pass('global OFF gating and reset return to warm defaults without losing native detection');
 const dimensions=await popup.locator('body').boundingBox();
 assert.ok(dimensions.height<=600, `Popup exceeds Chrome's 600px height limit: ${dimensions.height}`);
 const spacing=await popup.locator('.hint').first().evaluate(e=>({line:getComputedStyle(e).lineHeight,font:getComputedStyle(e).fontSize}));
 assert.ok(parseFloat(spacing.line)/parseFloat(spacing.font)<1.6);
 pass(`compact pane rendered: ${Math.round(dimensions.width)} x ${Math.round(dimensions.height)} px`);
 assert.deepEqual(errors,[]); pass('no popup or content script errors');
} finally {
 await fs.writeFile(path.join(artifacts,'popup-results.json'),JSON.stringify({date:new Date().toISOString(),results,errors},null,2));
 await context.close();
}
