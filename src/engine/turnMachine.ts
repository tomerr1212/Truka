import { ActionSubtype, Card, Match, MaculeleChange, Player, TurnPhase } from '../types';
import { resolveClash, FloreoState } from './collision';
import { drawCards, getDrawCount } from './replenishment';
import {
  applyMaculeleChanges,
  applyJurema,
  eliminatePlayer,
  findJuremaCard,
  getNextAttackerId,
  getWinner,
} from './maculele';
import { STARTING_HAND_SIZE } from '../constants/deck';

// ─── Turn intent types (submitted by clients) ─────────────────────────────────

export type TurnIntent =
  | { type: 'PLAY_START_SPECIAL'; playerId: string; cardId: string; targetPlayerId?: string }
  | { type: 'PLAY_ACTION'; playerId: string; cardId: string; floreoCardId?: string }
  | { type: 'PLAY_TROCA'; playerId: string; trocaCardId: string; newActionCardId: string; floreoCardId?: string }
  | { type: 'PLAY_COMPRA'; playerId: string; compraCardId: string; newActionCardId: string; replacedPlayerId: string }
  | { type: 'SKIP_TURN' } // auto-skip on timer expiry

// ─── Turn context (resolved from staged actions) ──────────────────────────────

export interface StagedClash {
  attackerId: string;
  defenderId: string;
  attackerCardId: string;
  defenderCardId: string;
  attackerFloreoId: string | null;
  defenderFloreoId: string | null;
  isChamada: boolean;
  // Post-reveal modifications
  trocaPlayerId?: string;
  trocaReplacementCardId?: string;
  trocaFloreoId?: string | null;
  compraResolutions?: CompraResolution[];
}

export interface CompraResolution {
  compraPlayerId: string;
  replacedPlayerId: string;
  newActionCardId: string;
}

// ─── Resolve a completed clash and update match state ─────────────────────────

export function resolveCompletedClash(
  match: Match,
  staged: StagedClash,
  cardMap: Map<string, Card>
): Match {
  let state = { ...match, players: [...match.players] };

  // Determine effective cards after Troca and Compra
  const effectiveAttackerId = resolveEffectiveAttacker(staged);
  const effectiveDefenderId = resolveEffectiveDefender(staged);
  const effectiveAttackerCardId = resolveEffectiveAttackerCard(staged);
  const effectiveDefenderCardId = resolveEffectiveDefenderCard(staged);

  const attackerCard = cardMap.get(effectiveAttackerCardId);
  const defenderCard = cardMap.get(effectiveDefenderCardId);

  if (!attackerCard || !defenderCard) return state;

  // Determine Floreo state — canceled if Troca/Compra replaced the card
  const floreoState: FloreoState = buildFloreoState(staged, effectiveAttackerId, effectiveDefenderId);

  const clashResult = resolveClash(
    effectiveAttackerId,
    effectiveDefenderId,
    attackerCard.subtype as ActionSubtype,
    defenderCard.subtype as ActionSubtype,
    floreoState
  );

  if (clashResult.requiresFollowUp) {
    // Evasion vs Evasion — advance to follow-up sub-round
    return {
      ...state,
      turnPhase: 'ACTION_SELECTION',
      subRound: state.subRound + 1,
    };
  }

  // Apply maculelê changes
  const { players: afterMaculele, playersAtThreshold } = applyMaculeleChanges(
    state.players,
    clashResult.maculeleChanges
  );
  state = { ...state, players: afterMaculele };

  // Jurema / elimination for each player at threshold
  let eliminationOrder = state.players.filter((p) => p.isEliminated).length;

  for (const playerId of playersAtThreshold) {
    const player = state.players.find((p) => p.id === playerId)!;
    const juremaId = findJuremaCard(player, buildSubtypeMap(cardMap));

    if (juremaId) {
      // Jurema must be played immediately — auto-applied
      state = {
        ...state,
        players: state.players.map((p) =>
          p.id === playerId ? applyJurema(p, juremaId) : p
        ),
      };
    } else {
      eliminationOrder++;
      state = {
        ...state,
        players: state.players.map((p) =>
          p.id === playerId ? eliminatePlayer(p, eliminationOrder) : p
        ),
      };
    }
  }

  // Check win condition
  const winner = getWinner(state.players);
  if (winner) {
    return { ...state, status: 'finished', winnerId: winner.id, turnPhase: 'REPLENISH' };
  }

  // Move to replenishment
  return { ...state, turnPhase: 'REPLENISH', clashResult } as Match & { clashResult: typeof clashResult };
}

// ─── Replenish all players after clash ────────────────────────────────────────

export function replenishAfterClash(
  match: Match,
  lastCardByPlayer: Map<string, ActionSubtype>, // playerId → last action card subtype
  cardMap: Map<string, Card>
): Match {
  let deck = [...match.deck];
  let discard = [...match.discardPile];
  let players = [...match.players];

  for (const player of players) {
    if (player.isEliminated) continue;

    const lastCard = lastCardByPlayer.get(player.id);
    if (!lastCard) continue;

    const drawCount = getDrawCount(lastCard, player.hand.length);
    if (drawCount === 0) continue;

    const { drawn, deck: newDeck, discard: newDiscard } = drawCards(deck, discard, drawCount);
    deck = newDeck;
    discard = newDiscard;
    players = players.map((p) =>
      p.id === player.id ? { ...p, hand: [...p.hand, ...drawn] } : p
    );
  }

  const nextAttackerId = getNextAttackerId(players, match.currentAttackerId) ?? match.currentAttackerId;

  return {
    ...match,
    players,
    deck,
    discardPile: discard,
    turnPhase: 'START_OF_TURN',
    currentAttackerId: nextAttackerId,
    currentDefenderId: null,
    round: match.round + 1,
    subRound: 0,
  };
}

// ─── Empty hand protocol ──────────────────────────────────────────────────────
// Player has no action cards. Reveal hand (handled by client), discard, draw 4.

export function applyEmptyHandProtocol(
  match: Match,
  playerId: string
): Match {
  let deck = [...match.deck];
  let discard = [...match.discardPile];
  let players = [...match.players];

  const player = players.find((p) => p.id === playerId)!;

  // Move current hand to discard
  discard = [...discard, ...player.hand];

  // Draw fresh 4
  const { drawn, deck: newDeck, discard: newDiscard } = drawCards(deck, discard, STARTING_HAND_SIZE);
  deck = newDeck;
  discard = newDiscard;

  players = players.map((p) =>
    p.id === playerId ? { ...p, hand: drawn } : p
  );

  return { ...match, players, deck, discardPile: discard };
}

// ─── Agogô ────────────────────────────────────────────────────────────────────
// Draw up to 4 cards (draw 0 if already at 4+). Skip turn.

export function applyAgogo(
  match: Match,
  playerId: string,
  agogоCardId: string
): Match {
  let deck = [...match.deck];
  let discard = [...match.discardPile];
  let players = [...match.players];

  const player = players.find((p) => p.id === playerId)!;
  const drawCount = Math.max(0, STARTING_HAND_SIZE - player.hand.length);

  // Remove Agogô card from hand, add to discard
  const handWithout = player.hand.filter((id) => id !== agogоCardId);
  discard = [...discard, agogоCardId];

  let newHand = handWithout;
  if (drawCount > 0) {
    const { drawn, deck: d, discard: disc } = drawCards(deck, [...discard], drawCount);
    deck = d;
    discard = disc;
    newHand = [...handWithout, ...drawn];
  }

  players = players.map((p) =>
    p.id === playerId ? { ...p, hand: newHand } : p
  );

  const nextAttackerId = getNextAttackerId(players, playerId) ?? playerId;

  return {
    ...match,
    players,
    deck,
    discardPile: discard,
    turnPhase: 'START_OF_TURN',
    currentAttackerId: nextAttackerId,
    currentDefenderId: null,
    round: match.round + 1,
    subRound: 0,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildSubtypeMap(cardMap: Map<string, Card>): Map<string, string> {
  const m = new Map<string, string>();
  cardMap.forEach((card, id) => m.set(id, card.subtype));
  return m;
}

function resolveEffectiveAttacker(staged: StagedClash): string {
  if (staged.compraResolutions?.length) {
    const lastCompra = staged.compraResolutions[staged.compraResolutions.length - 1];
    if (lastCompra.replacedPlayerId === staged.attackerId) {
      return lastCompra.compraPlayerId;
    }
  }
  return staged.attackerId;
}

function resolveEffectiveDefender(staged: StagedClash): string {
  if (staged.compraResolutions?.length) {
    const lastCompra = staged.compraResolutions[staged.compraResolutions.length - 1];
    if (lastCompra.replacedPlayerId === staged.defenderId) {
      return lastCompra.compraPlayerId;
    }
  }
  return staged.defenderId;
}

function resolveEffectiveAttackerCard(staged: StagedClash): string {
  // Troca replacement
  if (staged.trocaPlayerId === staged.attackerId && staged.trocaReplacementCardId) {
    return staged.trocaReplacementCardId;
  }
  // Compra replacement
  if (staged.compraResolutions?.length) {
    const last = staged.compraResolutions[staged.compraResolutions.length - 1];
    if (last.replacedPlayerId === staged.attackerId) return last.newActionCardId;
  }
  return staged.attackerCardId;
}

function resolveEffectiveDefenderCard(staged: StagedClash): string {
  if (staged.trocaPlayerId === staged.defenderId && staged.trocaReplacementCardId) {
    return staged.trocaReplacementCardId;
  }
  if (staged.compraResolutions?.length) {
    const last = staged.compraResolutions[staged.compraResolutions.length - 1];
    if (last.replacedPlayerId === staged.defenderId) return last.newActionCardId;
  }
  return staged.defenderCardId;
}

function buildFloreoState(
  staged: StagedClash,
  effectiveAttackerId: string,
  effectiveDefenderId: string
): FloreoState {
  const attackerHadFloreo = !!staged.attackerFloreoId;
  const defenderHadFloreo = !!staged.defenderFloreoId;

  // Floreo canceled if Troca or Compra replaced the card that had Floreo
  const attackerReplaced =
    (staged.trocaPlayerId === staged.attackerId) ||
    staged.compraResolutions?.some((c) => c.replacedPlayerId === staged.attackerId);

  const defenderReplaced =
    (staged.trocaPlayerId === staged.defenderId) ||
    staged.compraResolutions?.some((c) => c.replacedPlayerId === staged.defenderId);

  return {
    attackerHasFloreо: attackerHadFloreo,
    defenderHasFloreо: defenderHadFloreo,
    attackerFloreoCanceled: attackerHadFloreo && !!attackerReplaced,
    defenderFloreoCanceled: defenderHadFloreo && !!defenderReplaced,
  };
}
