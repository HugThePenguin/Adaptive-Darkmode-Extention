import { browserOptions } from './browser.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
const extension=path.join(root,'extension'), store=path.join(root,'store');
const {version}=JSON.parse(await fs.readFile(path.join(extension,'manifest.json'),'utf8'));
const artifacts=path.join(root,'.test-artifacts');
await fs.mkdir(artifacts,{recursive:true});
await fs.mkdir(path.join(store,'assets'),{recursive:true});
await fs.mkdir(path.join(store,'website'),{recursive:true});
await fs.copyFile(path.join(extension,'privacy.html'),path.join(store,'website','index.html'));
await fs.copyFile(path.join(extension,'privacy.css'),path.join(store,'website','privacy.css'));
await fs.copyFile(path.join(store,'source','demo.html'),path.join(store,'website','demo.html'));
await fs.copyFile(path.join(store,'source','demo.js'),path.join(store,'website','demo.js'));
await fs.copyFile(path.join(extension,'icons','icon128.png'),path.join(store,'assets','icon128.png'));
const png=async file=>'data:image/png;base64,'+(await fs.readFile(file)).toString('base64');
const icon=await png(path.join(extension,'icons','icon128.png'));
const demo=await fs.readFile(path.join(store,'source','demo.html'),'utf8');
const demoScript=await fs.readFile(path.join(store,'source','demo.js'),'utf8');
const report=[];
for(const locale of ['en-US','ja-JP']) {
 const language=locale.startsWith('ja')?'ja':'en';
 const messages=JSON.parse(await fs.readFile(path.join(extension,'_locales',language,'messages.json'),'utf8'));
 const output=path.join(store,'assets',language);await fs.mkdir(output,{recursive:true});
 const profile=await fs.mkdtemp(path.join(artifacts,`store-${language}-profile-`));
 const context=await chromium.launchPersistentContext(profile,{
  ...browserOptions(locale),
  headless:true,viewport:{width:1280,height:800},locale,
  args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--no-first-run',`--lang=${locale}`]
 });
 const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 try {
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const id=new URL(worker.url()).host;
  const actual=await worker.evaluate(()=>chrome.i18n.getMessage('@@ui_locale'));
  assert.ok(actual.startsWith(language),`${locale}: actual extension UI locale ${actual}`);
  await context.route('https://demo.adaptive-dark.test/**',route=>route.fulfill(new URL(route.request().url()).pathname.endsWith('/demo.js')?{contentType:'application/javascript',body:demoScript}:{contentType:'text/html',body:demo}));
  const page=await context.newPage();await page.goto('https://demo.adaptive-dark.test/');
  const websiteId=await worker.evaluate(async()=> (await chrome.tabs.query({})).find(t=>t.url==='https://demo.adaptive-dark.test/')?.id);
  const status=()=>worker.evaluate(id=>chrome.tabs.sendMessage(id,{type:'AD_GET_STATUS'},{frameId:0}),websiteId);
  async function waitState(state){const end=Date.now()+15000;while(Date.now()<end){if((await status()).state===state)return;await new Promise(r=>setTimeout(r,100));}throw Error(`Expected ${state}: ${JSON.stringify(await status())}`);}
  await waitState('active');
  const popup=await context.newPage();
  await popup.addInitScript(({websiteId})=>{const query=chrome.tabs.query.bind(chrome.tabs);chrome.tabs.query=o=>o.active?chrome.tabs.get(websiteId).then(t=>[t]):query(o);},{websiteId});
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.waitForFunction(()=>!document.getElementById('adjustments').disabled);
  assert.equal(await popup.locator('h1').textContent(),messages.appName.message);
  assert.equal(await popup.locator('#status').textContent(),messages.statusActive.message);
  assert.equal(await popup.locator('.hint').first().textContent(),messages.autoExplanation.message);
  assert.equal(await popup.locator('header p').textContent(),messages.popupScope.message);
  assert.equal(await popup.locator('#editDefaults').textContent(),messages.editDefaults.message);
  assert.equal(await popup.locator('html').getAttribute('lang'),language);
  const unresolved=await popup.locator('[data-i18n]').evaluateAll(es=>es.filter(e=>!e.textContent.trim()).length);assert.equal(unresolved,0);
  const shots={};
  async function capture(name){
   await page.bringToFront();await page.screenshot({path:path.join(output,`page-${name}.png`)});
   await popup.bringToFront();await popup.locator('body').screenshot({path:path.join(output,`pane-${name}.png`)});
   const box=await popup.locator('body').boundingBox();assert.ok(box.height<=600,`${language} ${name} popup too tall: ${box.height}`);
   shots[name]={page:await png(path.join(output,`page-${name}.png`)),pane:await png(path.join(output,`pane-${name}.png`)),height:box.height};
  }
  await capture('warm');
  await popup.locator('#temperature').evaluate(e=>{e.value='100';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.waitForFunction(()=>{const s=getComputedStyle(document.body);const c=s.backgroundColor.match(/[\d.]+/g).map(Number);return c[0]<c[2];});
  await popup.waitForFunction(()=>document.getElementById('saved').textContent===chrome.i18n.getMessage('saved'));
  await capture('cool');
  assert.equal((await status()).config.temperature,100);
  await popup.locator('#reset').click();await waitState('active');
  await page.locator('#siteTheme').click();await waitState('native');
  await popup.waitForFunction(()=>document.getElementById('adjustments').disabled && document.getElementById('status').textContent===chrome.i18n.getMessage('statusNative'));
  assert.equal(await popup.locator('#adjustmentReason').textContent(),messages.disabledNative.message);
  assert.equal(await worker.evaluate(id=>chrome.action.getBadgeText({tabId:id}),websiteId),messages.badgeAuto.message);
  await capture('native');
  await popup.locator('input[value=on]').check();await waitState('active');await popup.waitForFunction(()=>!document.getElementById('adjustments').disabled);
  await popup.locator('input[value=off]').check();await waitState('off');
  await popup.waitForFunction(()=>document.getElementById('status').textContent===chrome.i18n.getMessage('statusOff'));
  assert.equal(await popup.locator('#adjustmentReason').textContent(),messages.disabledSite.message);
  const privacy=await context.newPage();await privacy.goto(`chrome-extension://${id}/privacy.html`);
  assert.ok((await privacy.locator('body').textContent()).includes('penguin.x.product@gmail.com'));
  const renderer=await context.newPage();
  const jp=language==='ja';
  async function render(name,html,width=1280,height=800){await renderer.setViewportSize({width,height});await renderer.setContent(html);await renderer.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));await renderer.screenshot({path:path.join(output,name)});}
  const shell=(title,subtitle,body)=>`<!doctype html><html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;width:1280px;height:800px;background:#15120f;color:#f1e8d7;font-family:"Segoe UI","Yu Gothic UI",sans-serif;padding:38px 52px}header{display:flex;align-items:center;gap:16px;margin-bottom:22px}header img{width:56px;height:56px}h1{font-size:36px;line-height:1.15;margin:0 0 7px;font-weight:650;letter-spacing:-.8px}header p{font-size:17px;color:#c6b396;margin:0}.workspace{display:grid;grid-template-columns:760px 352px;gap:24px;align-items:start}.browser{border:1px solid #524334;border-radius:14px;overflow:hidden;background:#2b231b}.bar{height:35px;background:#31281f;color:#c9b89f;display:flex;align-items:center;gap:10px;padding:0 16px;font-size:11px}.browser>img{display:block;width:100%}.pane{display:block;width:352px;border:1px solid #5b4b38;border-radius:12px;box-shadow:0 10px 25px #0005}aside{color:#c6b396;font-size:18px;padding:22px 0;line-height:1.65;max-width:680px}.pill{display:inline-block;border:1px solid #64503a;border-radius:30px;padding:6px 14px;margin:0 8px 8px 0;font-size:13px;color:#e7c38c}footer{position:absolute;bottom:26px;left:52px;color:#9e8e77;font-size:11px}</style><header><img src="${icon}"><div><h1>${title}</h1><p>${subtitle}</p></div></header>${body}<footer>Adaptive Dark ${version} · HugThePenguin · ${jp?'ローカルのデモページで撮影した実際の拡張機能画面':'Actual extension screenshots on a local demonstration page'}</footer></html>`;
  await render('screenshot-1.png',shell(jp?'明るいページを、好みの暗さに。':'Make bright pages feel more comfortable.',jp?'暖色から寒色へ。文字の読みやすさも調整。':'Warm or cool tones. Adjustable brightness and text contrast.',`<div class="workspace"><div><div class="browser"><div class="bar">● ● ● <span>Workspace Journal · Local demo</span></div><img src="${shots.warm.page}"></div><aside><span class="pill">${jp?'サイト別に保存':'Per-site preferences'}</span><span class="pill">${jp?'画像の色を保持':'Regular images kept'}</span><span class="pill">${jp?'ブラウザ内で処理':'Local processing'}</span><br>${jp?'ページ全体を反転せず、背景と文字を調整します。':'Adjust backgrounds and text without inverting the entire page.'}</aside></div><img class="pane" src="${shots.warm.pane}"></div>`));
  await render('screenshot-2.png',shell(jp?'サイトのダークモードを、そのまま。':'Keep the website’s own dark mode.',jp?'検出時は配色を変更せず、調整項目を無効にします。':'When detected, original colors stay intact and adjustments are disabled.',`<div class="workspace"><div><div class="browser"><div class="bar">● ● ● <span>Workspace Journal · Native dark theme</span></div><img src="${shots.native.page}"></div><aside>${jp?'検出がうまくいかないときは、ON / OFFで切り替えられます。':'Use ON or OFF whenever automatic detection needs a little help.'}<br><span class="pill">${jp?'自動検出には限界があります':'Detection may not always be accurate'}</span></aside></div><img class="pane" src="${shots.native.pane}"></div>`));
  await render('promo-440x280.png',`<!doctype html><html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;width:440px;height:280px;background:#201a14;color:#f1e8d7;font-family:"Segoe UI","Yu Gothic UI",sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center}img{width:92px;height:92px}h1{font-size:${jp?'30':'34'}px;margin:10px 0 4px;letter-spacing:-.8px}p{font-size:15px;margin:0;color:#d6bf98}.line{height:3px;width:154px;background:linear-gradient(90deg,#e7bb78,#9bbef3);margin-top:21px;border-radius:4px}</style><body><img src="${icon}"><h1>${jp?'やさしいダーク':'Adaptive Dark'}</h1><p>${jp?'好みの暗さと、色の温度に。':'Dark mode, your way.'}</p><div class="line"></div></body></html>`,440,280);
  assert.deepEqual(errors,[]);
  report.push({language,actualLocale:actual,activeHeight:shots.warm.height,nativeHeight:shots.native.height,passed:true});
  console.log(`PASS ${language}: translated UI, saves, native/off status, accessibility labels, badge, privacy, ${shots.native.height}px pane; store images rendered`);
 } finally {await context.close();}
}
await fs.writeFile(path.join(artifacts,'localization-results.json'),JSON.stringify({date:new Date().toISOString(),report},null,2));
