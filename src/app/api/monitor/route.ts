import {getMonitor} from '@/lib/monitor';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){return Response.json(await getMonitor(),{headers:{'Cache-Control':'no-store'}});}
