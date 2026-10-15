import {useEffect, useRef} from 'react';
interface Props {redacted: boolean; onRedactedChange: (value:boolean)=>void; exporting:boolean; onExport:(format:'json'|'md')=>void}
export function ExportControls({redacted,onRedactedChange,exporting,onExport}:Props) {
  const menu=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{
    const outside=(event:PointerEvent)=>{if(menu.current && !menu.current.contains(event.target as Node))menu.current.open=false;};
    document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
  },[]);
  const save=(format:'json'|'md')=>{if(menu.current)menu.current.open=false;onExport(format);};
  return <footer className="export-bar export-controls" aria-label="Export report">
    <details ref={menu} className="export-options" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();if(menu.current){menu.current.open=false;menu.current.querySelector('summary')?.focus();}}}}>
      <summary>Export options: <strong>{redacted?'Redacted summary':'Full report'}</strong></summary>
      <div className="export-popover">
        <fieldset className="export-mode"><legend>Export content</legend>
          <label><input type="radio" name="export-mode" checked={redacted} onChange={()=>onRedactedChange(true)}/>Redacted summary</label>
          <label><input type="radio" name="export-mode" checked={!redacted} onChange={()=>onRedactedChange(false)}/>Full report</label>
        </fieldset>
        <p className="export-mode-help">{redacted?'Paths, project names and detailed evidence are withheld.':'Includes paths, project names, branches and detailed analysis. Review before sharing.'} No cleanup has been performed.</p>
      </div>
    </details>
    <button onClick={()=>save('md')} disabled={exporting}>Export Markdown</button><button onClick={()=>save('json')} disabled={exporting}>Export JSON</button>
  </footer>;
}
