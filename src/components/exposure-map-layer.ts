'use client';
import {useEffect} from 'react';
import * as maplibre from 'maplibre-gl';
import type {GeoJSONSource,Map as MapInstance} from 'maplibre-gl';
import type {FeatureCollection} from 'geojson';
import {exposureCategories,type ExposureCategory,type ExposureDataset} from '@/lib/exposure/types';
const empty:FeatureCollection={type:'FeatureCollection',features:[]};
export const exposureLayerIds=['regional-exposure-point','regional-exposure-line','regional-exposure-fill'];
export function useExposureMap(map:MapInstance|null,ready:boolean,categories:ExposureCategory[],onStatus:(status:string)=>void){
 useEffect(()=>{
  if(!map||!ready||!map.getSource('cells'))return;
  if(!map.getSource('regional-exposure')){
   map.addSource('regional-exposure',{type:'geojson',data:empty,attribution:'© OpenStreetMap contributors / Geofabrik · ODbL'});
   const color:maplibre.ExpressionSpecification=['match',['get','category'],'school',exposureCategories.school.color,'healthcare',exposureCategories.healthcare.color,'complex',exposureCategories.complex.color,'road',exposureCategories.road.color,'gathering',exposureCategories.gathering.color,'#ffffff'];
   map.addLayer({id:'regional-exposure-fill',type:'fill',source:'regional-exposure',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':color,'fill-opacity':.14}});
   map.addLayer({id:'regional-exposure-line',type:'line',source:'regional-exposure',filter:['!=',['geometry-type'],'Point'],paint:{'line-color':color,'line-width':1.5,'line-opacity':.8}});
   map.addLayer({id:'regional-exposure-point',type:'circle',source:'regional-exposure',filter:['==',['geometry-type'],'Point'],paint:{'circle-color':color,'circle-radius':5,'circle-stroke-width':1.5,'circle-stroke-color':'#152422'}});
  }
  let controller:AbortController|undefined,timer:ReturnType<typeof setTimeout>|undefined,popup:maplibre.Popup|undefined;
  const refresh=async()=>{
   controller?.abort();controller=new AbortController();const current=controller;
   if(!categories.length){(map.getSource('regional-exposure') as GeoJSONSource).setData(empty);onStatus('Exposure layers hidden.');return;}
   const b=map.getBounds(),bbox=[Math.max(-180,b.getWest()),Math.max(-85,b.getSouth()),Math.min(180,b.getEast()),Math.min(85,b.getNorth())];
   try{
    const r=await fetch(`/api/exposure?bbox=${bbox.join(',')}&categories=${categories.join(',')}`,{signal:current.signal});if(!r.ok)throw Error();
    const data=await r.json() as ExposureDataset&{total:number;truncated:boolean;status:string};if(current.signal.aborted)return;
    await (map.getSource('regional-exposure') as GeoJSONSource).setData(data);if(current.signal.aborted)return;
    onStatus(`${data.features.length.toLocaleString()} mapped features · ${data.status} · OSM ${data.metadata.sourceDate.slice(0,10)}${data.truncated?' · Zoom in for more.':''}`);
   }catch{if(!current.signal.aborted){(map.getSource('regional-exposure') as GeoJSONSource).setData(empty);onStatus('Catalonia inventory unavailable. Blank does not mean no assets.');}}
  };
  const moved=()=>{controller?.abort();clearTimeout(timer);timer=setTimeout(()=>void refresh(),250);};
  const clicked=(e:maplibre.MapMouseEvent)=>{
   const f=map.queryRenderedFeatures(e.point,{layers:exposureLayerIds})[0];if(!f)return;
   const p=f.properties||{},content=document.createElement('div');
   const name=document.createElement('strong');name.textContent=String(p.name);content.append(name);
   for(const text of [exposureCategories[p.category as ExposureCategory]?.label||'Mapped place',`Type: ${p.kind}`, 'Occupancy and footfall: unknown', 'OpenStreetMap / Geofabrik']){const row=document.createElement('p');row.textContent=text;content.append(row);}
   if(/^(node|way|relation)\/\d+$/.test(String(p.id))){const link=document.createElement('a');link.href=`https://www.openstreetmap.org/${p.id}`;link.target='_blank';link.rel='noreferrer';link.textContent='View mapped record ↗';content.append(link);}
   popup?.remove();popup=new maplibre.Popup({className:'receptivity-popup',maxWidth:'280px'}).setLngLat(e.lngLat).setDOMContent(content).addTo(map);
  };
  void refresh();map.on('moveend',moved);map.on('click',clicked);
  return()=>{controller?.abort();clearTimeout(timer);popup?.remove();map.off('moveend',moved);map.off('click',clicked);};
 },[map,ready,categories,onStatus]);
}
