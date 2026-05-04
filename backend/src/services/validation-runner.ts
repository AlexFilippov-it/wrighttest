import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Step } from '../types/step';
import type { ValidationReport } from './validator';

type ValidateRequest = {
  url: string;
  steps: Step[];
  device?: string;
};

function buildValidationEnv() {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME ?? '/tmp',
    USER: process.env.USER,
    LOGNAME: process.env.LOGNAME,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    TZ: process.env.TZ,
    FRONTEND_INTERNAL_URL: process.env.FRONTEND_INTERNAL_URL,
    FRONTEND_URL: process.env.FRONTEND_URL,
    FRONTEND_DEV_URL: process.env.FRONTEND_DEV_URL,
    SCREENSHOTS_DIR: process.env.SCREENSHOTS_DIR,
    TRACES_DIR: process.env.TRACES_DIR,
    PLAYWRIGHT_BROWSERS_PATH: '0',
    NODE_OPTIONS: '',
    LD_LIBRARY_PATH: '',
    LD_PRELOAD: ''
  };
}

export function runValidationInSubprocess(
  url: string,
  steps: Step[],
  device?: string
): ValidationReport {
  const runnerPath = path.resolve(__dirname, '../../scripts/validate-runner.mjs');
  const result = spawnSync(
    process.execPath,
    [runnerPath],
    {
      input: JSON.stringify({ url, steps, device } satisfies ValidateRequest),
      encoding: 'utf8',
      env: buildValidationEnv()
    }
  );

  if (result.error) {
    throw result.error;
  }

  const stdout = result.stdout?.trim() ?? '';
  const stderr = result.stderr?.trim() ?? '';

  if (result.status !== 0) {
    throw new Error(stderr || stdout || 'Validation runner failed');
  }

  if (!stdout) {
    throw new Error('Validation runner returned no output');
  }

  return JSON.parse(stdout) as ValidationReport;
}
