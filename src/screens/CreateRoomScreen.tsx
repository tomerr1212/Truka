import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useGameStore } from '../store/gameStore';
import { createRoom } from '../services/matchService';
import { COLORS } from '../constants/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'CreateRoom'>;

const PLAYER_OPTIONS = [3, 4, 5, 6];

export default function CreateRoomScreen({ navigation }: Props) {
  const store = useGameStore();
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!store.localPlayerId) return;
    setLoading(true);
    try {
      const room = await createRoom(store.localPlayerId, store.localDisplayName, maxPlayers);
      store.setRoomCode(room.code);
      navigation.replace('Lobby', { roomCode: room.code });
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>CREATE ROOM</Text>

      <View style={styles.section}>
        <Text style={styles.label}>NUMBER OF PLAYERS</Text>
        <View style={styles.options}>
          {PLAYER_OPTIONS.map((n) => (
            <TouchableOpacity
              key={n}
              style={[styles.option, maxPlayers === n && styles.optionActive]}
              onPress={() => setMaxPlayers(n)}
            >
              <Text style={[styles.optionText, maxPlayers === n && styles.optionTextActive]}>
                {n}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <TouchableOpacity
        style={[styles.createButton, loading && styles.createButtonDisabled]}
        onPress={handleCreate}
        disabled={loading}
      >
        <Text style={styles.createButtonText}>
          {loading ? 'CREATING…' : 'CREATE ROOM'}
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: COLORS.bg, padding: 24, justifyContent: 'space-between' },
  title:      { fontSize: 13, fontWeight: '700', color: COLORS.muted, letterSpacing: 3, textAlign: 'center', marginBottom: 40 },
  section:    { flex: 1 },
  label:      { fontSize: 11, fontWeight: '700', color: COLORS.muted, letterSpacing: 1.5, marginBottom: 16 },
  options:    { flexDirection: 'row', gap: 12 },
  option:     { flex: 1, backgroundColor: COLORS.card, borderRadius: 14, paddingVertical: 24, alignItems: 'center', borderWidth: 2, borderColor: COLORS.border },
  optionActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
  optionText:   { fontSize: 28, fontWeight: '800', color: COLORS.muted },
  optionTextActive: { color: COLORS.primary },
  createButton:         { backgroundColor: COLORS.primary, borderRadius: 16, paddingVertical: 18, alignItems: 'center' },
  createButtonDisabled: { backgroundColor: COLORS.muted },
  createButtonText:     { color: '#fff', fontWeight: '800', fontSize: 16, letterSpacing: 1 },
});
