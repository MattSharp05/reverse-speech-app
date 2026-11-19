import type { Player, PlayerId } from './module';

export interface Standing {
  id: PlayerId;
  name: string;
  color: number;
  score: number;
  /** 1-based; tied players share a rank (1, 1, 3). */
  rank: number;
}

export function standings(players: readonly Player[], scores: Record<PlayerId, number>): Standing[] {
  const rows = players
    .map((p) => ({ id: p.id, name: p.name, color: p.color, score: scores[p.id] ?? 0, rank: 0 }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  rows.forEach((row, i) => {
    row.rank = i > 0 && rows[i - 1]!.score === row.score ? rows[i - 1]!.rank : i + 1;
  });
  return rows;
}

/** Everyone with the top score (empty when nobody scored). */
export function winners(rows: readonly Standing[]): PlayerId[] {
  const top = rows[0]?.score ?? 0;
  if (top <= 0) return [];
  return rows.filter((r) => r.score === top).map((r) => r.id);
}

export function addPoints(scores: Record<PlayerId, number>, id: PlayerId, points: number): void {
  scores[id] = (scores[id] ?? 0) + points;
}
