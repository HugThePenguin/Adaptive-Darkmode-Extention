import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const extension=path.resolve(import.meta.dirname,'../extension');
test('all shipped translations and manifest resources resolve before packaging',async()=>{
 const manifest=JSON.parse(await fs.readFile(path.join(extension,'manifest.json'),'utf8'));
 const en=JSON.parse(await fs.readFile(path.join(extension,'_locales/en/messages.json'),'utf8'));
 const ja=JSON.parse(await fs.readFile(path.join(extension,'_locales/ja/messages.json'),'utf8'));
 assert.deepEqual(Object.keys(ja).sort(),Object.keys(en).sort());
 assert.equal(manifest.default_locale,'en');
 for(const messages of [en,ja]) {
  for(const [key,value] of Object.entries(messages)) assert.ok(value.message,`Empty translation ${key}`);
  assert.ok(messages.extensionDescription.message.length<=132);
 }
 const referenced=new Set();
 for(const file of ['popup.html','popup.js','options.html','options.js','support.html','support.js','content.js','background.js']) {
  const source=await fs.readFile(path.join(extension,file),'utf8');
  for(const match of source.matchAll(/data-i18n(?:-aria-label)?="([^"]+)"|(?:\bt|chrome\.i18n\.getMessage)\('([^']+)'/g)) referenced.add(match[1]||match[2]);
 }
 for(const value of [manifest.name,manifest.description,manifest.action.default_title]) referenced.add(value.match(/^__MSG_(\w+)__$/)[1]);
 for(const key of referenced) assert.ok(en[key]&&ja[key],`Missing translation ${key}`);
 for(const file of [manifest.background.service_worker,manifest.action.default_popup,manifest.options_ui.page,'options.css',...Object.values(manifest.icons),...Object.values(manifest.action.default_icon),...manifest.content_scripts.flatMap(c=>[...c.js,...(c.css || [])]),'i18n.js','privacy.html','privacy.css','support.html','support.js','support-config.js','support-links.js','support.css','LICENSE.txt']) await fs.access(path.join(extension,file));
 assert.ok(!manifest.permissions.includes('history'));
 assert.equal(manifest.content_security_policy.extension_pages,"script-src 'self'; object-src 'none'");
});
test('MIT license is included verbatim in the extension package',async()=>{
 const license=await fs.readFile(path.resolve(extension,'../LICENSE'),'utf8');
 assert.match(license,/Copyright \(c\) 2026 HugThePenguin/);
 assert.equal(await fs.readFile(path.join(extension,'LICENSE.txt'),'utf8'),license);
});
