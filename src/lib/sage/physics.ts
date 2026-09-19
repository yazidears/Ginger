import {Sim} from '@cbevins/fire-behavior-simulator';
import SunCalc from 'suncalc';
import type {XY} from './types';
import {cellCenter,indexAt} from './geometry';
export function sunPosition(time:string,center:XY){
  const p=SunCalc.getPosition(new Date(time),center[1],center[0]);
  return {altitudeDegrees:p.altitude*180/Math.PI,azimuthDegrees:(p.azimuth*180/Math.PI+180+360)%360};
}
export function gradient(i:number,elevations:number[],size:number,cell:number):XY {
  const x=i%size,y=Math.floor(i/size),l=y*size+Math.max(0,x-1),r=y*size+Math.min(size-1,x+1),b=Math.max(0,y-1)*size+x,t=Math.min(size-1,y+1)*size+x;
  return [(elevations[r]-elevations[l])/((x===0||x===size-1?1:2)*cell),(elevations[t]-elevations[b])/((y===0||y===size-1?1:2)*cell)];
}
export function shadowed(p:XY,elevation:number,altitude:number,azimuth:number,surface:number[],size:number,cell:number){
  if(altitude<=0)return true;
  const a=azimuth*Math.PI/180,tan=Math.tan(altitude*Math.PI/180),step=cell/2;
  for(let d=step;d<size*cell;d+=step){
    const idx=indexAt([p[0]+Math.sin(a)*d,p[1]+Math.cos(a)*d],size,cell);
    if(idx<0)break;if(surface[idx]>elevation+tan*d+.15)return true;
  }return false;
}
export function irradiance(direct:number,diffuse:number,sun:ReturnType<typeof sunPosition>,slope:XY,shade:boolean){
  if(sun.altitudeDegrees<=0)return 0;
  const a=sun.altitudeDegrees*Math.PI/180,z=sun.azimuthDegrees*Math.PI/180;
  const n=Math.hypot(slope[0],slope[1],1);
  const cos=Math.max(0,(-slope[0]*Math.sin(z)*Math.cos(a)-slope[1]*Math.cos(z)*Math.cos(a)+Math.sin(a))/n);
  return (shade?0:direct*cos)+diffuse*(1+1/n)/2;
}
// Simard relation coefficients use Fahrenheit; public input is Celsius, RH percent.
// USDA PNW-GTR-926, equations 38-40: https://www.fs.usda.gov/pnw/pubs/pnw_gtr926.pdf
// This estimates dead fuel equilibrium, not measured moisture or live fuel moisture.
export function equilibriumMoisture(temperatureC:number,rh:number){
  const temperatureF=temperatureC*9/5+32;
  rh=Math.max(0,Math.min(100,rh));
  if(rh<10)return .03229+.281073*rh-.000578*rh*temperatureF;
  if(rh<50)return 2.22749+.160107*rh-.01478*temperatureF;
  return 21.0606+.005565*rh*rh-.00035*rh*temperatureF-.483199*rh;
}
export function solarMoisture(previousPct:number,temperatureC:number,humidityPct:number,solarWm2:number,windKmh:number,elapsedHours:number){
  // Quasi-steady absorbed shortwave / effective heat transfer, albedo 0.2.
  // Fixed coefficients are scenario assumptions, not a material-specific energy balance.
  const delta=Math.min(30,.8*solarWm2/(15+4*Math.sqrt(Math.max(0,windKmh)/3.6)));
  const sat=(t:number)=>Math.exp(17.625*t/(243.04+t));
  const surfaceRh=Math.min(100,humidityPct*sat(temperatureC)/sat(temperatureC+delta));
  const target=equilibriumMoisture(temperatureC+delta,surfaceRh);
  return Math.max(1,Math.min(60,target+(previousPct-target)*Math.exp(-elapsedHours)));
}
export type Behavior={headMMin:number;headingDegrees:number;eccentricity:number;intensityKwM:number;flameM:number};
export function createBehaviorModel(){
  const dag=new Sim().createDag('sage-rothermel');
  dag.configure([
    ['configure.fuel.primary','catalog'],['configure.fuel.secondary','none'],['configure.fuel.moisture','category'],
    ['configure.fuel.curedHerbFraction','estimated'],['configure.wind.speed','atMidflame'],
    ['configure.wind.direction','sourceFromNorth'],['configure.slope.steepness','ratio'],['configure.fire.effectiveWindSpeedLimit','applied']
  ]);
  const prefix='surface.weighted.fire.';
  dag.select(['spreadRate','heading.fromNorth','lengthToWidthRatio','firelineIntensity','flameLength'].map(k=>prefix+k));
  return (fuel:string,deadPct:number,livePct:number,midflameKmh:number,windFrom:number,slope:XY):Behavior=>{
    dag.input([
      ['surface.primary.fuel.model.catalogKey',[fuel]],['site.moisture.dead.category',[deadPct/100]],
      ['site.moisture.live.category',[livePct/100]],['site.wind.speed.atMidflame',[midflameKmh*1000/60/.3048]],
      ['site.wind.direction.source.fromNorth',[((windFrom%360)+360)%360]],
      ['site.slope.steepness.ratio',[Math.hypot(...slope)]],
      ['site.slope.direction.aspect',[(Math.atan2(-slope[0],-slope[1])*180/Math.PI+360)%360]]
    ]).run();
    const get=(key:string)=>dag.node(prefix+key).value();const lwr=Math.max(1,get('lengthToWidthRatio'));
    const result={headMMin:get('spreadRate')*.3048,headingDegrees:get('heading.fromNorth'),eccentricity:Math.sqrt(1-1/(lwr*lwr)),intensityKwM:get('firelineIntensity')*1.05505585262/.3048,flameM:get('flameLength')*.3048};
    if(!Object.values(result).every(Number.isFinite)||result.headMMin<0)throw Error('Fire-behaviour solver returned invalid values');
    return result;
  };
}
export function directionalRate(b:Behavior,bearingDegrees:number){return b.headMMin*(1-b.eccentricity)/(1-b.eccentricity*Math.cos((bearingDegrees-b.headingDegrees)*Math.PI/180));}
export function cellSolar(i:number,elevations:number[],surface:number[],size:number,cell:number,sun:ReturnType<typeof sunPosition>,direct:number,diffuse:number){
  const p=cellCenter(i,size,cell),shade=shadowed(p,surface[i]+.2,sun.altitudeDegrees,sun.azimuthDegrees,surface,size,cell);
  return {shade,wm2:irradiance(direct,diffuse,sun,gradient(i,elevations,size,cell),shade)};
}
