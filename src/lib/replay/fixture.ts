import type {Polygon} from 'geojson';
import {cellPolygon,toLonLat} from '../sage/geometry';
import type {ReplayCase} from './types';

/** Independent analytic perimeters, not output from the evaluated fire solver. Not incident evidence. */
export function demonstrationCase():ReplayCase {
  const center:[number,number]=[1.83,41.73],size=48,cellM=25,origin='2026-09-18T10:00:00.000Z';
  const ellipse=(minute:number):Polygon=>{
    const angle=-12*Math.PI/180, a=24+minute*4.1,b=24+minute*.85,cx=-230+minute*2.6,cy=-65;
    const ring=Array.from({length:96},(_,i)=>{const t=i/96*Math.PI*2;return toLonLat([cx+a*Math.cos(t)*Math.cos(angle)-b*Math.sin(t)*Math.sin(angle),cy+a*Math.cos(t)*Math.sin(angle)+b*Math.sin(t)*Math.cos(angle)],center);});
    return {type:'Polygon',coordinates:[[...ring,ring[0]]]};
  };
  return {version:1,id:'synthetic-ridge-001',name:'A fire across the ridge',eventId:'synthetic-ridge',kind:'synthetic',split:'test',origin,
    provenance:{weatherKind:'synthetic',weatherSource:'Fixed synthetic weather; no live observations',weatherIssuedAt:origin,landscapeSource:'Constructed terrain and grass cover; no real incident',landscapeValidAt:origin},
    request:{lat:center[1],lon:center[0],horizonMinutes:120,ignitionRadiusM:25,deadMoisturePct:8,liveMoisturePct:90,windAdjustment:.35,mode:'scenario',confirmation:'',solarDrying:false,
      experiment:{parentId:'synthetic-origin',windOffset:0,windFactor:1,windShiftMinutes:0,ignitionOffset:[0,0],observation:{geometry:ellipse(0),observedAt:origin,source:'Synthetic analytic ignition'}}},
    landscape:{center,size,cellM,elevations:Array.from({length:size*size},(_,i)=>{const x=(i%size-size/2)*cellM,y=(Math.floor(i/size)-size/2)*cellM;return 130+28*Math.exp(-((x-110)**2/(240**2)+y*y/(500**2)))+8*Math.sin(y/180);}),
      buildings:{type:'FeatureCollection',features:[]},landcover:{type:'FeatureCollection',features:[{type:'Feature',geometry:cellPolygon(0,0,size*cellM/2,center),properties:{categoria:'Prats'}}]},
      weather:Array.from({length:4},(_,i)=>({time:new Date(Date.parse(origin)+i*3600000).toISOString(),temperatureC:31,humidityPct:22,windKmh:18,windFromDegrees:270,directNormalWm2:650,diffuseWm2:90,precipitationMm:0})),sources:[],warnings:['Synthetic terrain and observations. This exercise measures software behavior, not real incident accuracy.']},
    observations:[20,40,60,80,100,120].map(minute=>({at:new Date(Date.parse(origin)+minute*60000).toISOString(),availableAt:new Date(Date.parse(origin)+(minute+2)*60000).toISOString(),source:'Independent synthetic ellipse progression',uncertaintyM:12.5,geometry:ellipse(minute)}))};
}
