const PROJECT_SETTINGS_STORAGE_PREFIX = 'wrighttest.project-settings';

const DEFAULT_DEVICE_OPTIONS = [
  'Desktop Chrome',
  'Desktop 1280px',
  'iPhone 15 Pro',
  'Pixel 7'
] as const;

export type ProjectDefaultDevice = (typeof DEFAULT_DEVICE_OPTIONS)[number];

export type ProjectSettingsDraft = {
  description: string;
  defaultEnvironmentId?: string;
  defaultDevice: string;
};

export function getProjectSettingsStorageKey(projectId: string) {
  return `${PROJECT_SETTINGS_STORAGE_PREFIX}:${projectId}`;
}

export function readProjectSettingsDraft(projectId?: string): ProjectSettingsDraft | null {
  if (!projectId || typeof window === 'undefined') return null;

  try {
    const rawValue = window.localStorage.getItem(getProjectSettingsStorageKey(projectId));
    if (!rawValue) return null;

    const parsed = JSON.parse(rawValue) as Partial<ProjectSettingsDraft>;
    return {
      description: typeof parsed.description === 'string' ? parsed.description : '',
      defaultEnvironmentId:
        typeof parsed.defaultEnvironmentId === 'string' && parsed.defaultEnvironmentId ? parsed.defaultEnvironmentId : undefined,
      defaultDevice:
        typeof parsed.defaultDevice === 'string' && DEFAULT_DEVICE_OPTIONS.includes(parsed.defaultDevice as ProjectDefaultDevice)
          ? parsed.defaultDevice
          : DEFAULT_DEVICE_OPTIONS[0]
    };
  } catch {
    return null;
  }
}

export function writeProjectSettingsDraft(projectId: string, value: ProjectSettingsDraft) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(getProjectSettingsStorageKey(projectId), JSON.stringify(value));
}

export function clearProjectSettingsDraft(projectId?: string) {
  if (!projectId || typeof window === 'undefined') return;
  window.localStorage.removeItem(getProjectSettingsStorageKey(projectId));
}

export function getProjectDescription(projectId?: string) {
  return readProjectSettingsDraft(projectId)?.description?.trim() ?? '';
}

export function getProjectDefaultDeviceOptions() {
  return [...DEFAULT_DEVICE_OPTIONS];
}
