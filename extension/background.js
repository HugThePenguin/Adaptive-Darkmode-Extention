importScripts('core.js');
const nativeTabs = new Map();
let updateQueue = Promise.resolve();
function host(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}
async function read(hostname) {
  const { preferences = {} } = await chrome.storage.local.get('preferences');
  return ADCore.effective(preferences, hostname);
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.type === 'AD_CONTEXT') {
    const hostname = host(sender.tab?.url || sender.url);
    read(hostname).then(settings => reply({ hostname, settings, topNative: nativeTabs.get(sender.tab?.id) === true })).catch(() => reply({ settings: ADCore.defaults }));
    return true;
  }
  if (message.type === 'AD_PATCH' && sender.url?.startsWith(chrome.runtime.getURL(''))) {
    // Serialize read-modify-write to avoid losing another popup's site record.
    updateQueue = updateQueue.catch(() => {}).then(async () => {
      const saved = await chrome.storage.local.get('preferences');
      const preferences = ADCore.preferences(saved.preferences);
      if (message.scope === 'sites' && message.reset) preferences.sites = {};
      else if (message.scope === 'global') preferences.global = ADCore.settings({ ...preferences.global, ...message.patch });
      else if (typeof message.hostname === 'string' && message.hostname && message.hostname.length < 255) {
        preferences.sites ||= {};
        if (message.reset) delete preferences.sites[message.hostname];
        else {
          const defaults = ADCore.settings(preferences.global);
          const site = { ...preferences.sites[message.hostname] };
          const normalized = ADCore.settings({ ...defaults, ...site, ...message.patch });
          for (const key of Object.keys(message.patch || {})) {
            if (key === 'enabled' || !Object.hasOwn(defaults, key)) continue;
            if (normalized[key] === defaults[key]) delete site[key];
            else site[key] = normalized[key];
          }
          delete site.enabled;
          if (Object.keys(site).length) preferences.sites = { ...preferences.sites, [message.hostname]: site };
          else delete preferences.sites[message.hostname];
        }
      }
      await chrome.storage.local.set({ preferences });
      reply({ ok: true });
    }).catch(() => reply({ ok: false }));
    return true;
  }
  if (message.type === 'AD_STATUS' && sender.frameId === 0 && sender.tab) {
    const id = sender.tab.id;
    const native = message.state === 'native';
    if (nativeTabs.get(id) !== native) {
      nativeTabs.set(id, native);
      chrome.tabs.sendMessage(id, { type: 'AD_TOP_NATIVE', native }).catch(() => {});
    }
    const badges = { active: ['ON', '#74532f'], native: [chrome.i18n.getMessage('badgeAuto'), '#625e3d'], off: ['', '#555555'] };
    const [text, color] = badges[message.state] || badges.off;
    chrome.action.setBadgeText({ tabId: id, text }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ tabId: id, color }).catch(() => {});
    reply({ ok: true });
  }
});
chrome.tabs.onRemoved.addListener(id => nativeTabs.delete(id));
chrome.tabs.onUpdated.addListener((id, changes) => { if (changes.status === 'loading') nativeTabs.delete(id); });
