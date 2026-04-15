import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CARD_MAP } from '../store/gameStore';
import { Card, CardType } from '../types';
import { COLORS, FONTS } from '../constants/theme';

// Deduplicated card list (one entry per subtype)
const UNIQUE_CARDS: Card[] = Array.from(
  new Map(
    Array.from(CARD_MAP.values()).map((c) => [c.subtype, c])
  ).values()
);

const TYPE_LABELS: Record<CardType, string> = {
  action:  'ACTION',
  special: 'SPECIAL',
  floreo:  'FLOREO',
};

const TYPE_COLORS: Record<CardType, string> = {
  action:  COLORS.primary,
  special: COLORS.accent,
  floreo:  '#D4AC0D',
};

export default function CardGalleryScreen() {
  const [selected, setSelected] = useState<Card | null>(null);
  const [filter, setFilter] = useState<CardType | 'all'>('all');

  const filtered = filter === 'all' ? UNIQUE_CARDS : UNIQUE_CARDS.filter((c) => c.type === filter);

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>CARD GALLERY</Text>

      {/* Filter tabs */}
      <View style={styles.filters}>
        {(['all', 'action', 'special', 'floreo'] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterTab, filter === f && styles.filterTabActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {f === 'all' ? 'ALL' : TYPE_LABELS[f] ?? f.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(c) => c.subtype}
        numColumns={2}
        contentContainerStyle={styles.grid}
        columnWrapperStyle={styles.row}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => setSelected(item)}
          >
            <View style={[styles.cardTypeBadge, { backgroundColor: TYPE_COLORS[item.type] }]}>
              <Text style={styles.cardTypeBadgeText}>{TYPE_LABELS[item.type]}</Text>
            </View>
            <Text style={styles.cardNameHe}>{item.nameHe}</Text>
            <Text style={styles.cardNamePt}>{item.namePt}</Text>
          </TouchableOpacity>
        )}
      />

      {/* Card detail modal */}
      <Modal
        visible={!!selected}
        transparent
        animationType="slide"
        onRequestClose={() => setSelected(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {selected && (
              <ScrollView>
                <View style={[styles.modalTypeBadge, { backgroundColor: TYPE_COLORS[selected.type] }]}>
                  <Text style={styles.modalTypeBadgeText}>{TYPE_LABELS[selected.type]}</Text>
                </View>
                <Text style={styles.modalNameHe}>{selected.nameHe}</Text>
                <Text style={styles.modalNamePt}>{selected.namePt}</Text>
                <View style={styles.modalDivider} />
                <Text style={styles.modalDesc}>{selected.descriptionHe}</Text>
              </ScrollView>
            )}
            <TouchableOpacity style={styles.modalClose} onPress={() => setSelected(null)}>
              <Text style={styles.modalCloseText}>CLOSE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  title:     { fontFamily: FONTS.display, fontSize: 22, color: COLORS.text, letterSpacing: 3, textAlign: 'center', marginTop: 16, marginBottom: 12 },

  filters:         { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 12 },
  filterTab:       { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: COLORS.card, alignItems: 'center', borderWidth: 1.5, borderColor: COLORS.border },
  filterTabActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterText:      { fontFamily: FONTS.bodyExtraBold, fontSize: 10, color: COLORS.muted, letterSpacing: 1 },
  filterTextActive: { color: '#fff' },

  grid: { paddingHorizontal: 12, paddingBottom: 32 },
  row:  { gap: 12, marginBottom: 12 },
  card: { flex: 1, backgroundColor: COLORS.card, borderRadius: 14, padding: 16, borderWidth: 1.5, borderColor: COLORS.border, minHeight: 110 },
  cardTypeBadge:     { alignSelf: 'flex-start', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, marginBottom: 8 },
  cardTypeBadgeText: { fontFamily: FONTS.bodyExtraBold, fontSize: 9, color: '#fff', letterSpacing: 1 },
  cardNameHe: { fontFamily: FONTS.bodyBold, fontSize: 18, color: COLORS.text },
  cardNamePt: { fontFamily: FONTS.bodySemiBold, fontSize: 11, color: COLORS.muted, marginTop: 2 },

  modalOverlay:  { flex: 1, backgroundColor: 'rgba(44,26,14,0.68)', justifyContent: 'flex-end' },
  modalContent:  { backgroundColor: COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '70%', borderTopWidth: 2, borderColor: COLORS.border },
  modalTypeBadge:     { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 12 },
  modalTypeBadgeText: { fontFamily: FONTS.bodyExtraBold, fontSize: 10, color: '#fff', letterSpacing: 1.5 },
  modalNameHe:   { fontFamily: FONTS.display, fontSize: 38, color: COLORS.text },
  modalNamePt:   { fontFamily: FONTS.bodySemiBold, fontSize: 16, color: COLORS.muted, marginTop: 4 },
  modalDivider:  { height: 1, backgroundColor: COLORS.border, marginVertical: 16 },
  modalDesc:     { fontFamily: FONTS.bodyRegular, fontSize: 15, color: COLORS.text, lineHeight: 24 },
  modalClose:    { marginTop: 20, backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderBottomWidth: 3, borderBottomColor: COLORS.ember },
  modalCloseText: { fontFamily: FONTS.bodyExtraBold, color: '#fff', fontSize: 14, letterSpacing: 1 },
});
