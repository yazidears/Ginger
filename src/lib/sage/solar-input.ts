import type {ScenarioContext} from '../product-contracts';
import type {RunRequest} from './types';
/** Missing radiation is unknown, not a valid zero; zero itself is valid night-time forcing. */
export function capturedSolarAvailable(context?:ScenarioContext|null){
  return Boolean(context?.inputs.weather.length&&context.inputs.weather.every(frame=>Number.isFinite(frame.directNormalWm2)&&Number.isFinite(frame.diffuseWm2)));
}
export function normalizeSolarInput(request:RunRequest,context?:ScenarioContext|null):RunRequest{
  return {...request,solarDrying:request.solarDrying===true&&(!context||capturedSolarAvailable(context))};
}
