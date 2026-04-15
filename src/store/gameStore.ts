import { create } from 'zustand';
import { Card, Match, Player } from '../types';
import { buildCardDefinitions } from '../constants/deck';
import { getLegalCardIds, buildLegalityContext } from '../engine/legality';

// ─── Card definitions (loaded once) ──────────────────────────────────────────

export const CARD_MAP: Map<string, Card> = buildCardDefinitions();

// ─── Game store ───────────────────────────────────────────────────────────────

interface GameState {
  // Auth
  localPlayerId: string | null;
  localDisplayName: string;

  // Room
  roomCode: string | null;

  // Match
  match: Match | null;
  myHand: string[];           // card IDs — fetched separately (security rules)
  legalCardIds: Set<string>;  // computed from match + hand

  // UI state
  selectedCardId: string | null;
  selectedFloreoId: string | null;
  pendingSpecial: string | null; // card ID of special being staged
  revealVisible: boolean;
  peekHand: string[] | null;    // Malandragem peek result
  peekPlayerName: string | null;

  // Actions
  setLocalPlayer: (id: string, name: string) => void;
  setRoomCode: (code: string | null) => void;
  setMatch: (match: Match | null) => void;
  setMyHand: (hand: string[]) => void;
  selectCard: (cardId: string | null) => void;
  selectFloreo: (cardId: string | null) => void;
  setPendingSpecial: (cardId: string | null) => void;
  setRevealVisible: (v: boolean) => void;
  setPeekHand: (hand: string[] | null, playerName?: string | null) => void;
  recomputeLegal: () => void;
}

export const useGameStore = create<GameState>((set, get) => ({
  localPlayerId: null,
  localDisplayName: '',
  roomCode: null,
  match: null,
  myHand: [],
  legalCardIds: new Set(),
  selectedCardId: null,
  selectedFloreoId: null,
  pendingSpecial: null,
  revealVisible: false,
  peekHand: null,
  peekPlayerName: null,

  setLocalPlayer: (id, name) => set({ localPlayerId: id, localDisplayName: name }),
  setRoomCode: (code) => set({ roomCode: code }),

  setMatch: (match) => {
    set({ match });
    // Sync local player's hand from match data.
    // In production this is gated by Firebase security rules (owner-only read).
    // In dev/test mode all data is readable, so we pull it directly from the match.
    const localId = get().localPlayerId;
    if (match && localId) {
      const me = match.players.find((p) => p.id === localId);
      set({ myHand: me?.hand ?? [] });
    }
    get().recomputeLegal();
  },

  setMyHand: (hand) => {
    set({ myHand: hand });
    get().recomputeLegal();
  },

  selectCard: (cardId) => set({ selectedCardId: cardId }),
  selectFloreo: (cardId) => set({ selectedFloreoId: cardId }),
  setPendingSpecial: (cardId) => set({ pendingSpecial: cardId }),
  setRevealVisible: (v) => set({ revealVisible: v }),
  setPeekHand: (hand, playerName = null) => set({ peekHand: hand, peekPlayerName: hand ? playerName : null }),

  recomputeLegal: () => {
    const { match, localPlayerId, myHand } = get();
    if (!match || !localPlayerId) {
      set({ legalCardIds: new Set() });
      return;
    }

    // Inject local hand into match player for legality check
    const matchWithHand: Match = {
      ...match,
      players: match.players.map((p) =>
        p.id === localPlayerId ? { ...p, hand: myHand } : p
      ),
    };

    const ctx = buildLegalityContext(matchWithHand, localPlayerId, CARD_MAP);
    set({ legalCardIds: getLegalCardIds(ctx) });
  },
}));

// ─── Derived selectors ────────────────────────────────────────────────────────

export function selectLocalPlayer(state: GameState): Player | null {
  if (!state.match || !state.localPlayerId) return null;
  return state.match.players.find((p) => p.id === state.localPlayerId) ?? null;
}

export function selectOpponents(state: GameState): Player[] {
  if (!state.match || !state.localPlayerId) return [];
  return state.match.players.filter(
    (p) => p.id !== state.localPlayerId && !p.isEliminated
  );
}

export function selectIsMyTurn(state: GameState): boolean {
  return state.match?.currentAttackerId === state.localPlayerId;
}
