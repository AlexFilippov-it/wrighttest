import type { Prisma, TestRun } from '@prisma/client';
import prisma from '../prisma';
import { resolveBrowserUrl } from '../utils/runtime-url';

interface TelegramConfig {
  botToken: string;
  chatId: string;
}

interface SlackConfig {
  webhookUrl: string;
}

type NotificationChannelRecord = {
  id: string;
  type: string;
  name: string;
  config: unknown;
  onFailed: boolean;
  onRecovered: boolean;
  onPassed: boolean;
  enabled: boolean;
};

export async function sendTelegram(config: TelegramConfig, text: string) {
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.chatId,
      text
    })
  });

  if (!response.ok) {
    throw new Error(`Telegram error: ${response.status} ${response.statusText}`);
  }
}

export async function sendSlack(config: SlackConfig, text: string) {
  const response = await fetch(config.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });

  if (!response.ok) {
    throw new Error(`Slack error: ${response.status} ${response.statusText}`);
  }
}

type StepResultRecord = {
  index?: number;
  action?: string;
  status?: string;
  error?: string | null;
};

function formatDuration(durationMs: number | null) {
  return durationMs != null ? `${(durationMs / 1000).toFixed(2)}s` : '—';
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function formatStepAction(action?: string) {
  switch (action) {
    case 'goto':
      return 'Navigate to URL';
    case 'click':
      return 'Click element';
    case 'fill':
      return 'Fill input';
    case 'press':
      return 'Press key';
    case 'selectOption':
      return 'Select option';
    case 'waitForSelector':
      return 'Wait for element';
    case 'assertVisible':
      return 'Assert visible';
    case 'assertHidden':
      return 'Assert hidden';
    case 'assertText':
      return 'Assert text';
    case 'assertValue':
      return 'Assert value';
    case 'assertURL':
      return 'Assert URL';
    case 'assertTitle':
      return 'Assert title';
    case 'assertChecked':
      return 'Assert checked';
    case 'assertCount':
      return 'Assert count';
    default:
      return 'Unknown step';
  }
}

function parseStepResults(value: Prisma.JsonValue | null): StepResultRecord[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const candidate = item as Record<string, unknown>;
    return [
      {
        index: typeof candidate.index === 'number' ? candidate.index : undefined,
        action: typeof candidate.action === 'string' ? candidate.action : undefined,
        status: typeof candidate.status === 'string' ? candidate.status : undefined,
        error: typeof candidate.error === 'string' ? candidate.error : null
      }
    ];
  });
}

function resolveRunResultUrl(runId: string) {
  const baseUrl = process.env.FRONTEND_URL || process.env.FRONTEND_DEV_URL || 'http://localhost:5173';

  try {
    return new URL(`/runs/${runId}`, resolveBrowserUrl(baseUrl)).toString();
  } catch {
    return '';
  }
}

function buildPassedMessage(run: TestRun, testName: string, projectName: string) {
  const lines = [
    '✅ Check passed',
    '',
    `Project: ${projectName}`,
    `Check: ${testName}`,
    `Duration: ${formatDuration(run.durationMs)}`
  ];

  const runResultUrl = resolveRunResultUrl(run.id);
  if (runResultUrl) {
    lines.push('', 'Open result:', runResultUrl);
  }

  lines.push('', `Run ID: ${run.id}`);
  return lines.join('\n');
}

function buildRecoveredMessage(run: TestRun, testName: string, projectName: string) {
  const lines = [
    '✅ Check recovered',
    '',
    `Project: ${projectName}`,
    `Check: ${testName}`,
    'Previous status: Failed',
    'Current status: Passed',
    `Duration: ${formatDuration(run.durationMs)}`
  ];

  const runResultUrl = resolveRunResultUrl(run.id);
  if (runResultUrl) {
    lines.push('', 'Open result:', runResultUrl);
  }

  lines.push('', `Run ID: ${run.id}`);
  return lines.join('\n');
}

function buildFailedMessage(run: TestRun & { currentStep?: number | null; stepResults?: Prisma.JsonValue | null }, testName: string, projectName: string) {
  const stepResults = parseStepResults(run.stepResults ?? null);
  const failedStep = stepResults.find((step) => step.status === 'failed') ?? null;
  const failedStepNumber = typeof run.currentStep === 'number' && run.currentStep > 0
    ? run.currentStep
    : typeof failedStep?.index === 'number'
      ? failedStep.index + 1
      : null;
  const failedStepAction = formatStepAction(failedStep?.action);
  const shortErrorSource = failedStep?.error || run.error || 'Unknown error';
  const shortError = truncateText(normalizeWhitespace(shortErrorSource), 300);

  const lines = [
    '❌ Check failed',
    '',
    `Project: ${projectName}`,
    `Check: ${testName}`,
    `Failed step: ${failedStepNumber ? `Step ${failedStepNumber} — ${failedStepAction}` : failedStepAction}`,
    `Error: ${shortError}`,
    '',
    `Duration: ${formatDuration(run.durationMs)}`
  ];

  const runResultUrl = resolveRunResultUrl(run.id);
  if (runResultUrl) {
    lines.push('', 'Open result:', runResultUrl);
  }

  lines.push('', `Run ID: ${run.id}`);
  return lines.join('\n');
}

function buildMessage(
  run: TestRun & { currentStep?: number | null; stepResults?: Prisma.JsonValue | null },
  testName: string,
  projectName: string,
  isRecovered: boolean
): string {
  if (run.status === 'FAILED') {
    return buildFailedMessage(run, testName, projectName);
  }

  if (isRecovered) {
    return buildRecoveredMessage(run, testName, projectName);
  }

  return buildPassedMessage(run, testName, projectName);
}

function channelEnabledForRun(
  channel: NotificationChannelRecord,
  status: string,
  isRecovered: boolean
) {
  if (!channel.enabled) return false;
  if (status === 'FAILED') return channel.onFailed;
  if (status === 'PASSED') {
    if (isRecovered && channel.onRecovered) return true;
    return channel.onPassed;
  }
  return false;
}

export async function notifyRunResult(run: TestRun) {
  const runWithRelations = await prisma.testRun.findUnique({
    where: { id: run.id },
    include: {
      test: {
        include: {
          project: {
            include: {
              channels: true
            }
          }
        }
      }
    }
  });

  if (!runWithRelations) return;

  const previousRun = runWithRelations.status === 'PASSED'
    ? await prisma.testRun.findFirst({
        where: {
          testId: runWithRelations.testId,
          status: { in: ['FAILED', 'PASSED'] },
          startedAt: { lt: runWithRelations.startedAt }
        },
        orderBy: { startedAt: 'desc' }
      })
    : null;
  const isRecovered = previousRun?.status === 'FAILED';

  const channels = runWithRelations.test.project.channels.filter((channel) =>
    channelEnabledForRun(channel as NotificationChannelRecord, runWithRelations.status, isRecovered)
  ) as NotificationChannelRecord[];

  if (channels.length === 0) return;

  const message = buildMessage(runWithRelations, runWithRelations.test.name, runWithRelations.test.project.name, isRecovered);

  await Promise.allSettled(
    channels.map(async (channel) => {
      try {
        if (channel.type === 'telegram') {
          await sendTelegram(channel.config as TelegramConfig, message);
        } else if (channel.type === 'slack') {
          await sendSlack(channel.config as SlackConfig, message);
        } else {
          throw new Error(`Unsupported channel type: ${channel.type}`);
        }

        await prisma.notificationChannel.update({
          where: { id: channel.id },
          data: {
            lastTestAt: new Date(),
            lastTestStatus: runWithRelations.status
          }
        });

        console.log(`[Notifier] Sent ${channel.type} notification for run ${run.id}`);
      } catch (error) {
        console.error(`[Notifier] Failed ${channel.type} notification for run ${run.id}:`, error);
      }
    })
  );
}
