import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Step } from '../types/step';
import type { ValidationReport } from './validator';
import type { AuthStorageState } from './auth-state-storage';

type ValidateRequest = {
  projectId?: string;
  url: string;
  steps: Step[];
  device?: string;
  storageState?: AuthStorageState;
};

function resolveValidationRunnerPath() {
  const candidates = [
    path.resolve(__dirname, '../../scripts/validate-runner.mjs'),
    path.resolve(__dirname, '../../../scripts/validate-runner.mjs')
  ];

  const runnerPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!runnerPath) {
    throw new Error(
      `Validation runner script not found. Looked in: ${candidates.join(', ')}`
    );
  }

  return runnerPath;
}

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

export async function runValidationInSubprocess(
  url: string,
  steps: Step[],
  device?: string,
  storageState?: AuthStorageState
): Promise<ValidationReport> {
  const runnerPath = resolveValidationRunnerPath();
  const input = JSON.stringify({
    projectId: undefined,
    url,
    steps,
    device,
    storageState
  } satisfies ValidateRequest);

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runnerPath], {
      env: buildValidationEnv(),
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => {
      const output = stdout.trim();
      const errorOutput = stderr.trim();

      if (code !== 0) {
        reject(new Error(errorOutput || output || 'Validation runner failed'));
        return;
      }
      if (!output) {
        reject(new Error('Validation runner returned no output'));
        return;
      }

      try {
        resolve(JSON.parse(output) as ValidationReport);
      } catch (error) {
        reject(error);
      }
    });

    child.stdin.end(input);
  });
}
