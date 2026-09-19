'use client';
import MapLayers from '../shared-map';
import type {ReceptivityMapProps} from './map-layers';
export type {Metric} from './map-layers';
export {hazardColor} from './map-layers';
const empty={type:'FeatureCollection' as const,features:[]};
/** The home screen supplies cell, weather and infrastructure layers to the shared map. */
export default function ReceptivityMap(props:ReceptivityMapProps){
 return <MapLayers receptivity={props} center={props.selected?.center||[2.11,41.43]} initialZoom={props.selected?12.4:10.35} focusKey={props.focusKey} selectedRadiusM={0} hotspots={empty} buildings={empty} landcover={empty} assets={empty} onSelectPoint={()=>{}}/>;
}
