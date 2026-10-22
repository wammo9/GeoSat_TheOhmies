import { useEffect, useRef, useState, type ReactNode } from 'react';
import { textOn } from '../lib/color';
import type { Board } from '../useBoard';

export function Wave() {
  return (
    <svg className="wave" viewBox="0 0 1440 120" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path className="w1" d="M0 60 C 180 110, 360 10, 540 55 S 900 110, 1080 60 S 1320 20, 1440 55 L1440 120 L0 120 Z" />
      <path className="w2" d="M0 80 C 200 40, 380 120, 600 80 S 960 30, 1160 85 S 1360 100, 1440 75 L1440 120 L0 120 Z" />
    </svg>
  );
}

function AccountMenu({ board, email, onSignOut }: { board: Board; email: string; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const me = board.me;
  const bg = me?.color ?? '#ffffff';
  return (
    <div className="account" ref={ref}>
      <button className="account-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`Account menu for ${email}`}
        style={{ background: bg, color: textOn(bg) }} onClick={() => setOpen(!open)}>
        {me?.initial ?? email.slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div className="account-menu" role="menu">
          <p className="account-email">Signed in as<br /><strong>{email}</strong></p>
          <button role="menuitem" onClick={onSignOut}>Sign out</button>
        </div>
      )}
    </div>
  );
}

export type View = 'board' | 'tuesday' | 'thursday' | 'all' | 'team';
const TABS: [View, string][] = [
  ['board', 'Board'], ['tuesday', 'Tuesday planning'], ['thursday', 'Thursday review'], ['all', 'All tasks'], ['team', 'Team'],
];

export function Header({ view, setView, board, email, onSignOut, onNew }: {
  view: View; setView: (v: View) => void; board: Board; email: string; onSignOut: () => void; onNew: () => void;
}) {
  const status =
    board.live === 'live' ? <span className="dot ok">Live</span>
    : board.live === 'connecting' ? <span className="dot warn">Connecting…</span>
    : <span className="dot bad">Offline — not syncing</span>;
  return (
    <header className="top">
      <div className="top-inner">
        <div className="brand">
          <img src="/logo.png" alt="" width="44" height="44" />
          <div>
            <h1>GeoSat Team Board</h1>
            <p>Task Manager · times in Denver (MT)</p>
          </div>
        </div>
        <div className="top-right">
          <div className="status" role="status" aria-live="polite">
            {status}
            <span className="sep">·</span>
            {board.saving > 0 ? <span>Saving…</span> : <span>All changes saved</span>}
          </div>
          <button className="primary" onClick={onNew}>+ New task</button>
          <AccountMenu board={board} email={email} onSignOut={onSignOut} />
        </div>
      </div>
      <nav aria-label="Views" className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={view === id ? 'tab on' : 'tab'} aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>
            {label}
          </button>
        ))}
      </nav>
    </header>
  );
}

export function Toasts({ board }: { board: Board }) {
  if (!board.error && !board.notice) return null;
  return (
    <div className="toasts">
      {board.error && (
        <div className="toast err" role="alert">
          <span>{board.error}</span>
          <button onClick={() => board.setError(null)} aria-label="Dismiss error">✕</button>
        </div>
      )}
      {board.notice && (
        <div className="toast ok" role="status">
          <span>{board.notice}</span>
          <button onClick={() => board.setNotice(null)} aria-label="Dismiss message">✕</button>
        </div>
      )}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={wide ? 'modal wide' : 'modal'} role="dialog" aria-modal="true" aria-label={title}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
