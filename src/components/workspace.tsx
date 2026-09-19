'use client';
import {useState} from 'react';
import OperationalSuite from './operational-suite';
import CommandCenter from './command-center';
export default function Workspace({initialReplay=false}:{initialReplay?:boolean}){const [mode,setMode]=useState<'live'|'demo'>('live');return mode==='live'?<OperationalSuite initialReplay={initialReplay} onDemo={()=>setMode('demo')}/>:<CommandCenter onLive={()=>setMode('live')}/>;}
