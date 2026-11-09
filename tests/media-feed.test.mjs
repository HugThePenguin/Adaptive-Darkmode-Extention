import { browserOptions } from '../scripts/browser.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const baseline = process.argv.includes('--baseline');
const directory = await fs.mkdtemp(path.join(root, '.test-artifacts', 'media-feed-'));
const extension = path.join(directory, 'extension');
await fs.cp(path.join(root, 'extension'), extension, { recursive: true });
let source = await fs.readFile(path.join(root, baseline ? '.test-artifacts/content-before-reddit.js' : 'extension/content.js'), 'utf8');
source = source.replace('function run() {', `function run() { const start = performance.now(); try { return measuredRun(); } finally { performance.measure('ad-pass', {start, end: performance.now()}); } } function measuredRun() {`)
  .replace('output.push(e);', `performance.mark('ad-collect'); output.push(e);`);
await fs.writeFile(path.join(extension, 'content.js'), source);
if (baseline) await fs.copyFile(path.join(root, '.test-artifacts/core-before-reddit.js'), path.join(extension, 'core.js'));
const context = await chromium.launchPersistentContext(path.join(directory, 'profile'), {
  ...browserOptions(), headless: true, viewport: {width: 1280, height: 900},
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run', '--autoplay-policy=no-user-gesture-required']
});
const errors = [], report = [];
const pass = (name, detail) => { report.push({name, detail}); console.log('PASS', name, JSON.stringify(detail ?? '')); };
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const prefs = global => worker.evaluate(global => chrome.storage.local.set({preferences: {global}}), global);
  const status = page => worker.evaluate(async url => {
    const tab = (await chrome.tabs.query({})).find(t => t.url === url);
    return chrome.tabs.sendMessage(tab.id, {type: 'AD_GET_STATUS'}, {frameId: 0});
  }, page.url());
  const waitState = async (page, state) => {
    await page.waitForFunction(() => document.readyState === 'complete');
    for (let i = 0; i < 120; i++) {
      if ((await status(page)).state === state) return;
      await page.waitForTimeout(100);
    }
    assert.equal((await status(page)).state, state);
  };
  const clear = page => page.evaluate(() => {performance.clearMarks(); performance.clearMeasures();});
  const summary = page => page.evaluate(() => ({passes: performance.getEntriesByName('ad-pass').map(e => Math.round(e.duration)), collected: performance.getEntriesByName('ad-collect').length}));
  const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320"><rect width="640" height="320" fill="orange"/></svg>');
  await context.route('https://media-feed.example.test/**', route => route.fulfill({contentType:'text/html', body:`<!doctype html>
    <style>html,body{margin:0;background:#151515;color:#eee;font:18px sans-serif}html.light,html.light body{background:white;color:black}main{padding:24px}article{padding:6px;border:1px solid #777}shreddit-player,shreddit-player-2{display:block;background:transparent}#light-control{background:linear-gradient(90deg,red,blue);color:white}img{width:160px;height:80px}input{width:400px}</style>
    <main><h1>Image and video feed</h1><shreddit-player id="player"><div id="light-control">Light DOM player overlay</div></shreddit-player><shreddit-player-2 id="alternate"><button>Alternate player</button></shreddit-player-2>
    <div id="feed">${Array.from({length:1800}, (_,i)=>`<article><span>Post ${i}</span><span>Title and comments</span>${i===0?`<img src="${image}" alt="Feed photograph">`:''}</article>`).join('')}</div></main>
    <script>
    const host=document.querySelector('#player');
    host.attachShadow({mode:'open'}).innerHTML='<style>:host{display:block}video{width:320px;height:160px;background:black}.overlay{background:transparent;color:white}.progress{background:linear-gradient(90deg,red,blue);height:8px}button,input{position:relative;z-index:1}</style><video muted playsinline></video><div class="overlay"><button id="play">Play</button><input id="seek" type="range" min="0" max="100" value="0" step="1" aria-label="Seek"><div class="progress"></div><span id="time">0</span></div><slot></slot>';
    const video=host.shadowRoot.querySelector('video'), seek=host.shadowRoot.querySelector('#seek');
    host.shadowRoot.querySelector('#play').onclick=()=>{video.paused?video.play():video.pause()};
    seek.oninput=()=>{window.seekEvents=(window.seekEvents||0)+1;if(Number.isFinite(video.duration))video.currentTime=video.duration*Number(seek.value)/100};
    window.prepareVideo=async()=>{
      const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;
      const ctx=canvas.getContext('2d'), stream=canvas.captureStream(20), chunks=[];
      const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});
      const finished=new Promise(resolve=>recorder.onstop=resolve);recorder.ondataavailable=e=>chunks.push(e.data);recorder.start(100);
      for(let i=0;i<24;i++){ctx.fillStyle=i%2?'orange':'blue';ctx.fillRect(0,0,160,90);await new Promise(resolve=>setTimeout(resolve,50))}
      recorder.stop();await finished;stream.getTracks().forEach(t=>t.stop());
      video.src=URL.createObjectURL(new Blob(chunks,{type:'video/webm'}));await new Promise(resolve=>video.onloadedmetadata=resolve);
      // WebM recordings may report Infinity until the browser indexes the end.
      if(!Number.isFinite(video.duration)){video.currentTime=1e5;await new Promise(resolve=>video.onseeked=resolve);video.currentTime=0;await new Promise(resolve=>video.onseeked=resolve)}
      return {duration:video.duration};
    };
    window.postUpdates=true;
    window.startUpdates=()=>{window.running=true;let frame=0;function tick(){if(!window.running)return;frame++;host.setAttribute('playback-position',String(frame));seek.setAttribute('aria-valuenow',String(frame%100));host.shadowRoot.querySelector('.progress').style.setProperty('--progress',frame+'%');host.shadowRoot.querySelector('#time').textContent=String(frame);if(window.postUpdates)document.querySelector('#feed article').setAttribute('data-loading-stage',String(frame));requestAnimationFrame(tick)}requestAnimationFrame(tick)};
    </script>`}));
  const page = await context.newPage(); page.on('pageerror', e=>errors.push(e.message));
  await prefs({enabled:true,mode:'auto'});
  await page.goto('https://media-feed.example.test/'); await waitState(page,'native'); await page.waitForTimeout(700);
  await clear(page); await page.evaluate(()=>window.startUpdates()); await page.waitForTimeout(1700);
  const native = await summary(page);
  if (!baseline) assert.equal(native.collected,0,'Native image feed traversed all posts during media updates');
  pass(baseline?'baseline native feed work':'native image feed avoids DOM traversal',native);
  await prefs({enabled:true,mode:'off'}); await waitState(page,'off'); await page.waitForTimeout(400); await clear(page);
  await page.evaluate(()=>{const p=document.createElement('article');p.textContent='Inserted while OFF';document.querySelector('#feed').append(p)});
  await page.waitForTimeout(5400);
  const off = await summary(page);
  if (!baseline) {assert.equal(off.collected,0);assert.equal(off.passes.length,0,'OFF still scheduled renderer passes');}
  pass(baseline?'baseline OFF work':'OFF stops mutation scans, interaction work and polling',off);
  if (baseline) {console.log('BASELINE',JSON.stringify({native,off}));}
  else {
    await page.evaluate(()=>{window.running=false;window.postUpdates=false});
    await prefs({enabled:true,mode:'on'}); await waitState(page,'active');
    await page.waitForFunction(()=>document.querySelector('#feed article:last-child').hasAttribute('data-ad-rendered'));
    await page.waitForTimeout(500); await clear(page); await page.evaluate(()=>window.startUpdates()); await page.waitForTimeout(1300);
    const active = await summary(page);assert.equal(active.collected,0,'Player progress triggered page scans');
    const untouched = await page.locator('#player').evaluate(e=>({host:e.getAttribute('style'),light:e.querySelector('#light-control').getAttribute('style'),sheets:e.shadowRoot.querySelectorAll('[data-ad-sheet]').length,styles:[...e.shadowRoot.querySelectorAll('*')].filter(n=>n.hasAttribute('data-ad-rendered')).length,bg:getComputedStyle(e.shadowRoot.querySelector('.overlay')).backgroundColor,gradient:getComputedStyle(e.querySelector('#light-control')).backgroundImage}));
    assert.equal(untouched.host,null);assert.equal(untouched.light,null);assert.equal(untouched.sheets,0);assert.equal(untouched.styles,0);assert.equal(untouched.bg,'rgba(0, 0, 0, 0)');assert.ok(untouched.gradient.includes('255, 0, 0'));
    assert.equal(await page.locator('#alternate button').getAttribute('data-ad-rendered'),null);
    pass('ON preserves player hosts, light/shadow controls and progress artwork',{active,untouched});
    await page.evaluate(()=>{const e=document.createElement('div');e.id='reused-control';e.style.backgroundColor='red';e.textContent='Reused control';document.querySelector('main').append(e)});
    await page.waitForFunction(()=>document.querySelector('#reused-control').hasAttribute('data-ad-rendered'));
    await page.evaluate(()=>document.querySelector('#player').append(document.querySelector('#reused-control')));
    await page.waitForFunction(()=>!document.querySelector('#reused-control').hasAttribute('data-ad-rendered'));
    assert.equal(await page.locator('#reused-control').evaluate(e=>e.style.backgroundColor),'red');
    pass('previously painted content is restored when moved into a player');
    const prepared=await page.evaluate(()=>window.prepareVideo());assert.ok(prepared.duration>0&&Number.isFinite(prepared.duration));
    await page.locator('#player #play').click();await page.waitForTimeout(200);
    const playing=await page.locator('#player video').evaluate(e=>({paused:e.paused,time:e.currentTime}));assert.equal(playing.paused,false);assert.ok(playing.time>0);
    await page.locator('#player #play').click();assert.equal(await page.locator('#player video').evaluate(e=>e.paused),true);
    const seek=page.locator('#player #seek'),box=await seek.boundingBox();await page.mouse.click(box.x+box.width*.72,box.y+box.height/2);await page.waitForTimeout(120);
    const position=await page.locator('#player video').evaluate(e=>e.currentTime/e.duration);assert.ok(position>.5&&position<.9,String(position));
    await seek.focus();await seek.press('ArrowLeft');assert.ok(await page.evaluate(()=>window.seekEvents)>=2);
    pass('real video plays/pauses and seeks using pointer and keyboard',{duration:prepared.duration,position});
    await prefs({enabled:false});await waitState(page,'off');
    assert.equal(await page.locator('#feed article').first().evaluate(e=>e.style.cssText),'');
    assert.equal(await page.locator('#feed article').first().getAttribute('data-ad-rendered'),null);
    await page.waitForTimeout(300);await clear(page);await page.waitForTimeout(800);assert.equal((await summary(page)).passes.length,0);
    await page.locator('#player #play').click();await page.waitForTimeout(120);assert.equal(await page.locator('#player video').evaluate(e=>e.paused),false);
    pass('global OFF restores posts and leaves video playback operable');
    await page.evaluate(()=>{window.running=false;document.documentElement.classList.add('light')});
    await prefs({enabled:true,mode:'auto'});await waitState(page,'active');
    await page.waitForFunction(()=>document.querySelector('#feed article:last-child').hasAttribute('data-ad-rendered'));
    assert.notEqual(await page.locator('#feed article').first().getAttribute('style'),null);
    pass('re-enabling and native-to-light theme changes still darken the feed');
    assert.deepEqual(errors,[]);
  }
  await fs.writeFile(path.join(root,'.test-artifacts',`media-feed-${baseline?'before':'current'}-results.json`),JSON.stringify({report,errors},null,2));
} finally { await context.close(); }
