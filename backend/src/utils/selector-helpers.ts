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

const PLAYWRIGHT_ERROR_HINTS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /intercepts pointer events/i,
    message: 'The target is blocked by another element or overlay intercepting pointer events.'
  },
  {
    pattern: /strict mode violation/i,
    message: 'The locator matched multiple elements in strict mode.'
  },
  {
    pattern: /element is not visible/i,
    message: 'The target element is not visible.'
  },
  {
    pattern: /outside of the viewport/i,
    message: 'The target element is outside of the viewport.'
  },
  {
    pattern: /element is disabled/i,
    message: 'The target element is disabled.'
  },
  {
    pattern: /detached from the DOM|frame was detached/i,
    message: 'The target element was detached before the action completed.'
  }
];

export function dedupe(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function summarizePlaywrightError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  const lines = message
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const summary = lines[0] ?? message;
  const hint = lines
    .map((line) => PLAYWRIGHT_ERROR_HINTS.find((entry) => entry.pattern.test(line))?.message)
    .find(Boolean);

  return hint ? `${summary} Likely cause: ${hint}` : summary;
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
