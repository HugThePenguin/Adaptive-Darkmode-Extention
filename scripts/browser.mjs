import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep browser profiles and generated diagnostics outside the published tree.
fs.mkdirSync(fileURLToPath(new URL('../.test-artifacts/', import.meta.url)), { recursive: true });
export function browserOptions(locale) {
  // Linux Chromium resolves its application UI locale from LANGUAGE; context
  // locale/--lang alone changes web content but not chrome.i18n in extensions.
  const localized = locale && process.platform === 'linux' ? { env: { ...process.env, LANGUAGE: locale.split('-')[0] } } : {};
  if (process.env.AD_BROWSER === 'chromium') return { ...localized, channel: 'chromium' };
  if (process.env.AD_BROWSER) return { ...localized, executablePath: process.env.AD_BROWSER };
  const brave = path.join(process.env.ProgramFiles || 'C:/Program Files', 'BraveSoftware/Brave-Browser/Application/brave.exe');
  if (process.platform === 'win32' && fs.existsSync(brave)) return { executablePath: brave };
  return { ...localized, channel: 'chromium' };
}
