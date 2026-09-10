import { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Text } from '../../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors, buttonStyles } from '../../lib/theme';
import { getFamilyAnimal } from '../../lib/animals';
import { notifyFamily } from '../../lib/notifications';
import { StatusBadge } from '../../components/StatusBadge';
import { ModifierBadge } from '../../components/ModifierBadge';
import type { Request } from '../../types';

type Filter = 'open' | 'mine' | 'upcoming';

export default function RequestsScreen() {
  const { family, refreshFamily } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ filter?: string }>();
  const [requests, setRequests] = useState<Request[]>([]);
  const [connectedIds, setConnectedIds] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filter>('open');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loadSeq = useRef(0);

  async function loadConnections() {
    if (!family) return;
    const { data } = await supabase
      .from('connections')
      .select('requester_id, recipient_id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${family.id},recipient_id.eq.${family.id}`);
    const ids = (data ?? []).map(c =>
      c.requester_id === family.id ? c.recipient_id : c.requester_id
    );
    setConnectedIds(ids);
    return ids;
  }

  async function loadRequests() {
    // Called after nearly every mutation plus on every filter/tab switch —
    // overlapping calls can resolve out of order and a stale one can stomp
    // a fresher result (e.g. approve an offer, but the in-flight reload
    // from just before the tap wins and the approval seems to not show up
    // until you leave and come back). Only the latest issued call commits.
    const seq = ++loadSeq.current;
    const today = new Date().toISOString().split('T')[0];
    const ids = await loadConnections();
    if (seq !== loadSeq.current) return;

    let query = supabase
      .from('requests')
      .select('*, requesting_family:families!requesting_family_id(*), fulfilling_family:families!fulfilling_family_id(*)')
      .eq('post_type', 'request')
      .order('date', { ascending: true })
      .order('start_time', { ascending: true });


    if (filter === 'open') {
      // A request sent directly to one household (target_household_id set)
      // shouldn't show up in every other connection's Open feed too —
      // only the requester's own general (untargeted) posts, plus
      // anything targeted specifically at me.
      query = query
        .eq('status', 'open')
        .in('requesting_family_id', ids ?? [])
        .or(`target_household_id.is.null,target_household_id.eq.${family?.id ?? ''}`);
    } else if (filter === 'mine') {
      query = query
        .eq('requesting_family_id', family?.id ?? '')
        .in('status', ['open', 'offered', 'accepted', 'completed']);
    } else if (filter === 'upcoming') {
      query = query
        .in('status', ['offered', 'accepted'])
        .gte('date', today)
        .or(`requesting_family_id.eq.${family?.id ?? ''},fulfilling_family_id.eq.${family?.id ?? ''}`);
    }

    const { data } = await query;
    if (seq !== loadSeq.current) return;
    // Past-due (date already gone, still unresolved) sinks to the bottom
    // instead of cluttering the top of an ascending date sort.
    const sorted = [...(data ?? [])].sort((a, b) => {
      const aPast = a.status !== 'completed' && (a.end_date ?? a.date) < today;
      const bPast = b.status !== 'completed' && (b.end_date ?? b.date) < today;
      if (aPast !== bPast) return aPast ? 1 : -1;
      if (!aPast && a.is_urgent !== b.is_urgent) return a.is_urgent ? -1 : 1;
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.start_time.localeCompare(b.start_time);
    });
    setRequests(sorted);
    setLoading(false);
  }

  useEffect(() => {
    if (params.filter === 'open' || params.filter === 'mine' || params.filter === 'upcoming') setFilter(params.filter);
  }, [params.filter]);

  useFocusEffect(useCallback(() => { loadRequests(); }, [filter]));

  async function onRefresh() {
    setRefreshing(true);
    await loadRequests();
    setRefreshing(false);
  }

  // ── Request flow ─────────────────────────────────────────────

  function offerDialogBody(req: Request): string {
    const earn = req.duration_hours;
    const date = formatDate(req.date);
    const name = req.requesting_family?.name ?? 'them';
    if (req.category === 'manual_labor') {
      const det = req.category_details as { labor_description?: string; actual_hours?: number } | null;
      return `Offer to help ${name} with "${det?.labor_description ?? 'manual labor'}" on ${date} for ${det?.actual_hours ?? earn / 2}h of work. If approved, you'll earn ${earn}h (2× rate).`;
    }
    if (req.category === 'dog') {
      const det = req.category_details as { dog_name?: string; dog_task?: string } | null;
      return `Offer to ${det?.dog_task === 'walk' ? 'walk' : 'sit for'} ${name}'s dog${det?.dog_name ? ` (${det.dog_name})` : ''} on ${date}. If approved, you'll earn ${earn}h.`;
    }
    if (req.category === 'professional') {
      const det = req.category_details as { service_type?: string } | null;
      return `Offer to provide ${det?.service_type ?? 'professional help'} to ${name} on ${date}. If approved, you'll earn ${earn}h.`;
    }
    if (req.category === 'cooking') {
      const det = req.category_details as { cooking_type?: string } | null;
      return `Offer to help ${name} with ${det?.cooking_type ?? 'cooking'} on ${date}. If approved, you'll earn ${earn}h.`;
    }
    return `Offer to watch ${name}'s kids on ${date}. If approved, you'll earn ${earn}h.`;
  }

  async function offerRequest(req: Request) {
    if (!family) return;
    Alert.alert('Offer to help?', offerDialogBody(req), [
      { text: 'Not now', style: 'cancel' },
      {
        text: 'Send offer', onPress: async () => {
          const { error } = await supabase.rpc('offer_request', { p_request_id: req.id, p_offering_family_id: family.id });
          if (error) return Alert.alert('Error', error.message);
          await notifyFamily(req.requesting_family_id, '🙋 Someone offered to help!', `${family.name} offered to help — open the app to approve or decline`, { path: `/(tabs)/requests?filter=mine` });
          await loadRequests();
        },
      },
    ]);
  }

  async function approveOffer(req: Request) {
    if (!family) return;
    Alert.alert('Approve this offer?',
      `${req.fulfilling_family?.name} will help you on ${formatDate(req.date)}. ${req.duration_hours}h will be deducted from your balance.`,
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Approve ✓', onPress: async () => {
            const { error } = await supabase.rpc('approve_offer', { p_request_id: req.id, p_requester_family_id: family.id });
            if (error) return Alert.alert('Error', error.message);
            await notifyFamily(req.fulfilling_family_id!, '✅ Your offer was approved!', `${family.name} approved your offer for ${formatDate(req.date)}`, { path: `/(tabs)/requests?filter=upcoming` });
            await Promise.all([loadRequests(), refreshFamily()]);
          },
        },
      ]
    );
  }

  async function declineOffer(req: Request) {
    if (!family) return;
    Alert.alert('Decline this offer?', 'The request goes back to available.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Decline', style: 'destructive', onPress: async () => {
          const { error } = await supabase.rpc('retract_offer', { p_request_id: req.id });
          if (error) return Alert.alert('Error', error.message);
          if (req.fulfilling_family_id) await notifyFamily(req.fulfilling_family_id, '❌ Offer declined', `${family.name} passed on your offer — the request is back available`, { path: `/(tabs)/requests?filter=open` });
          await loadRequests();
        },
      },
    ]);
  }

  async function withdrawOffer(req: Request) {
    Alert.alert('Withdraw your offer?', 'The request goes back to available.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Withdraw', style: 'destructive', onPress: async () => {
        const { error } = await supabase.rpc('retract_offer', { p_request_id: req.id });
        if (error) return Alert.alert('Error', error.message);
        await loadRequests();
      }},
    ]);
  }

  // ── Shared actions ─────────────────────────────────────────────

  async function markCompleted(req: Request) {
    Alert.alert('Mark as completed?', 'Confirm the help happened.', [
      { text: 'Not yet', style: 'cancel' },
      {
        text: 'Yes, done!', onPress: async () => {
          const { error } = await supabase.rpc('complete_request', { p_request_id: req.id });
          if (error) return Alert.alert('Error', error.message);
          const other = req.requesting_family_id === family?.id ? req.fulfilling_family_id : req.requesting_family_id;
          if (other) await notifyFamily(other, '🎉 Marked completed', `"${req.title}" was marked completed — ${req.duration_hours}h settled.`, { path: `/(tabs)/requests?filter=upcoming` });
          await Promise.all([loadRequests(), refreshFamily()]);
        },
      },
    ]);
  }

  async function cancelRequest(req: Request) {
    Alert.alert('Cancel this?', 'This will remove the post from the board.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel', style: 'destructive', onPress: async () => {
        await supabase.from('requests').delete().eq('id', req.id);
        loadRequests();
      }},
    ]);
  }

  async function reverseSettlement(req: Request) {
    if (!family) return;
    Alert.alert(
      "Didn't happen?",
      `This will undo the ${req.duration_hours}h that was already paid out for "${req.title}" and mark it cancelled.`,
      [
        { text: 'Never mind', style: 'cancel' },
        {
          text: 'Reverse', style: 'destructive', onPress: async () => {
            const { error } = await supabase.rpc('reverse_settlement', { p_request_id: req.id });
            if (error) return Alert.alert('Error', error.message);
            if (req.fulfilling_family_id) await notifyFamily(req.fulfilling_family_id, '⚠️ Settlement reversed', `${family.name} reversed the payout for "${req.title}" — it didn't happen`, { path: `/(tabs)/requests?filter=mine` });
            await Promise.all([loadRequests(), refreshFamily()]);
          },
        },
      ]
    );
  }

  async function cancelAcceptedRequest(req: Request) {
    if (!family) return;
    const isOwn = req.requesting_family_id === family.id;
    const sitDate = new Date(req.date + 'T00:00:00');
    const within24h = (sitDate.getTime() - Date.now()) / 3600000 < 24;
    const base = isOwn
      ? `This will cancel and return ${req.duration_hours}h to your balance.`
      : `This will release you and return ${req.duration_hours}h to ${req.requesting_family?.name}.`;
    Alert.alert(isOwn ? 'Cancel?' : 'Back out?', base + (within24h ? '\n\n⚠️ Within 24 hours — please contact them directly!' : ''), [
      { text: 'Keep it', style: 'cancel' },
      {
        text: isOwn ? 'Cancel' : 'Back out', style: 'destructive', onPress: async () => {
          const { error } = await supabase.rpc('cancel_accepted_request', { p_request_id: req.id, p_family_id: family.id });
          if (error) return Alert.alert('Error', error.message);
          const other = isOwn ? req.fulfilling_family_id : req.requesting_family_id;
          if (other) await notifyFamily(other, '⚠️ Cancelled', isOwn ? `${family.name} cancelled for ${formatDate(req.date)}` : `${family.name} backed out — post is available again`, { path: `/(tabs)/requests?filter=${isOwn ? 'open' : 'mine'}` });
          await Promise.all([loadRequests(), refreshFamily()]);
        },
      },
    ]);
  }

  // ── Helpers ────────────────────────────────────────────────────

  function formatDate(dateStr: string) {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  // A short fact about the specific category, shown as a fact chip —
  // e.g. which house, what the dog needs, what the labor job is.
  function categoryDetailText(item: Request): string | null {
    const d = item.category_details as Record<string, string> | null;
    if (!d) return null;
    switch (item.category) {
      case 'kid_sit': return d.location === 'kids_house' ? "🏠 At their house" : d.location === 'sitters_house' ? "🏡 At the sitter's house" : null;
      case 'dog': {
        const name = d.pet_name ?? d.dog_name;
        const taskLabel = d.dog_task === 'walk' ? '🦮 Walking' : d.dog_task === 'house_check' ? '🏠 House check' : '🏡 Boarding';
        return `${taskLabel}${name ? ` · ${name}` : ''}`;
      }
      case 'manual_labor': return d.labor_description ? `"${d.labor_description}"` : null;
      case 'professional': return d.service_type ?? null;
      case 'cooking': return d.cooking_type ?? null;
      case 'elder_care': return d.elder_care_type ?? null;
      case 'physical_training': return d.training_type ?? null;
      case 'errands': return d.errand_type ?? null;
      default: return null;
    }
  }

  function FactChip({ text, earning }: { text: string; earning?: boolean }) {
    const tinted = earning !== undefined;
    const color = earning ? colors.sageDark : colors.primaryDark;
    return (
      <View style={[styles.factChip, tinted && { backgroundColor: earning ? colors.greenLight : colors.primaryLight, borderColor: 'transparent' }]}>
        {tinted && <MaterialIcons name={earning ? 'call-received' : 'call-made'} size={11} color={color} />}
        <Text style={[styles.factChipText, tinted && { color }]}>{text}</Text>
      </View>
    );
  }

  // Spells out both sides of the request plus its status in one line —
  // especially important in "Scheduled," which mixes things you posted
  // with things you offered to help with.
  function roleLine(item: Request, isOwn: boolean, isFulfiller: boolean): string {
    const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s;
    const requester = isOwn ? 'You' : (item.requesting_family?.name || 'Someone');
    if (item.status === 'open') return `${requester} requested · No helper yet`;
    const fulfiller = isFulfiller ? 'You' : cap(item.fulfilling_family?.name || 'someone');
    if (item.status === 'offered') return `${requester} requested · ${fulfiller} offered to help`;
    if (item.status === 'accepted') return `${requester} requested · ${fulfiller} confirmed to help`;
    if (item.status === 'completed') return `${requester} requested · ${fulfiller} helped`;
    if (item.status === 'cancelled') return `${requester} requested · Cancelled`;
    return requester;
  }

  // ── Card ───────────────────────────────────────────────────────

  const renderItem = ({ item }: { item: Request }) => {
    const isOwn = item.requesting_family_id === family?.id;
    const isFulfiller = item.fulfilling_family_id === family?.id;
    const isConfirmed = item.status === 'accepted' || item.status === 'completed';
    const hasOffer = item.status === 'offered';
    // Multi-day (overnight) requests aren't past due until the actual end
    // date passes, not the start/drop-off date.
    const isPastDue = item.status !== 'completed' && (item.end_date ?? item.date) < new Date().toISOString().split('T')[0];

    const contactFamily = isOwn ? item.fulfilling_family : item.requesting_family;
    const showContact = (hasOffer || isConfirmed) && contactFamily;
    const timingFlexible = (item.category_details as { timing_flexible?: boolean } | null)?.timing_flexible;
    const sentToYou = !isOwn && item.target_household_id === family?.id;
    const detailText = categoryDetailText(item);
    const avatarEmoji = getFamilyAnimal(item.requesting_family_id, item.requesting_family?.animal ?? null);
    // Direction is about the viewer's own hour consequence — helping earns
    // you hours, your own request spends them once it's fulfilled.
    const earning = isFulfiller || !isOwn;

    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => router.push(`/request/${item.id}`)}
        style={[styles.card, isPastDue && styles.cardPastDue, item.is_urgent && !isPastDue && styles.cardUrgent]}
      >
        <View style={styles.topRow}>
          <View style={styles.topLeftPills}>
            {isPastDue ? (
              <View style={[styles.badge, styles.pastDueBadge]}><Text style={[styles.badgeText, styles.pastDueBadgeText]}>⏰ Past date</Text></View>
            ) : item.is_urgent ? (
              <ModifierBadge kind="urgent" />
            ) : (
              <StatusBadge status={item.status} />
            )}
            {!isPastDue && item.category === 'manual_labor' && <ModifierBadge kind="rate2x" />}
          </View>
          <View style={styles.avatarSquare}><Text style={styles.avatarEmoji}>{avatarEmoji}</Text></View>
        </View>

        <Text style={[styles.cardTitle, isPastDue && styles.cardTitlePastDue]}>{item.title}</Text>
        <Text style={styles.cardFamily}>
          {roleLine(item, isOwn, isFulfiller)}
          {item.category === 'kid_sit' && item.kid_name ? `  ·  ${item.kid_name}` : ''}
        </Text>

        <View style={styles.factRow}>
          {item.is_overnight ? (
            <>
              <FactChip text={`${formatDate(item.date)} → ${formatDate(item.end_date ?? item.date)}`} />
              <FactChip text={`${item.duration_hours}h charged`} earning={earning} />
            </>
          ) : (
            <>
              <FactChip text={`${formatDate(item.date)} · ${item.start_time}`} />
              <FactChip text={`${item.duration_hours}h`} earning={earning} />
            </>
          )}
          {detailText && <FactChip text={detailText} />}
          {!isPastDue && item.is_overnight && <ModifierBadge kind="overnight" />}
          {!isPastDue && timingFlexible && <ModifierBadge kind="flexible" />}
          {!isPastDue && sentToYou && <ModifierBadge kind="sent" />}
        </View>

        {item.notes ? <Text style={styles.cardNotes}>{item.notes}</Text> : null}

        {showContact && (
          <View style={styles.contactLine2}>
            <Text style={styles.contactLine2Text}>
              {isOwn ? (hasOffer && !isConfirmed ? '🙋 Offered by' : '👤 Helper:') : '👨‍👩‍👧 Family:'} <Text style={styles.contactLine2Name}>{contactFamily!.name}</Text>
            </Text>
          </View>
        )}
        {/* ── Actions ── */}
        <View style={styles.cardActions}>
          {item.status === 'open' && !isOwn && (
            <View style={styles.primaryActionRow}>
              <TouchableOpacity style={[buttonStyles.earn.container, styles.primaryActionBtn]} onPress={() => offerRequest(item)}>
                <Text style={buttonStyles.earn.text}>Offer to help</Text>
              </TouchableOpacity>
              <View style={styles.amountStack}>
                <View style={styles.amountRow}>
                  <MaterialIcons name="call-received" size={14} color={colors.sageDark} />
                  <Text style={[styles.amountText, { color: colors.sageDark }]}>+{item.duration_hours}h</Text>
                </View>
                <Text style={styles.amountCaption}>you earn</Text>
              </View>
            </View>
          )}
          {item.status === 'open' && isOwn && (
            <View style={styles.openOwnActions}>
              <TouchableOpacity style={buttonStyles.secondary.container} onPress={() => router.push({ pathname: '/edit-request', params: { requestId: item.id } })}>
                <Text style={buttonStyles.secondary.text}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={buttonStyles.destructive.container} onPress={() => cancelRequest(item)}>
                <Text style={buttonStyles.destructive.text}>Cancel Request</Text>
              </TouchableOpacity>
            </View>
          )}
          {item.status === 'offered' && isOwn && (
            <View style={styles.offeredActions}>
              <Text style={styles.offeredPrompt}>{item.fulfilling_family?.name} wants to help — approve to confirm!</Text>
              <View style={styles.primaryActionRow}>
                <TouchableOpacity style={[buttonStyles.spend.container, styles.primaryActionBtn]} onPress={() => approveOffer(item)}>
                  <Text style={buttonStyles.spend.text}>Approve</Text>
                </TouchableOpacity>
                <View style={styles.amountStack}>
                  <View style={styles.amountRow}>
                    <MaterialIcons name="call-made" size={14} color={colors.primaryDark} />
                    <Text style={[styles.amountText, { color: colors.primaryDark }]}>-{item.duration_hours}h</Text>
                  </View>
                  <Text style={styles.amountCaption}>you'd pay</Text>
                </View>
              </View>
              <TouchableOpacity style={buttonStyles.destructive.container} onPress={() => declineOffer(item)}>
                <Text style={buttonStyles.destructive.text}>Decline offer</Text>
              </TouchableOpacity>
            </View>
          )}
          {item.status === 'offered' && isFulfiller && (
            <TouchableOpacity style={buttonStyles.secondary.container} onPress={() => withdrawOffer(item)}>
              <Text style={buttonStyles.secondary.text}>Withdraw my offer</Text>
            </TouchableOpacity>
          )}
          {item.status === 'offered' && !isOwn && !isFulfiller && (
            <View style={styles.offeredElsewhere}><Text style={styles.offeredElsewhereText}>Offer pending approval</Text></View>
          )}

          {(item.status === 'accepted' || item.status === 'completed') && item.settled_at && !item.reversed_at && (
            <View style={styles.settledBox}>
              <Text style={styles.settledText}>✅ Settled — {item.duration_hours}h paid out</Text>
              {isOwn && (
                <TouchableOpacity style={styles.reverseBtn} onPress={() => reverseSettlement(item)}>
                  <Text style={styles.reverseBtnText}>Didn't happen? Reverse</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {item.status === 'accepted' && !item.settled_at && (isOwn || isFulfiller) && (
            <View style={styles.acceptedActions}>
              <TouchableOpacity style={styles.completeBtn} onPress={() => markCompleted(item)}>
                <Text style={styles.completeBtnText}>Mark as Completed ✓</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.backOutBtn} onPress={() => cancelAcceptedRequest(item)}>
                <Text style={styles.backOutBtnText}>{isOwn ? 'Cancel' : 'Back Out'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const statusFilters: { key: Filter; label: string }[] = [
    { key: 'open',     label: 'Village' },
    { key: 'mine',     label: 'Mine' },
    { key: 'upcoming', label: 'Scheduled' },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Requests</Text>
        <TouchableOpacity style={styles.newBtn} onPress={() => router.push('/new-request')}>
          <Text style={styles.newBtnText}>+ New</Text>
        </TouchableOpacity>
      </View>

      {/* Status filter — segmented, matching the Village tab */}
      <View style={styles.tabBar}>
        {statusFilters.map((f) => (
          <TouchableOpacity key={f.key} style={[styles.tabBtn, filter === f.key && styles.tabBtnActive]} onPress={() => { setFilter(f.key); setLoading(true); }}>
            <Text style={[styles.tabText, filter === f.key && styles.tabTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>


      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>{filter === 'upcoming' ? '🗓️' : '📭'}</Text>
              <Text style={styles.emptyText}>
                {filter === 'upcoming' ? 'Nothing scheduled yet' : 'No requests here yet'}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, marginBottom: 10 },
  title: { fontSize: 24, fontWeight: '800', color: colors.text },
  newBtn: { backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 9 },
  newBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // Category filter

  // Status filter — segmented, matching Village's tabBar
  tabBar: {
    flexDirection: 'row', marginHorizontal: 20, marginBottom: 12,
    backgroundColor: colors.card, borderRadius: 14,
    borderWidth: 1.5, borderColor: colors.border, padding: 4,
  },
  tabBtn: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center' },
  tabBtnActive: { backgroundColor: colors.primary },
  tabText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  tabTextActive: { color: '#fff', fontWeight: '700' },

  list: { paddingHorizontal: 20, paddingBottom: 32 },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1.5, borderColor: colors.borderLight, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  cardPastDue: { opacity: 0.55, borderColor: colors.red + '60', shadowOpacity: 0 },
  cardUrgent: { borderColor: colors.red, borderWidth: 2 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  topLeftPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1 },
  avatarSquare: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.sageLight, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  avatarEmoji: { fontSize: 20 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 3 },
  cardTitlePastDue: { color: colors.textMuted },
  badge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  pastDueBadge: { backgroundColor: colors.redLight },
  pastDueBadgeText: { color: colors.red },
  cardFamily: { fontSize: 13, color: colors.textSecondary, marginBottom: 10, fontWeight: '500' },
  factRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  factChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.background, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1, borderColor: colors.borderLight },
  factChipText: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.3 },
  cardNotes: { fontSize: 13, color: colors.textSecondary, fontStyle: 'italic', marginBottom: 8 },
  primaryActionRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  primaryActionBtn: { flex: 1 },
  amountStack: { alignItems: 'flex-end' },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  amountText: { fontSize: 17, fontWeight: '800' },
  amountCaption: { fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.3 },
  contactLine2: { marginVertical: 4 },
  contactLine2Text: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  contactLine2Name: { color: colors.text, fontWeight: '700' },
  cardActions: { marginTop: 6 },

  // Action buttons
  openOwnActions: { gap: 8 },
  offeredActions: { gap: 8 },
  offeredPrompt: { fontSize: 13, color: colors.text, fontWeight: '600', marginBottom: 4, textAlign: 'center' },
  offeredElsewhere: { backgroundColor: colors.borderLight, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  offeredElsewhereText: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
  acceptedActions: { gap: 8 },
  completeBtn: { backgroundColor: colors.greenLight, borderRadius: 12, paddingVertical: 12, alignItems: 'center', borderWidth: 1.5, borderColor: colors.green },
  completeBtnText: { color: colors.sageDark, fontWeight: '700', fontSize: 14 },
  backOutBtn: { borderWidth: 1.5, borderColor: colors.red + '60', borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  backOutBtnText: { color: colors.red, fontWeight: '600', fontSize: 13 },
  settledBox: { backgroundColor: colors.greenLight, borderRadius: 12, borderWidth: 1.5, borderColor: colors.green, padding: 12, gap: 8 },
  settledText: { color: colors.sageDark, fontWeight: '700', fontSize: 13, textAlign: 'center' },
  reverseBtn: { alignItems: 'center', paddingVertical: 6 },
  reverseBtnText: { color: colors.textMuted, fontWeight: '600', fontSize: 12, textDecorationLine: 'underline' },

  empty: { alignItems: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, color: colors.textMuted, fontWeight: '500' },
});
