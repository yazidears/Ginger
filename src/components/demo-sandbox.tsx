'use client';

import {useRouter} from 'next/navigation';
import SageSimulation from './sage-simulation';
import './simulation-morph.css';
import './demo-sandbox.css';

/** Demo is an entry point to the real simulation workspace, not a second model. */
export default function DemoSandbox() {
  const router=useRouter();
  return <div className="app-shell sage-suite map-first shared-map-shell simulation-mode demo-engine-workspace">
    <SageSimulation sandbox location={{lat:41.30,lon:1.86,name:'Garraf'}} assessment={null} onBack={()=>router.push('/')}/>
  </div>;
}
