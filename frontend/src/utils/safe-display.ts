export function safeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '[URL hidden]';
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split(/[?#]/, 1)[0] || '[URL hidden]';
  }
}
