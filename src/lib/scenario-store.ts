import 'server-only';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {ScenarioContext} from './product-contracts';

const directory = () => process.env.GINGER_SCENARIO_DIR || join(process.cwd(), '.ginger-data', 'scenarios');
export function scenarioDigest(context: ScenarioContext) { return createHash('sha256').update(JSON.stringify(context)).digest('hex'); }
/** Append-only snapshots. No update endpoint: changing an assumption creates a new run. */
export async function saveScenario(context: ScenarioContext): Promise<ScenarioContext> {
  const scenario = structuredClone({...context, id: randomUUID()});
  await mkdir(directory(), {recursive: true, mode: 0o700});
  await writeFile(join(directory(), `${scenario.id}.json`), JSON.stringify({digest: scenarioDigest(scenario), scenario}), {flag: 'wx', mode: 0o600});
  return scenario;
}
export async function readScenario(id: string): Promise<ScenarioContext | null> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
  try {
    const saved = JSON.parse(await readFile(join(directory(), `${id}.json`), 'utf8'));
    if (saved.scenario?.version !== 1 || saved.scenario?.id !== id || saved.digest !== scenarioDigest(saved.scenario)) throw new Error('The saved scenario failed its integrity check.');
    return saved.scenario;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
