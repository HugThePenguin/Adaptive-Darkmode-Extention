import { browserOptions } from '../scripts/browser.mjs';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'), artifacts=path.join(root,'.test-artifacts');
const label=process.argv[2]||'current';
const directory=await fs.mkdtemp(path.join(artifacts,`soundhouse-${label}-`));
const extension=path.join(directory,'extension');
await fs.cp(path.join(root,'extension'),extension,{recursive:true});
const source=await fs.readFile(path.join(extension,'content.js'),'utf8');
if(label==='before') await fs.writeFile(path.join(artifacts,'content-before-soundhouse.js'),source);
await fs.writeFile(path.join(extension,'content.js'),source.replace('function run() {',`function run() {
 const started=performance.now();try{return measuredRun();}finally{performance.measure('adaptive-dark-pass',{start:started,end:performance.now()});}
 } function measuredRun() {`).replace('const selected = scanAll ? records : new Map();',`performance.mark('ad-work',{detail:{full:scanAll,elements:elements.length,pending:pending.length}});
 const selected = scanAll ? records : new Map();`));
const context=await chromium.launchPersistentContext(path.join(directory,'profile'),{
 ...browserOptions(),
 headless:true,viewport:{width:1440,height:940},locale:'ja-JP',
 args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--no-first-run']
});
try{
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const page=await context.newPage();page.setDefaultTimeout(30000);
 await page.addInitScript(()=>{
  window.adMutations={};window.adLongTasks=[];
  new PerformanceObserver(list=>window.adLongTasks.push(...list.getEntries().map(e=>Math.round(e.duration)))).observe({type:'longtask',buffered:true});
  new MutationObserver(changes=>{
   for(const c of changes){const e=c.target.nodeType===1?c.target:c.target.parentElement;if(!e||e.closest('style[data-ad-sheet]'))continue;
    if(c.type==='attributes'&&c.attributeName==='style')continue;
    const key=[e.tagName,e.id,e.className,c.type,c.attributeName||''].join('|');window.adMutations[key]=(window.adMutations[key]||0)+1;
   }
  }).observe(document,{subtree:true,childList:true,attributes:true,characterData:true});
 });
 await page.goto('https://www.soundhouse.co.jp/',{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForTimeout(7000);
 const inputs=await page.locator('input').evaluateAll(es=>es.map(e=>({id:e.id,name:e.name,type:e.type,placeholder:e.placeholder,rect:{x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,width:e.getBoundingClientRect().width}})));
 console.log('INPUTS',JSON.stringify(inputs));
 console.log('PAGE',JSON.stringify({title:await page.title(),body:(await page.locator('body').textContent()).slice(0,1800)}));
 await fs.writeFile(path.join(artifacts,`soundhouse-${label}-page.html`),await page.content());
 await page.screenshot({path:path.join(artifacts,`soundhouse-${label}.png`)});
 if(!inputs.length)throw Error('Sound House returned no search controls; see saved page diagnostic');
 const tab=await worker.evaluate(async()=> (await chrome.tabs.query({})).find(t=>t.url?.startsWith('https://www.soundhouse.co.jp/')).id);
 const status=()=>worker.evaluate(id=>chrome.tabs.sendMessage(id,{type:'AD_GET_STATUS'},{frameId:0}),tab);
 console.log('STATUS',JSON.stringify(await status()));
 const summary=()=>page.evaluate(()=>({passes:performance.getEntriesByName('adaptive-dark-pass').map(e=>Math.round(e.duration)),work:performance.getEntriesByName('ad-work').map(e=>e.detail),longTasks:window.adLongTasks,mutations:Object.entries(window.adMutations).sort((a,b)=>b[1]-a[1]).slice(0,15)}));
 const clear=()=>page.evaluate(()=>{performance.clearMeasures();performance.clearMarks();window.adMutations={};window.adLongTasks=[];});
 await clear();await page.waitForTimeout(6000);const idle=await summary();console.log('IDLE',JSON.stringify(idle));
 const search=page.locator('input[type=search], input[type=text]').filter({visible:true}).first();
 await search.click();await clear();
 const started=Date.now();await search.pressSequentially('yamaha',{delay:150});await page.waitForTimeout(2000);
 const typing={wallMs:Date.now()-started,...await summary()};console.log('TYPING',JSON.stringify(typing));
 await page.screenshot({path:path.join(artifacts,`soundhouse-${label}.png`)});
 await page.locator('head').evaluate(e=>{window.adStyles=[...document.styleSheets].map(s=>({href:s.href,disabled:s.disabled}));});
 const report={label,url:page.url(),title:await page.title(),inputs,idle,typing,status:await status()};
 await fs.writeFile(path.join(artifacts,`soundhouse-${label}-results.json`),JSON.stringify(report,null,2));
}finally{await context.close();}
