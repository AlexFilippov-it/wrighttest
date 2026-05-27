import { chromium, devices } from 'playwright';

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

const PLAYWRIGHT_ERROR_HINTS = [
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

const MALFORMED_PAGE_LOCATOR_PREFIX = /^page\d+\./;

function isSafeLocator(selector) {
  const normalized = selector.trim();
  return ALLOWED_LOCATOR_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function resolveLocator(page, selector) {
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
    return eval(`page.${expression}`);
  }

  return page.locator(normalized);
}

function hasUnresolvedVariables(value) {
  return typeof value === 'string' && value.includes('{{');
}

function resolveBrowserUrl(rawUrl) {
  const internalUrl = process.env.FRONTEND_INTERNAL_URL;
  if (!internalUrl) return rawUrl;

  try {
    const parsed = new URL(rawUrl);
    const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (!isLocalhost) return rawUrl;

    const internal = new URL(internalUrl);
    internal.pathname = parsed.pathname;
    internal.search = parsed.search;
    internal.hash = parsed.hash;
    return internal.toString();
  } catch {
    return rawUrl;
  }
}

function resolveDeviceConfig(device) {
  if (!device) return {};
  if (device in devices) return devices[device];
  return {};
}

function escapeQuoted(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function quote(value) {
  return `'${escapeQuoted(value)}'`;
}

function extractQuotedArgument(source, key) {
  const match = source.match(new RegExp(`${key}\\s*:\\s*(['"\`])([\\s\\S]*?)\\1`));
  return match?.[2] ?? null;
}

function extractFirstQuoted(source) {
  const match = source.match(/(['"`])([\s\S]*?)\1/);
  return match?.[2] ?? null;
}

function extractRoleName(selector) {
  const match = selector.match(
    /^page\.getByRole\(\s*(['"`])([^'"`]+)\1\s*,\s*\{[\s\S]*?name\s*:\s*(['"`])([\s\S]*?)\3/
  );
  if (!match) return null;
  return {
    role: match[2],
    name: match[4]
  };
}

function extractGetByText(selector) {
  const match = selector.match(/^page\.getByText\(\s*(['"`])([\s\S]*?)\1/);
  return match?.[2] ?? null;
}

function deriveSelectorCandidates(selector) {
  const normalized = selector.trim();
  const candidates = [];

  const role = extractRoleName(normalized);
  if (role?.name) {
    candidates.push(`page.getByText(${quote(role.name)})`);

    if (role.role === 'link') {
      candidates.push(`page.locator('a', { hasText: ${quote(role.name)} })`);
    }

    if (role.role === 'button') {
      candidates.push(`page.locator('button', { hasText: ${quote(role.name)} })`);
    }

    if (role.role === 'option') {
      candidates.push(`page.locator('option', { hasText: ${quote(role.name)} })`);
    }
  }

  const text = extractGetByText(normalized);
  if (text) {
    candidates.push(`page.locator('text=${text.replace(/'/g, "\\'")}')`);
    candidates.push(`page.getByText(${quote(text)})`);
  }

  const labelText = extractQuotedArgument(normalized, 'name');
  if (!role && labelText) {
    candidates.push(`page.getByText(${quote(labelText)})`);
  }

  return [...new Set(candidates.filter(Boolean))];
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}

function summarizePlaywrightError(error) {
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

function stripLeadingScope(selector) {
  return selector.replace(
    /^(?:main|nav|header|footer|form|section|article|aside|dialog|\[role="navigation"\]|\[role="main"\])\s+/,
    ''
  );
}

function scopedVariants(selector) {
  const normalized = selector.trim();
  if (!normalized || normalized.startsWith('page.') || normalized.startsWith('//') || normalized.startsWith('(')) {
    return [];
  }

  const baseSelector = stripLeadingScope(normalized);
  const scopes = ['main', 'nav', 'header', 'footer', 'form', 'section', 'article', 'aside'];
  return scopes.map((scope) => `${scope} ${baseSelector}`);
}

function interpolateStep(step, variables) {
  const interpolate = (value) => {
    if (typeof value !== 'string') return value;
    return value.replace(/\{\{([^}]+)\}\}/g, (_, key) => variables[key.trim()] ?? `{{${key}}}`);
  };

  return {
    ...step,
    selector: interpolate(step.selector),
    value: interpolate(step.value),
    expected: interpolate(step.expected)
  };
}

async function performValidationAction(page, step, selector) {
  if (step.action === 'keyboardPress') {
    await page.keyboard.press(step.value ?? '');
    return;
  }

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

async function validateSteps(url, steps, device) {
  const results = [];
  const canNavigateInitialUrl = !hasUnresolvedVariables(url);
  let pageKnown = canNavigateInitialUrl;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...resolveDeviceConfig(device)
  });
  const page = await context.newPage();

  try {
    if (canNavigateInitialUrl) {
      await page.goto(resolveBrowserUrl(url), { waitUntil: 'domcontentloaded', timeout: 15000 });
    }

    for (const [index, step] of steps.entries()) {
      const normalizedStep = interpolateStep(step, {});

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

      if (step.action === 'assertCount') {
        if (!step.expected || hasUnresolvedVariables(step.expected)) {
          results.push({ index, status: 'skipped', selector: step.selector });
          continue;
        }

        const expectedCount = Number(step.expected);
        if (Number.isNaN(expectedCount)) {
          results.push({
            index,
            status: 'not_found',
            selector: step.selector,
            resolvedCount: 0,
            error: 'assertCount requires a numeric expected value'
          });
          continue;
        }

        if (!step.selector) {
          results.push({
            index,
            status: 'not_found',
            error: 'assertCount requires a selector'
          });
          continue;
        }

        const locator = resolveLocator(page, step.selector);
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

      if (step.action === 'assertHidden') {
        results.push({ index, status: 'skipped', selector: step.selector });
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

      if (step.action === 'keyboardPress') {
        try {
          await performValidationAction(page, normalizedStep, '');
          results.push({ index, status: 'ok' });
        } catch (error) {
          results.push({
            index,
            status: 'action_failed',
            error: summarizePlaywrightError(error)
          });
        }
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

      const candidates = dedupe([
        step.selector,
        ...(step.selectorCandidates ?? []),
        ...deriveSelectorCandidates(step.selector)
      ]);
      const scopedSuggestions = scopedVariants(step.selector);
      const counts = new Map();

      for (const candidate of dedupe([...candidates, ...scopedSuggestions])) {
        try {
          counts.set(candidate, await resolveLocator(page, candidate).count());
        } catch {
          counts.set(candidate, 0);
        }
      }

      const count = counts.get(step.selector) ?? 0;
      const hrefCandidate = candidates.find((candidate) => candidate.includes('[href='));
      const uniqueCandidate = candidates.find((candidate) => counts.get(candidate) === 1);
      const selectedCandidate = uniqueCandidate || step.selector;

      if (count === 1) {
        try {
          await performValidationAction(page, normalizedStep, selectedCandidate);
          results.push({ index, status: 'ok', selector: step.selector, resolvedCount: count });
        } catch (error) {
          results.push({
            index,
            status: 'action_failed',
            selector: step.selector,
            resolvedCount: count,
            error: summarizePlaywrightError(error)
          });
        }
        continue;
      }

      if (count === 0 && hrefCandidate) {
        const hrefCount = counts.get(hrefCandidate) ?? 0;
        if (hrefCount === 1) {
          try {
            await performValidationAction(page, normalizedStep, hrefCandidate);
            results.push({ index, status: 'ok', selector: hrefCandidate, resolvedCount: hrefCount });
          } catch (error) {
            results.push({
              index,
              status: 'action_failed',
              selector: hrefCandidate,
              resolvedCount: hrefCount,
              error: summarizePlaywrightError(error)
            });
          }
          continue;
        }
      }

      if (count === 0 && scopedSuggestions.length > 0) {
        const scopedUnique = scopedSuggestions.find((candidate) => counts.get(candidate) === 1);
        if (scopedUnique) {
          try {
            await performValidationAction(page, normalizedStep, scopedUnique);
            results.push({ index, status: 'ok', selector: scopedUnique, resolvedCount: 1 });
          } catch (error) {
            results.push({
              index,
              status: 'action_failed',
              selector: scopedUnique,
              resolvedCount: 1,
              error: summarizePlaywrightError(error)
            });
          }
          continue;
        }
      }

      if (count > 1 && uniqueCandidate) {
        try {
          await performValidationAction(page, normalizedStep, uniqueCandidate);
          results.push({
            index,
            status: 'ok',
            selector: uniqueCandidate,
            resolvedCount: 1
          });
        } catch (error) {
          results.push({
            index,
            status: 'action_failed',
            selector: uniqueCandidate,
            resolvedCount: 1,
            error: summarizePlaywrightError(error)
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
          suggestion: uniqueCandidate ?? candidates[0] ?? step.selector,
          error: `Found ${count} matching elements`
        });
      } else {
        results.push({
          index,
          status: 'not_found',
          selector: step.selector,
          resolvedCount: 0,
          suggestion: candidates[0] ?? step.selector,
          error: 'No matching element found'
        });
      }
    }

    const valid = results.every((result) => result.status === 'ok' || result.status === 'skipped');
    return { valid, results };
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

async function readStdin() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  return input;
}

async function main() {
  const rawInput = await readStdin();
  const payload = JSON.parse(rawInput);
  const report = await validateSteps(payload.url, payload.steps ?? [], payload.device);
  process.stdout.write(JSON.stringify(report));
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message);
  process.exitCode = 1;
});
