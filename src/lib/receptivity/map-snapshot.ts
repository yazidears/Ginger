import type {Snapshot} from './types';

/** Prevent does not display the separate prevention opportunity analysis.
 * Keep every cell and its original measurements; only omit that unused payload.
 */
export function mapSnapshot(snapshot: Snapshot): Snapshot {
  return {...snapshot, cells: snapshot.cells.map(({prevention: _prevention, ...cell}) => cell)};
}
