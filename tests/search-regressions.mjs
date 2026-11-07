import { browserOptions } from '../scripts/browser.mjs';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import '../extension/core.js';
const C=globalThis.ADCore;
const root=path.resolve(import.meta.dirname,'..'), artifacts=path.join(root,'.test-artifacts');
const label=process.argv[2]||'current';
const directory=await fs.mkdtemp(path.join(artifacts,`search-${label}-`));
const extension=path.join(directory,'extension');await fs.cp(path.join(root,'extension'),extension,{recursive:true});
const source=await fs.readFile(label==='before'?path.join(artifacts,'content-before-soundhouse.js'):path.join(extension,'content.js'),'utf8');
await fs.writeFile(path.join(extension,'content.js'),source.replace('function run() {',`function run() { const started=performance.now();try{return measuredRun();}finally{performance.measure('adaptive-dark-pass',{start:started,end:performance.now()});} } function measuredRun() {`).replace('const selected = scanAll ? records : new Map();',`performance.mark('ad-work',{detail:{full:scanAll,elements:elements.length,pending:pending.length}}); const selected = scanAll ? records : new Map();`));
const context=await chromium.launchPersistentContext(path.join(directory,'profile'),{
 ...browserOptions(),
 headless:true,viewport:{width:1280,height:940},locale:'ja-JP',
 args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--no-first-run']
});
const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
try{
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 await context.route('https://search.example.test/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html>
 <style>body{margin:0;background:white;color:black;font:18px sans-serif}header{background:#fafafa;padding:20px;border-bottom:1px solid #444;transition:border-color .3s}header:focus-within{border-bottom-color:white}.line{height:1px;background:#555;transition:background .3s}.line:focus-within,.line:hover{background:white}.pseudo-line::after{content:'';display:block;height:1px;border-bottom:1px solid #444;transition:all .3s}.pseudo-line:hover::after{border-color:white}input{background:white;color:black}.suggestions{background:white;color:black}.status::before{content:'検索';display:inline-block;background:white;color:black;transition:all .3s}.status:hover::before{background:#eee;color:#444}.card{background:white;color:black;padding:3px}.banner{background:#fafafa;transition:opacity .1s;width:200px;height:40px}</style>
 <header><input id="search" placeholder="キーワードを入力" aria-label="商品検索"><span class="status" id="status">候補</span><ul class="suggestions" id="suggestions"></ul><div id="spinner">読み込み中</div></header><div class="line" id="line"></div><div class="pseudo-line" id="pseudo-line"></div><div class="banner" id="banner">バナー</div><main id="catalog">${'<div class="card">商品と価格</div>'.repeat(5000)}</main>
 <script>
 window.colorSamples=[];window.sampling=false;window.catalogWrites=0;window.inputTimes=[];window.globalChanges=false;
 new MutationObserver(changes=>window.catalogWrites+=changes.length).observe(document.getElementById('catalog'),{subtree:true,attributes:true,attributeFilter:['style']});
 document.getElementById('search').addEventListener('input',e=>{
  window.inputTimes.push(performance.now());
  if(window.globalChanges){let sheet=document.getElementById('live-css');if(!sheet){sheet=document.createElement('style');sheet.id='live-css';document.head.append(sheet)}sheet.textContent='.card{border-top:1px solid rgb('+(120+e.target.value.length%3)+',120,120)}';}
  e.target.setAttribute('aria-activedescendant','candidate-'+e.target.value.length);
  const script=document.createElement('script');script.textContent='void 0;';document.head.append(script);script.remove();
  document.getElementById('suggestions').innerHTML='<li>候補 '+e.target.value+'</li><li>関連商品</li>';
  document.getElementById('spinner').style.display=e.target.value.length%2?'none':'block';
  const hint=document.createElement('div');hint.textContent='新しい候補';hint.className='suggestions';document.body.append(hint);setTimeout(()=>hint.remove(),100);
 });
 window.animate=false;window.animationFrame=0;
 function animateStep(){if(!window.animate)return;const banner=document.getElementById('banner');banner.style.opacity=String(.75+(window.animationFrame++%20)/100);requestAnimationFrame(animateStep);}
 window.startAnimation=()=>{window.animate=true;requestAnimationFrame(animateStep)};
 window.startSampling=()=>{window.sampling=true;window.colorSamples=[];function sample(){if(!window.sampling)return;const e=document.getElementById('status');window.colorSamples.push({bg:getComputedStyle(e,'::before').backgroundColor,fg:getComputedStyle(e,'::before').color,border:getComputedStyle(document.querySelector('header')).borderBottomColor,line:getComputedStyle(document.getElementById('line')).backgroundColor,pseudoBorder:getComputedStyle(document.getElementById('pseudo-line'),'::after').borderBottomColor});requestAnimationFrame(sample)}requestAnimationFrame(sample)};
 </script>`}));
 const page=await context.newPage();await page.goto('https://search.example.test/');
 await page.waitForFunction(()=>document.querySelector('#catalog .card:last-child').style.getPropertyPriority('background-color')==='important');
 await page.waitForTimeout(700);
 const summary=()=>page.evaluate(()=>({passes:performance.getEntriesByName('adaptive-dark-pass').map(e=>Math.round(e.duration)),work:performance.getEntriesByName('ad-work').map(e=>({...e.detail,at:e.startTime})),catalogWrites:window.catalogWrites}));
 const clear=()=>page.evaluate(()=>{performance.clearMeasures();performance.clearMarks();window.catalogWrites=0;});
 await clear();await page.evaluate(()=>window.startAnimation());await page.waitForTimeout(1500);const animation=await summary();
 console.log('ANIMATION',JSON.stringify(animation));
 await clear();await page.evaluate(()=>window.startSampling());await page.locator('#search').click();
 const started=Date.now();await page.locator('#search').pressSequentially('yamaha123',{delay:80});await page.waitForTimeout(600);
 const typing={wallMs:Date.now()-started,...await summary()};console.log('TYPING',JSON.stringify(typing));
 await page.evaluate(()=>{window.animate=false;window.sampling=false;});
 const samples=await page.evaluate(()=>window.colorSamples);
 const brightFrames=samples.filter(s=>C.luminance(C.parse(s.bg))>=.15).length;
 const textVariants=new Set(samples.map(s=>s.fg)).size;
 const brightBorders=samples.filter(s=>C.luminance(C.parse(s.border))>=.15||C.luminance(C.parse(s.pseudoBorder))>=.15).length;
 const borderVariants=new Set(samples.map(s=>s.border)).size;
 const report={label,animation,typing,frames:samples.length,brightFrames,textVariants,brightBorders,borderVariants,errors};
 await fs.writeFile(path.join(artifacts,`search-${label}-results.json`),JSON.stringify(report,null,2));
 if(label!=='before'){
  assert.equal(animation.work.filter(w=>w.full).length,0,'Opacity animation triggered full scans');
  assert.equal(typing.work.filter(w=>w.full).length,0,'Suggestion and script updates triggered full scans');
  assert.equal(typing.catalogWrites,0,'Typing rewrote unrelated catalog cards');
  assert.equal(brightFrames,0,'Pseudo-element flashed bright during typing');
  assert.equal(textVariants,1,'Pseudo-element text color oscillated during typing');
  assert.equal(brightBorders,0,'Header or pseudo border flashed during typing');
  assert.equal(borderVariants,1,'Header separator changed color during typing');
  assert.equal(await page.locator('#search').inputValue(),'yamaha123');
  await page.evaluate(()=>{window.globalChanges=true;window.inputTimes=[];});await clear();
  await page.locator('#search').pressSequentially('456',{delay:70});
  await page.waitForFunction(()=>document.querySelector('#catalog .card:last-child').style.getPropertyPriority('border-top-color')==='important');
  const deferred=await summary(), inputs=await page.evaluate(()=>window.inputTimes);
  const fullWork=deferred.work.filter(w=>w.full);
  assert.ok(fullWork.length>=1,'Real stylesheet changes were never processed');
  assert.ok(fullWork.every(w=>w.at-Math.max(...inputs.filter(t=>t<=w.at))>=179),'Global scan interrupted active typing');
  const card=await page.locator('#catalog .card:last-child').evaluate(e=>({bg:getComputedStyle(e).backgroundColor,fg:getComputedStyle(e).color,border:e.style.getPropertyPriority('border-top-color')}));
  assert.equal(card.border,'important');assert.ok(C.contrast(C.parse(card.fg),C.parse(card.bg))>=4.5);
  console.log('PASS large stylesheet updates wait for typing to pause and are then applied');
  await clear();await page.locator('#search').evaluate(e=>e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'あ'})));
  await page.evaluate(()=>document.getElementById('live-css').textContent='.card{border-top:1px solid #999}');await page.waitForTimeout(400);
  assert.equal((await summary()).work.filter(w=>w.full).length,0,'Full scan ran during IME composition');
  await page.locator('#search').evaluate(e=>e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'あ'})));
  await page.waitForFunction(()=>performance.getEntriesByName('ad-work').some(e=>e.detail.full),null,{timeout:2000});
  console.log('PASS IME conversion postpones global analysis until composition ends');
  await worker.evaluate(()=>chrome.storage.local.set({preferences:{global:{enabled:false}}}));
  await page.waitForFunction(()=>!document.querySelector('style[data-ad-sheet]'));
  assert.equal(await page.locator('#banner').evaluate(e=>getComputedStyle(e).transitionProperty),'opacity');
  assert.equal(await page.locator('#status').evaluate(e=>getComputedStyle(e,'::before').transitionProperty),'all');
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('header')).borderBottomColor==='rgb(255, 255, 255)');
  assert.deepEqual(errors,[]);
  console.log('PASS opacity animation, search suggestions, script insertion, unrelated cards, stable pseudo colors, input and OFF restoration');
 }
}finally{await context.close();}
