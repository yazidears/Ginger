// Public demo gateway. Run only against the isolated demo deployment.
const http = require('node:http');
const {createGzip} = require('node:zlib');
const readApi = /^\/api\/(receptivity(?:\/[^/]+)?|exposure(?:\/cell)?|sage\/(?:runs(?:\/[a-f0-9-]{36}(?:\/exposure)?)?|buildings)|scenarios\/[a-f0-9-]{36}|forest\/(?:status|trees|tiles|weather|runs\/[a-f0-9]{32}|jobs\/[a-f0-9]{32})|ash\/rooms(?:\/[a-f0-9-]{36})?|ash-connect(?:\/resident)?|firescope\/[a-z-]+\/[0-9]+\/[0-9]+\/[0-9]+|detections|satellite\/(?:scenes|history|raw|raster))$/;
const writeApi = /^\/api\/(scenarios|sage\/runs|forest\/(?:process|runs)|ash\/rooms(?:\/[a-f0-9-]{36})?|home-search)$/;
const pages = new Set(['/','/prevent','/sage','/ash','/forest','/demo','/satellite','/replay','/ash-connect','/icon.svg','/favicon.ico']);
const counts = new Map();
http.createServer(async (req,res)=>{
 const pathname=(req.url||'').split('?')[0]; const read=['GET','HEAD'].includes(req.method);
 const fail=(status,error)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error}));};
 if(pathname.includes('..')||pathname.includes('%')||!(read&&(pages.has(pathname)||pathname.startsWith('/_next/static/')||readApi.test(pathname))||req.method==='POST'&&writeApi.test(pathname)))return fail(404,'This route is unavailable in the public demo.');
 if(read&&pathname==='/'){res.writeHead(302,{Location:'/prevent'});res.end();return;}
 const publicHost=req.headers.host||'';
 if(!/^(?:[a-z0-9-]+\.trycloudflare\.com|ginger\.scuff\.(?:cat|now)|127\.0\.0\.1(?::\d+)?)$/.test(publicHost))return fail(400,'Invalid host.');
 if(!read){
  if(req.headers.origin!==`https://${publicHost}`||req.headers['sec-fetch-site']==='cross-site')return fail(403,'Use the demo page to make this request.');
  const now=Date.now(),ip=req.headers['cf-connecting-ip']||req.socket.remoteAddress;
  for(const [key,v]of counts)if(now-v.start>60000)counts.delete(key);
  const item=counts.get(ip)||{start:now,n:0};if(++item.n>180)return fail(429,'Please retry shortly.');counts.set(ip,item);
 }
 const chunks=[];let size=0;for await(const part of req){size+=part.length;if(size>65536)return fail(413,'Request too large.');chunks.push(part);}
 const port=Number(process.env.UPSTREAM_PORT||3059),hostname=process.env.UPSTREAM_HOST||'127.0.0.1',host=`${hostname}:${port}`;
 const headers={host,'x-forwarded-proto':'http'};
 for(const name of ['accept','accept-encoding','content-type','cookie','authorization','accept-language','if-none-match','rsc','next-router-state-tree','next-router-prefetch','next-router-segment-prefetch','next-url'])if(req.headers[name])headers[name]=req.headers[name];
 if(!read)headers.origin=`http://${host}`;
 const upstream=http.request({hostname,port,path:req.url,method:req.method,headers,timeout:120000},r=>{
  const out={...r.headers,'x-robots-tag':'noindex, nofollow','x-content-type-options':'nosniff'};delete out['transfer-encoding'];
  if(out['set-cookie'])out['set-cookie']=out['set-cookie'].map(c=>c.includes('; Secure')?c:c+'; Secure');
  const compress=read&&req.method!=='HEAD'&&!out['content-encoding']&&/gzip/.test(req.headers['accept-encoding']||'')&&/application\/json|text\/|javascript/.test(out['content-type']||'');
  if(compress){delete out['content-length'];out['content-encoding']='gzip';out.vary=out.vary?out.vary+', Accept-Encoding':'Accept-Encoding';}
  res.writeHead(r.statusCode,out);if(compress)r.pipe(createGzip({level:1})).pipe(res);else r.pipe(res);
 });
 upstream.on('error',()=>{if(!res.headersSent)fail(502,'The demo is reconnecting. Please reload shortly.');else res.end();});
 upstream.on('timeout',()=>upstream.destroy());res.on('close',()=>upstream.destroy());upstream.end(Buffer.concat(chunks));
}).listen(Number(process.env.PORT||3060),'127.0.0.1');
