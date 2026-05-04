import fs from 'node:fs';
import { chromium, type LaunchOptions } from 'playwright';

const SYSTEM_BROWSER_CANDIDATES = [
  process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  process.env.CHROMIUM_PATH,
  process.env.CHROME_BIN,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'
];

export function resolveBrowserExecutablePath() {
  const candidate = SYSTEM_BROWSER_CANDIDATES.find((value) => value && fs.existsSync(value));
  return candidate;
}

export function getChromiumLaunchOptions(): LaunchOptions {
  const executablePath = resolveBrowserExecutablePath();
  return executablePath ? { headless: true, executablePath } : { headless: true };
}

export function getBrowserName() {
  return resolveBrowserExecutablePath() ? 'system chromium' : 'playwright chromium';
}

export { chromium };
