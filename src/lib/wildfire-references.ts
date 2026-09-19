/** External products are references, not observations in Ginger's alert engine. */
export const wildfireReferences = [
  {id:'focs', name:'Focs.cat', url:'https://focs.cat/mapa', scope:'Catalonia', kind:'Incident map', status:'External map', detail:'Cross-check Catalan wildfire reports on Focs.cat. Incidents and updates are viewed on their map; Ginger does not ingest this feed.'},
  {id:'watch-duty', name:'Watch Duty', url:'https://app.watchduty.org/', scope:'United States', kind:'Alerts & incidents', status:'External alerts', detail:'Open Watch Duty for US incident reporting and alerts. Its coverage does not supply Ginger’s Catalonia alerts.'},
  {id:'firescope', name:'FireScope', url:'https://firescope.ai/', scope:'Europe & Asia', kind:'Annual risk · 2026', status:'Optional research layer', detail:'INSAIT’s 2026 annual wildfire likelihood and intensity raster is available in Map layers. Research context only; it does not change live alerts, fire spread or evacuation guidance.'},
] as const;
export type WildfireReferenceContext = 'all' | 'incidents' | 'risk';
export function referencesFor(context: WildfireReferenceContext) {
  return wildfireReferences.filter(source => context==='all'||(context==='risk'?source.id==='firescope':source.id!=='firescope'));
}
export function wildfireReferenceText() {
  return '\n\nEXTERNAL REFERENCES (not evidence used in this assessment)\n'+wildfireReferences.map(s=>`${s.name} | ${s.scope} | ${s.kind}\n${s.url}\n${s.detail}`).join('\n\n');
}
export const fireScopeRegions = {
  europe: {path:'risk_tiles_webp', bounds:[-10.6348,33.9433,46.0547,71.2161] as [number,number,number,number]},
  asia: {path:'eurasia_risk_tiles_webp', bounds:[45.9667,18.1458,180,60.0210] as [number,number,number,number]},
};
