'use client';
import {useExposureMap,exposureLayerIds} from '../exposure-map-layer';
import type {ExposureCategory} from '@/lib/exposure/types';
import {useEffect,useRef,useState} from 'react';
import * as maplibre from 'maplibre-gl';
import type {GeoJSONSource,Map as MapInstance} from 'maplibre-gl';
import type {FeatureCollection} from 'geojson';
import type {Snapshot,CellResult} from '@/lib/receptivity/types';
import {Plus,Minus,LocateFixed} from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';
export type Metric='receptivity'|'spread'|'moisture'|'vegetation';
export const hazardColor=(v:number|null)=>v===null?'#647079':v>=90?'#e56361':v>=80?'#ed974f':v>=65?'#c4ae62':v>=40?'#819577':'#4c7065';
const empty:FeatureCollection={type:'FeatureCollection',features:[]};
maplibre.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
export default function ReceptivityMap({exposureLayers,onExposureStatus,data,index,metric,stations,wind,official,selected,onSelect,focusKey}:{exposureLayers:ExposureCategory[];onExposureStatus:(status:string)=>void;data:Snapshot|null;index:number;metric:Metric;stations:boolean;wind:boolean;official:boolean;selected:CellResult|null;onSelect:(id:string)=>void;focusKey:number}){
 const container=useRef<HTMLDivElement>(null),map=useRef<MapInstance|null>(null),select=useRef(onSelect);select.current=onSelect;
 const [ready,setReady]=useState(false),[error,setError]=useState('');
 useExposureMap(map.current,ready,exposureLayers,onExposureStatus);
 useEffect(()=>{if(!container.current)return;setReady(false);let m:MapInstance;try{m=new maplibre.Map({container:container.current,center:[2.11,41.43],zoom:10.35,minZoom:6,maxZoom:16,attributionControl:false,style:{version:8,sources:{base:{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'],tileSize:256,attribution:'Tiles © Esri, HERE, Garmin, OpenStreetMap contributors'},labels:{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'],tileSize:256}},layers:[{id:'background',type:'background',paint:{'background-color':'#141c21'}},{id:'base',type:'raster',source:'base',paint:{'raster-opacity':.75}}]}});map.current=m;}catch{setError('Map renderer unavailable. Select a cell from the ranking to inspect its assessment.');return;}
 m.addControl(new maplibre.AttributionControl({compact:true}),'bottom-left');m.addControl(new maplibre.ScaleControl({maxWidth:100}),'bottom-right');
 m.on('error',e=>{if((e as unknown as {sourceId?:string}).sourceId==='base')setError('Basemap unavailable; computed cell overlays remain accessible.');});
 const popup=new maplibre.Popup({closeButton:false,closeOnClick:false,className:'receptivity-popup',offset:12});
 m.on('load',()=>{if(map.current!==m)return;
  for(const id of ['cells','selected','stations','wind','official'])m.addSource(id,{type:'geojson',data:empty});
  m.addLayer({id:'cell-fill',type:'fill',source:'cells',paint:{'fill-color':['get','color'],'fill-opacity':['get','opacity'],'fill-color-transition':{duration:500},'fill-opacity-transition':{duration:500}}});
  m.addLayer({id:'cell-line',type:'line',source:'cells',minzoom:11.3,paint:{'line-color':['get','color'],'line-opacity':.3,'line-width':.35}});
  m.addLayer({id:'official-line',type:'line',source:'official',paint:{'line-color':'#bbb0db','line-width':1.5,'line-dasharray':[3,2]}});
  m.addLayer({id:'labels',type:'raster',source:'labels',paint:{'raster-opacity':.9}});
  m.addLayer({id:'selected-line',type:'line',source:'selected',paint:{'line-color':'#f3e7cb','line-width':2.5}});
  m.addLayer({id:'station-dot',type:'circle',source:'stations',paint:{'circle-color':'#91c8c4','circle-radius':5,'circle-stroke-width':2,'circle-stroke-color':'#15272c'}});
  m.addLayer({id:'wind-line',type:'line',source:'wind',paint:{'line-color':'#c0d7df','line-width':1.6,'line-opacity':.8}});
  m.on('mousemove','cell-fill',e=>{const p=e.features?.[0]?.properties;if(!p)return;m.getCanvas().style.cursor='pointer';popup.setLngLat(e.lngLat).setText(`${p.name} · ${p.label}`).addTo(m);});
  m.on('mouseleave','cell-fill',()=>{m.getCanvas().style.cursor='';popup.remove();});
  m.on('click','cell-fill',e=>{if(m.getLayer(exposureLayerIds[0])&&m.queryRenderedFeatures(e.point,{layers:exposureLayerIds}).length)return;const id=e.features?.[0]?.properties?.id;if(id){popup.remove();select.current(String(id));}});
  m.on('mousemove','station-dot',e=>{const p=e.features?.[0]?.properties;if(p)popup.setLngLat(e.lngLat).setText(`${p.name} · ${p.time}`).addTo(m);});m.on('mouseleave','station-dot',()=>popup.remove());setReady(true);
 });
 const resize=new ResizeObserver(()=>m.resize());resize.observe(container.current);return()=>{resize.disconnect();popup.remove();m.remove();map.current=null;};
 },[]);
 useEffect(()=>{const m=map.current;if(!ready||!m||!m.getSource('cells')||!data)return;
 const stationMap=new Map(data.stations.map(s=>[s.station.id,s]));
 const features=data.cells.map(c=>{let score=c.receptivity[index];let label=score===null?'Unavailable':`Fire receptivity ${score}/100`;
  let color=hazardColor(score);let opacity=score===null?.06:score>=80?.75:score>=65?.53:.27;
  if(metric==='spread'){score=c.spread[index];color=hazardColor(score);label=score===null?'Spread unavailable':`Spread potential ${score}/100`;opacity=score===null?.06:score>=65?.72:.35;}
  if(metric==='moisture'){const f=stationMap.get(c.stationId)?.frames.find(f=>f.horizon===data.horizons[index]);const moisture=f?.fineFuelMoisture;label=moisture===undefined?'Fuel moisture unavailable':`Estimated fine-fuel moisture ${moisture.toFixed(1)}% dry mass`;color=moisture===undefined?'#647079':moisture<10?'#ed974f':moisture<16?'#c4ae62':'#5b9696';opacity=.52;}
  if(metric==='vegetation'){label=`${c.fuel.type} · ${Math.round(c.fuel.burnableFraction*100)}% of cell`;color=c.fuel.type==='Tree cover'?'#638971':c.fuel.type==='Shrubland'?'#a39a67':c.fuel.type==='Grassland'?'#b5ab73':'#978572';opacity=.6;}
  return {type:'Feature' as const,geometry:{type:'Polygon' as const,coordinates:[c.ring]},properties:{id:c.id,name:c.name,label,color,opacity}};
 });
 (m.getSource('cells') as GeoJSONSource).setData({type:'FeatureCollection',features});
 (m.getSource('stations') as GeoJSONSource).setData({type:'FeatureCollection',features:stations?data.stations.map(s=>({type:'Feature',geometry:{type:'Point',coordinates:s.station.center},properties:{name:s.station.name,time:s.frames[0].timestamp}})):[]});
 const arrows:GeoJSON.Feature<GeoJSON.LineString>[]=[];
 if(wind)for(const s of data.stations){const w=s.frames.find(f=>f.horizon===data.horizons[index])?.conditions;if(w?.windDirection===undefined)continue;const theta=(w.windDirection+180)*Math.PI/180,l=Math.min(.017,.002+w.windSpeed*.0003),[x,y]=s.station.center,tip=[x+Math.sin(theta)*l/Math.cos(y*Math.PI/180),y+Math.cos(theta)*l];const coordinates=[[x,y],tip,[tip[0]-Math.sin(theta-.5)*l*.3,tip[1]-Math.cos(theta-.5)*l*.3],tip,[tip[0]-Math.sin(theta+.5)*l*.3,tip[1]-Math.cos(theta+.5)*l*.3]];arrows.push({type:'Feature',geometry:{type:'LineString',coordinates},properties:{}});}
 (m.getSource('wind') as GeoJSONSource).setData({type:'FeatureCollection',features:arrows});
 (m.getSource('official') as GeoJSONSource).setData(official&&data.official.comparable?data.official.features:empty);
 },[ready,data,index,metric,stations,wind,official]);
 useEffect(()=>{const m=map.current;if(!ready||!m||!m.getSource('selected'))return;(m.getSource('selected') as GeoJSONSource).setData(selected?{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[selected.ring]}}]}:empty);},[ready,selected]);
 useEffect(()=>{if(ready&&map.current&&selected&&focusKey)map.current.flyTo({center:selected.center,zoom:12.4,duration:window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:1000,essential:false});},[focusKey,ready]); // selection alone does not move the map after a map click
 return <div className="receptivity-map"><div ref={container} className="receptivity-canvas" aria-label="Map of Barcelona and surrounding vegetated land"/>{error&&<div className="r-map-error" role="status">{error}</div>}<div className="r-map-controls"><button aria-label="Zoom in" onClick={()=>map.current?.zoomIn()}><Plus size={17}/></button><button aria-label="Zoom out" onClick={()=>map.current?.zoomOut()}><Minus size={17}/></button><button aria-label="Show Barcelona region" onClick={()=>map.current?.flyTo({center:[2.11,41.43],zoom:10.35})}><LocateFixed size={18}/></button></div></div>;
}
