import { Worker, Job } from 'bullmq';
import { chromium, devices } from 'playwright';
import { expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
import prisma from '../prisma';
import redis from '../redis';
import type { TestJobData } from './queue';
import type { Step } from '../types/step';
import { resolveBrowserUrl } from '../utils/runtime-url';
import { resolveLocator } from '../utils/locator';
import { hasUnresolvedVariables, interpolateStep } from '../utils/interpolate';
import { notifyRunResult } from '../services/notifier';
import { deriveSelectorCandidates } from '../utils/selector-variants';

const SCREENSHOTS_DIR = path.resolve(process.env.SCREENSHOTS_DIR || './screenshots');
const TRACES_DIR = path.resolve(process.env.TRACES_DIR || './traces');

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dedupe(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function stripLeadingScope(selector: string) {
  return selector.replace(
    /^(?:main|nav|header|footer|form|section|article|aside|dialog|\[role="navigation"\]|\[role="main"\])\s+/,
    ''
  );
}

function scopedVariants(selector: string) {
  const normalized = selector.trim();
  if (!normalized || normalized.startsWith('page.') || normalized.startsWith('//') || normalized.startsWith('(')) {
    return [];
  }

  const baseSelector = stripLeadingScope(normalized);
  const scopes = ['main', 'nav', 'header', 'footer', 'form', 'section', 'article', 'aside'];
  return scopes.map((scope) => `${scope} ${baseSelector}`);
}

let started = false;

async function ensureDirectories() {
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
  await fs.mkdir(TRACES_DIR, { recursive: true });
}

async function runTest(job: Job<TestJobData>) {
  const { testRunId, testId, environmentId } = job.data;

  await prisma.testRun.update({
    where: { id: testRunId },
    data: { status: 'RUNNING' }
  });

  const test = await prisma.test.findUnique({ where: { id: testId } });
  if (!test) {
    throw new Error(`Test ${testId} not found`);
  }

  let variables: Record<string, string> = {};
  if (environmentId) {
    const environment = await prisma.environment.findUnique({
      where: { id: environmentId }
    });
    if (environment) {
      variables = (environment.variables ?? {}) as Record<string, string>;
    }
  }

  const steps = (test.steps as unknown as Step[]).map((step) => interpolateStep(step, variables));
  const deviceConfig = test.device && test.device in devices ? devices[test.device as keyof typeof devices] : {};

  if (test.device && !(test.device in devices)) {
    console.warn(`[Worker] Unknown device "${test.device}", using desktop`);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...deviceConfig
  });
  await context.tracing.start({ screenshots: true, snapshots: true });

  const page = await context.newPage();
  const screenshots: string[] = [];
  const startedAt = Date.now();
  let currentStep = 0;

  await prisma.testRun.update({
    where: { id: testRunId },
    data: {
      status: 'RUNNING',
      totalSteps: steps.length,
      currentStep: 0
    }
  });

  try {
    for (const [index, step] of steps.entries()) {
      currentStep = index + 1;

      await prisma.testRun.update({
        where: { id: testRunId },
        data: {
          currentStep
        }
      });

      if (
        (step.value && hasUnresolvedVariables(step.value)) ||
        (step.expected && hasUnresolvedVariables(step.expected)) ||
        (step.selector && hasUnresolvedVariables(step.selector))
      ) {
        throw new Error(
          `Unresolved template variable in step ${index + 1}: ${JSON.stringify(step)}`
        );
      }

      switch (step.action) {
        case 'goto':
          await page.goto(resolveBrowserUrl(step.value!), { waitUntil: 'domcontentloaded' });
          break;
        case 'click': {
          const candidates = dedupe([
            step.selector!,
            ...(step.selectorCandidates ?? []),
            ...deriveSelectorCandidates(step.selector!)
          ]);
          const scoped = dedupe(candidates.flatMap((candidate) => scopedVariants(candidate)));
          const allCandidates = dedupe([...candidates, ...scoped]);
          let clicked = false;

          for (const candidate of allCandidates) {
            try {
              await resolveLocator(page, candidate).click({ timeout: 10000 });
              clicked = true;
              break;
            } catch {
              // try next candidate
            }
          }

          if (!clicked) {
            throw new Error(
              `click failed: no unique selector found for step ${index + 1}. Tried: ${allCandidates.join(', ')}`
            );
          }
          break;
        }
        case 'fill':
          await resolveLocator(page, step.selector!).fill(step.value!);
          break;
        case 'press':
          await resolveLocator(page, step.selector!).press(step.value!);
          break;
        case 'selectOption':
          await resolveLocator(page, step.selector!).selectOption(step.value!);
          break;
        case 'assertVisible': {
          const locator = resolveLocator(page, step.selector!);
          const target = step.options?.nth !== undefined ? locator.nth(step.options.nth) : locator;
          await expect(target).toBeVisible({
            timeout: step.options?.timeout ?? 10000
          });
          break;
        }
        case 'assertHidden': {
          const locator = resolveLocator(page, step.selector!);
          const target = step.options?.nth !== undefined ? locator.nth(step.options.nth) : locator;
          await expect(target).toBeHidden({
            timeout: step.options?.timeout ?? 10000
          });
          break;
        }
        case 'assertText': {
          const locator = resolveLocator(page, step.selector!);
          const target = step.options?.nth !== undefined ? locator.nth(step.options.nth) : locator;
          if (step.options?.exact) {
            await expect(target).toHaveText(new RegExp(`^${escapeRegExp(step.expected!)}$`), {
              timeout: step.options?.timeout ?? 10000
            });
          } else {
            await expect(target).toContainText(step.expected!, {
              timeout: step.options?.timeout ?? 10000
            });
          }
          break;
        }
        case 'assertValue': {
          const locator = resolveLocator(page, step.selector!);
          const target = step.options?.nth !== undefined ? locator.nth(step.options.nth) : locator;
          await expect(target).toHaveValue(step.expected!, {
            timeout: step.options?.timeout ?? 10000
          });
          break;
        }
        case 'assertURL': {
          if (step.options?.exact) {
            await expect(page).toHaveURL(step.expected!, {
              timeout: step.options?.timeout ?? 10000
            });
          } else {
            await expect(page).toHaveURL(new RegExp(step.expected!), {
              timeout: step.options?.timeout ?? 10000
            });
          }
          break;
        }
        case 'assertTitle': {
          if (step.options?.exact) {
            await expect(page).toHaveTitle(step.expected!, {
              timeout: step.options?.timeout ?? 10000
            });
          } else {
            await expect(page).toHaveTitle(new RegExp(step.expected!), {
              timeout: step.options?.timeout ?? 10000
            });
          }
          break;
        }
        case 'assertChecked': {
          const locator = resolveLocator(page, step.selector!);
          const target = step.options?.nth !== undefined ? locator.nth(step.options.nth) : locator;
          await expect(target).toBeChecked({
            timeout: step.options?.timeout ?? 10000
          });
          break;
        }
        case 'assertCount': {
          const locator = resolveLocator(page, step.selector!);
          await expect(locator).toHaveCount(Number(step.expected!), {
            timeout: step.options?.timeout ?? 10000
          });
          break;
        }
        case 'waitForSelector':
          await resolveLocator(page, step.selector!).waitFor();
          break;
        default:
          throw new Error(`Unsupported action: ${step.action}`);
      }

      const screenshotName = `${testRunId}_step${index + 1}.png`;
      const screenshotPath = path.join(SCREENSHOTS_DIR, screenshotName);
      await page.screenshot({ path: screenshotPath });
      screenshots.push(screenshotName);
    }

    const traceName = `${testRunId}.zip`;
    const tracePath = path.join(TRACES_DIR, traceName);
    await context.tracing.stop({ path: tracePath });
    await browser.close();

    await prisma.testRun.update({
      where: { id: testRunId },
      data: {
        status: 'PASSED',
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt,
        currentStep: steps.length,
        totalSteps: steps.length,
        screenshots,
        tracePath: traceName
      }
    });

    const finalRun = await prisma.testRun.findUnique({ where: { id: testRunId } });
    if (finalRun) {
      await notifyRunResult(finalRun).catch((error) => {
        console.error('[Worker] Notification error:', error);
      });
    }
  } catch (error) {
    await context.tracing.stop();
    await browser.close();

    await prisma.testRun.update({
      where: { id: testRunId },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt,
        currentStep,
        totalSteps: steps.length,
        screenshots,
        error: error instanceof Error ? error.message : String(error)
      }
    });

    const finalRun = await prisma.testRun.findUnique({ where: { id: testRunId } });
    if (finalRun) {
      await notifyRunResult(finalRun).catch((notificationError) => {
        console.error('[Worker] Notification error:', notificationError);
      });
    }

    throw error;
  }
}

export async function startTestWorker() {
  if (started) return;
  started = true;

  await ensureDirectories();

  const testWorker = new Worker<TestJobData>('test-runs', runTest, {
    connection: redis,
    concurrency: 3
  });

  testWorker.on('completed', (job) => {
    console.log(`[Worker] Job ${job.id} completed`);
  });

  testWorker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed:`, err.message);
  });
}
