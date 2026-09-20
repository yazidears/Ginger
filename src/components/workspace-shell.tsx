'use client';

import {Suspense, useEffect} from 'react';
import {usePathname, useRouter, useSearchParams} from 'next/navigation';
import LegacyWorkspace from './workspace';
import ForestWorkspace from './forest-workspace';
import SatelliteLab from './satellite-lab';
import DemoSandbox from './demo-sandbox';
import ReceptivityWorkspace from './receptivity/workspace';
import SageWorkspace from './sage-workspace';
import ProductNav from './product-nav';
import {SharedMapProvider, SharedMapSurface} from './shared-map';
import './shared-map.css';
import './product-console.css';

function ConsoleContent({children}: {children: React.ReactNode}) {
  const path = usePathname(), router = useRouter(), query = useSearchParams();
  const legacyInspect = path === '/prevention' && query.get('tool') === 'inspect';
  const legacyRun = (path === '/' || path === '/prevention') && (query.has('sageRun') || query.get('tool') === 'simulate');
  useEffect(() => {
    if (legacyRun) {
      const next = new URLSearchParams(query.toString());
      next.delete('tool');
      router.replace(`/sage?${next}`);
    }
  }, [legacyRun, query, router]);
  const prevent = !legacyInspect && ['/', '/prevent', '/prevention'].includes(path);
  const terrainWind = path === '/sage' && query.get('engine') === 'terrain-wind';
  const sage = path === '/sage' && !terrainWind;
  const demo = path === '/demo';
  const lat = Number(query.get('lat')), lon = Number(query.get('lon'));
  const satellitePoint = query.has('lat') && query.has('lon') && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 85 && Math.abs(lon) <= 180 ? {lat, lon} : undefined;
  const preventReturn = `/prevent?${new URLSearchParams({cell:query.get('cell') || '',horizon:query.get('horizon') || '0'})}`;
  const specialist = legacyInspect || ['/satellite', '/replay'].includes(path);
  const geographic = prevent || sage || demo || specialist;
  const core = prevent || terrainWind || sage || path === '/ash' || path === '/ash-connect';
  return <>
    {terrainWind ? <ForestWorkspace integrated/> : geographic ? <div className={`workspace-map-host app-shell shared-map-shell map-first product-map-host ${prevent ? 'prevent-product-host' : sage ? 'sage-product-host' : demo ? 'demo-map-host' : 'specialist-product-host'}`}>
      <SharedMapSurface/>
      {prevent ? <ReceptivityWorkspace/> : sage ? <SageWorkspace/> : demo ? <DemoSandbox/> : path === '/satellite' ? <SatelliteLab initialPoint={satellitePoint} onBack={()=>router.push(query.get('from') === 'prevent' ? preventReturn : `/sage?${query}`)}/> : <LegacyWorkspace/>}
    </div> : children}
    {(core || geographic || path === '/forest') && <ProductNav/>}
    {specialist && <a className="specialist-return" href={query.get('from') === 'prevent' ? preventReturn : `/sage?${query}`}>{query.get('from') === 'prevent' ? 'Return to selected zone' : 'Return to Sage'}</a>}
  </>;
}

/** Only geographic workspaces mount the shared renderer. Ash owns no hidden map. */
export default function WorkspaceShell({children}: {children: React.ReactNode}) {
  return <SharedMapProvider><Suspense fallback={<div className="product-loading" role="status">Opening GINGER…</div>}><ConsoleContent>{children}</ConsoleContent></Suspense></SharedMapProvider>;
}
