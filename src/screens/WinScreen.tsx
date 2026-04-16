import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useGameStore } from '../store/gameStore';
import { Room, setReady, startMatch, subscribeToRoom } from '../services/matchService';
import { COLORS, FONTS } from '../constants/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Win'>;

export default function WinScreen({ route, navigation }: Props) {
  const { winnerId, winnerName, matchId, isDraw } = route.params;
  const store = useGameStore();
  const roomCode = store.roomCode;
  const [room, setRoom] = useState<Room | null>(null);

  useEffect(() => {
    if (!roomCode) return;
    const unsub = subscribeToRoom(roomCode, (nextRoom) => {
      setRoom(nextRoom);
      if (nextRoom.matchId && nextRoom.matchId !== matchId) {
        navigation.replace('GameTable', { matchId: nextRoom.matchId });
      }
    });
    return unsub;
  }, [roomCode, matchId, navigation]);

  const myId = store.localPlayerId ?? '';
  const myReady = room?.players[myId]?.isReady ?? false;
  const isWinner = !isDraw && !!winnerId && myId === winnerId;
  const isHost = room?.hostId === myId;
  const players = room ? Object.entries(room.players) : [];
  const minPlayers = __DEV__ ? 1 : 3;
  const allReady = players.length >= minPlayers && players.every(([, info]) => info.isReady);

  const handleToggleReady = async () => {
    if (!roomCode || !myId) return;
    await setReady(roomCode, myId, !myReady);
  };

  const handleStartRematch = async () => {
    if (!room) return;
    await startMatch(room);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <Text style={styles.kicker}>RODA COMPLETE</Text>
          <View style={styles.winnerStamp}>
            <Text style={styles.winnerStampText}>{isDraw ? 'DRAW' : isWinner ? 'VITORIA' : 'WINNER'}</Text>
          </View>
          <Text style={styles.title}>
            {isDraw ? 'No One Holds The Roda' : isWinner ? 'You Hold The Roda' : `${winnerName} Holds The Roda`}
          </Text>
          <Text style={styles.subtitle}>
            {isDraw
              ? 'Both final players were eliminated in the same clash. Mark ready if you want another round.'
              : isWinner
              ? 'Everyone else is out. Mark yourself ready if you want another round.'
              : `${winnerName} is the last player standing. Vote if you want an immediate rematch.`}
          </Text>
          {roomCode && (
            <View style={styles.roomTag}>
              <Text style={styles.roomTagLabel}>ROOM</Text>
              <Text style={styles.roomTagCode}>{roomCode}</Text>
            </View>
          )}
        </View>

        <View style={styles.panel}>
          <View style={styles.panelHeader}>
            <Text style={styles.sectionTitle}>REMATCH BOARD</Text>
            <Text style={styles.sectionMeta}>{players.filter(([, info]) => info.isReady).length}/{players.length} ready</Text>
          </View>
          {players.map(([id, info]) => (
            <View key={id} style={[styles.playerRow, !isDraw && id === winnerId && styles.playerRowWinner]}>
              <View style={styles.playerCopy}>
                <Text style={styles.playerName}>{info.displayName}</Text>
                <Text style={styles.playerRole}>
                  {!isDraw && id === winnerId ? 'Winner' : id === room?.hostId ? 'Host' : 'Player'}
                </Text>
              </View>
              <View style={[styles.badge, info.isReady ? styles.badgeReady : styles.badgeWaiting]}>
                <Text style={[styles.badgeText, info.isReady && styles.badgeTextReady]}>
                  {info.isReady ? 'READY' : 'WAITING'}
                </Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.readyButton, myReady && styles.readyButtonActive]}
            onPress={handleToggleReady}
            disabled={!roomCode}
          >
            <Text style={[styles.readyButtonText, myReady && styles.readyButtonTextActive]}>
              {myReady ? 'SWITCH TO NOT READY' : 'I WANT A REMATCH'}
            </Text>
          </TouchableOpacity>

          {isHost && (
            <TouchableOpacity
              style={[styles.startButton, !allReady && styles.startButtonDisabled]}
              onPress={handleStartRematch}
              disabled={!allReady}
            >
              <Text style={styles.startButtonText}>
                {allReady ? 'START THE NEXT RODA' : 'WAITING FOR EVERYONE TO READY UP'}
              </Text>
            </TouchableOpacity>
          )}

          <Text style={styles.note}>
            {isHost
              ? 'When every player is ready, you can start the rematch here.'
              : 'The host starts the rematch as soon as everyone is ready.'}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 24, gap: 18 },
  backgroundOrbTop: {
    position: 'absolute',
    top: -80,
    right: -50,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: '#F3C78A',
    opacity: 0.35,
  },
  backgroundOrbBottom: {
    position: 'absolute',
    bottom: -90,
    left: -70,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: '#D8EEE8',
    opacity: 0.6,
  },
  heroCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 28,
    padding: 22,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    gap: 10,
    overflow: 'hidden',
  },
  kicker: { fontFamily: FONTS.bodyExtraBold, fontSize: 12, color: COLORS.primary, letterSpacing: 2.5 },
  winnerStamp: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: COLORS.primary,
  },
  winnerStampText: { fontFamily: FONTS.display, color: '#fff', fontSize: 14, letterSpacing: 2 },
  title: { fontFamily: FONTS.display, fontSize: 40, color: COLORS.text, lineHeight: 42, maxWidth: 280 },
  subtitle: { fontFamily: FONTS.bodyRegular, fontSize: 15, color: COLORS.muted, lineHeight: 22, maxWidth: 320 },
  roomTag: {
    marginTop: 6,
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.card,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  roomTagLabel: { fontFamily: FONTS.bodyExtraBold, color: COLORS.muted, fontSize: 11, letterSpacing: 1.5 },
  roomTagCode: { fontFamily: FONTS.display, color: COLORS.text, fontSize: 16, letterSpacing: 2 },

  panel: {
    backgroundColor: '#F9F4E7',
    borderRadius: 24,
    padding: 18,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    gap: 10,
  },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontFamily: FONTS.bodyExtraBold, fontSize: 12, color: COLORS.muted, letterSpacing: 1.7 },
  sectionMeta: { fontFamily: FONTS.bodyBold, color: COLORS.text, fontSize: 12 },
  playerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.04)',
  },
  playerRowWinner: { borderColor: '#F0BA69', backgroundColor: '#FFF8EA' },
  playerCopy: { gap: 2 },
  playerName: { fontFamily: FONTS.bodyBold, color: COLORS.text, fontSize: 14 },
  playerRole: { fontFamily: FONTS.bodySemiBold, color: COLORS.muted, fontSize: 11, letterSpacing: 0.5 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  badgeReady: { backgroundColor: '#D7F1EA' },
  badgeWaiting: { backgroundColor: '#F8E4DE' },
  badgeText: { fontFamily: FONTS.bodyExtraBold, color: COLORS.danger, fontSize: 11 },
  badgeTextReady: { color: '#117A65' },

  actions: { gap: 12, paddingBottom: 8 },
  readyButton: {
    backgroundColor: COLORS.card,
    borderRadius: 18,
    paddingVertical: 18,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  readyButtonActive: {
    borderColor: COLORS.accent,
    backgroundColor: '#E8F8F8',
  },
  readyButtonText: { fontFamily: FONTS.bodyExtraBold, color: COLORS.text, fontSize: 15, letterSpacing: 0.5 },
  readyButtonTextActive: { color: COLORS.accent },
  startButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 18,
    paddingVertical: 18,
    alignItems: 'center',
    borderBottomWidth: 3,
    borderBottomColor: COLORS.ember,
  },
  startButtonDisabled: { backgroundColor: COLORS.muted, borderBottomColor: '#7A6A60' },
  startButtonText: { fontFamily: FONTS.bodyExtraBold, color: '#fff', fontSize: 14, letterSpacing: 0.8, textAlign: 'center', paddingHorizontal: 12 },
  note: { color: COLORS.muted, fontSize: 12, textAlign: 'center', lineHeight: 18, paddingHorizontal: 12 },
});
