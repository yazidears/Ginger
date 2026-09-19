'use client';
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MapInstance } from 'maplibre-gl';
import type { FeatureCollection, Geometry, Feature } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Plus, Minus, LocateFixed, Layers3, Check, Mountain, Navigation, X } from 'lucide-react';

export type MapFeature = Feature<Geometry>;
export type MapData = { perimeter: MapFeature[]; envelopes: MapFeature[]; hotspots: MapFeature[]; assets: MapFeature[]; routes: MapFeature[]; risk: MapFeature[]; cameras: MapFeature[]; wind: MapFeature[] };
type Props = { data: MapData; focus: { center: [number, number]; zoom: number; key: number }; onSelect: (kind:string,id:string,coord:[number,number])=>void; mode: string; forecast: number; incidentActive:boolean };
const fc = (features: MapFeature[]): FeatureCollection => ({type:'FeatureCollection',features});
const layerNames: Record<keyof MapData,string> = { perimeter:'Observed perimeter',envelopes:'Scenario envelopes',hotspots:'Satellite hotspots',assets:'Values at risk',routes:'Modelled corridors',risk:'Ignition risk',cameras:'Detection cameras',wind:'Wind field' };
const empty = fc([]);
maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
export default function OperationalMap({data,focus,onSelect,mode,forecast,incidentActive}: Props) {
 const loadedMap=useRef<MapInstance|null>(null); const container=useRef<HTMLDivElement>(null); const map=useRef<MapInstance|null>(null); const select=useRef(onSelect); select.current=onSelect;
 const [ready,setReady]=useState(false),[failed,setFailed]=useState(false),[tilesFailed,setTilesFailed]=useState(false),[layersOpen,setLayersOpen]=useState(false),[satellite,setSatellite]=useState(true),[terrain,setTerrain]=useState(false);
 const [visible,setVisible]=useState<Record<keyof MapData,boolean>>({perimeter:true,envelopes:true,hotspots:true,assets:true,routes:true,risk:true,cameras:true,wind:false});
 useEffect(()=>{ if(!container.current)return; setReady(false); let m:MapInstance;
  try { m=new maplibregl.Map({container:container.current,center:[1.83,41.5],zoom:8.45,minZoom:5,maxZoom:17,attributionControl:false,style:{version:8,glyphs:'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',sources:{satellite:{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,attribution:'Imagery © Esri, Maxar, Earthstar Geographics'},dark:{type:'raster',tiles:['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],tileSize:256,attribution:'© OpenStreetMap contributors © CARTO'},labels:{type:'raster',tiles:['https://basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png'],tileSize:256}},layers:[{id:'base',type:'background',paint:{'background-color':'#131d21'}},{id:'satellite',type:'raster',source:'satellite',paint:{'raster-saturation':-.7,'raster-brightness-max':.57,'raster-contrast':.05}},{id:'dark',type:'raster',source:'dark',layout:{visibility:'none'}},{id:'labels',type:'raster',source:'labels',paint:{'raster-opacity':.8}}]}});map.current=m; }
  catch {setFailed(true);return;}
  m.addControl(new maplibregl.AttributionControl({compact:true}),'bottom-left');
  m.on('error',e=>{if(e.error?.message?.includes('tile') || (e as unknown as {sourceId?:string}).sourceId)setTilesFailed(true);});
  m.on('load',()=>{
   for(const key of Object.keys(layerNames)) m.addSource(key,{type:'geojson',data:empty});
   m.addLayer({id:'risk-fill',type:'fill',source:'risk',paint:{'fill-color':['get','color'],'fill-opacity':.12}});
   m.addLayer({id:'risk-line',type:'line',source:'risk',paint:{'line-color':['get','color'],'line-width':1,'line-opacity':.65,'line-dasharray':[4,3]}});
   m.addLayer({id:'envelopes-fill',type:'fill',source:'envelopes',paint:{'fill-color':['match',['get','level'],90,'#e9b95f',75,'#f59942','#ff703d'],'fill-opacity':.09}});
   m.addLayer({id:'envelopes-line',type:'line',source:'envelopes',paint:{'line-color':['match',['get','level'],90,'#e9b95f',75,'#f59942','#ff703d'],'line-width':1.4,'line-dasharray':[5,3],'line-opacity':.85}});
   m.addLayer({id:'perimeter-fill',type:'fill',source:'perimeter',paint:{'fill-color':'#ff582f','fill-opacity':.42}});
   m.addLayer({id:'perimeter-line',type:'line',source:'perimeter',paint:{'line-color':'#ff8c50','line-width':2.3}});
   m.addLayer({id:'routes-line',type:'line',source:'routes',paint:{'line-color':'#75c4bd','line-width':2,'line-dasharray':[2,2]}});
   m.addLayer({id:'wind-line',type:'line',source:'wind',paint:{'line-color':'#c4d8d9','line-width':1.4,'line-opacity':.45}});
   m.addLayer({id:'hotspots-glow',type:'circle',source:'hotspots',paint:{'circle-radius':12,'circle-color':'#ff6634','circle-opacity':.17,'circle-blur':.5}});
   m.addLayer({id:'hotspots-dot',type:'circle',source:'hotspots',paint:{'circle-radius':4,'circle-color':'#ffc789','circle-stroke-color':'#fc6636','circle-stroke-width':2}});
   m.addLayer({id:'assets-dot',type:'circle',source:'assets',paint:{'circle-radius':5,'circle-color':['match',['get','risk'],'CRITICAL','#fa7360','HIGH','#edbc6b','#95c9c0'],'circle-stroke-color':'#122025','circle-stroke-width':2}});
   m.addLayer({id:'cameras-dot',type:'circle',source:'cameras',paint:{'circle-radius':6,'circle-color':'#283b3e','circle-stroke-color':'#97c0b8','circle-stroke-width':1.5}});
   m.addLayer({id:'risk-label',type:'symbol',source:'risk',layout:{'text-field':['get','name'],'text-size':10,'text-font':['Noto Sans Regular'],'text-letter-spacing':.18,'text-allow-overlap':false},paint:{'text-color':'#cbbda2','text-halo-color':'#172123','text-halo-width':2}});
   m.addLayer({id:'assets-label',type:'symbol',source:'assets',minzoom:10,layout:{'text-field':['get','name'],'text-size':11,'text-font':['Noto Sans Regular'],'text-offset':[0,1.3],'text-anchor':'top'},paint:{'text-color':'#d5dcd9','text-halo-color':'#172123','text-halo-width':2}});
   for(const key of ['risk-fill','perimeter-fill','hotspots-dot','assets-dot','cameras-dot']) {m.on('mouseenter',key,()=>m.getCanvas().style.cursor='pointer');m.on('mouseleave',key,()=>m.getCanvas().style.cursor='');}
   m.on('click',e=>{const hits=m.queryRenderedFeatures(e.point,{layers:['assets-dot','cameras-dot','hotspots-dot','perimeter-fill','risk-fill']});const f=hits[0];select.current(f?.source||'point',String(f?.properties?.id||'garraf'),[e.lngLat.lng,e.lngLat.lat]);});
   loadedMap.current=m;setReady(true);
  });
  const observer=new ResizeObserver(()=>m.resize());observer.observe(container.current);
  return()=>{observer.disconnect();loadedMap.current=null;m.remove();map.current=null;};
 },[]);
 useEffect(()=>{if(!ready||!map.current||loadedMap.current!==map.current)return;for(const key of Object.keys(data) as (keyof MapData)[]) (map.current.getSource(key) as GeoJSONSource)?.setData(fc(data[key]));},[data,ready]);
 useEffect(()=>{if(!ready||!map.current||loadedMap.current!==map.current)return;map.current.flyTo({center:focus.center,zoom:focus.zoom,duration:1100,essential:false,padding:{left:80,right:50,top:40,bottom:40}});},[focus,ready]);
 useEffect(()=>{if(!ready||!map.current||loadedMap.current!==map.current)return;for(const l of map.current.getStyle()?.layers||[]) {const key=(l as {source?:keyof MapData}).source;if(key&&key in visible) map.current.setLayoutProperty(l.id,'visibility',visible[key]?'visible':'none');}},[visible,ready]);
 useEffect(()=>{if(!ready||!map.current||loadedMap.current!==map.current)return;map.current.setLayoutProperty('satellite','visibility',satellite?'visible':'none');map.current.setLayoutProperty('labels','visibility',satellite?'visible':'none');map.current.setLayoutProperty('dark','visibility',satellite?'none':'visible');},[satellite,ready]);
 useEffect(()=>{if(!ready||!map.current||loadedMap.current!==map.current)return;map.current.easeTo({pitch:terrain?45:0,duration:700});},[terrain,ready]);
 return <div className="map-wrapper"><div ref={container} className="map-canvas" aria-label="Interactive operational map of Catalonia"/>
  {!ready&&!failed&&<div className="map-loading"><span className="spinner"/> Acquiring geographic context…</div>}
  {(failed||tilesFailed)&&<div className="map-warning">{failed?'Map renderer unavailable. Incident data remains accessible.':'Basemap connection degraded · operational overlays retained'}</div>}
  <div className="map-grain"/>
  <div className="map-location"><span className="crosshair-small">+</span> {mode==='live'?'SATELLITE OBSERVATIONS':'CATALONIA, ES'} {mode!=='live'&&<span className="mono">41°18′ N · 1°51′ E</span>}</div>
  <div className="map-controls"><button title="Zoom in" aria-label="Zoom in" onClick={()=>map.current?.zoomIn()}><Plus size={17}/></button><button title="Zoom out" aria-label="Zoom out" onClick={()=>map.current?.zoomOut()}><Minus size={17}/></button><i/><button title="Recenter on Garraf" aria-label="Recenter on Garraf" onClick={()=>map.current?.flyTo({center:[1.86,41.30],zoom:11.3})}><LocateFixed size={17}/></button><button title="Tilt terrain view" aria-label="Tilt terrain view" aria-pressed={terrain} className={terrain?'selected':''} onClick={()=>setTerrain(!terrain)}><Mountain size={17}/></button><button title="Map layers" aria-label="Map layers" aria-expanded={layersOpen} className={layersOpen?'selected':''} onClick={()=>setLayersOpen(!layersOpen)}><Layers3 size={17}/></button></div>
  {layersOpen&&<div className="layer-menu panel"><div className="panel-heading">Map layers<button aria-label="Close layers" onClick={()=>setLayersOpen(false)}><X size={15}/></button></div><div className="segmented"><button className={satellite?'active':''} onClick={()=>setSatellite(true)}>Satellite</button><button className={!satellite?'active':''} onClick={()=>setSatellite(false)}>Dark map</button></div>{(Object.keys(layerNames) as (keyof MapData)[]).map(key=><button className="layer-row" key={key} onClick={()=>setVisible({...visible,[key]:!visible[key]})} aria-pressed={visible[key]}><span className={'checkbox '+(visible[key]?'checked':'')}>{visible[key]&&<Check size={11}/>}</span>{layerNames[key]}</button>)}<p>Scenario envelopes are illustrative, not calibrated probabilities.</p></div>}
  <div className="map-compass"><span>N</span><Navigation size={25} fill="currentColor"/><span className="compass-line"/></div>
  <div className="map-legend"><span><i className="legend-line orange"/> {mode==='live'?'Thermal detections':incidentActive?'Observed fire':'Ignition risk'}</span>{mode!=='live'&&<span><i className="legend-line dashed"/> +{forecast} min projection</span>}<span><i className="legend-dot"/> Asset</span><b>{mode.toUpperCase()} DATA</b></div>
 </div>;
}
