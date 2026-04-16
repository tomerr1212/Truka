import { Match, MaculeleChange, Player } from '../types';
import { ELIMINATION_THRESHOLD } from '../constants/deck';

// ─── Apply maculelê changes to player list ────────────────────────────────────
// Returns updated players and list of players who hit 5 (need Jurema check).

export interface MaculeleResult {
  players: Player[];
  playersAtThreshold: string[]; // player IDs who just reached 5
}

export function applyMaculeleChanges(
  players: Player[],
  changes: MaculeleChange[]
): MaculeleResult {
  const playersAtThreshold: string[] = [];

  const updated = players.map((p) => {
    const playerChanges = changes.filter((c) => c.playerId === p.id);
    if (playerChanges.length === 0) return p;

    const totalDelta = playerChanges.reduce((sum, c) => sum + c.delta, 0);
    const newCount = Math.max(0, p.maculeleCount + totalDelta);

    if (newCount >= ELIMINATION_THRESHOLD && !p.isEliminated) {
      playersAtThreshold.push(p.id);
    }

    return { ...p, maculeleCount: newCount };
  });

  return { players: updated, playersAtThreshold };
}

// ─── Jurema intercept ─────────────────────────────────────────────────────────
// Called when a player reaches 5 maculelê and holds a Jurema card.
// Returns updated player (count reset to 4, Jurema card removed from hand).

export function applyJurema(player: Player, juremaCardId: string): Player {
  return {
    ...player,
    maculeleCount: 4,
    hand: player.hand.filter((id) => id !== juremaCardId),
  };
}

// ─── Eliminate player ─────────────────────────────────────────────────────────

export function eliminatePlayer(
  player: Player,
  eliminationOrder: number
): Player {
  return {
    ...player,
    isEliminated: true,
    eliminationOrder,
    hand: [],
  };
}

// ─── Check win condition ──────────────────────────────────────────────────────

export function getWinner(players: Player[]): Player | null {
  const alive = players.filter((p) => !p.isEliminated);
  return alive.length === 1 ? alive[0] : null;
}

export function isDraw(players: Player[]): boolean {
  return players.filter((p) => !p.isEliminated).length === 0;
}

// ─── Get next attacker (seat order, skip eliminated) ─────────────────────────

export function getNextAttackerId(
  players: Player[],
  currentAttackerId: string
): string | null {
  const alive = players.filter((p) => !p.isEliminated);
  if (alive.length === 0) return null;
  const idx = alive.findIndex((p) => p.id === currentAttackerId);
  if (idx === -1) return alive[0]?.id ?? null;
  const nextIdx = (idx + 1) % alive.length;
  return alive[nextIdx].id;
}

// ─── Helper: does player hold a Jurema card? ─────────────────────────────────

export function findJuremaCard(
  player: Player,
  cardSubtypeMap: Map<string, string> // cardId → subtype
): string | null {
  return player.hand.find((id) => cardSubtypeMap.get(id) === 'jurema') ?? null;
}
