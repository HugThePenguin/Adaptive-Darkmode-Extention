import { browserOptions } from '../scripts/browser.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import '../extension/core.js';
const C = globalThis.ADCore;
const root = path.resolve(import.meta.dirname, '..');
const directory = await fs.mkdtemp(path.join(root, '.test-artifacts/performance-'));
const extension = path.join(directory, 'extension');
await fs.cp(path.join(root, 'extension'), extension, {recursive:true});
const source = await fs.readFile(path.join(extension,'content.js'),'utf8');
await fs.writeFile(path.join(extension,'content.js'), source.replace('function run() {', `function run() {
 const started = performance.now();
 try { return measuredRun(); }
 finally { performance.measure('adaptive-dark-pass', {start:started,end:performance.now()}); }
 } function measuredRun() {`));
const context = await chromium.launchPersistentContext(path.join(directory,'profile'), {
 ...browserOptions(),
 headless:true,viewport:{width:1280,height:940},
 args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--no-first-run']
});
const results=[],errors=[];
const pass=(name,detail='')=>{results.push({name,detail,passed:true});console.log('PASS',name,detail);};
context.on('page',page=>page.on('pageerror',e=>errors.push(e.message)));
try {
 const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
 await worker.evaluate(()=>chrome.storage.local.set({preferences:{global:{mode:'on'}}}));
 await context.route('https://performance.example.test/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html>
 <style>body{margin:0;background:white;color:black;font:16px sans-serif}#panel{padding:20px;background:#eee}.card{background:white;color:black;padding:8px}.card:hover{background:#fafafa}#moving{background:white;color:black;width:100px;height:100px}#menu{width:200px}</style>
 <section id="panel"><select id="menu">${'<option>Catalogue item</option>'.repeat(9000)}</select><span id="widget" class="enabled" tabindex="0">Search</span><input id="search"><div id="moving">Draggable item</div><div id="stable">${'<div class="card">Unrelated card</div>'.repeat(800)}</div></section><div id="added"></div><div id="late-shadow"></div>
 <script>
 // Reproduce Select2's reaction to select style attributes without a CDN.
 new MutationObserver(()=>{const e=document.getElementById('widget');e.classList.add('enabled');e.setAttribute('tabindex','0');}).observe(document.getElementById('menu'),{attributes:true});
 window.unrelatedWrites=0;
 new MutationObserver(changes=>window.unrelatedWrites+=changes.length).observe(document.getElementById('stable'),{subtree:true,attributes:true,attributeFilter:['style']});
 </script>`}));
 const page=await context.newPage();await page.goto('https://performance.example.test/');
 await page.waitForFunction(()=>document.querySelector('#stable .card:last-child').style.getPropertyPriority('background-color')==='important');
 await page.waitForTimeout(600);
 const pair=selector=>page.locator(selector).first().evaluate(e=>({bg:getComputedStyle(e).backgroundColor,fg:getComputedStyle(e).color}));
 assert.equal(await page.locator('option[style]').count(),0);
 const option=await pair('option');assert.ok(C.luminance(C.parse(option.bg))<.15);assert.ok(C.contrast(C.parse(option.fg),C.parse(option.bg))>=4.5);
 pass('9,000 native options remain dark and readable without individual style writes');
 await page.evaluate(()=>{performance.clearMeasures();window.unrelatedWrites=0;});
 await page.waitForTimeout(6100);
 assert.equal(await page.evaluate(()=>performance.getEntriesByName('adaptive-dark-pass').length),0);
 pass('same-value widget attributes and unchanged five-second checks produce no idle color passes');
 await page.evaluate(async()=>{
  const e=document.getElementById('moving');
  for(let i=0;i<30;i++){e.style.transform='translate('+i+'px, 0)';e.style.left=i+'px';await new Promise(r=>setTimeout(r,16));}
 });
 await page.waitForTimeout(400);
 assert.equal(await page.evaluate(()=>performance.getEntriesByName('adaptive-dark-pass').length),0);
 pass('animation-only inline position changes do not schedule color analysis');
 await page.locator('#moving').hover();await page.waitForTimeout(500);
 assert.equal(await page.evaluate(()=>window.unrelatedWrites),0);
 pass('hovering a control leaves unrelated existing cards untouched');
 await page.evaluate(()=>{
  const e=document.createElement('a');e.id='colored-link';e.style.color='rgb(10, 80, 180)';e.textContent='New blue link';document.getElementById('panel').append(e);
 });
 await page.waitForFunction(()=>document.querySelector('#colored-link').style.getPropertyPriority('background-color')==='important');
 const link=await pair('#colored-link');
 const fill=C.parse(await page.locator('#colored-link').evaluate(e=>getComputedStyle(e).webkitTextFillColor));
 assert.ok(C.parse(link.fg)[2]>C.parse(link.fg)[0]);assert.ok(fill[2]>fill[0]);
 assert.ok(C.contrast(C.parse(link.fg),C.parse((await pair('#panel')).bg))>=4.5);
 pass('new colored links retain their hue under unchanged transformed parents');
 await page.evaluate(()=>{window.detachedCard=document.querySelector('#stable .card:last-child');window.detachedCard.remove();});
 await page.waitForFunction(()=>!window.detachedCard.style.getPropertyPriority('background-color'));
 await page.evaluate(()=>document.getElementById('stable').append(window.detachedCard));
 await page.waitForFunction(()=>window.detachedCard.style.getPropertyPriority('background-color')==='important');
 pass('detached elements are restored before reuse instead of retaining stale overrides');
 await page.evaluate(()=>{
  window.scanFrames=0;window.scanning=true;
  function frame(){if(window.scanning){window.scanFrames++;requestAnimationFrame(frame);}}requestAnimationFrame(frame);
  document.getElementById('added').innerHTML='<div class="card">New result</div>'.repeat(6000);
 });
 await page.locator('#search').fill('Typing while results are processed');
 await page.waitForFunction(()=>document.querySelector('#added .card:last-child').style.getPropertyPriority('background-color')==='important',null,{timeout:20000});
 await page.evaluate(()=>window.scanning=false);
 assert.equal(await page.locator('#search').inputValue(),'Typing while results are processed');
 assert.ok(await page.evaluate(()=>window.scanFrames)>=3);
 const last=await pair('#added .card:last-child');assert.ok(C.luminance(C.parse(last.bg))<.15);assert.ok(C.contrast(C.parse(last.fg),C.parse(last.bg))>=4.5);
 pass('6,000 inserted results yield to rendering and keyboard input while remaining readable');
 // CSSOM edits do not emit a DOM mutation. The read-only signature must still
 // detect them; late attachShadow also has no child-list record on its host.
 await page.evaluate(()=>{
  document.styleSheets[0].insertRule('#moving {background-color:rgb(240,210,190);color:rgb(30,0,0)}',document.styleSheets[0].cssRules.length);
  document.getElementById('late-shadow').attachShadow({mode:'open'}).innerHTML='<style>p{background:white;color:black}</style><p>Late shadow text</p>';
 });
 await page.waitForFunction(()=>document.querySelector('#late-shadow').shadowRoot.querySelector('p').style.getPropertyPriority('background-color')==='important',null,{timeout:12000});
 const shadow=await pair('#late-shadow p');assert.ok(C.luminance(C.parse(shadow.bg))<.15);
 const expected=C.css(C.background([240,210,190,1],18,-100));
 assert.deepEqual(C.parse((await pair('#moving')).bg),C.parse(expected));
 pass('CSSOM-only stylesheet edits and late open shadow roots are still detected');
 await worker.evaluate(()=>chrome.storage.local.set({preferences:{global:{enabled:false}}}));
 await page.waitForFunction(()=>!document.querySelector('style[data-ad-sheet]'));
 assert.equal((await pair('#moving')).bg,'rgb(240, 210, 190)');
 assert.equal(await page.locator('#moving').evaluate(e=>e.style.transform),'translate(29px, 0px)');
 assert.equal(await page.locator('option[style]').count(),0);
 pass('OFF removes all extension sheets and restores original colors without losing positions');
 assert.deepEqual(errors,[]);
} finally {
 await fs.writeFile(path.join(root,'.test-artifacts/performance-results.json'),JSON.stringify({date:new Date().toISOString(),results,errors},null,2));
 await context.close();
}
