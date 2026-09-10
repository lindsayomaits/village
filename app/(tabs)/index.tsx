import { useState, useCallback, useEffect } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity, Image,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Text } from '../../components/Text';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors } from '../../lib/theme';
import { getFamilyAnimal } from '../../lib/animals';
import { getPendingBreakdown } from '../../lib/hours';
import { useUnreadNotifications } from '../../lib/useUnreadNotifications';
import { StatusBadge } from '../../components/StatusBadge';
import { HourBalanceCard } from '../../components/HourBalanceCard';
import { OnboardingIntro } from '../../components/OnboardingIntro';
import { HomeItemRow } from '../../components/HomeItemRow';
import type { Request } from '../../types';


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
  const [showIntro, setShowIntro] = useState(false);
  const { count: unreadNotifications } = useUnreadNotifications(family?.id);

  // The two-screen intro (what the app is, how hours work) shows once, the
  // first time this family reaches Home. The "finish your profile" banner
  // below is separate — it keeps showing until the profile is actually
  // filled in, rather than vanishing after this one moment.
  useEffect(() => {
    if (!family?.id) return;
    const key = `onboarding_seen_${family.id}`;
    AsyncStorage.getItem(key).then(seen => {
      if (!seen) {
        setShowIntro(true);
        AsyncStorage.setItem(key, 'true');
      }
    });
  }, [family?.id]);

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

  const isNewUser = !family?.parent1_name || !family?.parent1_phone;

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
          <TouchableOpacity
            style={styles.bellBtn}
            onPress={() => router.push('/notifications')}
            accessibilityRole="button"
            accessibilityLabel={unreadNotifications > 0 ? `Notifications, ${unreadNotifications} unread` : 'Notifications'}
          >
            <Ionicons name="notifications-outline" size={24} color={colors.text} />
            {unreadNotifications > 0 && (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>{unreadNotifications > 9 ? '9+' : unreadNotifications}</Text>
              </View>
            )}
          </TouchableOpacity>
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
  bellBtn: { padding: 6 },
  bellBadge: {
    position: 'absolute', top: 0, right: 0, minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  bellBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },

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
