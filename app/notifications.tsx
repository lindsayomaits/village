import { useState, useCallback } from 'react';
import {
  View, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { Text } from '../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import type { AppNotification } from '../types';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function NotificationsScreen() {
  const { family } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!family) { setLoading(false); return; }
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('family_id', family.id)
      .order('created_at', { ascending: false })
      .limit(100);
    setItems(data ?? []);
    setLoading(false);
  }, [family?.id]);

  // Opening the screen marks everything read — matches how the bell badge
  // behaves (it's a "you've seen these" marker, not a per-item inbox).
  useFocusEffect(useCallback(() => {
    load().then(() => {
      if (family) supabase.rpc('mark_all_notifications_read').then(() => {});
    });
  }, [family?.id, load]));

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function clearAll() {
    if (!family) return;
    await supabase.from('notifications').delete().eq('family_id', family.id);
    setItems([]);
  }

  const renderItem = ({ item }: { item: AppNotification }) => (
    <TouchableOpacity
      style={[styles.row, !item.read_at && styles.rowUnread]}
      onPress={() => { if (item.path) router.push(item.path as never); }}
      disabled={!item.path}
      activeOpacity={item.path ? 0.7 : 1}
    >
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>{item.title}</Text>
        <Text style={styles.rowText}>{item.body}</Text>
        <Text style={styles.rowTime}>{timeAgo(item.created_at)}</Text>
      </View>
      {item.path ? <Text style={styles.chevron}>›</Text> : null}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Notifications</Text>
        {items.length > 0 ? (
          <TouchableOpacity onPress={clearAll}>
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
        ) : <View style={{ width: 44 }} />}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🔔</Text>
              <Text style={styles.emptyText}>Nothing yet</Text>
              <Text style={styles.emptySub}>Offers, approvals, messages, and reminders show up here.</Text>
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
  clearText: { fontSize: 14, color: colors.textMuted, fontWeight: '700' },
  list: { paddingHorizontal: 20, paddingBottom: 32, flexGrow: 1 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.card, borderRadius: 14, padding: 14, marginBottom: 8,
    borderWidth: 1.5, borderColor: colors.borderLight,
  },
  rowUnread: { borderColor: colors.primary + '55', backgroundColor: colors.primaryLight + '55' },
  rowBody: { flex: 1, gap: 3 },
  rowTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  rowText: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  rowTime: { fontSize: 11, color: colors.textMuted, fontWeight: '600', marginTop: 2 },
  chevron: { fontSize: 22, color: colors.textMuted },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  emptyIcon: { fontSize: 44, marginBottom: 12 },
  emptyText: { fontSize: 17, fontWeight: '800', color: colors.text, marginBottom: 6 },
  emptySub: { fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 19 },
});
