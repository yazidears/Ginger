import type {Weather, Assessment, Horizon, CellResult, StationResult} from './types';
export const MODEL_VERSION='sage-receptivity-1.1-evidence';
const C=147.27723;
export const clamp=(x:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,x));
export const round=(x:number,n=1)=>Number(x.toFixed(n));
export function moistureFromFFMC(ffmc:number){return C*(101-ffmc)/(59.5+ffmc);}
/** Van Wagner hourly/subhourly FFMC; no daily 0.5 mm interception threshold.
 * Equations: Van Wagner 1977 PS-X-69; Van Wagner & Pickett 1985 FTR-33.
 * t <= 1 h, screen T/RH, 10 m wind in km/h, rain over this interval in mm.
 */
export function hourlyFFMC(previous:number,w:Pick<Weather,'temperature'|'relativeHumidity'|'windSpeed'|'precipitation'|'stepHours'>){
 const {temperature:t,relativeHumidity:rh,windSpeed:wind,precipitation:rain,stepHours:dt}=w;
 if(![previous,t,rh,wind,rain,dt].every(Number.isFinite)||previous<0||previous>101||rh<0||rh>100||wind<0||rain<0||dt<=0||dt>1||t < -60||t>60)throw Error('Invalid hourly FFMC input');
 let m=moistureFromFFMC(previous);
 if(rain>0){const initial=m;m+=42.5*rain*Math.exp(-100/(251-initial))*(1-Math.exp(-6.93/rain));if(initial>150)m+=.0015*(initial-150)**2*Math.sqrt(rain);m=Math.min(250,m);}
 const ed=.942*rh**.679+11*Math.exp((rh-100)/10)+.18*(21.1-t)*(1-Math.exp(-.115*rh));
 const ew=.618*rh**.753+10*Math.exp((rh-100)/10)+.18*(21.1-t)*(1-Math.exp(-.115*rh));
 if(m>ed){const k=(.424*(1-(rh/100)**1.7)+.0694*Math.sqrt(wind)*(1-(rh/100)**8))*.0579*Math.exp(.0365*t);m=ed+(m-ed)*10**(-k*dt);}
 else if(m<ew){const k=(.424*(1-((100-rh)/100)**1.7)+.0694*Math.sqrt(wind)*(1-((100-rh)/100)**8))*.0579*Math.exp(.0365*t);m=ew-(ew-m)*10**(-k*dt);}
 return clamp(59.5*(250-m)/(C+m),0,101);
}
/** Standard FWI-system ISI, not rate of spread. */
export function initialSpreadIndex(ffmc:number,windKmh:number){const m=moistureFromFFMC(ffmc);return .208*Math.exp(.05039*windKmh)*91.9*Math.exp(-.1386*m)*(1+m**5.31/49300000);}
/** Transparent display scale only: FFMC 60–100 mapped linearly to 0–100.
 * This preserves the established moisture-code order without fitted weights.
 * Labels are GINGER display bands, not official Catalan danger classes.
 */
export const receptivityScore=(ffmc:number)=>Math.round(clamp((ffmc-60)/40*100,0,100));
/** Bounded monotonic display of ISI; 20 is a UI reference, not a threshold validated in Catalonia. */
export const spreadScore=(isi:number)=>Math.round(clamp(100*isi/(isi+20),0,100));
export const classify=(score:number)=>score>=90?'extreme':score>=80?'very_high':score>=65?'high':score>=40?'moderate':'low';
export const classificationLabel=(score:number)=>classify(score).replace('_',' ').toUpperCase();
export function frame(ffmc:number,w:Weather,horizon:Horizon):Assessment {const isi=initialSpreadIndex(ffmc,w.windSpeed),score=receptivityScore(ffmc);return {horizon,timestamp:w.time,fireReceptivity:score,spreadPotential:spreadScore(isi),classification:classify(score),ffmc:round(ffmc,2),fineFuelMoisture:round(moistureFromFFMC(ffmc),2),isi:round(isi,2),conditions:w,velocity:null};}
export function explainCell(cell:CellResult,station:StationResult,horizon:Horizon){
 const f=station.frames.find(x=>x.horizon===horizon);if(!f)return ['Weather coverage is insufficient for this time. No score has been inferred.'];
 const lines=[`Estimated dead fine-fuel moisture is ${f.fineFuelMoisture.toFixed(1)}% of dry mass (FFMC ${f.ffmc.toFixed(1)}). ${f.fineFuelMoisture<10?'Fine fuels are very dry.':f.fineFuelMoisture<16?'Fine fuels are dry.':'Moisture is limiting fine-fuel receptivity.'}`,
 `${horizon?'Forecast':'Observed'} temperature is ${f.conditions.temperature.toFixed(1)}°C with ${Math.round(f.conditions.relativeHumidity)}% relative humidity. These conditions drive the FFMC drying and wetting calculation.`];
 if(station.history.rain7d!==undefined)lines.push(`The nearby station recorded ${station.history.rain7d.toFixed(1)} mm in the seven days ending at the latest observation. Rain is carried through the moisture model; it is not counted again as an arbitrary score bonus.`);
 lines.push(`${Math.round(cell.fuel.burnableFraction*100)}% of this 200 m cell is mapped burnable vegetation, predominantly ${cell.fuel.type.toLowerCase()}. The score is conditional on a source contacting this fuel, not on bare or built surfaces.`);
 if(cell.fuel.ndmi!==undefined)lines.push(`Satellite NDMI is ${cell.fuel.ndmi.toFixed(2)} (${cell.fuel.satelliteAt?.slice(0,10)}). It is a spectral moisture indicator, not a measured live-fuel moisture percentage; it is contextual and does not modify FFMC.`);
 lines.push(`Spread uses ISI ${f.isi.toFixed(1)}, including ${f.conditions.windSpeed.toFixed(1)} km/h sustained wind. ${cell.terrain.slope!==undefined?`Terrain slope is ${cell.terrain.slope}°; terrain and mapped continuity are context, not calibrated spread multipliers.`:'Terrain is unavailable.'}`);
 if(horizon){const now=station.frames.find(x=>x.horizon===0)!;lines.push(`Receptivity changes ${f.fireReceptivity-now.fireReceptivity>=0?'+':''}${f.fireReceptivity-now.fireReceptivity} points by ${new Date(f.timestamp).toLocaleTimeString('en-GB',{timeZone:'Europe/Madrid',hour:'2-digit',minute:'2-digit'})}, based on forecast weather. This describes environmental change.`);}
 lines.push(`Weather is transferred from ${station.station.name}, ${cell.stationDistanceKm.toFixed(1)} km away. A 200 m map cell does not imply 200 m weather accuracy.`);
 if(cell.evidence)lines.push(...cell.evidence.reasons);
 return lines;
}
