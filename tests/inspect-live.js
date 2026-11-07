import { browserOptions } from '../scripts/browser.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const profile = await fs.mkdtemp(path.join(root, '.test-artifacts/inspect-'));
const extension = path.join(root, 'extension');
const context = await chromium.launchPersistentContext(profile, { ...browserOptions(), headless: true, viewport: { width: 1280, height: 1000 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
try {
 const page = await context.newPage(); await page.goto('https://kakaku.com/pc/ssd/', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(7000);
 const data = await page.evaluate(async () => {
  const output = [];
  for(const e of document.querySelectorAll('body *')) { const r=e.getBoundingClientRect();if(r.width<100||r.height<20||r.top>innerHeight||r.bottom<0)continue;const s=getComputedStyle(e);if(!s.backgroundImage.includes('url('))continue;
   const url=s.backgroundImage.match(/url\(["']?(.+?)["']?\)/)?.[1]; if(!url)continue; const img=new Image(); const dimensions=await new Promise(resolve=>{img.onload=()=>resolve([img.naturalWidth,img.naturalHeight]);img.onerror=()=>resolve(null);img.src=url;setTimeout(()=>resolve('timeout'),3000)});
   output.push({tag:e.tagName,id:e.id,cls:e.className,rect:{width:r.width,height:r.height},bg:s.backgroundColor,image:s.backgroundImage,repeat:s.backgroundRepeat,size:s.backgroundSize,dimensions});
  } return output;
 }); console.log(JSON.stringify(data,null,2));
}finally{
 await context.close();
 const relativeProfile = path.relative(path.join(root, '.test-artifacts'), profile);
 if (!relativeProfile.startsWith('..') && !path.isAbsolute(relativeProfile) && relativeProfile.startsWith('inspect-')) await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
