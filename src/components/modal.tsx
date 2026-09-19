'use client';
import { useEffect, useRef, useId } from 'react';
import { X } from 'lucide-react';
export default function Modal({title,subtitle,children,onClose,wide=false}:{title:string;subtitle?:string;children:React.ReactNode;onClose:()=>void;wide?:boolean}){
 const titleId=useId();
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const d=ref.current;const active=document.activeElement as HTMLElement;d?.showModal();return()=>{d?.close();active?.focus();};},[]);
 return <dialog aria-labelledby={titleId} ref={ref} className={'modal '+(wide?'wide':'')} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><div className="modal-head"><div><span className="eyebrow">GINGER / INTELLIGENCE</span><h2 id={titleId}>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></div>{children}</dialog>;
}
