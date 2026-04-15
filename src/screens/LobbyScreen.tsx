import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Share,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useGameStore } from '../store/gameStore';
import { Room, subscribeToRoom, setReady, startMatch } from '../services/matchService';
import { COLORS } from '../constants/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Lobby'>;

export default function LobbyScreen({ route, navigation }: Props) {
  const { roomCode } = route.params;
  const store = useGameStore();
  const [room, setRoom] = useState<Room | null>(null);

  const isHost = room?.hostId === store.localPlayerId;
  const players = room ? Object.entries(room.players) : [];
  const minPlayers = __DEV__ ? 1 : 3;
  const allReady = players.length >= minPlayers && players.every(([, p]) => p.isReady);

  useEffect(() => {
    const unsub = subscribeToRoom(roomCode, (r) => {
      setRoom(r);
      // If match started, navigate to game
      if (r.matchId) {
        navigation.replace('GameTable', { matchId: r.matchId });
      }
    });
    return unsub;
  }, [roomCode]);

  const handleReady = async () => {
    if (!store.localPlayerId) return;
    const currentlyReady = room?.players[store.localPlayerId]?.isReady ?? false;
    await setReady(roomCode, store.localPlayerId, !currentlyReady);
  };

  const handleStart = async () => {
    if (!room) return;
    try {
      await startMatch(room);
    } catch (e: any) {
      Alert.alert('Cannot start', e.message);
    }
  };

  const handleShare = () => {
    Share.share({ message: `Join my Troca game! Room code: ${roomCode}` });
  };

  const myReady = room?.players[store.localPlayerId ?? '']?.isReady ?? false;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>ROOM</Text>
        <TouchableOpacity onPress={handleShare} style={styles.codeBox}>
          <Text style={styles.code}>{roomCode}</Text>
          <Text style={styles.codeTap}>tap to share</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.playerList}>
        <Text style={styles.sectionLabel}>PLAYERS ({players.length}/{room?.maxPlayers ?? 4})</Text>
        {players.map(([id, info]) => (
          <View key={id} style={styles.playerRow}>
            <View style={styles.playerInfo}>
              <Text style={styles.playerName}>{info.displayName}</Text>
              {id === room?.hostId && <Text style={styles.hostBadge}>HOST</Text>}
            </View>
            <View style={[styles.readyBadge, info.isReady ? styles.readyYes : styles.readyNo]}>
              <Text style={styles.readyText}>{info.isReady ? 'READY' : 'WAITING'}</Text>
            </View>
          </View>
        ))}
        {players.length < 3 && (
          <Text style={styles.waitingNote}>Need at least 3 players to start</Text>
        )}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.readyButton, myReady && styles.readyButtonActive]}
          onPress={handleReady}
        >
          <Text style={styles.readyButtonText}>{myReady ? '✓ READY' : 'READY UP'}</Text>
        </TouchableOpacity>

        {isHost && (
          <TouchableOpacity
            style={[styles.startButton, !allReady && styles.startButtonDisabled]}
            onPress={handleStart}
            disabled={!allReady}
          >
            <Text style={styles.startButtonText}>START GAME</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: COLORS.bg, padding: 24 },
  header:      { alignItems: 'center', marginBottom: 32 },
  title:       { fontSize: 13, fontWeight: '700', color: COLORS.muted, letterSpacing: 3 },
  codeBox:     { backgroundColor: COLORS.card, borderRadius: 16, paddingVertical: 16, paddingHorizontal: 32, alignItems: 'center', marginTop: 8, borderWidth: 1.5, borderColor: COLORS.border },
  code:        { fontSize: 36, fontWeight: '900', color: COLORS.primary, letterSpacing: 8 },
  codeTap:     { fontSize: 11, color: COLORS.muted, marginTop: 4 },

  sectionLabel: { fontSize: 11, fontWeight: '700', color: COLORS.muted, letterSpacing: 1.5, marginBottom: 12 },
  playerList:   { flex: 1 },
  playerRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: COLORS.card, borderRadius: 12, padding: 14, marginBottom: 8 },
  playerInfo:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  playerName:   { fontWeight: '700', fontSize: 15, color: COLORS.text },
  hostBadge:    { backgroundColor: COLORS.primary, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  readyBadge:   { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  readyYes:     { backgroundColor: '#D4EDDA' },
  readyNo:      { backgroundColor: '#F8D7DA' },
  readyText:    { fontSize: 10, fontWeight: '700' },
  waitingNote:  { color: COLORS.muted, fontSize: 13, textAlign: 'center', marginTop: 16 },

  actions:      { gap: 12 },
  readyButton:       { backgroundColor: COLORS.card, borderRadius: 16, paddingVertical: 16, alignItems: 'center', borderWidth: 2, borderColor: COLORS.border },
  readyButtonActive: { borderColor: COLORS.accent, backgroundColor: '#E8F8F8' },
  readyButtonText:   { fontWeight: '800', fontSize: 15, color: COLORS.text },
  startButton:         { backgroundColor: COLORS.primary, borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  startButtonDisabled: { backgroundColor: COLORS.muted },
  startButtonText:     { color: '#fff', fontWeight: '800', fontSize: 16, letterSpacing: 1 },
});
