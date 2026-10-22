import { useState } from 'react';
import type { Summary } from '../types';
import { hostOf, parseLink } from '../lib/links';
import { useUI } from '../ctx';

type Field = 'slides_pre_url' | 'slides_post_url';

function LinkBox({ field, title, hint }: { field: Field; title: string; hint: string }) {
  const { board } = useUI();
  const s = board.summary!;
  const url = s[field];
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [base, setBase] = useState<{ url: string | null; version: number }>({ url: null, version: 0 });
  const [conflict, setConflict] = useState<Summary | null>(null);

  const start = () => { setBase({ url, version: s.version }); setText(url ?? ''); setError(''); setConflict(null); setEditing(true); };

  async function save(next: string | null, version = base.version) {
    const r = await board.saveSummary(version, { [field]: next } as Partial<Summary>);
    if (!r) return;
    if (r.status === 'ok') { setEditing(false); setConflict(null); return; }
    if (r.latest[field] === base.url) return save(next, r.latest.version); // someone edited a different box
    setConflict(r.latest);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const p = parseLink(text);
    if ('error' in p) { setError(p.error); return; }
    setError('');
    save(p.url);
  }

  return (
    <section className="slide-box" aria-label={title}>
      <h2><span aria-hidden="true">🖼 </span>{title}</h2>
      {editing ? (
        <form onSubmit={submit} className="stack" noValidate>
          <label>Link to the presentation
            <input autoFocus type="url" inputMode="url" value={text} placeholder="https://www.canva.com/design/…" onChange={(e) => { setText(e.target.value); setError(''); }} aria-invalid={!!error} />
            {error && <span className="field-err" role="alert">{error}</span>}
          </label>
          {conflict && (
            <div className="conflict-note" role="alert">
              <strong>{board.actorName(conflict.updated_by)} saved a different link while you were editing:</strong>
              <p className="break">{conflict[field] || '(no link)'}</p>
              <div className="row">
                <button type="button" onClick={() => { setEditing(false); setConflict(null); }}>Use theirs</button>
                <button type="button" className="danger" onClick={() => { const p = parseLink(text); if ('url' in p) save(p.url, conflict.version); }}>Overwrite with mine</button>
              </div>
            </div>
          )}
          <div className="row">
            <button className="primary small" disabled={board.saving > 0}>{board.saving > 0 ? 'Saving…' : 'Save link'}</button>
            <button type="button" className="small" onClick={() => { setEditing(false); setConflict(null); }}>Cancel</button>
          </div>
        </form>
      ) : url ? (
        <>
          <a className="open-slides" href={url} target="_blank" rel="noopener noreferrer">Open presentation <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a>
          <p className="muted small-text break">{hostOf(url)}</p>
          <div className="row">
            <button className="small" onClick={start}>Change link</button>
            <button className="small danger" onClick={() => confirm('Remove this link for everyone?') && board.saveSummary(s.version, { [field]: null } as Partial<Summary>)}>Remove</button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">{hint}</p>
          <button className="small" onClick={start}>+ Add link</button>
        </>
      )}
    </section>
  );
}

export function SlidesLinks() {
  const { board } = useUI();
  if (!board.summary) return null;
  return (
    <div className="slides-links">
      <LinkBox field="slides_pre_url" title="Customer slides: pre-meeting" hint="Add the link to the slides we’ll show the customer before the meeting (e.g. from Canva)." />
      <LinkBox field="slides_post_url" title="Customer slides: post-meeting" hint="Add the link to the updated slides we send after the meeting (e.g. from Canva)." />
    </div>
  );
}
