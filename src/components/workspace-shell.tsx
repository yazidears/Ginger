'use client';
import {usePathname} from 'next/navigation';
import dynamic from 'next/dynamic';
import {SharedMapProvider,SharedMapSurface} from './shared-map';
import './shared-map.css';
const LegacyWorkspace=dynamic(()=>import('./workspace'),{ssr:false});
const ReceptivityWorkspace=dynamic(()=>import('./receptivity/workspace'),{ssr:false});
export default function WorkspaceShell({children}:{children:React.ReactNode}){
 const path=usePathname();
 const home=path==='/';
 const geographic=home||path==='/prevention'||path==='/satellite'||path==='/replay';
 return <SharedMapProvider><div className={'workspace-map-host app-shell shared-map-shell map-first '+(home?'receptivity-map-host':'')} hidden={!geographic}>
  <SharedMapSurface/>
  {geographic&&(home?<ReceptivityWorkspace/>:<LegacyWorkspace/>)}
 </div>{!geographic&&children}</SharedMapProvider>;
}
