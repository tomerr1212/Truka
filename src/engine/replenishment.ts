import { ActionSubtype, ReplenishTarget } from '../types';
import { STARTING_HAND_SIZE } from '../constants/deck';

// ─── Replenishment rules (confirmed by game designer) ─────────────────────────
//
//  Last card = Kick      → complete hand to 5
//  Last card = Knockdown → complete hand to 4
//  Last card = Evasion   → no draw (stay with current hand)
//
//  "Last card" = the Troca replacement card if Troca was played.

export function getReplenishTarget(lastCard: ActionSubtype): ReplenishTarget {
  switch (lastCard) {
    case 'kick':      return 5;
    case 'knockdown': return STARTING_HAND_SIZE; // 4
    case 'evasion':   return 0; // no draw
  }
}

// Returns how many cards a player should draw.
// currentHandSize = cards currently in hand after playing action card.
export function getDrawCount(lastCard: ActionSubtype, currentHandSize: number): number {
  const target = getReplenishTarget(lastCard);
  if (target === 0) return 0;
  return Math.max(0, target - currentHandSize);
}

// ─── Deck utilities ───────────────────────────────────────────────────────────

export function shuffleDeck(deck: string[]): string[] {
  const copy = [...deck];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Draw `count` cards from the top of the deck.
// Returns { drawn, remainingDeck }.
// If deck runs out mid-draw, reshuffles discard into a new deck automatically.
export function drawCards(
  deck: string[],
  discard: string[],
  count: number
): { drawn: string[]; deck: string[]; discard: string[] } {
  let workingDeck = [...deck];
  let workingDiscard = [...discard];
  const drawn: string[] = [];

  for (let i = 0; i < count; i++) {
    if (workingDeck.length === 0) {
      if (workingDiscard.length === 0) break; // no cards anywhere — game edge case
      workingDeck = shuffleDeck(workingDiscard);
      workingDiscard = [];
    }
    drawn.push(workingDeck.shift()!);
  }

  return { drawn, deck: workingDeck, discard: workingDiscard };
}
