'use client';

import {createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import dynamic from 'next/dynamic';
import type {TerrainMapProps} from './terrain-map';

import {createMapStore} from './shared-map-store';

const TerrainMap = dynamic(() => import('./terrain-map'), {ssr: false});

const MapContext = createContext<ReturnType<typeof createMapStore> | null>(null);
export function SharedMapProvider({children}: {children: ReactNode}) {
  const [store] = useState(createMapStore);
  return <MapContext.Provider value={store}>{children}</MapContext.Provider>;
}

/** Panels publish geographic layers; only SharedMapSurface owns the renderer. */
export default function MapLayers({priority = 0, ...props}: TerrainMapProps & {priority?: number}) {
  const store = useContext(MapContext);
  const id = useRef(Symbol('map-layers'));
  useLayoutEffect(() => {store?.set(id.current, {props, priority});});
  useLayoutEffect(() => {const key = id.current; return () => store?.remove(key);}, [store]);
  return store ? null : <TerrainMap {...props}/>;
}
const empty = {type: 'FeatureCollection' as const, features: []};
const initialView={center:[2.11,41.43] as [number,number],zoom:10.35,satellite:false,threeD:false};
const fallback: TerrainMapProps = {center: [1.7, 41.7], initialZoom: 7.2, hotspots: empty, buildings: empty, landcover: empty, assets: empty, selectedRadiusM: 0, onSelectPoint: () => {}};
export function SharedMapSurface() {
  const store = useContext(MapContext)!;
  const props = useSyncExternalStore(store.subscribe, store.getSnapshot, () => null);
  return <div className="shared-map-surface"><TerrainMap {...(props ?? fallback)} initialView={initialView} persistentCamera/></div>;
}
