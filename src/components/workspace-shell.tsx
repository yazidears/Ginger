'use client';
import {usePathname} from 'next/navigation';
import dynamic from 'next/dynamic';
const LegacyWorkspace=dynamic(()=>import('./workspace'),{ssr:false});
/** Receptivity is the home product; retain the existing tools on their own routes. */
export default function WorkspaceShell({children}:{children:React.ReactNode}){const path=usePathname();return path==='/'||path==='/methodology'?children:<><LegacyWorkspace/>{children}</>;}
