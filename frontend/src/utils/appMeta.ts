export const APP_NAME = 'WrightTest';
export const APP_DESCRIPTION = 'UI Test Automation Platform';
export const APP_COPYRIGHT = '\u00a9 2026 WrightTest';

const rawVersion = import.meta.env.VITE_APP_VERSION?.trim();
const rawGitCommit = import.meta.env.VITE_GIT_COMMIT?.trim();
const rawBuildDate = import.meta.env.VITE_BUILD_DATE?.trim();
const rawEnvironment = import.meta.env.VITE_APP_ENV?.trim();

export const APP_VERSION = rawVersion
  ? rawVersion.startsWith('v')
    ? rawVersion
    : `v${rawVersion}`
  : 'version unavailable';

export const APP_GIT_COMMIT = rawGitCommit || '';
export const APP_BUILD_DATE = rawBuildDate || '';
export const APP_ENVIRONMENT = rawEnvironment || (import.meta.env.DEV ? 'local' : 'production');

export const APP_RELEASE_NOTES = {
  version: 'v0.2.0',
  items: [
    'Added global Dashboard and Runs pages.',
    'Added project settings with default environment and default device.',
    'Added project description and metadata.',
    'Added schedule management.',
    'Added environment variables.',
    'Added Telegram and Slack alert channels.',
    'Improved run result diagnostics with screenshots, step results, raw errors, and trace viewer.',
    'Added footer with version and build information.'
  ]
};

export function formatBuildDate(value: string) {
  if (!value) return '';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
