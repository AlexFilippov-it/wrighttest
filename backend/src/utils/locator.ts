import type { Locator, Page } from 'playwright';

const ALLOWED_LOCATOR_PREFIXES = [
  'page.getByRole(',
  'page.getByLabel(',
  'page.getByText(',
  'page.getByPlaceholder(',
  'page.getByTestId(',
  'page.getByTitle(',
  'page.locator(',
  'page.getByAltText('
];

const MALFORMED_PAGE_LOCATOR_PREFIX = /^page\d+\./;

export function isSafeLocator(selector: string): boolean {
  const normalized = selector.trim();
  return ALLOWED_LOCATOR_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function resolveLocator(page: Page, selector: string): Locator {
  const normalized = selector.trim();
  if (MALFORMED_PAGE_LOCATOR_PREFIX.test(normalized)) {
    throw new Error(
      `Malformed locator rejected: "${normalized.slice(0, 80)}". Use "page." for Playwright locators, not "page1." or other variants.`
    );
  }

  if (normalized.startsWith('page.')) {
    if (!isSafeLocator(normalized)) {
      throw new Error(`Unsafe locator rejected: "${normalized.slice(0, 50)}"`);
    }
    const expression = normalized.slice('page.'.length);
    return eval(`page.${expression}`) as Locator;
  }

  return page.locator(normalized);
}
