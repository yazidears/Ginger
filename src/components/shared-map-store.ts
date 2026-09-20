import type {TerrainMapProps} from './terrain-map';

const empty = {type: 'FeatureCollection' as const, features: []};
const ignorePoint = () => {};

type Entry = {props: TerrainMapProps; priority: number};
export function createMapStore() {
  const entries = new Map<symbol, Entry>();
  const listeners = new Set<() => void>();
  let focus = 0;
  let snapshot: TerrainMapProps | null = null;
  const publish = () => {
    const active = [...entries.values()].sort((a, b) => b.priority - a.priority)[0];
    if (active) snapshot = {...active.props, focusKey: focus};
    else if (snapshot) snapshot = {center: snapshot.center, focusKey: focus, selectedRadiusM: 0, hotspots: empty, buildings: empty, landcover: empty, assets: empty, onSelectPoint: ignorePoint};
    listeners.forEach(listener => listener());
  };
  return {
    subscribe: (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener);};},
    getSnapshot: () => snapshot,
    set: (id: symbol, entry: Entry) => {const previous = entries.get(id);
      entries.set(id, entry);
      const activeId = [...entries].sort((a, b) => b[1].priority - a[1].priority)[0]?.[0];
      if (previous && previous.props.focusKey !== entry.props.focusKey && activeId === id) focus++;
      publish();},
    remove: (id: symbol) => {entries.delete(id); publish();},
  };
}
