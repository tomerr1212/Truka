import { ActionSubtype, ClashResult, MaculeleChange } from '../types';

// ─── Collision Table (confirmed by game designer) ────────────────────────────
//
//  Kick     vs Evasion   → nothing
//  Kick     vs Knockdown → Kick receives maculelê
//  Kick     vs Kick      → both receive maculelê
//  Evasion  vs Knockdown → Knockdown receives maculelê
//  Evasion  vs Evasion   → no maculelê, both play follow-up
//  Knockdown vs Knockdown → both receive maculelê

export type CollisionOutcome =
  | { type: 'nothing' }
  | { type: 'maculele'; loser: 'attacker' | 'defender' | 'both' }
  | { type: 'followup' };

export function resolveCollision(
  attacker: ActionSubtype,
  defender: ActionSubtype
): CollisionOutcome {
  if (attacker === 'kick' && defender === 'evasion') return { type: 'nothing' };
  if (attacker === 'evasion' && defender === 'kick') return { type: 'nothing' };

  if (attacker === 'kick' && defender === 'knockdown') return { type: 'maculele', loser: 'attacker' };
  if (attacker === 'knockdown' && defender === 'kick') return { type: 'maculele', loser: 'defender' };

  if (attacker === 'kick' && defender === 'kick') return { type: 'maculele', loser: 'both' };
  if (attacker === 'knockdown' && defender === 'knockdown') return { type: 'maculele', loser: 'both' };

  if (attacker === 'evasion' && defender === 'knockdown') return { type: 'maculele', loser: 'defender' };
  if (attacker === 'knockdown' && defender === 'evasion') return { type: 'maculele', loser: 'attacker' };

  if (attacker === 'evasion' && defender === 'evasion') return { type: 'followup' };

  // Unreachable with valid input, but satisfies TypeScript
  return { type: 'nothing' };
}

// ─── Floreo effect resolution ─────────────────────────────────────────────────
//
// Rules (confirmed):
// 1. Floreo doubles maculelê received by whoever would get it.
// 2. Exception: Kick vs. Evasion + either player used Floreo → BOTH remove 1.
// 3. If Troca/Compra landed on a card that had Floreo → that Floreo is canceled.
// 4. Floreo effects do not stack.
// 5. Evasion vs. Evasion + Floreo → Floreo burned, both play follow-up (no effect).

export interface FloreoState {
  attackerHasFloreо: boolean;
  defenderHasFloreо: boolean;
  attackerFloreoCanceled: boolean; // set to true when Troca/Compra replaces the card
  defenderFloreoCanceled: boolean;
}

export function applyFloreo(
  attackerId: string,
  defenderId: string,
  outcome: CollisionOutcome,
  attackerCard: ActionSubtype,
  defenderCard: ActionSubtype,
  floreo: FloreoState,
  baseMaculele: MaculeleChange[]
): MaculeleChange[] {
  const attackerFloreоActive = floreo.attackerHasFloreо && !floreo.attackerFloreoCanceled;
  const defenderFloreоActive = floreo.defenderHasFloreо && !floreo.defenderFloreoCanceled;
  const eitherFloreоActive = attackerFloreоActive || defenderFloreоActive;

  // Follow-up case: Floreo burned, no effect
  if (outcome.type === 'followup') return baseMaculele;

  // Kick vs Evasion special exception
  const isKickVsEvasion =
    (attackerCard === 'kick' && defenderCard === 'evasion') ||
    (attackerCard === 'evasion' && defenderCard === 'kick');

  if (isKickVsEvasion && eitherFloreоActive) {
    return [
      { playerId: attackerId, delta: -1, reason: 'floreo_kick_evasion_bonus' },
      { playerId: defenderId, delta: -1, reason: 'floreo_kick_evasion_bonus' },
    ];
  }

  // Nothing outcome — no maculelê to double
  if (outcome.type === 'nothing') return baseMaculele;

  // Standard doubling: double maculelê for whoever receives it
  if (!eitherFloreоActive) return baseMaculele;

  return baseMaculele.map((change) => {
    if (change.delta > 0) {
      return { ...change, delta: change.delta * 2, reason: 'floreo_double' as const };
    }
    return change;
  });
}

// ─── Full clash resolution ────────────────────────────────────────────────────

export function resolveClash(
  attackerId: string,
  defenderId: string,
  attackerCard: ActionSubtype,
  defenderCard: ActionSubtype,
  floreo: FloreoState
): ClashResult {
  const outcome = resolveCollision(attackerCard, defenderCard);

  // Base maculelê changes before Floreo
  let baseMaculele: MaculeleChange[] = [];

  if (outcome.type === 'maculele') {
    if (outcome.loser === 'attacker') {
      baseMaculele = [{ playerId: attackerId, delta: 1, reason: 'clash' }];
    } else if (outcome.loser === 'defender') {
      baseMaculele = [{ playerId: defenderId, delta: 1, reason: 'clash' }];
    } else {
      baseMaculele = [
        { playerId: attackerId, delta: 1, reason: 'clash' },
        { playerId: defenderId, delta: 1, reason: 'clash' },
      ];
    }
  }

  const finalMaculele = applyFloreo(
    attackerId,
    defenderId,
    outcome,
    attackerCard,
    defenderCard,
    floreo,
    baseMaculele
  );

  return {
    attackerId,
    defenderId,
    attackerCardSubtype: attackerCard,
    defenderCardSubtype: defenderCard,
    attackerFloreoCanceled: floreo.attackerFloreoCanceled,
    defenderFloreoCanceled: floreo.defenderFloreoCanceled,
    maculeleChanges: finalMaculele,
    requiresFollowUp: outcome.type === 'followup',
  };
}
