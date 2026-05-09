import { type Page } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import { v4 as uuidv4 } from 'uuid';
import type { Step } from '../types/step';
import { resolveBrowserUrl } from '../utils/runtime-url';
import { resolveLocator } from '../utils/locator';
import { hasUnresolvedVariables, interpolateStep } from '../utils/interpolate';
import { resolveDeviceConfig } from '../utils/devices';
import { getBrowserName, launchChromium } from '../utils/browser';
import { validateStepRequirements } from '../utils/step-validation';
import {
  buildActionCandidates,
  uniqueCandidate,
  scopedVariants,
  waitForUniqueSelector,
  dedupe
} from '../utils/selector-helpers';

export type StepValidationResult = {
  index: number;
  status: 'ok' | 'ambiguous' | 'not_found' | 'action_failed' | 'skipped';
  selector?: string;
  resolvedCount?: number;
  suggestion?: string;
  error?: string;
};

export type ValidationReport = {
  valid: boolean;
  results: StepValidationResult[];
  tracePath?: string;
};

const TRACES_DIR = path.resolve(process.env.TRACES_DIR || './traces');

async function performValidationAction(page: Page, step: Step, selector: string) {
  const locator = resolveLocator(page, selector);

  switch (step.action) {
    case 'click':
      await locator.click({ timeout: 10000 });
      await page.waitForLoadState('domcontentloaded').catch(() => undefined);
      return;
    case 'fill':
      await locator.fill(step.value ?? '', { timeout: 10000 });
      return;
    case 'press':
      await locator.press(step.value ?? '', { timeout: 10000 });
      await page.waitForLoadState('domcontentloaded').catch(() => undefined);
      return;
    case 'selectOption':
      await locator.selectOption(step.value ?? '', { timeout: 10000 });
      await page.waitForLoadState('domcontentloaded').catch(() => undefined);
      return;
    case 'waitForSelector':
      await locator.waitFor({ timeout: 10000 });
      return;
    default:
      return;
  }
}

export async function validateSteps(url: string, steps: Step[], device?: string): Promise<ValidationReport> {
  const results: StepValidationResult[] = [];
  const canNavigateInitialUrl = !hasUnresolvedVariables(url);
  let pageKnown = canNavigateInitialUrl;
  const traceName = `validation-${uuidv4()}.zip`;
  const tracePath = path.join(TRACES_DIR, traceName);
  let tracingStarted = false;
  let savedTracePath: string | undefined;

  await fs.mkdir(TRACES_DIR, { recursive: true });

  const browser = await launchChromium();
  const context = await browser.newContext({
    ...resolveDeviceConfig(device)
  });
  const page = await context.newPage();

  try {
    console.log(`[Validator] Using ${getBrowserName()}`);
    await context.tracing.start({ screenshots: true, snapshots: true });
    tracingStarted = true;

    if (canNavigateInitialUrl) {
      await page.goto(resolveBrowserUrl(url), { waitUntil: 'domcontentloaded', timeout: 15000 });
    }

    for (const [index, step] of steps.entries()) {
      const normalizedStep = interpolateStep(step, {});

      const requirementIssue = validateStepRequirements(step);
      if (requirementIssue) {
        results.push({
          index,
          status: 'not_found',
          selector: step.selector,
          error: requirementIssue.message
        });
        continue;
      }

      if (step.action === 'goto') {
        if (!normalizedStep.value || hasUnresolvedVariables(normalizedStep.value)) {
          pageKnown = false;
          results.push({
            index,
            status: 'skipped',
            selector: step.selector,
            error: 'Skipped until environment variables are resolved'
          });
          continue;
        }

        await page.goto(resolveBrowserUrl(normalizedStep.value), { waitUntil: 'domcontentloaded', timeout: 15000 });
        pageKnown = true;
        results.push({ index, status: 'skipped' });
        continue;
      }

      if (step.action === 'assertURL' || step.action === 'assertTitle') {
        if (step.expected && hasUnresolvedVariables(step.expected)) {
          results.push({ index, status: 'skipped', selector: step.selector });
          continue;
        }
        results.push({ index, status: 'skipped' });
        continue;
      }

      if (step.action === 'assertHidden') {
        results.push({ index, status: 'skipped', selector: step.selector });
        continue;
      }

      if (step.action === 'assertCount') {
        const expectedCount = Number(step.expected);
        if (Number.isNaN(expectedCount)) {
          results.push({
            index,
            status: 'not_found',
            selector: step.selector,
            resolvedCount: 0,
            error: 'Expected count must be numeric'
          });
          continue;
        }

        const locator = resolveLocator(page, step.selector!);
        const count = await locator.count();
        if (count === expectedCount) {
          results.push({ index, status: 'ok', selector: step.selector, resolvedCount: count });
        } else {
          results.push({
            index,
            status: count > expectedCount ? 'ambiguous' : 'not_found',
            selector: step.selector,
            resolvedCount: count,
            error: `Expected ${expectedCount} elements, found ${count}`
          });
        }
        continue;
      }

      if (!pageKnown) {
        results.push({
          index,
          status: 'skipped',
          selector: step.selector,
          error: 'Skipped because the current page depends on unresolved variables'
        });
        continue;
      }

      if (!step.selector) {
        results.push({ index, status: 'skipped' });
        continue;
      }

      if (hasUnresolvedVariables(step.selector)) {
        results.push({ index, status: 'skipped', selector: step.selector });
        continue;
      }

      const candidates = buildActionCandidates(step, step.action === 'click' ? 'click' : 'waitForSelector');
      const scopedSuggestions = scopedVariants(step.selector);
      const counts = new Map<string, number>();
      const preferred = await waitForUniqueSelector(page, step.selector);

      counts.set(step.selector, preferred.count);

      for (const candidate of dedupe([...candidates, ...scopedSuggestions])) {
        if (candidate === step.selector) {
          continue;
        }
        try {
          counts.set(candidate, await resolveLocator(page, candidate).count());
        } catch {
          counts.set(candidate, 0);
        }
      }

      const count = counts.get(step.selector) ?? 0;
      const hrefCandidate = candidates.find((candidate) => candidate.includes('[href='));
      const suggested =
        uniqueCandidate(counts, scopedSuggestions) ??
        uniqueCandidate(counts, [hrefCandidate ?? '', ...candidates]) ??
        uniqueCandidate(counts, candidates);

      const isAssertion = [
        'assertVisible',
        'assertText',
        'assertValue',
        'assertChecked'
      ].includes(step.action);

      if (step.action === 'click') {
        let clicked = false;
        let lastError: unknown;
        let primaryActionError: unknown = null;

        if (preferred.count === 1) {
          try {
            await performValidationAction(page, step, step.selector);
            results.push({ index, status: 'ok', selector: step.selector, resolvedCount: 1 });
            continue;
          } catch (error) {
            primaryActionError = error;
            lastError = error;
          }
        }

        for (const candidate of dedupe([...candidates, ...scopedSuggestions])) {
          if (candidate === step.selector) {
            continue;
          }
          try {
            await performValidationAction(page, step, candidate);
            results.push({ index, status: 'ok', selector: candidate, resolvedCount: 1 });
            clicked = true;
            break;
          } catch (error) {
            lastError = error;
          }
        }

        if (clicked) {
          continue;
        }

        if (preferred.count === 1 && primaryActionError) {
          results.push({
            index,
            status: 'action_failed',
            selector: step.selector,
            resolvedCount: 1,
            error: primaryActionError instanceof Error ? primaryActionError.message : String(primaryActionError)
          });
          continue;
        }

        if (count === 0) {
          results.push({
            index,
            status: 'not_found',
            selector: step.selector,
            resolvedCount: 0,
            suggestion: suggested,
            error: suggested
              ? `Selector not found, but "${suggested}" matches 1 element`
              : preferred.error ?? (lastError instanceof Error ? lastError.message : 'No working selector found')
          });
        } else {
          results.push({
            index,
            status: 'ambiguous',
            selector: step.selector,
            resolvedCount: count,
            suggestion: suggested,
            error: suggested
              ? `Resolves to ${count} elements, suggested: "${suggested}"`
              : `Resolves to ${count} elements`
          });
        }
        continue;
      }

      if (count === 0) {
        results.push({
          index,
          status: 'not_found',
          selector: step.selector,
          resolvedCount: 0,
          suggestion: suggested,
          error: suggested
            ? `Selector not found, but "${suggested}" matches 1 element`
            : preferred.error ?? 'No working selector found'
        });
        continue;
      }

      if (isAssertion) {
        if (count === 1) {
          results.push({ index, status: 'ok', selector: step.selector, resolvedCount: 1 });
        } else {
          results.push({
            index,
            status: 'ambiguous',
            selector: step.selector,
            resolvedCount: count,
            suggestion: suggested,
            error: suggested
              ? `Resolves to ${count} elements, suggested: "${suggested}"`
              : `Resolves to ${count} elements`
          });
        }
        continue;
      }

      if (count > 1) {
        results.push({
          index,
          status: 'ambiguous',
          selector: step.selector,
          resolvedCount: count,
          suggestion: suggested,
          error: suggested
            ? `Resolves to ${count} elements, suggested: "${suggested}"`
            : `Resolves to ${count} elements`
        });
        continue;
      }

      if (['fill', 'press', 'selectOption', 'waitForSelector'].includes(step.action)) {
        try {
          await performValidationAction(page, step, step.selector);
          results.push({ index, status: 'ok', selector: step.selector, resolvedCount: 1 });
        } catch (error) {
          results.push({
            index,
            status: 'action_failed',
            selector: step.selector,
            resolvedCount: 1,
            error: error instanceof Error ? error.message : String(error)
          });
        }
        continue;
      }

      results.push({ index, status: 'ok', selector: step.selector, resolvedCount: 1 });
    }
  } finally {
    if (tracingStarted) {
      try {
        await context.tracing.stop({ path: tracePath });
        savedTracePath = traceName;
      } catch {
        savedTracePath = undefined;
      }
    }
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }

  const valid = results.every((result) => result.status === 'ok' || result.status === 'skipped');
  return { valid, results, tracePath: savedTracePath };
}
