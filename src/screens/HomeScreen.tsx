import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useGameStore } from '../store/gameStore';
import { signInAnon } from '../services/firebase';
import { createRoom, joinRoom } from '../services/matchService';
import { COLORS, FONTS } from '../constants/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

// Alert.alert is broken on Expo web — use inline error messages instead
function showError(setError: (s: string) => void, msg: string) {
  setError(msg);
  setTimeout(() => setError(''), 4000);
}

export default function HomeScreen({ navigation }: Props) {
  const store = useGameStore();
  const [displayName, setDisplayName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    signInAnon()
      .then((uid) => {
        store.setLocalPlayer(uid, '');
        setAuthReady(true);
        console.log('[Auth] signed in as', uid);
      })
      .catch((e) => {
        console.error('[Auth] failed:', e);
        showError(setError, 'Firebase auth failed. Is Anonymous Auth enabled in the console?');
      });
  }, []);

  const handleCreateRoom = async () => {
    if (!displayName.trim()) { showError(setError, 'Enter your name first'); return; }
    if (!authReady || !store.localPlayerId) { showError(setError, 'Still signing in, try again'); return; }
    setLoading(true);
    setError('');
    try {
      store.setLocalPlayer(store.localPlayerId, displayName.trim());
      const room = await createRoom(store.localPlayerId, displayName.trim());
      store.setRoomCode(room.code);
      navigation.navigate('Lobby', { roomCode: room.code });
    } catch (e: any) {
      console.error('[createRoom]', e);
      showError(setError, e.message ?? 'Could not create room');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinRoom = async () => {
    if (!displayName.trim()) { showError(setError, 'Enter your name first'); return; }
    if (!joinCode.trim()) { showError(setError, 'Enter a room code'); return; }
    if (!authReady || !store.localPlayerId) { showError(setError, 'Still signing in, try again'); return; }
    setLoading(true);
    setError('');
    try {
      store.setLocalPlayer(store.localPlayerId, displayName.trim());
      console.log('[joinRoom] joining', joinCode.toUpperCase(), 'as', store.localPlayerId);
      await joinRoom(joinCode.toUpperCase(), store.localPlayerId, displayName.trim());
      store.setRoomCode(joinCode.toUpperCase());
      navigation.navigate('Lobby', { roomCode: joinCode.toUpperCase() });
    } catch (e: any) {
      console.error('[joinRoom]', e);
      showError(setError, e.message ?? 'Could not join room');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Arena floor gradient */}
      <LinearGradient
        colors={['#F5EDD8', '#EDE0C4', '#E8D8B8']}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* Hero accent orb — warm glow behind title */}
      <View style={styles.heroOrb} pointerEvents="none" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.inner}
      >
        <View style={styles.hero}>
          <Text style={styles.title}>טרוקה</Text>
          <View style={styles.subtitleRow}>
            <View style={styles.titleAccentLine} />
            <Text style={styles.subtitle}>TROCA</Text>
            <View style={styles.titleAccentLine} />
          </View>
          <Text style={styles.tagline}>משחק קלפים של קפוארה</Text>
          {!authReady && <Text style={styles.authWaiting}>Connecting…</Text>}
        </View>

        <View style={styles.form}>
          {!!error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Text style={styles.label}>YOUR NAME</Text>
          <TextInput
            style={styles.input}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Enter your name"
            placeholderTextColor={COLORS.muted}
            maxLength={20}
          />

          <TouchableOpacity
            style={[styles.primaryButton, (loading || !authReady) && styles.buttonDisabled]}
            onPress={handleCreateRoom}
            disabled={loading || !authReady}
          >
            <Text style={styles.primaryButtonText}>
              {loading ? 'LOADING…' : 'CREATE ROOM'}
            </Text>
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <View style={styles.dividerStamp}>
              <Text style={styles.dividerText}>OR JOIN</Text>
            </View>
            <View style={styles.dividerLine} />
          </View>

          <TextInput
            style={[styles.input, styles.codeInput]}
            value={joinCode}
            onChangeText={(t) => setJoinCode(t.toUpperCase())}
            placeholder="ROOM CODE"
            placeholderTextColor={COLORS.muted}
            maxLength={6}
            autoCapitalize="characters"
          />

          <TouchableOpacity
            style={[styles.secondaryButton, (loading || !authReady) && styles.buttonDisabled]}
            onPress={handleJoinRoom}
            disabled={loading || !authReady}
          >
            <Text style={styles.secondaryButtonText}>
              {loading ? 'JOINING…' : 'JOIN ROOM'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <TouchableOpacity onPress={() => navigation.navigate('CardGallery')}>
            <Text style={styles.footerLink}>CARD GALLERY</Text>
          </TouchableOpacity>
          <Text style={styles.footerSep}>·</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Tutorial')}>
            <Text style={styles.footerLink}>HOW TO PLAY</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: COLORS.bg },
  inner:       { flex: 1, justifyContent: 'space-between', padding: 24 },

  // Hero orb glow behind title
  heroOrb: { position: 'absolute', top: -60, left: '50%', marginLeft: -130, width: 260, height: 260, borderRadius: 130, backgroundColor: 'rgba(232,115,42,0.10)' },

  hero:        { alignItems: 'center', paddingTop: 40 },
  title:       { fontFamily: FONTS.display, fontSize: 86, color: COLORS.primary, lineHeight: 82 },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  titleAccentLine: { flex: 1, height: 2, backgroundColor: COLORS.border, maxWidth: 32 },
  subtitle:    { fontFamily: FONTS.display, fontSize: 24, color: COLORS.leather, letterSpacing: 10 },
  tagline:     { fontFamily: FONTS.bodySemiBold, fontSize: 13, color: COLORS.muted, marginTop: 10 },
  authWaiting: { fontFamily: FONTS.bodyRegular, fontSize: 12, color: COLORS.muted, marginTop: 8 },

  form:      { gap: 12 },
  label:     { fontFamily: FONTS.bodyExtraBold, fontSize: 11, color: COLORS.muted, letterSpacing: 1.5 },
  input:     { fontFamily: FONTS.bodyRegular, backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.border, paddingVertical: 14, paddingHorizontal: 16, fontSize: 16, color: COLORS.text },
  codeInput: { fontFamily: FONTS.display, textAlign: 'center', letterSpacing: 6, fontSize: 24 },

  errorBox:  { backgroundColor: '#FDE8E8', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#F5C6C6' },
  errorText: { fontFamily: FONTS.bodySemiBold, color: '#C0392B', fontSize: 13, textAlign: 'center' },

  primaryButton:     { backgroundColor: COLORS.primary, borderRadius: 16, paddingVertical: 16, alignItems: 'center', borderBottomWidth: 3, borderBottomColor: COLORS.ember },
  primaryButtonText: { color: '#fff', fontFamily: FONTS.bodyExtraBold, fontSize: 16, letterSpacing: 1 },
  secondaryButton:     { backgroundColor: 'transparent', borderRadius: 16, paddingVertical: 14, alignItems: 'center', borderWidth: 2, borderColor: COLORS.primary },
  secondaryButtonText: { color: COLORS.primary, fontFamily: FONTS.bodyExtraBold, fontSize: 16, letterSpacing: 1 },
  buttonDisabled:      { opacity: 0.45 },

  divider:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dividerLine:  { flex: 1, height: 1, backgroundColor: COLORS.border },
  dividerStamp: { backgroundColor: COLORS.leather, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  dividerText:  { fontFamily: FONTS.bodyExtraBold, color: 'rgba(250,245,236,0.75)', fontSize: 10, letterSpacing: 2 },

  footer:     { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12, paddingBottom: 8 },
  footerLink: { fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.muted, letterSpacing: 1.5 },
  footerSep:  { color: COLORS.border },
});
