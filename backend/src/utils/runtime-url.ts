function isLocalhostHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export function resolveBrowserUrl(rawUrl: string): string {
  const internalUrl = process.env.FRONTEND_INTERNAL_URL;
  if (!internalUrl) return rawUrl;

  try {
    const parsed = new URL(rawUrl);
    if (!isLocalhostHost(parsed.hostname)) return rawUrl;

    const internal = new URL(internalUrl);
    internal.pathname = parsed.pathname;
    internal.search = parsed.search;
    internal.hash = parsed.hash;
    return internal.toString();
  } catch {
    return rawUrl;
  }
}
