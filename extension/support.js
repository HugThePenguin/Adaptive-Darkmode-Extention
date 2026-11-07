(() => {
  'use strict';
  const $ = id => document.getElementById(id), t = ADI18n.message;
  const requestedTab = new URL(location.href).searchParams.get('tab');
  const tabId = /^\d{1,10}$/.test(requestedTab || '') ? Number(requestedTab) : null;
  let generation = 0;
  $('englishForm').href = ADSupport.formUrl('en');
  $('japaneseForm').href = ADSupport.formUrl('ja');
  $('version').textContent = `v${chrome.runtime.getManifest().version}`;
  async function refresh() {
    const version = ++generation;
    $('copyDiagnostics').disabled = true; $('copyStatus').textContent = '';
    try {
      const [{ preferences }, platform] = await Promise.all([chrome.storage.local.get('preferences'), chrome.runtime.getPlatformInfo()]);
      let settings = ADCore.effective(preferences), state = 'unavailable', scope = 'defaults';
      if (tabId !== null) {
        try {
          const status = await chrome.tabs.sendMessage(tabId, { type: 'AD_GET_STATUS' }, { frameId: 0 });
          if (status?.config) { settings = ADCore.settings(status.config); state = status.state; scope = 'page'; }
        } catch { /* Protected, closed or not-yet-reloaded tab: use defaults. */ }
      }
      if (version !== generation) return;
      for (const [name, value] of Object.entries(ADCore.appearance(settings))) document.documentElement.style.setProperty(`--${name}`, value);
      $('diagnosticScope').textContent = t(scope === 'page' ? 'diagnosticsPage' : 'diagnosticsDefaults');
      $('diagnostics').value = ADSupport.diagnostics({
        version: chrome.runtime.getManifest().version,
        chromiumVersion: navigator.userAgent.match(/\b(?:HeadlessChrome|Chrome|Chromium)\/([\d.]+)/)?.[1],
        platform, language: chrome.i18n.getUILanguage(), settings, state, scope
      });
      $('copyDiagnostics').disabled = false;
    } catch {
      if (version === generation) { $('diagnostics').value = ''; $('copyStatus').textContent = t('diagnosticsFailed'); }
    }
  }
  $('copyDiagnostics').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('diagnostics').value); $('copyStatus').textContent = t('diagnosticsCopied'); }
    catch { $('diagnostics').focus(); $('diagnostics').select(); $('copyStatus').textContent = t('diagnosticsManualCopy'); }
  });
  $('refreshDiagnostics').addEventListener('click', refresh);
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.preferences) refresh(); });
  refresh();
})();
