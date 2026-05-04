import type { TestRun } from '@prisma/client';
import prisma from '../prisma';

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
  onPassed: boolean;
};

export async function sendTelegram(config: TelegramConfig, text: string) {
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.chatId,
      text,
      parse_mode: 'HTML'
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

function buildMessage(run: TestRun, testName: string, projectName: string): string {
  const icon = run.status === 'PASSED' ? '✅' : '❌';
  const duration = run.durationMs ? `${(run.durationMs / 1000).toFixed(2)}s` : '—';

  return [
    `${icon} <b>${run.status}</b> — ${projectName} / ${testName}`,
    `Duration: ${duration}`,
    run.error ? `Error: <code>${run.error}</code>` : '',
    `Run ID: <code>${run.id}</code>`
  ]
    .filter(Boolean)
    .join('\n');
}

function channelEnabledForRun(channel: NotificationChannelRecord, status: string) {
  if (status === 'FAILED') return channel.onFailed;
  if (status === 'PASSED') return channel.onPassed;
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

  const channels = runWithRelations.test.project.channels.filter((channel) =>
    channelEnabledForRun(channel as NotificationChannelRecord, runWithRelations.status)
  ) as NotificationChannelRecord[];

  if (channels.length === 0) return;

  const message = buildMessage(runWithRelations, runWithRelations.test.name, runWithRelations.test.project.name);

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

        console.log(`[Notifier] Sent ${channel.type} notification for run ${run.id}`);
      } catch (error) {
        console.error(`[Notifier] Failed ${channel.type} notification for run ${run.id}:`, error);
      }
    })
  );
}
