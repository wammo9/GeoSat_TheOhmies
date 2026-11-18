import { describe, expect, it } from 'vitest';
import { byRank, dropSide, effectiveRank, rankAt, renumbered, stampRank } from './order';

const card = (id: string, rank: number | null, updated = '2026-11-01T00:00:00Z') => ({ id, rank, updated_at: updated });

describe('column order', () => {
  it('shows the most recently placed card first by default', () => {
    const older = card('a', stampRank(Date.parse('2026-11-01T10:00:00Z')));
    const newer = card('b', stampRank(Date.parse('2026-11-05T10:00:00Z')));
    expect([older, newer].sort(byRank).map((c) => c.id)).toEqual(['b', 'a']);
  });
  it('honours a dragged position over the default', () => {
    const top = card('top', stampRank(Date.parse('2026-11-09T00:00:00Z')));
    const old = card('old', stampRank(Date.parse('2026-11-01T00:00:00Z')));
    const dragged = { ...old, rank: top.rank! - 1 }; // someone dragged the old card above the newest
    expect([top, dragged].sort(byRank).map((c) => c.id)).toEqual(['old', 'top']);
  });
  it('falls back to most-recently-changed when the database has no ranks yet, and breaks ties steadily', () => {
    const a = card('a', null, '2026-11-01T00:00:00Z'), b = card('b', null, '2026-11-09T00:00:00Z');
    expect([a, b].sort(byRank).map((c) => c.id)).toEqual(['b', 'a']);
    expect(effectiveRank(a)).toBeGreaterThan(effectiveRank(b));
    const x = card('x', 5), y = card('y', 5);
    expect([y, x].sort(byRank).map((c) => c.id)).toEqual(['x', 'y']); // same rank, same time: by id, so it never flickers
  });
});

describe('choosing a rank for a drop', () => {
  const ranks = [-300, -200, -100]; // top to bottom
  it('top, bottom and between', () => {
    expect(rankAt(ranks, 0).rank).toBe(-301);
    expect(rankAt(ranks, 3).rank).toBe(-99);
    expect(rankAt(ranks, 1).rank).toBe(-250);
    expect(rankAt(ranks, 2).rank).toBe(-150);
  });
  it('lands in the right slot once sorted', () => {
    for (let i = 0; i <= ranks.length; i++) {
      const r = rankAt(ranks, i).rank;
      expect([...ranks, r].sort((p, q) => p - q).indexOf(r)).toBe(i);
    }
  });
  it('into an empty column: newest on top', () => {
    expect(rankAt([], 0, 2_000_000).rank).toBe(-2000);
  });
  it('flags neighbours that are too close to split again', () => {
    expect(rankAt([-5, -5 + 1e-9], 1).tight).toBe(true);
    expect(rankAt([-5, -4], 1).tight).toBe(false);
  });
  it('renumbers a whole column evenly from the top', () => {
    expect(renumbered(3, -100)).toEqual([-101, -100, -99]);
  });
  it('decides before/after from the dragged card centre versus the card underneath', () => {
    expect(dropSide(110, 100, 100)).toBe('before'); // centre above the middle (150)
    expect(dropSide(190, 100, 100)).toBe('after');
    expect(dropSide(150, 100, 100)).toBe('after');
  });
});
