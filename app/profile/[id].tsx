import { useState, useCallback } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { Text } from '../../components/Text';
import { Avatar } from '../../components/Avatar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { colors } from '../../lib/theme';
import { formatPhone, displayKidsData, displayPetsData, renderKidsInfo } from '../../lib/utils';
import type { Family, RequestCategory, Vouch } from '../../types';

const CATEGORY_LABELS: Record<RequestCategory, { emoji: string; label: string }> = {
  kid_sit:           { emoji: '👧', label: 'Kid-sitting' },
  dog:               { emoji: '🐾', label: 'Pet care' },
  manual_labor:      { emoji: '🔨', label: 'Manual labor' },
  professional:      { emoji: '🎓', label: 'Professional help' },
  cooking:           { emoji: '🍳', label: 'Cooking' },
  elder_care:        { emoji: '🤝', label: 'Elder care' },
  physical_training: { emoji: '🏃', label: 'Fitness' },
  errands:           { emoji: '🛒', label: 'Errands' },
};

export default function ProfileViewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [person, setPerson] = useState<Family | null>(null);
  const [vouches, setVouches] = useState<Vouch[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    if (!id) return;
    setLoading(true);
    supabase.from('families').select('*').eq('id', id).single().then(({ data }) => {
      setPerson(data ?? null);
      setLoading(false);
    });
    supabase
      .from('vouches')
      .select('*, voucher:families!voucher_id(id, name, animal, photo_url)')
      .eq('vouched_id', id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setVouches((data ?? []) as Vouch[]));
  }, [id]));

  const phone = person?.parent1_phone ?? null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topRow}>
        <TouchableOpacity onPress={() => router.back()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.screenTitle}>Profile</Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      ) : !person ? (
        <Text style={styles.notFound}>This profile isn't available.</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.headerBlock}>
            <Avatar familyId={person.id} animal={person.animal} photoUrl={person.photo_url} size={80} />
            <Text style={styles.name}>{person.name}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Contact</Text>
            {person.parent1_name && <Text style={styles.line}>👤 {person.parent1_name}</Text>}
            {phone && (
              <TouchableOpacity onPress={() => Linking.openURL(`tel:${phone}`)}>
                <Text style={[styles.line, styles.linkLine]}>📞 {formatPhone(phone)}</Text>
              </TouchableOpacity>
            )}
            {person.email && (
              <TouchableOpacity onPress={() => Linking.openURL(`mailto:${person.email}`)}>
                <Text style={[styles.line, styles.linkLine]}>✉️ {person.email}</Text>
              </TouchableOpacity>
            )}
            {person.address && <Text style={styles.line}>🏠 {person.address}</Text>}
            {!person.parent1_name && !phone && !person.email && !person.address && (
              <Text style={styles.emptyHint}>No contact info shared yet.</Text>
            )}
          </View>

          {person.kids_data && person.kids_data.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Kids</Text>
              <Text style={styles.line}>{displayKidsData(person.kids_data)}</Text>
              {person.kids_data.filter(k => k.notes?.trim()).map((k, i) => (
                <Text key={i} style={styles.noteLine}>{k.name}: {renderKidsInfo(k.notes)}</Text>
              ))}
            </View>
          )}

          {person.pets_data && person.pets_data.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Pets</Text>
              <Text style={styles.line}>{displayPetsData(person.pets_data)}</Text>
              {person.pets_data.filter(p => p.notes?.trim()).map((p, i) => (
                <Text key={i} style={styles.noteLine}>{p.name}: {p.notes}</Text>
              ))}
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>
              Vouched for {vouches.length > 0 ? `· ${vouches.length}` : ''}
            </Text>
            {vouches.length === 0 ? (
              <Text style={styles.emptyHint}>No vouches yet.</Text>
            ) : (
              vouches.map(v => (
                <View key={v.id} style={styles.vouchRow}>
                  <Avatar familyId={v.voucher_id} animal={v.voucher?.animal} photoUrl={v.voucher?.photo_url} size={28} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.line}>{v.voucher?.name ?? 'Someone'}</Text>
                    {v.note ? <Text style={styles.noteLine}>"{v.note}"</Text> : null}
                  </View>
                </View>
              ))
            )}
          </View>

          {person.services_offered && person.services_offered.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Helps with</Text>
              <View style={styles.chipRow}>
                {person.services_offered
                  .filter((key): key is RequestCategory => !!CATEGORY_LABELS[key as RequestCategory])
                  .map(key => (
                    <View key={key} style={styles.chip}>
                      <Text style={styles.chipText}>{CATEGORY_LABELS[key as RequestCategory].emoji} {CATEGORY_LABELS[key as RequestCategory].label}</Text>
                    </View>
                  ))}
              </View>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  back: { fontSize: 16, color: colors.primary, fontWeight: '600', width: 60 },
  screenTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  scroll: { paddingHorizontal: 20, paddingBottom: 48 },
  notFound: { fontSize: 15, color: colors.textMuted, textAlign: 'center', marginTop: 60, paddingHorizontal: 30 },

  headerBlock: { alignItems: 'center', marginVertical: 20, gap: 10 },
  name: { fontSize: 22, fontWeight: '800', color: colors.text },

  section: {
    backgroundColor: colors.card, borderRadius: 16, padding: 16, marginBottom: 14,
    borderWidth: 1.5, borderColor: colors.borderLight,
  },
  sectionLabel: { fontSize: 12, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  line: { fontSize: 15, color: colors.text, fontWeight: '500', marginBottom: 4 },
  linkLine: { color: colors.primary, fontWeight: '700' },
  noteLine: { fontSize: 13, color: colors.textSecondary, fontStyle: 'italic', marginTop: 2 },
  emptyHint: { fontSize: 13, color: colors.textMuted },
  vouchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: colors.sageLight, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: colors.sage + '50' },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.sageDark },
});
