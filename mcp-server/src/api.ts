export type JsonObject = Record<string, unknown>;

export class WrightTestApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'WrightTestApiError';
  }
}

export class WrightTestApi {
  private readonly baseUrl: URL;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.baseUrl = new URL(baseUrl);
    if (!['http:', 'https:'].includes(this.baseUrl.protocol) || this.baseUrl.username || this.baseUrl.password) {
      throw new Error('WRIGHTTEST_URL must be an HTTP(S) URL without embedded credentials');
    }
  }

  async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const url = new URL(path.replace(/^\//, ''), this.baseUrl.href.endsWith('/') ? this.baseUrl : `${this.baseUrl.href}/`);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.token}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers
        },
        signal: init.signal ?? AbortSignal.timeout(30_000),
        redirect: 'error'
      });
    } catch (error) {
      if (error instanceof WrightTestApiError) throw error;
      throw new WrightTestApiError(error instanceof Error ? error.message : 'Could not connect to WrightTest');
    }

    if (!response.ok) {
      let message = response.statusText || 'Request failed';
      try {
        const body = await response.json() as { error?: unknown };
        if (typeof body.error === 'string') message = body.error;
        else if (body.error && typeof body.error === 'object') message = 'The request parameters were rejected';
      } catch {
        // Do not include a raw error body in MCP output.
      }
      throw new WrightTestApiError(`WrightTest API ${response.status}: ${message}`, response.status);
    }

    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  absoluteUrl(path: string) {
    return new URL(path, this.baseUrl).href;
  }
}

export function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

export function redactStrings<T>(value: T, secrets: string[]): T {
  const replacements = [...new Set(secrets.filter((secret) => secret.length >= 3))].sort((a, b) => b.length - a.length);
  const visit = (item: unknown): unknown => {
    if (typeof item === 'string') {
      return replacements.reduce((result, secret) => result.split(secret).join('[REDACTED]'), item);
    }
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item).map(([key, nested]) => [key, visit(nested)]));
    }
    return item;
  };
  return visit(value) as T;
}
