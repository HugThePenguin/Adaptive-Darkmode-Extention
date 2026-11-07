import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/core.js';
import '../extension/support-config.js';
test('diagnostic allow-list never copies URLs or complete status/storage objects', () => {
  const data = JSON.parse(ADSupport.diagnostics({ version: '1.6.0', chromiumVersion: '145.0.0.0', platform: { os: 'win', arch: 'x86-64', private: 'SECRET' }, language: 'ja', scope: 'page', state: 'active',
    hostname: 'SECRET', url: 'SECRET', settings: { mode: 'on', hostname: 'SECRET', sites: { SECRET: {} } } }));
  assert.equal(data.settings.mode, 'on'); assert.ok(!JSON.stringify(data).includes('SECRET'));
  assert.equal(ADSupport.sponsorUrl, '');
});
test('form prefilling is restricted to known topics and does not include diagnosis data', () => {
  assert.equal(ADSupport.formUrl('ja-JP'), ADSupport.forms.ja);
  assert.equal(ADSupport.formUrl('fr-FR'), ADSupport.forms.en);
  assert.equal(ADSupport.formUrl('en', 'unknown'), ADSupport.forms.en);
  assert.deepEqual([...new URL(ADSupport.formUrl('en', 'bug')).searchParams.keys()], ['usp', 'entry.1236763802']);
});
