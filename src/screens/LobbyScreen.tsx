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
import { COLORS, FONTS } from '../constants/theme';

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
        <Text style={styles.sectionLabel}>PLAYERS {players.length}/{room?.maxPlayers ?? 4}</Text>
        <View style={styles.playerGrid}>
          {players.map(([id, info]) => (
            <View key={id} style={[styles.playerTile, info.isReady && styles.playerTileReady]}>
              {id === room?.hostId && (
                <View style={styles.hostCrown}>
                  <Text style={styles.hostCrownText}>HOST</Text>
                </View>
              )}
              <Text style={styles.playerTileName} numberOfLines={1}>{info.displayName}</Text>
              <View style={[styles.tileStatus, info.isReady ? styles.tileStatusReady : styles.tileStatusWaiting]}>
                <Text style={[styles.tileStatusText, info.isReady ? styles.tileStatusTextReady : styles.tileStatusTextWaiting]}>
                  {info.isReady ? '✓ READY' : 'WAITING'}
                </Text>
              </View>
            </View>
          ))}
          {Array.from({ length: Math.max(0, (room?.maxPlayers ?? 4) - players.length) }).map((_, i) => (
            <View key={`empty-${i}`} style={styles.playerTileEmpty}>
              <Text style={styles.playerTileEmptyPlus}>+</Text>
              <Text style={styles.playerTileEmptyLabel}>waiting</Text>
            </View>
          ))}
        </View>
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
  title:       { fontFamily: FONTS.bodySemiBold, fontSize: 11, color: COLORS.muted, letterSpacing: 3 },

  // Room code stamp
  codeBox:     { backgroundColor: COLORS.leather, borderRadius: 18, paddingVertical: 18, paddingHorizontal: 36, alignItems: 'center', marginTop: 8,
    shadowColor: COLORS.leather, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
  code:        { fontFamily: FONTS.display, fontSize: 40, color: '#FAF5EC', letterSpacing: 10 },
  codeTap:     { fontFamily: FONTS.bodySemiBold, fontSize: 10, color: 'rgba(250,245,236,0.55)', marginTop: 5, letterSpacing: 1 },

  sectionLabel: { fontFamily: FONTS.bodyExtraBold, fontSize: 10, color: COLORS.muted, letterSpacing: 2, marginBottom: 14 },
  playerList:   { flex: 1 },

  // Player tile grid
  playerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },

  playerTile: {
    width: 140, height: 116,
    backgroundColor: COLORS.surface, borderRadius: 20, padding: 14,
    alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 2, borderColor: COLORS.border,
    shadowColor: COLORS.leather, shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  playerTileReady: {
    borderColor: COLORS.accent,
    shadowColor: COLORS.accent, shadowOpacity: 0.22, elevation: 4,
  },
  hostCrown: {
    position: 'absolute', top: -10, right: -10,
    backgroundColor: COLORS.gold, borderRadius: 999,
    paddingHorizontal: 7, paddingVertical: 3,
    shadowColor: COLORS.gold, shadowOpacity: 0.4, shadowRadius: 4, elevation: 3,
  },
  hostCrownText: { fontFamily: FONTS.display, fontSize: 12, color: '#fff', letterSpacing: 1 },
  playerTileName: { fontFamily: FONTS.bodyBold, fontSize: 15, color: COLORS.text, textAlign: 'center', maxWidth: 116 },
  tileStatus: { borderRadius: 10, paddingVertical: 6, width: '100%', alignItems: 'center', borderWidth: 1.5 },
  tileStatusReady:   { backgroundColor: '#E2F4E8', borderColor: '#6DBF85' },
  tileStatusWaiting: { backgroundColor: COLORS.bg, borderColor: COLORS.sand },
  tileStatusText:    { fontFamily: FONTS.bodyExtraBold, fontSize: 10, letterSpacing: 0.5 },
  tileStatusTextReady:   { color: '#2A7D45' },
  tileStatusTextWaiting: { color: COLORS.muted },

  playerTileEmpty: {
    width: 140, height: 116,
    borderRadius: 20, borderWidth: 2, borderColor: COLORS.sand,
    borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', gap: 4,
  },
  playerTileEmptyPlus:  { fontSize: 22, color: COLORS.sand },
  playerTileEmptyLabel: { fontFamily: FONTS.bodySemiBold, fontSize: 10, color: COLORS.sand, letterSpacing: 1 },

  waitingNote:  { fontFamily: FONTS.bodyRegular, color: COLORS.muted, fontSize: 13, textAlign: 'center', marginTop: 16 },

  actions:      { gap: 12, marginTop: 8 },
  readyButton:       { backgroundColor: COLORS.surface, borderRadius: 16, paddingVertical: 16, alignItems: 'center', borderWidth: 2, borderColor: COLORS.border,
    shadowColor: COLORS.leather, shadowOpacity: 0.06, shadowRadius: 4, elevation: 1 },
  readyButtonActive: { borderColor: COLORS.accent, backgroundColor: '#E4F7F7',
    shadowColor: COLORS.accent, shadowOpacity: 0.2, shadowRadius: 6, elevation: 2 },
  readyButtonText:   { fontFamily: FONTS.bodyExtraBold, fontSize: 15, color: COLORS.text },
  startButton:         { backgroundColor: COLORS.primary, borderRadius: 16, paddingVertical: 16, alignItems: 'center', borderBottomWidth: 4, borderBottomColor: COLORS.ember },
  startButtonDisabled: { backgroundColor: COLORS.muted, borderBottomColor: '#7A6A60' },
  startButtonText:     { color: '#fff', fontFamily: FONTS.bodyExtraBold, fontSize: 16, letterSpacing: 1 },
});
