import type {CellResult, GridCell} from './types';
import type {ExposureIndex} from '../exposure/model';
import type {ExposureSummary} from '../exposure/types';

export const PREVENTION_VERSION = 'prevention-priority-1';
/** Planning assumptions, not measured team performance or dispatch authority. */
export type TeamScenario = {
  coverage: number;
  ignitionReduction: number;
  spreadReduction: number;
  arrivalMinutes: number;
  opportunityMinutes: number;
};
export const REFERENCE_TEAM: Readonly<TeamScenario> = Object.freeze({
  coverage: 1, ignitionReduction: .5, spreadReduction: 0,
  arrivalMinutes: 0, opportunityMinutes: 60,
});
export type PreventionContext = {
  connectedFuelHa: number | null;
  humanActivity: number | null;
  humanActivitySource: 'mapped-activity-proxy' | 'scenario' | 'unavailable';
};
export type PreventionScore = {
  version: typeof PREVENTION_VERSION;
  status: 'scenario' | 'insufficient-data';
  ignitionPressure: number | null;
  spreadPotential: number | null;
  growthPotential: number | null;
  connectedFuelHa: number | null;
  humanActivity: number | null;
  humanActivitySource: PreventionContext['humanActivitySource'];
  baselineRisk: number | null;
  residualRisk: number | null;
  preventionScore: number | null;
  relativeReductionPct: number | null;
  missing: string[];
};
const round = (x: number) => Math.round(x * 100) / 100;
const bounded = (x: unknown, max: number): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= max;

export function validateTeam(value: unknown): TeamScenario {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('team must be an object.');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !Object.hasOwn(REFERENCE_TEAM, k))) throw Error('Unknown team field.');
  for (const key of ['coverage', 'ignitionReduction', 'spreadReduction'] as const)
    if (!bounded(v[key], 1)) throw Error(`${key} must be a number from 0 to 1.`);
  if (!bounded(v.arrivalMinutes, 1440) || !bounded(v.opportunityMinutes, 1440) || v.opportunityMinutes === 0)
    throw Error('Use arrivalMinutes 0–1440 and opportunityMinutes greater than 0 and at most 1440.');
  return {coverage: v.coverage as number, ignitionReduction: v.ignitionReduction as number,
    spreadReduction: v.spreadReduction as number, arrivalMinutes: v.arrivalMinutes, opportunityMinutes: v.opportunityMinutes};
}

/** A relative planning index. None of the normalized inputs is a probability.
 * Wind is already included in ISI: do not count it again as an ignition bonus.
 * Only human ignition pressure is reduced by ignition-prevention work.
 */
export function scorePrevention(cell: Pick<CellResult, 'receptivity' | 'spread'>,
  context: PreventionContext, team: TeamScenario = REFERENCE_TEAM, horizonIndex = 0): PreventionScore {
  validateTeam(team);
  const receptivity = cell.receptivity[horizonIndex], spread = cell.spread[horizonIndex];
  const missing: string[] = [];
  if (!bounded(receptivity, 100)) missing.push('Fuel receptivity');
  if (!bounded(spread, 100)) missing.push('Spread potential');
  if (!bounded(context.humanActivity, 100)) missing.push('Human activity');
  if (!bounded(context.connectedFuelHa, Number.MAX_SAFE_INTEGER)) missing.push('Connected mapped fuel extent');
  const extent = bounded(context.connectedFuelHa, Number.MAX_SAFE_INTEGER) ? context.connectedFuelHa : null;
  // 1,000 ha is an explicit display reference, not a forecast or calibrated threshold.
  const growth = extent === null ? null : 100 * extent / (extent + 1000);
  const base: PreventionScore = {version: PREVENTION_VERSION, status: 'insufficient-data',
    ignitionPressure: null, spreadPotential: bounded(spread, 100) ? spread : null,
    growthPotential: growth === null ? null : round(growth), connectedFuelHa: extent === null ? null : round(extent),
    humanActivity: bounded(context.humanActivity, 100) ? context.humanActivity : null,
    humanActivitySource: context.humanActivitySource,
    baselineRisk: null, residualRisk: null, preventionScore: null, relativeReductionPct: null, missing};
  if (missing.length) return base;
  const human = context.humanActivity! / 100;
  // Fixed background pressure is a scenario assumption, not a lightning observation.
  const background = .1;
  const pressure = background + (1 - background) * human;
  const opportunity = Math.max(0, 1 - team.arrivalMinutes / team.opportunityMinutes) * team.coverage;
  const remainingPressure = background + (1 - background) * human * (1 - team.ignitionReduction * opportunity);
  const consequence = (spread! / 100 + growth! / 100) / 2;
  const baseline = receptivity! * pressure * consequence;
  const residual = receptivity! * remainingPressure * consequence * (1 - team.spreadReduction * opportunity);
  return {...base, status: 'scenario', ignitionPressure: round(receptivity! * pressure),
    baselineRisk: round(baseline), residualRisk: round(residual), preventionScore: round(baseline - residual),
    relativeReductionPct: baseline > 0 ? round(100 * (baseline - residual) / baseline) : null};
}

/** Four-neighbour connectivity in the prepared UTM grid. Extent is clipped to
 * dataset coverage; gaps, roads and fuel breaks inside cells are unresolved.
 * This is landscape context, never hectares predicted to burn in a time window.
 */
export function connectedFuelAreas(cells: GridCell[], cellSizeM: number): Map<string, number> {
  const result = new Map<string, number>();
  if (!Number.isFinite(cellSizeM) || cellSizeM <= 0) return result;
  const grid = new Map<string, GridCell>();
  const positions = new Map<string, [number, number]>();
  for (const cell of cells) {
    const match = /^utm31-(\d+)-(-?\d+)-(-?\d+)$/.exec(cell.id);
    if (!match || Number(match[1]) !== cellSizeM || !bounded(cell.fuel.burnableFraction, 1) || cell.fuel.burnableFraction === 0) continue;
    const xy: [number, number] = [Number(match[2]), Number(match[3])];
    grid.set(xy.join(':'), cell); positions.set(cell.id, xy);
  }
  const seen = new Set<string>();
  for (const start of grid.values()) {
    if (seen.has(start.id)) continue;
    const component = [start]; seen.add(start.id); let ha = 0;
    for (let i = 0; i < component.length; i++) {
      const cell = component[i], [x, y] = positions.get(cell.id)!;
      ha += cellSizeM ** 2 / 10000 * cell.fuel.burnableFraction;
      for (const [dx, dy] of [[cellSizeM, 0], [-cellSizeM, 0], [0, cellSizeM], [0, -cellSizeM]]) {
        const neighbour = grid.get(`${x + dx}:${y + dy}`);
        if (neighbour && !seen.has(neighbour.id)) {seen.add(neighbour.id); component.push(neighbour);}
      }
    }
    component.forEach(cell => result.set(cell.id, ha));
  }
  return result;
}

export function activityContext(cell: GridCell, index: ExposureIndex | null, cellSizeM: number, summary?: ExposureSummary): Pick<PreventionContext, 'humanActivity' | 'humanActivitySource'> {
  const exposure = summary ?? index?.summary(cell.center[0], cell.center[1], cellSizeM / 2, true);
  if (!exposure || exposure.status !== 'ready' || !exposure.counts)
    return {humanActivity: null, humanActivitySource: 'unavailable'};
  // Distance-weighted road, residential/work and gathering-place contributions.
  // Schools/hospitals measure exposure, not extra ignition sources here.
  const points = exposure.contributions.filter(c => ['road', 'complex', 'gathering'].includes(c.category)).reduce((n, c) => n + c.points, 0);
  return {humanActivity: round(Math.min(100, points / 30 * 100)), humanActivitySource: 'mapped-activity-proxy'};
}

export const PREVENTION_METHOD = {
  version: PREVENTION_VERSION, team: REFERENCE_TEAM, backgroundIgnitionPressure: .1,
  growthReferenceHa: 1000, consequenceWeights: {spread: .5, growth: .5},
  scoreMeaning: 'Baseline risk index minus residual risk index under the stated team scenario, 0–100 points.',
  limitations: [
    'Experimental planning scenario, not a calibrated ignition probability, fire-size forecast, or measured team success rate.',
    'Mapped activity is a land-use proxy, not observed people, occupancy or footfall. Missing or stale inventory yields no prevention score.',
    'Connected fuel hectares are clipped mapped landscape extent, not predicted burned area; sub-cell barriers and spotting are unresolved.',
    'Reference team assumes full coverage, arrival now and 50% reduction of human ignition pressure, with no spread reduction. No actual team presence is inferred.',
    'A low prevention score can mean limited intervention benefit despite high danger. Review baselineRisk separately.',
  ],
};
