/** Evaluation helpers shared by the offline GingerO1 benchmarks. No live tuning. */
export type Pair = {observed: number; predicted: number; day: string};
export function metrics(rows: Pair[]) {
  if (!rows.length || rows.some(r => !Number.isFinite(r.observed) || !Number.isFinite(r.predicted) || r.observed < 0 || r.predicted < 0)) throw Error('Invalid or empty evaluation rows');
  const errors = rows.map(r => r.predicted - r.observed);
  const sorted = errors.map(Math.abs).sort((a, b) => a - b);
  return {
    n: rows.length, mae: errors.reduce((s, e) => s + Math.abs(e), 0) / rows.length,
    rmse: Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / rows.length),
    bias: errors.reduce((s, e) => s + e, 0) / rows.length,
    p90AbsoluteError: sorted[Math.ceil(.9 * sorted.length) - 1],
    withinFactorTwo: rows.filter(r => r.predicted >= r.observed / 2 && r.predicted <= r.observed * 2).length / rows.length,
  };
}

export function meanDayMAE(rows: Pair[]) {
  const days = [...new Set(rows.map(r => r.day))];
  if (!days.length) throw Error('No training days');
  return days.reduce((sum, day) => sum + metrics(rows.filter(r => r.day === day)).mae, 0) / days.length;
}

/** Fit on training observations only, weighting burn days equally. */
export function fitScale(rows: Pair[]) {
  let best = 1, loss = Infinity;
  for (let tick = 10; tick <= 400; tick++) {
    const scale = tick / 100;
    const score = meanDayMAE(rows.map(r => ({...r, predicted: r.predicted * scale})));
    if (score < loss) { loss = score; best = scale; }
  }
  return best;
}

/** Deterministic paired cluster bootstrap; resample days, never individual intervals. */
export function bootstrapImprovement(baseline: Pair[], candidate: Pair[], repetitions = 2000) {
  if (baseline.length !== candidate.length || baseline.some((r, i) => r.day !== candidate[i].day || r.observed !== candidate[i].observed)) throw Error('Paired rows must match');
  const days = [...new Set(baseline.map(r => r.day))];
  if (days.length < 2) return null;
  let seed = 20260919;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const deltas: number[] = [];
  for (let j = 0; j < repetitions; j++) {
    let sum = 0, count = 0;
    for (let k = 0; k < days.length; k++) {
      const day = days[Math.floor(random() * days.length)];
      baseline.forEach((r, i) => { if (r.day === day) { sum += Math.abs(r.predicted - r.observed) - Math.abs(candidate[i].predicted - r.observed); count++; } });
    }
    deltas.push(sum / count);
  }
  deltas.sort((a, b) => a - b);
  return {repetitions, clusters: days.length, lower: deltas[Math.floor(.025 * repetitions)], upper: deltas[Math.ceil(.975 * repetitions) - 1], units: 'm/min MAE reduction'};
}

/** Small RFC4180 reader. Missing numerical values remain missing, never zero. */
export function csvRecords(text: string): Record<string, string>[] {
  const records: string[][] = []; let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted;
    } else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); if (row.some(x => x.trim())) records.push(row); row = []; field = '';
    } else field += c;
  }
  if (quoted) throw Error('Unclosed CSV quote');
  if (field || row.length) { row.push(field); records.push(row); }
  const header = records.shift()?.map(x => x.replace(/^\uFEFF/, '').trim());
  if (!header?.length || new Set(header).size !== header.length) throw Error('Invalid CSV header');
  return records.map(values => {
    if (values.length !== header.length) throw Error('CSV column mismatch');
    return Object.fromEntries(header.map((key, i) => [key, values[i].trim()]));
  });
}

export function requiredNumber(value: string | undefined): number | null {
  if (value === undefined || !value.trim() || /^(NA|NaN|null)$/i.test(value)) return null;
  const n = Number(value); return Number.isFinite(n) ? n : null;
}
