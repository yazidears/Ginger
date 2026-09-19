import type {FeatureCollection,Point,Geometry} from 'geojson';
export type Provenance={source:string;observedAt:string;retrievedAt:string;mode:'live'|'demo';confidence?:number};
export type Hotspot={raw?:Record<string,string|number|null>;id:string;position:[number,number];clusterId:string|null;frpMw:number|null;confidence:string;provenance:Provenance};
export type FireCluster={id:string;position:[number,number];firstObserved:string;lastObserved:string;active:boolean};
export type ProviderResult<T>={data:T;status:'live'|'demo'|'unavailable'|'stale';detail:string;updatedAt:string};
export interface FireDetectionProvider{hotspots():Promise<ProviderResult<Hotspot[]>>;clusters():Promise<ProviderResult<FireCluster[]>>;}
export interface WeatherProvider{current(lat:number,lon:number):Promise<ProviderResult<{temperature:number;humidity:number;windKmh:number;windDirection:number}>>;}
export type SatelliteObservation={id:string;observedAt:string;position:[number,number];frpMw:number;confidence?:number};
export interface SatelliteProvider{observations():Promise<ProviderResult<SatelliteObservation[]>>;}
export interface InfrastructureProvider{assets():Promise<ProviderResult<FeatureCollection>>;}
export type SpreadInput={ignition:[number,number];windKmh:number;windDirection:number;humidity:number;moisture:number;forecastMinutes:number;terrainPath?:string;fuelsPath?:string};
export interface FireSpreadProvider{forecast(input:SpreadInput):Promise<ProviderResult<{perimeters:FeatureCollection;engine:string}>>;}
export type DetectionInput={cameraId:string;observedAt:string;ambientC:number;baselineC:number;hotspotC:number;previousHotspotC:number;minutesElapsed:number;smokeConfidence:number;solarHeatingExpectedC:number};
export type Detection={cameraId:string;observedAt:string;smokeConfidence:number;thermalConfidence:number;combined:number;priority:'HIGH'|'WATCH'|'LOW';deltaC:number;growthC:number;health:string;hazards:{label:string;inspectionOnly:true;confidence:number}[]};
export interface CameraInferenceProvider{inspect(input:DetectionInput):Promise<ProviderResult<Detection>>;}
