import {createHash, randomBytes, randomUUID} from 'node:crypto';
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
export type EvidenceSummarizer = (input: {kind: 'status' | 'update'; evidence: string}) => Promise<string | null>;
const subscriptionSchema = z.object({threadId: z.string().min(1).max(1000),
  areas: z.record(z.string(), z.number()), receipts: z.array(z.string()).max(256),
  repeat: z.record(z.string(), z.boolean()).default({}),
  incidents: z.record(z.string(), z.object({ack: z.boolean(), sent: z.number().int().min(0).max(4), lastSent: z.number()})).default({})});
const dispatchSchema = z.object({id: z.string(), createdAt: z.string(), areaIds: z.array(z.string()), text: z.string(),
  outcomes: z.record(z.string(), z.enum(['accepted', 'unknown']))});
const pairingSchema = z.object({session: z.string(), areaId: z.string(), repeat: z.boolean(), code: z.string(), expiresAt: z.number(), createdAt: z.number(), thread: z.string().optional()});
const stateSchema = z.object({version: z.literal(1), subscriptions: z.record(z.string(), subscriptionSchema),
  dispatches: z.array(dispatchSchema).max(1000).default([]), pairings: z.array(pairingSchema).max(1000).default([])});
export const connectMessageSchema = z.object({id: z.string().uuid(), areaIds: z.array(z.string().regex(/^[a-zA-Z0-9-]{1,64}$/)).min(1).max(20), text: z.string().trim().min(1).max(1200)});
export const connectText = (text: string) => `AshConnect · Ginger\n${text.trim()}\n\nOperator update. Reply STOP to unsubscribe. This is not an evacuation order or an all-clear.`;
type State = z.infer<typeof stateSchema>;
const key = (thread: string) => createHash('sha256').update(thread).digest('hex');
const plain = (text: string) => text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
export const fresh = (snapshot: Snapshot, now = Date.now()) => snapshot.lastScan !== null &&
  Date.parse(snapshot.lastScan) <= now && now - Date.parse(snapshot.lastScan) <= 20 * 60_000;
export const help = 'Tell me a place or address you want to watch. I can check the available wildfire evidence and keep you updated when it changes. Repeated reminders are off unless you ask for them. You can ask what you are watching, stop watching a place, or say stop to end all updates. Detections are unconfirmed; Ginger does not issue evacuation orders or all-clears.';
const zoneFresh = (zone: Snapshot['zones'][number], now: number) => Date.parse(zone.updatedAt) <= now && now - Date.parse(zone.updatedAt) <= 20 * 60_000;
const urgency = (state: Snapshot['zones'][number]['state']) => ({monitoring: 'MONITORING', review: 'REVIEW', escalating: 'HIGH · ESCALATING CONDITIONS', unavailable: 'EVIDENCE UNAVAILABLE'})[state];

export function status(snapshot: Snapshot | null, area?: string, now = Date.now()): string {
  if (!snapshot || !fresh(snapshot, now)) return 'Ginger’s monitoring data is unavailable or stale. I cannot establish current conditions. Updates resume when fresh scans return; this is not an all-clear.';
  const zones = area ? snapshot.zones.filter(z => matches(z, area)) : snapshot.zones;
  if (!zones.length) return 'Area not found. Tell me the place name or address so I can help you find it.';
  return zones.slice(0, 6).map(z => !zoneFresh(z, now) ? `${plain(z.name)}: evidence unavailable or stale. I cannot establish current conditions. Last area scan: ${z.updatedAt}.` : `${plain(z.name)}: ${z.state}. ${z.hotspots === null ? 'Thermal evidence unavailable.' : `${z.hotspots} thermal detections (unconfirmed).`} ${z.windKmh === null ? 'Wind unavailable.' : `Wind ${z.windKmh} km/h.`} ${plain(z.reasons.join(' ')).slice(0, 650)} Scan: ${z.updatedAt}.`).join('\n\n') + '\nNo evacuation advice or all-clear is implied.';
}
function matches(zone: {id: string; name: string}, value: string) {
  const normalize = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
  return normalize(zone.id) === normalize(value) || normalize(zone.name) === normalize(value);
}

/** Atomic storage and serialization within ONE messaging worker. Fail closed on corrupt state. */
export function createUpdates(file: string, readSnapshot: () => Promise<Snapshot | null>, now = Date.now,
  readRegisteredAreas?: () => Promise<Array<{id: string; name: string}>>, summarize?: EvidenceSummarizer) {
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>) => {
    const work = queue.catch(() => {}).then(fn); queue = work; return work;
  };
  async function read(): Promise<State> {
    try { return stateSchema.parse(JSON.parse(await readFile(file, 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {version: 1, subscriptions: {}, dispatches: [], pairings: []}; throw error; }
  }
  async function save(state: State) {
    await mkdir(dirname(file), {recursive: true, mode: 0o700});
    const temp = `${file}.${randomUUID()}.tmp`;
    try {await writeFile(temp, JSON.stringify(state), {mode: 0o600, flag: 'wx'}); await rename(temp, file);}
    finally {await unlink(temp).catch(() => {});}
  }
  async function brief(snapshot: Snapshot | null, areas: Array<{id: string; name: string}>, kind: 'status' | 'update', useAI = true) {
    if (!areas.length) return 'No saved places yet. Tell me a place or address you want to watch, or connect one in AshConnect.';
    const selected = areas.slice(0, 3);
    const observations = selected.map(area => {
      const zone = snapshot?.zones.find(z => z.id === area.id);
      if (!zone) return {area, facts: 'Waiting for the first monitoring scan.', evidence: {available: false, reason: 'first scan pending'}};
      if (!snapshot || !fresh(snapshot, now()) || !zoneFresh(zone, now())) return {area, facts: 'Evidence unavailable or stale; current conditions are unknown.', evidence: {available: false, reason: 'unavailable or stale'}};
      const checked = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit'}).format(new Date(zone.updatedAt));
      return {area, facts: `${urgency(zone.state)} · ${zone.hotspots === null ? 'thermal evidence unavailable' : `${zone.hotspots} unconfirmed thermal detections`} · ${zone.windKmh === null ? 'wind unavailable' : `wind ${zone.windKmh} km/h`}. Checked ${checked} Madrid.`,
        evidence: {available: zone.state !== 'unavailable', state: zone.state, thermalDetectionsUnconfirmed: zone.hotspots, windKmh: zone.windKmh}};
    });
    // Only anonymous measurements go to the summarizer, never resident addresses or channel identities.
    const evidence = JSON.stringify(observations.map((o, index) => ({place: index + 1, ...o.evidence})));
    let summary: string | null = null;
    if (useAI && summarize && observations.some(o => o.evidence.available)) {
      try {summary = await summarize({kind, evidence});} catch { /* Deterministic observations remain available. */ }
    }
    return (summary ? `${summary}\n\n` : '') + observations.map(o => `${plain(o.area.name)}\n${o.facts}`).join('\n\n')
      + (areas.length > selected.length ? `\n${areas.length - selected.length} more saved places. Ask me about a specific place for its latest evidence.` : '')
      + '\n\nThis is not an evacuation order or all-clear.';
  }
  async function residentBrief(threadId: string, area?: string, useAI = false) {
    const state = await serial(read), snapshot = await readSnapshot();
    const registered = readRegisteredAreas ? await readRegisteredAreas() : snapshot?.zones ?? [];
    const subscribed = state.subscriptions[key(threadId)];
    const areas = area ? registered.filter(value => matches(value, area))
      : registered.filter(value => subscribed?.areas[value.id] !== undefined);
    if (area && !areas.length) return 'Area not found. Tell me the place name or address so I can help you find it.';
    return brief(snapshot, areas, 'status', useAI);
  }
  async function command(threadId: string, messageId: string, text: string, strictAreaId = false): Promise<string | null> {
      const query = /^status(?:\s+(.{1,80}))?$/i.exec(text.trim());
      if (query) {
        // Release the subscription lock before optional model inference; STOP and pairing remain responsive.
        return residentBrief(threadId, query[1], true);
      }
      return serial(async () => {
      const input = text.trim();
      if (/^(help|start)$/i.test(input)) return help;
      if (/^areas$/i.test(input)) {
        const snapshot = await readSnapshot();
        const areas = readRegisteredAreas ? await readRegisteredAreas() : snapshot?.zones;
        return areas?.length ? 'Available places:\n' + areas.map((z, index) => `${index + 1}. ${plain(z.name)}`).join('\n') + '\nTell me which place you want to watch.' : 'No prepared watch areas yet. Start Ginger’s backend and try again.';
      }
      const stop = /^(stop|unsubscribe|cancel)$/i.test(input);
      const unwatch = /^unwatch\s+([a-zA-Z0-9-]{1,64})$/i.exec(input);
      const connect = /^connect\s+([a-f0-9]{32})$/i.exec(input);
      const watch = /^watch\s+(.{1,80}?)(\s+repeat)?$/i.exec(input);
      const ack = /^(ack|acknowledge)$/i.test(input);
      if (!stop && !watch && !ack && !connect && !unwatch) return null;
      if (!threadId || threadId.length > 1000 || !messageId || messageId.length > 1000) throw new Error('Invalid channel identity');
      const state = await read(), id = key(threadId);
      const sub = state.subscriptions[id] ?? {threadId, areas: {}, receipts: [], repeat: {}, incidents: {}};
      const receipt = key(messageId);
      if (sub.receipts.includes(receipt)) return ''; // Duplicate delivery must not re-enable a stopped watch.
      if (!state.subscriptions[id] && Object.keys(state.subscriptions).length >= 100) return 'Ginger’s messaging demo is at capacity. Please contact the operator.';
      let reply: string;
      if (stop) {sub.areas = {}; sub.repeat = {}; sub.incidents = {}; reply = 'Stopped. You will receive no further proactive updates. Tell me a place whenever you want to start again.';}
      else if (unwatch) {
        const areaId = unwatch[1];
        if (sub.areas[areaId] === undefined) reply = 'You are not watching that place. Your other updates have not changed.';
        else {
          delete sub.areas[areaId]; delete sub.repeat[areaId]; delete sub.incidents[areaId];
          reply = 'Stopped watching that place. ' + (Object.keys(sub.areas).length ? 'Your other saved places still receive updates.' : 'You will receive no further proactive updates.');
        }
      }
      else if (ack) {
        const snapshot = await readSnapshot();
        for (const incident of Object.values(sub.incidents)) incident.ack = true;
        // Acknowledge even when a fresh escalation has not reached the delivery loop yet.
        if (snapshot && fresh(snapshot, now())) for (const zone of snapshot.zones) {
          if (sub.repeat[zone.id] && sub.areas[zone.id] !== undefined && zone.state === 'escalating' && zoneFresh(zone, now()))
            sub.incidents[zone.id] ??= {ack: true, sent: 0, lastSent: 0};
        }
        reply = 'Acknowledged. Reminders for current escalating conditions are stopped. New evidence updates and future escalation episodes still notify you. Say stop to end all updates.';
      }
      else {
        const pairing = connect ? state.pairings.find(p => p.code === connect[1].toLowerCase()) : undefined;
        if (connect && (!pairing || pairing.thread || pairing.expiresAt <= now())) return 'This connection code has expired or was already used. Return to AshConnect and request a new code.';
        const snapshot = await readSnapshot();
        const areas = readRegisteredAreas ? await readRegisteredAreas() : snapshot?.zones;
        const value = pairing?.areaId ?? watch![1];
        const exact = areas?.find(z => z.id === value);
        const found = exact ? [exact] : strictAreaId ? [] : areas?.filter(z => matches(z, value));
        if (found && found.length > 1) return 'More than one location has that name. Tell me its town or address so I can identify the right place.';
        const zone = found?.[0];
        if (!zone) return 'Area not found. Tell me the place name or address so I can help you find it.';
        if (sub.areas[zone.id] === undefined && Object.keys(sub.areas).length >= 20) return 'You are already watching 20 places. Stop watching one before adding another.';
        // Repeated WATCH keeps the existing cursor; historical changes are never replayed on opt-in.
        sub.areas[zone.id] ??= now();
        sub.repeat[zone.id] = pairing ? pairing.repeat : !!watch![2];
        if (pairing) pairing.thread = id;
        if (!sub.repeat[zone.id]) delete sub.incidents[zone.id];
        reply = `Watching ${plain(zone.name)}. I’ll text when the evidence changes. ${sub.repeat[zone.id] ? 'Enhanced notifications enabled: up to three escalating-alert reminders, five minutes apart. Tell me to stop reminders when you have seen them.' : 'Repeated reminders are off.'} Say stop anytime to end updates.\n\n${snapshot?.zones.some(z => z.id === zone.id) ? await brief(snapshot, [zone], 'status', false) : 'Waiting for the first monitoring scan. This is not an all-clear.'}`;
      }
      sub.receipts = [...sub.receipts, receipt].slice(-256);
      state.subscriptions[id] = sub; await save(state); return reply;
      });
  }
  function areaIdRequired(areaId: string) {
    if (typeof areaId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(areaId)) throw new Error('Invalid watch area ID');
  }
  async function manage(threadId: string, messageId: string, input: string, strictAreaId = false): Promise<string> {
    return await command(threadId, messageId, input, strictAreaId) || 'That request has already been handled. Nothing changed.';
  }
  return {
    subscribe: async (threadId: string, messageId: string, areaId: string, options: {repeat?: boolean} = {}): Promise<string> => {
      areaIdRequired(areaId);
      if (options.repeat !== undefined && typeof options.repeat !== 'boolean') throw new Error('Invalid reminder preference');
      return manage(threadId, messageId, `WATCH ${areaId}${options.repeat === true ? ' REPEAT' : ''}`, true);
    },
    unsubscribe: async (threadId: string, messageId: string, areaId?: string): Promise<string> => {
      if (areaId !== undefined) areaIdRequired(areaId);
      return manage(threadId, messageId, areaId === undefined ? 'STOP' : `UNWATCH ${areaId}`);
    },
    acknowledge: (threadId: string, messageId: string): Promise<string> => manage(threadId, messageId, 'ACK'),
    listWatched: (threadId: string) => serial(async (): Promise<Array<{id: string; name: string; repeat: boolean}>> => {
      if (!threadId || threadId.length > 1000) throw new Error('Invalid channel identity');
      const state = await read(), sub = state.subscriptions[key(threadId)];
      if (!sub) return [];
      const registered = readRegisteredAreas ? await readRegisteredAreas() : (await readSnapshot())?.zones ?? [];
      return registered.filter(area => sub.areas[area.id] !== undefined).map(area => ({id: area.id, name: area.name, repeat: !!sub.repeat[area.id]}));
    }),
    evidence: (threadId: string, area?: string) => residentBrief(threadId, area),
    createPairing: (session: string, areaId: string, repeat: boolean) => serial(async () => {
      if (!/^[a-f0-9]{64}$/.test(session) || !/^[a-zA-Z0-9-]{1,64}$/.test(areaId)) throw new Error('Invalid pairing request.');
      const state = await read(), sessionKey = key(session);
      // Preserve ownership after a code expires; issuing a replacement is an explicit action.
      state.pairings = state.pairings.filter(p => now() - p.createdAt < 90 * 86400_000);
      const previous = state.pairings.find(p => p.session === sessionKey && p.areaId === areaId);
      if (!previous && state.pairings.length >= 1000) throw new Error('Pairing capacity reached.');
      const pairing = {session: sessionKey, areaId, repeat, code: randomBytes(16).toString('hex'), expiresAt: now() + 15 * 60_000, createdAt: now()};
      state.pairings = state.pairings.filter(p => p !== previous);
      state.pairings.push(pairing); await save(state);
      return {areaId, code: pairing.code, expiresAt: pairing.expiresAt, subscribed: false, enhanced: false};
    }),
    residentStatus: (session: string) => serial(async () => {
      if (!/^[a-f0-9]{64}$/.test(session)) return {registrations: []};
      const state = await read();
      return {registrations: state.pairings.filter(p => p.session === key(session) && now() - p.createdAt < 90 * 86400_000).map(p => {
        const sub = p.thread ? state.subscriptions[p.thread] : undefined;
        const subscribed = !!sub && sub.areas[p.areaId] !== undefined;
        return {areaId: p.areaId, subscribed, enhanced: subscribed && !!sub?.repeat[p.areaId],
          expiresAt: p.expiresAt, ...(!p.thread && p.expiresAt > now() ? {code: p.code} : {})};
      })};
    }),
    connectStatus: () => serial(async () => {
      const state = await read();
      const counts: Record<string, number> = {}, enhancedCounts: Record<string, number> = {};
      for (const sub of Object.values(state.subscriptions)) for (const id of Object.keys(sub.areas)) {
        counts[id] = (counts[id] || 0) + 1;
        if (sub.repeat[id]) enhancedCounts[id] = (enhancedCounts[id] || 0) + 1;
      }
      return {counts, enhancedCounts, history: state.dispatches.slice(-20).reverse().map(({outcomes, ...dispatch}) => ({...dispatch,
        accepted: Object.values(outcomes).filter(s => s === 'accepted').length,
        unknown: Object.values(outcomes).filter(s => s === 'unknown').length}))};
    }),
    // Shares the command lock: STOP and operator sends cannot race subscription reads.
    connectSend: (value: unknown, send: (threadId: string, text: string) => Promise<void>) => serial(async () => {
      const input = connectMessageSchema.parse(value), state = await read();
      const areaIds = [...new Set(input.areaIds)].sort();
      const previous = state.dispatches.find(d => d.id === input.id);
      const result = (d: z.infer<typeof dispatchSchema>) => ({id: d.id,
        accepted: Object.values(d.outcomes).filter(s => s === 'accepted').length,
        unknown: Object.values(d.outcomes).filter(s => s === 'unknown').length});
      if (previous) {
        if (previous.text !== input.text || JSON.stringify(previous.areaIds) !== JSON.stringify(areaIds)) throw new Error('This send ID belongs to a different message.');
        return result(previous);
      }
      if (state.dispatches.length >= 1000) throw new Error('Dispatch archive is full. Ask the operator to archive it before sending.');
      if (state.dispatches.some(d => now() - Date.parse(d.createdAt) < 60_000)) throw new Error('Wait one minute between operator messages.');
      const recipients = Object.entries(state.subscriptions).filter(([, sub]) => areaIds.some(id => sub.areas[id] !== undefined));
      if (!recipients.length) throw new Error('No opted-in conversations for the selected homes.');
      const dispatch: z.infer<typeof dispatchSchema> = {id: input.id, areaIds, text: input.text, createdAt: new Date(now()).toISOString(), outcomes: {}};
      // Persist all attempts before contacting the provider. A crash or ambiguous error
      // remains unknown and is never automatically resent, including after restart.
      for (const [id] of recipients) dispatch.outcomes[id] = 'unknown';
      state.dispatches.push(dispatch); await save(state);
      for (const [id, sub] of recipients) {
        try {await send(sub.threadId, connectText(input.text)); dispatch.outcomes[id] = 'accepted';}
        catch { /* Provider may have accepted the request; never guess delivery. */ }
        await save(state);
      }
      return result(dispatch);
    }),
    command,
    tick: (send: (threadId: string, text: string) => Promise<void>) => serial(async () => {
      const snapshot = await readSnapshot();
      if (!snapshot || !fresh(snapshot, now())) return {sent: 0, failed: 0, stale: true};
      const registered = readRegisteredAreas ? new Set((await readRegisteredAreas()).map(area => area.id)) : null;
      const state = await read(); let sent = 0, failed = 0;
      for (const sub of Object.values(state.subscriptions)) {
        const reminders: Snapshot['zones'][number][] = [];
        for (const area of Object.keys(sub.areas)) {
          const zone = snapshot.zones.find(z => z.id === area);
          if ((registered && !registered.has(area)) || (!registered && !zone)) {delete sub.areas[area]; delete sub.repeat[area]; delete sub.incidents[area]; continue;}
          if (!zone) continue; // Newly registered places can subscribe before their first scan.
          if (!zoneFresh(zone, now())) continue;
          if (zone.state !== 'escalating') {
            // Coverage loss must not reset a remembered acknowledgement or the reminder cap.
            if (zone.hotspots !== null && zone.windKmh !== null && zone.state !== 'unavailable') delete sub.incidents[area];
            continue;
          }
          if (!sub.repeat[area]) continue;
          const incident = sub.incidents[area] ??= {ack: false, sent: 0, lastSent: 0};
          if (!incident.ack && incident.sent < 4 && (incident.sent === 0 || now() - incident.lastSent >= 5 * 60_000)) reminders.push(zone);
        }
        const changes = snapshot.deltas.filter(c => sub.areas[c.zoneId] !== undefined && Date.parse(c.time) > sub.areas[c.zoneId] && Date.parse(c.time) <= now() && now() - Date.parse(c.time) <= 20 * 60_000);
        if (changes.length || reminders.length) {
          const changedIds = new Set([...reminders.map(z => z.id), ...changes.map(c => c.zoneId)]);
          const affected = snapshot.zones.filter(z => changedIds.has(z.id));
          const message = 'AshConnect update\n' + await brief(snapshot, affected, 'update', false)
            + (reminders.length ? '\n' + reminders.map(zone => `${plain(zone.name)}${sub.incidents[zone.id].sent ? ` · reminder ${sub.incidents[zone.id].sent}/3` : ' · escalating conditions'}`).join('\n') + '\nTell me to stop reminders when you have seen them.' : '')
            + '\nReply STOP to unsubscribe.';
          try {await send(sub.threadId, message); sent++;}
          catch {failed++; continue;} // Keep cursor on failure; retry next cycle (at-least-once delivery).
          for (const zone of reminders) {sub.incidents[zone.id].sent++; sub.incidents[zone.id].lastSent = now();}
        }
        for (const area of Object.keys(sub.areas)) sub.areas[area] = Math.max(sub.areas[area], Date.parse(snapshot.lastScan!));
        await save(state); // Acknowledge each recipient only after successful delivery.
      }
      return {sent, failed, stale: false};
    }),
  };
}
