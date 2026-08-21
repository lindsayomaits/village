import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity, Image,
  RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Text } from '../../components/Text';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors } from '../../lib/theme';
import { getFamilyAnimal } from '../../lib/animals';
import { getPendingBreakdown } from '../../lib/hours';
import type { Request, RequestCategory } from '../../types';

function postStatusInfo(status: Request['status']): { label: string; color: string; bg: string } {
  if (status === 'accepted' || status === 'completed') return { label: 'Accepted', color: colors.blue, bg: colors.blueLight };
  if (status === 'offered') return { label: 'Pending', color: colors.amber, bg: colors.amberLight };
  return { label: 'Available', color: colors.sageDark, bg: colors.greenLight };
}

const HELP_CATEGORY_LABELS: Record<RequestCategory, { emoji: string; label: string }> = {
  kid_sit:           { emoji: '👧', label: 'Kid-sitting' },
  dog:               { emoji: '🐾', label: 'Pet care' },
  manual_labor:      { emoji: '🔨', label: 'Manual labor' },
  professional:      { emoji: '🎓', label: 'Professional help' },
  cooking:           { emoji: '🍳', label: 'Cooking' },
  elder_care:        { emoji: '🤝', label: 'Elder care' },
  physical_training: { emoji: '🏃', label: 'Fitness' },
  errands:           { emoji: '🛒', label: 'Errands' },
};

export default function HomeScreen() {
  const { family, refreshFamily } = useAuth();
  const router = useRouter();
  const [myItems, setMyItems] = useState<Request[]>([]);
  const [pendingIncoming, setPendingIncoming] = useState(0);
  const [pendingOutgoing, setPendingOutgoing] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [onboardingSeen, setOnboardingSeen] = useState(true);
  const alertedConnectionIds = useRef<Set<string>>(new Set());

  // The onboarding banner is meant for a brand-new user's first visit —
  // once they've seen the home screen once, it stops reappearing even if
  // they never finished filling in their profile.
  useEffect(() => {
    if (!family?.id) return;
    const key = `onboarding_seen_${family.id}`;
    AsyncStorage.getItem(key).then(seen => {
      if (seen) {
        setOnboardingSeen(true);
      } else {
        setOnboardingSeen(false);
        AsyncStorage.setItem(key, 'true');
      }
    });
  }, [family?.id]);

  async function checkPendingConnections() {
    if (!family) return;
    const { data } = await supabase
      .from('connections')
      .select('id, requester_id, requester:families!requester_id(name)')
      .eq('status', 'pending')
      .eq('recipient_id', family.id);

    const fresh = (data ?? []).filter(c => !alertedConnectionIds.current.has(c.id));
    if (fresh.length === 0) return;
    fresh.forEach(c => alertedConnectionIds.current.add(c.id));

    if (fresh.length === 1) {
      const requesterName = (fresh[0].requester as unknown as { name: string } | null)?.name ?? 'Someone';
      Alert.alert(
        'New connection request',
        `${requesterName} wants to connect with you.`,
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Review', onPress: () => router.push({ pathname: '/(tabs)/members', params: { tab: 'pending' } }) },
        ]
      );
    } else {
      Alert.alert(
        'New connection requests',
        `${fresh.length} people want to connect with you.`,
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Review', onPress: () => router.push({ pathname: '/(tabs)/members', params: { tab: 'pending' } }) },
        ]
      );
    }
  }

  async function loadData() {
    const today = new Date().toISOString().split('T')[0];
    const { data: reqs } = family
      ? await supabase
          .from('requests')
          .select('*, requesting_family:families!requesting_family_id(*), fulfilling_family:families!fulfilling_family_id(*)')
          .eq('post_type', 'request')
          .or(`requesting_family_id.eq.${family.id},fulfilling_family_id.eq.${family.id}`)
          .in('status', ['open', 'offered', 'accepted'])
          .gte('date', today)
          .order('date', { ascending: true })
      : { data: [] };
    setMyItems(reqs ?? []);
    setLoading(false);
    if (family) {
      const { incoming, outgoing } = await getPendingBreakdown(family.id);
      setPendingIncoming(incoming);
      setPendingOutgoing(outgoing);
    }
  }

  useFocusEffect(useCallback(() => {
    loadData();
    checkPendingConnections();
    // Balance can change from outside this screen (admin adjustment,
    // settlement, a gift) — refetch the auth family on every focus so the
    // hour bank doesn't show a stale number until a manual pull-to-refresh.
    refreshFamily();
  }, [family?.id]));

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([loadData(), refreshFamily()]);
    setRefreshing(false);
  }

  const balance = family?.hours_balance ?? 0;
  const balanceColor = balance < 0 ? colors.red : balance <= 3 ? colors.amber : '#fff';

  const myRequests = myItems.filter(r => r.requesting_family_id === family?.id);
  const myRequestsOpen = myRequests.filter(r => r.status === 'open');
  const myRequestsPending = myRequests.filter(r => r.status === 'offered');
  const myRequestsScheduled = myRequests.filter(r => r.status === 'accepted');

  const helpingPending = myItems.filter(r => r.fulfilling_family_id === family?.id && r.status === 'offered');
  const helpingScheduled = myItems.filter(r => r.fulfilling_family_id === family?.id && r.status === 'accepted');
  const comingUp = Array.from(new Map(
    [...myRequestsScheduled, ...helpingScheduled].map(r => [r.id, r])
  ).values());
  const servicesOffered = (family?.services_offered ?? []) as RequestCategory[];

  const isNewUser = (!family?.parent1_name || !family?.parent1_phone) && !onboardingSeen;

  function formatDate(dateStr: string) {
    const d = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.sage} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerBrandRow}>
            <Image source={require('../../assets/icon.png')} style={styles.headerLogo} />
            <View>
              <Text style={styles.greeting}>
                Hi, {family?.name ?? 'there'}
              </Text>
              <Text style={styles.subGreeting}>VillageMates</Text>
            </View>
          </View>
        </View>

        {/* Onboarding banner — only for new users */}
        {isNewUser && (
          <View style={styles.onboardingCard}>
            <Image source={require('../../assets/icon.png')} style={styles.onboardingLogo} />
            <Text style={styles.onboardingTitle}>Welcome to VillageMates!</Text>
            <Text style={styles.onboardingBody}>
              You start with 10 hours. Add your name, phone, and kids so other people know who you are.
            </Text>
            <TouchableOpacity
              style={styles.onboardingBtn}
              onPress={() => router.push('/(tabs)/profile')}
            >
              <Text style={styles.onboardingBtnText}>Set up your profile →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Balance Card */}
        <TouchableOpacity activeOpacity={0.85} onPress={() => router.push('/history')}>
          <LinearGradient
            colors={[colors.sage, colors.sageDark]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.balanceCard}
          >
            <View style={styles.balanceCardInner}>
              <Text style={styles.balanceLabel}>Your Hour Bank</Text>
              <View style={styles.balanceNumberRow}>
                <Text style={[styles.balanceNumber, { color: balanceColor }]} numberOfLines={1} adjustsFontSizeToFit>
                  {balance}h
                </Text>
                <Text style={styles.balanceAvailableLabel}>available</Text>
              </View>
              {(pendingIncoming !== 0 || pendingOutgoing !== 0) && (
                <View style={styles.balancePendingRows}>
                  {pendingIncoming !== 0 && (
                    <View style={styles.balancePendingRow}>
                      <Text style={styles.balancePendingLine}>🕐 +{pendingIncoming}h on the way</Text>
                      <Text style={styles.balancePendingHint}>When others accept your help</Text>
                    </View>
                  )}
                  {pendingOutgoing !== 0 && (
                    <View style={styles.balancePendingRow}>
                      <Text style={styles.balancePendingLine}>✨ -{pendingOutgoing}h possible</Text>
                      <Text style={styles.balancePendingHint}>If your requests are fulfilled</Text>
                    </View>
                  )}
                </View>
              )}
              <Text style={styles.balanceSub}>
                {balance === -20
                  ? 'Balance limit reached — babysit for someone to earn more'
                  : balance < 0
                  ? `${20 + balance}h until you hit the -20h limit`
                  : `You have ${balance + 20}h of requesting power`}
              </Text>
              <View style={styles.progressBarBg}>
                <View style={[
                  styles.progressBarFill,
                  { width: `${Math.max(4, Math.min(100, ((balance + 20) / 20) * 50))}%` },
                ]} />
              </View>
              <View style={styles.progressLabels}>
                <Text style={styles.progressLabel}>-20h limit</Text>
                <Text style={styles.progressLabel}>No upper limit</Text>
              </View>
              <Text style={styles.balanceHistoryHint}>View history →</Text>
            </View>
          </LinearGradient>
        </TouchableOpacity>

        {/* Quick actions */}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.actionPrimary} onPress={() => router.push('/(tabs)/requests')}>
            <Text style={styles.actionPrimaryText}>Browse Requests</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionSecondary} onPress={() => router.push('/new-request')}>
            <Text style={styles.actionSecondaryText}>+ New Request</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.sage} style={{ marginTop: 20 }} />
        ) : (
          <>
            {/* What is happening soon, regardless of whether I'm helping or being helped */}
            {comingUp.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Coming Up</Text>
                {comingUp.map(r => {
                  const isHelping = r.fulfilling_family_id === family?.id;
                  const relatedName = isHelping ? r.requesting_family?.name : r.fulfilling_family?.name;
                  const helperText = isHelping
                    ? `You’re helping ${relatedName ?? 'someone'}`
                    : `${relatedName ?? 'Someone'} is helping you`;

                  return (
                    <TouchableOpacity key={r.id} style={[styles.itemCard, isHelping ? styles.sitCard : styles.itemCardAccepted]} onPress={() => router.push(`/request/${r.id}`)}>
                      <View style={styles.itemCardLeft}>
                        <Text style={styles.itemAnimal}>
                          {getFamilyAnimal(r.requesting_family_id, r.requesting_family?.animal ?? null)}
                        </Text>
                        <View style={styles.itemInfo}>
                          <Text style={styles.itemTitle}>{r.title}</Text>
                          <Text style={styles.itemSub}>{helperText}</Text>
                          <Text style={styles.itemDate}>{formatDate(r.date)} at {r.start_time}</Text>
                        </View>
                      </View>
                      {!isHelping && (
                        <View style={styles.earnBadge}>
                          <Text style={styles.earnBadgeText}>+{r.duration_hours}h</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </>
            )}

            {/* Requests I created because I need help */}
            {myRequestsOpen.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>My Requests</Text>
                <Text style={styles.sectionSubtitle}>Open</Text>
                {myRequestsOpen.map(r => (
                  <TouchableOpacity
                    key={r.id}
                    style={[styles.itemCard, styles.itemCardOpen]}
                    onPress={() => router.push(`/request/${r.id}`)}
                  >
                    <View style={styles.itemCardLeft}>
                      <View style={styles.pillStack}>
                        <View style={[styles.postTypePill, { backgroundColor: postStatusInfo(r.status).bg }]}>
                          <Text style={[styles.postTypePillText, { color: postStatusInfo(r.status).color }]}>{postStatusInfo(r.status).label}</Text>
                        </View>
                      </View>
                      <View style={styles.itemInfo}>
                        <Text style={styles.itemTitle}>{r.title}</Text>
                        <Text style={styles.itemSub}>No helper yet</Text>
                        <Text style={styles.itemDate}>{formatDate(r.date)} at {r.start_time}</Text>
                      </View>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {myRequestsPending.length > 0 && (
              <>
                <Text style={styles.sectionSubtitle}>Pending</Text>
                {myRequestsPending.map(r => (
                  <TouchableOpacity
                    key={r.id}
                    style={[styles.itemCard, styles.itemCardPending]}
                    onPress={() => router.push(`/request/${r.id}`)}
                  >
                    <View style={styles.itemCardLeft}>
                      <View style={styles.pillStack}>
                        <View style={[styles.postTypePill, { backgroundColor: postStatusInfo(r.status).bg }]}>
                          <Text style={[styles.postTypePillText, { color: postStatusInfo(r.status).color }]}>{postStatusInfo(r.status).label}</Text>
                        </View>
                      </View>
                      <View style={styles.itemInfo}>
                        <Text style={styles.itemTitle}>{r.title}</Text>
                        <Text style={styles.itemSub}>{r.fulfilling_family?.name} offered to help</Text>
                        <Text style={styles.itemDate}>{formatDate(r.date)} at {r.start_time}</Text>
                      </View>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {myRequestsScheduled.length > 0 && (
              <>
                <Text style={styles.sectionSubtitle}>Scheduled</Text>
                {myRequestsScheduled.map(r => (
                  <TouchableOpacity
                    key={r.id}
                    style={[styles.itemCard, styles.itemCardAccepted]}
                    onPress={() => router.push(`/request/${r.id}`)}
                  >
                    <View style={styles.itemCardLeft}>
                      <View style={styles.pillStack}>
                        <View style={[styles.postTypePill, { backgroundColor: postStatusInfo(r.status).bg }]}>
                          <Text style={[styles.postTypePillText, { color: postStatusInfo(r.status).color }]}>{postStatusInfo(r.status).label}</Text>
                        </View>
                      </View>
                      <View style={styles.itemInfo}>
                        <Text style={styles.itemTitle}>{r.title}</Text>
                        <Text style={styles.itemSub}>{r.fulfilling_family?.name} is confirmed to help you</Text>
                        <Text style={styles.itemDate}>{formatDate(r.date)} at {r.start_time}</Text>
                      </View>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {/* Requests created by others that I offered to help with */}
            {helpingPending.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>I’m Helping</Text>
                <Text style={styles.sectionSubtitle}>Pending</Text>
                {helpingPending.map(r => (
                  <TouchableOpacity
                    key={r.id}
                    style={[styles.itemCard, styles.itemCardPending]}
                    onPress={() => router.push(`/request/${r.id}`)}
                  >
                    <View style={styles.itemCardLeft}>
                      <View style={styles.pillStack}>
                        <View style={[styles.postTypePill, { backgroundColor: postStatusInfo(r.status).bg }]}>
                          <Text style={[styles.postTypePillText, { color: postStatusInfo(r.status).color }]}>{postStatusInfo(r.status).label}</Text>
                        </View>
                      </View>
                      <View style={styles.itemInfo}>
                        <Text style={styles.itemTitle}>{r.title}</Text>
                        <Text style={styles.itemSub}>You offered to help {r.requesting_family?.name}</Text>
                        <Text style={styles.itemDate}>{formatDate(r.date)} at {r.start_time}</Text>
                      </View>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {helpingScheduled.length > 0 && (
              <>
                <Text style={styles.sectionSubtitle}>Scheduled</Text>
                {helpingScheduled.map(r => (
                  <TouchableOpacity
                    key={r.id}
                    style={[styles.itemCard, styles.sitCard]}
                    onPress={() => router.push(`/request/${r.id}`)}
                  >
                    <View style={styles.itemCardLeft}>
                      <View style={styles.pillStack}>
                        <View style={[styles.postTypePill, { backgroundColor: postStatusInfo(r.status).bg }]}>
                          <Text style={[styles.postTypePillText, { color: postStatusInfo(r.status).color }]}>{postStatusInfo(r.status).label}</Text>
                        </View>
                      </View>
                      <View style={styles.itemInfo}>
                        <Text style={styles.itemTitle}>{r.title}</Text>
                        <Text style={styles.itemSub}>You’re confirmed to help {r.requesting_family?.name}</Text>
                        <Text style={styles.itemDate}>{formatDate(r.date)} at {r.start_time}</Text>
                      </View>
                    </View>
                    <View style={styles.earnBadge}>
                      <Text style={styles.earnBadgeText}>+{r.duration_hours}h</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </>
            )}
          </>
        )}

        {/* What I'm offering to help with */}
        <View style={styles.offerCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.offerLabel}>You're open to helping with</Text>
            {servicesOffered.length === 0 ? (
              <Text style={styles.offerEmpty}>Nothing set yet — add what you're willing to help with in your profile.</Text>
            ) : (
              <View style={styles.offerChips}>
                {servicesOffered.map(key => (
                  <View key={key} style={styles.offerChip}>
                    <Text style={styles.offerChipText}>{HELP_CATEGORY_LABELS[key]?.emoji} {HELP_CATEGORY_LABELS[key]?.label ?? key}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
          <TouchableOpacity onPress={() => router.push('/(tabs)/profile')}>
            <Text style={styles.offerEditLink}>Edit</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: 20, paddingBottom: 32 },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, marginBottom: 20 },
  headerBrandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerLogo: { width: 38, height: 38, borderRadius: 9 },
  greeting: { fontSize: 22, fontWeight: '800', color: colors.text },
  subGreeting: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },

  onboardingCard: {
    backgroundColor: colors.primaryLight, borderRadius: 20, padding: 20,
    marginBottom: 16, borderWidth: 1.5, borderColor: colors.primary + '40',
    alignItems: 'center',
  },
  onboardingLogo: { width: 44, height: 44, marginBottom: 8, borderRadius: 10 },
  onboardingTitle: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 6, textAlign: 'center' },
  onboardingBody: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  onboardingBtn: {
    backgroundColor: colors.primary, borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12,
    shadowColor: colors.primary, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  onboardingBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  balanceCard: {
    borderRadius: 24, marginBottom: 16,
    shadowColor: colors.sageDark, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  balanceCardInner: { padding: 26 },
  balanceLabel: { fontSize: 13, color: 'rgba(255,255,255,0.75)', fontWeight: '600', marginBottom: 4 },
  balanceNumberRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  balanceNumber: { fontSize: 52, fontWeight: '800', flexShrink: 1 },
  balanceAvailableLabel: { fontSize: 15, fontWeight: '600', color: 'rgba(255,255,255,0.75)' },
  balancePendingRows: { gap: 8, marginBottom: 12 },
  balancePendingRow: { gap: 1 },
  balancePendingLine: { fontSize: 14, color: 'rgba(255,255,255,0.92)', fontWeight: '700' },
  balancePendingHint: { fontSize: 12, color: 'rgba(255,255,255,0.65)', fontWeight: '500' },
  balanceSub: { fontSize: 13, color: 'rgba(255,255,255,0.7)', marginBottom: 18 },
  balanceHistoryHint: { fontSize: 12, color: 'rgba(255,255,255,0.55)', fontWeight: '600', marginTop: 12, textAlign: 'right' },
  progressBarBg: { height: 6, backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 3, overflow: 'hidden' },
  progressBarFill: { height: '100%', borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.85)' },
  progressLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  progressLabel: { fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: '500' },

  actions: { flexDirection: 'row', gap: 12, marginBottom: 28 },
  actionPrimary: {
    flex: 1, backgroundColor: colors.primary, borderRadius: 16, paddingVertical: 16, alignItems: 'center',
    shadowColor: colors.primary, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  actionPrimaryText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  actionSecondary: {
    flex: 1, backgroundColor: colors.card, borderRadius: 16, paddingVertical: 16, alignItems: 'center',
    borderWidth: 1.5, borderColor: colors.border,
  },
  actionSecondaryText: { fontSize: 14, fontWeight: '700', color: colors.text },

  offerCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: colors.sageLight, borderRadius: 16, padding: 16, marginBottom: 20,
    borderWidth: 1.5, borderColor: colors.sage + '40',
  },
  offerLabel: { fontSize: 13, fontWeight: '700', color: colors.sageDark, marginBottom: 8 },
  offerEmpty: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  offerChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  offerChip: { backgroundColor: colors.card, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: colors.sage + '50' },
  offerChipText: { fontSize: 12, fontWeight: '600', color: colors.text },
  offerEditLink: { fontSize: 13, fontWeight: '700', color: colors.primary },

  sectionTitle: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 10, marginTop: 4 },
  sectionSubtitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    marginTop: 2,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },

  itemCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.card, borderRadius: 16, padding: 14, marginBottom: 10,
    borderWidth: 1.5, borderColor: colors.borderLight,
  },
  sitCard: { borderColor: colors.sage + '60', backgroundColor: colors.sageLight },
  itemCardOpen: { borderColor: colors.green + '60' },
  itemCardPending: { borderColor: colors.amber, backgroundColor: colors.amberLight },
  itemCardAccepted: { borderColor: colors.blue, backgroundColor: colors.blueLight },
  itemCardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  pillStack: { gap: 4, marginRight: 10, alignItems: 'flex-start' },
  postTypePill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start' },
  postTypePillText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  itemAnimal: { fontSize: 28, marginRight: 12 },
  itemStatusEmoji: { fontSize: 22, marginRight: 12 },
  itemInfo: { flex: 1 },
  itemTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 2 },
  itemSub: { fontSize: 13, color: colors.textSecondary, fontWeight: '500', marginBottom: 2 },
  itemDate: { fontSize: 12, color: colors.textMuted, fontWeight: '500' },
  earnBadge: {
    backgroundColor: colors.sage, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5,
  },
  earnBadgeText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  chevron: { fontSize: 22, color: colors.textMuted, marginLeft: 8 },
});
