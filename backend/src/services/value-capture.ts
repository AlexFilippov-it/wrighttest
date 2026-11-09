import type { Page } from 'playwright';
import type { Step } from '../types/step';
import { VariableContext, isSecretVariableName, type VariableValue } from '../utils/variable-context';
import { resolveLocator } from '../utils/locator';
import { PRIMARY_SELECTOR_WAIT_MS, SELECTOR_POLL_INTERVAL_MS, waitForUniqueSelector } from '../utils/selector-helpers';

export const MAX_CAPTURED_VALUE_LENGTH = VariableContext.valueLimit;
const SECRET_URL_PARAMETER = /(pass(word)?|secret|token|api[_-]?key|authorization|auth[_-]?code|verification[_-]?code|otp|cookie|credential|private[_-]?key)/i;

function isSensitiveUrl(value: string) {
  try {
    const url = new URL(value);
    return Boolean(url.username || url.password) || [...url.searchParams.keys()].some((key) => SECRET_URL_PARAMETER.test(key));
  } catch {
    return SECRET_URL_PARAMETER.test(value);
  }
}

export async function captureBrowserValue(page: Page, step: Step, selectorTimeoutMs = PRIMARY_SELECTOR_WAIT_MS): Promise<{ value: string | number; secret: boolean }> {
  const source = step.captureSource;
  if (!source) throw new Error('Capture failed: a source is required.');
  if (source === 'url') {
    const value = page.url();
    if (value.length > MAX_CAPTURED_VALUE_LENGTH) {
      throw new Error(`Capture failed: the value exceeds the ${MAX_CAPTURED_VALUE_LENGTH}-character limit.`);
    }
    return { value, secret: isSensitiveUrl(value) };
  }
  if (!step.selector?.trim()) throw new Error('Capture failed: a target selector is required.');

  const locator = resolveLocator(page, step.selector);
  if (source === 'count') {
    const startedAt = Date.now();
    let count = 0;
    do {
      count = await locator.count();
      if (count > 0) return { value: count, secret: false };
      if (Date.now() - startedAt >= selectorTimeoutMs) break;
      await page.waitForTimeout(Math.min(SELECTOR_POLL_INTERVAL_MS, selectorTimeoutMs - (Date.now() - startedAt)));
    } while (Date.now() - startedAt <= selectorTimeoutMs);
    throw new Error('Capture failed: the target element was not found.');
  }

  const unique = await waitForUniqueSelector(page, step.selector, selectorTimeoutMs);
  if (unique.count !== 1) {
    throw new Error(unique.count === 0
      ? 'Capture failed: the target element was not found.'
      : `Capture failed: the target selector matched ${unique.count} elements.`);
  }
  await locator.waitFor({ state: 'attached', timeout: 10000 });

  let value: string | null;
  let sourceSecret = false;
  if (source === 'text') {
    value = await locator.textContent();
    if (value === null) throw new Error('Capture failed: the element text is unavailable.');
  } else if (source === 'input') {
    const inputType = (await locator.getAttribute('type'))?.toLowerCase();
    const autocomplete = (await locator.getAttribute('autocomplete'))?.toLowerCase();
    sourceSecret = inputType === 'password' || inputType === 'hidden' || autocomplete === 'current-password' || autocomplete === 'new-password' || autocomplete === 'one-time-code';
    value = await locator.inputValue();
  } else {
    if (!step.attributeName?.trim()) throw new Error('Capture failed: an attribute name is required.');
    value = await locator.getAttribute(step.attributeName);
    if (value === null) throw new Error(`Capture failed: attribute "${step.attributeName}" is missing.`);
    sourceSecret = isSecretVariableName(step.attributeName);
  }

  if (value.length > MAX_CAPTURED_VALUE_LENGTH) {
    throw new Error(`Capture failed: the value exceeds the ${MAX_CAPTURED_VALUE_LENGTH}-character limit.`);
  }
  return { value, secret: sourceSecret };
}

export function selectSqlCaptureValue(input: {
  step: Step;
  statementType: string;
  rows: Record<string, unknown>[];
  affectedRows: number;
  rowLimitReached: boolean;
}): { value: VariableValue; secret: boolean } {
  const { step, statementType, rows, affectedRows, rowLimitReached } = input;
  if (step.saveResultType === 'rowCount') {
    if (statementType !== 'select') throw new Error('Row count capture requires a SELECT statement.');
    if (rowLimitReached) throw new Error('Cannot save SQL row count: the result exceeded the safe row limit.');
    return { value: rows.length, secret: false };
  }
  if (step.saveResultType === 'affectedRows') {
    if (statementType === 'select') throw new Error('Cannot save affected rows for a SELECT statement.');
    return { value: affectedRows, secret: false };
  }

  const rowIndex = step.saveRowIndex ?? 0;
  const row = rows[rowIndex];
  if (!row) throw new Error(`Cannot save SQL result: row ${rowIndex} is missing.`);
  const column = step.saveColumn?.trim() || Object.keys(row)[0];
  if (!column || !Object.prototype.hasOwnProperty.call(row, column)) {
    throw new Error(`Cannot save SQL result: column "${step.saveColumn ?? ''}" is missing.`);
  }
  const value = row[column];
  if (value === undefined) throw new Error('Cannot save SQL result: the selected value is unavailable.');
  if (value instanceof Date) return { value: value.toISOString(), secret: isSecretVariableName(column) };
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { value, secret: isSecretVariableName(column) };
  }
  throw new Error('Cannot save SQL result: the selected column is not a supported value.');
}
