import { useState, useCallback } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity, Image,
  RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Text } from '../../components/Text';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors } from '../../lib/theme';
import { getFamilyAnimal } from '../../lib/animals';
import type { Request } from '../../types';

export default function HomeScreen() {
  const { family, signOut, refreshFamily } = useAuth();
  const router = useRouter();
  const [myItems, setMyItems] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function loadData() {
    const today = new Date().toISOString().split('T')[0];
    const { data: reqs } = family
      ? await supabase
          .from('requests')
          .select('*, requesting_family:families!requesting_family_id(*), fulfilling_family:families!fulfilling_family_id(*)')
          .or(`requesting_family_id.eq.${family.id},fulfilling_family_id.eq.${family.id}`)
          .in('status', ['open', 'accepted'])
          .gte('date', today)
          .order('date', { ascending: true })
      : { data: [] };
    setMyItems(reqs ?? []);
    setLoading(false);
  }

  useFocusEffect(useCallback(() => {
    loadData();
  }, [family?.id]));

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([loadData(), refreshFamily()]);
    setRefreshing(false);
  }

  const balance = family?.hours_balance ?? 0;
  const balanceColor = balance < 0 ? colors.red : balance <= 3 ? colors.amber : '#fff';

  const myRequests = myItems.filter(r => r.requesting_family_id === family?.id);
  const mySits = myItems.filter(r => r.fulfilling_family_id === family?.id);

  const isNewUser = !family?.parent1_name || !family?.parent1_phone;

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
                Hi, {family?.name ?? 'there'} {getFamilyAnimal(family?.id ?? '', family?.animal ?? null)}
              </Text>
              <Text style={styles.subGreeting}>VillageMates</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.signOutBtn}
            onPress={() => Alert.alert('Sign out?', undefined, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign Out', style: 'destructive', onPress: signOut },
            ])}
          >
            <Text style={styles.signOutText}>Sign out</Text>
          </TouchableOpacity>
        </View>

        {/* Onboarding banner — only for new users */}
        {isNewUser && (
          <View style={styles.onboardingCard}>
            <Image source={require('../../assets/icon.png')} style={styles.onboardingLogo} />
            <Text style={styles.onboardingTitle}>Welcome to VillageMates!</Text>
            <Text style={styles.onboardingBody}>
              You start with 10 hours. Add your name, phone, and kids so other households know who you are.
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
              <Text style={[styles.balanceNumber, { color: balanceColor }]}>
                {balance > 0 ? '+' : ''}{balance}h
              </Text>
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
            {/* My upcoming sits (I'm the sitter) */}
            {mySits.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Your Upcoming Sits</Text>
                {mySits.map(r => (
                  <View key={r.id} style={[styles.itemCard, styles.sitCard]}>
                    <View style={styles.itemCardLeft}>
                      <Text style={styles.itemAnimal}>
                        {getFamilyAnimal(r.requesting_family_id, r.requesting_family?.animal ?? null)}
                      </Text>
                      <View style={styles.itemInfo}>
                        <Text style={styles.itemTitle}>{r.title}</Text>
                        <Text style={styles.itemSub}>
                          Watching {r.requesting_family?.name} · {r.duration_hours}h
                        </Text>
                        <Text style={styles.itemDate}>{formatDate(r.date)} at {r.start_time}</Text>
                      </View>
                    </View>
                    <View style={styles.earnBadge}>
                      <Text style={styles.earnBadgeText}>+{r.duration_hours}h</Text>
                    </View>
                  </View>
                ))}
              </>
            )}

            {/* My open & accepted posts (I'm the requester or offerer) */}
            {myRequests.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>My Posts</Text>
                {myRequests.map(r => {
                  const isOffer = r.post_type === 'offering';
                  return (
                    <TouchableOpacity
                      key={r.id}
                      style={[
                        styles.itemCard,
                        isOffer ? styles.itemCardOffer : styles.itemCardRequest,
                        r.status === 'accepted' && (isOffer ? styles.itemCardOfferAccepted : styles.itemCardAccepted),
                      ]}
                      onPress={() => router.push('/(tabs)/requests')}
                    >
                      <View style={styles.itemCardLeft}>
                        <View style={[styles.postTypePill, { backgroundColor: isOffer ? colors.sage : colors.primary }]}>
                          <Text style={styles.postTypePillText}>{isOffer ? 'I can help' : 'I need help'}</Text>
                        </View>
                        <View style={styles.itemInfo}>
                          <Text style={styles.itemTitle}>{r.title}</Text>
                          <Text style={styles.itemSub}>
                            {isOffer
                              ? r.status === 'accepted' ? `Claimed by ${r.fulfilling_family?.name}` : 'Open for claims'
                              : r.status === 'accepted' ? `${r.fulfilling_family?.name} is covering this` : 'Waiting for someone in your network'}
                          </Text>
                          <Text style={styles.itemDate}>
                            {isOffer
                              ? `From ${formatDate(r.date)} · ${r.start_time}`
                              : `${formatDate(r.date)} at ${r.start_time}`}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.chevron}>›</Text>
                    </TouchableOpacity>
                  );
                })}
              </>
            )}
          </>
        )}
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
  signOutBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
  signOutText: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },

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
  balanceNumber: { fontSize: 62, fontWeight: '800', marginBottom: 4 },
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

  sectionTitle: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 10, marginTop: 4 },

  itemCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.card, borderRadius: 16, padding: 14, marginBottom: 10,
    borderWidth: 1.5, borderColor: colors.borderLight,
  },
  sitCard: { borderColor: colors.sage + '60', backgroundColor: colors.sageLight },
  itemCardRequest: { borderColor: colors.primary + '50' },
  itemCardOffer: { borderColor: colors.sage + '60' },
  itemCardAccepted: { borderColor: '#86EFAC' },
  itemCardOfferAccepted: { borderColor: colors.sage },
  itemCardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  postTypePill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginRight: 10, alignSelf: 'flex-start' },
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
