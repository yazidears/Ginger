import type {FeatureCollection} from 'geojson';
import {DeepfireProvider, deepfireConfigured, type Bounds} from './deepfire';
import type {FireCluster} from './types';

export type DeepfireContext = {
  configured: boolean; bounds: Bounds;
  clusters: FireCluster[]; perimeters: FeatureCollection; staticHeatSources: FeatureCollection;
  sources: {source: string; status: 'live'|'unavailable'|'stale'; retrievedAt: string; detail: string; coverage: string}[];
};
/** Independent collection health: failed layers never become a successful empty result. */
export async function readDeepfireContext(bounds: Bounds): Promise<DeepfireContext> {
  const empty = (): FeatureCollection => ({type:'FeatureCollection',features:[]});
  const context: DeepfireContext = {configured:deepfireConfigured(),bounds,clusters:[],perimeters:empty(),staticHeatSources:empty(),sources:[]};
  const provider = new DeepfireProvider();
  const jobs = [
    {key:'clusters' as const, name:'Deepfire candidate clusters', load:()=>provider.clusters(bounds)},
    {key:'perimeters' as const, name:'Deepfire estimated perimeters', load:()=>provider.perimeters(bounds)},
    {key:'staticHeatSources' as const, name:'Deepfire persistent heat sources', load:()=>provider.staticHeatSources(bounds)},
  ];
  const results = await Promise.all(jobs.map(async job => {
    try {
      if (!context.configured) throw Error('unconfigured');
      const result = await job.load();
      Object.assign(context, {[job.key]:result.data});
      return {source:job.name,status:'live' as const,retrievedAt:result.updatedAt,detail:result.detail,coverage:`Bounding box ${bounds.join(',')} (WGS84)`};
    } catch {
      return {source:job.name,status:'unavailable' as const,retrievedAt:new Date().toISOString(),detail:context.configured?'Request failed or incomplete; retry or check Deepfire access.':'Connect a Deepfire API client to load this layer.',coverage:`Bounding box ${bounds.join(',')} (WGS84)`};
    }
  }));
  context.sources = results;
  return context;
}
