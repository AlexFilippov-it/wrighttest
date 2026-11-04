import { lookup } from 'node:dns/promises';
import http, { type IncomingMessage, type OutgoingHttpHeaders } from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import ipaddr from 'ipaddr.js';

const MAX_TUNNEL_MS = 10 * 60_000;

function isPublicAddress(address: string) {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
      parsed = (parsed as ipaddr.IPv6).toIPv4Address();
    }
    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
}

function parseAuthority(authority: string) {
  const url = new URL(`http://${authority}`);
  if (url.username || url.password || !url.hostname) throw new Error('Proxy authority is invalid');
  const port = Number(url.port || 80);
  if (port !== 80 && port !== 443) throw new Error('Only public HTTP and HTTPS destinations are allowed');
  return { hostname: url.hostname.replace(/^\[|\]$/g, '').toLowerCase(), port };
}

async function resolvePublicAddress(hostname: string) {
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Private network destinations are not allowed');
  }

  if (net.isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw new Error('Private network destinations are not allowed');
    return hostname;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('The destination did not resolve exclusively to public addresses');
  }
  return addresses[0].address;
}

function reject(socket: Duplex, status = 403) {
  if (!socket.destroyed) {
    socket.end(`HTTP/1.1 ${status} Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }
}

async function openTunnel(request: IncomingMessage, client: Duplex) {
  let upstream: net.Socket | undefined;
  client.on('error', () => upstream?.destroy());
  try {
    const { hostname, port } = parseAuthority(request.url ?? '');
    if (port !== 443) throw new Error('Only HTTPS tunnels are allowed');
    const address = await resolvePublicAddress(hostname);
    if (client.destroyed) return;

    const tunnel = net.connect({ host: address, port });
    upstream = tunnel;
    const timer = setTimeout(() => tunnel.destroy(new Error('Tunnel timeout')), MAX_TUNNEL_MS);
    timer.unref();
    tunnel.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      client.pipe(tunnel);
      tunnel.pipe(client);
    });
    tunnel.once('error', () => reject(client, 502));
    tunnel.once('close', () => clearTimeout(timer));
    client.once('close', () => tunnel.destroy());
  } catch {
    reject(client);
  }
}

export class PublicEgressProxy {
  private readonly server = http.createServer((request, response) => {
    void this.forwardHttp(request, response);
  });
  private readonly sockets = new Set<net.Socket>();

  private address?: string;
  private starting?: Promise<string>;

  constructor() {
    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
    });
  }

  async start() {
    if (this.address) return this.address;
    if (this.starting) return this.starting;
    this.starting = this.startServer();
    try { return await this.starting; }
    finally { this.starting = undefined; }
  }

  private async startServer() {
    this.server.on('connect', (request, socket) => { void openTunnel(request, socket); });
    this.server.on('upgrade', (_request, socket) => reject(socket));
    await new Promise<void>((resolve, rejectStart) => {
      this.server.once('error', rejectStart);
      this.server.listen(0, '127.0.0.1', () => {
        this.server.off('error', rejectStart);
        resolve();
      });
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Could not start browser egress proxy');
    this.address = `http://127.0.0.1:${address.port}`;
    return this.address;
  }

  async close() {
    if (!this.address) return;
    this.address = undefined;
    await new Promise<void>((resolve) => {
      this.server.close(() => resolve());
      for (const socket of this.sockets) socket.destroy();
    });
  }

  private async forwardHttp(request: IncomingMessage, response: http.ServerResponse) {
    let upstream: http.ClientRequest | undefined;
    request.on('aborted', () => upstream?.destroy());
    response.on('close', () => {
      if (!response.writableEnded) upstream?.destroy();
    });
    try {
      const target = new URL(request.url ?? '');
      if (target.protocol !== 'http:' || target.username || target.password) throw new Error('Only public HTTP destinations are allowed');
      const port = Number(target.port || 80);
      if (port !== 80) throw new Error('Only public HTTP destinations are allowed');
      const address = await resolvePublicAddress(target.hostname);
    const headers: OutgoingHttpHeaders = { ...request.headers, host: target.host, connection: 'close' };
      delete headers['proxy-connection'];
      upstream = http.request({
        hostname: address,
        port,
        method: request.method,
        path: `${target.pathname}${target.search}`,
        headers,
        timeout: MAX_TUNNEL_MS
      }, (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      });
      upstream.on('error', () => {
        if (!response.headersSent) response.writeHead(502);
        response.end();
      });
      upstream.on('timeout', () => upstream?.destroy(new Error('HTTP request timeout')));
      request.pipe(upstream);
    } catch {
      response.writeHead(403, { connection: 'close' });
      response.end();
    }
  }
}

export { isPublicAddress, resolvePublicAddress };
