import {createServer} from 'node:http';
import {unlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {mkdir, readFile, unlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config} from 'dotenv';
import {createiMessageAdapter} from '@photon-ai/chat-adapter-imessage';
import {createGingerAgent} from './agent';
import {snapshotSchema, fresh, type Snapshot} from './updates';
import {createConnectApi} from './connect-api';
import {imessageModel} from './model';
import {VonageWhatsAppAdapter} from './vonage';
import {acquireWorkerLock} from './worker-lock';
import {TelegramAdapter} from './telegram';
import {createTransportRouter, publicChannelInfo, transportPlan} from './transports';
import {createResidentActions, createResidentLocationBridge} from './resident-actions';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
config({path: join(root, '.env.local'), quiet: true});
config({path: join(root, 'integrations/imessage/.env'), quiet: true});
async function main() {
  if (process.env.ASHCONNECT_ENABLED !== 'true' && process.env.IMESSAGE_ENABLED !== 'true') throw new Error('Set ASHCONNECT_ENABLED=true after configuring a messaging transport.');
  const {primary: transport, transports} = transportPlan(process.env);
  const channel = transport === 'vonage' ? 'whatsapp' : transport;
  const model = imessageModel();
  const port = Number(process.env.IMESSAGE_PORT || '4112');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid IMESSAGE_PORT');
  const stateDir = join(root, '.ginger-data/imessage');
  await mkdir(stateDir, {recursive: true, mode: 0o700});
  const lockPath = join(stateDir, 'worker.lock');
  const lock = await acquireWorkerLock(lockPath);
  let ownsLock = true;
  process.once('exit', () => {if (ownsLock) try {unlinkSync(lockPath);} catch { /* Already cleaned up. */ }});
  const snapshotRoot = process.env.GINGER_SNAPSHOT_DIR || join(homedir(), '.cache/ginger-backend', createHash('sha256').update(root).digest('hex').slice(0, 16));
  const snapshotFile = join(snapshotRoot, createHash('sha256').update('workspace-v1').digest('hex') + '.json');
  async function readSnapshot(): Promise<Snapshot | null> {
    try {const data = JSON.parse(await readFile(snapshotFile, 'utf8')); return snapshotSchema.parse(data.value.monitor);}
    catch {return null;}
  }
  const adapters = transports.map(transport => transport === 'vonage'
    ? new VonageWhatsAppAdapter({apiKey: process.env.VONAGE_API_KEY!, apiSecret: process.env.VONAGE_API_SECRET!, sender: process.env.VONAGE_WHATSAPP_SENDER!,
      webhookToken: process.env.VONAGE_WEBHOOK_TOKEN!, signatureSecret: process.env.VONAGE_SIGNATURE_SECRET, stateFile: join(stateDir, 'whatsapp-sessions.json')})
    : transport === 'telegram' ? new TelegramAdapter({token: process.env.TELEGRAM_BOT_TOKEN!, stateFile: join(stateDir, 'telegram.json'), onError: () => console.warn('Telegram polling failed; retrying.')})
    : createiMessageAdapter({projectId: process.env.IMESSAGE_PROJECT_ID!, projectSecret: process.env.IMESSAGE_PROJECT_SECRET!, webhookSecret: process.env.IMESSAGE_WEBHOOK_SECRET!}));
  const adapter = adapters[0];
  const router = createTransportRouter(adapters);
  async function readRegisteredAreas(): Promise<Array<{id: string; name: string}>> {
    const data = JSON.parse(await readFile(join(root, '.ginger-data/watch-areas.json'), 'utf8'));
    if (data.version !== 1 || !Array.isArray(data.areas) || data.areas.some((area: {id?: unknown; name?: unknown}) => typeof area.id !== 'string' || typeof area.name !== 'string')) throw new Error('Place registry unavailable');
    return data.areas;
  }
  const {agent, mastra, updates} = createGingerAgent({adapter, additionalAdapters: adapters.slice(1),
    model,
    residentActions: createResidentActions({file: join(stateDir, 'resident-locations.json'),
      ...createResidentLocationBridge({baseUrl: process.env.ASHCONNECT_WEB_ORIGIN || 'http://127.0.0.1:3000', token: process.env.ASHCONNECT_OPERATOR_TOKEN || ''})}),
    databaseUrl: `file:${join(stateDir, 'mastra.db')}`, subscriptionsFile: join(stateDir, 'subscriptions.json'), readSnapshot, readRegisteredAreas});
  let closing = false;
  const pending = new Set<Promise<unknown>>();
  function waitUntil(task: Promise<unknown>) {
    pending.add(task); void task.catch(() => {console.warn('Messaging request failed');}).finally(() => pending.delete(task));
  }
  const connect = createConnectApi({updates, send: router.send,
    channelInfo: () => publicChannelInfo(adapters, active => active instanceof TelegramAdapter ? active.publicUsername
      : active.name === 'imessage' ? process.env.GINGER_IMESSAGE_CONTACT : (process.env.VONAGE_WHATSAPP_SENDER || process.env.GINGER_WHATSAPP_CONTACT || '').replace(/^\+/, '')),
    registeredIds: async () => (await readRegisteredAreas()).map(area => area.id)});
  const server = createServer(async (req, res) => {
    try {
      const path = req.url?.split('?')[0];
      if (path === '/internal/ash-connect') {
        let size = 0; const chunks: Buffer[] = [];
        for await (const chunk of req) {size += chunk.length; if (size > 16_000) {res.writeHead(413); res.end(); return;} chunks.push(chunk);}
        const response = await connect(new Request(`http://127.0.0.1:${port}${path}`, {method: req.method,
          headers: {'x-ashconnect-token': String(req.headers['x-ashconnect-token'] || '')},
          ...(req.method === 'POST' ? {body: Buffer.concat(chunks)} : {})}));
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
      }
      if (req.method === 'GET' && path === '/health') {
        const snapshot = await readSnapshot();
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({service: 'ginger-imessage', transport, channel, channels: router.channels, configured: true, dataFresh: !!snapshot && fresh(snapshot)})); return;
      }
      const webhookChannel = router.webhookChannel(req.method, path);
      if (!webhookChannel) {res.writeHead(404); res.end(); return;}
      let size = 0; const chunks: Buffer[] = [];
      for await (const chunk of req) {size += chunk.length; if (size > 256_000) {res.writeHead(413); res.end(); return;} chunks.push(chunk);}
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(',') : value);
      const response = await agent.getChannels()!.handleWebhookEvent(webhookChannel, new Request(`http://localhost:${port}${req.url}`, {method: 'POST', headers, body: Buffer.concat(chunks)}), {waitUntil});
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch {res.writeHead(503); res.end('Messaging temporarily unavailable');}
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  let cycle: Promise<unknown> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function tick() {
    try {const result = await updates.tick(router.send); if (result.sent || result.failed) console.log(`Messaging updates: ${result.sent} accepted, ${result.failed} failed.`);}
    catch {console.warn('Messaging update cycle failed; check backend freshness and local state.');}
    if (!closing) timer = setTimeout(() => {cycle = tick();}, 60_000);
  }
  async function shutdown() {
    if (closing) return; closing = true; if (timer) clearTimeout(timer);
    server.close(); for (const active of adapters) if (active instanceof TelegramAdapter) await active.stopPolling();
    await cycle; await Promise.allSettled(pending); await mastra.shutdown(); await lock.close(); ownsLock = false; await unlink(lockPath);
  }
  process.once('SIGINT', () => {void shutdown().finally(() => process.exit(0));});
  process.once('SIGTERM', () => {void shutdown().finally(() => process.exit(0));});
  try {
    await agent.getChannels()!.initialize(mastra);
    for (const active of adapters) if (active instanceof TelegramAdapter) await active.startPolling();
    await new Promise<void>((resolve, reject) => {server.once('error', reject); server.listen(port, '127.0.0.1', resolve);});
    console.log(`AshConnect ${router.channels.join(', ')} listening on 127.0.0.1:${port}. ${router.channels.every(name => name === 'telegram') ? 'Telegram long polling enabled; no public webhook required.' : 'Expose only the authenticated webhook paths through HTTPS.'} Run Ginger’s backend separately.`);
    cycle = tick();
  } catch (error) {await shutdown(); throw error;}
}
main().catch(error => {console.error(error instanceof Error ? error.message : 'Messaging worker failed'); process.exitCode = 1;});
