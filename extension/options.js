(() => {
  'use strict';
  const $ = id => document.getElementById(id), t = ADI18n.message;
  let preferences = {}, selected = '', settings = ADCore.settings();
  let queue = Promise.resolve(), pending = 0, loadVersion = 0;
  const previewing = new Set();
  function siteName(hostname) {
    const domain = hostname.replace(/^www\./, '');
    if (domain === 'youtube.com' || domain.endsWith('.youtube.com')) return 'YouTube';
    if (domain === 'soundhouse.co.jp' || domain.endsWith('.soundhouse.co.jp')) return t('soundHouse');
    return domain;
  }
  function theme() {
    // Render the entire settings page with the same mapping as a light website.
    for (const [name, color] of Object.entries(ADCore.appearance(settings))) document.documentElement.style.setProperty(`--${name}`, color);
    const label = settings.temperature === 0 ? t('neutral') : t(settings.temperature < 0 ? 'warmPercent' : 'coolPercent', String(Math.abs(settings.temperature)));
    $('temperatureValue').value = label;
    $('temperature').setAttribute('aria-valuetext', label);
    $('brightnessValue').value = settings.brightness;
    const bg = ADCore.background([255, 255, 255, 1], settings.brightness, settings.temperature);
    const fg = ADCore.foreground([20, 20, 20, 1], bg, settings.contrast, settings.temperature);
    $('preview').style.backgroundColor = ADCore.css(bg);
    $('preview').style.color = ADCore.css(fg);
  }
  function availability() {
    $('adjustments').disabled = !settings.enabled || settings.mode === 'off';
    $('adjustmentReason').hidden = !$('adjustments').disabled;
    $('adjustmentReason').textContent = t(!settings.enabled ? 'disabledGlobal' : 'disabledSite');
  }
  function tabs() {
    const focused = document.activeElement?.dataset?.hostname;
    $('tabs').replaceChildren();
    for (const hostname of ['', ...Object.keys(preferences.sites || {}).sort()]) {
      const button = document.createElement('button');
      button.type = 'button'; button.role = 'tab'; button.id = hostname ? `tab-${hostname}` : 'tab-global';
      button.dataset.hostname = hostname;
      button.textContent = hostname ? siteName(hostname) : t('settingsTab');
      button.title = hostname || t('defaultsTitle');
      button.setAttribute('aria-selected', String(hostname === selected));
      button.setAttribute('aria-controls', 'panel');
      button.tabIndex = hostname === selected ? 0 : -1;
      button.addEventListener('click', async () => { await queue; selected = hostname; previewing.clear(); await load(); });
      $('tabs').append(button);
      if (focused === hostname) button.focus();
    }
    $('panel').setAttribute('aria-labelledby', selected ? `tab-${selected}` : 'tab-global');
  }
  function render() {
    tabs();
    $('scopeTitle').textContent = selected ? siteName(selected) : t('defaultsTitle');
    $('scopeDescription').textContent = t(selected ? 'siteScopeExplanation' : 'defaultsExplanation');
    $('siteHost').hidden = !selected; $('siteHost').textContent = selected;
    $('globalEnable').hidden = !!selected;
    $('enabled').checked = settings.enabled;
    document.querySelector(`input[name="mode"][value="${settings.mode}"]`).checked = true;
    for (const key of ['brightness', 'temperature', 'contrast']) $(key).value = settings[key];
    $('suppressImages').checked = settings.suppressImages;
    for (const badge of document.querySelectorAll('[data-setting]')) {
      const custom = !!selected && Object.hasOwn(preferences.sites?.[selected] || {}, badge.dataset.setting);
      badge.hidden = !selected; badge.dataset.custom = String(custom);
      badge.textContent = t(custom ? 'usingSiteSettings' : 'usingDefaults');
    }
    const count = Object.keys(preferences.sites || {}).length;
    $('resetDescription').textContent = selected ? t('resetSiteExplanation') : t('resetAllExplanation', String(count));
    $('resetSites').textContent = t(selected ? 'reset' : 'resetAllSites');
    $('resetSites').disabled = !selected && count === 0;
    $('controls').disabled = false;
    theme(); availability();
  }
  async function load() {
    const version = ++loadVersion;
    const value = await chrome.storage.local.get('preferences');
    if (version !== loadVersion) return;
    preferences = ADCore.preferences(value.preferences);
    if (selected && !Object.hasOwn(preferences.sites || {}, selected)) selected = '';
    const next = ADCore.effective(preferences, selected);
    for (const key of previewing) next[key] = Number($(key).value);
    settings = next; render();
  }
  function save(patch = {}, reset = false) {
    const hostname = selected, scope = reset && !selected ? 'sites' : selected ? 'site' : 'global';
    pending++; $('saved').textContent = t('saving'); $('saved').dataset.state = '';
    queue = queue.catch(() => {}).then(async () => {
      const reply = await chrome.runtime.sendMessage({ type: 'AD_PATCH', hostname, scope, patch, reset });
      if (!reply?.ok) throw new Error('save failed');
      $('saved').textContent = t(reset ? 'resetSaved' : 'saved');
    }).catch(() => { $('saved').textContent = t('saveFailed'); $('saved').dataset.state = 'error'; }).finally(async () => {
      if (--pending === 0) await load();
    });
    return queue;
  }
  $('enabled').addEventListener('change', () => { settings.enabled = $('enabled').checked; availability(); save({ enabled: settings.enabled }); });
  for (const input of document.querySelectorAll('input[name="mode"]')) input.addEventListener('change', () => { settings.mode = input.value; availability(); save({ mode: settings.mode }); });
  for (const key of ['brightness', 'temperature']) {
    $(key).addEventListener('input', () => { previewing.add(key); settings[key] = Number($(key).value); theme(); });
    $(key).addEventListener('change', () => { previewing.delete(key); settings[key] = Number($(key).value); save({ [key]: settings[key] }); });
  }
  $('contrast').addEventListener('change', () => { settings.contrast = Number($('contrast').value); theme(); save({ contrast: settings.contrast }); });
  $('suppressImages').addEventListener('change', () => { settings.suppressImages = $('suppressImages').checked; save({ suppressImages: settings.suppressImages }); });
  $('resetSites').addEventListener('click', () => save({}, true));
  $('tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...$('tabs').querySelectorAll('[role=tab]')], index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus(); buttons[next].click();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.preferences && !pending) load().catch(() => { $('saved').textContent = t('loadFailed'); });
  });
  // A popup's Edit defaults button also selects the global tab in an already
  // open options page, instead of leaving the user in a website's tab.
  chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'AD_OPEN_DEFAULTS') queue.then(() => { selected = ''; previewing.clear(); return load(); }).catch(() => {});
  });
  $('version').textContent = `v${chrome.runtime.getManifest().version}`;
  load().catch(() => { $('saved').textContent = t('loadFailed'); });
})();
