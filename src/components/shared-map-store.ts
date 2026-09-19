import type {TerrainMapProps} from './terrain-map';

type Entry = {props: TerrainMapProps; priority: number};
export function createMapStore() {
  const entries = new Map<symbol, Entry>();
  const listeners = new Set<() => void>();
  let focus = 0;
  let snapshot: TerrainMapProps | null = null;
  const publish = () => {
    const active = [...entries.values()].sort((a, b) => b.priority - a.priority)[0];
    if (active) snapshot = {...active.props, focusKey: focus};
    listeners.forEach(listener => listener());
  };
  return {
    subscribe: (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener);};},
    getSnapshot: () => snapshot,
    set: (id: symbol, entry: Entry) => {const previous = entries.get(id);
      const topPriority = Math.max(...[...entries.values()].map(value => value.priority));
      if (previous && previous.props.focusKey !== entry.props.focusKey && entry.priority >= topPriority) focus++;
      entries.set(id, entry); publish();},
    remove: (id: symbol) => {entries.delete(id); publish();},
  };
}
