'use client';
import {SharedMapProvider} from './shared-map';
import {useState} from 'react';
import OperationalSuite from './operational-suite';
import CommandCenter from './command-center';
export default function Workspace({initialReplay=false}:{initialReplay?:boolean}){const [mode,setMode]=useState<'live'|'demo'>('live');return <SharedMapProvider>{mode==='live'?<OperationalSuite initialReplay={initialReplay} onDemo={()=>setMode('demo')}/>:<CommandCenter onLive={()=>setMode('live')}/>}</SharedMapProvider>;}
