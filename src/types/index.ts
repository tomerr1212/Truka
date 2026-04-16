// ─── Card Types ──────────────────────────────────────────────────────────────

export type ActionSubtype = 'kick' | 'evasion' | 'knockdown';

export type SpecialSubtype =
  | 'malandragem'
  | 'jurema'
  | 'troca'
  | 'chamada'
  | 'compra'
  | 'agogo';

export type CardSubtype = ActionSubtype | SpecialSubtype | 'floreo';

export type CardType = 'action' | 'special' | 'floreo';

export interface Card {
  id: string;
  type: CardType;
  subtype: CardSubtype;
  nameHe: string;
  namePt: string;
  descriptionHe: string;
  imageAsset: string;
}

// ─── Turn Phases ─────────────────────────────────────────────────────────────

export type TurnPhase =
  | 'START_OF_TURN'    // Malandragem / Chamada / Agogô window
  | 'ACTION_SELECTION' // attacker + defender place cards face-down
  | 'REVEAL'
  | 'BURN_REVEAL'      // player with no action cards exposes hand to all before penalty
  | 'JUREMA_REVEAL'   // Jurema saved a player — show notification before advancing
  | 'POST_REVEAL'      // Troca / Compra window
  | 'RESOLUTION'       // maculelê applied, eliminations checked
  | 'REPLENISH';

// ─── Player ───────────────────────────────────────────────────────────────────

export interface Player {
  id: string;
  displayName: string;
  hand: string[];          // card IDs; readable only by owner in Firebase
  maculeleCount: number;   // 0–4 active; reaching 5 triggers Jurema check or elimination
  isEliminated: boolean;
  eliminationOrder?: number;
  isConnected: boolean;
  isReady: boolean;
}

// ─── Staged Action (server-side, opaque to opponents) ────────────────────────

export interface StagedAction {
  playerId: string;
  actionCardId: string;
  floreoAttached: boolean;
  isFaceUp: boolean;       // true when Chamada is active
  submittedAt: number;
}

// ─── Clash Result ─────────────────────────────────────────────────────────────

export interface MaculeleChange {
  playerId: string;
  delta: number;           // positive = gained, negative = removed
  reason: 'clash' | 'floreo_double' | 'floreo_kick_evasion_bonus';
}

export interface ClashResult {
  attackerId: string;
  defenderId: string;
  attackerCardSubtype: ActionSubtype;
  defenderCardSubtype: ActionSubtype;
  attackerFloreoCanceled: boolean; // Troca/Compra landed on Floreo card
  defenderFloreoCanceled: boolean;
  maculeleChanges: MaculeleChange[];
  requiresFollowUp: boolean;       // true on Evasion vs. Evasion
}

// ─── Match ────────────────────────────────────────────────────────────────────

export type MatchStatus = 'lobby' | 'active' | 'finished';

export interface Match {
  id: string;
  status: MatchStatus;
  currentAttackerId: string;
  currentDefenderId: string | null;
  chamadaPlayerId?: string | null;
  burnRevealPlayerId?: string | null;  // set during BURN_REVEAL phase
  burnRevealHand?: string[] | null;    // exposed hand (readable by all during reveal)
  juremaPlayerId?: string | null;      // set during JUREMA_REVEAL phase
  turnPhase: TurnPhase;
  round: number;
  subRound: number;        // increments on Evasion vs. Evasion chain
  deck: string[];          // card IDs
  discardPile: string[];
  players: Player[];
  winnerId?: string;
  isDraw?: boolean;
  createdAt: number;
}

// ─── Game Events (for log / replay) ──────────────────────────────────────────

export type GameEventType =
  | 'SPECIAL_ACTIVATED'
  | 'ACTION_STAGED'
  | 'CLASH_RESOLVED'
  | 'FOLLOWUP_REQUIRED'
  | 'MACULELE_CHANGED'
  | 'JUREMA_PLAYED'
  | 'PLAYER_ELIMINATED'
  | 'CARDS_REPLENISHED'
  | 'EMPTY_HAND_PROTOCOL'
  | 'MATCH_STARTED'
  | 'MATCH_FINISHED';

export interface GameEvent {
  type: GameEventType;
  actorId: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

// ─── Replenishment ────────────────────────────────────────────────────────────

export type ReplenishTarget = 5 | 4 | 0; // Kick→5, Knockdown→4, Evasion→0 (no draw)
