import '../setup-playwright-env';
import { devices, type BrowserContextOptions } from 'playwright';

export const POPULAR_DEVICES = [
  { label: 'iPhone 15', value: 'iPhone 15' },
  { label: 'iPhone 15 Pro', value: 'iPhone 15 Pro' },
  { label: 'iPhone 15 Pro Max', value: 'iPhone 15 Pro Max' },
  { label: 'iPhone SE', value: 'iPhone SE' },
  { label: 'iPad Pro 11', value: 'iPad Pro 11' },
  { label: 'iPad Mini', value: 'iPad (gen 6)' },
  { label: 'Pixel 7', value: 'Pixel 7' },
  { label: 'Pixel 5', value: 'Pixel 5' },
  { label: 'Samsung Galaxy S23', value: 'Galaxy S9+' },
  { label: 'Samsung Galaxy Tab S4', value: 'Galaxy Tab S4' },
  { label: 'Desktop 1280px', value: 'Desktop Chrome' },
  { label: 'Desktop 1920px (HiDPI)', value: 'Desktop Chrome HiDPI' }
] as const;

const CUSTOM_DEVICE_PRESETS: Record<string, BrowserContextOptions> = {
  'Desktop Chrome': {
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false
  },
  'Desktop Chrome HiDPI': {
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false
  }
};

export function getAvailableDevices() {
  return POPULAR_DEVICES.filter((device) => device.value in devices || device.value in CUSTOM_DEVICE_PRESETS);
}

export function resolveDeviceConfig(device?: string): BrowserContextOptions {
  if (!device) return {};
  if (device in CUSTOM_DEVICE_PRESETS) {
    return CUSTOM_DEVICE_PRESETS[device];
  }
  if (device in devices) {
    return devices[device as keyof typeof devices];
  }
  return {};
}
