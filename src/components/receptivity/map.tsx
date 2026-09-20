'use client';
import {memo,useMemo} from 'react';
import MapLayers from '../shared-map';
import {currentThermals} from '@/lib/receptivity/priority';
import type {ReceptivityMapProps} from './map-layers';
export type {Metric} from './map-layers';
export {hazardColor} from './map-layers';
const empty={type:'FeatureCollection' as const,features:[]};
/** The home screen supplies cell, weather and infrastructure layers to the shared map. */
function ReceptivityMap(props:ReceptivityMapProps){
 const hotspots=useMemo<GeoJSON.FeatureCollection>(()=>({type:'FeatureCollection',features:props.data?currentThermals(props.data,props.now).map(h=>({type:'Feature',id:h.id,geometry:{type:'Point',coordinates:h.position},properties:{id:h.id,frp:h.frpMw,source:h.provenance.source,observedAt:h.provenance.observedAt}})):[]}),[props.data,props.now]);
 return <MapLayers receptivity={props} center={props.selected?.center||[2.11,41.43]} initialZoom={props.selected?12.4:10.35} focusKey={props.focusKey} selectedRadiusM={0} hotspots={hotspots} buildings={empty} landcover={empty} assets={empty} onSelectPoint={()=>{}}/>;
}

export default memo(ReceptivityMap);
