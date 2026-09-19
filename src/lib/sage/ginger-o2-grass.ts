import artifact from '../../../data/ginger-o2/grass-model.json';

/** Experimental head-spread-rate component; never implies ignition, heat or smoke accuracy. */
export const GINGER_O2_GRASS = {
  version: artifact.version,
  provenance: artifact.source.collection,
  support: artifact.support,
  coefficients: artifact.coefficients,
  status: artifact.status,
} as const;
export type GingerO2GrassInput = {fuelCode: string; midflameWindKmh: number; deadMoisturePct: number};
export type GingerO2GrassFallback = 'unsupported-fuel' | 'invalid-input' | 'wind-outside-training-support' | 'moisture-outside-training-support';
export function gingerO2GrassFallbackReason(input: GingerO2GrassInput): GingerO2GrassFallback | null {
  if (input.fuelCode !== '1') return 'unsupported-fuel';
  if (!Number.isFinite(input.midflameWindKmh) || !Number.isFinite(input.deadMoisturePct)) return 'invalid-input';
  const {windKmh, moisturePct} = GINGER_O2_GRASS.support;
  if (input.midflameWindKmh < windKmh[0] || input.midflameWindKmh > windKmh[1]) return 'wind-outside-training-support';
  if (input.deadMoisturePct < moisturePct[0] || input.deadMoisturePct > moisturePct[1]) return 'moisture-outside-training-support';
  return null;
}
/** Caller must additionally gate experimental opt-in, actual grass mapping and near-flat terrain. */
export function predictGingerO2Grass(input: GingerO2GrassInput): {headMMin: number; version: string; provenance: string} | null {
  if (gingerO2GrassFallbackReason(input)) return null;
  const [intercept, wind, moisture] = GINGER_O2_GRASS.coefficients;
  return {headMMin: Math.exp(intercept + wind * Math.log1p(input.midflameWindKmh) + moisture * input.deadMoisturePct / 10), version: GINGER_O2_GRASS.version, provenance: GINGER_O2_GRASS.provenance};
}
