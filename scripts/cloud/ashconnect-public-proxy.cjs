#!/usr/bin/env node
// Public resident surface only. Keep the rest of Ginger and the operator bridge private.
const http = require('node:http');

function createProxy({upstreamPort = 3000} = {}) {
  const internalHost = `127.0.0.1:${upstreamPort}`;
  const server = http.createServer(async (req, res) => {
    const path = (req.url || '').split('?')[0];
    const read = req.method === 'GET' || req.method === 'HEAD';
    if (read && path === '/') {res.writeHead(302, {Location: '/ash-connect', 'Cache-Control': 'no-store'}); res.end(); return;}
    const asset = /^\/_next\/static\/[A-Za-z0-9_./-]+\.(?:js|css|woff2?|ttf|png|svg)$/.test(path) && !path.includes('..');
    const allowed = read && (asset || ['/ash-connect', '/icon.svg', '/favicon.ico', '/api/ash-connect', '/api/ash-connect/resident'].includes(path))
      || req.method === 'POST' && ['/api/home-search', '/api/ash-connect/resident'].includes(path);
    if (!allowed) {res.writeHead(404); res.end(); return;}
    const host = req.headers.host || '';
    if (!/^[a-z0-9-]+\.trycloudflare\.com$/.test(host)) {res.writeHead(400); res.end(); return;}
    if (req.method === 'POST' && (req.headers.origin !== `https://${host}` || req.headers['sec-fetch-site'] === 'cross-site')) {
      res.writeHead(403); res.end(); return;
    }
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16_384) {res.writeHead(413); res.end(); return;}
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      // Rebase only after validating the browser's real origin; never trust caller forwarding/auth headers.
      const headers = {host: internalHost, 'content-length': body.length, 'x-forwarded-proto': 'http'};
      for (const name of ['accept', 'content-type', 'cookie', 'accept-language']) if (req.headers[name]) headers[name] = req.headers[name];
      if (req.method === 'POST') headers.origin = `http://${internalHost}`;
      const upstream = http.request({hostname: '127.0.0.1', port: upstreamPort, method: req.method, path: req.url, headers, timeout: 65_000}, result => {
        const responseHeaders = {...result.headers, 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'x-robots-tag': 'noindex, nofollow'};
        delete responseHeaders['transfer-encoding'];
        if (!asset) responseHeaders['cache-control'] = 'no-store';
        if (responseHeaders['set-cookie']) responseHeaders['set-cookie'] = responseHeaders['set-cookie'].map(cookie => /;\s*Secure(?:;|$)/i.test(cookie) ? cookie : `${cookie}; Secure`);
        res.writeHead(result.statusCode || 502, responseHeaders); result.pipe(res);
        result.on('error', () => res.destroy());
      });
      upstream.on('timeout', () => upstream.destroy());
      upstream.on('error', () => {if (!res.headersSent) res.writeHead(502); res.end();});
      res.on('close', () => upstream.destroy()); upstream.end(body);
    } catch {if (!res.headersSent) res.writeHead(400); res.end();}
  });
  server.requestTimeout = 20_000; server.headersTimeout = 10_000;
  return server;
}
module.exports = {createProxy};
if (require.main === module) {
  const port = Number(process.env.ASHCONNECT_PUBLIC_PORT || 4114);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid public proxy port');
  const server = createProxy();
  server.listen(port, '127.0.0.1', () => console.log(`AshConnect resident proxy listening on 127.0.0.1:${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close(() => process.exit(0)));
}
