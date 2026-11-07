(() => {
  const $ = id => document.getElementById(id);
  const t = ADI18n.message;
  let tab, hostname = '', settings = ADCore.settings(), queue = Promise.resolve(), saveTimer;
  let pageState = 'waiting', siteBackground = null, revision = 0, statusVersion = 0;
  let pending = 0;
  const previewing = new Set();
  async function reloadSettings() {
    const stored = await chrome.storage.local.get('preferences');
    const preferences = ADCore.preferences(stored.preferences);
    const next = ADCore.effective(preferences, hostname);
    for (const key of previewing) next[key] = Number($(key).value);
    settings = next;
    $('scopeStatus').textContent = t(preferences.sites?.[hostname] ? 'usingSiteSettings' : 'usingDefaults');
    render();
  }
  function theme() {
    const useSite = ['native', 'off'].includes(pageState) && siteBackground;
    const palette = useSite ? ADCore.sitePalette(siteBackground, settings.temperature) : ADCore.palette(settings.temperature);
    for (const [name, color] of Object.entries(palette)) document.documentElement.style.setProperty(`--${name}`, color);
    document.documentElement.style.colorScheme = ADCore.luminance(ADCore.parse(palette.bg)) < .18 ? 'dark' : 'light';
    const value = settings.temperature;
    const label = value === 0 ? t('neutral') : t(value < 0 ? 'warmPercent' : 'coolPercent', String(Math.abs(value)));
    $('temperatureValue').value = label;
    $('temperature').setAttribute('aria-valuetext', label);
  }
  function availability() {
    const active = !!hostname && settings.enabled && settings.mode !== 'off' && pageState === 'active';
    $('adjustments').disabled = !active;
    const details = $('adjustments').querySelector('details');
    details.inert = !active;
    if (!active) details.open = false;
    $('adjustmentReason').hidden = active || !hostname;
    $('adjustmentReason').textContent = !settings.enabled ? t('disabledGlobal')
      : settings.mode === 'off' ? t('disabledSite')
      : pageState === 'native' ? t('disabledNative')
      : t('disabledInactive');
  }
  async function status() {
    if (!tab?.id || !hostname) return;
    const version = ++statusVersion, requestedRevision = revision;
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'AD_GET_STATUS' }, { frameId: 0 });
      if (version !== statusVersion || requestedRevision !== revision) return;
      // A just-saved mode may still be travelling to the content script. Keep
      // controls disabled until its status agrees with the intended settings.
      if (response.config?.enabled !== settings.enabled || response.config?.mode !== settings.mode) return;
      pageState = response.state;
      siteBackground = response.siteBackground || null;
      theme();
      const labels = { active: 'statusActive', native: 'statusNative', off: 'statusOff', waiting: 'statusWaiting' };
      $('status').textContent = t(labels[response.state] || 'statusWaiting');
      $('dot').dataset.state = response.state;
      availability();
    } catch {
      if (version !== statusVersion || requestedRevision !== revision) return;
      pageState = 'unavailable'; siteBackground = null; theme(); $('status').textContent = t('reloadPage'); availability();
    }
  }
  function render() {
    document.querySelector(`input[name="mode"][value="${settings.mode}"]`).checked = true;
    $('brightness').value = settings.brightness;
    $('brightnessValue').value = settings.brightness;
    $('temperature').value = settings.temperature;
    $('contrast').value = settings.contrast;
    $('suppressImages').checked = settings.suppressImages;
    theme(); availability();
  }
  function patch(patch, scope = 'site', reset = false) {
    pending++;
    $('saved').textContent = t('saving');
    queue = queue.catch(() => {}).then(async () => {
      const reply = await chrome.runtime.sendMessage({ type: 'AD_PATCH', hostname, scope, patch, reset });
      if (!reply?.ok) throw new Error('save failed');
      $('saved').textContent = t('saved');
      clearTimeout(saveTimer); saveTimer = setTimeout(() => { $('saved').textContent = ''; }, 2200);
      setTimeout(status, 550);
    }).catch(() => { $('saved').textContent = t('saveFailed'); }).finally(async () => {
      if (--pending === 0) { await reloadSettings(); await status(); }
    });
    return queue;
  }
  $('editDefaults').addEventListener('click', async () => {
    try {
      await queue;
      await chrome.runtime.openOptionsPage();
      await chrome.runtime.sendMessage({ type: 'AD_OPEN_DEFAULTS' }).catch(() => {});
    } catch { $('saved').textContent = t('loadFailed'); }
  });
  for (const e of document.querySelectorAll('input[name="mode"]')) e.addEventListener('change', () => {
    settings.mode = e.value; revision++; pageState = 'waiting'; availability(); patch({ mode: e.value });
  });
  $('brightness').addEventListener('input', () => { previewing.add('brightness'); $('brightnessValue').value = $('brightness').value; });
  $('brightness').addEventListener('change', () => { previewing.delete('brightness'); settings.brightness = Number($('brightness').value); patch({ brightness: settings.brightness }); });
  $('temperature').addEventListener('input', () => { previewing.add('temperature'); settings.temperature = Number($('temperature').value); theme(); });
  $('temperature').addEventListener('change', () => { previewing.delete('temperature'); settings.temperature = Number($('temperature').value); theme(); patch({ temperature: settings.temperature }); });
  $('contrast').addEventListener('change', () => { settings.contrast = Number($('contrast').value); patch({ contrast: settings.contrast }); });
  $('suppressImages').addEventListener('change', () => { settings.suppressImages = $('suppressImages').checked; patch({ suppressImages: settings.suppressImages }); });
  $('rescan').addEventListener('click', () => chrome.tabs.sendMessage(tab.id, { type: 'AD_RESCAN' }, { frameId: 0 }).then(() => { $('saved').textContent = t('rescanStarted'); setTimeout(status, 600); }).catch(() => { $('saved').textContent = t('reloadPage'); }));
  $('reset').addEventListener('click', async () => {
    revision++; pageState = 'waiting'; availability();
    await patch({}, 'site', true);
    const { preferences = {} } = await chrome.storage.local.get('preferences');
    settings = ADCore.effective(preferences); render(); await status();
  });
  async function init() {
    try {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (Number.isInteger(tab?.id)) $('support').href = `support.html?tab=${tab.id}`;
      const url = new URL(tab?.url || 'about:blank');
      hostname = /^https?:$/.test(url.protocol) ? url.hostname : '';
      await reloadSettings(); $('hostname').textContent = hostname || t('unsupportedBrowserPage');
      $('controls').disabled = !hostname;
      if (hostname) await status(); else $('status').textContent = t('unsupportedPage');
    } catch { $('status').textContent = t('loadFailed'); }
  }
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message.type === 'AD_STATUS' && sender.frameId === 0 && sender.tab?.id === tab?.id) status();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.preferences && !pending) reloadSettings().then(status).catch(() => { $('saved').textContent = t('loadFailed'); });
  });
  init(); setInterval(status, 1200);
})();
