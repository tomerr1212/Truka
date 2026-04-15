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
              {id === room?.hostId && <View style={styles.hostBadge}><Text style={styles.hostBadgeText}>HOST</Text></View>}
            </View>
            <View style={[styles.readyBadge, info.isReady ? styles.readyYes : styles.readyNo]}>
              <Text style={[styles.readyText, info.isReady ? styles.readyTextYes : styles.readyTextNo]}>{info.isReady ? 'READY' : 'WAITING'}</Text>
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
  header:      { alignItems: 'center', marginBottom: 28 },
  title:       { fontSize: 11, fontWeight: '800', color: COLORS.muted, letterSpacing: 3 },

  // Room code stamp
  codeBox:     { backgroundColor: COLORS.leather, borderRadius: 18, paddingVertical: 18, paddingHorizontal: 36, alignItems: 'center', marginTop: 8,
    shadowColor: COLORS.leather, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
  code:        { fontSize: 36, fontWeight: '900', color: '#FAF5EC', letterSpacing: 10 },
  codeTap:     { fontSize: 10, color: 'rgba(250,245,236,0.55)', marginTop: 5, fontWeight: '600', letterSpacing: 1 },

  sectionLabel: { fontSize: 10, fontWeight: '800', color: COLORS.muted, letterSpacing: 2, marginBottom: 12 },
  playerList:   { flex: 1 },
  playerRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, marginBottom: 8,
    borderWidth: 1.5, borderColor: COLORS.border,
    shadowColor: COLORS.leather, shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  playerInfo:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  playerName:   { fontWeight: '800', fontSize: 15, color: COLORS.text },
  hostBadge:    { backgroundColor: COLORS.gold, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 },
  hostBadgeText:{ fontSize: 9, fontWeight: '900', color: '#fff', letterSpacing: 0.8 },
  readyBadge:   { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1.5 },
  readyYes:     { backgroundColor: '#E2F4E8', borderColor: '#6DBF85' },
  readyNo:      { backgroundColor: COLORS.surface, borderColor: COLORS.sand },
  readyText:    { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  readyTextYes: { color: '#2A7D45' },
  readyTextNo:  { color: COLORS.muted },
  waitingNote:  { color: COLORS.muted, fontSize: 13, textAlign: 'center', marginTop: 16 },

  actions:      { gap: 12, marginTop: 8 },
  readyButton:       { backgroundColor: COLORS.surface, borderRadius: 16, paddingVertical: 16, alignItems: 'center', borderWidth: 2, borderColor: COLORS.border,
    shadowColor: COLORS.leather, shadowOpacity: 0.06, shadowRadius: 4, elevation: 1 },
  readyButtonActive: { borderColor: COLORS.accent, backgroundColor: '#E4F7F7',
    shadowColor: COLORS.accent, shadowOpacity: 0.2, shadowRadius: 6, elevation: 2 },
  readyButtonText:   { fontWeight: '800', fontSize: 15, color: COLORS.text },
  startButton:         { backgroundColor: COLORS.primary, borderRadius: 16, paddingVertical: 16, alignItems: 'center', borderBottomWidth: 4, borderBottomColor: COLORS.ember },
  startButtonDisabled: { backgroundColor: COLORS.muted, borderBottomColor: '#7A6A60' },
  startButtonText:     { color: '#fff', fontWeight: '800', fontSize: 16, letterSpacing: 1 },
});
