import {readScenario} from '@/lib/scenario-store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const scenario = await readScenario((await params).id);
    return Response.json(scenario ? {scenario} : {error: 'Scenario not found.'}, {status: scenario ? 200 : 404, headers: {'Cache-Control': 'no-store'}});
  } catch { return Response.json({error: 'Saved scenario could not be verified.'}, {status: 503}); }
}
