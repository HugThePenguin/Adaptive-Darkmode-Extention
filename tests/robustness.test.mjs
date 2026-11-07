import { browserOptions } from '../scripts/browser.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..'), artifacts = path.join(root, '.test-artifacts');
await fs.mkdir(artifacts, { recursive: true });
const extension = path.join(root, 'extension');
const context = await chromium.launchPersistentContext(await fs.mkdtemp(path.join(artifacts, 'robustness-')), {
  ...browserOptions(), headless: true,
  viewport: { width: 1280, height: 900 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run']
});
const results = [], errors = [];
const pass = (name, detail) => { console.log('PASS', name, JSON.stringify(detail ?? '')); results.push({ name, detail }); };
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  await worker.evaluate(() => chrome.storage.local.set({ preferences: null }));
  await context.route('https://robustness.example.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>html,body{background:white;color:black}main{background:#eee}</style><main><p>Readable fixture</p></main>' }));
  const page = await context.newPage(); await page.goto('https://robustness.example.test/');
  await page.waitForFunction(() => document.querySelector('p').style.getPropertyPriority('background-color') === 'important');
  const options = await context.newPage(); await options.goto(`chrome-extension://${id}/options.html`);
  await options.waitForFunction(() => !document.getElementById('controls').disabled);
  assert.equal(await options.locator('#brightness').inputValue(), '18');
  pass('null storage loads defaults in both the website and options page');
  const patch = value => options.evaluate(value => chrome.runtime.sendMessage({ type: 'AD_PATCH', ...value }), value);
  assert.equal((await patch({ scope: 'global', patch: { temperature: 45 } })).ok, true);
  const replies = await Promise.all([
    patch({ scope: 'site', hostname: 'first.example.test', patch: { brightness: 23 } }),
    patch({ scope: 'site', hostname: 'second.example.test', patch: { mode: 'off' } }),
    patch({ scope: 'global', patch: { contrast: 7 } })
  ]);
  assert.ok(replies.every(r => r.ok));
  const preferences = (await worker.evaluate(() => chrome.storage.local.get('preferences'))).preferences;
  assert.equal(preferences.global.temperature, 45); assert.equal(preferences.global.contrast, 7);
  assert.equal(preferences.sites['first.example.test'].brightness, 23); assert.equal(preferences.sites['second.example.test'].mode, 'off');
  pass('save repairs malformed storage and concurrent global/site updates retain every change');
  await worker.evaluate(() => chrome.storage.local.set({ preferences: { global: null, sites: { 'robustness.example.test': null, invalid: 'text', broken: [] } } }));
  await options.waitForFunction(() => document.getElementById('brightness').value === '18');
  assert.deepEqual(await options.locator('[role=tab]').allTextContents(), [await worker.evaluate(() => chrome.i18n.getMessage('settingsTab'))]);
  pass('invalid site records do not break settings tabs or effective page settings');
  await page.evaluate(() => {
    const head = document.createElement('head');
    head.innerHTML = '<style>html,body,main,p{background:white;color:black}p::before{content:"New pseudo";background:white;color:black}</style>';
    document.head.replaceWith(head);
  });
  await page.waitForFunction(() => {
    const color = getComputedStyle(document.querySelector('p'), '::before').backgroundColor;
    return color !== 'rgb(255, 255, 255)' && color !== 'rgba(0, 0, 0, 0)';
  });
  assert.equal(await page.locator('head style[data-ad-sheet]').count(), 3);
  pass('head replacement reconnects loading, pseudo-element and select stylesheets');
  // Exercise real DOM nesting within the renderer's own nesting limit. A
  // separate traversal test covers trees exceeding the JS recursion limit.
  await worker.evaluate(() => chrome.storage.local.set({ preferences: { global: { mode: 'on' } } }));
  await context.route('https://deep.example.test/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>body{background:white;color:black}</style><script>
    const tree=document.createElement('main');tree.id='tree';let node=tree;
    for(let i=0;i<1200;i++){const next=document.createElement('div');node.append(next);node=next;}
    node.id='last';node.textContent='Deep component';addEventListener('DOMContentLoaded',()=>document.body.append(tree));
    </script><p>Ordinary visible content remains usable.</p>` }));
  const deep = await context.newPage(); await deep.goto('https://deep.example.test/');
  await deep.waitForFunction(() => document.getElementById('last').style.getPropertyPriority('background-color') === 'important', null, { timeout: 45000 });
  pass('1,200 nested DOM elements finish without an extension error');
  await deep.evaluate(() => { window.detachedTree = document.getElementById('tree'); window.detachedTree.remove(); });
  await deep.waitForFunction(() => !window.detachedTree.querySelector('#last').style.getPropertyPriority('background-color'), null, { timeout: 15000 });
  assert.equal(await deep.evaluate(() => window.detachedTree.querySelector('[data-ad-rendered]')), null);
  pass('body-level removal releases detached records and restores their original attributes');
  await deep.evaluate(() => document.body.append(window.detachedTree));
  await deep.waitForFunction(() => document.getElementById('last').style.getPropertyPriority('background-color') === 'important', null, { timeout: 45000 });
  pass('a detached deep component can be reused and painted again');
  assert.deepEqual(errors, []);
} finally {
  await fs.writeFile(path.join(artifacts, 'robustness-report.json'), JSON.stringify({ results, errors }, null, 2));
  await context.close();
}
