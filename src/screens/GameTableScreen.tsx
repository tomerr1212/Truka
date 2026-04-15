import React, { useEffect, useCallback, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  withRepeat,
  FadeIn,
  FadeOut,
  SlideInDown,
  ZoomIn,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useGameStore, CARD_MAP, selectLocalPlayer } from '../store/gameStore';
import {
  subscribeToMatch,
  subscribeToStaging,
  stageAction,
  clearStaging,
  setPlayerConnected,
  writeMatchUpdate,
  writeFullMatch,
} from '../services/matchService';
import { Match, Player, StagedAction, ActionSubtype } from '../types';
import { resolveClash, FloreoState } from '../engine/collision';
import { applyMaculeleChanges, eliminatePlayer, findJuremaCard, applyJurema, getNextAttackerId, getWinner } from '../engine/maculele';
import { getDrawCount, drawCards } from '../engine/replenishment';

import { COLORS, FONTS } from '../constants/theme';
import { buildCardDefinitions } from '../constants/deck';

type Props = NativeStackScreenProps<RootStackParamList, 'GameTable'>;

const subtypeMap = new Map<string, string>();
buildCardDefinitions().forEach((card, id) => subtypeMap.set(id, card.subtype));

// ─── Visual helpers ───────────────────────────────────────────────────────────

const SUBTYPE_GLYPH: Record<string, string> = {
  kick:        '⚡',
  evasion:     '◎',
  knockdown:   '↓',
  floreo:      '✦',
  troca:       '⇄',
  chamada:     '◈',
  compra:      '⊕',
  agogo:       '⟳',
  malandragem: '●',
  jurema:      '✿',
};

function getCardAccentColor(subtype: string): string {
  if (subtype === 'kick')    return COLORS.primary;
  if (subtype === 'evasion') return COLORS.accent;
  if (subtype === 'floreo')  return COLORS.gold;
  if (subtype === 'knockdown') return COLORS.leather;
  return COLORS.gold; // specials
}

function getPhaseBannerColor(phase: string): string {
  switch (phase) {
    case 'START_OF_TURN':    return COLORS.primary;
    case 'ACTION_SELECTION': return COLORS.leather;
    case 'REVEAL':           return COLORS.ember;
    case 'BURN_REVEAL':      return COLORS.danger;
    case 'JUREMA_REVEAL':    return COLORS.gold;
    default:                 return COLORS.primary;
  }
}

export default function GameTableScreen({ route, navigation }: Props) {
  const { matchId } = route.params;
  const store = useGameStore();
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [myCardStaged, setMyCardStaged] = useState(false);
  const [staging, setStaging] = useState<Record<string, StagedAction>>({});
  const [showReshuffleNotice, setShowReshuffleNotice] = useState(false);
  const [showCheatSheet, setShowCheatSheet] = useState(false);

  // Troca / Compra special action state
  const [specialMode, setSpecialMode] = useState<'troca' | 'compra' | null>(null);
  const [compraTarget, setCompraTarget] = useState<'attacker' | 'defender' | null>(null);
  const [specialCardId, setSpecialCardId] = useState<string | null>(null); // replacement card

  // Stable refs for timer callbacks
  const matchRef   = useRef<Match | null>(null);
  const stagingRef = useRef<Record<string, StagedAction>>({});
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reshuffleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousMatchRef = useRef<Match | null>(null);

  // Screen shake on clash result
  const shakeX = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }] }));

  const match = store.match;
  const localPlayer = selectLocalPlayer(store);
  // Include eliminated players — they stay visible as spectators (greyed out)
  const opponents = match?.players.filter(p => p.id !== store.localPlayerId) ?? [];
  const isDefender = match?.currentDefenderId === store.localPlayerId;
  const isAttacker = match?.currentAttackerId === store.localPlayerId;
  const isSpectator = !isAttacker && !isDefender;
  const isEliminated = !!localPlayer?.isEliminated;

  useEffect(() => { matchRef.current  = match; },   [match]);
  useEffect(() => { stagingRef.current = staging; }, [staging]);

  const nameOf = (id: string | null | undefined) =>
    match?.players.find(p => p.id === id)?.displayName ?? id ?? '?';

  // ── Subscribe to match ──────────────────────────────────────────────────────
  useEffect(() => {
    store.setMatch(null);
    const unsub = subscribeToMatch(matchId, (m) => store.setMatch(m));
    if (store.localPlayerId) setPlayerConnected(matchId, store.localPlayerId, true);
    return () => {
      unsub();
      if (store.localPlayerId) setPlayerConnected(matchId, store.localPlayerId, false);
    };
  }, [matchId]);

  useEffect(() => {
    if (!match || match.id !== matchId || match.status !== 'finished' || !match.winnerId) return;
    const winner = match.players.find((p) => p.id === match.winnerId);
    if (!winner) return;
    navigation.replace('Win', {
      winnerId: winner.id,
      winnerName: winner.displayName,
      matchId: match.id,
    });
  }, [match?.status, match?.winnerId, match?.id, matchId]);

  useEffect(() => {
    const previousMatch = previousMatchRef.current;
    if (
      previousMatch &&
      match &&
      previousMatch.id === match.id &&
      previousMatch.status === 'active' &&
      match.status === 'active' &&
      previousMatch.deck.length === 0 &&
      match.deck.length > 0 &&
      previousMatch.discardPile.length > match.discardPile.length
    ) {
      setShowReshuffleNotice(true);
      if (reshuffleTimerRef.current) clearTimeout(reshuffleTimerRef.current);
      reshuffleTimerRef.current = setTimeout(() => {
        setShowReshuffleNotice(false);
        reshuffleTimerRef.current = null;
      }, 2600);
    }
    previousMatchRef.current = match;
  }, [match]);

  // ── Staging subscription (all clients — for UI visibility) ─────────────────
  useEffect(() => {
    const unsub = subscribeToStaging(matchId, (snap) => {
      setStaging(snap);
      stagingRef.current = snap;
    });
    return unsub;
  }, [matchId]);

  // ── Reset local state on new turn ──────────────────────────────────────────
  useEffect(() => {
    if (match?.turnPhase === 'START_OF_TURN') {
      setMyCardStaged(false);
      setSelectedTargetId(null);
      setSpecialMode(null);
      setCompraTarget(null);
      setSpecialCardId(null);
      store.setPeekHand(null);
      store.selectCard(null);
      store.selectFloreo(null);
      if (revealTimerRef.current) { clearTimeout(revealTimerRef.current); revealTimerRef.current = null; }
    }
  }, [match?.turnPhase]);

  useEffect(() => {
    if (!store.localPlayerId) return;
    if (match?.turnPhase !== 'ACTION_SELECTION') return;
    if (staging[store.localPlayerId]) return;
    if (myCardStaged) setMyCardStaged(false);
  }, [match?.turnPhase, staging, store.localPlayerId, myCardStaged]);

  // ── Staging watcher: both staged → advance to REVEAL ──────────────────────
  useEffect(() => {
    if (!match || !isAttacker) return;

    const unsub = subscribeToStaging(matchId, async (snap) => {
      if (match.turnPhase !== 'ACTION_SELECTION') return;
      const attackerStaged = snap[match.currentAttackerId];
      const defenderId = match.currentDefenderId;
      if (!defenderId || !attackerStaged || !snap[defenderId]) return;
      try {
        await writeMatchUpdate(matchId, { turnPhase: 'REVEAL' });
      } catch (e) {
        console.error('[StagingWatcher] to REVEAL failed:', e);
      }
    });

    return unsub;
  }, [match?.turnPhase, match?.currentAttackerId, match?.currentDefenderId, isAttacker]);

  // ── CONTINUE button handler (attacker presses when ready to resolve) ────────
  const handleSkipReveal = async () => {
    const m = matchRef.current;
    const s = stagingRef.current;
    if (!m || !m.currentDefenderId) return;
    const as = s[m.currentAttackerId];
    const ds = s[m.currentDefenderId];
    if (!as || !ds) return;
    try { await resolveAndAdvance(m, as, ds, s); } catch (e) { console.error(e); }
  };

  // ── Attacker: select target → ATTACK ──────────────────────────────────────
  const handleSelectTarget = (playerId: string) => {
    if (!isAttacker || match?.turnPhase !== 'START_OF_TURN') return;
    setSelectedTargetId(playerId === selectedTargetId ? null : playerId);
  };

  const handleAttack = async () => {
    if (!selectedTargetId || !match) return;
    await writeMatchUpdate(matchId, {
      currentDefenderId: selectedTargetId,
      chamadaPlayerId: null,
      turnPhase: 'ACTION_SELECTION',
    });
    setSelectedTargetId(null);
  };

  // ── Agogô: play at START_OF_TURN ──────────────────────────────────────────
  const handleUseAgogo = async () => {
    if (!match || !store.localPlayerId || !store.selectedCardId) return;
    const card = CARD_MAP.get(store.selectedCardId);
    if (!card || card.subtype !== 'agogo') return;
    const me = match.players.find(p => p.id === store.localPlayerId);
    if (!me) return;

    const handAfter = me.hand.filter(id => id !== store.selectedCardId);
    let deck = [...match.deck];
    let discard = [...match.discardPile, store.selectedCardId];

    if (handAfter.length < 4) {
      const { drawn, deck: nd, discard: nd2 } = drawCards(deck, discard, 4 - handAfter.length);
      deck = nd; discard = nd2;
      handAfter.push(...drawn);
    }

    const updatedPlayers = match.players.map(p =>
      p.id === store.localPlayerId ? { ...p, hand: handAfter } : p
    );
    const nextAttackerId = getNextAttackerId(updatedPlayers, match.currentAttackerId);
    await writeFullMatch(matchId, {
      ...match, players: updatedPlayers, deck, discardPile: discard,
      currentAttackerId: nextAttackerId, currentDefenderId: null,
      chamadaPlayerId: null,
      turnPhase: 'START_OF_TURN', round: match.round + 1, subRound: 0,
    });
    store.selectCard(null);
  };

  // ── Malandragem: peek at a target hand at START_OF_TURN ───────────────────
  const handleUseMalandragem = async () => {
    if (!match || !store.localPlayerId || !store.selectedCardId || !selectedTargetId) return;
    const card = CARD_MAP.get(store.selectedCardId);
    if (!card || card.subtype !== 'malandragem') return;

    const me = match.players.find((p) => p.id === store.localPlayerId);
    const target = match.players.find((p) => p.id === selectedTargetId);
    if (!me || !target) return;

    const handAfter = me.hand.filter((id) => id !== store.selectedCardId);

    await writeFullMatch(matchId, {
      ...match,
      players: match.players.map((p) =>
        p.id === store.localPlayerId ? { ...p, hand: handAfter } : p
      ),
      discardPile: [...match.discardPile, store.selectedCardId],
    });

    store.setPeekHand(target.hand, target.displayName);
    store.selectCard(null);
  };

  // ── Chamada: target attacks the caller, both cards face-up ────────────────
  const handleUseChamada = async () => {
    if (!match || !store.localPlayerId || !store.selectedCardId || !selectedTargetId) return;
    const card = CARD_MAP.get(store.selectedCardId);
    if (!card || card.subtype !== 'chamada') return;

    const me = match.players.find((p) => p.id === store.localPlayerId);
    if (!me) return;

    const handAfter = me.hand.filter((id) => id !== store.selectedCardId);

    await writeFullMatch(matchId, {
      ...match,
      players: match.players.map((p) =>
        p.id === store.localPlayerId ? { ...p, hand: handAfter } : p
      ),
      discardPile: [...match.discardPile, store.selectedCardId],
      currentAttackerId: selectedTargetId,
      currentDefenderId: store.localPlayerId,
      chamadaPlayerId: store.localPlayerId,
      turnPhase: 'ACTION_SELECTION',
    });

    store.selectCard(null);
    setSelectedTargetId(null);
  };

  // ── Play action card (ACTION_SELECTION) ───────────────────────────────────
  const handlePlayAction = useCallback(async () => {
    if (!store.selectedCardId || !store.localPlayerId || !match) return;
    if (match.turnPhase !== 'ACTION_SELECTION') return;
    const card = CARD_MAP.get(store.selectedCardId);
    if (!card || card.type !== 'action') return;
    const me = match.players.find((p) => p.id === store.localPlayerId);
    if (!me) return;
    const floreoId = store.selectedFloreoId;

    await stageAction(matchId, store.localPlayerId, {
      playerId: store.localPlayerId,
      actionCardId: store.selectedCardId,
      floreoAttached: !!floreoId,
      isFaceUp: !!match.chamadaPlayerId,
      submittedAt: Date.now(),
    });

    if (floreoId) {
      await writeFullMatch(matchId, {
        ...match,
        players: match.players.map((p) =>
          p.id === store.localPlayerId
            ? { ...p, hand: me.hand.filter((id) => id !== floreoId) }
            : p
        ),
        discardPile: [...match.discardPile, floreoId],
      });
    }

    setMyCardStaged(true);
    store.selectCard(null);
    store.selectFloreo(null);
  }, [store.selectedCardId, store.selectedFloreoId, store.localPlayerId, match]);

  // ── Empty hand: expose step ────────────────────────────────────────────────
  // Triggered when player has no action cards. Writes BURN_REVEAL so all
  // players see the hand before it's burned. Attacker presses CONTINUE after.
  const handleEmptyHandExpose = async () => {
    if (!match || !store.localPlayerId) return;
    await clearStaging(matchId);
    await writeMatchUpdate(matchId, {
      turnPhase: 'BURN_REVEAL',
      burnRevealPlayerId: store.localPlayerId,
      burnRevealHand: store.myHand,
    });
  };

  // ── Empty hand: resolve step (attacker CONTINUE during BURN_REVEAL) ─────────
  const handleResolveBurnReveal = async () => {
    const m = matchRef.current;
    if (!m || !m.burnRevealPlayerId || !m.burnRevealHand) return;

    const penaltyPlayerId = m.burnRevealPlayerId;
    const exposedHand     = m.burnRevealHand;
    const penaltyPlayer   = m.players.find(p => p.id === penaltyPlayerId);
    if (!penaltyPlayer) return;

    let juremaSavedId: string | null = null;

    // 1. Apply +1 maculelê penalty (check against exposed hand)
    const penaltyChange = [{ playerId: penaltyPlayerId, delta: 1, reason: 'clash' as const }];
    const { players: afterMac, playersAtThreshold } = applyMaculeleChanges(m.players, penaltyChange);
    let updated: Match = { ...m, players: afterMac };

    const hitsThreshold = playersAtThreshold.includes(penaltyPlayerId);
    let eliminationOrder = updated.players.filter(p => p.isEliminated).length;

    if (hitsThreshold) {
      // 2a. Jurema check on EXPOSED hand (old hand, before burn)
      const playerForJurema = { ...penaltyPlayer, hand: exposedHand };
      const juremaId = findJuremaCard(playerForJurema, subtypeMap);
      if (juremaId) {
        // Jurema saves: reset maculelê, remove Jurema, burn remaining, draw 4
        const player = updated.players.find(p => p.id === penaltyPlayerId)!;
        const afterJurema = applyJurema({ ...player, hand: exposedHand }, juremaId);
        let deck = [...updated.deck];
        let discard = [...updated.discardPile, ...afterJurema.hand];
        const { drawn, deck: nd, discard: nd2 } = drawCards(deck, discard, 4);
        updated = {
          ...updated,
          players: updated.players.map(p =>
            p.id === penaltyPlayerId ? { ...afterJurema, hand: drawn } : p
          ),
          deck: nd,
          discardPile: nd2,
        };
        juremaSavedId = penaltyPlayerId;
      } else {
        // 2b. No Jurema → eliminate, burn exposed hand to discard
        eliminationOrder++;
        updated = {
          ...updated,
          players: updated.players.map(p =>
            p.id === penaltyPlayerId ? eliminatePlayer(p, eliminationOrder) : p
          ),
          discardPile: [...updated.discardPile, ...exposedHand],
        };
      }
    } else {
      // 2c. Didn't hit threshold: burn exposed hand + draw 4
      let deck = [...updated.deck];
      let discard = [...updated.discardPile, ...exposedHand];
      const { drawn, deck: nd, discard: nd2 } = drawCards(deck, discard, 4);
      updated = {
        ...updated,
        players: updated.players.map(p =>
          p.id === penaltyPlayerId ? { ...p, hand: drawn } : p
        ),
        deck: nd,
        discardPile: nd2,
      };
    }

    // 3. Advance turn
    const winner = getWinner(updated.players);
    const nextAttackerId = winner
      ? m.currentAttackerId
      : getNextAttackerId(updated.players, m.currentAttackerId);

    await clearStaging(matchId);
    await writeFullMatch(matchId, {
      ...updated,
      turnPhase: !winner && juremaSavedId ? 'JUREMA_REVEAL' : 'START_OF_TURN',
      juremaPlayerId: juremaSavedId ?? null,
      currentAttackerId: nextAttackerId,
      currentDefenderId: null,
      chamadaPlayerId: null,
      burnRevealPlayerId: null,
      burnRevealHand: null,
      round: m.round + 1,
      subRound: 0,
      status: winner ? 'finished' : 'active',
      ...(winner ? { winnerId: winner.id } : {}),
    });

    if (winner) {
      navigation.replace('Win', { winnerId: winner.id, winnerName: winner.displayName, matchId: m.id });
    }
  };

  // ── Dismiss Jurema reveal notification ────────────────────────────────────
  const handleDismissJurema = async () => {
    await writeMatchUpdate(matchId, { turnPhase: 'START_OF_TURN', juremaPlayerId: null });
  };

  // ── TROCA: swap your staged card for a new one ─────────────────────────────
  const handlePlayTroca = async () => {
    if (!match || !store.localPlayerId || !specialCardId) return;
    const trocaCardId = store.myHand.find(id => CARD_MAP.get(id)?.subtype === 'troca');
    if (!trocaCardId) return;
    const me = match.players.find(p => p.id === store.localPlayerId);
    if (!me) return;

    const oldActionCardId = staging[store.localPlayerId]?.actionCardId;

    // Stage the replacement card
    await stageAction(matchId, store.localPlayerId, {
      playerId: store.localPlayerId,
      actionCardId: specialCardId,
      floreoAttached: false, // Floreo canceled when Troca replaces the card
      isFaceUp: true,
      submittedAt: Date.now(),
    });

    // Remove Troca + new card from hand; discard Troca + old staged card
    const handAfter = me.hand.filter(id => id !== trocaCardId && id !== specialCardId);
    const discarded  = [trocaCardId, ...(oldActionCardId ? [oldActionCardId] : [])];

    await writeFullMatch(matchId, {
      ...match,
      players: match.players.map(p =>
        p.id === store.localPlayerId ? { ...p, hand: handAfter } : p
      ),
      discardPile: [...match.discardPile, ...discarded],
      // Keep turnPhase: REVEAL — attacker's CONTINUE / timer will resolve
    });

    setSpecialMode(null);
    setSpecialCardId(null);
  };

  // ── COMPRA: enter the clash as a third party ───────────────────────────────
  const handlePlayCompra = async () => {
    if (!match || !store.localPlayerId || !specialCardId || !compraTarget) return;
    const compraCardId = store.myHand.find(id => CARD_MAP.get(id)?.subtype === 'compra');
    if (!compraCardId) return;
    const me = match.players.find(p => p.id === store.localPlayerId);
    if (!me) return;

    const replacedId    = compraTarget === 'attacker' ? match.currentAttackerId : match.currentDefenderId!;
    const replacedStaged = staging[replacedId]?.actionCardId;

    // Stage Compra player's action card
    await stageAction(matchId, store.localPlayerId, {
      playerId: store.localPlayerId,
      actionCardId: specialCardId,
      floreoAttached: false,
      isFaceUp: true,
      submittedAt: Date.now(),
    });

    const handAfter = me.hand.filter(id => id !== compraCardId && id !== specialCardId);
    const discarded  = [compraCardId, ...(replacedStaged ? [replacedStaged] : [])];

    const newAttackerId = compraTarget === 'attacker' ? store.localPlayerId : match.currentAttackerId;
    const newDefenderId = compraTarget === 'defender' ? store.localPlayerId : match.currentDefenderId;

    await writeFullMatch(matchId, {
      ...match,
      players: match.players.map(p =>
        p.id === store.localPlayerId ? { ...p, hand: handAfter } : p
      ),
      discardPile: [...match.discardPile, ...discarded],
      currentAttackerId: newAttackerId,
      currentDefenderId: newDefenderId,
      turnPhase: 'REVEAL',
    });

    setSpecialMode(null);
    setCompraTarget(null);
    setSpecialCardId(null);
  };

  // ── Clash resolution ────────────────────────────────────────────────────────
  const resolveAndAdvance = async (
    currentMatch: Match,
    attackerAction: StagedAction,
    defenderAction: StagedAction,
    allStaging: Record<string, StagedAction> = {},
  ) => {
    const attackerCard = CARD_MAP.get(attackerAction.actionCardId);
    const defenderCard = CARD_MAP.get(defenderAction.actionCardId);
    if (!attackerCard || !defenderCard) { console.error('[Resolve] card not in CARD_MAP'); return; }

    const floreo: FloreoState = {
      attackerHasFloreо: attackerAction.floreoAttached,
      defenderHasFloreо: defenderAction.floreoAttached,
      attackerFloreoCanceled: false,
      defenderFloreoCanceled: false,
    };

    const result = resolveClash(
      currentMatch.currentAttackerId, currentMatch.currentDefenderId!,
      attackerCard.subtype as ActionSubtype, defenderCard.subtype as ActionSubtype,
      floreo
    );

    if (result.requiresFollowUp) {
      const followUpPlayers = currentMatch.players.map(p => {
        if (p.id === currentMatch.currentAttackerId)
          return { ...p, hand: p.hand.filter(id => id !== attackerAction.actionCardId) };
        if (p.id === currentMatch.currentDefenderId)
          return { ...p, hand: p.hand.filter(id => id !== defenderAction.actionCardId) };
        return p;
      });
      await clearStaging(matchId);
      await writeFullMatch(matchId, {
        ...currentMatch,
        players: followUpPlayers,
        discardPile: [...currentMatch.discardPile, attackerAction.actionCardId, defenderAction.actionCardId],
        subRound: currentMatch.subRound + 1,
        turnPhase: 'ACTION_SELECTION',
      });
      setMyCardStaged(false);
      return;
    }

    let players = [...currentMatch.players];
    const { players: afterMac, playersAtThreshold } = applyMaculeleChanges(players, result.maculeleChanges);
    players = afterMac;

    let eliminationOrder = players.filter(p => p.isEliminated).length;
    const juremaSavedIds: string[] = [];
    for (const pid of playersAtThreshold) {
      const p = players.find(pl => pl.id === pid)!;
      const juremaId = findJuremaCard(p, subtypeMap);
      if (juremaId) {
        players = players.map(pl => pl.id === pid ? applyJurema(pl, juremaId) : pl);
        juremaSavedIds.push(pid);
      } else {
        eliminationOrder++;
        players = players.map(pl => pl.id === pid ? eliminatePlayer(pl, eliminationOrder) : pl);
      }
    }

    let deck    = [...currentMatch.deck];
    let discard = [...currentMatch.discardPile, attackerAction.actionCardId, defenderAction.actionCardId];

    const lastCards: Record<string, ActionSubtype> = {
      [currentMatch.currentAttackerId]: attackerCard.subtype as ActionSubtype,
      [currentMatch.currentDefenderId!]: defenderCard.subtype as ActionSubtype,
    };

    // Include replaced player (Compra scenario) — they staged a card and need replenishment
    for (const [pid, staged] of Object.entries(allStaging)) {
      if (pid !== currentMatch.currentAttackerId && pid !== currentMatch.currentDefenderId) {
        const card = CARD_MAP.get(staged.actionCardId);
        if (card?.type === 'action') lastCards[pid] = card.subtype as ActionSubtype;
      }
    }

    players = players.map(p => {
      const lastCard = lastCards[p.id];
      if (!lastCard || p.isEliminated) return p;
      const actionCardId =
        p.id === currentMatch.currentAttackerId ? attackerAction.actionCardId :
        p.id === currentMatch.currentDefenderId ? defenderAction.actionCardId :
        (allStaging[p.id]?.actionCardId ?? '');
      const handAfterPlay = p.hand.filter(id => id !== actionCardId);
      const drawCount = getDrawCount(lastCard, handAfterPlay.length);
      const { drawn, deck: nd, discard: nd2 } = drawCards(deck, discard, drawCount);
      deck = nd; discard = nd2;
      return { ...p, hand: [...handAfterPlay, ...drawn] };
    });

    const winner = getWinner(players);
    const nextAttackerId = winner
      ? currentMatch.currentAttackerId
      : getNextAttackerId(players, currentMatch.currentAttackerId);

    if (!nextAttackerId) {
      console.error('[Resolve] nextAttackerId is undefined — players:', players.map(p => `${p.displayName}(elim:${p.isEliminated})`));
      return;
    }

    const juremaPlayerId = juremaSavedIds.length > 0 ? juremaSavedIds[0] : null;

    await clearStaging(matchId);
    await writeFullMatch(matchId, {
      ...currentMatch, players, deck, discardPile: discard,
      turnPhase: !winner && juremaPlayerId ? 'JUREMA_REVEAL' : 'START_OF_TURN',
      juremaPlayerId: juremaPlayerId ?? null,
      currentAttackerId: nextAttackerId,
      currentDefenderId: null,
      chamadaPlayerId: null,
      round: currentMatch.round + 1,
      subRound: 0,
      status: winner ? 'finished' : 'active',
      ...(winner ? { winnerId: winner.id } : {}),
    });

    if (winner) {
      navigation.replace('Win', { winnerId: winner.id, winnerName: winner.displayName, matchId: currentMatch.id });
    }
  };

  // ── Derived render values ───────────────────────────────────────────────────
  const phase        = match?.turnPhase ?? 'START_OF_TURN';
  const isBurnReveal = phase === 'BURN_REVEAL';
  const burnRevealPlayer = isBurnReveal && match?.burnRevealPlayerId
    ? match.players.find(p => p.id === match.burnRevealPlayerId) ?? null
    : null;
  const burnRevealHand   = isBurnReveal ? (match?.burnRevealHand ?? []) : [];
  // Jurema only saves when the +1 penalty actually pushes the player to 5
  const burnRevealHitsThreshold = !!burnRevealPlayer && (burnRevealPlayer.maculeleCount + 1) >= 5;
  const burnRevealHasJurema = burnRevealHitsThreshold && burnRevealHand.some(id => CARD_MAP.get(id)?.subtype === 'jurema');
  const attackerName = nameOf(match?.currentAttackerId);
  const defenderName = match?.currentDefenderId ? nameOf(match.currentDefenderId) : null;
  const selectedTargetName = selectedTargetId ? nameOf(selectedTargetId) : null;

  const attackerStagedCard = match?.currentAttackerId ? staging[match.currentAttackerId] : undefined;
  const defenderStagedCard = match?.currentDefenderId ? staging[match.currentDefenderId] : undefined;
  const attackerHasStaged  = !!attackerStagedCard;
  const defenderHasStaged  = !!defenderStagedCard;
  const localStagedActionId = store.localPlayerId ? staging[store.localPlayerId]?.actionCardId : null;

  // Clash result banner (computed client-side during REVEAL)
  const clashResult = (() => {
    if (phase !== 'REVEAL' || !match?.currentDefenderId) return null;
    if (!attackerStagedCard || !defenderStagedCard) return null;
    const ac = CARD_MAP.get(attackerStagedCard.actionCardId);
    const dc = CARD_MAP.get(defenderStagedCard.actionCardId);
    if (!ac || !dc) return null;
    const r = resolveClash(
      match.currentAttackerId, match.currentDefenderId,
      ac.subtype as ActionSubtype, dc.subtype as ActionSubtype,
      { attackerHasFloreо: attackerStagedCard.floreoAttached, defenderHasFloreо: defenderStagedCard.floreoAttached, attackerFloreoCanceled: false, defenderFloreoCanceled: false }
    );
    if (r.requiresFollowUp) return { lines: ['Both evaded — play again!'], color: COLORS.accent };
    if (r.maculeleChanges.length === 0) return { lines: ['Attack evaded — no effect'], color: COLORS.accent };
    const lines = r.maculeleChanges.map(c => {
      const name = match.players.find(p => p.id === c.playerId)?.displayName ?? '?';
      return c.delta > 0 ? `${name} +${c.delta} maculelê` : `${name} −${Math.abs(c.delta)} maculelê`;
    });
    return { lines, color: COLORS.danger };
  })();

  // Who can play which specials this REVEAL
  const myTrocaCardId = store.myHand.find(id => CARD_MAP.get(id)?.subtype === 'troca');
  const myCompraCardId = store.myHand.find(id => CARD_MAP.get(id)?.subtype === 'compra');
  const canPlayTroca  = phase === 'REVEAL' && (isAttacker || isDefender) && !!myTrocaCardId && specialMode !== 'compra';
  const canPlayCompra = phase === 'REVEAL' && isSpectator && !!myCompraCardId && specialMode !== 'troca';

  const isJuremaReveal = phase === 'JUREMA_REVEAL';
  const showClashZone = !isBurnReveal && !isJuremaReveal && (phase === 'ACTION_SELECTION' || phase === 'REVEAL'
    || attackerHasStaged || defenderHasStaged);

  const myActionCards = store.myHand.filter(id => CARD_MAP.get(id)?.type === 'action');
  const myFloreoCards = store.myHand.filter(id => CARD_MAP.get(id)?.subtype === 'floreo');

  // Defender can only act once the attacker has staged their card
  const canDefenderAct = isDefender && attackerHasStaged;
  const hasNoActionCards = phase === 'ACTION_SELECTION' && (isAttacker || canDefenderAct) && myActionCards.length === 0 && !myCardStaged;

  const selectedCard = store.selectedCardId ? CARD_MAP.get(store.selectedCardId) : null;
  const canAttachSelectedFloreo = phase === 'ACTION_SELECTION'
    && (isAttacker || canDefenderAct)
    && !myCardStaged
    && !!selectedCard
    && selectedCard.type === 'action';
  const hasAvailableFloreo = myFloreoCards.length > 0;
  const isAgogoPending = selectedCard?.subtype === 'agogo' && phase === 'START_OF_TURN' && isAttacker;
  const isMalandragemPending = selectedCard?.subtype === 'malandragem' && phase === 'START_OF_TURN' && isAttacker;
  const isChamadaPending = selectedCard?.subtype === 'chamada' && phase === 'START_OF_TURN' && isAttacker;
  const isChamadaActive = !!match?.chamadaPlayerId && phase === 'ACTION_SELECTION';
  const chamadaPlayerName = nameOf(match?.chamadaPlayerId);

  const attackerCardName =
    attackerStagedCard && (phase === 'REVEAL' || attackerStagedCard.isFaceUp)
      ? (CARD_MAP.get(attackerStagedCard.actionCardId)?.nameHe ?? null)
      : null;
  const defenderCardName =
    defenderStagedCard && (phase === 'REVEAL' || defenderStagedCard.isFaceUp)
      ? (CARD_MAP.get(defenderStagedCard.actionCardId)?.nameHe ?? null)
      : null;

  const phaseLabel = getPhaseLabel(
    phase,
    isAttacker,
    isDefender,
    attackerName,
    defenderName,
    selectedTargetName,
    isChamadaActive,
    chamadaPlayerName
  );

  // Shake clash zone when result appears
  const clashResultKey = clashResult?.lines.join();
  useEffect(() => {
    if (!clashResult) return;
    const hasDamage = clashResult.color === COLORS.danger;
    const amp = hasDamage ? 5 : 2.5;
    shakeX.value = withSequence(
      withTiming( amp, { duration: 18 }),
      withRepeat(withSequence(
        withTiming(-amp, { duration: 28 }),
        withTiming( amp, { duration: 28 }),
      ), 2, true),
      withTiming(0,   { duration: 18 }),
    );
  }, [clashResultKey]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Arena floor gradient */}
      <LinearGradient
        colors={['#F5EDD8', '#EDE0C4', '#E8D8B8']}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* Phase banner */}
      <View style={[styles.phaseBanner, { backgroundColor: getPhaseBannerColor(phase) }]}>
        <Animated.Text key={phase} entering={FadeIn.duration(220)} style={styles.phaseLabel} numberOfLines={1}>{phaseLabel}</Animated.Text>
        <TouchableOpacity style={styles.cheatSheetButton} onPress={() => setShowCheatSheet(true)}>
          <Text style={styles.cheatSheetButtonText}>CHEAT SHEET</Text>
        </TouchableOpacity>
        <Text style={styles.roundLabel}>
          Round {match?.round ?? 1}{(match?.subRound ?? 0) > 0 ? `.${match!.subRound}` : ''}
        </Text>
      </View>

      {showReshuffleNotice && (
        <View style={styles.reshuffleBanner}>
          <Text style={styles.reshuffleBannerText}>Discard pile reshuffled into a new deck</Text>
        </View>
      )}

      {/* Opponents */}
      <ScrollView horizontal style={styles.opponentsRow} contentContainerStyle={styles.opponentsContent} showsHorizontalScrollIndicator={false}>
        {opponents.filter(o => !!o.id).map((opp) => (
          <TouchableOpacity key={opp.id} onPress={() => handleSelectTarget(opp.id)} activeOpacity={isAttacker && phase === 'START_OF_TURN' && !opp.isEliminated ? 0.7 : 1}>
            <OpponentSlot
              player={opp}
              isDefender={match?.currentDefenderId === opp.id}
              isAttacker={match?.currentAttackerId === opp.id}
              isSelectedTarget={selectedTargetId === opp.id}
            />
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── Clash zone ── */}
      <Animated.View style={[{ flex: 1 }, shakeStyle]}>
      <ScrollView style={styles.clashScroll} contentContainerStyle={styles.clashZone}>
        {showClashZone ? (
          <>
            {/* Two card slots */}
            <View style={styles.clashRow}>
              <ClashSlot
                label={attackerName} hasStaged={attackerHasStaged} isLocal={isAttacker} role="attacker"
                cardName={attackerCardName}
                cardSubtype={attackerStagedCard ? CARD_MAP.get(attackerStagedCard.actionCardId)?.subtype : null}
                flipDelay={0}
              />
              <View style={styles.vsContainer}>
                <Text style={styles.vsText}>VS</Text>
                <View style={styles.deckBadge}>
                  <Text style={styles.deckBadgeText}>{match?.deck.length ?? 0}</Text>
                  <Text style={styles.deckBadgeLabel}>DECK</Text>
                </View>
              </View>
              <ClashSlot
                label={defenderName ?? '?'} hasStaged={defenderHasStaged} isLocal={isDefender} role="defender"
                cardName={defenderCardName}
                cardSubtype={defenderStagedCard ? CARD_MAP.get(defenderStagedCard.actionCardId)?.subtype : null}
                flipDelay={80}
              />
            </View>

            {/* Result banner */}
            {clashResult && (
              <Animated.View
                key={clashResult.lines.join()}
                entering={ZoomIn.springify().damping(14).stiffness(280)}
                style={[styles.resultBanner, { borderColor: clashResult.color }]}
              >
                {clashResult.lines.map((line, i) => (
                  <Text key={i} style={[styles.resultLine, { color: clashResult.color }]}>{line}</Text>
                ))}
              </Animated.View>
            )}

            {/* ── TROCA panel ── */}
            {canPlayTroca && specialMode !== 'troca' && (
              <TouchableOpacity style={styles.specialTrigger} onPress={() => setSpecialMode('troca')}>
                <Text style={styles.specialTriggerText}>PLAY TROCA — swap your card</Text>
              </TouchableOpacity>
            )}
            {specialMode === 'troca' && (
              <View style={styles.specialPanel}>
                <Text style={styles.specialPanelTitle}>Select replacement card:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                  {store.myHand.filter(id => {
                    const c = CARD_MAP.get(id);
                    return c?.type === 'action' && id !== staging[store.localPlayerId ?? '']?.actionCardId;
                  }).map(id => (
                    <CardTile key={id} cardId={id}
                      isSelected={specialCardId === id} isLegal
                      onPress={() => setSpecialCardId(specialCardId === id ? null : id)}
                    />
                  ))}
                </ScrollView>
                <View style={styles.specialActions}>
                  <TouchableOpacity
                    style={[styles.specialConfirm, !specialCardId && styles.specialConfirmDisabled]}
                    onPress={handlePlayTroca} disabled={!specialCardId}
                  >
                    <Text style={styles.specialConfirmText}>CONFIRM TROCA</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.specialCancel} onPress={() => { setSpecialMode(null); setSpecialCardId(null); }}>
                    <Text style={styles.specialCancelText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* ── COMPRA panel ── */}
            {canPlayCompra && specialMode !== 'compra' && (
              <TouchableOpacity style={[styles.specialTrigger, styles.specialTriggerCompra]} onPress={() => setSpecialMode('compra')}>
                <Text style={styles.specialTriggerText}>PLAY COMPRA — enter the clash</Text>
              </TouchableOpacity>
            )}
            {specialMode === 'compra' && (
              <View style={styles.specialPanel}>
                {!compraTarget ? (
                  <>
                    <Text style={styles.specialPanelTitle}>Replace which player?</Text>
                    <View style={styles.specialActions}>
                      <TouchableOpacity style={[styles.specialConfirm, { backgroundColor: COLORS.primary }]} onPress={() => setCompraTarget('attacker')}>
                        <Text style={styles.specialConfirmText}>Replace {attackerName}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.specialConfirm, { backgroundColor: COLORS.accent }]} onPress={() => setCompraTarget('defender')}>
                        <Text style={styles.specialConfirmText}>Replace {defenderName}</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={styles.specialPanelTitle}>
                      Replacing {compraTarget === 'attacker' ? attackerName : defenderName} — select your card:
                    </Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                      {store.myHand.filter(id => CARD_MAP.get(id)?.type === 'action').map(id => (
                        <CardTile key={id} cardId={id}
                          isSelected={specialCardId === id} isLegal
                          onPress={() => setSpecialCardId(specialCardId === id ? null : id)}
                        />
                      ))}
                    </ScrollView>
                    <View style={styles.specialActions}>
                      <TouchableOpacity
                        style={[styles.specialConfirm, !specialCardId && styles.specialConfirmDisabled]}
                        onPress={handlePlayCompra} disabled={!specialCardId}
                      >
                        <Text style={styles.specialConfirmText}>CONFIRM COMPRA</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.specialCancel} onPress={() => setCompraTarget(null)}>
                        <Text style={styles.specialCancelText}>← Back</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
                <TouchableOpacity style={styles.specialCancel} onPress={() => { setSpecialMode(null); setCompraTarget(null); setSpecialCardId(null); }}>
                  <Text style={styles.specialCancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* CONTINUE / waiting */}
            {phase === 'REVEAL' && isAttacker && specialMode === null && (
              <TouchableOpacity style={styles.continueButton} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); handleSkipReveal(); }}>
                <Text style={styles.continueButtonText}>CONTINUE →</Text>
              </TouchableOpacity>
            )}
            {phase === 'REVEAL' && !isAttacker && specialMode === null && (
              <Text style={styles.waitingReveal}>Waiting for {attackerName} to continue…</Text>
            )}
          </>
        ) : isJuremaReveal ? (
          <Animated.View entering={SlideInDown.springify().damping(16)} style={[styles.burnRevealZone, styles.juremaRevealZone]}>
            <Text style={styles.juremaRevealTitle}>✿  JUREMA SAVED!  ✿</Text>
            <Text style={styles.burnRevealSub}>
              {match?.players.find(p => p.id === match.juremaPlayerId)?.displayName ?? '?'} reached 5 maculelê but used Jurema — reset to 4.
            </Text>
            {isAttacker && (
              <TouchableOpacity style={styles.continueButton} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); handleDismissJurema(); }}>
                <Text style={styles.continueButtonText}>CONTINUE →</Text>
              </TouchableOpacity>
            )}
            {!isAttacker && (
              <Text style={styles.waitingReveal}>Waiting for {attackerName} to continue…</Text>
            )}
          </Animated.View>
        ) : isBurnReveal ? (
          <Animated.View entering={SlideInDown.springify().damping(16)} style={styles.burnRevealZone}>
            <Text style={styles.burnRevealTitle}>
              EXPOSED — {burnRevealPlayer?.displayName ?? '?'}'s hand
            </Text>
            <Text style={styles.burnRevealSub}>
              {burnRevealPlayer ? `${burnRevealPlayer.maculeleCount} → ${burnRevealPlayer.maculeleCount + 1} maculelê` : ''}
              {burnRevealHasJurema ? '  •  JUREMA SAVED!' : ''}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
              {burnRevealHand.map((cardId, i) => (
                <CardTile key={`${cardId}-${i}`} cardId={cardId} isSelected={false} isLegal onPress={() => {}} />
              ))}
            </ScrollView>
            {isAttacker && (
              <TouchableOpacity style={styles.continueButton} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); handleResolveBurnReveal(); }}>
                <Text style={styles.continueButtonText}>CONTINUE →</Text>
              </TouchableOpacity>
            )}
            {!isAttacker && (
              <Text style={styles.waitingReveal}>Waiting for {attackerName} to continue…</Text>
            )}
          </Animated.View>
        ) : (
          <View style={styles.idleZone}>
            {/* Arena floor center glow */}
            <View style={styles.arenaGlow} pointerEvents="none" />
            <View style={styles.deckPile}>
              <View style={[styles.deckStack, (match?.deck.length ?? 0) === 0 && styles.deckStackEmpty]}>
                <Text style={styles.deckStackCount}>{match?.deck.length ?? 0}</Text>
              </View>
              <Text style={styles.deckLabel}>DECK</Text>
            </View>
            <View style={styles.discardPileIdle}>
              <View style={[styles.deckStack, { backgroundColor: COLORS.sand, borderColor: COLORS.border }, (match?.discardPile.length ?? 0) === 0 && styles.deckStackEmpty]}>
                <Text style={[styles.deckStackCount, { color: COLORS.muted }]}>{match?.discardPile.length ?? 0}</Text>
              </View>
              <Text style={styles.deckLabel}>DISCARD</Text>
            </View>
          </View>
        )}
      </ScrollView>
      </Animated.View>

      {/* ── Local player area ── */}
      {localPlayer && (
        <View style={styles.localPlayerArea}>
          <View style={styles.localHeader}>
            <Text style={styles.localName}>{localPlayer.displayName}</Text>
            <MaculeleBar count={localPlayer.maculeleCount} />
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.handRow}>
            {store.myHand.map((cardId, idx) => {
              const card = CARD_MAP.get(cardId);
              if (!card) return null;
              const isLegalForAction = phase === 'ACTION_SELECTION' && (isAttacker || canDefenderAct) && card.type === 'action' && !myCardStaged;
              const isLegalForFloreo = card.subtype === 'floreo' && canAttachSelectedFloreo && hasAvailableFloreo;
              const isLegalNow = isLegalForAction || isLegalForFloreo || store.legalCardIds.has(cardId);
              const isSelected = store.selectedCardId === cardId || store.selectedFloreoId === cardId;
              const isCommitted = localStagedActionId === cardId;
              return (
                <CardTile
                  key={cardId}
                  cardId={cardId}
                  isSelected={isSelected}
                  isCommitted={isCommitted}
                  isLegal={isLegalNow}
                  breatheDelay={idx * 180}
                  onPress={() => {
                    if (!isLegalNow) return;
                    if (card.subtype === 'floreo') {
                      store.selectFloreo(store.selectedFloreoId === cardId ? null : cardId);
                      return;
                    }
                    const nextSelected = store.selectedCardId === cardId ? null : cardId;
                    store.selectCard(nextSelected);
                    store.selectFloreo(null);
                  }}
                />
              );
            })}
          </ScrollView>

          {canAttachSelectedFloreo && hasAvailableFloreo && (
            <Text style={styles.floreoHint}>
              {store.selectedFloreoId ? 'Floreo attached to this action' : 'Select a Floreo card to attach it to this action'}
            </Text>
          )}

          {isAttacker && phase === 'START_OF_TURN' && !isAgogoPending && !isMalandragemPending && !isChamadaPending && (
            <TouchableOpacity
              style={[styles.attackButton, !selectedTargetId && styles.attackButtonDisabled]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); handleAttack(); }} disabled={!selectedTargetId}
            >
              <Text style={styles.attackButtonText}>
                {selectedTargetId ? `ATTACK ${selectedTargetName}` : 'TAP A PLAYER TO ATTACK'}
              </Text>
            </TouchableOpacity>
          )}

          {isAgogoPending && (
            <TouchableOpacity style={styles.specialButton} onPress={handleUseAgogo}>
              <Text style={styles.specialButtonText}>USE AGOGÔ — Draw & Skip Turn</Text>
            </TouchableOpacity>
          )}

          {isMalandragemPending && (
            <TouchableOpacity
              style={[styles.specialButton, !selectedTargetId && styles.playButtonDisabled]}
              onPress={handleUseMalandragem}
              disabled={!selectedTargetId}
            >
              <Text style={styles.specialButtonText}>
                {selectedTargetName ? `USE MALANDRAGEM ON ${selectedTargetName}` : 'SELECT A PLAYER TO PEEK'}
              </Text>
            </TouchableOpacity>
          )}

          {isChamadaPending && (
            <TouchableOpacity
              style={[styles.specialButton, !selectedTargetId && styles.playButtonDisabled]}
              onPress={handleUseChamada}
              disabled={!selectedTargetId}
            >
              <Text style={styles.specialButtonText}>
                {selectedTargetName ? `USE CHAMADA ON ${selectedTargetName}` : 'SELECT A PLAYER FOR CHAMADA'}
              </Text>
            </TouchableOpacity>
          )}

          {store.peekHand && (
            <View style={styles.specialPanel}>
              <Text style={styles.specialPanelTitle}>
                {store.peekPlayerName ? `${store.peekPlayerName}'s hand` : 'Peeked hand'}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                {store.peekHand.map((cardId, index) => (
                  <CardTile
                    key={`${cardId}-${index}`}
                    cardId={cardId}
                    isSelected={false}
                    isLegal
                    onPress={() => {}}
                  />
                ))}
              </ScrollView>
              <TouchableOpacity style={styles.specialCancel} onPress={() => store.setPeekHand(null)}>
                <Text style={styles.specialCancelText}>Close</Text>
              </TouchableOpacity>
            </View>
          )}

          {isEliminated && (
            <View style={styles.eliminatedBox}>
              <Text style={styles.eliminatedTitle}>You are out</Text>
              <Text style={styles.eliminatedSub}>You reached 5 maculelê. You can spectate until a winner is decided.</Text>
            </View>
          )}

          {hasNoActionCards && !isEliminated && (
            <View style={styles.emptyHandBox}>
              <Text style={styles.emptyHandTitle}>No action cards!</Text>
              <Text style={styles.emptyHandSub}>Your hand will be burned, you draw 4 new cards and receive +1 maculelê.</Text>
              <TouchableOpacity style={styles.emptyHandButton} onPress={handleEmptyHandExpose}>
                <Text style={styles.emptyHandButtonText}>EXPOSE HAND</Text>
              </TouchableOpacity>
            </View>
          )}

          {isDefender && phase === 'ACTION_SELECTION' && !attackerHasStaged && !myCardStaged && !isEliminated && (
            <Text style={styles.waitingReveal}>Waiting for {attackerName} to play first…</Text>
          )}

          {(isAttacker || canDefenderAct) && phase === 'ACTION_SELECTION' && !myCardStaged && !hasNoActionCards && !isEliminated && (
            <TouchableOpacity
              style={[styles.playButton, !store.selectedCardId && styles.playButtonDisabled]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); handlePlayAction(); }} disabled={!store.selectedCardId}
            >
              <Text style={styles.playButtonText}>PLAY CARD</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {showCheatSheet && (
        <Animated.View entering={SlideInDown.springify().damping(22).stiffness(260)} style={styles.cheatSheetOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setShowCheatSheet(false)} activeOpacity={1} />
          <View style={styles.cheatSheetCard}>
            <View style={styles.cheatSheetHeader}>
              <Text style={styles.cheatSheetTitle}>CHEAT SHEET</Text>
              <TouchableOpacity style={styles.cheatSheetCloseBtn} onPress={() => setShowCheatSheet(false)}>
                <Text style={styles.cheatSheetClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 8 }}>
              {/* Collision grid — attacker row × defender col */}
              <Text style={styles.cheatSectionLabel}>COLLISION RESULTS</Text>
              <View style={styles.cheatSheetGrid}>
                {/* Header row */}
                <CheatCell label="" corner />
                <CheatCell label="⚡ KICK" header />
                <CheatCell label="◎ EVADE" header />
                <CheatCell label="↓ DOWN" header />
                {/* Kick row */}
                <CheatCell label="⚡ KICK" side />
                <CheatCell label="⊕ Both +1" outcome="damage" />
                <CheatCell label="○ Nothing" outcome="neutral" />
                <CheatCell label="⊕ Kick +1" outcome="damage" />
                {/* Evasion row */}
                <CheatCell label="◎ EVADE" side />
                <CheatCell label="○ Nothing" outcome="neutral" />
                <CheatCell label="↻ Play again" outcome="followup" />
                <CheatCell label="⊕ Down +1" outcome="damage" />
                {/* Knockdown row */}
                <CheatCell label="↓ DOWN" side />
                <CheatCell label="⊕ Kick +1" outcome="damage" />
                <CheatCell label="⊕ Down +1" outcome="damage" />
                <CheatCell label="⊕ Both +1" outcome="damage" />
              </View>

              {/* Special rules */}
              <Text style={styles.cheatSectionLabel}>SPECIAL RULES</Text>
              <View style={styles.cheatRules}>
                <CheatRule glyph="✦" name="Floreo" rule="Doubles maculelê. Kick+Floreo vs Evasion → both −1." />
                <CheatRule glyph="⇄" name="Troca" rule="REVEAL: replace your action card. Cancels attached Floreo." />
                <CheatRule glyph="⊕" name="Compra" rule="REVEAL: 3rd player replaces attacker or defender." />
                <CheatRule glyph="◈" name="Chamada" rule="START: target must attack face-up. You respond face-up." />
                <CheatRule glyph="●" name="Malandragem" rule="START: peek any player's full hand." />
                <CheatRule glyph="⟳" name="Agogô" rule="START: draw to 4 (0 if ≥4), skip your turn." />
                <CheatRule glyph="✿" name="Jurema" rule="Auto: saves you at 5 maculelê — resets to 4." />
              </View>
            </ScrollView>
          </View>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}

// ─── ClashSlot ─────────────────────────────────────────────────────────────────

function ClashSlot({ label, hasStaged, isLocal, role, cardName, cardSubtype, flipDelay = 0 }: {
  label: string; hasStaged: boolean; isLocal: boolean;
  role: 'attacker' | 'defender'; cardName: string | null; cardSubtype?: string | null;
  flipDelay?: number;
}) {
  const roleColor = role === 'attacker' ? COLORS.primary : COLORS.accent;
  const roleBg    = role === 'attacker' ? COLORS.primaryLight : '#E0F5F5';
  const roleLabel = role === 'attacker' ? 'ATTACKER' : 'DEFENDER';

  // Flip animation: scaleX 1→0 (fold away), swap content, 0→1 (unfold front)
  const flipScale = useSharedValue(1);
  const [showFront, setShowFront] = useState(!!cardName);
  const prevCardName = useRef<string | null>(cardName);

  useEffect(() => {
    const wasRevealed = !!prevCardName.current;
    prevCardName.current = cardName;

    if (cardName && !wasRevealed) {
      // Card just revealed — play flip after optional delay
      const doFlip = () => {
        setShowFront(false);
        flipScale.value = 1;
        flipScale.value = withSequence(
          withTiming(0, { duration: 190 }),
          withTiming(1, { duration: 190 }),
        );
        setTimeout(() => setShowFront(true), 190);
      };
      if (flipDelay > 0) {
        const t = setTimeout(doFlip, flipDelay);
        return () => clearTimeout(t);
      }
      doFlip();
    } else if (!cardName) {
      setShowFront(false);
      flipScale.value = 1;
    } else {
      // Already revealed on mount (reconnect)
      setShowFront(true);
    }
  }, [cardName]);

  const flipStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: flipScale.value }],
  }));

  const faceDown = hasStaged && !cardName;

  return (
    <View style={styles.clashSlot}>
      <Text style={[styles.clashSlotRole, role === 'attacker' ? styles.clashSlotRoleAttacker : styles.clashSlotRoleDefender]}>
        {roleLabel}
      </Text>
      <Text style={{ fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.muted, maxWidth: 90, textAlign: 'center' }} numberOfLines={1}>{label}</Text>
      <Animated.View style={[
        styles.clashCard,
        !showFront && faceDown && styles.clashCardBack,
        showFront && cardName ? { borderColor: roleColor, backgroundColor: roleBg, borderWidth: 2.5 } : undefined,
        flipStyle,
      ]}>
        {showFront && cardName ? (
          <>
            {cardSubtype && <Text style={[styles.clashCardRevealedGlyph, { color: roleColor }]}>{SUBTYPE_GLYPH[cardSubtype] ?? '▪'}</Text>}
            <Text style={[styles.clashCardRevealedName, { color: roleColor }]} numberOfLines={2}>{cardName}</Text>
          </>
        ) : faceDown ? (
          <View style={styles.clashCardBackPattern}>
            <Text style={styles.clashCardBackDiamond}>◆</Text>
          </View>
        ) : (
          <Text style={styles.clashCardEmpty}>?</Text>
        )}
      </Animated.View>
      {faceDown && !showFront && (
        <Text style={[styles.clashCardReady, { color: roleColor }]}>{isLocal ? 'Placed ✓' : 'Waiting…'}</Text>
      )}
    </View>
  );
}

// ─── OpponentSlot ──────────────────────────────────────────────────────────────

function OpponentSlot({ player, isDefender, isAttacker, isSelectedTarget }: {
  player: Player; isDefender: boolean; isAttacker: boolean; isSelectedTarget: boolean;
}) {
  const slotShake   = useSharedValue(0);
  const slotOpacity = useSharedValue(player.isEliminated ? 0.3 : 1);
  const slotScale   = useSharedValue(player.isEliminated ? 0.86 : 1);
  const prevElim    = useRef(player.isEliminated);

  useEffect(() => {
    if (player.isEliminated && !prevElim.current) {
      // Shake then collapse
      slotShake.value = withSequence(
        withTiming(-7, { duration: 45 }),
        withRepeat(withSequence(
          withTiming(7,  { duration: 55 }),
          withTiming(-7, { duration: 55 }),
        ), 3, true),
        withTiming(0, { duration: 45 }),
      );
      slotOpacity.value = withTiming(0.3,  { duration: 480 });
      slotScale.value   = withSpring(0.86, { stiffness: 160, damping: 18 });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
    prevElim.current = player.isEliminated;
  }, [player.isEliminated]);

  const elimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: slotShake.value }, { scale: slotScale.value }],
    opacity: slotOpacity.value,
  }));

  const cardCount = Math.min(player.hand.length, 7);
  return (
    <Animated.View style={[
      styles.opponentSlot,
      !player.isEliminated && isDefender     && styles.opponentDefender,
      !player.isEliminated && isAttacker     && styles.opponentAttacker,
      !player.isEliminated && isSelectedTarget && styles.opponentTargeted,
      player.isEliminated  && styles.opponentSlotEliminated,
      elimStyle,
    ]}>
      <Text style={player.isEliminated ? styles.opponentNameEliminated : styles.opponentName} numberOfLines={1}>
        {player.displayName}
      </Text>
      {player.isEliminated ? (
        <Text style={styles.spectatorLabel}>OUT</Text>
      ) : (
        <>
          <View style={styles.opponentCardFan}>
            {Array.from({ length: cardCount }).map((_, i) => (
              <View key={i} style={[styles.opponentCardMini, i > 0 && styles.opponentCardMiniOverlap]} />
            ))}
            {cardCount === 0 && <Text style={{ fontSize: 9, color: COLORS.muted }}>empty</Text>}
          </View>
          <MaculeleBar count={player.maculeleCount} small />
          {!player.isConnected && <Text style={styles.disconnected}>⚡</Text>}
        </>
      )}
    </Animated.View>
  );
}

function MaculeleBar({ count, small }: { count: number; small?: boolean }) {
  const isDanger = count >= 4;
  const scale = useSharedValue(1);
  const pulseScale = useSharedValue(1);
  const prevCount = useRef(count);

  useEffect(() => {
    if (count > prevCount.current) {
      scale.value = withSequence(
        withTiming(1.3, { duration: 80 }),
        withSpring(1, { stiffness: 420, damping: 12 })
      );
    }
    prevCount.current = count;
  }, [count]);

  useEffect(() => {
    if (isDanger) {
      pulseScale.value = withRepeat(
        withSequence(
          withTiming(1.05, { duration: 750 }),
          withTiming(1.0,  { duration: 750 }),
        ),
        -1,
        false,
      );
    } else {
      pulseScale.value = withTiming(1, { duration: 200 });
    }
  }, [isDanger]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value * pulseScale.value }],
  }));

  return (
    <Animated.View style={[styles.maculeleRow, animStyle]}>
      {Array.from({ length: 5 }).map((_, i) => {
        const isActive = i < count;
        const tokenStyle = small ? styles.maculeleSmall : styles.maculeleDot;
        const colorStyle = isActive
          ? (isDanger ? styles.maculeleDanger : styles.maculeleActive)
          : styles.maculeleInactive;
        return <View key={`mac-${i}`} style={[tokenStyle, colorStyle]} />;
      })}
    </Animated.View>
  );
}

function CardTile({ cardId, isSelected, isCommitted, isLegal, onPress, breatheDelay = 0 }: {
  cardId: string; isSelected: boolean; isCommitted?: boolean; isLegal: boolean; onPress: () => void;
  breatheDelay?: number;
}) {
  const card = CARD_MAP.get(cardId);
  if (!card) return null;
  const accentColor = getCardAccentColor(card.subtype);
  const glyph = SUBTYPE_GLYPH[card.subtype] ?? '▪';

  const scale = useSharedValue(1);
  const translateY = useSharedValue(0);
  const breathe = useSharedValue(1);

  useEffect(() => {
    scale.value     = withSpring(isSelected ? 1.08 : 1,  { stiffness: 300, damping: 16 });
    translateY.value = withSpring(isSelected ? -9 : 0, { stiffness: 300, damping: 16 });
  }, [isSelected]);

  useEffect(() => {
    if (isLegal && !isSelected && !isCommitted) {
      breathe.value = withRepeat(
        withSequence(
          withTiming(1.025, { duration: 900 + breatheDelay }),
          withTiming(1.0,   { duration: 900 }),
        ),
        -1,
        false,
      );
    } else {
      breathe.value = withTiming(1, { duration: 150 });
    }
  }, [isLegal, isSelected, isCommitted]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: scale.value * breathe.value },
      { translateY: translateY.value },
    ],
  }));

  return (
    <Animated.View style={animStyle}>
      <TouchableOpacity
        style={[
          styles.cardTile,
          { borderLeftColor: accentColor },
          isLegal && !isSelected && !isCommitted && styles.cardTileLegal,
          isSelected && styles.cardTileSelected,
          isCommitted && styles.cardTileCommitted,
          !isLegal && !isCommitted && styles.cardTileIllegal,
        ]}
        onPress={() => {
          if (isLegal) Haptics.selectionAsync();
          onPress();
        }}
        onLongPress={() => Alert.alert(`${card.nameHe} · ${card.namePt}`, card.descriptionHe)}
        activeOpacity={isLegal ? 0.65 : 0.9}
      >
        {isCommitted && <Text style={styles.cardTileCommittedBadge}>PLAYED</Text>}
        <Text style={[styles.cardGlyph, { color: isSelected ? accentColor : COLORS.muted }]}>{glyph}</Text>
        <Text style={styles.cardName} numberOfLines={2}>{card.nameHe}</Text>
        <Text style={styles.cardNamePt} numberOfLines={1}>{card.namePt}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

function CheatCell({ label, header, side, corner, outcome }: {
  label: string;
  header?: boolean;
  side?: boolean;
  corner?: boolean;
  outcome?: 'damage' | 'neutral' | 'followup';
}) {
  const outcomeColor =
    outcome === 'damage'  ? COLORS.danger :
    outcome === 'neutral' ? COLORS.muted :
    outcome === 'followup'? COLORS.gold  : undefined;

  return (
    <View style={[
      styles.cheatCell,
      header && styles.cheatCellHeader,
      side   && styles.cheatCellSide,
      corner && styles.cheatCellCorner,
      outcome && { borderLeftWidth: 3, borderLeftColor: outcomeColor },
    ]}>
      <Text style={[
        styles.cheatCellText,
        (header || side) && styles.cheatCellTextStrong,
        outcome && { color: outcomeColor, fontFamily: FONTS.bodyBold },
      ]} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

function CheatRule({ glyph, name, rule }: { glyph: string; name: string; rule: string }) {
  return (
    <View style={styles.cheatRuleRow}>
      <Text style={styles.cheatRuleGlyph}>{glyph}</Text>
      <View style={styles.cheatRuleBody}>
        <Text style={styles.cheatRuleName}>{name}</Text>
        <Text style={styles.cheatRuleText}>{rule}</Text>
      </View>
    </View>
  );
}

function getPhaseLabel(
  phase: string,
  isAttacker: boolean,
  isDefender: boolean,
  attackerName: string,
  defenderName: string | null,
  selectedTargetName: string | null,
  isChamadaActive: boolean,
  chamadaPlayerName: string
): string {
  switch (phase) {
    case 'START_OF_TURN':
      if (isAttacker) return selectedTargetName ? `Attack ${selectedTargetName}?` : 'Your turn — tap a player to attack';
      return `Waiting for ${attackerName} to attack…`;
    case 'ACTION_SELECTION':
      if (isChamadaActive) {
        if (isAttacker) return `${chamadaPlayerName} called you out — attack with an open card`;
        if (isDefender) return `You called ${attackerName} — respond with an open card`;
        return `${attackerName} attacks ${defenderName} by Chamada`;
      }
      if (isAttacker) return `You attacked ${defenderName} — play your card`;
      if (isDefender) return `${attackerName} is attacking you — play your response`;
      return `${attackerName} vs ${defenderName}…`;
    case 'REVEAL':
      return `${attackerName} vs ${defenderName} — cards revealed!`;
    default: return phase;
  }
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: COLORS.bg },

  // ── Phase banner ──
  phaseBanner:       { paddingVertical: 10, paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 3, borderBottomColor: 'rgba(0,0,0,0.18)' },
  phaseLabel:        { color: '#fff', fontFamily: FONTS.display, fontSize: 18, flex: 1, letterSpacing: 1 },
  cheatSheetButton:  { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, marginHorizontal: 8 },
  cheatSheetButtonText: { color: '#fff', fontFamily: FONTS.bodyExtraBold, fontSize: 10, letterSpacing: 0.8 },
  roundLabel:        { color: 'rgba(255,255,255,0.75)', fontFamily: FONTS.bodySemiBold, fontSize: 11 },
  reshuffleBanner:   { backgroundColor: '#E3F5F5', borderBottomWidth: 1, borderBottomColor: '#A8D8D8', paddingVertical: 7, paddingHorizontal: 16 },
  reshuffleBannerText: { color: '#146C6C', fontSize: 12, fontWeight: '800', textAlign: 'center', letterSpacing: 0.3 },

  // ── Cheat sheet overlay ──
  cheatSheetOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(44,26,14,0.68)', justifyContent: 'flex-end' },
  cheatSheetCard:    { backgroundColor: COLORS.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, borderTopWidth: 2, borderLeftWidth: 2, borderRightWidth: 2, borderColor: COLORS.border, gap: 14, maxHeight: '90%' },
  cheatSheetHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cheatSheetTitle:   { color: COLORS.text, fontFamily: FONTS.display, fontSize: 24 },
  cheatSheetCloseBtn:{ backgroundColor: COLORS.sand, borderRadius: 999, width: 28, height: 28, justifyContent: 'center', alignItems: 'center' },
  cheatSheetClose:   { color: COLORS.leather, fontFamily: FONTS.bodyBold, fontSize: 13 },
  cheatSectionLabel: { fontFamily: FONTS.bodyExtraBold, fontSize: 10, color: COLORS.muted, letterSpacing: 2, marginBottom: -6 },

  // Collision grid
  cheatSheetGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 1, backgroundColor: COLORS.border, padding: 1, borderRadius: 14, overflow: 'hidden' },
  cheatCell:           { width: '24.6%', minHeight: 48, backgroundColor: COLORS.card, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 5, paddingVertical: 6 },
  cheatCellHeader:     { backgroundColor: COLORS.leather },
  cheatCellSide:       { backgroundColor: COLORS.ember },
  cheatCellCorner:     { backgroundColor: COLORS.leather },
  cheatCellDanger:     { backgroundColor: '#F7D8D4' },
  cheatCellInfo:       { backgroundColor: '#DFF0E8' },
  cheatCellNeutral:    { backgroundColor: '#EDE7DA' },
  cheatCellText:       { fontFamily: FONTS.bodySemiBold, color: COLORS.text, fontSize: 10, textAlign: 'center' },
  cheatCellTextStrong: { fontFamily: FONTS.bodyExtraBold, color: '#fff', fontSize: 10 },

  // Special rules list
  cheatRules:    { gap: 8 },
  cheatRuleRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: COLORS.bg, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: COLORS.border },
  cheatRuleGlyph:{ fontSize: 16, width: 22, textAlign: 'center', marginTop: 1 },
  cheatRuleBody: { flex: 1, gap: 1 },
  cheatRuleName: { fontFamily: FONTS.bodyBold, fontSize: 12, color: COLORS.text },
  cheatRuleText: { fontFamily: FONTS.bodyRegular, fontSize: 11, color: COLORS.muted, lineHeight: 16 },

  // ── Opponents row ──
  opponentsRow:     { maxHeight: 130, marginVertical: 6 },
  opponentsContent: { paddingHorizontal: 12, gap: 8, alignItems: 'center' },
  opponentSlot:     { backgroundColor: COLORS.surface, borderRadius: 12, padding: 10, minWidth: 94, alignItems: 'center', borderWidth: 2, borderColor: COLORS.border,
    shadowColor: COLORS.leather, shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  opponentAttacker: { borderColor: COLORS.primary, shadowColor: COLORS.primary, shadowOpacity: 0.25, elevation: 3 },
  opponentDefender: { borderColor: COLORS.accent, shadowColor: COLORS.accent, shadowOpacity: 0.25, elevation: 3 },
  opponentTargeted: { borderColor: COLORS.danger, borderWidth: 2.5, shadowColor: COLORS.danger, shadowOpacity: 0.3, elevation: 4 },
  opponentName:     { fontFamily: FONTS.bodyBold, fontSize: 12, color: COLORS.text, maxWidth: 84, textAlign: 'center' },
  opponentCardFan:  { flexDirection: 'row', marginTop: 5, justifyContent: 'center' },
  opponentCardMini: { width: 9, height: 13, borderRadius: 2, backgroundColor: COLORS.leather, borderWidth: 1, borderColor: COLORS.border },
  opponentCardMiniOverlap: { marginLeft: -4 },
  disconnected:     { fontSize: 9, color: COLORS.muted, marginTop: 2 },

  // ── Clash zone ──
  clashScroll:  { flex: 1 },
  clashZone:    { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  clashRow:     { flexDirection: 'row', alignItems: 'center', gap: 14 },
  clashStage:   { position: 'absolute', width: '88%', height: 160, borderRadius: 20, backgroundColor: 'rgba(61,34,16,0.06)', borderWidth: 1.5, borderColor: 'rgba(196,169,125,0.35)' },

  clashSlot:             { alignItems: 'center', gap: 6 },
  clashSlotRole:         { fontSize: 9, fontWeight: '800', letterSpacing: 1.5, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  clashSlotRoleAttacker: { backgroundColor: COLORS.primary, color: '#fff' },
  clashSlotRoleDefender: { backgroundColor: COLORS.accent, color: '#fff' },
  clashCard:             { width: 88, height: 122, borderRadius: 12, borderWidth: 2, borderColor: COLORS.border, backgroundColor: COLORS.surface, justifyContent: 'center', alignItems: 'center',
    shadowColor: COLORS.leather, shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  clashCardBack:         { backgroundColor: COLORS.leather, borderColor: COLORS.leather },
  clashCardBackPattern:  { width: 56, height: 80, borderRadius: 6, borderWidth: 2, borderColor: 'rgba(196,169,125,0.4)', justifyContent: 'center', alignItems: 'center' },
  clashCardBackDiamond:  { fontSize: 28, color: 'rgba(196,169,125,0.5)' },
  clashCardIcon:         { fontSize: 24 },
  clashCardReady:        { fontSize: 10, fontWeight: '800', marginTop: 4 },
  clashCardEmpty:        { fontSize: 32, color: COLORS.sand },
  clashCardRevealedName: { fontSize: 14, fontWeight: '800', textAlign: 'center', paddingHorizontal: 6 },
  clashCardRevealedGlyph:{ fontSize: 22, marginBottom: 4 },

  vsContainer:    { alignItems: 'center', gap: 6 },
  vsText:         { fontSize: 28, fontFamily: FONTS.display, color: COLORS.ember, letterSpacing: 2 },
  deckBadge:      { alignItems: 'center', backgroundColor: 'rgba(61,34,16,0.07)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  deckBadgeText:  { fontSize: 15, fontFamily: FONTS.bodyBold, color: COLORS.text },
  deckBadgeLabel: { fontSize: 8, fontFamily: FONTS.bodySemiBold, color: COLORS.muted, letterSpacing: 0.5 },

  resultBanner: { borderWidth: 2, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 18, alignItems: 'center', backgroundColor: COLORS.surface, gap: 4, width: '100%',
    shadowColor: COLORS.leather, shadowOpacity: 0.1, shadowRadius: 8, elevation: 2 },
  resultLine:   { fontSize: 22, fontFamily: FONTS.display, textAlign: 'center', letterSpacing: 1 },

  continueButton:     { backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 32, borderBottomWidth: 3, borderBottomColor: COLORS.ember },
  continueButtonText: { color: '#fff', fontFamily: FONTS.bodyExtraBold, fontSize: 13, letterSpacing: 0.5 },
  waitingReveal:      { fontSize: 12, color: COLORS.muted, fontStyle: 'italic' },

  // ── Special action panels ──
  specialTrigger:       { backgroundColor: COLORS.primary, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 20, width: '100%', alignItems: 'center', borderBottomWidth: 3, borderBottomColor: COLORS.ember },
  specialTriggerCompra: { backgroundColor: COLORS.gold, borderBottomColor: '#9A7020' },
  specialTriggerText:   { color: '#fff', fontFamily: FONTS.bodyExtraBold, fontSize: 12 },

  specialPanel:       { backgroundColor: COLORS.surface, borderRadius: 16, padding: 14, width: '100%', gap: 10, borderWidth: 2, borderColor: COLORS.border },
  specialPanelTitle:  { fontWeight: '700', fontSize: 13, color: COLORS.text },
  specialActions:     { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  specialConfirm:     { backgroundColor: COLORS.danger, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, flex: 1, alignItems: 'center', borderBottomWidth: 3, borderBottomColor: '#8B1F1A' },
  specialConfirmDisabled: { backgroundColor: COLORS.muted, borderBottomColor: '#7A6A60' },
  specialConfirmText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  specialCancel:      { paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center' },
  specialCancelText:  { color: COLORS.muted, fontWeight: '600', fontSize: 12 },

  // ── Idle zone (deck / discard stacks) ──
  idleZone:        { flexDirection: 'row', gap: 40, alignItems: 'center' },
  arenaGlow:       { position: 'absolute', width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(232,115,42,0.06)', alignSelf: 'center' },
  deckPile:        { alignItems: 'center', gap: 4 },
  discardPileIdle: { alignItems: 'center', gap: 4 },
  deckStack:       { width: 52, height: 72, borderRadius: 8, backgroundColor: COLORS.leather, borderWidth: 2, borderColor: COLORS.border, justifyContent: 'center', alignItems: 'center',
    shadowColor: COLORS.leather, shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 2, height: 3 }, elevation: 3 },
  deckStackEmpty:  { backgroundColor: 'transparent', borderStyle: 'dashed', shadowOpacity: 0 },
  deckStackCount:  { color: COLORS.sand, fontFamily: FONTS.display, fontSize: 18 },
  deckLabel:       { fontSize: 9, color: COLORS.muted, fontWeight: '700', letterSpacing: 1 },
  deckCount:       { fontSize: 22, fontWeight: '800', color: COLORS.text },

  // ── Local player area ──
  localPlayerArea: { backgroundColor: COLORS.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 12, paddingHorizontal: 12, paddingBottom: 8,
    shadowColor: COLORS.leather, shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: -4 }, elevation: 6 },
  localHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  localName:       { fontFamily: FONTS.bodyBold, fontSize: 14, color: COLORS.text },
  handRow:         { gap: 8, paddingTop: 18, paddingBottom: 8, paddingLeft: 4, paddingRight: 16 },
  floreoHint:      { color: COLORS.accent, fontSize: 12, fontWeight: '700', marginTop: -2, marginBottom: 4 },

  // ── Card tiles ──
  cardTile:         { backgroundColor: COLORS.card, borderRadius: 11, paddingTop: 8, paddingBottom: 9, paddingHorizontal: 7, alignItems: 'center', width: 68,
    borderWidth: 1.5, borderColor: COLORS.border, borderLeftWidth: 4,
    shadowColor: COLORS.leather, shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  cardTileLegal:    { shadowColor: COLORS.gold, shadowOpacity: 0.45, shadowRadius: 7, elevation: 3 },
  cardTileSelected: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight, shadowColor: COLORS.primary, shadowOpacity: 0.35, shadowRadius: 10, elevation: 4 },
  cardTileCommitted:{ borderColor: COLORS.primary, backgroundColor: '#FCE6D6', shadowColor: COLORS.primary, shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  cardTileCommittedBadge: { fontSize: 7, color: COLORS.primary, fontWeight: '900', marginBottom: 2, letterSpacing: 1 },
  cardTileIllegal:  { opacity: 0.28 },
  cardGlyph:        { fontSize: 18, marginBottom: 4 },
  cardName:         { fontFamily: FONTS.bodyBold, fontSize: 12, color: COLORS.text, textAlign: 'center', maxWidth: 58 },
  cardNamePt:       { fontFamily: FONTS.bodySemiBold, fontSize: 9, color: COLORS.muted, textAlign: 'center', marginTop: 2 },

  // ── Maculelê tokens ──
  maculeleRow:      { flexDirection: 'row', gap: 3, marginTop: 5, justifyContent: 'center' },
  maculeleDot:      { width: 13, height: 13, borderRadius: 4, borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' },
  maculeleSmall:    { width: 9, height: 9, borderRadius: 3, borderWidth: 1, borderColor: 'rgba(0,0,0,0.10)' },
  maculeleActive:   { backgroundColor: COLORS.danger },
  maculeleDanger:   { backgroundColor: COLORS.coral },
  maculeleInactive: { backgroundColor: COLORS.sand, borderColor: 'rgba(0,0,0,0.06)' },

  // ── Action buttons ──
  attackButton:         { backgroundColor: COLORS.danger, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 8, borderBottomWidth: 3, borderBottomColor: '#8B1F1A' },
  attackButtonDisabled: { backgroundColor: COLORS.muted, borderBottomColor: '#7A6A60' },
  attackButtonText:     { color: '#fff', fontFamily: FONTS.bodyExtraBold, fontSize: 14, letterSpacing: 0.5 },

  specialButton:     { backgroundColor: COLORS.accent, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 8, borderBottomWidth: 3, borderBottomColor: '#258A8A' },
  specialButtonText: { color: '#fff', fontFamily: FONTS.bodyExtraBold, fontSize: 13 },

  playButton:         { backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 8, borderBottomWidth: 3, borderBottomColor: COLORS.ember },
  playButtonDisabled: { backgroundColor: COLORS.muted, borderBottomColor: '#7A6A60' },
  playButtonText:     { color: '#fff', fontFamily: FONTS.bodyExtraBold, fontSize: 14 },

  // ── Empty hand / eliminated / burn reveal ──
  emptyHandBox:        { backgroundColor: '#FDE8E8', borderRadius: 14, padding: 14, marginTop: 8, borderWidth: 2, borderColor: COLORS.danger, gap: 6 },
  emptyHandTitle:      { color: COLORS.danger, fontWeight: '800', fontSize: 14 },
  emptyHandSub:        { color: COLORS.danger, fontSize: 12, opacity: 0.8 },
  emptyHandButton:     { backgroundColor: COLORS.danger, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 4, borderBottomWidth: 3, borderBottomColor: '#8B1F1A' },
  emptyHandButtonText: { color: '#fff', fontFamily: FONTS.bodyExtraBold, fontSize: 13 },

  eliminatedBox:   { backgroundColor: '#F1E6D4', borderRadius: 14, padding: 14, marginTop: 8, borderWidth: 1.5, borderColor: COLORS.border, gap: 6 },
  eliminatedTitle: { color: COLORS.text, fontWeight: '800', fontSize: 14 },
  eliminatedSub:   { color: COLORS.muted, fontSize: 12, lineHeight: 18 },

  burnRevealZone:  { padding: 16, backgroundColor: COLORS.surface, borderRadius: 18, borderWidth: 2, borderColor: COLORS.danger, gap: 8,
    shadowColor: COLORS.danger, shadowOpacity: 0.15, shadowRadius: 10, elevation: 3 },
  burnRevealTitle: { fontFamily: FONTS.display, fontSize: 16, color: COLORS.danger, letterSpacing: 2, textAlign: 'center' },
  burnRevealSub:   { fontSize: 12, color: COLORS.muted, textAlign: 'center' },
  juremaRevealZone:  { borderColor: COLORS.gold, shadowColor: COLORS.gold },
  juremaRevealTitle: { fontFamily: FONTS.display, fontSize: 17, color: COLORS.gold, letterSpacing: 2, textAlign: 'center' },

  // ── Opponent eliminated slots ──
  opponentSlotEliminated: { width: 82, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface, borderRadius: 12, padding: 8, opacity: 0.32, borderWidth: 1.5, borderColor: COLORS.sand },
  opponentNameEliminated: { fontSize: 11, fontWeight: '700', color: COLORS.muted, textAlign: 'center' },
  spectatorLabel:         { fontSize: 8, fontWeight: '900', color: COLORS.muted, letterSpacing: 2, marginTop: 3 },
});
