'use client';
import {useEffect, useRef} from 'react';
import {PRIORITY,type AreaPriority} from '@/lib/receptivity/priority';
import * as maplibre from 'maplibre-gl';
import type {GeoJSONSource, Map as MapInstance} from 'maplibre-gl';
import type {FeatureCollection} from 'geojson';
import type {Snapshot, CellResult} from '@/lib/receptivity/types';
import type {ExposureCategory} from '@/lib/exposure/types';
import {useExposureMap, exposureLayerIds} from '../exposure-map-layer';
export type Metric='priority'|'receptivity'|'spread'|'moisture'|'vegetation'|'evidence';
export type ReceptivityMapProps={priorities?:Map<string,AreaPriority>;now?:number;exposureLayers:ExposureCategory[];onExposureStatus:(status:string)=>void;data:Snapshot|null;index:number;metric:Metric;stations:boolean;wind:boolean;official:boolean;selected:CellResult|null;onSelect:(id:string)=>void;focusKey:number};
export const hazardColor=(v:number|null)=>v===null?'#647079':v>=90?'#e56361':v>=80?'#ed974f':v>=65?'#c4ae62':v>=40?'#819577':'#4c7065';
const empty:FeatureCollection={type:'FeatureCollection',features:[]};
const noCategories:ExposureCategory[]=[];
const ignoreStatus=()=>{};
export function addReceptivityLayers(m:MapInstance){
  for(const id of ['cells','selected','stations','wind','official'])m.addSource(id,{type:'geojson',data:empty});
  m.addLayer({id:'cell-fill',type:'fill',source:'cells',paint:{'fill-color':['get','color'],'fill-opacity':['get','opacity'],'fill-color-transition':{duration:500},'fill-opacity-transition':{duration:500}}},'labels');
  m.addLayer({id:'cell-line',type:'line',source:'cells',minzoom:11.3,paint:{'line-color':['get','color'],'line-opacity':['get','lineOpacity'],'line-width':.35}});
  m.addLayer({id:'official-line',type:'line',source:'official',paint:{'line-color':'#bbb0db','line-width':1.5,'line-dasharray':[3,2]}});
  m.addLayer({id:'selected-line',type:'line',source:'selected',paint:{'line-color':'#f3e7cb','line-width':2.5}});
  m.addLayer({id:'station-dot',type:'circle',source:'stations',paint:{'circle-color':'#91c8c4','circle-radius':5,'circle-stroke-width':2,'circle-stroke-color':'#15272c'}});
  m.addLayer({id:'wind-line',type:'line',source:'wind',paint:{'line-color':'#c0d7df','line-width':1.6,'line-opacity':.8}});
}
export function useReceptivityLayers(map:MapInstance|null,ready:boolean,props?:ReceptivityMapProps){
 const {priorities,data=null,index=0,metric='receptivity',stations=false,wind=false,official=false,selected=null}=props||{};
 const select=useRef(props?.onSelect);select.current=props?.onSelect;
 useExposureMap(map,ready,props?.exposureLayers||noCategories,props?.onExposureStatus||ignoreStatus);
 useEffect(()=>{
  if(!map||!ready||!props)return;
  const popup=new maplibre.Popup({closeButton:false,closeOnClick:false,className:'receptivity-popup',offset:12});
  const hovered=(e:maplibre.MapLayerMouseEvent)=>{const p=e.features?.[0]?.properties;if(p){map.getCanvas().style.cursor='pointer';popup.setLngLat(e.lngLat).setText(`${p.name} · ${p.label}`).addTo(map);}};
  const left=()=>{map.getCanvas().style.cursor='';popup.remove();};
  const clicked=(e:maplibre.MapLayerMouseEvent)=>{if(map.getLayer(exposureLayerIds[0])&&map.queryRenderedFeatures(e.point,{layers:exposureLayerIds}).length)return;const id=e.features?.[0]?.properties?.id;if(id){popup.remove();select.current?.(String(id));}};
  const stationHovered=(e:maplibre.MapLayerMouseEvent)=>{const p=e.features?.[0]?.properties;if(p)popup.setLngLat(e.lngLat).setText(`${p.name} · ${p.time}`).addTo(map);};
  map.on('mousemove','cell-fill',hovered);map.on('mouseleave','cell-fill',left);map.on('click','cell-fill',clicked);map.on('mousemove','station-dot',stationHovered);map.on('mouseleave','station-dot',left);
  return()=>{popup.remove();map.off('mousemove','cell-fill',hovered);map.off('mouseleave','cell-fill',left);map.off('click','cell-fill',clicked);map.off('mousemove','station-dot',stationHovered);map.off('mouseleave','station-dot',left);};
 },[map,ready,Boolean(props)]);
 useEffect(()=>{const m=map;if(!ready||!m||!m.getSource('cells'))return;
 if(!data){for(const id of ['cells','stations','wind','official'])(m.getSource(id) as GeoJSONSource).setData(empty);return;}
 const stationMap=new Map(data.stations.map(s=>[s.station.id,s]));
 const features=data.cells.map(c=>{let score=c.receptivity[index];let label=score===null?'Unavailable':`Fire receptivity ${score}/100`;
  let color=hazardColor(score);let opacity=score===null?.06:score>=80?.75:score>=65?.53:.27;
  if(metric==='spread'){score=c.spread[index];color=hazardColor(score);label=score===null?'Spread unavailable':`Spread potential ${score}/100`;opacity=score===null?.06:score>=65?.72:.35;}
  if(metric==='moisture'){const f=stationMap.get(c.stationId)?.frames.find(f=>f.horizon===data.horizons[index]);const moisture=f?.fineFuelMoisture;label=moisture===undefined?'Fuel moisture unavailable':`Estimated fine-fuel moisture ${moisture.toFixed(1)}% dry mass`;color=moisture===undefined?'#647079':moisture<10?'#ed974f':moisture<16?'#c4ae62':'#5b9696';opacity=.52;}
  if(metric==='vegetation'){label=`${c.fuel.type} · ${Math.round(c.fuel.burnableFraction*100)}% of cell`;color=c.fuel.type==='Tree cover'?'#638971':c.fuel.type==='Shrubland'?'#a39a67':c.fuel.type==='Grassland'?'#b5ab73':'#978572';opacity=.6;}
  if(metric==='priority'){const p=priorities?.get(c.id),level=p?.level||'unknown';color=PRIORITY[level].color;label=`${PRIORITY[level].label} · ${p?.reasons[0]||'Awaiting evidence'}`;opacity=level==='verify'?.8:level==='review'?.65:level==='watch'?.18:level==='unknown'?.08:.04;}
  if(metric==='evidence'){const p=c.evidence?.priority||'unknown';color={urgent:'#e56361',review:'#ed974f',routine:'#638971',unknown:'#647079'}[p];label=`Satellite / heat review: ${p}`;opacity=p==='urgent'?.8:p==='review'?.65:.2;}
  return {type:'Feature' as const,geometry:{type:'Polygon' as const,coordinates:[c.ring]},properties:{id:c.id,name:c.name,label,color,opacity,lineOpacity:metric==='priority'?(opacity>=.35?.3:0):.3}};
 });
 (m.getSource('cells') as GeoJSONSource).setData({type:'FeatureCollection',features});
 (m.getSource('stations') as GeoJSONSource).setData({type:'FeatureCollection',features:stations?data.stations.map(s=>({type:'Feature',geometry:{type:'Point',coordinates:s.station.center},properties:{name:s.station.name,time:s.frames[0].timestamp}})):[]});
 const arrows:GeoJSON.Feature<GeoJSON.LineString>[]=[];
 if(wind)for(const s of data.stations){const w=s.frames.find(f=>f.horizon===data.horizons[index])?.conditions;if(w?.windDirection===undefined)continue;const theta=(w.windDirection+180)*Math.PI/180,l=Math.min(.017,.002+w.windSpeed*.0003),[x,y]=s.station.center,tip=[x+Math.sin(theta)*l/Math.cos(y*Math.PI/180),y+Math.cos(theta)*l];const coordinates=[[x,y],tip,[tip[0]-Math.sin(theta-.5)*l*.3,tip[1]-Math.cos(theta-.5)*l*.3],tip,[tip[0]-Math.sin(theta+.5)*l*.3,tip[1]-Math.cos(theta+.5)*l*.3]];arrows.push({type:'Feature',geometry:{type:'LineString',coordinates},properties:{}});}
 (m.getSource('wind') as GeoJSONSource).setData({type:'FeatureCollection',features:arrows});
 (m.getSource('official') as GeoJSONSource).setData(official&&data.official.comparable?data.official.features:empty);
 },[map,ready,data,index,metric,stations,wind,official,priorities]);
 useEffect(()=>{const m=map;if(!ready||!m||!m.getSource('selected'))return;(m.getSource('selected') as GeoJSONSource).setData(selected?{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[selected.ring]}}]}:empty);},[map,ready,selected]);

}
