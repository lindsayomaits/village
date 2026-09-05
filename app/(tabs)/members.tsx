import { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator, Modal, ScrollView, Alert, TextInput, Switch,
} from 'react-native';
import { Text } from '../../components/Text';
import { Avatar } from '../../components/Avatar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors } from '../../lib/theme';
import { getFamilyAnimal } from '../../lib/animals';
import { formatPhone, renderKidsInfo, displayKidsData, displayPetsData } from '../../lib/utils';
import { notifyFamily, notifyAdmins } from '../../lib/notifications';
import { PersonProfileModal } from '../../components/PersonProfileModal';
import type { Family, Connection } from '../../types';

const GIFT_HOUR_OPTIONS = [0.5, 1, 2, 3, 4, 5, 8, 10];

type Tab = 'my_network' | 'find_people' | 'pending';

const CATEGORY_LABELS: Record<string, { emoji: string; label: string }> = {
  kid_sit:           { emoji: '👧', label: 'Kids' },
  dog:               { emoji: '🐾', label: 'Pets' },
  manual_labor:      { emoji: '🔨', label: 'Labor' },
  professional:      { emoji: '🎓', label: 'Pro help' },
  cooking:           { emoji: '🍳', label: 'Cooking' },
  elder_care:        { emoji: '🤝', label: 'Elder care' },
  physical_training: { emoji: '🏃', label: 'Fitness' },
  errands:           { emoji: '🛒', label: 'Errands' },
};

export default function MembersScreen() {
  const { family: myHousehold } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();

  const [tab, setTab] = useState<Tab>('my_network');
  const [allHouseholds, setAllHouseholds] = useState<Family[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loadSeq = useRef(0);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Family | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [connectCode, setConnectCode] = useState('');
  const [connectingByCode, setConnectingByCode] = useState(false);
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());

  async function loadData() {
    // loadData fires from many places (focus, refresh, and after every
    // connect/accept/decline/block action) with no guarantee earlier
    // calls resolve first. Without this, a slow call triggered first
    // could land after a fast one triggered later and stomp its result —
    // the "connections/search results disappear and reappear" bug.
    // Only the most recently *issued* call is allowed to commit state.
    const seq = ++loadSeq.current;

    // families_public always lists every household (name/animal only) so
    // browsing/discovery works network-wide; families only returns full
    // rows (parent/phone/kids info) for self, admin, or connected
    // households — merge, preferring the richer row where RLS allows it.
    const [fullRes, publicRes, connectionsRes, blocksRes] = await Promise.all([
      supabase.from('families').select('*'),
      supabase.from('families_public').select('*'),
      supabase.from('connections').select('*').or(`requester_id.eq.${myHousehold?.id},recipient_id.eq.${myHousehold?.id}`),
      supabase.from('blocks').select('blocked_id').eq('blocker_id', myHousehold?.id ?? ''),
    ]);

    if (seq !== loadSeq.current) return;

    const fullById = new Map((fullRes.data ?? []).map((f: Family) => [f.id, f]));
    const merged = (publicRes.data ?? []).map((p: Family) => fullById.get(p.id) ?? p);
    setAllHouseholds(merged as Family[]);
    setConnections((connectionsRes.data ?? []) as Connection[]);
    setBlockedIds(new Set((blocksRes.data ?? []).map((b: { blocked_id: string }) => b.blocked_id)));
    setLoading(false);
  }

  useEffect(() => {
    if (params.tab === 'my_network' || params.tab === 'find_people' || params.tab === 'pending') {
      setTab(params.tab);
    }
  }, [params.tab]);

  useFocusEffect(useCallback(() => { loadData(); }, []));

  async function onRefresh() {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }

  function getConnectionStatus(householdId: string): 'none' | 'pending_sent' | 'pending_received' | 'connected' {
    const conn = connections.find(
      c => c.requester_id === householdId || c.recipient_id === householdId
    );
    if (!conn) return 'none';
    if (conn.status === 'accepted') return 'connected';
    if (conn.status === 'pending') {
      return conn.requester_id === myHousehold?.id ? 'pending_sent' : 'pending_received';
    }
    return 'none';
  }

  function getConnection(householdId: string): Connection | undefined {
    return connections.find(
      c => c.requester_id === householdId || c.recipient_id === householdId
    );
  }

  async function submitConnectCode() {
    if (!connectCode.trim()) return;
    setConnectingByCode(true);
    const { data, error } = await supabase.rpc('connect_by_code', { p_code: connectCode.trim() });
    setConnectingByCode(false);
    if (error) return Alert.alert('Error', error.message);
    setConnectCode('');
    await loadData();
    const name = data?.[0]?.name ?? 'Household';
    Alert.alert('Connected! 🎉', `You're now connected with ${name}.`);
    setTab('my_network');
  }

  async function acceptConnection(conn: Connection) {
    setActionLoading(true);
    const { error } = await supabase.from('connections').update({ status: 'accepted' }).eq('id', conn.id);
    setActionLoading(false);
    if (error) return Alert.alert('Error', error.message);
    await loadData();
    setSelected(null);
    if (myHousehold) {
      notifyFamily(conn.requester_id, '🎉 Connection accepted', `${myHousehold.name} accepted your connection request`, { path: '/(tabs)/members?tab=my_network' }).catch(() => {});
    }
  }

  async function declineConnection(conn: Connection) {
    setActionLoading(true);
    await supabase.from('connections').delete().eq('id', conn.id);
    setActionLoading(false);
    await loadData();
    setSelected(null);
  }

  const connectedIds = connections
    .filter(c => c.status === 'accepted')
    .map(c => c.requester_id === myHousehold?.id ? c.recipient_id : c.requester_id);

  const pendingReceived = connections.filter(
    c => c.status === 'pending' && c.recipient_id === myHousehold?.id
  );

  const networkHouseholds = allHouseholds.filter(
    h => h.id !== myHousehold?.id && connectedIds.includes(h.id)
  );

  const searchLower = search.trim().toLowerCase();
  const discoverHouseholds = (searchLower.length < 2 && !categoryFilter) ? [] : allHouseholds.filter(h => {
    if (h.id === myHousehold?.id) return false;
    if (connectedIds.includes(h.id)) return false;
    if (h.discoverable === false) return false;
    if (blockedIds.has(h.id)) return false;
    if (searchLower.length >= 2 && !h.name.toLowerCase().includes(searchLower)) return false;
    if (categoryFilter && !(h.services_offered ?? []).includes(categoryFilter)) return false;
    return true;
  });

  const pendingHouseholds = pendingReceived.map(conn => {
    const h = allHouseholds.find(f => f.id === conn.requester_id);
    return h ? { household: h, conn } : null;
  }).filter(Boolean) as { household: Family; conn: Connection }[];

  function renderHouseholdCard({ item }: { item: Family }) {
    const status = getConnectionStatus(item.id);
    const kidsLine = displayKidsData(item.kids_data ?? []);
    const subtitle = [item.parent1_name, kidsLine].filter(Boolean).join(' · ');
    return (
      <TouchableOpacity
        style={[styles.card, item.id === myHousehold?.id && styles.cardSelf]}
        onPress={() => setSelected(item)}
      >
        <Avatar familyId={item.id} animal={item.animal} photoUrl={item.photo_url} size={48} style={styles.cardAvatarSquare} />
        <View style={styles.cardInfo}>
          <Text style={styles.cardName}>{item.name}</Text>
          {subtitle ? <Text style={styles.cardParents}>{subtitle}</Text> : null}
          {item.services_offered && item.services_offered.length > 0 && (
            <View style={styles.cardChipsRow}>
              {item.services_offered.map(key => {
                const c = CATEGORY_LABELS[key];
                if (!c) return null;
                return (
                  <View key={key} style={styles.cardChip}>
                    <Text style={styles.cardChipText}>{c.emoji} {c.label}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>
        {status === 'connected' && <Text style={styles.chevron}>›</Text>}
        {status === 'pending_sent' && (
          <View style={styles.pendingBadge}><Text style={styles.pendingBadgeText}>Pending</Text></View>
        )}
        {status === 'pending_received' && (
          <View style={styles.incomingBadge}><Text style={styles.incomingBadgeText}>Respond</Text></View>
        )}
        {status === 'none' && <Text style={styles.chevron}>›</Text>}
      </TouchableOpacity>
    );
  }

  function renderPendingCard({ item }: { item: { household: Family; conn: Connection } }) {
    return (
      <View style={styles.pendingCard}>
        <View style={styles.pendingCardRow}>
          <View style={styles.cardAvatarWrap}><Avatar familyId={item.household.id} animal={item.household.animal} photoUrl={item.household.photo_url} size={44} /></View>
          <View style={styles.cardInfo}>
            <Text style={styles.cardName}>{item.household.name}</Text>
            <Text style={styles.pendingWantsText}>Wants to connect with you</Text>
          </View>
        </View>
        <View style={styles.pendingActions}>
          <TouchableOpacity
            style={styles.acceptBtn}
            onPress={() => acceptConnection(item.conn)}
            disabled={actionLoading}
          >
            <Text style={styles.acceptBtnText}>Accept</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.declineBtn}
            onPress={() => declineConnection(item.conn)}
            disabled={actionLoading}
          >
            <Text style={styles.declineBtnText}>Decline</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Your village</Text>
          <Text style={styles.subtitle}>
            {networkHouseholds.length} {networkHouseholds.length === 1 ? 'person' : 'people'} in your network
          </Text>
        </View>
        <TouchableOpacity style={styles.messagesBtn} onPress={() => router.push('/chats')}>
          <Text style={styles.messagesBtnText}>💬 Messages</Text>
        </TouchableOpacity>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'my_network' && styles.tabBtnActive]}
          onPress={() => setTab('my_network')}
        >
          <Text style={[styles.tabText, tab === 'my_network' && styles.tabTextActive]}>My network</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'find_people' && styles.tabBtnActive]}
          onPress={() => setTab('find_people')}
        >
          <Text style={[styles.tabText, tab === 'find_people' && styles.tabTextActive]}>Find people</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'pending' && styles.tabBtnActive]}
          onPress={() => setTab('pending')}
        >
          <Text style={[styles.tabText, tab === 'pending' && styles.tabTextActive]}>
            Invites{pendingHouseholds.length > 0 ? ` (${pendingHouseholds.length})` : ''}
          </Text>
          {pendingHouseholds.length > 0 && <View style={styles.tabDot} />}
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <>
          {tab === 'find_people' && (
            <>
              <View style={styles.codeRow}>
                <TextInput
                  style={styles.codeInput}
                  placeholder="Enter a connect code"
                  placeholderTextColor={colors.textMuted}
                  value={connectCode}
                  onChangeText={t => setConnectCode(t.toUpperCase())}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={6}
                />
                <TouchableOpacity
                  style={[styles.codeBtn, !connectCode.trim() && styles.codeBtnDisabled]}
                  onPress={submitConnectCode}
                  disabled={!connectCode.trim() || connectingByCode}
                >
                  {connectingByCode
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.codeBtnText}>Connect</Text>}
                </TouchableOpacity>
              </View>
              <Text style={styles.orDivider}>or search by name</Text>
              <View style={styles.searchRow}>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search by name..."
                  placeholderTextColor={colors.textMuted}
                  value={search}
                  onChangeText={setSearch}
                  clearButtonMode="while-editing"
                />
              </View>
              <Text style={styles.orDivider}>or browse who's open to help with</Text>
              <View style={styles.categoryFilterRow}>
                {Object.entries(CATEGORY_LABELS).map(([key, { emoji, label }]) => (
                  <TouchableOpacity
                    key={key}
                    style={[styles.categoryChip, categoryFilter === key && styles.categoryChipActive]}
                    onPress={() => setCategoryFilter(prev => prev === key ? null : key)}
                  >
                    <Text style={[styles.categoryChipText, categoryFilter === key && styles.categoryChipTextActive]}>{emoji} {label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {tab === 'my_network' && (
            networkHouseholds.length === 0 && pendingHouseholds.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyEmoji}>🤝</Text>
                <Text style={styles.emptyTitle}>No connections yet</Text>
                <Text style={styles.emptyText}>Go to "Find People" to connect with people you know and trust.</Text>
              </View>
            ) : (
              <FlatList
                data={networkHouseholds}
                keyExtractor={(item) => item.id}
                renderItem={renderHouseholdCard}
                contentContainerStyle={styles.list}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
                ListHeaderComponent={
                  <>
                    {pendingHouseholds.length > 0 && (
                      <View style={styles.pendingSection}>
                        <Text style={styles.pendingSectionLabel}>
                          {pendingHouseholds.length} CONNECTION REQUEST{pendingHouseholds.length > 1 ? 'S' : ''}
                        </Text>
                        {pendingHouseholds.map(p => <View key={p.conn.id}>{renderPendingCard({ item: p })}</View>)}
                      </View>
                    )}
                    <View style={styles.connectedHeaderRow}>
                      <Text style={styles.connectedHeaderTitle}>Connected</Text>
                      <Text style={styles.connectedHeaderCount}>
                        {networkHouseholds.length} HOUSEHOLD{networkHouseholds.length === 1 ? '' : 'S'}
                      </Text>
                    </View>
                    {networkHouseholds.length > 0 && (
                      <Text style={styles.messageHint}>Tap anyone below to message them or see their profile.</Text>
                    )}
                  </>
                }
              />
            )
          )}

          {tab === 'find_people' && (
            discoverHouseholds.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyEmoji}>🔍</Text>
                <Text style={styles.emptyTitle}>{searchLower.length >= 2 || categoryFilter ? 'No results' : 'Know someone already?'}</Text>
                <Text style={styles.emptyText}>
                  {searchLower.length >= 2 || categoryFilter
                    ? 'Try a different name or category.'
                    : 'Ask for their connect code above, search by name, or browse by what people are open to helping with.'}
                </Text>
              </View>
            ) : (
              <FlatList
                data={discoverHouseholds}
                keyExtractor={(item) => item.id}
                renderItem={renderHouseholdCard}
                contentContainerStyle={styles.list}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
              />
            )
          )}

          {tab === 'pending' && (
            pendingHouseholds.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyEmoji}>📬</Text>
                <Text style={styles.emptyTitle}>No pending requests</Text>
                <Text style={styles.emptyText}>Connection requests from other people will appear here.</Text>
              </View>
            ) : (
              <FlatList
                data={pendingHouseholds}
                keyExtractor={(item) => item.conn.id}
                renderItem={renderPendingCard}
                contentContainerStyle={styles.list}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
              />
            )
          )}
        </>
      )}

      <PersonProfileModal family={selected} onClose={() => setSelected(null)} onChanged={loadData} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 20, paddingTop: 16, marginBottom: 4 },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, marginBottom: 2 },
  subtitle: { fontSize: 13, color: colors.textMuted, fontWeight: '500', marginBottom: 4 },
  messagesBtn: { backgroundColor: colors.card, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1.5, borderColor: colors.borderLight },
  messagesBtnText: { fontSize: 13, fontWeight: '700', color: colors.text },
  messageHint: { fontSize: 12, color: colors.textMuted, fontWeight: '500', marginBottom: 10, fontStyle: 'italic' },

  tabBar: {
    flexDirection: 'row', marginHorizontal: 20, marginBottom: 8,
    backgroundColor: colors.card, borderRadius: 14,
    borderWidth: 1.5, borderColor: colors.border, padding: 4,
  },
  tabBtn: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', position: 'relative' },
  tabBtnActive: { backgroundColor: colors.primary },
  tabText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  tabTextActive: { color: '#fff', fontWeight: '700' },
  tabDot: {
    position: 'absolute', top: 4, right: 8,
    width: 7, height: 7, borderRadius: 4, backgroundColor: colors.red,
  },

  codeRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginTop: 8, marginBottom: 4 },
  codeInput: {
    flex: 1, backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 15, color: colors.text, letterSpacing: 2, fontWeight: '700',
  },
  codeBtn: {
    backgroundColor: colors.primary, borderRadius: 14, paddingHorizontal: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  codeBtnDisabled: { opacity: 0.5 },
  codeBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  orDivider: {
    textAlign: 'center', fontSize: 12, color: colors.textMuted, fontWeight: '600',
    marginTop: 10, marginBottom: 4,
  },

  searchRow: { paddingHorizontal: 20, marginBottom: 8 },
  searchInput: {
    backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 15, color: colors.text,
  },

  list: { paddingHorizontal: 20, paddingBottom: 32 },

  card: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: colors.card, borderRadius: 18, padding: 14, marginBottom: 10,
    borderWidth: 1.5, borderColor: colors.borderLight,
  },
  cardSelf: { borderColor: colors.sage },
  cardAnimal: { fontSize: 32, marginRight: 12 },
  cardAvatarWrap: { marginRight: 12 },
  cardAvatarSquare: { borderRadius: 14, backgroundColor: colors.sageLight, marginRight: 12 },
  cardInfo: { flex: 1, gap: 3 },
  cardName: { fontSize: 16, fontWeight: '700', color: colors.text },
  cardParents: { fontSize: 13, color: colors.textSecondary },
  cardChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 3 },
  cardChip: { backgroundColor: colors.background, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: colors.borderLight },
  cardChipText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  chevron: { fontSize: 22, color: colors.textMuted, marginLeft: 8 },

  pendingBadge: { backgroundColor: colors.amberLight, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: colors.amber },
  pendingBadgeText: { fontSize: 12, color: colors.amber, fontWeight: '700' },
  incomingBadge: { backgroundColor: colors.primaryLight, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: colors.primary },
  incomingBadgeText: { fontSize: 12, color: colors.primaryDark, fontWeight: '700' },

  pendingSection: { marginBottom: 18 },
  pendingSectionLabel: { fontSize: 12, fontWeight: '700', color: colors.primaryDark, letterSpacing: 0.6, marginBottom: 10 },
  connectedHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 },
  connectedHeaderTitle: { fontSize: 19, fontWeight: '800', color: colors.text },
  connectedHeaderCount: { fontSize: 12, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.4 },
  pendingCard: {
    backgroundColor: colors.primaryLight, borderRadius: 18, padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: colors.primary + '30', gap: 14,
  },
  pendingCardRow: { flexDirection: 'row', alignItems: 'center' },
  pendingWantsText: { fontSize: 13, color: colors.primaryDark, fontWeight: '600', marginTop: 2 },
  pendingActions: { flexDirection: 'row', gap: 10 },
  acceptBtn: { flex: 2, backgroundColor: colors.sageDark, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  acceptBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  declineBtn: { flex: 1, backgroundColor: colors.card, borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1.5, borderColor: colors.borderLight },
  declineBtnText: { color: colors.primaryDark, fontWeight: '700', fontSize: 15 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  emptyEmoji: { fontSize: 52, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 8, textAlign: 'center' },
  emptyText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },

  categoryFilterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  categoryChip: {
    backgroundColor: colors.card, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7,
    borderWidth: 1.5, borderColor: colors.borderLight,
  },
  categoryChipActive: { backgroundColor: colors.sageLight, borderColor: colors.sage },
  categoryChipText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  categoryChipTextActive: { color: colors.sageDark },

});
