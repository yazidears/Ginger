import {loadEnvConfig} from '@next/env';
import {readDeepfireContext} from '../src/lib/providers/deepfire-context';
import {DeepfireProvider, deepfireConfigured} from '../src/lib/providers/deepfire';
loadEnvConfig(process.cwd());
async function main() {
  if (!deepfireConfigured()) throw Error('Set DEEPFIRE_CLIENT_ID and DEEPFIRE_CLIENT_SECRET in .env.local first.');
  const result = await new DeepfireProvider().hotspots();
  const context=await readDeepfireContext([0.1,40.4,3.4,42.9]);
  console.log(JSON.stringify({layers:context.sources.map(s=>({name:s.source,status:s.status})),clusters:context.clusters.length,perimeters:context.perimeters.features.length,staticHeatSources:context.staticHeatSources.features.length,provider: 'Deepfire', status: result.status, detections: result.data.length, retrievedAt: result.updatedAt, detail: result.detail}, null, 2));
  if(context.sources.some(s=>s.status!=='live'))process.exitCode=1;
}
main().catch(error => {console.error(error instanceof Error ? error.message : 'Deepfire check failed'); process.exitCode = 1;});
