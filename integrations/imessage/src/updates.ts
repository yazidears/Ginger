import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {z} from 'zod';

const time = z.string().datetime({offset: true});
const zoneSchema = z.object({
  id: z.string().max(64), name: z.string().max(80),
  state: z.enum(['monitoring', 'review', 'escalating', 'unavailable']),
  hotspots: z.number().nullable(), windKmh: z.number().nullable(),
  reasons: z.array(z.string().max(3000)).max(30), updatedAt: time,
});
const changeSchema = z.object({id: z.string().max(300), zoneId: z.string().max(64), time,
  area: z.string().max(80), title: z.string().max(300), text: z.string().max(3000)});
export const snapshotSchema = z.object({lastScan: time.nullable(), zones: z.array(zoneSchema).max(20), deltas: z.array(changeSchema).max(50)});
export type Snapshot = z.infer<typeof snapshotSchema>;
const subscriptionSchema = z.object({threadId: z.string().min(1).max(1000),
  areas: z.record(z.string(), z.number()), receipts: z.array(z.string()).max(256)});
const stateSchema = z.object({version: z.literal(1), subscriptions: z.record(z.string(), subscriptionSchema)});
type State = z.infer<typeof stateSchema>;
const key = (thread: string) => createHash('sha256').update(thread).digest('hex');
const plain = (text: string) => text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
export const fresh = (snapshot: Snapshot, now = Date.now()) => snapshot.lastScan !== null &&
  Date.parse(snapshot.lastScan) <= now && now - Date.parse(snapshot.lastScan) <= 20 * 60_000;
export const help = 'Ginger wildfire watch. Text AREAS to list locations, WATCH <area> to receive change updates, STATUS <area> for evidence, or STOP to unsubscribe from all updates. Detections are unconfirmed; Ginger does not issue evacuation orders or all-clears.';

export function status(snapshot: Snapshot | null, area?: string, now = Date.now()): string {
  if (!snapshot || !fresh(snapshot, now)) return 'Ginger’s monitoring data is unavailable or stale. I cannot establish current conditions. Updates resume when fresh scans return; this is not an all-clear.';
  const zones = area ? snapshot.zones.filter(z => matches(z, area)) : snapshot.zones;
  if (!zones.length) return 'Area not found. Text AREAS for available locations.';
  return zones.slice(0, 6).map(z => `${plain(z.name)}: ${z.state}. ${z.hotspots === null ? 'Thermal evidence unavailable.' : `${z.hotspots} thermal detections (unconfirmed).`} ${z.windKmh === null ? 'Wind unavailable.' : `Wind ${z.windKmh} km/h.`} ${plain(z.reasons.join(' ')).slice(0, 650)} Scan: ${z.updatedAt}.`).join('\n\n') + '\nNo evacuation advice or all-clear is implied.';
}
function matches(zone: {id: string; name: string}, value: string) {
  const normalize = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
  return normalize(zone.id) === normalize(value) || normalize(zone.name) === normalize(value);
}

/** Atomic storage and serialization within ONE messaging worker. Fail closed on corrupt state. */
export function createUpdates(file: string, readSnapshot: () => Promise<Snapshot | null>, now = Date.now) {
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>) => {
    const work = queue.catch(() => {}).then(fn); queue = work; return work;
  };
  async function read(): Promise<State> {
    try { return stateSchema.parse(JSON.parse(await readFile(file, 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {version: 1, subscriptions: {}}; throw error; }
  }
  async function save(state: State) {
    await mkdir(dirname(file), {recursive: true, mode: 0o700});
    const temp = `${file}.${randomUUID()}.tmp`;
    try {await writeFile(temp, JSON.stringify(state), {mode: 0o600, flag: 'wx'}); await rename(temp, file);}
    finally {await unlink(temp).catch(() => {});}
  }
  return {
    command: (threadId: string, messageId: string, text: string) => serial(async (): Promise<string | null> => {
      const input = text.trim();
      if (/^(help|start)$/i.test(input)) return help;
      if (/^areas$/i.test(input)) {
        const snapshot = await readSnapshot();
        return snapshot?.zones.length ? 'Watch areas:\n' + snapshot.zones.map(z => `${plain(z.name)} (${z.id})`).join('\n') + '\nText WATCH <area> to subscribe.' : 'No prepared watch areas yet. Start Ginger’s backend and try again.';
      }
      const stop = /^(stop|unsubscribe|cancel)$/i.test(input);
      const watch = /^watch\s+(.{1,80})$/i.exec(input);
      const query = /^status(?:\s+(.{1,80}))?$/i.exec(input);
      if (query) return status(await readSnapshot(), query[1], now());
      if (!stop && !watch) return null;
      if (!threadId || threadId.length > 1000 || !messageId || messageId.length > 1000) throw new Error('Invalid channel identity');
      const state = await read(), id = key(threadId);
      const sub = state.subscriptions[id] ?? {threadId, areas: {}, receipts: []};
      const receipt = key(messageId);
      if (sub.receipts.includes(receipt)) return ''; // Duplicate delivery must not re-enable a stopped watch.
      if (!state.subscriptions[id] && Object.keys(state.subscriptions).length >= 100) return 'Ginger’s messaging demo is at capacity. Please contact the operator.';
      let reply: string;
      if (stop) {sub.areas = {}; reply = 'Stopped. You will receive no further proactive updates. Text WATCH <area> to subscribe again.';}
      else {
        const snapshot = await readSnapshot();
        const zone = snapshot?.zones.find(z => matches(z, watch![1]));
        if (!zone) return 'Area not found. Text AREAS for available locations.';
        // Repeated WATCH keeps the existing cursor; historical changes are never replayed on opt-in.
        sub.areas[zone.id] ??= now();
        reply = `Watching ${plain(zone.name)}. I’ll text when Ginger records changes, including evidence coverage changes. Text STOP anytime.\n\n${status(snapshot, zone.id, now())}`;
      }
      sub.receipts = [...sub.receipts, receipt].slice(-256);
      state.subscriptions[id] = sub; await save(state); return reply;
    }),
    tick: (send: (threadId: string, text: string) => Promise<void>) => serial(async () => {
      const snapshot = await readSnapshot();
      if (!snapshot || !fresh(snapshot, now())) return {sent: 0, failed: 0, stale: true};
      const state = await read(); let sent = 0, failed = 0;
      for (const sub of Object.values(state.subscriptions)) {
        const changes = snapshot.deltas.filter(c => sub.areas[c.zoneId] !== undefined && Date.parse(c.time) > sub.areas[c.zoneId] && Date.parse(c.time) <= now() && now() - Date.parse(c.time) <= 20 * 60_000);
        if (changes.length) {
          const message = 'Ginger watch update\n' + changes.slice(0, 8).map(c => `${plain(c.area)} — ${plain(c.title)}: ${plain(c.text).slice(0, 500)}`).join('\n') + (changes.length > 8 ? `\n${changes.length - 8} more changes; text STATUS for current evidence.` : '') + `\nScan: ${snapshot.lastScan}. Detections are unconfirmed; this is not an evacuation order or all-clear. Reply STOP to unsubscribe.`;
          try {await send(sub.threadId, message); sent++;}
          catch {failed++; continue;} // Keep cursor on failure; retry next cycle (at-least-once delivery).
        }
        for (const area of Object.keys(sub.areas)) sub.areas[area] = Math.max(sub.areas[area], Date.parse(snapshot.lastScan!));
        await save(state); // Acknowledge each recipient only after successful delivery.
      }
      return {sent, failed, stale: false};
    }),
  };
}
