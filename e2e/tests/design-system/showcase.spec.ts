import { expect, test } from '@playwright/test';

function parseRgb(value: string) {
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Unsupported color: ${value}`);
  return channels;
}

function luminance(rgb: number[]) {
  const channels = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string) {
  const first = luminance(parseRgb(foreground));
  const second = luminance(parseRgb(background));
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

test('development showcase is responsive at foundation viewports', async ({ page }) => {
  for (const width of [1440, 1024, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/design-system.html');
    await expect(page.getByRole('heading', { name: 'WrightTest design system' })).toBeVisible();
    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasHorizontalOverflow, `horizontal overflow at ${width}px`).toBeFalsy();
  }
});

test('primary action has visible keyboard focus and foundational colors meet AA contrast', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/design-system.html');

  const primaryButton = page.getByTestId('primary-button');
  await page.locator('body').click({ position: { x: 4, y: 4 } });
  for (let index = 0; index < 8; index += 1) {
    if (await primaryButton.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(primaryButton).toBeFocused();

  const styles = await primaryButton.evaluate((element) => {
    const computed = window.getComputedStyle(element);
    return {
      color: computed.color,
      backgroundColor: computed.backgroundColor,
      outlineStyle: computed.outlineStyle,
      outlineWidth: computed.outlineWidth
    };
  });
  expect(styles.outlineStyle).not.toBe('none');
  expect(Number.parseFloat(styles.outlineWidth)).toBeGreaterThanOrEqual(2);
  expect(contrastRatio(styles.color, styles.backgroundColor)).toBeGreaterThanOrEqual(4.5);

  const bodyBackground = await page.locator('body').evaluate((element) => window.getComputedStyle(element).backgroundColor);
  for (const locator of [
    page.getByRole('heading', { name: 'WrightTest design system' }),
    page.getByText('A compact, calm foundation for long-running QA workflows. This development-only page does not change product screens.')
  ]) {
    const color = await locator.evaluate((element) => window.getComputedStyle(element).color);
    expect(contrastRatio(color, bodyBackground)).toBeGreaterThanOrEqual(4.5);
  }

  for (const label of ['Passed', 'Needs attention', 'Failed']) {
    const badge = page.locator('.wt-status-badge').filter({ hasText: label }).first();
    const badgeStyles = await badge.evaluate((element) => {
      const computed = window.getComputedStyle(element);
      return { color: computed.color, backgroundColor: computed.backgroundColor };
    });
    expect(contrastRatio(badgeStyles.color, badgeStyles.backgroundColor)).toBeGreaterThanOrEqual(4.5);
  }
});
