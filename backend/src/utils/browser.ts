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

export async function launchChromium() {
  try {
    return await chromium.launch(getChromiumLaunchOptions());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const hint =
      message.includes('Executable doesn\'t exist') ||
      message.includes('cannot open shared object file') ||
      message.includes('error while loading shared libraries')
        ? 'Playwright Chromium is not ready on this machine. Run `npm run setup` from the repo root, then if needed run `npx playwright install-deps chromium` on Ubuntu/Linux.'
        : 'Failed to launch Chromium.';

    throw new Error(`${hint} Original error: ${message}`);
  }
}

export { chromium };
