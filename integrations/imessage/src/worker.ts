import {createServer} from 'node:http';
import {unlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {mkdir, open, readFile, unlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config} from 'dotenv';
import {createiMessageAdapter} from '@photon-ai/chat-adapter-imessage';
import {createGingerAgent} from './agent';
import {snapshotSchema, fresh, type Snapshot} from './updates';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
config({path: join(root, '.env.local'), quiet: true});
config({path: join(root, 'integrations/imessage/.env'), quiet: true});
async function main() {
  if (process.env.IMESSAGE_ENABLED !== 'true') throw new Error('Set IMESSAGE_ENABLED=true only after configuring the Photon sender and webhook.');
  const required = ['IMESSAGE_PROJECT_ID', 'IMESSAGE_PROJECT_SECRET', 'IMESSAGE_WEBHOOK_SECRET', 'NEBIUS_API_KEY', 'NEBIUS_MODEL'];
  const missing = required.filter(name => !process.env[name]?.trim());
  if (missing.length) throw new Error(`Missing configuration: ${missing.join(', ')}`);
  const port = Number(process.env.IMESSAGE_PORT || '4112');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid IMESSAGE_PORT');
  const stateDir = join(root, '.ginger-data/imessage');
  await mkdir(stateDir, {recursive: true, mode: 0o700});
  const lockPath = join(stateDir, 'worker.lock');
  const lock = await open(lockPath, 'wx', 0o600).catch(() => {throw new Error('Messaging worker lock exists. Stop the other worker; remove a stale .ginger-data/imessage/worker.lock only after confirming it is no longer running.');});
  await lock.writeFile(String(process.pid));
  process.once('exit', () => {try {unlinkSync(lockPath);} catch { /* Already cleaned up. */ }});
  const snapshotRoot = process.env.GINGER_SNAPSHOT_DIR || join(homedir(), '.cache/ginger-backend', createHash('sha256').update(root).digest('hex').slice(0, 16));
  const snapshotFile = join(snapshotRoot, createHash('sha256').update('workspace-v1').digest('hex') + '.json');
  async function readSnapshot(): Promise<Snapshot | null> {
    try {const data = JSON.parse(await readFile(snapshotFile, 'utf8')); return snapshotSchema.parse(data.value.monitor);}
    catch {return null;}
  }
  const adapter = createiMessageAdapter({projectId: process.env.IMESSAGE_PROJECT_ID!, projectSecret: process.env.IMESSAGE_PROJECT_SECRET!, webhookSecret: process.env.IMESSAGE_WEBHOOK_SECRET!});
  const {agent, mastra, updates} = createGingerAgent({adapter,
    model: {providerId: 'nebius', modelId: process.env.NEBIUS_MODEL!, url: 'https://api.tokenfactory.nebius.com/v1', apiKey: process.env.NEBIUS_API_KEY!},
    databaseUrl: `file:${join(stateDir, 'mastra.db')}`, subscriptionsFile: join(stateDir, 'subscriptions.json'), readSnapshot});
  let closing = false;
  const server = createServer(async (req, res) => {
    try {
      const path = req.url?.split('?')[0];
      if (req.method === 'GET' && path === '/health') {
        const snapshot = await readSnapshot();
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({service: 'ginger-imessage', dataFresh: !!snapshot && fresh(snapshot)})); return;
      }
      if (req.method !== 'POST' || path !== '/api/agents/ginger-watch/channels/imessage/webhook') {res.writeHead(404); res.end(); return;}
      let size = 0; const chunks: Buffer[] = [];
      for await (const chunk of req) {size += chunk.length; if (size > 256_000) {res.writeHead(413); res.end(); return;} chunks.push(chunk);}
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(',') : value);
      const response = await agent.getChannels()!.handleWebhookEvent('imessage', new Request(`http://localhost:${port}${path}`, {method: 'POST', headers, body: Buffer.concat(chunks)}));
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch {res.writeHead(503); res.end('Messaging temporarily unavailable');}
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  let cycle: Promise<unknown> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function tick() {
    try {const result = await updates.tick(async (thread, text) => {await adapter.postMessage(thread, text);}); if (result.sent || result.failed) console.log(`iMessage updates: ${result.sent} accepted, ${result.failed} failed.`);}
    catch {console.warn('iMessage update cycle failed; check backend freshness and local state.');}
    if (!closing) timer = setTimeout(() => {cycle = tick();}, 60_000);
  }
  async function shutdown() {
    if (closing) return; closing = true; if (timer) clearTimeout(timer);
    server.close(); await cycle; await mastra.shutdown(); await lock.close(); await unlink(lockPath);
  }
  process.once('SIGINT', () => {void shutdown().finally(() => process.exit(0));});
  process.once('SIGTERM', () => {void shutdown().finally(() => process.exit(0));});
  try {
    await agent.getChannels()!.initialize(mastra);
    await new Promise<void>((resolve, reject) => {server.once('error', reject); server.listen(port, '127.0.0.1', resolve);});
    console.log(`Ginger iMessage listening on 127.0.0.1:${port}. Use a public HTTPS proxy/tunnel for Photon’s signed webhook. Run Ginger’s backend separately.`);
    cycle = tick();
  } catch (error) {await shutdown(); throw error;}
}
main().catch(error => {console.error(error instanceof Error ? error.message : 'Messaging worker failed'); process.exitCode = 1;});
