import { useState } from 'react';
import type { Summary } from '../types';
import { formatDate } from '../lib/dates';
import { hostOf, parseLink } from '../lib/links';
import { meetingAfter, nextMeeting, nextSubmissionDue } from '../lib/slides';
import { useUI } from '../ctx';

type Field = 'slides_working_url' | 'slides_submitted_url';
type Mode = 'view' | 'edit' | 'submit';

/** One deck box. "edit" changes the link in place; "submit" (submitted deck only) files the old copy in the archive. */
function DeckBox({ field, title, subtitle, note, emptyHint, canSubmit }: {
  field: Field; title: string; subtitle: React.ReactNode; note: string; emptyHint: string; canSubmit?: boolean;
}) {
  const { board } = useUI();
  const s = board.summary!;
  const url = s[field];
  const [mode, setMode] = useState<Mode>('view');
  const [text, setText] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState('');
  const [base, setBase] = useState<{ url: string | null; version: number }>({ url: null, version: 0 });
  const [conflict, setConflict] = useState<Summary | null>(null);
  const [stale, setStale] = useState(false);

  const open = (m: Mode) => {
    setBase({ url, version: s.version });
    setText(m === 'edit' ? url ?? '' : '');
    setDate(nextSubmissionDue(board.today));
    setError(''); setConflict(null); setStale(false); setMode(m);
  };
  const close = () => { setMode('view'); setConflict(null); setStale(false); };

  async function saveLink(next: string | null, version = base.version) {
    const patch: Partial<Summary> = { [field]: next };
    if (field === 'slides_submitted_url' && next === null) patch.slides_submitted_on = null;
    const r = await board.saveSummary(version, patch);
    if (!r) return;
    if (r.status === 'ok') { close(); return; }
    if (r.latest[field] === base.url) return saveLink(next, r.latest.version); // someone edited a different box
    setConflict(r.latest);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const p = parseLink(text);
    if ('error' in p) { setError(p.error); return; }
    if (mode === 'submit' && !date) { setError('Choose the Friday this was submitted.'); return; }
    setError('');
    if (mode === 'edit') return saveLink(p.url);
    const r = await board.submitSlidesCopy(p.url, date, base.version);
    if (r === 'ok') close();
    else if (r === 'conflict') setStale(true);
  }

  const submittedOn = s.slides_submitted_on;
  return (
    <section className={`slide-box${field === 'slides_submitted_url' ? ' submitted' : ''}`} aria-label={title}>
      <h2><span aria-hidden="true">{field === 'slides_working_url' ? '✏️ ' : '📤 '}</span>{title}</h2>
      <p className="slide-sub">{subtitle}</p>

      {mode !== 'view' ? (
        <form onSubmit={submit} className="stack" noValidate>
          <label>{mode === 'submit' ? 'Link to the new submitted copy' : 'Link to the presentation'}
            <input autoFocus type="url" inputMode="url" value={text} placeholder="https://www.canva.com/design/…" onChange={(e) => { setText(e.target.value); setError(''); }} aria-invalid={!!error} />
          </label>
          {mode === 'submit' && (
            <label>Submitted on
              <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setError(''); }} />
            </label>
          )}
          {error && <span className="field-err" role="alert">{error}</span>}
          {mode === 'submit' && url && <p className="muted small-text">The current submitted copy moves to <strong>Past submitted decks</strong>.</p>}
          {stale && <p className="form-err" role="alert">Someone just changed the slides, so nothing was saved. The latest links are shown above — check them, then try again.</p>}
          {conflict && (
            <div className="conflict-note" role="alert">
              <strong>{board.actorName(conflict.updated_by)} saved a different link while you were editing:</strong>
              <p className="break">{conflict[field] || '(no link)'}</p>
              <div className="row">
                <button type="button" onClick={close}>Use theirs</button>
                <button type="button" className="danger" onClick={() => { const p = parseLink(text); if ('url' in p) saveLink(p.url, conflict.version); }}>Overwrite with mine</button>
              </div>
            </div>
          )}
          <div className="row">
            <button className="primary small" disabled={board.saving > 0}>{board.saving > 0 ? 'Saving…' : mode === 'submit' ? 'Submit copy' : 'Save link'}</button>
            <button type="button" className="small" onClick={close}>Cancel</button>
          </div>
        </form>
      ) : url ? (
        <>
          <a className="open-slides" href={url} target="_blank" rel="noopener noreferrer">Open {field === 'slides_working_url' ? 'working deck' : 'submitted deck'} <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a>
          <p className="muted small-text break">{hostOf(url)}</p>
          {field === 'slides_submitted_url' && submittedOn && (
            <p className="slide-dates"><strong>Submitted {formatDate(submittedOn)}</strong> · presented at the {formatDate(meetingAfter(submittedOn))} meeting</p>
          )}
          <p className="slide-note">{note}</p>
          <div className="row">
            {canSubmit && <button className="small primary" onClick={() => open('submit')}>Submit a new copy</button>}
            <button className="small" onClick={() => open('edit')}>{canSubmit ? 'Fix link' : 'Change link'}</button>
            <button className="small danger" onClick={() => confirm('Remove this link for everyone?') && saveLink(null, s.version)}>Remove</button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">{emptyHint}</p>
          <button className="small" onClick={() => open(canSubmit ? 'submit' : 'edit')}>{canSubmit ? '+ Add submitted copy' : '+ Add link'}</button>
        </>
      )}
    </section>
  );
}

function PastDecks() {
  const { board } = useUI();
  const [all, setAll] = useState(false);
  const list = board.slideArchive;
  if (list.length === 0) return null;
  const shown = all ? list : list.slice(0, 5);
  return (
    <section className="past-decks" aria-label="Past submitted decks">
      <h2>Past submitted decks <span className="count">{list.length}</span></h2>
      <ul>
        {shown.map((a) => (
          <li key={a.id}>
            <span>
              {a.submitted_on
                ? <><strong>Submitted {formatDate(a.submitted_on)}</strong> <span className="muted">· for the {formatDate(meetingAfter(a.submitted_on))} meeting</span></>
                : <strong>Earlier copy <span className="muted">(date not recorded)</span></strong>}
            </span>
            <span className="row">
              <a className="small-link" href={a.url} target="_blank" rel="noopener noreferrer">Open ↗<span className="sr-only"> (opens in a new tab)</span></a>
              <button className="link" onClick={() => confirm('Remove this entry from the history?') && board.removeArchivedSlides(a.id)}>Remove</button>
            </span>
          </li>
        ))}
      </ul>
      {list.length > 5 && <button className="link" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${list.length}`}</button>}
    </section>
  );
}

export function SlidesLinks() {
  const { board } = useUI();
  if (!board.summary) return null;
  const meeting = nextMeeting(board.today);
  const due = nextSubmissionDue(board.today);
  return (
    <div className="slides">
      <div className="slides-links">
        <DeckBox
          field="slides_working_url"
          title="Working deck"
          subtitle={<>Keep editing this one · for the <strong>{formatDate(meeting)}</strong> meeting</>}
          note={`Next copy is due ${formatDate(due)}: make a copy of this deck and submit it with “Submit a new copy”.`}
          emptyHint="Add the link to the slides you’re editing for the next meeting (e.g. from Canva)."
        />
        <DeckBox
          field="slides_submitted_url"
          title="Submitted deck"
          subtitle="Friday copy · frozen, don’t edit"
          note="This is the frozen copy that was submitted. To change slides, edit the working deck and submit a new copy."
          emptyHint="Add the copy you submit on Fridays. Older copies are kept under Past submitted decks."
          canSubmit
        />
      </div>
      <PastDecks />
    </div>
  );
}
