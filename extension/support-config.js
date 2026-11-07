/* Local support links. No requests are made until the user opens a link. */
(() => {
  'use strict';
  const forms = Object.freeze({
    en: 'https://docs.google.com/forms/d/e/1FAIpQLSdAvf2aZYbdPD_8EEp2vsjoKe1hrUI2WNcD0vHHJyhYakkTIw/viewform',
    ja: 'https://docs.google.com/forms/d/e/1FAIpQLSdy-grTsloF8e6E-jCaFW-qrX9ZN2mG0ar_I8m_C2dCFPfKlA/viewform'
  });
  const topics = { en: { bug: 'Bug Report', feature: 'Feature Request' }, ja: { bug: '不具合報告', feature: '機能のご要望' } };
  const sourceUrl = 'https://github.com/HugThePenguin/Adaptive-Darkmode-Extention';
  // Set only after the publisher's GitHub Sponsors profile is approved/live.
  const sponsorUrl = '';
  function formUrl(language, topic) {
    const locale = language.startsWith('ja') ? 'ja' : 'en';
    const url = new URL(forms[locale]);
    if (topics[locale][topic]) {
      url.searchParams.set('usp', 'pp_url');
      url.searchParams.set('entry.1236763802', topics[locale][topic]);
    }
    return url.href;
  }
  function diagnostics({ version, chromiumVersion, platform = {}, language, scope, state, settings }) {
    // Explicit allow-list: never serialize a tab/status/storage object. Those
    // objects may contain URLs, hostnames or other websites' preferences.
    return JSON.stringify({
      extension: 'Adaptive Dark', version,
      chromiumVersion: /^[\d.]{1,40}$/.test(chromiumVersion || '') ? chromiumVersion : 'unknown',
      platform: { os: platform.os || 'unknown', arch: platform.arch || 'unknown' },
      language, scope: scope === 'page' ? 'page' : 'defaults',
      state: ['active', 'native', 'off', 'waiting'].includes(state) ? state : 'unavailable',
      settings: ADCore.settings(settings)
    }, null, 2);
  }
  globalThis.ADSupport = Object.freeze({ forms, sourceUrl, sponsorUrl, formUrl, diagnostics });
})();
