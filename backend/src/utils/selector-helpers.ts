import type { Page } from 'playwright';
import type { Step } from '../types/step';
import { resolveLocator } from './locator';
import { deriveSelectorCandidates } from './selector-variants';

export const PRIMARY_SELECTOR_WAIT_MS = 2000;
export const SELECTOR_POLL_INTERVAL_MS = 100;

export type SelectorAttempt = {
  candidate: string;
  count: number;
  error?: string | null;
};

export type TargetAction = 'click' | 'fill' | 'press' | 'selectOption' | 'waitForSelector';

export function dedupe(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function summarizePlaywrightError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  const firstLine = message
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ?? message;
}

export function formatSelectorAttempts(attempts: SelectorAttempt[]) {
  return attempts
    .map((attempt) => `${attempt.candidate} => ${attempt.count}${attempt.error ? ` (${attempt.error})` : ''}`)
    .join('; ');
}

export function uniqueCandidate(pageCounts: Map<string, number>, candidates: string[]) {
  return candidates.find((candidate) => pageCounts.get(candidate) === 1);
}

export function stripLeadingScope(selector: string) {
  return selector.replace(
    /^(?:main|nav|header|footer|form|section|article|aside|dialog|\[role="navigation"\]|\[role="main"\])\s+/,
    ''
  );
}

export function scopedVariants(selector: string) {
  const normalized = selector.trim();
  if (!normalized || normalized.startsWith('page.') || normalized.startsWith('//') || normalized.startsWith('(')) {
    return [];
  }

  const baseSelector = stripLeadingScope(normalized);
  const scopes = ['main', 'nav', 'header', 'footer', 'form', 'section', 'article', 'aside'];
  return scopes.map((scope) => `${scope} ${baseSelector}`);
}

export function buildActionCandidates(step: Step, action: TargetAction) {
  const base = dedupe([
    step.selector ?? '',
    ...(step.selectorCandidates ?? [])
  ]);
  const derived = action === 'click' && step.selector
    ? deriveSelectorCandidates(step.selector)
    : [];
  const scoped = dedupe([...base, ...derived].flatMap((candidate) => scopedVariants(candidate)));
  return dedupe([...base, ...derived, ...scoped]);
}

export async function waitForUniqueSelector(page: Page, selector: string, timeoutMs = PRIMARY_SELECTOR_WAIT_MS) {
  const startedAt = Date.now();
  let lastCount = 0;
  let lastError: string | null = null;

  while (Date.now() - startedAt <= timeoutMs) {
    try {
      lastCount = await resolveLocator(page, selector).count();
      lastError = null;
      if (lastCount === 1) {
        return { count: 1, error: null };
      }
    } catch (error) {
      lastCount = 0;
      lastError = summarizePlaywrightError(error);
    }

    await page.waitForTimeout(SELECTOR_POLL_INTERVAL_MS);
  }

  return { count: lastCount, error: lastError };
}
