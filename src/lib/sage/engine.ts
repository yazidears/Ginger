import type {FeatureCollection,Polygon} from 'geojson';
import type {BuildingResult, IgnitionRecovery, Landscape, RunRequest, RunResult, XY} from './types';
import {area,bounds,cellCenter,cellPolygon,contains,distanceBetweenParts,distanceToParts,indexAt,intersectsCell,localPolygons,toLonLat} from './geometry';
import {cellSolar,createBehaviorModel,directionalRate,gradient,solarMoisture,sunPosition,shadowed,irradiance,type Behavior} from './physics';
import {structuralConnections} from './structural';
import {edgeIsOpen,travelStencil} from './propagation';
import {GINGER_O2} from './model';
import {GINGER_O2_GRASS,predictGingerO2Grass} from './ginger-o2-grass';
import {weatherAt} from './scenario-context';
export const MEMBERS=[
  {name:'Central',windFactor:1,windOffset:0,moistureOffset:0},
  {name:'Drier / stronger wind',windFactor:1.2,windOffset:0,moistureOffset:-2},
  {name:'Moister / lighter wind',windFactor:.8,windOffset:0,moistureOffset:2},
  {name:'Wind −20°',windFactor:1,windOffset:-20,moistureOffset:0},
  {name:'Wind +20°',windFactor:1,windOffset:20,moistureOffset:0},
  {name:'Wind speed +20%',windFactor:1.2,windOffset:0,moistureOffset:0},
  {name:'Wind speed −20%',windFactor:.8,windOffset:0,moistureOffset:0},
  {name:'Moisture −2 points',windFactor:1,windOffset:0,moistureOffset:-2},
  {name:'Moisture +2 points',windFactor:1,windOffset:0,moistureOffset:2}
];
// Transparent land-cover proxies, NOT a surveyed fuel classification.
export function fuelForCategory(category:string):number {
  const c=category.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/aigua|riu\b|llac|\bbassa\b|\bbasses\b|mar\b|platg|roqu|sol nu|urba|eixample|residencial|edific|vial|carreter|ferroviar|industr|esport|via |port/.test(c))return 0;
  if(/bosc|bosqu|forest/.test(c))return 9;
  if(/matoll|arbust|scrub/.test(c))return 6;
  if(/prat|herbass|pastur|grass|zones verdes/.test(c))return 1;
  if(/conreu|cultiu|vinya|vinyes|fruit|oliver|horta/.test(c))return 1;
  return -1;
}
export class IgnitionError extends Error {
  constructor(public recovery?: IgnitionRecovery) {
    super(recovery
      ? `No mapped vegetation can burn within this ignition area. Nearest available vegetation is ${recovery.distanceM} m away. Select it for a new scenario, or choose another fire origin. Vegetation-only mode excludes structural fires; choose Buildings + vegetation to model a structural scenario.`
      : 'The fire origin has no mapped burnable surface within the ignition area. Choose vegetation in another location. Vegetation-only mode excludes structural fires; choose Buildings + vegetation to model a structural scenario.');
  }
}
class Heap {
  values:{i:number;t:number}[]=[];
  push(v:{i:number;t:number}){let n=this.values.length;this.values.push(v);while(n){const p=(n-1)>>1;if(this.values[p].t<=v.t)break;this.values[n]=this.values[p];n=p;}this.values[n]=v;}
  pop(){const root=this.values[0],last=this.values.pop()!;if(this.values.length){let n=0;while(2*n+1<this.values.length){let c=2*n+1;if(c+1<this.values.length&&this.values[c+1].t<this.values[c].t)c++;if(this.values[c].t>=last.t)break;this.values[n]=this.values[c];n=c;}this.values[n]=last;}return root;}
}
function visitBounds(b:number[],size:number,cellM:number,fn:(i:number,p:XY)=>void){
  const x0=Math.max(0,Math.floor(b[0]/cellM+size/2)),x1=Math.min(size-1,Math.floor(b[2]/cellM+size/2));
  const y0=Math.max(0,Math.floor(b[1]/cellM+size/2)),y1=Math.min(size-1,Math.floor(b[3]/cellM+size/2));
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const i=y*size+x;fn(i,cellCenter(i,size,cellM));}
}
export function simulateLandscape(land:Landscape,request:RunRequest,id:string,onStage:(stage:string)=>void=()=>{},origin=new Date().toISOString(),options:{stencil?:'legacy8'|'ginger16';initialObservation?:{geometry:Polygon;observedAt:string;source:string}}={}):RunResult{
  // legacy8 is retained for reproducible numerical comparisons, not an API input.
  const stencil=options.stencil??'ginger16',neighbors=travelStencil(stencil);
  if(request.grassModel!==undefined&&request.grassModel!=='rothermel'&&request.grassModel!=='ginger-o2')throw Error('Invalid grass model');
  const grassModel=request.grassModel??'rothermel',learnedCells=new Set<number>(),fallbackCells=new Set<number>();
  const structural=request.structural;
  if(structural&&(!Number.isFinite(structural.maxGapM)||structural.maxGapM<0||structural.maxGapM>50||!Number.isFinite(structural.transferMinutes)||structural.transferMinutes<1||structural.transferMinutes>120))throw Error('Invalid structural scenario inputs');
  const started=Date.now(),{size,cellM,center,elevations}=land,total=size*size,half=size*cellM/2;
  if(!Number.isInteger(size)||size<2||!Number.isFinite(cellM)||cellM<=0||!center.every(Number.isFinite)||Math.abs(center[1])>=85)throw Error('Invalid bounded local simulation grid');
  if(!Number.isFinite(Date.parse(origin))||![60,120,240].includes(request.horizonMinutes)||![request.ignitionRadiusM,request.deadMoisturePct,request.liveMoisturePct,request.windAdjustment].every(Number.isFinite)||request.ignitionRadiusM<=0||request.deadMoisturePct<=0||request.liveMoisturePct<=0||request.windAdjustment<0)throw Error('Invalid simulation scenario inputs');
  if(land.weather.some(w=>![w.temperatureC,w.humidityPct,w.windKmh,w.windFromDegrees,w.precipitationMm].every(Number.isFinite)||w.humidityPct<0||w.humidityPct>100||w.windKmh<0||w.precipitationMm<0||[w.directNormalWm2,w.diffuseWm2].some(v=>v!==null&&(!Number.isFinite(v)||v<0))||!Number.isFinite(w.validForMinutes??60)||(w.validForMinutes??60)<=0))throw Error('Invalid weather forcing');
  if(request.solarDrying&&land.weather.some(w=>w.directNormalWm2===null||w.diffuseWm2===null))throw Error('Solar drying requires direct and diffuse radiation; disable it when radiation is unavailable.');
  if(elevations.length!==total||!elevations.every(Number.isFinite))throw Error('Complete terrain is required');
  const fuel=new Int16Array(total).fill(-1),surface=[...elevations],obstacles=new Uint8Array(total),mappedGrass=new Uint8Array(total);
  const slopes=Array.from({length:total},(_,i)=>gradient(i,elevations,size,cellM));
  onStage('Rasterizing real footprints, terrain and fuel proxies');
  for(const f of land.landcover.features){const parts=localPolygons(f.geometry,center),category=String(f.properties?.categoria||''),code=fuelForCategory(category);visitBounds(bounds(parts),size,cellM,(i,p)=>{if(contains(p,parts)){fuel[i]=code;mappedGrass[i]=code===1&&/prat|herbass|pastur|grass/i.test(category)?1:0;}});}
  const buildings=land.buildings.features.map(f=>{
    const parts=localPolygons(f.geometry,center),b=bounds(parts),height=typeof f.properties?.heightM==='number'&&Number.isFinite(f.properties.heightM)&&f.properties.heightM>0?f.properties.heightM:null;
    visitBounds(b,size,cellM,(i,p)=>{if(intersectsCell(parts,p[0],p[1],cellM/2)){obstacles[i]=1;if(height!==null)surface[i]=Math.max(surface[i],elevations[i]+height);}});
    const roofCells:number[]=[];visitBounds(b,size,cellM,(i,p)=>{if(intersectsCell(parts,p[0],p[1],cellM/2))roofCells.push(i);});
    const near:number[]=[];visitBounds([b[0]-100,b[1]-100,b[2]+100,b[3]+100],size,cellM,(i,p)=>{if(distanceToParts(p,parts)<=100)near.push(i);});
    return {feature:f,parts,b,height,near,roofCells};
  });
  const covered=fuel.filter(f=>f>=0).length;
  if(!structural&&covered/total<.5)throw Error('Less than half the simulation domain has classified land cover; choose another location');
  const experiment=request.experiment;
  const observation=experiment?.observation??options.initialObservation;
  const observed=observation?localPolygons(observation.geometry,center):null;
  const fuelBreak=experiment?.fuelBreak?localPolygons(experiment.fuelBreak,center):null;
  if([observed,fuelBreak].some(parts=>parts?.flat(2).some(p=>Math.abs(p[0])>half||Math.abs(p[1])>half)))throw Error('Imported polygon extends beyond this domain');
  if(fuelBreak)for(let i=0;i<total;i++)if(contains(cellCenter(i,size,cellM),fuelBreak))fuel[i]=0;
  const seeds:number[]=[];
  const ignition=experiment?.ignitionOffset??[0,0];
  let nearest:number|undefined,nearestDistance=Infinity;
  for(let i=0;i<total;i++){
    if(obstacles[i])fuel[i]=0;
    if(fuel[i]<=0)continue;
    const p=cellCenter(i,size,cellM),distance=Math.hypot(p[0]-ignition[0],p[1]-ignition[1]);
    if(distance<nearestDistance){nearest=i;nearestDistance=distance;}
    // Seed any fuel cell overlapped by the extent, including sub-cell ignitions.
    const dx=Math.max(0,Math.abs(p[0]-ignition[0])-cellM/2),dy=Math.max(0,Math.abs(p[1]-ignition[1])-cellM/2);
    if(observed?intersectsCell(observed,p[0],p[1],cellM/2):Math.hypot(dx,dy)<=request.ignitionRadiusM)seeds.push(i);
  }
  const structureSeeds:number[]=[];
  const structureEdges=structural?structuralConnections(buildings,structural.maxGapM,half):[];
  const structureCells:number[][]=buildings.map(()=>[]),cellStructures:number[][]=Array.from({length:total},()=>[]);
  if(structural)buildings.forEach(({parts,b,near},j)=>{
    // Do not route a structural chain through buildings outside the bounded domain.
    if(b[0]<-half||b[1]<-half||b[2]>half||b[3]>half)return;
    if(observed?distanceBetweenParts(parts,observed)<=1e-6:distanceToParts(ignition as XY,parts)<=request.ignitionRadiusM)structureSeeds.push(j);
    for(const i of near)if(fuel[i]>0&&distanceToParts(cellCenter(i,size,cellM),parts)<=structural.maxGapM){structureCells[j].push(i);cellStructures[i].push(j);}
  });
  if(!seeds.length&&!structureSeeds.length&&structural)throw Error('No mapped building or vegetation intersects the ignition area. Select a mapped footprint or vegetation; absent footprints cannot be simulated.');
  if(!seeds.length&&!structureSeeds.length)throw new IgnitionError(nearest===undefined||experiment?undefined:{position:toLonLat(cellCenter(nearest,size,cellM),center),distanceM:Math.ceil(nearestDistance)});
  const originMs=Date.parse(origin),baseWeather=land.weather.findIndex(w=>w===weatherAt(land.weather,originMs));
  if(baseWeather<0)throw Error('Weather does not cover the forecast origin');
  // Fixed 30-minute integration frames; wind/radiation uses the containing forecast hour.
  const frameCount=Math.ceil(request.horizonMinutes/30)+1;
  const frames=Array.from({length:frameCount},(_,k)=>{
    const t=originMs+k*30*60000,w=weatherAt(land.weather,t);
    if(!w)throw Error('Weather does not cover the requested horizon');
    const shifted=experiment && t>=Date.parse(experiment.windOrigin||origin)+experiment.windShiftMinutes*60000;
    return {weather:shifted?{...w,windKmh:w.windKmh*experiment.windFactor,windFromDegrees:(w.windFromDegrees+experiment.windOffset+360)%360}:w,sun:sunPosition(new Date(t).toISOString(),center)};
  });
  onStage('Tracing solar shadows and estimating fine-fuel drying');
  const radiation=frames.map(frame=>{const {directNormalWm2,diffuseWm2}=frame.weather;return directNormalWm2===null||diffuseWm2===null?null:Array.from({length:total},(_,i)=>cellSolar(i,elevations,surface,size,cellM,frame.sun,directNormalWm2,diffuseWm2));});
  const moisture:number[][]=[Array(total).fill(request.deadMoisturePct)];
  for(let k=1;k<frames.length;k++)moisture[k]=Array.from({length:total},(_,i)=>request.solarDrying?solarMoisture(moisture[k-1][i],frames[k-1].weather.temperatureC,frames[k-1].weather.humidityPct,radiation[k-1]![i].wm2,frames[k-1].weather.windKmh,.5):request.deadMoisturePct);
  const behavior=createBehaviorModel();
  const arrivals:Float64Array[]=[],intensities:Float64Array[]=[];
  for(const [memberIndex,member] of MEMBERS.entries()){
    onStage(`Simulating ${member.name.toLowerCase()} · ${memberIndex+1}/${MEMBERS.length}`);
    const cache=new Map<number,Behavior>();
    const getBehavior=(i:number,k:number)=>{
      const key=k*total+i;let b=cache.get(key);if(b)return b;
      const w=frames[k].weather;
      const deadMoisture=moisture[k][i]+member.moistureOffset,midflameWind=w.windKmh*member.windFactor*request.windAdjustment;
      b=behavior(String(fuel[i]),Math.max(1,deadMoisture),request.liveMoisturePct,midflameWind,w.windFromDegrees+member.windOffset,slopes[i]);
      if(grassModel==='ginger-o2'){
        // Training is for head ROS in flat Australian grass. Preserve the physical
        // direction/ellipse, gate terrain/cover/weather, never infer heat release.
        const learned=mappedGrass[i]&&Math.hypot(...slopes[i])<=.02&&w.precipitationMm===0
          ?predictGingerO2Grass({fuelCode:String(fuel[i]),midflameWindKmh:midflameWind,deadMoisturePct:deadMoisture}):null;
        if(learned){b={...b,headMMin:learned.headMMin};learnedCells.add(i);}else fallbackCells.add(i);
      }
      cache.set(key,b);return b;
    };
    const times=new Float64Array(total+(structural?buildings.length:0)).fill(Infinity),intensity=new Float64Array(total),heap=new Heap();
    seeds.forEach(i=>{times[i]=0;heap.push({i,t:0});});
    structureSeeds.forEach(j=>{times[total+j]=0;heap.push({i:total+j,t:0});});
    const transfer=(j:number,t:number)=>{const at=t+structural!.transferMinutes;if(at<=request.horizonMinutes&&at<times[j]){times[j]=at;heap.push({i:j,t:at});}};
    // Time-dependent, FIFO travel integration across the grid; no traversal through structures.
    while(heap.values.length){
      const {i,t}=heap.pop();if(t!==times[i]||t>request.horizonMinutes)continue;
      if(i>=total){const j=i-total;for(const target of structureEdges[j])transfer(total+target,t);for(const cell of structureCells[j])transfer(cell,t);continue;}
      if(structural)for(const target of cellStructures[i])transfer(total+target,t);
      const k=Math.min(frames.length-1,Math.floor(t/30));intensity[i]=getBehavior(i,k).intensityKwM;
      const x=i%size,y=Math.floor(i/size);
      for(const edge of neighbors){
        const {dx,dy}=edge;
        const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=size||ny>=size)continue;
        const j=ny*size+nx;if(fuel[j]<=0)continue;
        if(!edgeIsOpen(edge,x,y,size,fuel))continue;
        let remaining=edge.distance*cellM,at=t;
        const bearing=edge.bearing;
        while(remaining>1e-6&&at<request.horizonMinutes){
          const frame=Math.min(frames.length-1,Math.floor((at+1e-7)/30)),end=Math.min(request.horizonMinutes,(frame+1)*30);
          // Harmonic travel rate includes intermediate fuel/slope cells; no jumping barriers.
          let reciprocal=0;
          for(const segment of edge.segments){const cell=(y+segment.dy)*size+x+segment.dx,rate=directionalRate(getBehavior(cell,frame),bearing);if(rate<=0){reciprocal=Infinity;break;}reciprocal+=segment.fraction/rate;}
          const rate=Number.isFinite(reciprocal)&&reciprocal>0?1/reciprocal:0;
          const possible=rate*(end-at);
          if(possible>=remaining){at+=remaining/rate;remaining=0;}else{remaining-=possible;at=end;}
        }
        if(remaining<=1e-6&&at<times[j]){times[j]=at;heap.push({i:j,t:at});}
      }
    }
    arrivals.push(times);intensities.push(intensity);
  }
  onStage('Calculating exposure for each building footprint');
  const results:BuildingResult[]=buildings.map<BuildingResult>(({feature:f,parts,b,height,near,roofCells},buildingIndex)=>{
    const props=f.properties||{},pos:XY=[(b[0]+b[2])/2,(b[1]+b[3])/2],idx=indexAt(pos,size,cellM);
    const full=b[0]>=-half&&b[1]>=-half&&b[2]<=half&&b[3]<=half;
    const touching=near.filter(i=>distanceToParts(cellCenter(i,size,cellM),parts)<=cellM*Math.SQRT2);
    const memberTimes=arrivals.map(a=>{const min=Math.min(...touching.map(i=>a[i]),structural?a[total+buildingIndex]:Infinity);return Number.isFinite(min)?Math.round(min):null;});
    const reached=memberTimes.filter((t):t is number=>t!==null);
    // Point-source screening estimate for a single 25 m fireline element; head intensity upper bound.
    // No summation of asynchronous flames and no structural ignition inference.
    let radiant:number|null=null,radiantAt:number|null=null;
    for(const i of near){if(learnedCells.size||!Number.isFinite(arrivals[0][i]))continue;const distance=Math.max(cellM/2,distanceToParts(cellCenter(i,size,cellM),parts));
      const flux=.2*intensities[0][i]*cellM/(4*Math.PI*distance*distance);
      if(radiant===null||flux>radiant){radiant=flux;radiantAt=Math.round(arrivals[0][i]);}}
    const solarWeather=frames[0].weather;
    const roofSolar=height===null||solarWeather.directNormalWm2===null||solarWeather.diffuseWm2===null?[]:roofCells.map(i=>{const shade=shadowed(cellCenter(i,size,cellM),elevations[i]+height+.2,frames[0].sun.altitudeDegrees,frames[0].sun.azimuthDegrees,surface,size,cellM);return {shade,wm2:irradiance(solarWeather.directNormalWm2!,solarWeather.diffuseWm2!,frames[0].sun,[0,0],shade)};});
    const solar=roofSolar.length?{wm2:roofSolar.reduce((s,v)=>s+v.wm2,0)/roofSolar.length,shade:roofSolar.filter(v=>v.shade).length>roofSolar.length/2}:null;
    return {id:String(props.id),name:String(props.name),center:toLonLat(pos,center),areaM2:Math.round(area(parts)),widthM:Math.round(b[2]-b[0]),lengthM:Math.round(b[3]-b[1]),heightM:height,heightSource:String(props.heightSource),source:String(props.source),status:!full?'partial-coverage':structural&&arrivals.some(a=>Number.isFinite(a[total+buildingIndex]))?'structural-ignition':reached.length?'surface-exposure':'not-reached',...(structural?{structuralIgnitionByMember:arrivals.map(a=>Number.isFinite(a[total+buildingIndex])?Math.round(a[total+buildingIndex]):null)}:{}),arrivalMin:reached.length?Math.min(...reached):null,arrivalMax:reached.length?Math.max(...reached):null,membersReached:reached.length,arrivalByMember:memberTimes,radiantKwM2:radiant===null?null:Math.round(radiant*100)/100,radiantAtMinute:radiantAt,solarWm2:solar?Math.round(solar.wm2):null,shaded:solar?.shade??null,unknowns:['Roof and wall combustibility','Openings and ember ingress',...(structural?['Actual structure-to-structure ignition timing']:['Structure-to-structure ignition']),...(height===null?['Building height']:[])]};
  }).sort((a,b)=>(a.arrivalMin??Infinity)-(b.arrivalMin??Infinity)||a.id.localeCompare(b.id));
  const cells:FeatureCollection<Polygon>={type:'FeatureCollection',features:[]};
  let boundaryReached=false;
  for(let i=0;i<total;i++){
    const times=arrivals.map(a=>Number.isFinite(a[i])?Math.round(a[i]*10)/10:null),finite=times.filter((v):v is number=>v!==null);if(!finite.length)continue;
    if(i%size===0||i%size===size-1||i<size||i>=total-size)boundaryReached=true;
    const [x,y]=cellCenter(i,size,cellM);
    cells.features.push({type:'Feature',geometry:cellPolygon(x,y,cellM/2,center),properties:{arrivalMin:Math.min(...finite),arrivalCentral:times[0],arrivalByMember:times,members:finite.length}});
  }
  const warnings=[...land.warnings,'Experimental surface-fire model; results are not validated arrival times or ignition probabilities.',structural?'Structural spread is a hypothetical distance-and-delay network, not a validated combustion, radiation, ember or material-response model. All mapped buildings are assumed susceptible; actual resistance and suppression are unknown.':'Crown fire, firebrands, structural combustion and building-resolved CFD airflow are not simulated.','Building footprints block surface fuel; unknown materials must not be interpreted as fireproof.','Solar shadows use rasterized building heights and terrain within this domain; vegetation canopy and distant terrain shading are missing.',...(land.weather.some(w=>w.precipitationMm>0)?['Rain is forecast. Wetting/interception is not modelled; drying and spread results are less reliable.']:[]),...(boundaryReached?[`Fire reaches the ${size*cellM/1000} km domain boundary. Buildings outside it are not assessed.`]:[]),...(covered<total?[`${Math.round(100*(1-covered/total))}% of cells have unknown fuel class and stop modelled surface propagation.`]:[])];
  const byId=new Map(results.map(b=>[b.id,b]));
  return {id,engine:`${GINGER_O2.name} ${GINGER_O2.version} · ${stencil} · ${structural?'surface + assumed structural transfer':'Rothermel / BehavePlus (@cbevins 0.7.4)'}`,model:{...GINGER_O2,stencil,grassModel,learnedGrassCells:learnedCells.size,grassFallbackCells:fallbackCells.size,...(grassModel==='ginger-o2'?{grassArtifactId:GINGER_O2_GRASS.version}:{})},generatedAt:new Date().toISOString(),forecastOrigin:origin,request,runtimeMs:Date.now()-started,size,cellM,center,sources:land.sources,warnings,assumptions:[...(grassModel==='ginger-o2'?[`Experimental ${GINGER_O2_GRASS.version}: learned head spread in mapped grass only, slope at most 2%, no forecast rain, and within training wind/moisture bounds. Australian single-site internal evaluation; no independent Catalan validation. Rothermel direction and ellipse shape retained.`,`${learnedCells.size} cells used a learned calculation; ${fallbackCells.size} used a physics fallback in at least one member/time. Counts can overlap.`,...(learnedCells.size?['Radiant heat screening withheld: learned spread speed does not determine heat release.']:['No evaluated cells met the learned grass support gates; this run used the physical surface model.'])]:[]),...(structural?[`Structural scenario: transfer between footprints separated by at most ${structural.maxGapM} m after ${structural.transferMinutes} minutes per link. The same delay applies in both directions between buildings and nearby vegetation cell centres. These are operator assumptions, identical across sensitivity members, not measured ignition times.`,`Buildings intersecting the initial extent start burning at time zero. Only fully covered footprints participate in structural chains. Unknown material, glazing, fire walls, suppression and ember transport are not resolved.`]:[]),...(observed?[`Initial extent supplied by operator: ${observation!.source}; ${observation!.observedAt}. All burnable cells inside are initialized at time zero; residual burning is unknown.`]:[]),...(fuelBreak?['Hypothetical fuel removal only; no suppression effectiveness, ember crossing or crown-fire crossing model.']:[]),`Dead fuel moisture starts at ${request.deadMoisturePct}%; live fuel moisture ${request.liveMoisturePct}% (operator scenario inputs).`,`10 m wind × ${request.windAdjustment} for midflame wind; no resolved building airflow.`,`ICGC cover → Anderson: grass/crops 1, scrub 6, forest litter 9. Uncalibrated Catalan fuel proxies.`,`Initial burning ${structural?"buildings and vegetation":"vegetation"} within ${request.ignitionRadiusM} m of selected origin; not a measured perimeter.`,`${cellM} m grid, ${stencil==='ginger16'?16:8}-direction travel integration, 30-minute forcing updates. Grid direction and sub-cell geometry introduce error.`,`Nine deterministic sensitivity members; min/max are conditional on members that reach a building, not confidence intervals.`,request.solarDrying?'Solar drying: albedo 0.2, effective heat transfer 15 + 4√wind(m/s), 1 h time lag, Simard equilibrium moisture. Scenario approximation.':'Solar drying disabled; prescribed dead fuel moisture held constant.','Radiant flux is an unshielded point-source screening estimate from the strongest single cell, using a 0.2 radiant fraction. It is not a facade heat-transfer simulation.'],members:MEMBERS,buildings:results,footprints:{type:'FeatureCollection',features:land.buildings.features.map(f=>({...f,properties:{...f.properties,...byId.get(String(f.properties?.id)),structuralIgnitionCentral:byId.get(String(f.properties?.id))?.structuralIgnitionByMember?.[0]??null}}))},cells,domain:{type:'FeatureCollection',features:[{type:'Feature',geometry:cellPolygon(0,0,half,center),properties:{}}]},sun:frames[0].sun,weather:land.weather,stats:{buildingCount:results.length,knownHeights:results.filter(b=>b.heightM!==null).length,reached:results.filter(b=>b.membersReached>0).length,burnedHa:arrivals[0].slice(0,total).filter(Number.isFinite).length*cellM*cellM/10000,fuelCoveragePct:Math.round(covered/total*100),boundaryReached}};
}
