import React, { useEffect, useCallback, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
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

import { COLORS } from '../constants/theme';
import { buildCardDefinitions } from '../constants/deck';

type Props = NativeStackScreenProps<RootStackParamList, 'GameTable'>;

const subtypeMap = new Map<string, string>();
buildCardDefinitions().forEach((card, id) => subtypeMap.set(id, card.subtype));

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

  return (
    <SafeAreaView style={styles.container}>
      {/* Phase banner */}
      <View style={[styles.phaseBanner, phase === 'REVEAL' && styles.phaseBannerReveal]}>
        <Text style={styles.phaseLabel} numberOfLines={1}>{phaseLabel}</Text>
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
      <ScrollView style={styles.clashScroll} contentContainerStyle={styles.clashZone}>
        {showClashZone ? (
          <>
            {/* Two card slots */}
            <View style={styles.clashRow}>
              <ClashSlot
                label={attackerName} hasStaged={attackerHasStaged} isLocal={isAttacker} role="attacker"
                cardName={attackerCardName}
              />
              <View style={styles.vsContainer}>
                <Text style={styles.vsText}>VS</Text>
                <View style={styles.deckBadge}>
                  <Text style={styles.deckBadgeText}>{match?.deck.length ?? 0}</Text>
                  <Text style={styles.deckBadgeLabel}>deck</Text>
                </View>
              </View>
              <ClashSlot
                label={defenderName ?? '?'} hasStaged={defenderHasStaged} isLocal={isDefender} role="defender"
                cardName={defenderCardName}
              />
            </View>

            {/* Result banner */}
            {clashResult && (
              <View style={[styles.resultBanner, { borderColor: clashResult.color }]}>
                {clashResult.lines.map((line, i) => (
                  <Text key={i} style={[styles.resultLine, { color: clashResult.color }]}>{line}</Text>
                ))}
              </View>
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
              <TouchableOpacity style={styles.continueButton} onPress={handleSkipReveal}>
                <Text style={styles.continueButtonText}>CONTINUE →</Text>
              </TouchableOpacity>
            )}
            {phase === 'REVEAL' && !isAttacker && specialMode === null && (
              <Text style={styles.waitingReveal}>Waiting for {attackerName} to continue…</Text>
            )}
          </>
        ) : isJuremaReveal ? (
          <View style={styles.burnRevealZone}>
            <Text style={styles.burnRevealTitle}>JUREMA SAVED!</Text>
            <Text style={styles.burnRevealSub}>
              {match?.players.find(p => p.id === match.juremaPlayerId)?.displayName ?? '?'} reached 5 maculelê but used Jurema — reset to 4.
            </Text>
            {isAttacker && (
              <TouchableOpacity style={styles.continueButton} onPress={handleDismissJurema}>
                <Text style={styles.continueButtonText}>CONTINUE →</Text>
              </TouchableOpacity>
            )}
            {!isAttacker && (
              <Text style={styles.waitingReveal}>Waiting for {attackerName} to continue…</Text>
            )}
          </View>
        ) : isBurnReveal ? (
          <View style={styles.burnRevealZone}>
            <Text style={styles.burnRevealTitle}>
              PENALTY — {burnRevealPlayer?.displayName ?? '?'}'s hand
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
              <TouchableOpacity style={styles.continueButton} onPress={handleResolveBurnReveal}>
                <Text style={styles.continueButtonText}>CONTINUE →</Text>
              </TouchableOpacity>
            )}
            {!isAttacker && (
              <Text style={styles.waitingReveal}>Waiting for {attackerName} to continue…</Text>
            )}
          </View>
        ) : (
          <View style={styles.idleZone}>
            <View style={styles.deckPile}>
              <Text style={styles.deckLabel}>DECK</Text>
              <Text style={styles.deckCount}>{match?.deck.length ?? 0}</Text>
            </View>
            <View style={styles.discardPileIdle}>
              <Text style={styles.deckLabel}>DISCARD</Text>
              <Text style={styles.deckCount}>{match?.discardPile.length ?? 0}</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* ── Local player area ── */}
      {localPlayer && (
        <View style={styles.localPlayerArea}>
          <View style={styles.localHeader}>
            <Text style={styles.localName}>{localPlayer.displayName}</Text>
            <MaculeleBar count={localPlayer.maculeleCount} />
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.handRow}>
            {store.myHand.map((cardId) => {
              const card = CARD_MAP.get(cardId);
              if (!card) return null;
              const isLegalForAction = phase === 'ACTION_SELECTION' && (isAttacker || canDefenderAct) && card.type === 'action' && !myCardStaged;
              const isLegalForFloreo = card.subtype === 'floreo' && canAttachSelectedFloreo && hasAvailableFloreo;
              const isLegalNow = isLegalForAction || isLegalForFloreo || store.legalCardIds.has(cardId);
              const isSelected = store.selectedCardId === cardId || store.selectedFloreoId === cardId;
              const isCommitted = localStagedActionId === cardId;
              return (
                <CardTile
                  key={cardId} cardId={cardId}
                  isSelected={isSelected}
                  isCommitted={isCommitted}
                  isLegal={isLegalNow}
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
              onPress={handleAttack} disabled={!selectedTargetId}
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
              onPress={handlePlayAction} disabled={!store.selectedCardId}
            >
              <Text style={styles.playButtonText}>PLAY CARD</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {showCheatSheet && (
        <View style={styles.cheatSheetOverlay}>
          <View style={styles.cheatSheetCard}>
            <View style={styles.cheatSheetHeader}>
              <Text style={styles.cheatSheetTitle}>Clash Cheat Sheet</Text>
              <TouchableOpacity onPress={() => setShowCheatSheet(false)}>
                <Text style={styles.cheatSheetClose}>CLOSE</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.cheatSheetGrid}>
              <CheatCell label="Your card" header />
              <CheatCell label="Kick" header />
              <CheatCell label="Evasion" header />
              <CheatCell label="Knockdown" header />

              <CheatCell label="Kick" side />
              <CheatCell label="Both +1" danger />
              <CheatCell label="No effect" neutral />
              <CheatCell label="Kick +1" info />

              <CheatCell label="Evasion" side />
              <CheatCell label="No effect" neutral />
              <CheatCell label="Play again" neutral />
              <CheatCell label="Knockdown +1" info />

              <CheatCell label="Knockdown" side />
              <CheatCell label="Kick +1" info />
              <CheatCell label="Knockdown +1" info />
              <CheatCell label="Both +1" danger />
            </View>

            <View style={styles.cheatSheetNotes}>
              <Text style={styles.cheatSheetNote}>Floreo: doubles any maculelê gained from the clash.</Text>
              <Text style={styles.cheatSheetNote}>Kick vs Evasion + any Floreo: both players remove 1 maculelê.</Text>
              <Text style={styles.cheatSheetNote}>Troca or Compra replacing that card cancels its Floreo.</Text>
              <Text style={styles.cheatSheetNote}>Floreo does not stack.</Text>
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── ClashSlot ─────────────────────────────────────────────────────────────────

function ClashSlot({ label, hasStaged, isLocal, role, cardName }: {
  label: string; hasStaged: boolean; isLocal: boolean;
  role: 'attacker' | 'defender'; cardName: string | null;
}) {
  const borderColor = role === 'attacker' ? COLORS.primary : COLORS.accent;
  const bg = role === 'attacker' ? COLORS.primaryLight : '#E8F8F8';
  return (
    <View style={styles.clashSlot}>
      <Text style={styles.clashSlotName} numberOfLines={1}>{label}</Text>
      <View style={[styles.clashCard,
        (hasStaged || cardName) && { borderColor, backgroundColor: bg, borderWidth: 2.5 },
      ]}>
        {cardName ? (
          <Text style={[styles.clashCardRevealedName, { color: borderColor }]} numberOfLines={2}>{cardName}</Text>
        ) : hasStaged ? (
          <>
            <Text style={[styles.clashCardIcon, { color: borderColor }]}>▪</Text>
            <Text style={[styles.clashCardReady, { color: borderColor }]}>{isLocal ? 'You' : '✓'}</Text>
          </>
        ) : (
          <Text style={styles.clashCardEmpty}>?</Text>
        )}
      </View>
    </View>
  );
}

// ─── OpponentSlot ──────────────────────────────────────────────────────────────

function OpponentSlot({ player, isDefender, isAttacker, isSelectedTarget }: {
  player: Player; isDefender: boolean; isAttacker: boolean; isSelectedTarget: boolean;
}) {
  if (player.isEliminated) {
    return (
      <View style={styles.opponentSlotEliminated}>
        <Text style={styles.opponentNameEliminated} numberOfLines={1}>{player.displayName}</Text>
        <Text style={styles.spectatorLabel}>OUT</Text>
      </View>
    );
  }
  return (
    <View style={[styles.opponentSlot, isDefender && styles.opponentDefender, isAttacker && styles.opponentAttacker, isSelectedTarget && styles.opponentTargeted]}>
      <Text style={styles.opponentName} numberOfLines={1}>{player.displayName}</Text>
      <Text style={styles.opponentCards}>{'♦'.repeat(Math.min(player.hand.length, 7))}</Text>
      <MaculeleBar count={player.maculeleCount} small />
      {!player.isConnected && <Text style={styles.disconnected}>⚡</Text>}
    </View>
  );
}

function MaculeleBar({ count, small }: { count: number; small?: boolean }) {
  return (
    <View style={styles.maculeleRow}>
      {Array.from({ length: 5 }).map((_, i) => (
        <View key={`mac-${i}`} style={[small ? styles.maculeleSmall : styles.maculeleDot, i < count ? styles.maculeleActive : styles.maculeleInactive]} />
      ))}
    </View>
  );
}

function CardTile({ cardId, isSelected, isCommitted, isLegal, onPress }: {
  cardId: string; isSelected: boolean; isCommitted?: boolean; isLegal: boolean; onPress: () => void;
}) {
  const card = CARD_MAP.get(cardId);
  if (!card) return null;
  return (
    <TouchableOpacity
      style={[
        styles.cardTile,
        isSelected && styles.cardTileSelected,
        isCommitted && styles.cardTileCommitted,
        !isLegal && !isCommitted && styles.cardTileIllegal,
      ]}
      onPress={onPress}
      onLongPress={() => Alert.alert(`${card.nameHe} · ${card.namePt}`, card.descriptionHe)}
      activeOpacity={isLegal ? 0.7 : 0.9}
    >
      {isCommitted && <Text style={styles.cardTileCommittedBadge}>PLAYED</Text>}
      <Text style={styles.cardSubtype}>{card.subtype.slice(0, 3).toUpperCase()}</Text>
      <Text style={styles.cardName} numberOfLines={1}>{card.nameHe}</Text>
    </TouchableOpacity>
  );
}

function CheatCell({ label, header, side, danger, info, neutral }: {
  label: string;
  header?: boolean;
  side?: boolean;
  danger?: boolean;
  info?: boolean;
  neutral?: boolean;
}) {
  return (
    <View style={[
      styles.cheatCell,
      header && styles.cheatCellHeader,
      side && styles.cheatCellSide,
      danger && styles.cheatCellDanger,
      info && styles.cheatCellInfo,
      neutral && styles.cheatCellNeutral,
    ]}>
      <Text style={[
        styles.cheatCellText,
        (header || side) && styles.cheatCellTextStrong,
      ]}>
        {label}
      </Text>
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
  container:         { flex: 1, backgroundColor: COLORS.bg },
  phaseBanner:       { backgroundColor: COLORS.primary, paddingVertical: 8, paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  phaseBannerReveal: { backgroundColor: '#5C3D8F' },
  phaseLabel:        { color: '#fff', fontWeight: '700', fontSize: 13, flex: 1 },
  cheatSheetButton:  { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, marginHorizontal: 8 },
  cheatSheetButtonText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  roundLabel:        { color: 'rgba(255,255,255,0.7)', fontSize: 11, marginLeft: 8 },
  reshuffleBanner:   { backgroundColor: '#E8F8F8', borderBottomWidth: 1, borderBottomColor: '#B8E2E2', paddingVertical: 8, paddingHorizontal: 16 },
  reshuffleBannerText: { color: '#146C6C', fontSize: 12, fontWeight: '800', textAlign: 'center', letterSpacing: 0.3 },
  cheatSheetOverlay: { position: 'absolute', inset: 0, backgroundColor: 'rgba(44,26,14,0.42)', justifyContent: 'center', padding: 16 },
  cheatSheetCard:    { backgroundColor: COLORS.surface, borderRadius: 24, padding: 16, borderWidth: 1.5, borderColor: COLORS.border, gap: 12 },
  cheatSheetHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cheatSheetTitle:   { color: COLORS.text, fontSize: 18, fontWeight: '900' },
  cheatSheetClose:   { color: COLORS.primary, fontSize: 12, fontWeight: '900', letterSpacing: 0.8 },
  cheatSheetGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: 1, backgroundColor: COLORS.border, padding: 1, borderRadius: 14, overflow: 'hidden' },
  cheatCell:         { width: '24.6%', minHeight: 52, backgroundColor: COLORS.card, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
  cheatCellHeader:   { backgroundColor: '#B47ABB' },
  cheatCellSide:     { backgroundColor: '#7E90D2' },
  cheatCellDanger:   { backgroundColor: '#F7D8D4' },
  cheatCellInfo:     { backgroundColor: '#DBE5FB' },
  cheatCellNeutral:  { backgroundColor: '#ECE7DE' },
  cheatCellText:     { color: COLORS.text, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  cheatCellTextStrong: { color: '#fff', fontWeight: '900' },
  cheatSheetNotes:   { gap: 6, backgroundColor: '#FFF8EA', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: '#EBCB97' },
  cheatSheetNote:    { color: COLORS.text, fontSize: 12, lineHeight: 18 },

  opponentsRow:     { maxHeight: 110, marginVertical: 8 },
  opponentsContent: { paddingHorizontal: 12, gap: 8 },
  opponentSlot:     { backgroundColor: COLORS.card, borderRadius: 10, padding: 10, minWidth: 90, alignItems: 'center', borderWidth: 1.5, borderColor: COLORS.border },
  opponentAttacker: { borderColor: COLORS.primary },
  opponentDefender: { borderColor: COLORS.accent },
  opponentTargeted: { borderColor: COLORS.danger, borderWidth: 2.5 },
  opponentName:     { fontWeight: '700', fontSize: 12, color: COLORS.text, maxWidth: 80 },
  opponentCards:    { fontSize: 11, color: COLORS.muted, marginTop: 2 },
  disconnected:     { fontSize: 9, color: COLORS.muted, marginTop: 2 },

  clashScroll:  { flex: 1 },
  clashZone:    { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  clashRow:     { flexDirection: 'row', alignItems: 'center', gap: 12 },

  clashSlot:             { alignItems: 'center', gap: 6 },
  clashSlotName:         { fontSize: 11, fontWeight: '700', color: COLORS.muted, maxWidth: 90, textAlign: 'center' },
  clashCard:             { width: 80, height: 108, borderRadius: 10, borderWidth: 2, borderColor: COLORS.border, backgroundColor: COLORS.card, justifyContent: 'center', alignItems: 'center' },
  clashCardIcon:         { fontSize: 28 },
  clashCardReady:        { fontSize: 11, fontWeight: '800', marginTop: 4 },
  clashCardEmpty:        { fontSize: 28, color: COLORS.border },
  clashCardRevealedName: { fontSize: 13, fontWeight: '800', textAlign: 'center', paddingHorizontal: 4 },

  vsContainer:    { alignItems: 'center', gap: 8 },
  vsText:         { fontSize: 16, fontWeight: '900', color: COLORS.muted },
  deckBadge:      { alignItems: 'center' },
  deckBadgeText:  { fontSize: 16, fontWeight: '800', color: COLORS.text },
  deckBadgeLabel: { fontSize: 9, color: COLORS.muted, fontWeight: '600' },

  resultBanner: { borderWidth: 1.5, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center', backgroundColor: COLORS.card, gap: 4, width: '100%' },
  resultLine:   { fontSize: 15, fontWeight: '800', textAlign: 'center' },

  continueButton:     { backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 28 },
  continueButtonText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  waitingReveal:      { fontSize: 12, color: COLORS.muted, fontStyle: 'italic' },

  // Special action panels
  specialTrigger:      { backgroundColor: '#4A90D9', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20, width: '100%', alignItems: 'center' },
  specialTriggerCompra:{ backgroundColor: '#7B52AB' },
  specialTriggerText:  { color: '#fff', fontWeight: '800', fontSize: 12 },

  specialPanel:       { backgroundColor: COLORS.card, borderRadius: 14, padding: 14, width: '100%', gap: 10, borderWidth: 1.5, borderColor: COLORS.border },
  specialPanelTitle:  { fontWeight: '700', fontSize: 13, color: COLORS.text },
  specialActions:     { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  specialConfirm:     { backgroundColor: COLORS.danger, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, flex: 1, alignItems: 'center' },
  specialConfirmDisabled: { backgroundColor: COLORS.muted },
  specialConfirmText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  specialCancel:      { paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center' },
  specialCancelText:  { color: COLORS.muted, fontWeight: '600', fontSize: 12 },

  idleZone:        { flexDirection: 'row', gap: 40, alignItems: 'center' },
  deckPile:        { alignItems: 'center' },
  discardPileIdle: { alignItems: 'center' },
  deckLabel:       { fontSize: 10, color: COLORS.muted, fontWeight: '600' },
  deckCount:       { fontSize: 22, fontWeight: '800', color: COLORS.text },

  localPlayerArea: { backgroundColor: COLORS.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 12, paddingHorizontal: 12, paddingBottom: 8 },
  localHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  localName:       { fontWeight: '700', fontSize: 14, color: COLORS.text },
  handRow:         { gap: 8, paddingVertical: 8 },
  floreoHint:      { color: COLORS.accent, fontSize: 12, fontWeight: '700', marginTop: -2, marginBottom: 4 },

  cardTile:         { backgroundColor: COLORS.card, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 8, alignItems: 'center', minWidth: 60, borderWidth: 1.5, borderColor: COLORS.border },
  cardTileSelected: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
  cardTileCommitted:{ borderColor: COLORS.primary, backgroundColor: '#FCE6D6', shadowColor: COLORS.primary, shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  cardTileCommittedBadge: { fontSize: 8, color: COLORS.primary, fontWeight: '900', marginBottom: 3, letterSpacing: 0.8 },
  cardTileIllegal:  { opacity: 0.4 },
  cardSubtype:      { fontSize: 9, color: COLORS.muted, fontWeight: '700', marginBottom: 2 },
  cardName:         { fontSize: 11, fontWeight: '700', color: COLORS.text, textAlign: 'center', maxWidth: 60 },

  maculeleRow:      { flexDirection: 'row', gap: 4, marginTop: 4, justifyContent: 'center' },
  maculeleDot:      { width: 12, height: 12, borderRadius: 6 },
  maculeleSmall:    { width: 7, height: 7, borderRadius: 4 },
  maculeleActive:   { backgroundColor: COLORS.danger },
  maculeleInactive: { backgroundColor: COLORS.border },

  attackButton:         { backgroundColor: COLORS.danger, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  attackButtonDisabled: { backgroundColor: COLORS.muted },
  attackButtonText:     { color: '#fff', fontWeight: '800', fontSize: 14, letterSpacing: 0.5 },

  specialButton:     { backgroundColor: COLORS.accent, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  specialButtonText: { color: '#fff', fontWeight: '800', fontSize: 13 },

  playButton:         { backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  playButtonDisabled: { backgroundColor: COLORS.muted },
  playButtonText:     { color: '#fff', fontWeight: '800', fontSize: 14 },

  emptyHandBox:        { backgroundColor: '#FDE8E8', borderRadius: 14, padding: 14, marginTop: 8, borderWidth: 1.5, borderColor: COLORS.danger, gap: 6 },
  emptyHandTitle:      { color: COLORS.danger, fontWeight: '800', fontSize: 14 },
  emptyHandSub:        { color: COLORS.danger, fontSize: 12, opacity: 0.8 },
  emptyHandButton:     { backgroundColor: COLORS.danger, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  emptyHandButtonText: { color: '#fff', fontWeight: '800', fontSize: 13 },

  eliminatedBox:   { backgroundColor: '#F1E6D4', borderRadius: 14, padding: 14, marginTop: 8, borderWidth: 1.5, borderColor: COLORS.border, gap: 6 },
  eliminatedTitle: { color: COLORS.text, fontWeight: '800', fontSize: 14 },
  eliminatedSub:   { color: COLORS.muted, fontSize: 12, lineHeight: 18 },

  burnRevealZone:  { padding: 16, backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 2, borderColor: COLORS.danger, gap: 8 },
  burnRevealTitle: { fontSize: 13, fontWeight: '800', color: COLORS.danger, letterSpacing: 1.5, textAlign: 'center' },
  burnRevealSub:   { fontSize: 12, color: COLORS.muted, textAlign: 'center' },

  opponentSlotEliminated: { width: 80, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.card, borderRadius: 12, padding: 8, opacity: 0.4, borderWidth: 1, borderColor: COLORS.border },
  opponentNameEliminated: { fontSize: 12, fontWeight: '600', color: COLORS.muted, textAlign: 'center' },
  spectatorLabel:         { fontSize: 9, fontWeight: '700', color: COLORS.muted, letterSpacing: 1, marginTop: 4 },
});
