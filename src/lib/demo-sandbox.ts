import type {RunRequest} from './sage/types';
import {validateRunRequest} from './sage/validation';

/** The same request contract and validation as POST /api/sage/runs.
 * Moving an ignition starts a fresh scenario at the clicked location while
 * preserving the user's actual model settings. No toy propagation is used. */
export function demoIgnitionRequest(settings:RunRequest,longitude:number,latitude:number):RunRequest {
  return validateRunRequest({...settings,lon:longitude,lat:latitude,mode:'scenario',confirmation:'',experiment:undefined});
}
