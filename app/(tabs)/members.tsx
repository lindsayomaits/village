import { useState, useCallback, useEffect } from 'react';
import {
  View, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator, Modal, ScrollView, Alert, TextInput, Switch,
} from 'react-native';
import { Text } from '../../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors } from '../../lib/theme';
import { getFamilyAnimal } from '../../lib/animals';
import { formatPhone, renderKidsInfo, displayKidsData } from '../../lib/utils';
import { notifyFamily, notifyAdmins } from '../../lib/notifications';
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
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Family | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [connectCode, setConnectCode] = useState('');
  const [connectingByCode, setConnectingByCode] = useState(false);
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  const [reportTarget, setReportTarget] = useState<Family | null>(null);
  const [reportReason, setReportReason] = useState<string | null>(null);
  const [reportNote, setReportNote] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);

  // Gift hours state
  const [giftTarget, setGiftTarget] = useState<Family | null>(null);
  const [giftHours, setGiftHours] = useState(1);
  const [giftNote, setGiftNote] = useState('');
  const [giftLoading, setGiftLoading] = useState(false);

  async function loadData() {
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
    const fullById = new Map((fullRes.data ?? []).map((f: Family) => [f.id, f]));
    const merged = (publicRes.data ?? []).map((p: Family) => fullById.get(p.id) ?? p);
    setAllHouseholds(merged as Family[]);
    setConnections((connectionsRes.data ?? []) as Connection[]);
    setBlockedIds(new Set((blocksRes.data ?? []).map((b: { blocked_id: string }) => b.blocked_id)));
    setLoading(false);
  }

  async function blockHousehold(target: Family) {
    Alert.alert(
      `Block ${target.name}?`,
      'They’ll be disconnected and won’t be able to message you, connect with you, or find you again. This can be undone later in Profile.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block', style: 'destructive',
          onPress: async () => {
            setActionLoading(true);
            const { error } = await supabase.rpc('block_household', { p_blocked_id: target.id });
            setActionLoading(false);
            if (error) return Alert.alert('Error', error.message);
            setSelected(null);
            await loadData();
          },
        },
      ]
    );
  }

  function openReportModal(target: Family) {
    setSelected(null);
    setReportReason(null);
    setReportNote('');
    setReportTarget(target);
  }

  async function submitReport() {
    if (!myHousehold || !reportTarget || !reportReason) return;
    setReportSubmitting(true);
    const { error } = await supabase.from('reports').insert({
      reporter_id: myHousehold.id,
      reported_id: reportTarget.id,
      reason: reportReason,
      note: reportNote.trim() || null,
    });
    setReportSubmitting(false);
    if (error) return Alert.alert('Error', error.message);
    notifyAdmins('🚩 New report', `${myHousehold.name} reported ${reportTarget.name} — ${reportReason}`).catch(() => {});
    setReportTarget(null);
    Alert.alert('Report submitted', 'Thanks for letting us know — an admin will review this.');
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

  async function sendConnectionRequest(household: Family) {
    if (!myHousehold) return;
    setActionLoading(true);
    const { error } = await supabase.from('connections').insert({
      requester_id: myHousehold.id,
      recipient_id: household.id,
      status: 'pending',
    });
    setActionLoading(false);
    if (error) {
      await loadData();
      if (error.code === '23505') {
        return Alert.alert('Already in progress', `You and ${household.name} already have a connection or pending request.`);
      }
      return Alert.alert('Error', error.message);
    }
    await loadData();
    notifyFamily(household.id, '🤝 New connection request', `${myHousehold.name} wants to connect with you`).catch(() => {});
    Alert.alert('Request sent!', `${household.name} will be notified.`);
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
    await supabase.from('connections').update({ status: 'accepted' }).eq('id', conn.id);
    setActionLoading(false);
    await loadData();
    setSelected(null);
    if (myHousehold) {
      notifyFamily(conn.requester_id, '🎉 Connection accepted', `${myHousehold.name} accepted your connection request`).catch(() => {});
    }
  }

  async function declineConnection(conn: Connection) {
    setActionLoading(true);
    await supabase.from('connections').delete().eq('id', conn.id);
    setActionLoading(false);
    await loadData();
    setSelected(null);
  }

  async function disconnectHousehold(householdId: string) {
    Alert.alert('Disconnect', 'Are you sure you want to remove this connection?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect', style: 'destructive',
        onPress: async () => {
          const conn = getConnection(householdId);
          if (!conn) return;
          setActionLoading(true);
          await supabase.from('connections').delete().eq('id', conn.id);
          setActionLoading(false);
          await loadData();
          setSelected(null);
        },
      },
    ]);
  }

  function openGiftModal(household: Family) {
    setSelected(null);
    setGiftHours(1);
    setGiftNote('');
    setGiftTarget(household);
  }

  async function submitGift() {
    if (!giftTarget || !myHousehold) return;
    const currentBalance = myHousehold.hours_balance ?? 0;
    const newBalance = currentBalance - giftHours;
    if (newBalance < 0) {
      return Alert.alert('Not enough hours', `You only have ${currentBalance}h to gift.`);
    }
    Alert.alert(
      `Gift ${giftHours}h to ${giftTarget.name}?`,
      `Your balance: ${currentBalance}h → ${newBalance}h`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send Gift 🎁',
          onPress: async () => {
            setGiftLoading(true);
            const { error } = await supabase.rpc('gift_hours', {
              p_recipient_id: giftTarget.id,
              p_hours: giftHours,
              p_note: giftNote.trim() || null,
            });
            setGiftLoading(false);
            if (error) return Alert.alert('Error', error.message);
            await notifyFamily(giftTarget.id, '🎁 You received a gift!', `${myHousehold.name} gifted you ${giftHours}h${giftNote.trim() ? ` — "${giftNote.trim()}"` : ''}`);
            setGiftTarget(null);
            Alert.alert('Gift sent! 🎁', `${giftHours}h sent to ${giftTarget.name}.`);
          },
        },
      ]
    );
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
  const discoverHouseholds = searchLower.length < 2 ? [] : allHouseholds.filter(h => {
    if (h.id === myHousehold?.id) return false;
    if (connectedIds.includes(h.id)) return false;
    if (h.discoverable === false) return false;
    if (blockedIds.has(h.id)) return false;
    if (!h.name.toLowerCase().includes(searchLower)) return false;
    return true;
  });

  const pendingHouseholds = pendingReceived.map(conn => {
    const h = allHouseholds.find(f => f.id === conn.requester_id);
    return h ? { household: h, conn } : null;
  }).filter(Boolean) as { household: Family; conn: Connection }[];

  function renderHouseholdCard({ item }: { item: Family }) {
    const status = getConnectionStatus(item.id);
    return (
      <TouchableOpacity
        style={[styles.card, item.id === myHousehold?.id && styles.cardSelf]}
        onPress={() => setSelected(item)}
      >
        <Text style={styles.cardAnimal}>{getFamilyAnimal(item.id, item.animal)}</Text>
        <View style={styles.cardInfo}>
          <Text style={styles.cardName}>{item.name}</Text>
          {(item.parent1_name || item.parent2_name) && (
            <Text style={styles.cardParents}>
              {[item.parent1_name, item.parent2_name].filter(Boolean).join(' & ')}
            </Text>
          )}
        </View>
        {status === 'connected' && (
          <View style={styles.connectedBadge}><Text style={styles.connectedBadgeText}>Connected</Text></View>
        )}
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
        <Text style={styles.cardAnimal}>{getFamilyAnimal(item.household.id, item.household.animal)}</Text>
        <View style={styles.cardInfo}>
          <Text style={styles.cardName}>{item.household.name}</Text>
          <Text style={styles.cardParents}>Wants to connect with you</Text>
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
          <Text style={styles.title}>Households</Text>
          <Text style={styles.subtitle}>
            {networkHouseholds.length} {networkHouseholds.length === 1 ? 'household' : 'households'} in your network
          </Text>
        </View>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'my_network' && styles.tabBtnActive]}
          onPress={() => setTab('my_network')}
        >
          <Text style={[styles.tabText, tab === 'my_network' && styles.tabTextActive]}>My Network</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'find_people' && styles.tabBtnActive]}
          onPress={() => setTab('find_people')}
        >
          <Text style={[styles.tabText, tab === 'find_people' && styles.tabTextActive]}>Find People</Text>
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
                  placeholder="Search by household name..."
                  placeholderTextColor={colors.textMuted}
                  value={search}
                  onChangeText={setSearch}
                  clearButtonMode="while-editing"
                />
              </View>
            </>
          )}

          {tab === 'my_network' && (
            networkHouseholds.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyEmoji}>🤝</Text>
                <Text style={styles.emptyTitle}>No connections yet</Text>
                <Text style={styles.emptyText}>Go to "Find People" to connect with households you know and trust.</Text>
              </View>
            ) : (
              <FlatList
                data={networkHouseholds}
                keyExtractor={(item) => item.id}
                renderItem={renderHouseholdCard}
                contentContainerStyle={styles.list}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
              />
            )
          )}

          {tab === 'find_people' && (
            discoverHouseholds.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyEmoji}>🔍</Text>
                <Text style={styles.emptyTitle}>{searchLower.length >= 2 ? 'No results' : 'Know someone already?'}</Text>
                <Text style={styles.emptyText}>
                  {searchLower.length >= 2
                    ? 'Try a different name.'
                    : 'Ask for their connect code above, or type at least 2 letters of a household name to search.'}
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
                <Text style={styles.emptyText}>Connection requests from other households will appear here.</Text>
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

      {/* Detail modal */}
      <Modal
        visible={!!selected}
        transparent
        animationType="slide"
        onRequestClose={() => setSelected(null)}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setSelected(null)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          {selected && (() => {
            const status = getConnectionStatus(selected.id);
            const conn = getConnection(selected.id);
            return (
              <ScrollView bounces={false} contentContainerStyle={styles.sheetContent}>
                <Text style={styles.sheetAnimal}>{getFamilyAnimal(selected.id, selected.animal)}</Text>
                <Text style={styles.sheetName}>{selected.name}</Text>

                {(selected.parent1_name || selected.parent1_phone) && (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Adult 1</Text>
                    <View style={styles.infoRight}>
                      {selected.parent1_name && <Text style={styles.infoValue}>{selected.parent1_name}</Text>}
                      {selected.parent1_phone && <Text style={styles.infoSub}>{formatPhone(selected.parent1_phone)}</Text>}
                    </View>
                  </View>
                )}

                {(selected.parent2_name || selected.parent2_phone) && (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Adult 2</Text>
                    <View style={styles.infoRight}>
                      {selected.parent2_name && <Text style={styles.infoValue}>{selected.parent2_name}</Text>}
                      {selected.parent2_phone && <Text style={styles.infoSub}>{formatPhone(selected.parent2_phone)}</Text>}
                    </View>
                  </View>
                )}

                {selected.kids_data && selected.kids_data.length > 0 && (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Kids</Text>
                    <Text style={[styles.infoValue, { flex: 1 }]}>{displayKidsData(selected.kids_data)}</Text>
                  </View>
                )}

                {selected.kids_info && (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>{selected.kids_data?.length ? 'Notes' : 'Kids'}</Text>
                    <Text style={[styles.infoValue, { flex: 1 }]}>{renderKidsInfo(selected.kids_info)}</Text>
                  </View>
                )}

                {status !== 'connected' && selected.id !== myHousehold?.id &&
                  !selected.parent1_name && !selected.parent2_name && !selected.kids_info && !selected.kids_data?.length && (
                  <Text style={styles.connectHint}>Connect with this household to see contact info.</Text>
                )}

                {selected.services_offered && selected.services_offered.length > 0 && (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Helps with</Text>
                    <View style={styles.serviceChips}>
                      {selected.services_offered
                        .filter(key => CATEGORY_LABELS[key])
                        .map(key => (
                          <View key={key} style={styles.serviceChip}>
                            <Text style={styles.serviceChipText}>
                              {CATEGORY_LABELS[key].emoji} {CATEGORY_LABELS[key].label}
                            </Text>
                          </View>
                        ))}
                    </View>
                  </View>
                )}

                {selected.id !== myHousehold?.id && (
                  <View style={styles.actionButtons}>
                    {status === 'connected' && (
                      <>
                        <TouchableOpacity
                          style={styles.messageBtn}
                          onPress={() => { setSelected(null); router.push(`/dm/${selected.id}`); }}
                        >
                          <Text style={styles.messageBtnText}>Send a Message</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.giftBtn}
                          onPress={() => openGiftModal(selected)}
                        >
                          <Text style={styles.giftBtnText}>🎁 Gift Hours</Text>
                        </TouchableOpacity>
                      </>
                    )}

                    {status === 'none' && (
                      <TouchableOpacity
                        style={styles.connectBtn}
                        onPress={() => { setSelected(null); sendConnectionRequest(selected); }}
                        disabled={actionLoading}
                      >
                        <Text style={styles.connectBtnText}>Connect</Text>
                      </TouchableOpacity>
                    )}

                    {status === 'pending_sent' && conn && (
                      <View style={styles.pendingInfo}>
                        <Text style={styles.pendingInfoText}>Connection request sent — waiting for them to accept.</Text>
                        <TouchableOpacity
                          style={styles.revokeBtn}
                          onPress={() => declineConnection(conn)}
                          disabled={actionLoading}
                        >
                          <Text style={styles.revokeBtnText}>Revoke Request</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {status === 'pending_received' && conn && (
                      <View style={styles.incomingActions}>
                        <TouchableOpacity style={styles.acceptBtn} onPress={() => acceptConnection(conn)} disabled={actionLoading}>
                          <Text style={styles.acceptBtnText}>Accept Request</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.declineBtn} onPress={() => declineConnection(conn)} disabled={actionLoading}>
                          <Text style={styles.declineBtnText}>Decline</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {status === 'connected' && (
                      <TouchableOpacity
                        style={styles.disconnectBtn}
                        onPress={() => disconnectHousehold(selected.id)}
                        disabled={actionLoading}
                      >
                        <Text style={styles.disconnectBtnText}>Disconnect</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                {selected.id !== myHousehold?.id && (
                  <View style={styles.safetyRow}>
                    <TouchableOpacity onPress={() => openReportModal(selected)}>
                      <Text style={styles.safetyLinkText}>Report</Text>
                    </TouchableOpacity>
                    <Text style={styles.safetyDivider}>·</Text>
                    <TouchableOpacity onPress={() => blockHousehold(selected)} disabled={actionLoading}>
                      <Text style={styles.safetyLinkText}>Block</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <TouchableOpacity style={styles.closeBtn} onPress={() => setSelected(null)}>
                  <Text style={styles.closeBtnText}>Close</Text>
                </TouchableOpacity>
              </ScrollView>
            );
          })()}
        </View>
      </Modal>

      {/* Gift Hours modal */}
      <Modal
        visible={!!giftTarget}
        transparent
        animationType="slide"
        onRequestClose={() => setGiftTarget(null)}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setGiftTarget(null)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          {giftTarget && (
            <ScrollView bounces={false} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetAnimal}>{getFamilyAnimal(giftTarget.id, giftTarget.animal)}</Text>
              <Text style={styles.giftTitle}>Gift Hours to {giftTarget.name}</Text>
              <Text style={styles.giftSub}>
                Your balance: <Text style={{ fontWeight: '800', color: colors.sage }}>{myHousehold?.hours_balance ?? 0}h</Text>
                {'  →  '}
                <Text style={{ fontWeight: '800', color: (myHousehold?.hours_balance ?? 0) - giftHours < 0 ? colors.red : colors.sage }}>
                  {(myHousehold?.hours_balance ?? 0) - giftHours}h
                </Text>
              </Text>

              <Text style={styles.giftLabel}>Hours to gift</Text>
              <View style={styles.giftHourGrid}>
                {GIFT_HOUR_OPTIONS.map(h => (
                  <TouchableOpacity
                    key={h}
                    style={[styles.giftHourBtn, giftHours === h && styles.giftHourBtnActive]}
                    onPress={() => setGiftHours(h)}
                  >
                    <Text style={[styles.giftHourText, giftHours === h && styles.giftHourTextActive]}>{h}h</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.giftLabel}>Message (optional)</Text>
              <TextInput
                style={styles.giftNoteInput}
                placeholder="e.g. Thanks for watching the kids last week!"
                placeholderTextColor={colors.textMuted}
                value={giftNote}
                onChangeText={setGiftNote}
                multiline
                numberOfLines={3}
              />

              <TouchableOpacity
                style={[styles.giftSubmitBtn, giftLoading && { opacity: 0.6 }]}
                onPress={submitGift}
                disabled={giftLoading}
              >
                <Text style={styles.giftSubmitText}>
                  {giftLoading ? 'Sending...' : `Send ${giftHours}h to ${giftTarget.name} 🎁`}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.closeBtn} onPress={() => setGiftTarget(null)}>
                <Text style={styles.closeBtnText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </Modal>

      <Modal
        visible={!!reportTarget}
        transparent
        animationType="slide"
        onRequestClose={() => setReportTarget(null)}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setReportTarget(null)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          {reportTarget && (
            <ScrollView bounces={false} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
              <Text style={styles.giftTitle}>Report {reportTarget.name}</Text>
              <Text style={styles.giftSub}>This goes to an admin for review, not to {reportTarget.name}.</Text>

              <Text style={styles.giftLabel}>Reason</Text>
              {['Inappropriate behavior', 'Safety concern', 'Spam', 'Other'].map(r => (
                <TouchableOpacity
                  key={r}
                  style={[styles.reportReasonRow, reportReason === r && styles.reportReasonRowActive]}
                  onPress={() => setReportReason(r)}
                >
                  <View style={[styles.radio, reportReason === r && styles.radioActive]} />
                  <Text style={styles.reportReasonText}>{r}</Text>
                </TouchableOpacity>
              ))}

              <Text style={styles.giftLabel}>Details (optional)</Text>
              <TextInput
                style={styles.giftNoteInput}
                placeholder="Anything else the admin should know"
                placeholderTextColor={colors.textMuted}
                value={reportNote}
                onChangeText={setReportNote}
                multiline
                numberOfLines={3}
              />

              <TouchableOpacity
                style={[styles.giftSubmitBtn, (!reportReason || reportSubmitting) && { opacity: 0.6 }]}
                onPress={submitReport}
                disabled={!reportReason || reportSubmitting}
              >
                <Text style={styles.giftSubmitText}>{reportSubmitting ? 'Submitting...' : 'Submit Report'}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.closeBtn} onPress={() => setReportTarget(null)}>
                <Text style={styles.closeBtnText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 20, paddingTop: 16, marginBottom: 4 },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, marginBottom: 2 },
  subtitle: { fontSize: 13, color: colors.textMuted, fontWeight: '500', marginBottom: 4 },

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
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderRadius: 16, padding: 14, marginBottom: 10,
    borderWidth: 1.5, borderColor: colors.borderLight,
  },
  cardSelf: { borderColor: colors.sage },
  cardAnimal: { fontSize: 32, marginRight: 12 },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: '700', color: colors.text },
  cardParents: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  chevron: { fontSize: 22, color: colors.textMuted, marginLeft: 8 },

  connectedBadge: { backgroundColor: colors.sageLight, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: colors.sage },
  connectedBadgeText: { fontSize: 12, color: colors.sageDark, fontWeight: '700' },
  pendingBadge: { backgroundColor: colors.amberLight, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: colors.amber },
  pendingBadgeText: { fontSize: 12, color: colors.amber, fontWeight: '700' },
  incomingBadge: { backgroundColor: colors.primaryLight, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: colors.primary },
  incomingBadgeText: { fontSize: 12, color: colors.primaryDark, fontWeight: '700' },

  pendingCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderRadius: 16, padding: 14, marginBottom: 10,
    borderWidth: 1.5, borderColor: colors.primary + '40',
  },
  pendingActions: { flexDirection: 'column', gap: 6 },
  acceptBtn: { backgroundColor: colors.sage, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7 },
  acceptBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  declineBtn: { backgroundColor: colors.card, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1.5, borderColor: colors.border },
  declineBtnText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  emptyEmoji: { fontSize: 52, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 8, textAlign: 'center' },
  emptyText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    maxHeight: '80%',
  },
  sheetHandle: {
    width: 40, height: 4, backgroundColor: colors.border,
    borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4,
  },
  sheetContent: { paddingHorizontal: 24, paddingBottom: 44, alignItems: 'center' },
  sheetAnimal: { fontSize: 64, marginTop: 8, marginBottom: 8 },
  sheetName: { fontSize: 22, fontWeight: '800', color: colors.text, marginBottom: 20, textAlign: 'center' },

  connectHint: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginBottom: 14, fontStyle: 'italic' },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', width: '100%', marginBottom: 14 },
  infoLabel: { fontSize: 12, fontWeight: '800', color: colors.sage, textTransform: 'uppercase', letterSpacing: 0.6, width: 72, paddingTop: 2 },
  infoRight: { flex: 1 },
  infoValue: { fontSize: 15, color: colors.text, fontWeight: '600' },
  infoSub: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },

  serviceChips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  serviceChip: { backgroundColor: colors.sageLight, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: colors.sage },
  serviceChipText: { fontSize: 13, color: colors.sageDark, fontWeight: '600' },

  actionButtons: { width: '100%', gap: 10, marginTop: 16 },
  messageBtn: {
    backgroundColor: colors.primary, borderRadius: 16, paddingVertical: 16,
    alignItems: 'center', width: '100%',
    shadowColor: colors.primary, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  messageBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  connectBtn: {
    backgroundColor: colors.sage, borderRadius: 16, paddingVertical: 16,
    alignItems: 'center', width: '100%',
    shadowColor: colors.sage, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  connectBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  pendingInfo: { backgroundColor: colors.amberLight, borderRadius: 14, padding: 14, width: '100%', borderWidth: 1, borderColor: colors.amber, gap: 10 },
  pendingInfoText: { fontSize: 14, color: colors.amber, fontWeight: '600', textAlign: 'center' },
  revokeBtn: { alignItems: 'center', paddingVertical: 8 },
  revokeBtnText: { color: colors.red, fontWeight: '700', fontSize: 13 },
  incomingActions: { width: '100%', gap: 10 },
  disconnectBtn: {
    borderRadius: 16, paddingVertical: 14, alignItems: 'center', width: '100%',
    borderWidth: 1.5, borderColor: colors.border, marginTop: 4,
  },
  disconnectBtnText: { fontSize: 14, color: colors.textSecondary, fontWeight: '600' },

  safetyRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 14 },
  safetyLinkText: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  safetyDivider: { fontSize: 13, color: colors.textMuted },
  reportReasonRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10,
    paddingHorizontal: 12, borderRadius: 12, borderWidth: 1.5, borderColor: colors.borderLight, marginBottom: 8,
  },
  reportReasonRowActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.border },
  radioActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  reportReasonText: { fontSize: 14, color: colors.text, fontWeight: '600' },

  closeBtn: { marginTop: 10, borderRadius: 16, paddingVertical: 15, alignItems: 'center', width: '100%', borderWidth: 1.5, borderColor: colors.border },
  closeBtnText: { fontSize: 15, color: colors.textSecondary, fontWeight: '700' },

  giftBtn: {
    borderRadius: 16, paddingVertical: 14, alignItems: 'center', width: '100%',
    borderWidth: 1.5, borderColor: colors.sage, backgroundColor: colors.sageLight,
  },
  giftBtnText: { fontSize: 15, color: colors.sageDark, fontWeight: '700' },

  giftTitle: { fontSize: 20, fontWeight: '800', color: colors.text, marginBottom: 6, textAlign: 'center' },
  giftSub: { fontSize: 14, color: colors.textSecondary, marginBottom: 20, textAlign: 'center' },
  giftLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, alignSelf: 'flex-start', marginBottom: 8, marginTop: 12 },
  giftHourGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, width: '100%' },
  giftHourBtn: {
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card,
  },
  giftHourBtnActive: { backgroundColor: colors.sage, borderColor: colors.sage },
  giftHourText: { fontSize: 15, fontWeight: '700', color: colors.text },
  giftHourTextActive: { color: '#fff' },
  giftNoteInput: {
    width: '100%', backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 15, color: colors.text, textAlignVertical: 'top', minHeight: 90,
  },
  giftSubmitBtn: {
    width: '100%', backgroundColor: colors.sage, borderRadius: 16, paddingVertical: 17,
    alignItems: 'center', marginTop: 20,
    shadowColor: colors.sage, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  giftSubmitText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
