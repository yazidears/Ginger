import {referencesFor,type WildfireReferenceContext} from '@/lib/wildfire-references';
import './wildfire-references.css';
export default function WildfireReferences({context='all'}:{context?:WildfireReferenceContext}) {
 return <details className="wildfire-references"><summary>{context==='risk'?'Annual risk research':context==='incidents'?'External incident maps':'Wildfire maps & research'}</summary><p className="reference-note">External sources · links open in a new tab.</p><ul>{referencesFor(context).map(source=><li key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.name} <span aria-hidden="true">↗</span></a><span className="reference-scope">{source.scope} · {source.kind}</span><p>{source.detail}</p></li>)}</ul></details>;
}
