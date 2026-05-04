import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { resolveBrowserUrl } from '../utils/runtime-url';
import { resolveDeviceConfig } from '../utils/devices';
import { deriveSelectorCandidates } from '../utils/selector-variants';
import type { Step } from '../types/step';

interface RecordingSession {
  id: string;
  process: ChildProcess;
  outputFile: string;
  startUrl: string;
  status: 'active' | 'stopped';
}

const sessions = new Map<string, RecordingSession>();
const TMP_DIR = '/tmp/wrighttest-codegen';
const BACKEND_DIR = fs.existsSync(path.resolve(process.cwd(), 'src', 'index.ts'))
  ? process.cwd()
  : path.resolve(process.cwd(), 'backend');
const DESKTOP_DEVICE_PRESETS = new Set(['Desktop Chrome', 'Desktop Chrome HiDPI']);

function extractStringLiteral(value: string): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(['"`])([\s\S]*)\1$/);
  if (!match) return null;
  return match[2]
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}

function extractFirstStringArgument(argumentsText: string): string | null {
  const match = argumentsText.match(/(['"`])([\s\S]*?)\1/);
  if (!match) return null;
  return extractStringLiteral(match[0]);
}

function parseCodegenLine(trimmed: string): Step | null {
  const gotoMatch = trimmed.match(/^await\s+page\.goto\(([\s\S]+?)\);?$/);
  if (gotoMatch) {
    const url = extractFirstStringArgument(gotoMatch[1]);
    if (!url) return null;
    return { action: 'goto', value: url };
  }

  const actionMatch = trimmed.match(
    /^await\s+(.+?)\.(click|fill|press|selectOption|check|uncheck)\(([\s\S]*?)\);?$/
  );
  if (!actionMatch) return null;

  const selector = actionMatch[1].replace(/\.$/, '');
  const method = actionMatch[2];
  const args = actionMatch[3].trim();

  if (method === 'click' || method === 'check' || method === 'uncheck') {
    return {
      action: 'click',
      selector,
      selectorCandidates: deriveSelectorCandidates(selector)
    };
  }

  if (method === 'fill') {
    const value = extractFirstStringArgument(args);
    if (!value) return null;
    return { action: 'fill', selector, value };
  }

  if (method === 'press') {
    const key = extractFirstStringArgument(args);
    if (!key) return null;
    return { action: 'press', selector, value: key };
  }

  if (method === 'selectOption') {
    const value = extractFirstStringArgument(args);
    if (!value) return null;
    return { action: 'selectOption', selector, value };
  }

  const expectURLMatch = trimmed.match(/^await\s+expect\(page\)\.toHaveURL\(([\s\S]+?)\);?$/);
  if (expectURLMatch) {
    const expected = extractFirstStringArgument(expectURLMatch[1]);
    if (!expected) return null;
    return { action: 'assertURL', expected };
  }

  const expectTitleMatch = trimmed.match(/^await\s+expect\(page\)\.toHaveTitle\(([\s\S]+?)\);?$/);
  if (expectTitleMatch) {
    const expected = extractFirstStringArgument(expectTitleMatch[1]);
    if (!expected) return null;
    return { action: 'assertTitle', expected };
  }

  const expectVisibleMatch = trimmed.match(/^await\s+expect\((page\..+?)\)\.toBeVisible\(([\s\S]*?)\);?$/);
  if (expectVisibleMatch) {
    return { action: 'assertVisible', selector: expectVisibleMatch[1] };
  }

  const expectHiddenMatch = trimmed.match(/^await\s+expect\((page\..+?)\)\.toBeHidden\(([\s\S]*?)\);?$/);
  if (expectHiddenMatch) {
    return { action: 'assertHidden', selector: expectHiddenMatch[1] };
  }

  const expectTextMatch = trimmed.match(/^await\s+expect\((page\..+?)\)\.toHaveText\(([\s\S]+?)\);?$/);
  if (expectTextMatch) {
    const expected = extractFirstStringArgument(expectTextMatch[2]);
    if (!expected) return null;
    return {
      action: 'assertText',
      selector: expectTextMatch[1],
      expected,
      options: { exact: true }
    };
  }

  const containTextMatch = trimmed.match(/^await\s+expect\((page\..+?)\)\.toContainText\(([\s\S]+?)\);?$/);
  if (containTextMatch) {
    const expected = extractFirstStringArgument(containTextMatch[2]);
    if (!expected) return null;
    return {
      action: 'assertText',
      selector: containTextMatch[1],
      expected,
      options: { exact: false }
    };
  }

  const valueMatch = trimmed.match(/^await\s+expect\((page\..+?)\)\.toHaveValue\(([\s\S]+?)\);?$/);
  if (valueMatch) {
    const expected = extractFirstStringArgument(valueMatch[2]);
    if (!expected) return null;
    return { action: 'assertValue', selector: valueMatch[1], expected };
  }

  const checkedMatch = trimmed.match(/^await\s+expect\((page\..+?)\)\.toBeChecked\(([\s\S]*?)\);?$/);
  if (checkedMatch) {
    return { action: 'assertChecked', selector: checkedMatch[1] };
  }

  const countMatch = trimmed.match(/^await\s+expect\((page\..+?)\)\.toHaveCount\(([\s\S]+?)\);?$/);
  if (countMatch) {
    const expected = extractFirstStringArgument(countMatch[2]) ?? countMatch[2].trim();
    if (!expected) return null;
    return { action: 'assertCount', selector: countMatch[1], expected };
  }

  return null;
}

export function parseCodegenOutput(code: string): Step[] {
  const steps: Step[] = [];

  for (const line of code.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('await ')) continue;

    const step = parseCodegenLine(trimmed);
    if (step) {
      steps.push(step);
    }
  }

  return steps;
}

async function waitForProcessExit(process: ChildProcess, timeoutMs = 5000): Promise<boolean> {
  if (process.exitCode !== null || process.signalCode !== null) return true;

  return await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      process.kill('SIGKILL');
      resolve(true);
    }, timeoutMs);

    process.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function logProcessOutput(id: string, streamName: 'stdout' | 'stderr', chunk: Buffer | string) {
  const text = chunk.toString();
  if (!text.trim()) return;
  console.log(`[Codegen ${id} ${streamName}] ${text.trimEnd()}`);
}

async function terminateProcessGroup(proc: ChildProcess): Promise<void> {
  if (!proc.pid) return;

  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGKILL'];

  for (const signal of signals) {
    try {
      process.kill(-proc.pid, signal);
    } catch {
      try {
        proc.kill(signal);
      } catch {
        // Ignore and move on to the next signal.
      }
    }

    if (await waitForProcessExit(proc, 1500)) return;
  }
}

async function stopActiveSessions() {
  const activeSessions = Array.from(sessions.values());
  await Promise.all(activeSessions.map((session) => terminateProcessGroup(session.process)));
  sessions.clear();
}

export async function startRecording(startUrl: string, device?: string): Promise<string> {
  await fsPromises.mkdir(TMP_DIR, { recursive: true });

  const id = uuidv4();
  const outputFile = path.join(TMP_DIR, `${id}.ts`);
  const resolvedUrl = resolveBrowserUrl(startUrl);
  const env = { ...process.env };
  await stopActiveSessions();

  const isDesktopPreset = device ? DESKTOP_DEVICE_PRESETS.has(device) : false;
  const deviceArgs = device && !isDesktopPreset ? ['--device', device] : [];
  const deviceOptions = resolveDeviceConfig(device);
  const viewport = deviceOptions.viewport;
  const viewportArgs = viewport ? ['--viewport-size', `${viewport.width},${viewport.height}`] : [];

  const proc = spawn(
    'npx',
    [
      'playwright',
      'codegen',
      '--browser',
      'chromium',
      ...deviceArgs,
      ...viewportArgs,
      '--output',
      outputFile,
      resolvedUrl
    ],
    {
      cwd: BACKEND_DIR,
      env,
      stdio: 'pipe',
      detached: true
    }
  );

  console.log(
    `[Codegen ${id}] start url=${resolvedUrl} device=${device ?? 'desktop'} browser=chromium args=${JSON.stringify([
      'playwright',
      'codegen',
      '--browser',
      'chromium',
      ...deviceArgs,
      ...viewportArgs,
      '--output',
      outputFile,
      resolvedUrl
    ])}`
  );

  proc.stdout?.on('data', (chunk) => logProcessOutput(id, 'stdout', chunk));
  proc.stderr?.on('data', (chunk) => logProcessOutput(id, 'stderr', chunk));

  proc.once('error', (error) => {
    console.error(`[Codegen ${id}] Failed to start:`, error);
  });

  sessions.set(id, {
    id,
    process: proc,
    outputFile,
    startUrl: resolvedUrl,
    status: 'active'
  });

  return id;
}

export async function stopRecording(id: string): Promise<Step[]> {
  const session = sessions.get(id);
  if (!session) {
    throw new Error(`Session ${id} not found`);
  }

  session.status = 'stopped';
  await terminateProcessGroup(session.process);

  let steps: Step[] = [];
  try {
    const code = await fsPromises.readFile(session.outputFile, 'utf-8');
    steps = parseCodegenOutput(code);
  } catch (error) {
    console.warn(`[Codegen ${id}] Output file not found or unreadable:`, error);
  } finally {
    await fsPromises.rm(session.outputFile, { force: true });
    sessions.delete(id);
  }

  return steps;
}

export function getRecordingStatus(id: string) {
  const session = sessions.get(id);
  if (!session) return null;

  return {
    id: session.id,
    status: session.status,
    startUrl: session.startUrl,
    outputFile: session.outputFile
  };
}
