const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {createProxy} = require('./ashconnect-public-proxy.cjs');
test('public resident proxy isolates private routes, origins and operator credentials', async () => {
  let last;
  const origin = http.createServer((req, res) => {
    last = req.headers; req.resume();
    res.writeHead(200, {'content-type': 'application/json', 'set-cookie': 'ashconnect-resident=test; HttpOnly; SameSite=Lax; Path=/api/ash-connect'});
    res.end(JSON.stringify({ok:true}));
  });
  await new Promise(r => origin.listen(0, '127.0.0.1', r));
  const proxy = createProxy({upstreamPort: origin.address().port});
  await new Promise(r => proxy.listen(0, '127.0.0.1', r));
  const request = (path, method='GET', headers={}, body='') => new Promise((resolve,reject) => {
    const req = http.request({hostname:'127.0.0.1',port:proxy.address().port,path,method,headers:{host:'demo.trycloudflare.com',...headers}}, res => {
      res.resume(); res.on('end',()=>resolve({status:res.statusCode,headers:res.headers}));
    });req.on('error',reject);req.end(body);
  });
  try {
    for (const path of ['/api/watch-areas','/api/workspace','/internal/ash-connect','/home-watch','/_next/static/../api/watch-areas','/_next/static/%2e%2e/test.js']) assert.equal((await request(path)).status,404,path);
    assert.equal((await request('/api/ash-connect','POST',{origin:'https://demo.trycloudflare.com'})).status,404);
    assert.equal((await request('/api/home-search','POST')).status,403);
    assert.equal((await request('/api/home-search','POST',{origin:'https://other.trycloudflare.com'})).status,403);
    assert.equal((await request('/api/home-search','POST',{origin:'https://demo.trycloudflare.com','sec-fetch-site':'cross-site'})).status,403);
    const good = await request('/api/ash-connect/resident','POST',{origin:'https://demo.trycloudflare.com','content-type':'application/json','x-ashconnect-token':'operator-secret','x-forwarded-host':'evil.test','x-forwarded-proto':'https'},'{}');
    assert.equal(good.status,200);assert.match(good.headers['set-cookie'][0],/; Secure$/);
    assert.equal(last.origin,`http://127.0.0.1:${origin.address().port}`);assert.equal(last['x-ashconnect-token'],undefined);assert.equal(last['x-forwarded-host'],undefined);
    assert.equal((await request('/api/ash-connect','GET',{'x-ashconnect-token':'operator-secret'})).status,200);assert.equal(last['x-ashconnect-token'],undefined);
    assert.equal((await request('/_next/static/chunks/app/ash-connect/page-123.js')).status,200);
    assert.equal((await request('/api/ash-connect','GET',{host:'evil.test'})).status,400);
    assert.equal((await request('/api/home-search','POST',{origin:'https://demo.trycloudflare.com'},'x'.repeat(16_385))).status,413);
  } finally {await Promise.all([new Promise(r=>proxy.close(r)),new Promise(r=>origin.close(r))]);}
});
