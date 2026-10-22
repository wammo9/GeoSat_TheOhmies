import { useState } from 'react';
import type { TaskDraft } from '../types';
import { validateDraft, type DraftErrors } from '../lib/rules';
import { Modal } from './Shell';
import { TaskFields } from './TaskForm';
import { useUI } from '../ctx';
import { errMsg } from '../supabase';
import WORKSTREAMS from '../../config/workstreams.json';

export function NewTask({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { board } = useUI();
  const [d, setD] = useState<TaskDraft>({
    title: '', owner_id: board.me?.id ?? '', supporters: [], workstream: WORKSTREAMS[0], start_date: null, due_date: board.thursday, event_id: null,
    deliverable: '', priority: 'Medium', col: 'backlog', blocked: false, blocker: '', dependencies: '',
  });
  const [errors, setErrors] = useState<DraftErrors>({});
  const [fail, setFail] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateDraft(d);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      const t = await board.createTask({ ...d, blocker: d.blocked ? d.blocker : null, dependencies: d.dependencies?.trim() || null });
      if (t) onCreated(t.id);
    } catch (err) { setFail(errMsg(err)); }
  }

  return (
    <Modal title="New task" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <TaskFields d={d} set={(p) => setD({ ...d, ...p })} people={board.people} events={board.events} errors={errors} showColumn />
        {fail && <p className="form-err" role="alert">{fail}</p>}
        <div className="row end">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={board.saving > 0}>{board.saving > 0 ? 'Saving…' : 'Create task'}</button>
        </div>
      </form>
    </Modal>
  );
}
