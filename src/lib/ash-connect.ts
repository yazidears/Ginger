import 'server-only';
import {randomBytes, timingSafeEqual} from 'node:crypto';

export function operatorAuthorized(request: Request) {
  const expected = process.env.ASHCONNECT_OPERATOR_TOKEN || '';
  const actual = request.headers.get('x-ashconnect-token') || '';
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return expected.length >= 32 && a.length === b.length && timingSafeEqual(a, b);
}

export async function messagingWorker(method: 'GET' | 'POST', body?: unknown) {
  const token = process.env.ASHCONNECT_OPERATOR_TOKEN || '';
  if (token.length < 32) throw new Error('Operator connection is not configured.');
  const port = Number(process.env.IMESSAGE_PORT || '4112');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Messaging port is invalid.');
  return fetch(`http://127.0.0.1:${port}/internal/ash-connect`, {method, cache: 'no-store',
    headers: {'Content-Type': 'application/json', 'x-ashconnect-token': token},
    ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(method === 'GET' ? 3000 : 60_000)});
}

export const residentCookieName = 'ashconnect-resident';
export function residentSession(request: Request) {
  const value = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${residentCookieName}=`))?.slice(residentCookieName.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
export const newResidentSession = () => randomBytes(32).toString('hex');
export function residentCookie(request: Request, session: string) {
  return `${residentCookieName}=${session}; Path=/api/ash-connect; HttpOnly; SameSite=Lax; Max-Age=7776000${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
