export function normalizeDeviceForPayload(device: string | null | undefined) {
  if (device === undefined || device === null) return null;
  const trimmed = device.trim();
  return trimmed.length > 0 ? trimmed : null;
}
