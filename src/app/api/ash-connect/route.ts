import {messagingWorker, operatorAuthorized} from '@/lib/ash-connect';
import {requireSameOrigin, watchAreaStore, WatchAreaError} from '@/lib/watch-areas';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'no-store'}});

export async function GET(request: Request) {
  try {
    const areas = await watchAreaStore.list();
    let channel = 'imessage', contact: string | null = null;
    let connected = false, counts: Record<string, number> = {}, enhancedCounts: Record<string, number> = {}, history = [];
    const configured = (process.env.ASHCONNECT_OPERATOR_TOKEN || '').length >= 32;
    const unlocked = operatorAuthorized(request);
    if (request.headers.has('x-ashconnect-token') && !unlocked) return json({error: 'The operator key is incorrect.'}, 401);
    try {
      const response = await messagingWorker('GET');
      if (response.ok) {const data = await response.json(); connected = true; channel = data.channel === 'telegram' ? 'telegram' : data.channel === 'whatsapp' ? 'whatsapp' : 'imessage'; contact = data.contact || null; counts = data.counts; enhancedCounts = data.enhancedCounts || {}; if (unlocked) history = data.history;}
    } catch { /* Saved homes stay available while the separate worker is offline. */ }
    const sender = process.env.GINGER_IMESSAGE_CONTACT?.trim() || '';
    return json({connected, configured, unlocked, channel, contact: contact || (channel === 'imessage' && /^\+[1-9]\d{7,14}$/.test(sender) ? sender : null),
      homes: unlocked ? areas.map(area => ({...area, subscribers: connected ? counts[area.id] || 0 : null, enhancedSubscribers: connected ? enhancedCounts[area.id] || 0 : null})) : [], history});
  } catch {return json({error: 'Saved homes could not be loaded. Try again.'}, 503);}
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    if (!operatorAuthorized(request)) return json({error: 'Unlock operator access before sending.'}, 401);
    if (!request.headers.get('content-type')?.includes('application/json')) return json({error: 'JSON is required.'}, 415);
    const text = await request.text();
    if (text.length > 8000) return json({error: 'Message is too large.'}, 413);
    let body;
    try {body = JSON.parse(text);} catch {return json({error: 'Invalid message.'}, 400);}
    const response = await messagingWorker('POST', body);
    return json(await response.json(), response.status);
  } catch (error) {
    if (error instanceof WatchAreaError) return json({error: error.message}, error.status);
    return json({error: 'The worker did not return a result. Refresh recent messages; retrying this unchanged send will not duplicate it.'}, 503);
  }
}
