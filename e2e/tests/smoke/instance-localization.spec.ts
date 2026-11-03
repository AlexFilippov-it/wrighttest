import { request } from '@playwright/test';
import { apiBaseUrl, expect, openAuthenticatedPage, test } from '../support/workspace';
import { withRateLimitRetries } from '../../support/workspace-state';

type LanguagePackage = {
  format: 'wrighttest-locale';
  version: 1;
  locale: string;
  messages: Record<string, { source: string; translation: string; sourceHash?: string }>;
};

async function expectAnyVisible(...locators: Array<ReturnType<import('@playwright/test').Page['getByText']>>) {
  await expect.poll(async () => {
    for (const locator of locators) {
      if (await locator.isVisible().catch(() => false)) return true;
    }
    return false;
  }).toBe(true);
}

test('instance language is system-admin-only and imports merge without data loss', async ({ page, workspace }, testInfo) => {
  const anonymousApiContext = await request.newContext({ baseURL: apiBaseUrl });
  const viewerApiContext = await request.newContext({
    baseURL: apiBaseUrl,
    extraHTTPHeaders: { Authorization: `Bearer ${workspace.viewer.token}` }
  });
  const anonymousApi = withRateLimitRetries(anonymousApiContext);
  const viewerApi = withRateLimitRetries(viewerApiContext);
  let originalLocale = 'en';

  try {
    const publicLocaleResponse = await anonymousApi.get('/localization/public');
    expect(publicLocaleResponse.status(), `GET /localization/public returned ${publicLocaleResponse.status()}`).toBe(200);
    const publicLocale = await publicLocaleResponse.json() as { activeLocale: string; messages: Record<string, string> };
    expect(publicLocale.activeLocale).toBeTruthy();
    expect(publicLocale).not.toHaveProperty('settings');

    const forbidden = await viewerApi.get('/instance/locales');
    expect(forbidden.status()).toBe(403);

    const settingsResponse = await workspace.adminApi.get('/instance/locales');
    expect(settingsResponse.status(), `GET /instance/locales returned ${settingsResponse.status()}`).toBe(200);
    const settings = await settingsResponse.json() as { activeLocale: string; packs: Array<{ locale: string }> };
    originalLocale = settings.activeLocale;
    expect(settings.packs.map((pack) => pack.locale)).toContain('ru-RU');

    const setEnglishResponse = await workspace.adminApi.patch('/instance/settings/language', { data: { locale: 'en' } });
    expect(setEnglishResponse.status(), `PATCH /instance/settings/language returned ${setEnglishResponse.status()}`).toBe(200);

    await openAuthenticatedPage(page, workspace.owner, '/instance/language');
    await expect(page.getByRole('heading', { name: 'Instance language' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import language' }).first()).toBeEnabled();
    await expect(page.locator('.ant-table-wrapper .ant-spin-blur')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('instance-language-en.png'), fullPage: true });

    const languageSelect = page.getByRole('combobox').nth(1);
    await languageSelect.click();
    await page.getByText('Русский (ru-RU)', { exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Apply language' }).click();
    await expect(page.getByRole('button', { name: 'Применить язык' })).toBeDisabled();
    await page.getByRole('heading', { name: 'Язык установки' }).click();
    await expect(page.getByRole('button', { name: 'Импортировать язык' }).first()).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('instance-language-ru.png'), fullPage: true });

    await page.locator('.wt-shell-navigation a[href="/dashboard"]').click();
    await expect(page.getByRole('heading', { name: 'Панель управления' })).toBeVisible();
    await expect(page.getByText('Общее состояние проектов, браузерных проверок, расписаний и запусков.')).toBeVisible();
    await expect(page.getByText('Всего запусков').first()).toBeVisible();
    await expect(page.getByText('Активные сбои').first()).toBeVisible();

    await page.locator('.wt-shell-navigation a[href="/projects"]').last().click();
    await expect(page.getByRole('heading', { name: 'Проекты' }).first()).toBeVisible();
    await expect(page.getByText('Отслеживайте проверки, расписания, уведомления и историю запусков проектов.')).toBeVisible();
    await expectAnyVisible(
      page.getByRole('columnheader', { name: 'Действия' }),
      page.getByText('Проектов пока нет', { exact: true })
    );

    await page.locator('.wt-shell-navigation a[href="/runs"]').last().click();
    await expect(page.getByRole('heading', { name: 'Запуски', exact: true })).toBeVisible();
    await expect(page.getByText('История запусков проектов, браузерных проверок, расписаний и ручных запусков.')).toBeVisible();
    await expectAnyVisible(
      page.getByRole('columnheader', { name: 'Результат' }),
      page.getByText('Запусков пока нет', { exact: true })
    );

    await page.goto(`/projects/${workspace.projectId}/alerts`);
    await expect(page.getByRole('heading', { name: 'Уведомления', exact: true })).toBeVisible();
    await expect(page.getByText('Каналы уведомлений не настроены')).toBeVisible();
    await page.getByRole('button', { name: 'Добавить канал' }).click();
    await page.getByRole('menuitem', { name: 'Добавить Telegram' }).click();
    await expect(page.getByText('Название уведомления')).toBeVisible();
    await expect(page.getByText('Правила уведомлений')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Отмена' }).click();

    await page.locator(`.wt-shell-navigation a[href="/projects/${workspace.projectId}/checks"]`).click();
    await page.getByRole('link', { name: workspace.checkName }).click();
    await expect(page.getByRole('heading', { name: 'Редактирование проверки' })).toBeVisible();
    await expect(page.getByText('Настройки проверки', { exact: true })).toBeVisible();
    await expect(page.getByText('Тестовые данные', { exact: true })).toBeVisible();
    await expect(page.getByText('1 проверка результата', { exact: true })).toBeVisible();
    await expect(page.getByText('Проверить заголовок страницы', { exact: true }).first()).toBeVisible();

    await page.locator('.wt-shell-navigation a[href="/instance/language"]').click();
    await page.getByRole('combobox').nth(1).click();
    await page.getByText('English (en)', { exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Применить язык' }).click();
    await expect(page.getByRole('heading', { name: 'Instance language' })).toBeVisible();

    const templateResponse = await workspace.adminApi.get('/instance/locales/template/de-DE');
    expect(templateResponse.ok()).toBeTruthy();
    const template = await templateResponse.json() as LanguagePackage;
    expect(template.format).toBe('wrighttest-locale');
    expect(template.messages['nav.dashboard'].source).toBe('Dashboard');

    const firstImport: LanguagePackage = {
      ...template,
      messages: {
        ...template.messages,
        'nav.dashboard': { ...template.messages['nav.dashboard'], translation: 'Startseite' }
      }
    };
    const firstApply = await workspace.adminApi.put('/instance/locales/de-DE/apply', { data: firstImport });
    expect(firstApply.ok()).toBeTruthy();

    const emptyUpdate = await workspace.adminApi.put('/instance/locales/de-DE/apply', { data: template });
    expect(emptyUpdate.ok()).toBeTruthy();
    const exported = await workspace.adminApi.get('/instance/locales/de-DE/export');
    expect(exported.ok()).toBeTruthy();
    const merged = await exported.json() as LanguagePackage;
    expect(merged.messages['nav.dashboard'].translation).toBe('Startseite');

    const invalidParameterPackage: LanguagePackage = {
      ...template,
      messages: {
        ...template.messages,
        'language.translatedCount_other': {
          ...template.messages['language.translatedCount_other'],
          translation: '{{wrong}} übersetzt'
        }
      }
    };
    const invalid = await workspace.adminApi.put('/instance/locales/de-DE/apply', { data: invalidParameterPackage });
    expect(invalid.status()).toBe(400);
    const unchangedExport = await workspace.adminApi.get('/instance/locales/de-DE/export');
    const unchanged = await unchangedExport.json() as LanguagePackage;
    expect(unchanged.messages['nav.dashboard'].translation).toBe('Startseite');

    await workspace.adminApi.patch('/instance/settings/language', { data: { locale: 'de-DE' } });
    const activePublicLocale = await anonymousApi.get('/localization/public');
    const activePublicMessages = await activePublicLocale.json() as { activeLocale: string; messages: Record<string, string> };
    expect(activePublicMessages.activeLocale).toBe('de-DE');
    expect(activePublicMessages.messages['nav.dashboard']).toBe('Startseite');
  } finally {
    await workspace.adminApi.patch('/instance/settings/language', { data: { locale: originalLocale } }).catch(() => undefined);
    await workspace.adminApi.delete('/instance/locales/de-DE').catch(() => undefined);
    await anonymousApiContext.dispose();
    await viewerApiContext.dispose();
  }
});

test('Russian translation covers dashboard and project checks, suites, runs, and schedules', async ({ page, workspace }, testInfo) => {
  test.setTimeout(60_000);
  let previousLocale = 'en';
  let localeCaptured = false;

  try {
    const settingsResponse = await workspace.adminApi.get('/instance/locales');
    expect(settingsResponse.status(), `GET /instance/locales returned ${settingsResponse.status()}`).toBe(200);
    const settings = await settingsResponse.json() as { activeLocale: string };
    previousLocale = settings.activeLocale;
    localeCaptured = true;
    await workspace.adminApi.patch('/instance/settings/language', { data: { locale: 'ru-RU' } });
    await openAuthenticatedPage(page, workspace.owner, '/dashboard');
    await expect(page.getByText('Последние запуски', { exact: true })).toBeVisible();

    await page.goto(`/projects/${workspace.projectId}/checks`);
    await expect(page.getByRole('heading', { name: 'Проверки', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Новая проверка' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Импорт .spec.ts' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Запустить набор' })).toHaveCount(1);
    await expect(page.getByRole('columnheader', { name: 'Проверка' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Статус' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Последний запуск' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Действия' })).toBeVisible();
    const checkActions = page.locator('.ant-table-row .ant-dropdown-trigger').first();
    await checkActions.click();
    await expect(page.getByRole('menuitem', { name: 'Изменить' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Дублировать' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Экспорт .spec.ts' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: testInfo.outputPath('checks-actions-1440.png') });
    for (const width of [1280, 1024, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole('button', { name: 'Новая проверка' })).toBeVisible();
      const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(hasHorizontalOverflow, `page should not overflow at ${width}px`).toBe(false);
      if (width === 768) await page.screenshot({ path: testInfo.outputPath('checks-actions-768.png') });
    }
    await page.setViewportSize({ width: 1280, height: 720 });

    const projectNav = (section: string) => page.locator(`.wt-shell-navigation a[href="/projects/${workspace.projectId}/${section}"]`);
    await projectNav('suites').click();
    await expect(page.getByRole('heading', { name: 'Наборы проверок', exact: true })).toBeVisible();
    await expect(page.getByText('Группы проверок, которые можно запускать вместе.')).toBeVisible();
    await expect(page.getByText('Наборов пока нет')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Новый набор' })).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('suites-actions-1280.png') });

    await projectNav('runs').click();
    await expect(page.getByRole('heading', { name: 'Запуски', exact: true }).first()).toBeVisible();
    await expect(page.getByText('Последние результаты', { exact: true })).toBeVisible();
    await expectAnyVisible(
      page.getByRole('columnheader', { name: 'Статус' }),
      page.getByText('Здесь появится история запусков после выполнения проверок.', { exact: true })
    );

    await projectNav('schedules').click();
    await expect(page.getByRole('heading', { name: 'Расписания', exact: true }).first()).toBeVisible();
    await expect(page.getByText('Автоматически запускайте браузерные проверки или наборы по расписанию cron.')).toBeVisible();
    await expect(page.getByText('Расписаний пока нет')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Новое расписание' })).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('schedules-actions-1280.png') });
    await page.getByRole('button', { name: 'Новое расписание' }).click();
    const scheduleDialog = page.getByRole('dialog');
    await expect(scheduleDialog.getByText('Новое расписание', { exact: true })).toBeVisible();
    await expect(scheduleDialog.getByText('Название расписания', { exact: true })).toBeVisible();
    await expect(scheduleDialog.getByText('Шаблон cron', { exact: true })).toBeVisible();
    await scheduleDialog.getByRole('button', { name: 'Отмена' }).click();

    await projectNav('environments').click();
    await expect(page.getByText('Окружения', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Управляйте наборами переменных для URL и шагов проверок.')).toBeVisible();
    await expect(page.getByText('Окружений пока нет')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Новое окружение' })).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('environments-actions-1280.png') });

    await projectNav('alerts').click();
    await expect(page.getByRole('button', { name: 'Добавить канал' })).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('alerts-actions-1280.png') });
    await page.getByRole('button', { name: 'Добавить канал' }).click();
    await expect(page.getByRole('menuitem', { name: 'Добавить Telegram' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Добавить Slack' })).toBeVisible();
    await page.keyboard.press('Escape');

    await projectNav('authentication').click();
    await expect(page.getByRole('heading', { name: 'Аутентификация', exact: true }).first()).toBeVisible();
    await expect(page.getByText('Повторно используйте авторизованную сессию браузера для проверок в каждом окружении. Состояние авторизации хранится конфиденциально и никогда не передаётся браузеру.')).toBeVisible();
    await expect(page.getByText('Сначала создайте окружение, чтобы настроить повторное использование авторизации.')).toBeVisible();

    await projectNav('settings').click();
    await expect(page.getByText('Настройки проекта', { exact: true })).toBeVisible();
    await expect(page.getByText('Метаданные', { exact: true })).toBeVisible();
    await expect(page.getByText('Опасная зона', { exact: true })).toBeVisible();

    await projectNav('members').click();
    await expect(page.getByText('Участники проекта', { exact: true })).toBeVisible();
    await expect(page.getByText('Создайте доступ по адресу электронной почты, паролю и роли.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Создать доступ пользователю' })).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('members-actions-1280.png') });
    await page.getByRole('button', { name: 'Создать доступ пользователю' }).first().click();
    await expect(page.getByRole('dialog')).toContainText('Создать доступ пользователю');
    await expect(page.getByText('Электронная почта', { exact: true })).toBeVisible();
    await expect(page.getByText('Если пользователь уже существует, пароль будет проигнорирован.')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.locator('.wt-app-shell__account button').last().click();
    await page.getByRole('menuitem', { name: 'Изменить пароль' }).click();
    const passwordDialog = page.getByRole('dialog');
    await expect(passwordDialog).toContainText('Текущий пароль');
    await expect(passwordDialog).toContainText('Новый пароль');
    await expect(passwordDialog).toContainText('Повторите новый пароль');
    await passwordDialog.getByRole('button', { name: 'Отмена' }).click();

  } finally {
    if (localeCaptured) {
      await workspace.adminApi.patch('/instance/settings/language', { data: { locale: previousLocale } }).catch(() => undefined);
    }
  }
});

test('Russian unsaved-changes confirmation protects edits in the check editor', async ({ page, workspace }) => {
  let previousLocale = 'en';
  let localeCaptured = false;

  try {
    const settingsResponse = await workspace.adminApi.get('/instance/locales');
    expect(settingsResponse.status(), `GET /instance/locales returned ${settingsResponse.status()}`).toBe(200);
    const settings = await settingsResponse.json() as { activeLocale: string };
    previousLocale = settings.activeLocale;
    localeCaptured = true;
    await workspace.adminApi.patch('/instance/settings/language', { data: { locale: 'ru-RU' } });
    await openAuthenticatedPage(page, workspace.owner, `/tests/${workspace.checkId}/edit`);
    await page.getByRole('textbox', { name: 'Название проверки' }).fill(`${workspace.checkName} изменено`);
    await page.getByRole('button', { name: 'Отмена' }).click();

    const discardDialog = page.getByRole('dialog');
    await expect(discardDialog).toContainText('Отменить изменения?');
    await expect(discardDialog).toContainText('Есть несохранённые изменения. Покинуть страницу и потерять их?');
    await expect(discardDialog.getByRole('button', { name: 'Покинуть страницу' })).toBeVisible();
    await discardDialog.getByRole('button', { name: 'Остаться' }).click();
    await expect(discardDialog).toBeHidden();
  } finally {
    if (localeCaptured) {
      await workspace.adminApi.patch('/instance/settings/language', { data: { locale: previousLocale } }).catch(() => undefined);
    }
  }
});

test('Russian run details and schedule history show localized result labels', async ({ page, workspace }, testInfo) => {
  const settingsResponse = await workspace.adminApi.get('/instance/locales');
  expect(settingsResponse.status(), `GET /instance/locales returned ${settingsResponse.status()}`).toBe(200);
  const settings = await settingsResponse.json() as { activeLocale: string };
  const runId = 'e2e-localized-failed-run';
  const scheduleId = 'e2e-localized-schedule';
  const startedAt = new Date().toISOString();
  const apiOrigin = new URL(apiBaseUrl).origin;

  await page.route((url) => url.origin === apiOrigin && url.pathname === '/localization/public', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ activeLocale: 'ru-RU', messages: {} })
    });
  });

  await page.route((url) => url.origin === apiOrigin && url.pathname === `/runs/${runId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: runId,
        status: 'FAILED',
        startedAt,
        finishedAt: startedAt,
        durationMs: 1200,
        error: 'Expected: Success\nReceived: Failure\nTimeout 10000ms',
        screenshots: [],
        currentStep: 1,
        totalSteps: 1,
        testId: workspace.checkId,
        trace: { available: false, reason: 'Synthetic localization smoke run' },
        stepResults: [{
          index: 0,
          action: 'assertText',
          target: 'status-message',
          status: 'failed',
          durationMs: 50,
          error: 'Expected Success, received Failure'
        }],
        test: {
          id: workspace.checkId,
          name: workspace.checkName,
          url: 'https://example.test',
          device: null,
          environmentId: null,
          useProjectAuthentication: false,
          steps: [{ action: 'assertText', selector: '#status-message', expected: 'Success' }],
          testData: [],
          projectId: workspace.projectId,
          createdAt: startedAt,
          project: { id: workspace.projectId, name: workspace.projectName, createdAt: startedAt }
        },
        environment: null,
        schedule: null
      })
    });
  });

  await page.route((url) => url.origin === apiOrigin && url.pathname === `/schedules/${scheduleId}/history`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schedule: {
          id: scheduleId,
          name: 'Nightly UI checks',
          cron: '0 2 * * *',
          projectId: workspace.projectId,
          target: workspace.checkName
        },
        batches: [{
          tick: startedAt,
          status: 'FAILED',
          summary: '1 failed',
          durationMs: 1200,
          runs: [{
            id: runId,
            testName: workspace.checkName,
            status: 'FAILED',
            durationMs: 1200,
            startedAt,
            error: 'Expected Success, received Failure'
          }]
        }],
        pagination: { total: 1, page: 1, limit: 20, pages: 1 }
      })
    });
  });

  try {
    const applyLocale = await workspace.adminApi.patch('/instance/settings/language', { data: { locale: 'ru-RU' } });
    expect(applyLocale.status()).toBe(200);
    await openAuthenticatedPage(page, workspace.owner, `/runs/${runId}`);
    await expect(page.getByRole('heading', { name: 'Детали запуска', exact: true })).toBeVisible();
    await expect(page.getByText('Результаты шагов', { exact: true })).toBeVisible();
    await expect(page.getByText('Ожидалось', { exact: true })).toBeVisible();
    await expect(page.getByText('Получено', { exact: true })).toBeVisible();
    await expect(page.getByText('Описание ошибки', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('run-details-ru.png'), fullPage: true });

    await page.goto(`/schedules/${scheduleId}/history`);
    await expect(page.getByRole('heading', { name: 'История запусков', exact: true })).toBeVisible();
    await expect(page.getByText('Nightly UI checks', { exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Проверка' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Длительность' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Ошибка' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Просмотреть' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('schedule-history-ru.png'), fullPage: true });
  } finally {
    await workspace.adminApi.patch('/instance/settings/language', { data: { locale: settings.activeLocale } }).catch(() => undefined);
  }
});
