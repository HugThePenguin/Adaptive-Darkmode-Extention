import { browserOptions } from '../scripts/browser.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const artifacts = path.join(root, '.test-artifacts');
const label = process.argv[2] || 'current';
const directory = await fs.mkdtemp(path.join(artifacts, `pedal-${label}-`));
const extension = path.join(directory, 'extension');
await fs.cp(path.join(root, 'extension'), extension, { recursive: true });
const source = await fs.readFile(label === 'before' ? path.join(artifacts, 'content-before-performance.js') : path.join(extension, 'content.js'), 'utf8');
// Instrument only the isolated test copy. Performance entries are visible to
// the test page without exposing extension internals or collecting page data.
let measured = source.replace('function run() {', `function run() {
 const started = performance.now();
 try { return runMeasured(); }
 finally { performance.measure('adaptive-dark-pass', { start: started, end: performance.now() }); }
 }
 function runMeasured() { performance.clearMarks('ad-phase-start');performance.mark('ad-phase-start');`);
for (const [marker, name] of [
 ['const selected = scanAll ?', 'collect'],
 ['suspend(selected);', 'select'],
 ['nativeCanvas = [255, 255, 255, 1];\n    const rootStyle', 'suspend'],
 ['for (const [e, r] of selected) if (e.isConnected) apply(e, r);', 'read'],
 ['updateSheets();\n    paintInteractions();', 'apply'],
 ['if (scanAll) stylesheetState = stylesheetSignature();', 'rules']
]) {
 measured = measured.replace(marker, `performance.measure('ad-phase-${name}', {start: performance.getEntriesByName('ad-phase-start').at(-1)?.startTime || lastRun, end:performance.now()}); performance.clearMarks('ad-phase-start');performance.mark('ad-phase-start');\n    ${marker}`);
}
await fs.writeFile(path.join(extension, 'content.js'), measured);
const context = await chromium.launchPersistentContext(path.join(directory, 'profile'), {
 ...browserOptions(),
 headless: true, viewport: { width: 1280, height: 940 },
 args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run']
});
try {
 const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
 const page = await context.newPage();
 page.setDefaultTimeout(60000);
 await page.addInitScript(() => {
  window.testLongTasks = [];
  new PerformanceObserver(list => window.testLongTasks.push(...list.getEntries().map(e => e.duration))).observe({type: 'longtask', buffered: true});
 });
 // Block advertising in this isolated profile to make before/after measurements
 // comparable. Site code, data and interaction libraries are loaded unchanged.
 await context.route(/googlesyndication|doubleclick|google-analytics/, route => route.abort());
 await page.goto('https://pedalplayground.com/', {waitUntil: 'domcontentloaded', timeout: 60000});
 await page.waitForFunction(() => document.querySelectorAll('#select-a-pedal option').length > 1000);
 await page.waitForTimeout(2000);
 const tab = await worker.evaluate(async () => (await chrome.tabs.query({})).find(t => t.url?.startsWith('https://pedalplayground.com/')).id);
 const status = () => worker.evaluate(id => chrome.tabs.sendMessage(id, {type:'AD_GET_STATUS'}, {frameId:0}), tab);
 console.log('loaded', JSON.stringify(await page.evaluate(() => ({elements:document.querySelectorAll('*').length, options:document.querySelectorAll('option').length}))), JSON.stringify(await status()));
 const summary = () => page.evaluate(() => ({passes:performance.getEntriesByName('adaptive-dark-pass').map(e=>Math.round(e.duration)), longTasks:window.testLongTasks.map(Math.round), phases:Object.fromEntries(['collect','select','suspend','read','apply','rules'].map(name=>[name,performance.getEntriesByName('ad-phase-'+name).map(e=>Math.round(e.duration))]))}));
 const clear = () => page.evaluate(() => {performance.clearMeasures();performance.clearMarks();window.testLongTasks=[];});
 const initial = await summary();
 await clear(); await page.waitForTimeout(11000); const idle = await summary();
 // Actual Select2 search menu and result rendering.
 await clear();
 await page.locator('#add-pedal .select2-selection').click();
 await page.locator('.select2-search__field').fill('Boss');
 await page.waitForTimeout(1500);
 const search = await summary();
 console.log('search', JSON.stringify(search));
 await page.keyboard.press('Escape');
 // Create a real custom board, then drag it using the site's Draggabilly.
 await page.locator('#custom-pb-width').fill('24');
 await page.locator('#custom-pb-height').fill('12');
 await page.locator('#add-custom-pedalboard input[type=submit], #add-custom-pedalboard button').click();
 await page.waitForTimeout(1000);
 const box = await page.locator('.canvas .item').last().boundingBox();
 if (!box) throw Error('Custom pedalboard was not created');
 await clear();
 await page.mouse.move(box.x + 70, box.y + 70); await page.mouse.down();
 for (let i=0; i<45; i++) {await page.mouse.move(box.x+70+i*3, box.y+70+i);await page.waitForTimeout(16);}
 await page.mouse.up(); await page.waitForTimeout(700);
 const drag = await summary();
 await page.screenshot({path:path.join(artifacts, `pedal-${label}.png`)});
 const report = {label, initial, idle, search, drag, status:await status()};
 await fs.writeFile(path.join(artifacts, `pedal-${label}-results.json`), JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
} finally {await context.close();}
