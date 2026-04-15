import { Card, CardSubtype, Match, Player, TurnPhase } from '../types';

// ─── Card legality checker ────────────────────────────────────────────────────
// Returns which cards in a player's hand are legally playable given the
// current match state. The UI greys out anything not in this set.

export interface LegalityContext {
  match: Match;
  player: Player;
  cardMap: Map<string, Card>;
  // Derived flags
  isAttacker: boolean;
  isDefender: boolean;
  isThirdParty: boolean;
  isChamadaActive: boolean; // current turn started with Chamada
}

export function buildLegalityContext(
  match: Match,
  playerId: string,
  cardMap: Map<string, Card>
): LegalityContext {
  return {
    match,
    player: match.players.find((p) => p.id === playerId)!,
    cardMap,
    isAttacker: match.currentAttackerId === playerId,
    isDefender: match.currentDefenderId === playerId,
    isThirdParty:
      match.currentAttackerId !== playerId &&
      match.currentDefenderId !== playerId,
    isChamadaActive: false, // set by turn state when Chamada is in play
  };
}

// Returns the set of card IDs that are legally playable right now.
export function getLegalCardIds(ctx: LegalityContext): Set<string> {
  const legal = new Set<string>();

  for (const cardId of ctx.player.hand) {
    if (isCardLegal(cardId, ctx)) {
      legal.add(cardId);
    }
  }

  return legal;
}

function isCardLegal(cardId: string, ctx: LegalityContext): boolean {
  const card = ctx.cardMap.get(cardId);
  if (!card) return false;

  const { match, isAttacker, isDefender, isThirdParty } = ctx;
  const phase = match.turnPhase;

  switch (card.subtype as CardSubtype) {
    // ── Action cards ──────────────────────────────────────────────────────────
    case 'kick':
    case 'evasion':
    case 'knockdown':
      // Legal in ACTION_SELECTION for attacker or defender
      return phase === 'ACTION_SELECTION' && (isAttacker || isDefender);

    // ── Floreo ────────────────────────────────────────────────────────────────
    // Never a standalone play. Attachment legality is gated in the UI only
    // when an action card is already selected (isLegalForFloreo check).
    case 'floreo':
      return false;

    // ── Troca ─────────────────────────────────────────────────────────────────
    // Either attacker or defender may play Troca in POST_REVEAL.
    case 'troca':
      return phase === 'POST_REVEAL' && (isAttacker || isDefender);

    // ── Compra ────────────────────────────────────────────────────────────────
    // Only a third-party (not attacker, not defender) may play Compra.
    case 'compra':
      return phase === 'POST_REVEAL' && isThirdParty;

    // ── Malandragem ───────────────────────────────────────────────────────────
    case 'malandragem':
      return phase === 'START_OF_TURN' && isAttacker;

    // ── Chamada ───────────────────────────────────────────────────────────────
    case 'chamada':
      return phase === 'START_OF_TURN' && isAttacker;

    // ── Agogô ─────────────────────────────────────────────────────────────────
    case 'agogo':
      return phase === 'START_OF_TURN' && isAttacker;

    // ── Jurema ────────────────────────────────────────────────────────────────
    // Jurema is triggered automatically when a player reaches 5 maculelê —
    // not played from the hand menu. Excluded from normal legality.
    case 'jurema':
      return false;

    default:
      return false;
  }
}

// ─── Can a player attach Floreo to a given action card? ──────────────────────
// Returns false if the player already used Floreo this sub-round, or if
// Floreo effects don't stack.
export function canAttachFloreo(
  player: Player,
  cardMap: Map<string, Card>,
  alreadyAttachedFloreo: boolean
): boolean {
  if (alreadyAttachedFloreo) return false;
  return player.hand.some((id) => cardMap.get(id)?.subtype === 'floreo');
}
