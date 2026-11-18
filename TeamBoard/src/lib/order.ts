import type { Task } from '../types';

/** What the database stamps on a newly placed card: later = a lower number = nearer the top. */
export const stampRank = (nowMs: number = Date.now()) => -nowMs / 1000;

/** A card's position number; for a database without the ordering upgrade, fall back to "most recently changed first". */
export const effectiveRank = (t: Pick<Task, 'rank' | 'updated_at'>): number => t.rank ?? -Date.parse(t.updated_at) / 1000;

/** Column order: lowest rank first (the most recently placed card, unless someone dragged it elsewhere). */
export const byRank = (a: Pick<Task, 'id' | 'rank' | 'updated_at'>, b: Pick<Task, 'id' | 'rank' | 'updated_at'>) =>
  effectiveRank(a) - effectiveRank(b) || b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id);

export interface RankChoice {
  rank: number;
  /** The neighbours are so close that another halving would lose precision: renumber the column instead. */
  tight: boolean;
}

/**
 * The rank for a card dropped at `index` among cards whose ranks are `ranks` (already sorted, without the dragged card).
 * First -> a little above the top card, last -> a little below the bottom one, otherwise halfway between its neighbours.
 */
export function rankAt(ranks: number[], index: number, now: number = Date.now()): RankChoice {
  if (ranks.length === 0) return { rank: stampRank(now), tight: false };
  if (index <= 0) return { rank: ranks[0] - 1, tight: false };
  if (index >= ranks.length) return { rank: ranks[ranks.length - 1] + 1, tight: false };
  const above = ranks[index - 1], below = ranks[index];
  return { rank: (above + below) / 2, tight: Math.abs(below - above) < 1e-6 };
}

/** Evenly spaced ranks (starting a little above the current top) for a full column in its new order. */
export function renumbered(count: number, topRank: number): number[] {
  return Array.from({ length: count }, (_, i) => topRank - 1 + i);
}

/** Where a card was dropped relative to the card under it: above or below its vertical middle. */
export const dropSide = (draggedCenterY: number, overTop: number, overHeight: number): 'before' | 'after' =>
  draggedCenterY < overTop + overHeight / 2 ? 'before' : 'after';
