import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {z} from 'zod';

const candidateSchema = z.object({label: z.string().trim().min(1).max(400), lat: z.number().finite().min(40.4).max(42.9), lon: z.number().finite().min(0.1).max(3.4),
  placeType: z.enum(['home', 'school', 'hospital']).optional()});
const areaSchema = z.object({id: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/), name: z.string().min(1).max(80), lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180), radiusM: z.number().int().min(500).max(10000), placeType: z.enum(['home', 'school', 'hospital']).optional()});
export type ResidentCandidate = z.infer<typeof candidateSchema>;
export type ResidentArea = z.infer<typeof areaSchema>;
export type AddResidentLocation = Omit<ResidentArea, 'id'> & {requestId: string};
type LocationCallbacks = {searchLocations: (query: string) => Promise<ResidentCandidate[]>; addLocation: (input: AddResidentLocation) => Promise<ResidentArea>};
const pendingSchema = z.object({id: z.string().regex(/^[a-f0-9]{32}$/), candidate: candidateSchema});
const requestSchema = z.object({thread: z.string(), searchMessage: z.string(), query: z.string(), expiresAt: z.number(), createdAt: z.number(),
  candidates: z.array(pendingSchema).max(6), selectedId: z.string().optional(), requestId: z.string().uuid().optional(), confirmationMessage: z.string().optional(), area: areaSchema.optional()});
const stateSchema = z.object({version: z.literal(1), requests: z.array(requestSchema).max(100)});
type State = z.infer<typeof stateSchema>;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const ttl = 15 * 60_000;

function identity(threadId: string, messageId: string) {
  if (!threadId || threadId.length > 1000 || !messageId || messageId.length > 300) throw new Error('A verified conversation and incoming message are required.');
  return {thread: hash(threadId), message: hash(messageId)};
}

/** Deliberately small acceptance vocabulary; ambiguous, conditional or corrective messages require another question. */
export function confirmsResidentLocation(userText: string): boolean {
  if (typeof userText !== 'string' || userText.length > 500 || /[?;]/.test(userText)) return false;
  const text = userText.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[’‘]/g, "'").replace(/[,!.]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(do it|go ahead|start watching|start watching (that|this) (place|location|address)|add it|save it|watch it|confirm|confirmed|confirmo|confirma|confirmat|endavant|adelante|hazlo|guardalo|the first one|first one|that one|this one|la primera|el primero|aquesta|aquesta adreca)$/.test(text)) return true;
  return /^(yes|yeah|yep|yup|sure|ok|okay|si|vale|d'acord)( (please|thanks|thank you|por favor|gracias|sisplau|gracies|do it|go ahead|that's correct|that is correct|that's right|that is right|that one|this one|that's my home|that is my home|that's my house|that is my house|es correcto|es correcta|es mi casa|es casa meva|es correcte|es aquesta|save it|add it|start watching))*$/.test(text);
}

/** Durable candidate ownership; the agent must obtain explicit consent in a later user message before confirm. */
export function createResidentActions(options: LocationCallbacks & {file: string; now?: () => number}) {
  const now = options.now ?? Date.now;
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>) => {const work = queue.catch(() => {}).then(operation); queue = work; return work;};
  async function read(): Promise<State> {
    try {return stateSchema.parse(JSON.parse(await readFile(options.file, 'utf8')));}
    catch (error) {if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {version: 1, requests: []}; throw new Error('Saved location setup is unavailable; existing state has not been reset.');}
  }
  async function save(state: State) {
    await mkdir(dirname(options.file), {recursive: true, mode: 0o700});
    const temporary = `${options.file}.${randomUUID()}.tmp`;
    try {await writeFile(temporary, JSON.stringify(state), {mode: 0o600, flag: 'wx'}); await rename(temporary, options.file);}
    finally {await unlink(temporary).catch(() => {});}
  }
  const searchResult = (request: z.infer<typeof requestSchema>) => ({confirmationRequired: true as const, requiresLaterMessage: true as const,
    expiresAt: request.expiresAt, candidates: request.candidates.map(({id, candidate}) => ({pendingId: id, ...candidate})),
    locationRegistered: false as const, subscribed: false as const});
  return {
    latestPending: (threadId: string) => serial(async () => {
      const who = identity(threadId, 'pending-read'), state = await read();
      const pending = state.requests.filter(request => request.thread === who.thread && !request.area && request.expiresAt > now()).at(-1);
      return pending ? searchResult(pending) : null;
    }),
    search: (threadId: string, messageId: string, query: string) => serial(async () => {
      const who = identity(threadId, messageId);
      const valid = z.string().trim().min(5).max(250).parse(query);
      const state = await read();
      const previous = state.requests.find(request => request.thread === who.thread && request.searchMessage === who.message);
      if (previous) {
        if (previous.query !== hash(valid)) throw new Error('This message already prepared a different location search.');
        if (previous.area) throw new Error('This search already saved a location. Start a new search to add another.');
        if (previous.expiresAt <= now()) throw new Error('That location search expired. Ask me to search again.');
        return searchResult(previous);
      }
      // Keep completed/potentially accepted additions for seven days for idempotent retries; expire unused searches promptly.
      state.requests = state.requests.filter(request => request.requestId ? now() - request.createdAt < 7 * 86400_000 : request.expiresAt > now());
      state.requests = state.requests.filter(value => value.thread !== who.thread || value.requestId);
      if (state.requests.length >= 100) throw new Error('Location setup is at capacity. Please try again later.');
      const raw = await options.searchLocations(valid);
      if (!Array.isArray(raw)) throw new Error('Address search returned invalid results.');
      // Show exactly one proposed match, so a plain affirmative cannot ambiguously select a hidden alternative.
      const locations = raw.slice(0, 6).flatMap(value => {const result = candidateSchema.safeParse(value); return result.success ? [result.data] : [];}).slice(0, 1);
      const request = {thread: who.thread, searchMessage: who.message, query: hash(valid), createdAt: now(), expiresAt: now() + ttl,
        candidates: locations.map(candidate => ({id: randomBytes(16).toString('hex'), candidate}))};
      state.requests.push(request); await save(state); return searchResult(request);
    }),
    confirm: (threadId: string, messageId: string, pendingId: string, userText: string) => serial(async () => {
      const who = identity(threadId, messageId);
      if (!confirmsResidentLocation(userText)) throw new Error('Please explicitly confirm the proposed location, for example “yes”, before it is saved.');
      if (!/^[a-f0-9]{32}$/.test(pendingId)) throw new Error('Choose a location from your current search results.');
      const state = await read();
      const request = state.requests.find(value => value.thread === who.thread && value.candidates.some(candidate => candidate.id === pendingId));
      if (!request) throw new Error('That location is not available in this conversation. Ask me to search again.');
      if (request.searchMessage === who.message) throw new Error('Please ask the person to confirm the suggested location in a new message before saving it.');
      if (request.selectedId && request.selectedId !== pendingId) throw new Error('A different result from this search was already selected. Search again to add another location.');
      if (request.requestId && request.confirmationMessage !== who.message) throw new Error('That confirmation belongs to an earlier message. Start a new search to change your saved places.');
      if (request.area) return {locationRegistered: true as const, subscribed: false as const, area: request.area, requestId: request.requestId!, replayed: true};
      if (request.expiresAt <= now()) throw new Error('That location confirmation expired. Ask me to search again.');
      const candidate = request.candidates.find(value => value.id === pendingId)!.candidate;
      // Persist intent before the HTTP request. The add callback MUST honor requestId across retries/crashes.
      request.selectedId = pendingId; request.requestId ??= randomUUID(); request.confirmationMessage = who.message; await save(state);
      const name = candidate.label.replace(/[\u0000-\u001f\u007f<>]/g, ' ').trim().slice(0, 80) || 'Saved place';
      const area = areaSchema.parse(await options.addLocation({requestId: request.requestId, name, lat: candidate.lat, lon: candidate.lon, radiusM: 1000,
        ...(candidate.placeType ? {placeType: candidate.placeType} : {})}));
      request.area = area; await save(state);
      return {locationRegistered: true as const, subscribed: false as const, area, requestId: request.requestId, replayed: false};
    }),
  };
}
export type ResidentActions = ReturnType<typeof createResidentActions>;

/** Only the authenticated loopback Next server can geocode or mutate the shared watch registry. */
export function createResidentLocationBridge(options: {baseUrl: string; token: string; fetch?: typeof fetch}): LocationCallbacks {
  const base = new URL(options.baseUrl);
  if (base.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(base.hostname) || base.username || base.password || base.pathname !== '/' || base.search || base.hash || options.token.length < 32) {
    throw new Error('Resident setup requires a loopback HTTP origin and private operator token.');
  }
  const url = new URL('/api/internal/resident-locations', base);
  async function call(body: unknown) {
    let response: Response;
    try {response = await (options.fetch ?? fetch)(url, {method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: {'Content-Type': 'application/json', 'x-ashconnect-token': options.token}, body: JSON.stringify(body)});}
    catch {throw new Error('Location setup is temporarily unavailable. No subscription has been changed.');}
    if (!response.ok) throw new Error(`Location setup request was not accepted (${response.status}).`);
    return response.json();
  }
  return {
    searchLocations: async query => z.object({locations: z.array(candidateSchema).max(6)}).parse(await call({action: 'search', query})).locations,
    addLocation: async input => z.object({area: areaSchema}).parse(await call({action: 'add', ...input})).area,
  };
}
