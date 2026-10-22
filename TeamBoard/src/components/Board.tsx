import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, DragOverlay, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { useCallback, useState } from 'react';
import type { ColId, Task } from '../types';
import { byDueThenPriority } from '../lib/filters';
import { COLUMNS } from '../lib/rules';
import { Badges, DueDate, OwnerChip } from './Chips';
import { useUI } from '../ctx';

const tilt = (id: string) => ((parseInt(id.replace(/-/g, '').slice(0, 4), 16) % 9) - 4) / 5; // -0.8..0.8 deg

function CardBody({ task, floating }: { task: Task; floating?: boolean }) {
  const { board, openTask, move } = useUI();
  const owner = board.person(task.owner_id);
  return (
    <>
      <span className="tape" aria-hidden="true" />
      <button className="card-title" onClick={() => openTask(task.id)}>{task.title}</button>
      <div className="card-row"><OwnerChip person={owner} /></div>
      <div className="card-row"><DueDate task={task} today={board.today} /><span className="tag">{task.workstream}</span></div>
      <div className="card-row"><Badges task={task} today={board.today} /></div>
      {task.blocked && task.blocker && <p className="card-blocker">{task.blocker}</p>}
      {!floating && (
        <label className="move">
          <span className="sr-only">Move “{task.title}” to column</span>
          <select value="" aria-label={`Move “${task.title}” to`} onChange={(e) => e.target.value && move(task, e.target.value as ColId)}>
            <option value="">Move to…</option>
            {COLUMNS.filter((c) => c.id !== task.col).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </label>
      )}
    </>
  );
}

function Card({ task }: { task: Task }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: task.id });
  const { board } = useUI();
  const ref = useCallback((n: HTMLElement | null) => { setNodeRef(n); setActivatorNodeRef(n); }, [setNodeRef, setActivatorNodeRef]);
  const overdue = task.col !== 'completed' && task.due_date < board.today;
  return (
    <article
      ref={ref}
      {...attributes}
      {...listeners}
      role="group"
      aria-label={task.title}
      className={`card pri-${task.priority.toLowerCase()}${overdue ? ' is-overdue' : ''}${task.blocked ? ' is-blocked' : ''}${isDragging ? ' dragging' : ''}`}
      style={{ ['--tilt' as any]: `${tilt(task.id)}deg`, ['--owner' as any]: board.person(task.owner_id)?.color ?? '#9fb3c8' }}
    >
      <CardBody task={task} />
    </article>
  );
}

function Column({ id, title, tasks, total }: { id: ColId; title: string; tasks: Task[]; total: number }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section ref={setNodeRef} className={`col${isOver ? ' over' : ''}`} aria-labelledby={`h-${id}`}>
      <h2 id={`h-${id}`}>{title} <span className="count" aria-label={`${tasks.length} of ${total} tasks`}>{tasks.length}</span></h2>
      <div className="col-body">
        {tasks.map((t) => <Card key={t.id} task={t} />)}
        {tasks.length === 0 && <p className="col-empty">{total ? 'No matching tasks' : 'Drop a task here'}</p>}
      </div>
    </section>
  );
}

export function KanbanBoard({ tasks, allTasks }: { tasks: Task[]; allTasks: Task[] }) {
  const { board, move } = useUI();
  const [dragging, setDragging] = useState<Task | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const onStart = (e: DragStartEvent) => setDragging(allTasks.find((t) => t.id === e.active.id) ?? null);
  const onEnd = (e: DragEndEvent) => {
    setDragging(null);
    const t = allTasks.find((x) => x.id === e.active.id);
    if (t && e.over && e.over.id !== t.col) move(t, e.over.id as ColId);
  };
  return (
    <DndContext sensors={sensors} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setDragging(null)}>
      <div className="kanban">
        {COLUMNS.map((c) => (
          <Column key={c.id} id={c.id} title={c.title} total={allTasks.filter((t) => t.col === c.id).length}
            tasks={tasks.filter((t) => t.col === c.id).sort(byDueThenPriority)} />
        ))}
      </div>
      <DragOverlay>{dragging ? <article className="card floating" style={{ ['--owner' as any]: board.person(dragging.owner_id)?.color ?? '#9fb3c8' }}><CardBody task={dragging} floating /></article> : null}</DragOverlay>
    </DndContext>
  );
}
