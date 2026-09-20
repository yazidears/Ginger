import type {CellResult} from './types';

/** One representative cell per independent weather input, never repeated station values presented as independent hotspots. */
export function rankWeatherAreas(cells:CellResult[], index:number, emerging=false):CellResult[]{
 const representatives=new Map<string,CellResult>();
 for(const c of cells){
  if(!c.stationId||c.receptivity[index]===null||(emerging&&(c.velocity===null||c.velocity<=0)))continue;
  const previous=representatives.get(c.stationId);
  if(!previous||c.stationDistanceKm<previous.stationDistanceKm||c.stationDistanceKm===previous.stationDistanceKm&&c.fuel.burnableFraction>previous.fuel.burnableFraction)representatives.set(c.stationId,c);
 }
 return [...representatives.values()].sort((a,b)=>emerging?(b.velocity??0)-(a.velocity??0)||a.stationId.localeCompare(b.stationId):b.receptivity[index]!-a.receptivity[index]!||a.stationId.localeCompare(b.stationId));
}
export function weatherCoverage(cells:CellResult[],index:number){
 const stationCells=new Map<string,number>();let min=Infinity,max=-Infinity;
 for(const c of cells){const score=c.receptivity[index];if(score===null)continue;min=Math.min(min,score);max=Math.max(max,score);stationCells.set(c.stationId,(stationCells.get(c.stationId)||0)+1);}
 return {min:Number.isFinite(min)?min:null,max:Number.isFinite(max)?max:null,stationCells};
}
