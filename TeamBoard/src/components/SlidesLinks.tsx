import { useState } from 'react';
import type { Summary } from '../types';
import { formatDate } from '../lib/dates';
import { deckKind, validateDeckFile } from '../lib/files';
import { hostOf, parseLink } from '../lib/links';
import { meetingAfter, nextMeeting, nextSubmissionDue } from '../lib/slides';
import { useUI } from '../ctx';

/** The working deck: a link (e.g. Canva) to the presentation being edited for the next meeting. */
function WorkingDeck() {
  const { board } = useUI();
  const s = board.summary!;
  const url = s.slides_working_url;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [base, setBase] = useState<{ url: string | null; version: number }>({ url: null, version: 0 });
  const [conflict, setConflict] = useState<Summary | null>(null);

  const start = () => { setBase({ url, version: s.version }); setText(url ?? ''); setError(''); setConflict(null); setEditing(true); };
  const close = () => { setEditing(false); setConflict(null); };

  async function save(next: string | null, version = base.version) {
    const r = await board.saveSummary(version, { slides_working_url: next });
    if (!r) return;
    if (r.status === 'ok') { close(); return; }
    if (r.latest.slides_working_url === base.url) return save(next, r.latest.version); // someone edited something else
    setConflict(r.latest);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const p = parseLink(text);
    if ('error' in p) { setError(p.error); return; }
    save(p.url);
  }

  return (
    <section className="slide-box" aria-label="Working deck">
      <h2><span aria-hidden="true">✏️ </span>Working deck</h2>
      <p className="slide-sub">Keep editing this one · for the <strong>{formatDate(nextMeeting(board.today))}</strong> meeting</p>
      {editing ? (
        <form onSubmit={submit} className="stack" noValidate>
          <label>Link to the presentation
            <input autoFocus type="url" inputMode="url" value={text} placeholder="https://www.canva.com/design/…" onChange={(e) => { setText(e.target.value); setError(''); }} aria-invalid={!!error} />
          </label>
          {error && <span className="field-err" role="alert">{error}</span>}
          {conflict && (
            <div className="conflict-note" role="alert">
              <strong>{board.actorName(conflict.updated_by)} saved a different link while you were editing:</strong>
              <p className="break">{conflict.slides_working_url || '(no link)'}</p>
              <div className="row">
                <button type="button" onClick={close}>Use theirs</button>
                <button type="button" className="danger" onClick={() => { const p = parseLink(text); if ('url' in p) save(p.url, conflict.version); }}>Overwrite with mine</button>
              </div>
            </div>
          )}
          <div className="row">
            <button className="primary small" disabled={board.saving > 0}>{board.saving > 0 ? 'Saving…' : 'Save link'}</button>
            <button type="button" className="small" onClick={close}>Cancel</button>
          </div>
        </form>
      ) : url ? (
        <>
          <a className="open-slides" href={url} target="_blank" rel="noopener noreferrer">Open working deck <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a>
          <p className="muted small-text break">{hostOf(url)}</p>
          <p className="slide-note">Next copy is due {formatDate(nextSubmissionDue(board.today))}: download this deck as a PowerPoint and upload it as the submitted deck.</p>
          <div className="row">
            <button className="small" onClick={start}>Change link</button>
            <button className="small danger" onClick={() => confirm('Remove this link for everyone?') && board.saveSummary(s.version, { slides_working_url: null })}>Remove</button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">Add the link to the slides you’re editing for the next meeting (e.g. from Canva).</p>
          <button className="small" onClick={start}>+ Add link</button>
        </>
      )}
    </section>
  );
}

/** Downloads a stored file through a short-lived signed link (the bucket is private). */
function DownloadButton({ path, name, primary }: { path: string; name: string; primary?: boolean }) {
  const { board } = useUI();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    const url = await board.deckDownloadUrl(path, name);
    setBusy(false);
    if (url) window.location.assign(url);
  }
  return (
    <button className={primary ? 'download-btn' : 'small-link-btn'} onClick={go} disabled={busy}>
      {busy ? 'Preparing…' : <><span aria-hidden="true">⬇ </span>Download {deckKind(name)}<span className="sr-only">: {name}</span></>}
    </button>
  );
}

/** The submitted deck: the frozen Friday copy, uploaded as a file that anyone on the team can download. */
function SubmittedDeck() {
  const { board } = useUI();
  const s = board.summary!;
  const file = s.slides_submitted_file;
  const link = s.slides_submitted_url; // an older copy that was a link
  const has = !!(file || link);
  const [submitting, setSubmitting] = useState(false);
  const [chosen, setChosen] = useState<File | null>(null);
  const [date, setDate] = useState('');
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [baseVersion, setBaseVersion] = useState(0);

  const open = () => { setBaseVersion(s.version); setChosen(null); setDate(nextSubmissionDue(board.today)); setError(''); setStale(false); setSubmitting(true); };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!chosen) { setError('Choose the PowerPoint file to upload.'); return; }
    const bad = validateDeckFile(chosen);
    if (bad) { setError(bad); return; }
    if (!date) { setError('Choose the Friday this was submitted.'); return; }
    setError('');
    const r = await board.submitSlidesCopy(chosen, date, baseVersion);
    if (r === 'ok') setSubmitting(false);
    else if (r === 'conflict') setStale(true);
  }

  return (
    <section className="slide-box submitted" aria-label="Submitted deck">
      <h2><span aria-hidden="true">📤 </span>Submitted deck</h2>
      <p className="slide-sub">Friday copy · frozen, don’t edit</p>
      {submitting ? (
        <form onSubmit={submit} className="stack" noValidate>
          <label>PowerPoint file <span className="muted">(.pptx, .ppt or PDF, up to 50 MB)</span>
            <input autoFocus type="file" accept=".pptx,.ppt,.pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint,application/pdf"
              onChange={(e) => { setChosen(e.target.files?.[0] ?? null); setError(''); }} aria-invalid={!!error} />
          </label>
          <label>Submitted on
            <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setError(''); }} />
          </label>
          {error && <span className="field-err" role="alert">{error}</span>}
          {has && <p className="muted small-text">The current submitted copy moves to <strong>Past submitted decks</strong>.</p>}
          {stale && <p className="form-err" role="alert">Someone just changed the slides, so nothing was saved. The latest is shown above — check it, then try again.</p>}
          {board.saving > 0 && <p className="muted" role="status">Uploading… keep this page open.</p>}
          <div className="row">
            <button className="primary small" disabled={board.saving > 0}>{board.saving > 0 ? 'Uploading…' : 'Upload & submit'}</button>
            <button type="button" className="small" onClick={() => setSubmitting(false)} disabled={board.saving > 0}>Cancel</button>
          </div>
        </form>
      ) : has ? (
        <>
          {file
            ? <><DownloadButton primary path={file} name={s.slides_submitted_file_name ?? 'submitted-deck.pptx'} /><p className="muted small-text break">{s.slides_submitted_file_name}</p></>
            : <><a className="open-slides" href={link!} target="_blank" rel="noopener noreferrer">Open submitted deck <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a><p className="muted small-text break">{hostOf(link!)} (saved as a link)</p></>}
          {s.slides_submitted_on && (
            <p className="slide-dates"><strong>Submitted {formatDate(s.slides_submitted_on)}</strong> · presented at the {formatDate(meetingAfter(s.slides_submitted_on))} meeting</p>
          )}
          <p className="slide-note">This is the frozen copy that was submitted. To change slides, edit the working deck and submit a new copy.</p>
          <div className="row">
            <button className="small primary" onClick={open}>Submit a new copy</button>
            <button className="small danger"
              onClick={() => confirm(file ? 'Remove the submitted deck? The uploaded file will be permanently deleted for everyone (it is NOT saved to Past submitted decks).' : 'Remove this link for everyone?')
                && board.removeSubmittedDeck(s.version, file)}>Remove</button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">Upload the PowerPoint you submit on Fridays. Older copies are kept under Past submitted decks.</p>
          <button className="small" onClick={open}>+ Upload submitted deck</button>
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
              {a.file_name && <span className="muted small-text break"> · {a.file_name}</span>}
            </span>
            <span className="row">
              {a.file_path
                ? <DownloadButton path={a.file_path} name={a.file_name ?? 'deck.pptx'} />
                : <a className="small-link" href={a.url!} target="_blank" rel="noopener noreferrer">Open ↗<span className="sr-only"> (opens in a new tab)</span></a>}
              <button className="link" onClick={() => confirm(a.file_path ? 'Permanently delete this old deck file for everyone?' : 'Remove this entry from the history?') && board.removeArchivedSlides(a)}>Remove</button>
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
  return (
    <div className="slides">
      <div className="slides-links">
        <WorkingDeck />
        <SubmittedDeck />
      </div>
      <PastDecks />
    </div>
  );
}
