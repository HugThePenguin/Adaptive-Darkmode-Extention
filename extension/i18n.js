/* All interface translations ship with the extension. */
(() => {
  const message = (key, substitutions) => chrome.i18n.getMessage(key, substitutions);
  document.documentElement.lang = chrome.i18n.getMessage('@@ui_locale').startsWith('ja') ? 'ja' : 'en';
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = message(element.dataset.i18n);
  for (const element of document.querySelectorAll('[data-i18n-aria-label]')) element.setAttribute('aria-label', message(element.dataset.i18nAriaLabel));
  globalThis.ADI18n = Object.freeze({ message });
})();
