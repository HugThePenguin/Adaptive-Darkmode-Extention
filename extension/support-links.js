(() => {
  'use strict';
  const language = document.documentElement.lang;
  for (const link of document.querySelectorAll('[data-feedback]')) link.href = ADSupport.formUrl(language, link.dataset.feedback);
  for (const link of document.querySelectorAll('[data-source]')) link.href = ADSupport.sourceUrl;
  for (const section of document.querySelectorAll('[data-sponsor-section]')) {
    if (ADSupport.sponsorUrl) {
      section.hidden = false;
      for (const link of section.querySelectorAll('[data-sponsor]')) link.href = ADSupport.sponsorUrl;
    }
  }
})();
