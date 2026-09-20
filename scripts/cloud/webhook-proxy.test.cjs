const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const path = require('node:path');

for (const provider of ['all', 'imessage']) test(`public proxy (${provider}) isolates internal routes and preserves signed webhook bytes`, async t => {
  const received = [];
  const backend = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    received.push({url: request.url, headers: request.headers, body: Buffer.concat(chunks).toString()});
    response.writeHead(202, {'content-type': 'application/json'}); response.end('{"accepted":true}');
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => backend.close());
  const reservation = http.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const proxy = spawn(process.execPath, [path.join(__dirname, 'webhook-proxy.cjs')], {
    env: {...process.env, GINGER_WEBHOOK_PROVIDER: provider, GINGER_WEBHOOK_PROXY_PORT: String(port), IMESSAGE_PORT: String(backend.address().port)},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => proxy.kill('SIGTERM'));
  await Promise.race([once(proxy.stdout, 'data'), once(proxy, 'exit').then(() => {throw new Error('Proxy startup failed');})]);
  const base = `http://127.0.0.1:${port}`;
  for (const route of ['/internal/ash-connect', '/health', '/', '/api/forest/status', '/api/agents/ginger-watch/channels/whatsapp/webhook/extra']) {
    assert.equal((await fetch(base + route, {method: 'POST', body: '{}'})).status, 404);
  }
  const route = `/api/agents/ginger-watch/channels/${provider === 'imessage' ? 'imessage' : 'whatsapp'}/webhook`;
  assert.equal((await fetch(base + route)).status, 404);
  assert.equal((await fetch(base + route, {method: 'POST', body: 'x'.repeat(256_001)})).status, 413);
  assert.equal(received.length, 0);
  const raw = '{ "message_uuid" : "fixture" }\n';
  const result = await fetch(base + route + '?token=fixture%2Btoken', {method: 'POST', body: raw,
    headers: {'authorization': 'Bearer fixture', 'x-photon-signature': 'fixture-signature', 'content-type': 'application/json'}});
  assert.equal(result.status, 202); assert.equal(await result.text(), '{"accepted":true}');
  assert.equal(received[0].url, route + '?token=fixture%2Btoken');
  assert.equal(received[0].body, raw);
  assert.equal(received[0].headers.authorization, 'Bearer fixture');
  assert.equal(received[0].headers['x-photon-signature'], 'fixture-signature');
  for (const allowed of ['/api/agents/ginger-watch/channels/imessage/webhook', '/api/agents/ginger-watch/channels/whatsapp/status']) {
    assert.equal((await fetch(base + allowed, {method: 'POST', body: '{}'})).status, provider === 'imessage' && allowed.includes('/whatsapp/') ? 404 : 202);
  }
  if (provider === 'imessage') assert.equal((await fetch(base + '/api/agents/ginger-watch/channels/whatsapp/webhook', {method: 'POST', body: '{}'})).status, 404);
  await new Promise(resolve => backend.close(resolve));
  assert.equal((await fetch(base + route, {method: 'POST', body: '{}'})).status, 502);
});
