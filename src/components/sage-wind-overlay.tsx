'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {Map as MapInstance} from 'maplibre-gl';
import type {RunResult} from '@/lib/sage/types';
import {compass,windAt} from '@/lib/sage/smoke';
import {toLocal,toLonLat} from '@/lib/sage/geometry';

/** Schematic map overlay of the recorded input wind, not a spatial airflow solution. */
export default function SageWindOverlay({map,run,minute}:{map:MapInstance;run:RunResult;minute:number}){
 const canvas=useRef<HTMLCanvasElement>(null),[enabled,setEnabled]=useState(true);
 const wind=useMemo(()=>windAt(run,minute),[run,minute]);
 useEffect(()=>{const element=canvas.current;if(!element)return;const context=element.getContext('2d');if(!context)return;const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');const box=map.getContainer();let lastDraw=0;
  const draw=()=>{const now=performance.now();if(document.hidden||now-lastDraw<48)return;lastDraw=now;const width=box.clientWidth,height=box.clientHeight,ratio=Math.min(window.devicePixelRatio||1,2);if(element.width!==Math.round(width*ratio)||element.height!==Math.round(height*ratio)){element.width=Math.round(width*ratio);element.height=Math.round(height*ratio);}context.setTransform(ratio,0,0,ratio,0,0);context.clearRect(0,0,width,height);if(!enabled||!wind||wind.speedKmh<.1)return;
   const half=run.size*run.cellM/2,bounds=map.getBounds(),sw=toLocal([bounds.getWest(),bounds.getSouth()],run.center),ne=toLocal([bounds.getEast(),bounds.getNorth()],run.center),left=Math.max(-half,sw[0]),right=Math.min(half,ne[0]),bottom=Math.max(-half,sw[1]),top=Math.min(half,ne[1]);if(right<=left||top<=bottom)return;const spacingX=(right-left)/9,spacingY=(top-bottom)/9,angle=wind.toDegrees*Math.PI/180,length=Math.min(100,Math.max(4,Math.min(spacingX,spacingY)*.6)),dx=Math.sin(angle)*length,dy=Math.cos(angle)*length;
   // Exactly 81 sampled positions within the model domain. All share this input wind.
   for(let i=0;i<9;i++)for(let j=0;j<9;j++){const x=left+(i+.5)*spacingX,y=bottom+(j+.5)*spacingY;const a=map.project(toLonLat([x-dx*.5,y-dy*.5],run.center)),b=map.project(toLonLat([x+dx*.5,y+dy*.5],run.center));if(Math.max(a.x,b.x)<0||Math.min(a.x,b.x)>width||Math.max(a.y,b.y)<0||Math.min(a.y,b.y)>height)continue;const vx=b.x-a.x,vy=b.y-a.y,screenLength=Math.hypot(vx,vy);if(screenLength<2)continue;const ux=vx/screenLength,uy=vy/screenLength;
    context.beginPath();context.moveTo(a.x,a.y);context.lineTo(b.x,b.y);context.moveTo(b.x-ux*5-uy*3,b.y-uy*5+ux*3);context.lineTo(b.x,b.y);context.lineTo(b.x-ux*5+uy*3,b.y-uy*5-ux*3);context.strokeStyle='rgba(0,25,30,.9)';context.lineWidth=4;context.stroke();context.strokeStyle='rgba(107,243,255,.85)';context.lineWidth=1.5;context.stroke();
    const phase=reduced.matches?.5:(performance.now()/1000*(wind.speedKmh/3.6)*6/length+(i+4)*.17+(j+4)*.31)%1;context.beginPath();context.arc(a.x+vx*phase,a.y+vy*phase,2.5,0,Math.PI*2);context.fillStyle='#ffffff';context.fill();
   }
  };draw();map.on('move',draw);map.on('resize',draw);const timer=enabled&&!reduced.matches?window.setInterval(draw,50):null;return()=>{map.off('move',draw);map.off('resize',draw);if(timer!==null)window.clearInterval(timer);};
 },[map,run,wind,enabled]);
 return <><canvas ref={canvas} aria-hidden="true" style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:0}}/><div aria-label="Scenario wind" style={{position:'absolute',right:12,bottom:220,zIndex:4,maxWidth:'min(215px,calc(100vw - 100px))',padding:'10px 12px',borderRadius:10,background:'rgba(12,25,20,.92)',border:'1px solid #40513d',fontSize:11,color:'#e5eadc'}}><label style={{display:'flex',gap:8,alignItems:'center'}}><input type="checkbox" checked={enabled} onChange={event=>setEnabled(event.target.checked)}/> Wind animation</label><strong style={{display:'block',marginTop:5}}>{wind?`${wind.speedKmh.toFixed(1)} km/h · ${compass(wind.fromDegrees)} → ${compass(wind.toDegrees)}`:'Wind unavailable at this time'}</strong><span>+{Math.round(minute)} min · recorded 10 m input</span><details><summary>What this shows</summary><p>Uniform scenario wind, including saved what-if changes. Trails are schematic and shown over the scene; marker motion is accelerated 6× for visibility. They do not resolve terrain, trees or buildings. WindNinja terrain wind remains in the terrain-wind model.</p></details></div></>;
}
