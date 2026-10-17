import { Icon } from './Icon';
import {useMemo} from 'react';
import type {Report} from './types';
import {visiblePath} from './analysis';
export interface WarningView {query: string; code: string; page: number}
export const emptyWarningView: WarningView = {query:'',code:'all',page:0};
const reasons: Record<string,[string,string]> = {
  'link-skipped':['Linked paths skipped','Linked targets were not traversed; their contents may be outside this inventory.'],
  'metadata-unavailable':['File metadata unavailable','Some file lengths or types could not be checked.'],
  'directory-unavailable':['Directories unreadable','Contents of these directories could not be measured.'],
  'entry-unavailable':['Entries unreadable','Some directory entries could not be inspected.'],
  'permission-denied':['Access denied','These paths could not be read with the current account.'],
  'policy-excluded':['Excluded by policy','Sensitive or system paths were deliberately excluded.'],
  'depth-limit':['Depth limit reached','Deeper paths were not inspected.'],
  'finding-limit':['Finding limit reached','The scan stopped at its finding limit. Narrower roots can give a more complete inventory.'],
  'project-limit':['Project limit reached','The scan stopped at its project limit.'],
};
interface Props {report: Report; view: WarningView; onChange: (view: WarningView) => void}
export function WarningBrowser({report,view,onChange}:Props) {
  const groups=useMemo(()=>{
    const counts=new Map<string,number>();report.warnings.forEach(w=>counts.set(w.code,(counts.get(w.code)??0)+1));
    return [...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  },[report]);
  const filtered=useMemo(()=>report.warnings.filter(w=>(view.code==='all'||w.code===view.code)&&`${w.code} ${w.path} ${w.message}`.toLocaleLowerCase().includes(view.query.toLocaleLowerCase())),[report,view]);
  const last=Math.max(0,Math.ceil(filtered.length/25)-1),page=Math.min(view.page,last),start=page*25;
  const change=(update:Partial<WarningView>)=>onChange({...view,...update,page:0});
  return <section className="warnings" aria-label="Coverage warnings">
    <h3>Warnings ({report.warningCount.toLocaleString()})</h3>
    {report.warningCount>report.warnings.length && <p className="warning-retention">Only the first {report.warnings.length} warning details are retained. Counts and search below describe those retained details, not the remaining {report.warningCount-report.warnings.length} warnings.</p>}
    {!report.warnings.length ? <p>No skipped-entry warnings were recorded.</p> : <>
      <div className="warning-groups"><button aria-pressed={view.code==='all'} onClick={()=>change({code:'all'})}>All retained details ({report.warnings.length})</button>{groups.map(([code,count])=><button key={code} aria-pressed={view.code===code} onClick={()=>change({code})}>{reasons[code]?.[0]??code.replaceAll('-',' ')} <strong>{count}</strong></button>)}</div>
      {view.code!=='all' && <p>{reasons[view.code]?.[1]??'Inspect the retained messages for the effect on scan coverage.'}</p>}
      <input className="warning-search" aria-label="Search warnings" placeholder="Search retained paths or messages…" value={view.query} onChange={e=>change({query:e.target.value})}/>
      <div className="warning-list">{filtered.slice(start,start+25).map((warning,i)=><details key={`${warning.code}-${warning.path}-${start+i}`} className="warning-item" open={filtered.length===1}>
        <summary><code>{warning.code}</code><span className="mono">{visiblePath(warning.path)}</span></summary><p>{warning.message}</p>
      </details>)}</div>
      {!filtered.length && <p>No retained warning details match these filters.</p>}
      <div className="pagination"><span>{filtered.length ? `${start+1}–${Math.min(start+25,filtered.length)} of ${filtered.length} retained details` : '0 matching details'}</span><div><button disabled={page===0} onClick={()=>onChange({...view,page:page-1})}><Icon name="previous"/>Previous warnings</button><button disabled={page>=last} onClick={()=>onChange({...view,page:page+1})}>Next warnings<Icon name="next"/></button></div></div>
    </>}
  </section>;
}
