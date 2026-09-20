import type {RunResult} from './types';
export function growthSummary(run:RunResult){
  const cells=run.cells.features;
  const initial=cells.filter(cell=>cell.properties?.arrivalCentral===0).length;
  const additional=cells.filter(cell=>typeof cell.properties?.arrivalCentral==='number'&&cell.properties.arrivalCentral>0&&cell.properties.arrivalCentral<=run.request.horizonMinutes).length;
  const sensitivityAdditional=cells.filter(cell=>typeof cell.properties?.arrivalMin==='number'&&cell.properties.arrivalMin>0&&cell.properties.arrivalMin<=run.request.horizonMinutes).length;
  return {initial,additional,sensitivityAdditional,noAdditionalCentralCells:initial>0&&additional===0};
}
