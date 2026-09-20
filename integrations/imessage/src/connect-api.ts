import {z} from 'zod';
import {timingSafeEqual} from 'node:crypto';
import {connectMessageSchema, type createUpdates} from './updates';

export function authorized(actual: string | null, expected = process.env.ASHCONNECT_OPERATOR_TOKEN || '') {
  if (expected.length < 32 || !actual) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Private operator bridge. Never accepts a phone number or a channel identity. */
export function createConnectApi(options: {
  updates: ReturnType<typeof createUpdates>;
  registeredIds: () => Promise<string[]>;
  send: (thread: string, text: string) => Promise<void>;
  token?: string;
  channelInfo?: () => {channel: 'imessage' | 'whatsapp' | 'telegram'; contact: string | null};
}) {
  return async (request: Request): Promise<Response> => {
    const json = (data: unknown, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'no-store'}});
    if (!authorized(request.headers.get('x-ashconnect-token'), options.token)) return json({error: 'Operator access required.'}, 401);
    if (request.method === 'GET') {
      const whatsapp = process.env.ASHCONNECT_TRANSPORT === 'vonage', telegram = process.env.ASHCONNECT_TRANSPORT === 'telegram';
      const contact = telegram ? (process.env.GINGER_TELEGRAM_BOT_USERNAME || process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '') : whatsapp ? (process.env.VONAGE_WHATSAPP_SENDER || process.env.GINGER_WHATSAPP_CONTACT || '').replace(/^\+/, '') : (process.env.GINGER_IMESSAGE_CONTACT || '').trim();
      return json({...await options.updates.connectStatus(), ...(options.channelInfo?.() ?? {channel: telegram ? 'telegram' : whatsapp ? 'whatsapp' : 'imessage',
        contact: (telegram ? /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/ : whatsapp ? /^[1-9]\d{7,14}$/ : /^\+[1-9]\d{7,14}$/).test(contact) ? contact : null})});
    }
    if (request.method !== 'POST') return json({error: 'Method not allowed.'}, 405);
    let body: unknown;
    try {
      const text = await request.text();
      if (text.length > 8000) return json({error: 'Request is too large.'}, 413);
      body = JSON.parse(text);
    } catch {return json({error: 'Invalid request.'}, 400);}
    const action = body && typeof body === 'object' && 'action' in body ? body.action : undefined;
    if (action === 'resident-status' || action === 'pair') {
      const schema = z.object({action: z.enum(['resident-status', 'pair']), session: z.string().regex(/^[a-f0-9]{64}$/),
        areaId: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/).optional(), repeat: z.boolean().optional()});
      const parsed = schema.safeParse(body);
      if (!parsed.success) return json({error: 'Invalid connection request.'}, 400);
      const input = parsed.data;
      if (action === 'resident-status') return json(await options.updates.residentStatus(input.session));
      if (!input.areaId || !(await options.registeredIds()).includes(input.areaId)) return json({error: 'Location is no longer available.'}, 409);
      try {return json(await options.updates.createPairing(input.session, input.areaId, !!input.repeat));}
      catch {return json({error: 'Connection could not be prepared. Try again.'}, 503);}
    }
    let input;
    try {input = connectMessageSchema.parse(body);}
    catch {return json({error: 'Choose saved homes and enter a message of 1–1,200 characters.'}, 400);}
    const ids = await options.registeredIds();
    if (input.areaIds.some(id => !ids.includes(id))) return json({error: 'A selected home is no longer registered. Refresh the home list.'}, 409);
    try {return json(await options.updates.connectSend(input, options.send));}
    catch (error) {
      const message = error instanceof Error ? error.message : '';
      const known = /^(No opted-in|Wait one minute|This send ID|Dispatch archive)/.test(message);
      return json({error: known ? message : 'Send outcome unavailable. Check recent messages before starting a new send.'}, known ? 409 : 503);
    }
  };
}
