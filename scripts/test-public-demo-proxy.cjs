const assert = require('node:assert/strict');
const http = require('node:http');
const {spawn} = require('node:child_process');
const {once} = require('node:events');

(async () => {
 const upstream = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': req.url.endsWith('.mjs') ? 'text/javascript' : 'application/json'});
  res.end(req.url.endsWith('.mjs') ? 'export const ready = true;' : '{}');
 });
 upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
 const reservation = http.createServer().listen(0, '127.0.0.1'); await once(reservation, 'listening');
 const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
 const child = spawn(process.execPath, ['scripts/cloud/public-demo-proxy.cjs'], {
  env: {...process.env, PORT: String(port), UPSTREAM_HOST: '127.0.0.1', UPSTREAM_PORT: String(upstream.address().port)}, stdio: 'inherit',
 });
 try {
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
   try {await fetch(base+'/prevent'); break;} catch (error) {if (i === 50) throw error; await new Promise(resolve => setTimeout(resolve, 20));}
  }
  for (const asset of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
   const response = await fetch(`${base}/maplibre/${asset}`);
   assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /javascript/);
   assert.match(await response.text(), /export const ready/);
  }
  for (const path of ['/.env.local', '/api/watch-areas', '/maplibre/private.json']) assert.equal((await fetch(base+path)).status, 404);
  assert.equal((await fetch(base+'/api/receptivity?view=map')).status, 200);
  console.log('PASS: map worker and its shared module load; private paths remain unavailable.');
 } finally {child.kill(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));}
})().catch(error => {console.error(error); process.exitCode = 1;});
