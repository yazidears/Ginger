#!/usr/bin/env node
// Expose only this process through the HTTPS tunnel, never Next or the worker.
const http = require('node:http');
const provider = process.env.GINGER_WEBHOOK_PROVIDER || 'all';
if (!['all', 'imessage'].includes(provider)) throw new Error('Invalid webhook provider');
const paths = new Set([
  '/api/agents/ginger-watch/channels/imessage/webhook',
  '/api/agents/ginger-watch/channels/whatsapp/webhook',
  '/api/agents/ginger-watch/channels/whatsapp/status',
].filter(path => provider === 'all' || path.includes('/imessage/')));
const port = Number(process.env.GINGER_WEBHOOK_PROXY_PORT || 4113);
const upstreamPort = Number(process.env.IMESSAGE_PORT || 4112);
for (const value of [port, upstreamPort]) {
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error('Invalid webhook port');
}
const server = http.createServer(async (request, response) => {
  const path = request.url?.split('?')[0];
  if (request.method !== 'POST' || !paths.has(path)) {
    response.writeHead(404); response.end(); return;
  }
  try {
    let length = 0; const chunks = [];
    for await (const chunk of request) {
      length += chunk.length;
      if (length > 256_000) {response.writeHead(413); response.end(); return;}
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    const headers = {'content-type': request.headers['content-type'] || 'application/json', 'content-length': body.length};
    // Preserve provider verification headers and exact body/query bytes.
    for (const [name, value] of Object.entries(request.headers)) {
      if (value && (name === 'authorization' || name.startsWith('x-') || name.startsWith('webhook-'))) headers[name] = value;
    }
    const upstream = http.request({hostname: '127.0.0.1', port: upstreamPort,
      method: 'POST', path: request.url, headers, timeout: 15_000}, result => {
      response.writeHead(result.statusCode || 502, {'content-type': result.headers['content-type'] || 'text/plain'});
      result.pipe(response);
      result.on('error', () => response.destroy());
    });
    upstream.on('timeout', () => upstream.destroy());
    upstream.on('error', () => {if (!response.headersSent) response.writeHead(502); response.end();});
    response.on('close', () => upstream.destroy());
    upstream.end(body);
  } catch {if (!response.headersSent) response.writeHead(400); response.end();}
});
server.requestTimeout = 20_000;
server.headersTimeout = 10_000;
server.listen(port, '127.0.0.1', () => console.log(`Webhook-only proxy listening on 127.0.0.1:${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 20_000).unref();
});
