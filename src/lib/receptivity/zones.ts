import type {CellResult} from './types';
import {PRIORITY,type AreaPriority} from './priority';

export type ReviewZone={name:string;cell:CellResult;priority:AreaPriority;cells:number;attentionCells:number};
/** A named navigation group, not a municipality-wide risk classification. */
export function reviewZones(cells:CellResult[],priorities:Map<string,AreaPriority>):ReviewZone[]{
 const zones=new Map<string,ReviewZone>();
 for(const cell of cells){
  const priority=priorities.get(cell.id);if(!priority)continue;
  const name=cell.name.split(' · ')[0];
  const attention=['verify','review','watch'].includes(priority.level)?1:0;
  const previous=zones.get(name);
  if(!previous){zones.set(name,{name,cell,priority,cells:1,attentionCells:attention});continue;}
  previous.cells++;previous.attentionCells+=attention;
  const rank=PRIORITY[priority.level].order-PRIORITY[previous.priority.level].order;
  if(rank>0||rank===0&&cell.fuel.burnableFraction*cell.fuel.continuity>previous.cell.fuel.burnableFraction*previous.cell.fuel.continuity){previous.cell=cell;previous.priority=priority;}
 }
 return [...zones.values()].sort((a,b)=>PRIORITY[b.priority.level].order-PRIORITY[a.priority.level].order||b.attentionCells-a.attentionCells||Number(a.name.includes('°'))-Number(b.name.includes('°'))||a.name.localeCompare(b.name));
}
