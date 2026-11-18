import { DndContext, KeyboardSensor, PointerSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors, DragOverlay, type CollisionDetection, type DragEndEvent, type DragMoveEvent, type DragStartEvent } from '@dnd-kit/core';
import { useCallback, useState } from 'react';
import type { ColId, Task } from '../types';
import { byRank, dropSide, effectiveRank, rankAt, renumbered } from '../lib/order';
import { COLUMNS, isArchived } from '../lib/rules';
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
          <select value="" aria-label={`Move “${task.title}” to`}
            onChange={(e) => { const v = e.target.value; if (v === '__archive') board.archiveTask(task, true); else if (v) move(task, v as ColId); }}>
            <option value="">Move to…</option>
            {COLUMNS.filter((c) => c.id !== task.col).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            {task.col === 'completed' && <option value="__archive">📦 Move to Archive</option>}
          </select>
        </label>
      )}
    </>
  );
}

type DropMark = { id: string; side: 'before' | 'after' } | null;

function Card({ task, mark }: { task: Task; mark: DropMark }) {
  // every card is both something you can drag and a target you can drop onto (to land above or below it)
  const { attributes, listeners, setNodeRef: setDragRef, setActivatorNodeRef, isDragging } = useDraggable({ id: task.id });
  const { setNodeRef: setDropRef } = useDroppable({ id: task.id });
  const { board } = useUI();
  const ref = useCallback((n: HTMLElement | null) => { setDragRef(n); setActivatorNodeRef(n); setDropRef(n); }, [setDragRef, setActivatorNodeRef, setDropRef]);
  const overdue = task.col !== 'completed' && task.due_date < board.today;
  return (
    <article
      ref={ref}
      {...attributes}
      {...listeners}
      role="group"
      aria-label={task.title}
      className={`card pri-${task.priority.toLowerCase()}${overdue ? ' is-overdue' : ''}${task.blocked ? ' is-blocked' : ''}${isDragging ? ' dragging' : ''}${mark ? ` drop-${mark.side}` : ''}`}
      style={{ ['--tilt' as any]: `${tilt(task.id)}deg`, ['--owner' as any]: board.person(task.owner_id)?.color ?? '#9fb3c8' }}
    >
      <CardBody task={task} />
    </article>
  );
}

function Column({ id, title, tasks, total, mark }: { id: ColId; title: string; tasks: Task[]; total: number; mark: DropMark }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section ref={setNodeRef} className={`col${isOver ? ' over' : ''}`} aria-labelledby={`h-${id}`}>
      <h2 id={`h-${id}`}>{title} <span className="count" aria-label={`${tasks.length} of ${total} tasks`}>{tasks.length}</span></h2>
      <div className="col-body">
        {tasks.map((t) => <Card key={t.id} task={t} mark={mark?.id === t.id ? mark : null} />)}
        {tasks.length === 0 && <p className="col-empty">{total ? 'No matching tasks' : 'Drop a task here'}</p>}
      </div>
    </section>
  );
}

export function KanbanBoard({ tasks, allTasks }: { tasks: Task[]; allTasks: Task[] }) {
  const { board, place } = useUI();
  const [dragging, setDragging] = useState<Task | null>(null);
  const [mark, setMark] = useState<DropMark>(null);
  const now = Date.now();
  // the Completed column only shows recent completions; older ones live in the Archive tab
  const inColumn = (id: ColId, list: Task[]) => list.filter((t) => t.col === id && !(id === 'completed' && isArchived(t, now)));
  // newest placement first; dragging sets the order from there
  const ordered = (id: ColId, list: Task[] = tasks) => inColumn(id, list).sort(byRank);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const isCard = (id: unknown) => allTasks.some((t) => t.id === id);
  // prefer the card under the pointer (to drop above/below it); otherwise the column itself
  const collision: CollisionDetection = (args) => {
    const hits = pointerWithin(args);
    const found = hits.length ? hits : rectIntersection(args);
    const cards = found.filter((c) => isCard(c.id) && c.id !== args.active.id);
    return cards.length ? [cards[0]] : found.filter((c) => !isCard(c.id));
  };

  const centerY = (e: { active: { rect: { current: { translated: { top: number; height: number } | null } } } }) => {
    const r = e.active.rect.current.translated;
    return r ? r.top + r.height / 2 : null;
  };
  const side = (e: DragMoveEvent | DragEndEvent): DropMark => {
    const over = e.over;
    const y = centerY(e);
    if (!over || y === null || !isCard(over.id) || over.id === e.active.id) return null;
    return { id: String(over.id), side: dropSide(y, over.rect.top, over.rect.height) };
  };
  const onStart = (e: DragStartEvent) => setDragging(allTasks.find((t) => t.id === e.active.id) ?? null);
  const onMove = (e: DragMoveEvent) => setMark(side(e));

  const onEnd = async (e: DragEndEvent) => {
    const m = side(e);
    setDragging(null); setMark(null);
    const moved = allTasks.find((x) => x.id === e.active.id);
    if (!moved || !e.over) return;

    // where did it land? on a card (above/below it), or on a column's empty space (top of that column)
    const target = allTasks.find((x) => x.id === e.over!.id);
    const col = (target ? target.col : e.over.id) as ColId;
    const others = ordered(col).filter((x) => x.id !== moved.id);
    const ranks = others.map(effectiveRank);
    if (!target) {
      if (col === moved.col) return; // dropped on its own column's background: nothing to change
      await place(moved, col, rankAt(ranks, 0).rank); // onto a column's empty space: the top, like any new placement
      return;
    }
    if (target.id === moved.id || !m) return;
    const at = others.findIndex((x) => x.id === target.id) + (m.side === 'after' ? 1 : 0);
    const choice = rankAt(ranks, at);
    if (!choice.tight) { await place(moved, col, choice.rank); return; }
    // neighbours too close to split again: spread the whole column out evenly in its new order
    const finalOrder = [...others.slice(0, at), moved, ...others.slice(at)];
    const fresh = renumbered(finalOrder.length, ranks[0] ?? 0);
    await board.renumberCards(finalOrder.map((t, i) => ({ task: t, rank: fresh[i], ...(t.id === moved.id && t.col !== col ? { col } : {}) })));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onStart} onDragMove={onMove} onDragEnd={onEnd} onDragCancel={() => { setDragging(null); setMark(null); }}>
      <div className="kanban">
        {COLUMNS.map((c) => (
          <Column key={c.id} id={c.id} title={c.title} total={inColumn(c.id, allTasks).length}
            tasks={ordered(c.id)} mark={mark} />
        ))}
      </div>
      <DragOverlay>{dragging ? <article className="card floating" style={{ ['--owner' as any]: board.person(dragging.owner_id)?.color ?? '#9fb3c8' }}><CardBody task={dragging} floating /></article> : null}</DragOverlay>
    </DndContext>
  );
}
