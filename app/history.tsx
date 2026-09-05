import { useState, useCallback } from 'react';
import {
  View, StyleSheet, FlatList,
  RefreshControl, ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { Text } from '../components/Text';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import type { Transaction } from '../types';

export default function HistoryScreen() {
  const { family } = useAuth();
  const router = useRouter();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function loadHistory() {
    if (!family) return;
    const { data } = await supabase
      .from('transactions')
      .select('*, from_family:families_public!from_family_id(name), to_family:families_public!to_family_id(name)')
      .or(`from_family_id.eq.${family.id},to_family_id.eq.${family.id}`)
      .order('created_at', { ascending: false })
      .limit(50);
    setTransactions(data ?? []);
    setLoading(false);
  }

  useFocusEffect(useCallback(() => { loadHistory(); }, [family?.id]));

  async function onRefresh() {
    setRefreshing(true);
    await loadHistory();
    setRefreshing(false);
  }

  function formatDateTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  const renderItem = ({ item }: { item: Transaction }) => {
    const isEarned = item.to_family_id === family?.id;
    const otherName = isEarned ? item.from_family?.name : item.to_family?.name;
    const isAdmin = item.from_family_id === null;
    const isGift = !isAdmin && item.request_id === null;

    // Direction (arrow + color) always tracks the hour flow itself, even
    // for gifts and admin adjustments — an emoji rides alongside it only to
    // call out the special cases, it never replaces the arrow.
    let emoji: string | null = null;
    let bgColor = isEarned ? colors.greenLight : colors.redLight;
    let title = '';

    if (isAdmin) {
      emoji = '⚙️';
      bgColor = colors.borderLight;
      title = item.note ?? 'Admin adjustment';
    } else if (isGift && isEarned) {
      emoji = '🎁';
      bgColor = colors.sageLight;
      title = `Gift from ${otherName}`;
    } else if (isGift && !isEarned) {
      emoji = '🎁';
      bgColor = colors.primaryLight;
      title = `Gifted to ${otherName}`;
    } else if (isEarned) {
      title = `Earned from ${otherName}`;
    } else {
      title = `Used for ${otherName}`;
    }

    return (
      <View style={[styles.row, isGift && styles.rowGift]}>
        <View style={[styles.iconCircle, { backgroundColor: bgColor }]}>
          {emoji ? (
            <Text style={styles.rowIcon}>{emoji}</Text>
          ) : (
            <MaterialIcons name={isEarned ? 'call-received' : 'call-made'} size={20} color={isEarned ? colors.sageDark : colors.primaryDark} />
          )}
        </View>
        <View style={styles.rowInfo}>
          <Text style={styles.rowTitle}>{title}</Text>
          <Text style={styles.rowDate}>{formatDateTime(item.created_at)}</Text>
          {item.note && !isAdmin ? <Text style={styles.rowNote}>"{item.note}"</Text> : null}
        </View>
        <View style={styles.rowAmountGroup}>
          <MaterialIcons name={isEarned ? 'call-received' : 'call-made'} size={13} color={isEarned ? colors.sageDark : colors.primaryDark} />
          <Text style={[styles.rowAmount, { color: isEarned ? colors.sageDark : colors.primaryDark }]}>
            {isEarned ? '+' : '-'}{item.hours}h
          </Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Hour History</Text>
        <View style={{ width: 60 }} />
      </View>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={transactions}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📭</Text>
              <Text style={styles.emptyText}>No transactions yet</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, marginBottom: 12 },
  backBtn: { paddingVertical: 6, paddingRight: 12 },
  backBtnText: { fontSize: 17, color: colors.primary, fontWeight: '600' },
  title: { fontSize: 20, fontWeight: '800', color: colors.text },
  list: { paddingHorizontal: 20, paddingBottom: 32 },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
    borderRadius: 16, padding: 14, marginBottom: 8,
    borderWidth: 1.5, borderColor: colors.borderLight,
  },
  rowGift: { borderColor: colors.sage + '60' },
  iconCircle: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  rowIcon: { fontSize: 20 },
  rowInfo: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 2 },
  rowDate: { fontSize: 12, color: colors.textMuted },
  rowNote: { fontSize: 12, color: colors.textSecondary, fontStyle: 'italic', marginTop: 2 },
  rowAmountGroup: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 8 },
  rowAmount: { fontSize: 18, fontWeight: '800' },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, color: colors.textMuted, fontWeight: '500' },
});
