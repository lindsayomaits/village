import { useState, useCallback, useEffect } from 'react';
import {
  View, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
import { Text } from '../../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors } from '../../lib/theme';
import { notifyFamily, notifyConnections } from '../../lib/notifications';
import type { Request, RequestCategory } from '../../types';

type Filter = 'open' | 'mine' | 'upcoming';

const ALL_CATEGORIES: { key: RequestCategory; emoji: string; label: string }[] = [
  { key: 'kid_sit',           emoji: '👧', label: 'Kid-sitting' },
  { key: 'dog',               emoji: '🐾', label: 'Pet care' },
  { key: 'manual_labor',      emoji: '🔨', label: 'Labor' },
  { key: 'professional',      emoji: '🎓', label: 'Professional' },
  { key: 'cooking',           emoji: '🍳', label: 'Cooking' },
  { key: 'elder_care',        emoji: '🤝', label: 'Elder care' },
  { key: 'physical_training', emoji: '🏃', label: 'Fitness' },
  { key: 'errands',           emoji: '🛒', label: 'Errands' },
];

export default function RequestsScreen() {
  const { family, refreshFamily } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ postType?: string; filter?: string }>();
  const [requests, setRequests] = useState<Request[]>([]);
  const [connectedIds, setConnectedIds] = useState<string[]>([]);
  const [postType, setPostType] = useState<'request' | 'offering'>('request');
  const [catFilter, setCatFilter] = useState<RequestCategory | 'all'>('all');
  const [filter, setFilter] = useState<Filter>('open');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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
    const today = new Date().toISOString().split('T')[0];
    const ids = await loadConnections();

    let query = supabase
      .from('requests')
      .select('*, requesting_family:families!requesting_family_id(*), fulfilling_family:families!fulfilling_family_id(*)')
      .eq('post_type', postType)
      .order('date', { ascending: true })
      .order('start_time', { ascending: true });

    if (catFilter !== 'all') query = query.eq('category', catFilter);

    if (filter === 'open') {
      query = query.eq('status', 'open').in('requesting_family_id', ids ?? []);
    } else if (filter === 'mine') {
      query = query
        .eq('requesting_family_id', family?.id ?? '')
        .in('status', ['open', 'offered', 'accepted', 'completed', 'cancelled']);
    } else if (filter === 'upcoming') {
      query = query
        .in('status', ['offered', 'accepted'])
        .gte('date', today)
        .or(`requesting_family_id.eq.${family?.id ?? ''},fulfilling_family_id.eq.${family?.id ?? ''}`);
    }

    const { data } = await query;
    setRequests(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    if (params.postType === 'request' || params.postType === 'offering') setPostType(params.postType);
    if (params.filter === 'open' || params.filter === 'mine' || params.filter === 'upcoming') setFilter(params.filter);
  }, [params.postType, params.filter]);

  useFocusEffect(useCallback(() => { loadRequests(); }, [filter, postType, catFilter]));

  async function onRefresh() {
    setRefreshing(true);
    await loadRequests();
    setRefreshing(false);
  }

  function switchPostType(next: 'request' | 'offering') {
    setPostType(next);
    setFilter('open');
    setLoading(true);
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
          await notifyFamily(req.requesting_family_id, '🙋 Someone offered to help!', `${family.name} offered to help — open the app to approve or decline`);
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
            await notifyFamily(req.fulfilling_family_id!, '✅ Your offer was approved!', `${family.name} approved your offer for ${formatDate(req.date)}`);
            await Promise.all([loadRequests(), refreshFamily()]);
          },
        },
      ]
    );
  }

  async function declineOffer(req: Request) {
    if (!family) return;
    Alert.alert('Decline this offer?', 'The request goes back to open.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Decline', style: 'destructive', onPress: async () => {
          const { error } = await supabase.rpc('retract_offer', { p_request_id: req.id });
          if (error) return Alert.alert('Error', error.message);
          if (req.fulfilling_family_id) await notifyFamily(req.fulfilling_family_id, '❌ Offer declined', `${family.name} passed on your offer — the request is back open`);
          await loadRequests();
        },
      },
    ]);
  }

  async function withdrawOffer(req: Request) {
    Alert.alert('Withdraw your offer?', 'The request goes back to open.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Withdraw', style: 'destructive', onPress: async () => {
        const { error } = await supabase.rpc('retract_offer', { p_request_id: req.id });
        if (error) return Alert.alert('Error', error.message);
        await loadRequests();
      }},
    ]);
  }

  // ── Offering flow ─────────────────────────────────────────────

  async function claimOffering(req: Request) {
    if (!family) return;
    const earn = req.duration_hours;
    Alert.alert('Claim this availability?',
      `${req.requesting_family?.name} will help you on ${formatDate(req.date)}. If they approve, ${earn}h will be deducted from your balance.`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Claim it!', onPress: async () => {
            const { error } = await supabase.rpc('offer_request', { p_request_id: req.id, p_offering_family_id: family.id });
            if (error) return Alert.alert('Error', error.message);
            await notifyFamily(req.requesting_family_id, '🙋 Someone claimed your availability!', `${family.name} wants your help — open the app to approve or decline`);
            await loadRequests();
          },
        },
      ]
    );
  }

  async function approveOfferingClaim(req: Request) {
    if (!family) return;
    Alert.alert('Approve this claim?',
      `${req.fulfilling_family?.name} wants your help on ${formatDate(req.date)}. You'll earn ${req.duration_hours}h.`,
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Approve ✓', onPress: async () => {
            const { error } = await supabase.rpc('approve_offering_claim', { p_request_id: req.id, p_offering_family_id: family.id });
            if (error) return Alert.alert('Error', error.message);
            await notifyFamily(req.fulfilling_family_id!, '✅ Claim approved!', `${family.name} confirmed — you're all set for ${formatDate(req.date)}`);
            await Promise.all([loadRequests(), refreshFamily()]);
          },
        },
      ]
    );
  }

  async function withdrawClaim(req: Request) {
    Alert.alert('Withdraw your claim?', 'The availability goes back to open.', [
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
          await supabase.from('requests').update({ status: 'completed' }).eq('id', req.id);
          await notifyConnections(family?.id ?? '', '🎉 Completed!', `${req.fulfilling_family?.name} helped ${req.requesting_family?.name}`);
          loadRequests();
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
          if (other) await notifyFamily(other, '⚠️ Cancelled', isOwn ? `${family.name} cancelled for ${formatDate(req.date)}` : `${family.name} backed out — post is open again`);
          await Promise.all([loadRequests(), refreshFamily()]);
        },
      },
    ]);
  }

  // ── Helpers ────────────────────────────────────────────────────

  function formatDate(dateStr: string) {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function statusBadge(status: Request['status']) {
    const map: Record<string, { bg: string; text: string; label: string }> = {
      open:      { bg: colors.greenLight,  text: '#059669',    label: 'Open' },
      offered:   { bg: colors.amberLight,  text: colors.amber, label: postType === 'offering' ? 'Claim pending' : 'Offer pending' },
      accepted:  { bg: colors.blueLight,   text: colors.blue,  label: 'Confirmed' },
      completed: { bg: colors.purpleLight, text: colors.purple, label: 'Completed' },
      cancelled: { bg: colors.redLight,    text: colors.red,   label: 'Cancelled' },
    };
    const s = map[status] ?? map.open;
    return <View style={[styles.badge, { backgroundColor: s.bg }]}><Text style={[styles.badgeText, { color: s.text }]}>{s.label}</Text></View>;
  }

  function categoryBadge(category: RequestCategory | undefined) {
    if (!category || category === 'kid_sit') return null;
    const cfg: Record<string, { bg: string; text: string; label: string }> = {
      dog:               { bg: colors.blueLight,   text: colors.blue,     label: '🐾 Pet care' },
      manual_labor:      { bg: colors.amberLight,  text: colors.amber,    label: '🔨 Labor · 2× rate' },
      professional:      { bg: colors.sageLight,   text: colors.sageDark, label: '🎓 Professional' },
      cooking:           { bg: colors.purpleLight, text: colors.purple,   label: '🍳 Cooking' },
      elder_care:        { bg: '#FEF3C7',           text: '#92400E',       label: '🤝 Elder care' },
      physical_training: { bg: '#D1FAE5',           text: '#065F46',       label: '🏃 Fitness' },
      errands:           { bg: '#E0F2FE',           text: '#0369A1',       label: '🛒 Errands' },
    };
    const c = cfg[category];
    if (!c) return null;
    return <View style={[styles.catBadge, { backgroundColor: c.bg }]}><Text style={[styles.catBadgeText, { color: c.text }]}>{c.label}</Text></View>;
  }

  // ── Card ───────────────────────────────────────────────────────

  const renderItem = ({ item }: { item: Request }) => {
    const isOffering = item.post_type === 'offering';
    // For requests: isOwn = the one who needs help. For offerings: isOwn = the one who can help.
    const isOwn = item.requesting_family_id === family?.id;
    const isFulfiller = item.fulfilling_family_id === family?.id;
    const isConfirmed = item.status === 'accepted' || item.status === 'completed';
    const hasOffer = item.status === 'offered';

    const contactFamily = isOwn ? item.fulfilling_family : item.requesting_family;
    const showContact = (hasOffer || isConfirmed) && contactFamily;

    return (
      <View style={[styles.card, isOffering && styles.cardOffering]}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          {statusBadge(item.status)}
        </View>

        <Text style={styles.cardFamily}>
          {isOwn
            ? isOffering ? 'Your availability' : 'Your request'
            : isOffering ? `${item.requesting_family?.name} can help` : item.requesting_family?.name}
          {item.category === 'kid_sit' && item.kid_name ? `  ·  ${item.kid_name}` : ''}
        </Text>

        {categoryBadge(item.category)}

        {item.category === 'kid_sit' && item.category_details && (() => {
          const d = item.category_details as { location?: string };
          if (!d.location) return null;
          return <Text style={styles.catDetailText}>{d.location === 'kids_house' ? "🏠 At the kid's house" : "🏡 At the sitter's house"}</Text>;
        })()}
        {item.category === 'dog' && item.category_details && (() => {
          const d = item.category_details as { pet_name?: string; dog_name?: string; dog_task?: string };
          const name = d.pet_name ?? d.dog_name;
          const taskLabel = d.dog_task === 'walk' ? '🦮 Walking' : d.dog_task === 'house_check' ? '🏠 House check' : '🏡 Boarding';
          return <Text style={styles.catDetailText}>{taskLabel}{name ? ` · ${name}` : ''}</Text>;
        })()}
        {item.category === 'manual_labor' && item.category_details && (() => {
          const d = item.category_details as { labor_description?: string };
          return d.labor_description ? <Text style={styles.catDetailText}>"{d.labor_description}"</Text> : null;
        })()}
        {item.category === 'professional' && item.category_details && (() => {
          const d = item.category_details as { service_type?: string };
          return d.service_type ? <Text style={styles.catDetailText}>{d.service_type}</Text> : null;
        })()}
        {item.category === 'cooking' && item.category_details && (() => {
          const d = item.category_details as { cooking_type?: string };
          return d.cooking_type ? <Text style={styles.catDetailText}>{d.cooking_type}</Text> : null;
        })()}
        {item.category === 'elder_care' && item.category_details && (() => {
          const d = item.category_details as { elder_care_type?: string };
          return d.elder_care_type ? <Text style={styles.catDetailText}>{d.elder_care_type}</Text> : null;
        })()}
        {item.category === 'physical_training' && item.category_details && (() => {
          const d = item.category_details as { training_type?: string };
          return d.training_type ? <Text style={styles.catDetailText}>{d.training_type}</Text> : null;
        })()}
        {item.category === 'errands' && item.category_details && (() => {
          const d = item.category_details as { errand_type?: string };
          return d.errand_type ? <Text style={styles.catDetailText}>{d.errand_type}</Text> : null;
        })()}

        {isOffering ? (
          <View style={styles.cardMeta}>
            <Text style={styles.metaText}>
              📅 From {formatDate(item.date)}{item.end_date ? ` · Until ${formatDate(item.end_date)}` : ' · Open-ended'}
            </Text>
            <Text style={styles.metaText}>🕐 {item.start_time}</Text>
            <Text style={styles.metaText}>⏱ Up to {item.duration_hours}h</Text>
          </View>
        ) : item.is_overnight ? (
          <View style={styles.cardMeta}>
            <Text style={styles.metaText}>📥 Drop-off: {formatDate(item.date)} at {item.start_time}</Text>
            {item.end_date && <Text style={styles.metaText}>📤 Pick-up: {formatDate(item.end_date)} at {item.end_time}</Text>}
            <Text style={styles.metaText}>⭐ {item.duration_hours}h charged</Text>
          </View>
        ) : item.category === 'manual_labor' ? (() => {
          const d = item.category_details as { actual_hours?: number } | null;
          const actualH = d?.actual_hours ?? item.duration_hours / 2;
          return (
            <View style={styles.cardMeta}>
              <Text style={styles.metaText}>📅 {formatDate(item.date)}</Text>
              <Text style={styles.metaText}>🕐 {item.start_time}</Text>
              <Text style={styles.metaText}>⏱ {actualH}h work · {item.duration_hours}h charged</Text>
            </View>
          );
        })() : (
          <View style={styles.cardMeta}>
            <Text style={styles.metaText}>📅 {formatDate(item.date)}</Text>
            <Text style={styles.metaText}>🕐 {item.start_time}</Text>
            <Text style={styles.metaText}>⏱ {item.duration_hours}h</Text>
          </View>
        )}

        {item.is_overnight && <View style={styles.overnightBadge}><Text style={styles.overnightBadgeText}>🌙 Overnight</Text></View>}
        {(item.category_details as { timing_flexible?: boolean } | null)?.timing_flexible && (
          <View style={styles.flexibleBadge}><Text style={styles.flexibleBadgeText}>⏰ Flexible timing</Text></View>
        )}
        {item.notes ? <Text style={styles.cardNotes}>{item.notes}</Text> : null}

        {showContact && (
          <View style={styles.contactBox}>
            <Text style={styles.contactTitle}>
              {isOffering
                ? isOwn ? '🙋 Claimed by' : '🙋 Helper'
                : isOwn ? (hasOffer && !isConfirmed ? '🙋 Offered by' : '👤 Your helper') : '👨‍👩‍👧 Family'}
            </Text>
            <Text style={styles.contactName}>{contactFamily!.name}</Text>
            {contactFamily!.parent1_name
              ? <Text style={styles.contactLine}>👤 {contactFamily!.parent1_name}{contactFamily!.parent1_phone ? `  ·  📞 ${contactFamily!.parent1_phone}` : ''}</Text>
              : contactFamily!.phone ? <Text style={styles.contactLine}>📞 {contactFamily!.phone}</Text> : null}
            {contactFamily!.parent2_name && <Text style={styles.contactLine}>👤 {contactFamily!.parent2_name}{contactFamily!.parent2_phone ? `  ·  📞 ${contactFamily!.parent2_phone}` : ''}</Text>}
            <Text style={styles.contactLine}>✉️ {contactFamily!.email}</Text>
            {contactFamily!.address && <Text style={styles.contactLine}>🏠 {contactFamily!.address}</Text>}
          </View>
        )}

        {/* ── Actions ── */}
        <View style={styles.cardActions}>
          {!isOffering && (
            <>
              {item.status === 'open' && !isOwn && (
                <TouchableOpacity style={[styles.offerBtn, item.category === 'manual_labor' && { backgroundColor: colors.amber }]} onPress={() => offerRequest(item)}>
                  <Text style={styles.offerBtnText}>
                    {item.category === 'manual_labor' ? `Offer to help — Earn ${item.duration_hours}h (2×) 🔨`
                      : item.category === 'dog' ? `Offer to help — Earn ${item.duration_hours}h 🐕`
                      : item.category === 'professional' ? `Offer to help — Earn ${item.duration_hours}h 🎓`
                      : item.category === 'cooking' ? `Offer to help — Earn ${item.duration_hours}h 🍳`
                      : `Offer to help — Earn ${item.duration_hours}h ⭐`}
                  </Text>
                </TouchableOpacity>
              )}
              {item.status === 'open' && isOwn && (
                <View style={styles.openOwnActions}>
                  <TouchableOpacity style={styles.editBtn} onPress={() => router.push({ pathname: '/edit-request', params: { requestId: item.id } })}>
                    <Text style={styles.editBtnText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => cancelRequest(item)}>
                    <Text style={styles.cancelBtnText}>Cancel Request</Text>
                  </TouchableOpacity>
                </View>
              )}
              {item.status === 'offered' && isOwn && (
                <View style={styles.offeredActions}>
                  <Text style={styles.offeredPrompt}>{item.fulfilling_family?.name} wants to help — approve to confirm!</Text>
                  <TouchableOpacity style={styles.approveBtn} onPress={() => approveOffer(item)}>
                    <Text style={styles.approveBtnText}>Approve ✓</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.declineBtn} onPress={() => declineOffer(item)}>
                    <Text style={styles.declineBtnText}>Decline offer</Text>
                  </TouchableOpacity>
                </View>
              )}
              {item.status === 'offered' && isFulfiller && (
                <TouchableOpacity style={styles.withdrawBtn} onPress={() => withdrawOffer(item)}>
                  <Text style={styles.withdrawBtnText}>Withdraw my offer</Text>
                </TouchableOpacity>
              )}
              {item.status === 'offered' && !isOwn && !isFulfiller && (
                <View style={styles.offeredElsewhere}><Text style={styles.offeredElsewhereText}>Offer pending approval</Text></View>
              )}
            </>
          )}

          {isOffering && (
            <>
              {item.status === 'open' && !isOwn && (
                <TouchableOpacity style={styles.claimBtn} onPress={() => claimOffering(item)}>
                  <Text style={styles.claimBtnText}>Claim this — costs {item.duration_hours}h 🙋</Text>
                </TouchableOpacity>
              )}
              {item.status === 'open' && isOwn && (
                <TouchableOpacity style={styles.cancelBtn} onPress={() => cancelRequest(item)}>
                  <Text style={styles.cancelBtnText}>Cancel Availability</Text>
                </TouchableOpacity>
              )}
              {item.status === 'offered' && isOwn && (
                <View style={styles.offeredActions}>
                  <Text style={styles.offeredPrompt}>{item.fulfilling_family?.name} wants your help — approve to confirm!</Text>
                  <TouchableOpacity style={styles.approveBtn} onPress={() => approveOfferingClaim(item)}>
                    <Text style={styles.approveBtnText}>Approve ✓</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.declineBtn} onPress={() => declineOffer(item)}>
                    <Text style={styles.declineBtnText}>Decline claim</Text>
                  </TouchableOpacity>
                </View>
              )}
              {item.status === 'offered' && isFulfiller && (
                <TouchableOpacity style={styles.withdrawBtn} onPress={() => withdrawClaim(item)}>
                  <Text style={styles.withdrawBtnText}>Withdraw my claim</Text>
                </TouchableOpacity>
              )}
              {item.status === 'offered' && !isOwn && !isFulfiller && (
                <View style={styles.offeredElsewhere}><Text style={styles.offeredElsewhereText}>Claim pending approval</Text></View>
              )}
            </>
          )}

          {item.status === 'accepted' && (isOwn || isFulfiller) && (
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
      </View>
    );
  };

  const statusFilters: { key: Filter; label: string }[] = [
    { key: 'open',     label: postType === 'offering' ? 'Available' : 'Open Requests' },
    { key: 'mine',     label: postType === 'offering' ? 'My Offers' : 'My Requests' },
    { key: 'upcoming', label: 'Upcoming' },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Requests</Text>
        <TouchableOpacity style={styles.newBtn} onPress={() => router.push('/new-request')}>
          <Text style={styles.newBtnText}>+ New</Text>
        </TouchableOpacity>
      </View>

      {/* Post type toggle */}
      <View style={styles.postTypeRow}>
        <TouchableOpacity style={[styles.postTypeBtn, postType === 'request' && styles.postTypeBtnActive]} onPress={() => switchPostType('request')}>
          <Text style={[styles.postTypeText, postType === 'request' && styles.postTypeTextActive]}>I need help</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.postTypeBtn, postType === 'offering' && styles.postTypeBtnActiveGreen]} onPress={() => switchPostType('offering')}>
          <Text style={[styles.postTypeText, postType === 'offering' && styles.postTypeTextActiveGreen]}>I can help</Text>
        </TouchableOpacity>
      </View>

      {/* Category filter */}
      <View style={styles.catRow}>
        <TouchableOpacity style={[styles.catChip, catFilter === 'all' && styles.catChipActive]} onPress={() => { setCatFilter('all'); setLoading(true); }}>
          <Text style={[styles.catChipText, catFilter === 'all' && styles.catChipTextActive]}>All</Text>
        </TouchableOpacity>
        {ALL_CATEGORIES.map(c => (
          <TouchableOpacity key={c.key} style={[styles.catChip, catFilter === c.key && styles.catChipActive]} onPress={() => { setCatFilter(c.key); setLoading(true); }}>
            <Text style={[styles.catChipText, catFilter === c.key && styles.catChipTextActive]}>{c.emoji} {c.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Status filter */}
      <View style={styles.filtersRow}>
        {statusFilters.map((f) => (
          <TouchableOpacity key={f.key} style={[styles.filterTab, filter === f.key && styles.filterTabActive]} onPress={() => { setFilter(f.key); setLoading(true); }}>
            <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>{f.label}</Text>
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
              <Text style={styles.emptyIcon}>{filter === 'upcoming' ? '🗓️' : postType === 'offering' ? '🙋' : '📭'}</Text>
              <Text style={styles.emptyText}>
                {filter === 'upcoming' ? 'Nothing upcoming yet'
                  : postType === 'offering' ? 'No availability posted yet'
                  : 'No requests here yet'}
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

  // Post type toggle
  postTypeRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginBottom: 10 },
  postTypeBtn: { flex: 1, paddingVertical: 9, borderRadius: 12, alignItems: 'center', borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
  postTypeBtnActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  postTypeBtnActiveGreen: { backgroundColor: colors.greenLight, borderColor: colors.green },
  postTypeText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  postTypeTextActive: { color: colors.primaryDark },
  postTypeTextActiveGreen: { color: '#059669' },

  // Category filter
  catRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 20, gap: 6, marginBottom: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  catChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.borderLight },
  catChipActive: { backgroundColor: colors.sage, borderColor: colors.sage },
  catChipText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  catChipTextActive: { color: '#fff' },

  // Status filter
  filtersRow: { flexDirection: 'row', paddingHorizontal: 20, gap: 8, marginBottom: 10, marginTop: 2 },
  filterTab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border },
  filterTabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  filterTextActive: { color: '#fff' },

  list: { paddingHorizontal: 20, paddingBottom: 32 },
  card: { backgroundColor: colors.card, borderRadius: 18, padding: 16, marginBottom: 12, borderWidth: 1.5, borderColor: colors.borderLight, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  cardOffering: { borderColor: colors.green + '60', borderWidth: 1.5 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text, flex: 1, marginRight: 8 },
  badge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  cardFamily: { fontSize: 13, color: colors.textSecondary, marginBottom: 8, fontWeight: '500' },
  cardMeta: { flexDirection: 'row', gap: 12, marginBottom: 8, flexWrap: 'wrap' },
  metaText: { fontSize: 13, color: colors.text, fontWeight: '500' },
  cardNotes: { fontSize: 13, color: colors.textSecondary, fontStyle: 'italic', marginBottom: 8 },
  catBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start', marginBottom: 8 },
  catBadgeText: { fontSize: 12, fontWeight: '700' },
  catDetailText: { fontSize: 13, color: colors.textSecondary, fontStyle: 'italic', marginBottom: 6 },
  overnightBadge: { backgroundColor: '#EDE9FE', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start', marginBottom: 8 },
  overnightBadgeText: { color: '#6D28D9', fontSize: 12, fontWeight: '700' },
  flexibleBadge: { backgroundColor: colors.sageLight, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start', marginBottom: 8 },
  flexibleBadgeText: { color: colors.sageDark, fontSize: 12, fontWeight: '700' },
  contactBox: { backgroundColor: colors.sageLight, borderRadius: 12, padding: 12, marginVertical: 8, borderWidth: 1, borderColor: colors.sage + '40' },
  contactTitle: { fontSize: 11, fontWeight: '700', color: colors.sageDark, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  contactName: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 4 },
  contactLine: { fontSize: 13, color: colors.text, fontWeight: '500', marginBottom: 2 },
  cardActions: { marginTop: 6 },

  // Action buttons
  offerBtn: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center', shadowColor: colors.primary, shadowOpacity: 0.2, shadowRadius: 6, elevation: 2 },
  offerBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  claimBtn: { backgroundColor: colors.green, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  claimBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  openOwnActions: { gap: 8 },
  editBtn: { borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  editBtnText: { color: colors.text, fontWeight: '700', fontSize: 14 },
  cancelBtn: { borderWidth: 1.5, borderColor: '#FCA5A5', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  cancelBtnText: { color: colors.red, fontWeight: '700', fontSize: 14 },
  offeredActions: { gap: 8 },
  offeredPrompt: { fontSize: 13, color: colors.text, fontWeight: '600', marginBottom: 4, textAlign: 'center' },
  approveBtn: { backgroundColor: colors.green, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  approveBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  declineBtn: { borderWidth: 1.5, borderColor: '#FCA5A5', borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  declineBtnText: { color: colors.red, fontWeight: '600', fontSize: 13 },
  withdrawBtn: { borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  withdrawBtnText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
  offeredElsewhere: { backgroundColor: colors.borderLight, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  offeredElsewhereText: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
  acceptedActions: { gap: 8 },
  completeBtn: { backgroundColor: colors.greenLight, borderRadius: 12, paddingVertical: 12, alignItems: 'center', borderWidth: 1.5, borderColor: colors.green },
  completeBtnText: { color: '#059669', fontWeight: '700', fontSize: 14 },
  backOutBtn: { borderWidth: 1.5, borderColor: '#FCA5A5', borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  backOutBtnText: { color: colors.red, fontWeight: '600', fontSize: 13 },

  empty: { alignItems: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, color: colors.textMuted, fontWeight: '500' },
});
