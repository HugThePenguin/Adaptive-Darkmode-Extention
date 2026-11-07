const toggle = document.getElementById('siteTheme');
toggle.addEventListener('click', () => {
  const dark = document.documentElement.classList.toggle('dark');
  toggle.setAttribute('aria-pressed', String(dark));
  toggle.textContent = dark ? 'Light theme' : 'Dark theme';
});
