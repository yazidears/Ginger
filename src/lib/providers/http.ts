const memory=new Map<string,{expires:number;value:unknown}>();
const pending=new Map<string,Promise<unknown>>();
const MAX_CACHE_ENTRIES=256,MAX_PENDING=128;
let generation=0;
/** Process-local bounded LRU. Failures never populate cache and expired entries are removed. */
export async function cached<T>(key:string,ttlMs:number,load:()=>Promise<T>):Promise<T>{
 if(!Number.isFinite(ttlMs)||ttlMs<0)throw Error('Invalid provider cache lifetime');
 const now=Date.now();for(const [k,v] of memory)if(v.expires<=now)memory.delete(k);
 const item=memory.get(key);if(item){memory.delete(key);memory.set(key,item);return item.value as T;}
 const existing=pending.get(key);if(existing)return existing as Promise<T>;
 if(pending.size>=MAX_PENDING)throw Error('Provider concurrency limit reached');
 const startedGeneration=generation;
 const work=Promise.resolve().then(load).then(value=>{
  if(ttlMs>0&&generation===startedGeneration){memory.delete(key);memory.set(key,{expires:Date.now()+ttlMs,value});while(memory.size>MAX_CACHE_ENTRIES)memory.delete(memory.keys().next().value!);}
  return value;
 }).finally(()=>{if(pending.get(key)===work)pending.delete(key);});
 pending.set(key,work);return work;
}
class UpstreamHTTPError extends Error{constructor(public status:number){super(`Upstream HTTP ${status}`);this.name='UpstreamHTTPError';}}
const retryableStatus=(status:number)=>status===408||status===429||status===500||status===502||status===503||status===504;
function retryDelay(value:string|null):number{if(!value)return 150;const seconds=Number(value);return Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(value)-Date.now())||150;}
function pause(ms:number,signal:AbortSignal):Promise<void>{return new Promise((resolve,reject)=>{if(signal.aborted){reject(signal.reason);return;}const done=()=>{signal.removeEventListener('abort',abort);resolve();};const timer=setTimeout(done,ms);const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason);};signal.addEventListener('abort',abort,{once:true});});}
/** Abort must settle our promise even when a transport or body reader ignores its signal. */
function abortable<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise<T>((resolve,reject)=>{
  const cleanup=()=>signal.removeEventListener('abort',abort);
  const abort=()=>{cleanup();reject(signal.reason);};
  signal.addEventListener('abort',abort,{once:true});
  // Both handlers remain attached after abort, consuming any late transport rejection.
  work.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
  if(signal.aborted)abort();
 });
}
/** One total deadline, at most two attempts. Mutating methods are never blindly replayed. */
export async function fetchJSON<T>(url:string,init:RequestInit={},timeoutMs=6000):Promise<T>{
 if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw Error('Invalid upstream timeout');
 const timeout=AbortSignal.timeout(timeoutMs);
 const signal=init.signal?AbortSignal.any([init.signal,timeout]):timeout;
 const retryableMethod=['GET','HEAD'].includes((init.method||'GET').toUpperCase());
 for(let attempt=0;attempt<2;attempt++){
  signal.throwIfAborted();let response:Response;
  try{response=await abortable(fetch(url,{...init,signal,cache:'no-store'}),signal);}catch(e){
   if(signal.aborted)throw signal.reason;
   if(!retryableMethod||attempt===1)throw Error('Upstream network request failed');
   await pause(150,signal);continue;
  }
  if(!response.ok){const error=new UpstreamHTTPError(response.status);const delay=retryDelay(response.headers.get('retry-after'));
   // Body cleanup can stall after an aborted response. Never let it block the HTTP failure or retry.
   try{void response.body?.cancel().catch(()=>{});}catch{/* Cleanup must not replace the upstream HTTP status. */}
   if(!retryableMethod||attempt===1||!retryableStatus(response.status)||delay>1000)throw error;
   await pause(delay,signal);continue;
  }
  // Malformed JSON is a schema failure, not a transient transport failure.
  try{return await abortable(response.json() as Promise<T>,signal);}catch{signal.throwIfAborted();throw Error('Upstream returned invalid JSON');}
 }
 throw Error('Upstream request failed');
}
export function validSecret(v:string|undefined,name:string){if(!v||!v.trim())throw Error(`${name} not configured`);if(/[\r\n]/.test(v))throw Error(`${name} invalid`);return v.trim();}
export function isoNow(){return new Date().toISOString();}
/** Only return classified diagnostics, never an upstream body, URL or secret. */
export function providerFailure(error:unknown):string{
 if(error instanceof Error){if(error.name==='TimeoutError'||error.name==='AbortError')return 'Request timed out';if(/network request failed/.test(error.message))return 'Network connection failed';const status=/^Upstream HTTP (\d{3})$/.exec(error.message);if(status)return `Provider returned HTTP ${status[1]}`;}
 return 'Request failed or data was incomplete';
}
export function unavailable<T>(data:T,detail:string){return {data,status:'unavailable' as const,detail,updatedAt:isoNow()};}
export function clearProviderCacheForTests(){generation++;memory.clear();pending.clear();}
