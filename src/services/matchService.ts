import {
  ref,
  set,
  get,
  onValue,
  update,
  push,
  off,
} from 'firebase/database';
import { getDb } from './firebase';
import { Match, Player, StagedAction } from '../types';
import { buildDeckIds } from '../constants/deck';
import { shuffleDeck, drawCards } from '../engine/replenishment';
import { STARTING_HAND_SIZE } from '../constants/deck';

// ─── Room ─────────────────────────────────────────────────────────────────────

export interface Room {
  code: string;
  hostId: string;
  matchId: string | null;
  players: Record<string, { displayName: string; isReady: boolean }>;
  maxPlayers: number;
  createdAt: number;
}

// Generate a 6-character alphanumeric room code
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export async function createRoom(
  hostId: string,
  displayName: string,
  maxPlayers: number = 4
): Promise<Room> {
  const db = getDb();
  const code = generateRoomCode();

  const room: Room = {
    code,
    hostId,
    matchId: null,
    players: { [hostId]: { displayName, isReady: false } },
    maxPlayers,
    createdAt: Date.now(),
  };

  await set(ref(db, `rooms/${code}`), room);
  return room;
}

export async function joinRoom(
  code: string,
  playerId: string,
  displayName: string
): Promise<Room> {
  const db = getDb();
  const roomRef = ref(db, `rooms/${code}`);
  const snap = await get(roomRef);

  if (!snap.exists()) throw new Error('Room not found');
  const room = snap.val() as Room;

  if (room.matchId) throw new Error('Match already started');
  if (Object.keys(room.players).length >= room.maxPlayers) throw new Error('Room full');

  await update(ref(db, `rooms/${code}/players`), {
    [playerId]: { displayName, isReady: false },
  });

  return { ...room, players: { ...room.players, [playerId]: { displayName, isReady: false } } };
}

export async function setReady(code: string, playerId: string, ready: boolean): Promise<void> {
  await update(ref(getDb(), `rooms/${code}/players/${playerId}`), { isReady: ready });
}

export function subscribeToRoom(code: string, cb: (room: Room) => void): () => void {
  const r = ref(getDb(), `rooms/${code}`);
  const unsub = onValue(r, (snap) => { if (snap.exists()) cb(snap.val() as Room); });
  return () => off(r, 'value', unsub as any);
}

// ─── Match creation ───────────────────────────────────────────────────────────

export async function startMatch(room: Room): Promise<Match> {
  const db = getDb();

  const playerIds = Object.keys(room.players);
  const MIN_PLAYERS = __DEV__ ? 1 : 3;
  if (playerIds.length < MIN_PLAYERS) throw new Error(`Need at least ${MIN_PLAYERS} players`);

  // Shuffle and deal
  let deck = shuffleDeck(buildDeckIds());
  const players: Player[] = [];

  for (const id of playerIds) {
    const { drawn, deck: remaining } = drawCards(deck, [], STARTING_HAND_SIZE);
    deck = remaining;
    players.push({
      id,
      displayName: room.players[id].displayName,
      hand: drawn,
      maculeleCount: 0,
      isEliminated: false,
      isConnected: true,
      isReady: true,
    });
  }

  const match: Match = {
    id: push(ref(db, 'matches')).key!,
    status: 'active',
    currentAttackerId: playerIds[0],
    currentDefenderId: null,
    chamadaPlayerId: null,
    turnPhase: 'START_OF_TURN',
    round: 1,
    subRound: 0,
    deck,
    discardPile: [],
    players,
    createdAt: Date.now(),
  };

  await set(ref(db, `matches/${match.id}`), match);

  // Each player's hand stored separately for security
  for (const player of players) {
    await set(ref(db, `matches/${match.id}/players/${player.id}/hand`), player.hand);
  }

  // Link match to room
  await update(ref(db, `rooms/${room.code}`), {
    matchId: match.id,
    players: Object.fromEntries(
      Object.entries(room.players).map(([id, info]) => [id, { ...info, isReady: false }])
    ),
  });

  return match;
}

// ─── Firebase array normalization ────────────────────────────────────────────
// Firebase Realtime DB stores JS arrays as {0: ..., 1: ...} objects.
// This converts them back to proper arrays wherever needed.

function toArray<T>(val: T[] | Record<string, T> | null | undefined): T[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return Object.values(val);
}

function normalizeMatch(raw: any): Match {
  // Filter out partial entries created by startMatch's per-player hand writes
  // (those use player UIDs as keys, colliding with the array's numeric keys).
  const players = toArray<any>(raw.players)
    .filter((p: any) => !!p?.id)
    .map((p: any) => ({
      ...p,
      hand: toArray<string>(p.hand),
    }));

  return {
    ...raw,
    players,
    deck: toArray<string>(raw.deck),
    discardPile: toArray<string>(raw.discardPile),
    burnRevealHand: raw.burnRevealHand ? toArray<string>(raw.burnRevealHand) : null,
  };
}

// ─── Match subscription ────────────────────────────────────────────────────────

export function subscribeToMatch(matchId: string, cb: (match: Match) => void): () => void {
  const r = ref(getDb(), `matches/${matchId}`);
  const unsub = onValue(r, (snap) => {
    if (snap.exists()) cb(normalizeMatch(snap.val()));
  });
  return () => off(r, 'value', unsub as any);
}

// ─── Staged action submission (client → server staging area) ──────────────────

export async function stageAction(
  matchId: string,
  playerId: string,
  action: StagedAction
): Promise<void> {
  await set(ref(getDb(), `staging/${matchId}/${playerId}`), action);
}

export async function clearStaging(matchId: string): Promise<void> {
  await set(ref(getDb(), `staging/${matchId}`), null);
}

// ─── Client-side match state writes (used until Cloud Functions are deployed) ─

// Writes a partial match update to Firebase.
// Used for client-side turn driving until Cloud Functions are deployed.
export async function writeMatchUpdate(
  matchId: string,
  partial: Record<string, unknown>
): Promise<void> {
  await update(ref(getDb(), `matches/${matchId}`), partial);
}

// Overwrites the full match document (used after clash resolution).
export async function writeFullMatch(matchId: string, match: Match): Promise<void> {
  await set(ref(getDb(), `matches/${matchId}`), match);
}

export function subscribeToStaging(
  matchId: string,
  cb: (staging: Record<string, StagedAction>) => void
): () => void {
  const r = ref(getDb(), `staging/${matchId}`);
  const unsub = onValue(r, (snap) => { cb((snap.val() ?? {}) as Record<string, StagedAction>); });
  return () => off(r, 'value', unsub as any);
}

// ─── Presence (connected flag) ────────────────────────────────────────────────

export async function setPlayerConnected(
  matchId: string,
  playerId: string,
  connected: boolean
): Promise<void> {
  await update(ref(getDb(), `matches/${matchId}/players/${playerId}`), {
    isConnected: connected,
  });
}
