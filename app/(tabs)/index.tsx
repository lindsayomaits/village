import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity, Image,
  RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Text } from '../../components/Text';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors } from '../../lib/theme';
import { getFamilyAnimal } from '../../lib/animals';
import { getPendingBreakdown } from '../../lib/hours';
import { StatusBadge } from '../../components/StatusBadge';
import { HourBalanceCard } from '../../components/HourBalanceCard';
import { OnboardingIntro } from '../../components/OnboardingIntro';
import { HomeItemRow } from '../../components/HomeItemRow';
import type { Request, RequestCategory } from '../../types';


export default function HomeScreen() {
  const { family, refreshFamily } = useAuth();
  const router = useRouter();
  const [myItems, setMyItems] = useState<Request[]>([]);
  const [pendingIncoming, setPendingIncoming] = useState(0);
  const [pendingOutgoing, setPendingOutgoing] = useState(0);
  const [pendingIncomingCount, setPendingIncomingCount] = useState(0);
  const [pendingOutgoingCount, setPendingOutgoingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [onboardingSeen, setOnboardingSeen] = useState(true);
  const [showIntro, setShowIntro] = useState(false);
  const alertedConnectionIds = useRef<Set<string>>(new Set());

  // The onboarding banner is meant for a brand-new user's first visit —
  // once they've seen the home screen once, it stops reappearing even if
  // they never finished filling in their profile. The same "haven't seen
  // Home before" moment is also the right time to show the two-screen
  // intro (what the app is, how hours work) — same check, same key.
  useEffect(() => {
    if (!family?.id) return;
    const key = `onboarding_seen_${family.id}`;
    AsyncStorage.getItem(key).then(seen => {
      if (seen) {
        setOnboardingSeen(true);
      } else {
        setOnboardingSeen(false);
        setShowIntro(true);
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
    // No date filter here — an open or pending request whose date already
    // passed without being resolved still needs attention, not silence.
    // "Coming Up" filters to upcoming itself, further down.
    const { data: reqs } = family
      ? await supabase
          .from('requests')
          .select('*, requesting_family:families!requesting_family_id(*), fulfilling_family:families!fulfilling_family_id(*)')
          .eq('post_type', 'request')
          .or(`requesting_family_id.eq.${family.id},fulfilling_family_id.eq.${family.id}`)
          .in('status', ['open', 'offered', 'accepted'])
          .order('date', { ascending: true })
      : { data: [] };
    setMyItems(reqs ?? []);
    setLoading(false);
    if (family) {
      const breakdown = await getPendingBreakdown(family.id);
      setPendingIncoming(breakdown.incoming);
      setPendingOutgoing(breakdown.outgoing);
      setPendingIncomingCount(breakdown.incomingCount);
      setPendingOutgoingCount(breakdown.outgoingCount);
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

  const myRequests = myItems.filter(r => r.requesting_family_id === family?.id);
  const myRequestsOpen = myRequests.filter(r => r.status === 'open');
  const myRequestsPending = myRequests.filter(r => r.status === 'offered');
  const myRequestsScheduled = myRequests.filter(r => r.status === 'accepted');

  const helpingPending = myItems.filter(r => r.fulfilling_family_id === family?.id && r.status === 'offered');
  const helpingScheduled = myItems.filter(r => r.fulfilling_family_id === family?.id && r.status === 'accepted');
  const today = new Date().toISOString().split('T')[0];
  // Multi-day (overnight) items aren't "past" until their end date, not
  // their start/drop-off date.
  const comingUp = Array.from(new Map(
    [...myRequestsScheduled, ...helpingScheduled]
      .filter(r => (r.end_date ?? r.date) >= today)
      .map(r => [r.id, r])
  ).values());

  const isNewUser = (!family?.parent1_name || !family?.parent1_phone) && !onboardingSeen;

  function formatDate(dateStr: string) {
    const d = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function metaLine(r: Request) {
    return `${formatDate(r.date).toUpperCase()} · ${r.start_time} · ${r.duration_hours}H`;
  }

  return (
    <>
    <OnboardingIntro visible={showIntro} onDone={() => setShowIntro(false)} />
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
        <HourBalanceCard
          balance={balance}
          pendingIncoming={pendingIncoming}
          pendingOutgoing={pendingOutgoing}
          pendingIncomingCount={pendingIncomingCount}
          pendingOutgoingCount={pendingOutgoingCount}
          onPress={() => router.push('/history')}
        />

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
                  return (
                    <HomeItemRow
                      key={r.id}
                      animalEmoji={getFamilyAnimal(r.requesting_family_id, r.requesting_family?.animal ?? null)}
                      title={r.title}
                      subtitle={isHelping ? `You're helping ${relatedName ?? 'someone'}` : `${relatedName ?? 'Someone'} is helping you`}
                      meta={metaLine(r)}
                      amountText={`${isHelping ? '+' : '-'}${r.duration_hours}h`}
                      earning={isHelping}
                      accentColor={isHelping ? colors.sage : colors.primary}
                      onPress={() => router.push(`/request/${r.id}`)}
                    />
                  );
                })}
              </>
            )}

            {/* Requests I created because I need help */}
            {myRequestsOpen.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>My Requests</Text>
                {myRequestsOpen.map(r => (
                  <HomeItemRow
                    key={r.id}
                    animalEmoji={getFamilyAnimal(r.requesting_family_id, r.requesting_family?.animal ?? null)}
                    title={r.title}
                    subtitle="No helper yet"
                    meta={metaLine(r)}
                    statusPill={<StatusBadge status={r.status} />}
                    accentColor={colors.border}
                    onPress={() => router.push(`/request/${r.id}`)}
                  />
                ))}
              </>
            )}

            {myRequestsPending.length > 0 && (
              <>
                {myRequestsOpen.length === 0 && <Text style={styles.sectionTitle}>My Requests</Text>}
                {myRequestsPending.map(r => (
                  <HomeItemRow
                    key={r.id}
                    animalEmoji={getFamilyAnimal(r.fulfilling_family_id ?? r.requesting_family_id, r.fulfilling_family?.animal ?? null)}
                    title={r.title}
                    subtitle={`${r.fulfilling_family?.name} offered to help`}
                    meta={metaLine(r)}
                    statusPill={<StatusBadge status={r.status} />}
                    amountText={`-${r.duration_hours}h`}
                    earning={false}
                    accentColor={colors.amber}
                    onPress={() => router.push(`/request/${r.id}`)}
                  />
                ))}
              </>
            )}

            {/* Requests created by others that I offered to help with */}
            {helpingPending.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>I'm Helping</Text>
                {helpingPending.map(r => (
                  <HomeItemRow
                    key={r.id}
                    animalEmoji={getFamilyAnimal(r.requesting_family_id, r.requesting_family?.animal ?? null)}
                    title={r.title}
                    subtitle={`You offered to help ${r.requesting_family?.name}`}
                    meta={metaLine(r)}
                    statusPill={<StatusBadge status={r.status} />}
                    amountText={`+${r.duration_hours}h`}
                    earning={true}
                    accentColor={colors.amber}
                    onPress={() => router.push(`/request/${r.id}`)}
                  />
                ))}
              </>
            )}
          </>
        )}

      </ScrollView>
    </SafeAreaView>
    </>
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

  actions: { flexDirection: 'row', gap: 14, marginBottom: 28 },
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


  sectionTitle: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 10, marginTop: 4 },
});
