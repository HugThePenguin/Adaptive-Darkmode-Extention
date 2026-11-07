import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep browser profiles and generated diagnostics outside the published tree.
fs.mkdirSync(fileURLToPath(new URL('../.test-artifacts/', import.meta.url)), { recursive: true });
export function browserOptions() {
  if (process.env.AD_BROWSER === 'chromium') return { channel: 'chromium' };
  if (process.env.AD_BROWSER) return { executablePath: process.env.AD_BROWSER };
  const brave = path.join(process.env.ProgramFiles || 'C:/Program Files', 'BraveSoftware/Brave-Browser/Application/brave.exe');
  if (process.platform === 'win32' && fs.existsSync(brave)) return { executablePath: brave };
  return { channel: 'chromium' };
}
