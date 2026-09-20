'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import * as maplibre from 'maplibre-gl';
import * as THREE from 'three';
import type {ForestTree,ForestMetric,ForestTile,ForestRun} from '@/lib/forest/types';
import {crownArrivalMinutes} from '@/lib/forest/arrival';
import {forestTileUrl} from '@/lib/forest/layers';
const EMPTY:GeoJSON.FeatureCollection={type:'FeatureCollection',features:[]};
export default function ForestMap({center,metric,opacity,trees,tiles,showTrees,mode,wind,run,minute,onMove,onSelect,onPoint}:{center:[number,number];metric:ForestMetric;opacity:number;trees:ForestTree[];tiles:ForestTile[];showTrees:boolean;mode:string;wind:{speed:number;from:number};run:ForestRun|null;minute:number;onMove:(bbox:number[],zoom:number)=>void;onSelect:(tree:ForestTree)=>void;onPoint:(point:[number,number])=>void}){
 const host=useRef<HTMLDivElement>(null),map=useRef<maplibre.Map|null>(null),cloud=useRef<THREE.Group|null>(null),anchor=useRef<maplibre.MercatorCoordinate|null>(null),windCloud=useRef<THREE.Group|null>(null),windAnchor=useRef<maplibre.MercatorCoordinate|null>(null);
 const crownsRef=useRef<THREE.InstancedMesh|null>(null);
 const arrivals=useMemo(()=>crownArrivalMinutes(trees,run?.result?.cells||EMPTY),[trees,run]);
 const callbacks=useRef({onMove,onSelect,onPoint});callbacks.current={onMove,onSelect,onPoint};
 const treeRef=useRef(trees);treeRef.current=trees;const modeRef=useRef(mode);modeRef.current=mode;
 const [ready,setReady]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  if(!host.current)return;
  maplibre.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
  const m=new maplibre.Map({container:host.current,center,zoom:13.5,pitch:52,bearing:-18,maxPitch:80,maxZoom:19,style:{version:8,sources:{imagery:{type:'raster',tiles:['https://geoserveis.icgc.cat/icc_mapesmultibase/noutm/wmts/orto/GRID3857/{z}/{x}/{y}.jpeg'],tileSize:256,attribution:'© ICGC · CC BY 4.0'},dem:{type:'raster-dem',tiles:['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],encoding:'terrarium',tileSize:256,maxzoom:15,attribution:'Terrain: Mapzen'},forest:{type:'raster',tiles:[forestTileUrl(metric)],tileSize:256,attribution:'ICGC forest variables · 2016–2017'}},layers:[{id:'background',type:'background',paint:{'background-color':'#1c2c28'}},{id:'imagery',type:'raster',source:'imagery',paint:{'raster-saturation':-.18,'raster-brightness-max':.85}},{id:'forest',type:'raster',source:'forest',paint:{'raster-opacity':opacity}}]}});
  map.current=m;m.addControl(new maplibre.NavigationControl({visualizePitch:true}),'bottom-right');m.addControl(new maplibre.ScaleControl(),'bottom-left');
  m.on('error',(event)=>{if(event.error?.message?.includes('fetch')||event.error?.message?.includes('AJAX'))setError('A map layer could not load. Check source availability.');});
  m.once('style.load',()=>{
   m.setTerrain({source:'dem',exaggeration:1});
   for(const id of ['coverage','tree-pick','ignition','spread','wind'])m.addSource(id,{type:'geojson',data:EMPTY});
   m.addLayer({id:'coverage',type:'line',source:'coverage',paint:{'line-color':['match',['get','state'],'completed','#8adeb8','running','#ffbc70','#a0afa4'],'line-opacity':.75,'line-width':1,'line-dasharray':[3,3]}});
   m.addLayer({id:'spread',type:'fill',source:'spread',paint:{'fill-color':['interpolate',['linear'],['get','fraction'],0,'#ffd17b',.5,'#f77939',1,'#b6263b'],'fill-opacity':.64},filter:['<=',['get','arrival'],0]});
   m.addLayer({id:'tree-pick',type:'circle',source:'tree-pick',minzoom:14,paint:{'circle-radius':8,'circle-opacity':0}});
   m.addLayer({id:'wind',type:'line',source:'wind',paint:{'line-color':'#bbf2ed','line-opacity':.8,'line-width':2}});
   m.addLayer({id:'ignition',type:'circle',source:'ignition',paint:{'circle-radius':8,'circle-color':'#ff7644','circle-stroke-color':'white','circle-stroke-width':2}});
   const scene=new THREE.Scene(),camera=new THREE.Camera(),group=new THREE.Group();cloud.current=group;scene.add(group);scene.add(new THREE.AmbientLight(0xffffff,2));const sun=new THREE.DirectionalLight(0xfff3d5,3);sun.position.set(-80,-60,200);scene.add(sun);
   let renderer:THREE.WebGLRenderer;
   m.addLayer({id:'individual-trees',type:'custom',renderingMode:'3d',onAdd(_map,gl){renderer=new THREE.WebGLRenderer({canvas:m.getCanvas(),context:gl as WebGL2RenderingContext,antialias:true});renderer.autoClear=false;},render(_gl,options){if(!anchor.current||!group.visible||!group.children.length)return;const a=anchor.current,s=a.meterInMercatorCoordinateUnits();camera.projectionMatrix=new THREE.Matrix4().fromArray(options.defaultProjectionData.mainMatrix).multiply(new THREE.Matrix4().makeTranslation(a.x,a.y,a.z).scale(new THREE.Vector3(s,-s,s)));renderer.resetState();renderer.render(scene,camera);},onRemove(){group.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(o.material as THREE.Material).dispose();}});renderer?.dispose();}});
   const windScene=new THREE.Scene(),windCamera=new THREE.Camera(),windGroup=new THREE.Group();windCloud.current=windGroup;windScene.add(windGroup);let windRenderer:THREE.WebGLRenderer;
   m.addLayer({id:'terrain-wind-3d',type:'custom',renderingMode:'3d',onAdd(_map,gl){windRenderer=new THREE.WebGLRenderer({canvas:m.getCanvas(),context:gl as WebGL2RenderingContext});windRenderer.autoClear=false;},render(_gl,options){const a=windAnchor.current;if(!a||!windGroup.visible||!windGroup.children.length)return;const scale=a.meterInMercatorCoordinateUnits();windCamera.projectionMatrix=new THREE.Matrix4().fromArray(options.defaultProjectionData.mainMatrix).multiply(new THREE.Matrix4().makeTranslation(a.x,a.y,a.z).scale(new THREE.Vector3(scale,-scale,scale)));windRenderer.resetState();windRenderer.render(windScene,windCamera);},onRemove(){windGroup.traverse(o=>{if(o instanceof THREE.LineSegments||o instanceof THREE.Points){o.geometry.dispose();(o.material as THREE.Material).dispose();}});windRenderer?.dispose();}});
   m.on('click',e=>{if(modeRef.current==='fire'){callbacks.current.onPoint([e.lngLat.lng,e.lngLat.lat]);return;}const f=m.queryRenderedFeatures(e.point,{layers:['tree-pick']})[0];const tree=f?treeRef.current.find(t=>t.id===f.properties.id):null;if(tree)callbacks.current.onSelect(tree);else callbacks.current.onPoint([e.lngLat.lng,e.lngLat.lat]);});
   setReady(true);const b=m.getBounds();callbacks.current.onMove([b.getWest(),b.getSouth(),b.getEast(),b.getNorth()],m.getZoom());
  });
  m.on('moveend',()=>{const b=m.getBounds();callbacks.current.onMove([b.getWest(),b.getSouth(),b.getEast(),b.getNorth()],m.getZoom());});
  return()=>{setReady(false);cloud.current=null;windCloud.current=null;map.current=null;m.remove();};
 // Map lifetime is separate from changing data.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 useEffect(()=>{if(ready)map.current?.flyTo({center,zoom:15,duration:900,essential:false});},[center,ready]);
 useEffect(()=>{const m=map.current;if(!ready||!m)return;(m.getSource('forest') as maplibre.RasterTileSource).setTiles([forestTileUrl(metric)]);setError('');},[metric,ready]);
 useEffect(()=>{if(ready)map.current?.setPaintProperty('forest','raster-opacity',mode==='forest'?opacity:opacity*.25);},[opacity,mode,ready]);
 useEffect(()=>{const m=map.current,g=cloud.current;if(!ready||!m||!g)return;g.visible=showTrees;crownsRef.current=null;for(const o of [...g.children]){g.remove(o);if(o instanceof THREE.Mesh){o.geometry.dispose();(o.material as THREE.Material).dispose();}}
  (m.getSource('tree-pick') as maplibre.GeoJSONSource).setData({type:'FeatureCollection',features:showTrees?trees.map(t=>({type:'Feature',properties:{id:t.id},geometry:{type:'Point',coordinates:[t.lon,t.lat]}})):[]});
  if(!trees.length||!showTrees){m.triggerRepaint();return;}
  const a=maplibre.MercatorCoordinate.fromLngLat([trees[0].lon,trees[0].lat]);anchor.current=a;const scale=a.meterInMercatorCoordinateUnits();
  // Shapes encode measured crown dimensions; they do not assert species or branch geometry.
  const geo=new THREE.SphereGeometry(1,7,5);geo.rotateX(Math.PI/2);
  const crowns=new THREE.InstancedMesh(geo,new THREE.MeshStandardMaterial({roughness:1,flatShading:true}),trees.length);
  const stems=new THREE.InstancedMesh(new THREE.CylinderGeometry(.12,.2,1,4).rotateX(Math.PI/2),new THREE.MeshStandardMaterial({color:'#8d7961',roughness:1}),trees.length);
  const dummy=new THREE.Object3D();trees.forEach((t,i)=>{const p=maplibre.MercatorCoordinate.fromLngLat([t.lon,t.lat]);const ground=m.queryTerrainElevation([t.lon,t.lat])??t.groundM;const x=(p.x-a.x)/scale,y=-(p.y-a.y)/scale;dummy.position.set(x,y,ground+t.heightM*.66);dummy.scale.set(t.crownRadiusM,t.crownRadiusM,t.heightM*.34);dummy.updateMatrix();crowns.setMatrixAt(i,dummy.matrix);crowns.setColorAt(i,new THREE.Color().setHSL(.30+(Math.min(t.heightM,30)/30)*.06,.26,.25+Math.min(t.heightM,30)/150));dummy.position.set(x,y,ground+t.heightM*.34);dummy.scale.set(1,1,t.heightM*.68);dummy.updateMatrix();stems.setMatrixAt(i,dummy.matrix);});
  crowns.instanceMatrix.needsUpdate=true;if(crowns.instanceColor)crowns.instanceColor.needsUpdate=true;stems.instanceMatrix.needsUpdate=true;g.add(stems,crowns);crownsRef.current=crowns;m.triggerRepaint();
 },[trees,showTrees,ready]);
 useEffect(()=>{const crowns=crownsRef.current;if(!crowns)return;trees.forEach((tree,i)=>{const reached=mode==='fire'&&arrivals[i]<=minute;crowns.setColorAt(i,reached?new THREE.Color(minute-arrivals[i]<5?'#e58c36':'#453832'):new THREE.Color().setHSL(.30+Math.min(tree.heightM,30)/30*.06,.26,.25+Math.min(tree.heightM,30)/150));});if(crowns.instanceColor)crowns.instanceColor.needsUpdate=true;map.current?.triggerRepaint();},[arrivals,minute,mode,trees,showTrees,ready]);
 useEffect(()=>{if(!ready||!map.current)return;(map.current.getSource('coverage') as maplibre.GeoJSONSource).setData({type:'FeatureCollection',features:tiles.map(t=>({type:'Feature',properties:{state:t.state},geometry:{type:'Polygon',coordinates:[[[t.bbox[0],t.bbox[1]],[t.bbox[2],t.bbox[1]],[t.bbox[2],t.bbox[3]],[t.bbox[0],t.bbox[3]],[t.bbox[0],t.bbox[1]]]]}}))});},[tiles,ready]);
 useEffect(()=>{if(!ready||!map.current)return;const m=map.current;(m.getSource('spread') as maplibre.GeoJSONSource).setData(run?.result?.cells||EMPTY);m.setFilter('spread',['<=',['get','arrival'],minute]);m.setLayoutProperty('spread','visibility',mode==='fire'?'visible':'none');},[run,minute,mode,ready]);
 useEffect(()=>{if(!ready||!map.current)return;const features:GeoJSON.Feature[]=[];if(mode==='weather'){const angle=(wind.from+180)*Math.PI/180;const dx=Math.sin(angle)*.0009,dy=Math.cos(angle)*.0007;for(let i=-6;i<=6;i++)for(let j=-6;j<=6;j++){const x=center[0]+i*.002,y=center[1]+j*.0015;features.push({type:'Feature',properties:{},geometry:{type:'MultiLineString',coordinates:[[[x-dx,y-dy],[x+dx,y+dy]],[[x+dx*.25-dy*.45,y+dy*.25+dx*.3],[x+dx,y+dy],[x+dx*.25+dy*.45,y+dy*.25-dx*.3]]]}});}}
 (map.current.getSource('wind') as maplibre.GeoJSONSource).setData({type:'FeatureCollection',features});(map.current.getSource('ignition') as maplibre.GeoJSONSource).setData(mode==='fire'?{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Point',coordinates:center}}]}:EMPTY);
 },[center,wind,mode,ready,run]);
 useEffect(()=>{const m=map.current,g=windCloud.current;if(!ready||!m||!g)return;
  const rebuild=()=>{for(const child of [...g.children]){g.remove(child);if(child instanceof THREE.LineSegments||child instanceof THREE.Points){child.geometry.dispose();(child.material as THREE.Material).dispose();}}const vectors=mode==='fire'?run?.result?.wind.vectors:undefined;if(!vectors?.length){m.triggerRepaint();return;}
   const a=maplibre.MercatorCoordinate.fromLngLat([vectors[0].lon,vectors[0].lat]);windAnchor.current=a;const scale=a.meterInMercatorCoordinateUnits(),positions:number[]=[],flows:Array<{x:number;y:number;z:number;dx:number;dy:number;speed:number}>=[];
   // Bound geometry to 800 measured model vectors; no synthetic interpolation or extra model job.
   const stride=Math.max(1,Math.ceil(vectors.length/800));for(let i=0;i<vectors.length;i+=stride){const v=vectors[i];if(![v.lon,v.lat,v.speedKmh,v.fromDegrees].every(Number.isFinite)||v.speedKmh<=0)continue;const ground=m.queryTerrainElevation([v.lon,v.lat]);if(ground===null)continue;const p=maplibre.MercatorCoordinate.fromLngLat([v.lon,v.lat]);const x=(p.x-a.x)/scale,y=-(p.y-a.y)/scale,z=ground+6.1,angle=(v.fromDegrees+180)*Math.PI/180,len=Math.min(80,Math.max(35,v.speedKmh*2.5)),dx=Math.sin(angle)*len,dy=Math.cos(angle)*len;
    flows.push({x,y,z,dx,dy,speed:v.speedKmh/3.6});positions.push(x-dx/2,y-dy/2,z,x+dx/2,y+dy/2,z,x+dx/2-dx*.3-dy*.18,y+dy/2-dy*.3+dx*.18,z,x+dx/2,y+dy/2,z,x+dx/2-dx*.3+dy*.18,y+dy/2-dy*.3-dx*.18,z,x+dx/2,y+dy/2,z);}
   const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.add(new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:'#43ffff',transparent:true,opacity:.95,depthTest:false,depthWrite:false})));const pointsGeometry=new THREE.BufferGeometry();pointsGeometry.setAttribute('position',new THREE.Float32BufferAttribute(flows.flatMap(flow=>[flow.x,flow.y,flow.z]),3));const points=new THREE.Points(pointsGeometry,new THREE.PointsMaterial({color:'#ffffff',size:7,sizeAttenuation:false,depthTest:false,depthWrite:false}));points.userData.flows=flows;g.add(points);m.triggerRepaint();};const terrainReady=(event:maplibre.MapSourceDataEvent)=>{if(event.sourceId==='dem'&&event.isSourceLoaded)rebuild();};rebuild();m.on('sourcedata',terrainReady);
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');const tick=()=>{if(document.hidden||reduced.matches)return;for(const child of g.children){if(!(child instanceof THREE.Points))continue;const flows=child.userData.flows as Array<{x:number;y:number;z:number;dx:number;dy:number;speed:number}>,attribute=child.geometry.getAttribute('position');const seconds=performance.now()/1000;flows.forEach((flow,i)=>{const fraction=(seconds*flow.speed/Math.hypot(flow.dx,flow.dy)+i*.37)%1-.5;attribute.setXYZ(i,flow.x+flow.dx*fraction,flow.y+flow.dy*fraction,flow.z);});attribute.needsUpdate=true;}if(g.children.length)m.triggerRepaint();};const timer=mode==='fire'&&run?.result?.wind.vectors?.length?window.setInterval(tick,50):null;tick();return()=>{m.off('sourcedata',terrainReady);if(timer!==null)window.clearInterval(timer);};
 },[ready,mode,run]);
 return <div className="forest-map"><div ref={host} style={{position:"absolute",inset:0}}/>{error&&<div className="forest-map-error" role="status">{error}</div>}</div>;
}
