import { spawnSync } from 'node:child_process';

function runPlaywrightInstall(args) {
  const result = spawnSync('npx', ['playwright', ...args], {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

const installArgs = ['install', 'chromium'];
const shouldInstallDeps = process.platform === 'linux' && process.stdout.isTTY;

let exitCode = 0;

if (shouldInstallDeps) {
  exitCode = runPlaywrightInstall(['install', '--with-deps', 'chromium']);
  if (exitCode !== 0) {
    console.warn(
      '\n[setup-playwright] Chromium browser deps could not be installed automatically. ' +
      'Falling back to browser-only install.\n' +
      '[setup-playwright] If validation still fails on Ubuntu/Linux, run: sudo npx playwright install-deps chromium\n'
    );
    exitCode = runPlaywrightInstall(installArgs);
  }
} else {
  exitCode = runPlaywrightInstall(installArgs);
}

process.exit(exitCode);
