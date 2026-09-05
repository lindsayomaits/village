import { useState, useCallback } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Text } from '../../components/Text';
import { Avatar } from '../../components/Avatar';
import { ReminderPicker } from '../../components/ReminderPicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors, buttonStyles } from '../../lib/theme';
import { notifyFamily } from '../../lib/notifications';
import { addRequestToCalendar, scheduleReminders } from '../../lib/calendarReminders';
import { StatusBadge } from '../../components/StatusBadge';
import { DirectionTag } from '../../components/DirectionTag';
import { ModifierBadge } from '../../components/ModifierBadge';
import type { Request, RequestCategory } from '../../types';

const CATEGORY_LABELS: Record<RequestCategory, { emoji: string; label: string }> = {
  kid_sit:           { emoji: '👧', label: 'Kid-sitting' },
  dog:               { emoji: '🐾', label: 'Pet care' },
  manual_labor:      { emoji: '🔨', label: 'Manual labor' },
  professional:      { emoji: '🎓', label: 'Professional help' },
  cooking:           { emoji: '🍳', label: 'Cooking / baking' },
  elder_care:        { emoji: '🤝', label: 'Elder care' },
  physical_training: { emoji: '🏃', label: 'Physical training' },
  errands:           { emoji: '🛒', label: 'Errands' },
};

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function categoryDetailText(category: RequestCategory, details: Request['category_details']): string | null {
  if (!details) return null;
  const d = details as Record<string, unknown>;
  if (category === 'kid_sit' && d.location) return d.location === 'kids_house' ? "🏠 At the kid's house" : "🏡 At the sitter's house";
  if (category === 'dog') {
    const name = (d.pet_name ?? d.dog_name) as string | undefined;
    const taskLabel = d.dog_task === 'walk' ? '🦮 Walking' : d.dog_task === 'house_check' ? '🏠 House check' : '🏡 Boarding';
    return `${taskLabel}${name ? ` · ${name}` : ''}`;
  }
  if (category === 'manual_labor' && d.labor_description) return `"${d.labor_description}"`;
  if (category === 'professional' && d.service_type) return d.service_type as string;
  if (category === 'cooking' && d.cooking_type) return d.cooking_type as string;
  if (category === 'elder_care' && d.elder_care_type) return d.elder_care_type as string;
  if (category === 'physical_training' && d.training_type) return d.training_type as string;
  if (category === 'errands' && d.errand_type) return d.errand_type as string;
  return null;
}

export default function RequestDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { family, refreshFamily } = useAuth();
  const router = useRouter();
  const [reqState, setReqState] = useState<Request | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reminderPickerVisible, setReminderPickerVisible] = useState(false);

  async function loadRequest() {
    if (!id) return;
    const { data } = await supabase
      .from('requests')
      .select('*, requesting_family:families!requesting_family_id(*), fulfilling_family:families!fulfilling_family_id(*), target_household:families!target_household_id(*)')
      .eq('id', id)
      .single();
    setReqState(data ?? null);
    setLoading(false);
  }

  useFocusEffect(useCallback(() => { loadRequest(); }, [id]));

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  if (!reqState) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.topRow}>
          <TouchableOpacity onPress={() => router.back()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        </View>
        <Text style={styles.notFound}>This request isn't available — it may have been cancelled or removed.</Text>
      </SafeAreaView>
    );
  }

  // Narrowed, stable alias — everything below can safely assume non-null
  // without TS losing the narrowing across the action closures.
  const req: Request = reqState;

  const isOwn = req.requesting_family_id === family?.id;
  const isFulfiller = req.fulfilling_family_id === family?.id;
  // Multi-day (overnight) requests aren't past due until the actual end
  // date passes, not the start/drop-off date.
  const isPastDue = req.status !== 'completed' && (req.end_date ?? req.date) < new Date().toISOString().split('T')[0];
  const cat = CATEGORY_LABELS[req.category];
  const detailText = categoryDetailText(req.category, req.category_details);
  const isFlexible = !!(req.category_details as { timing_flexible?: boolean } | null)?.timing_flexible;

  // Who to chat with: as the requester, whoever's engaged (accepted/offered)
  // or directly targeted; as anyone else, always the requester.
  const chatPartnerId = isOwn ? (req.fulfilling_family_id ?? req.target_household_id) : req.requesting_family_id;
  const chatPartnerName = isOwn ? (req.fulfilling_family?.name ?? req.target_household?.name) : req.requesting_family?.name;

  async function withError(action: () => PromiseLike<{ error: { message: string } | null }>, then?: () => void | Promise<void>) {
    setBusy(true);
    const { error } = await action();
    setBusy(false);
    if (error) return Alert.alert('Error', error.message);
    await loadRequest();
    if (then) await then();
  }

  function offerRequest() {
    if (!family) return;
    Alert.alert('Offer to help?', `If approved, you'll earn ${req.duration_hours}h.`, [
      { text: 'Not now', style: 'cancel' },
      {
        text: 'Send offer', onPress: () => withError(
          () => supabase.rpc('offer_request', { p_request_id: req.id, p_offering_family_id: family.id }),
          () => notifyFamily(req.requesting_family_id, '🙋 Someone offered to help!', `${family.name} offered to help — open the app to approve or decline`, { path: `/(tabs)/requests?filter=mine` })
        ),
      },
    ]);
  }

  function approveOffer() {
    if (!family) return;
    Alert.alert('Approve this offer?', `${req.fulfilling_family?.name} will help you on ${formatDate(req.date)}. ${req.duration_hours}h will be deducted from your balance.`, [
      { text: 'Not yet', style: 'cancel' },
      {
        text: 'Approve ✓', onPress: () => withError(
          () => supabase.rpc('approve_offer', { p_request_id: req.id, p_requester_family_id: family.id }),
          async () => { await notifyFamily(req.fulfilling_family_id!, '✅ Your offer was approved!', `${family.name} approved your offer for ${formatDate(req.date)}`, { path: `/(tabs)/requests?filter=upcoming` }); await refreshFamily(); }
        ),
      },
    ]);
  }

  function declineOffer() {
    if (!family) return;
    Alert.alert('Decline this offer?', 'The request goes back to available.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Decline', style: 'destructive', onPress: () => withError(
          () => supabase.rpc('retract_offer', { p_request_id: req.id }),
          () => req.fulfilling_family_id ? notifyFamily(req.fulfilling_family_id, '❌ Offer declined', `${family.name} passed on your offer — the request is back available`, { path: `/(tabs)/requests?filter=open` }) : undefined
        ),
      },
    ]);
  }

  function withdrawOffer() {
    Alert.alert('Withdraw your offer?', 'The request goes back to available.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Withdraw', style: 'destructive', onPress: () => withError(() => supabase.rpc('retract_offer', { p_request_id: req.id })) },
    ]);
  }

  function markCompleted() {
    Alert.alert('Mark as completed?', 'Confirm the help happened.', [
      { text: 'Not yet', style: 'cancel' },
      {
        text: 'Yes, done!', onPress: () => withError(
          () => supabase.rpc('complete_request', { p_request_id: req.id }),
          async () => {
            await refreshFamily();
            const other = isOwn ? req.fulfilling_family_id : req.requesting_family_id;
            if (other) await notifyFamily(other, '🎉 Marked completed', `"${req.title}" was marked completed — ${req.duration_hours}h settled.`, { path: `/(tabs)/requests?filter=upcoming` });
          }
        ),
      },
    ]);
  }

  function cancelRequest() {
    Alert.alert('Cancel this?', 'This will remove the post from the board.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel', style: 'destructive', onPress: async () => {
          setBusy(true);
          await supabase.from('requests').delete().eq('id', req.id);
          setBusy(false);
          router.back();
        },
      },
    ]);
  }

  function cancelAcceptedRequest() {
    if (!family) return;
    const sitDate = new Date(req.date + 'T00:00:00');
    const within24h = (sitDate.getTime() - Date.now()) / 3600000 < 24;
    const base = isOwn
      ? `This will cancel and return ${req.duration_hours}h to your balance.`
      : `This will release you and return ${req.duration_hours}h to ${req.requesting_family?.name}.`;
    Alert.alert(isOwn ? 'Cancel?' : 'Back out?', base + (within24h ? '\n\n⚠️ Within 24 hours — please contact them directly!' : ''), [
      { text: 'Keep it', style: 'cancel' },
      {
        text: isOwn ? 'Cancel' : 'Back out', style: 'destructive', onPress: () => withError(
          () => supabase.rpc('cancel_accepted_request', { p_request_id: req.id, p_family_id: family.id }),
          async () => {
            const other = isOwn ? req.fulfilling_family_id : req.requesting_family_id;
            if (other) await notifyFamily(other, '⚠️ Cancelled', isOwn ? `${family.name} cancelled for ${formatDate(req.date)}` : `${family.name} backed out — post is available again`, { path: `/(tabs)/requests?filter=${isOwn ? 'open' : 'mine'}` });
            await refreshFamily();
          }
        ),
      },
    ]);
  }

  function reverseSettlement() {
    if (!family) return;
    Alert.alert("Didn't happen?", `This will undo the ${req.duration_hours}h that was already paid out for "${req.title}" and mark it cancelled.`, [
      { text: 'Never mind', style: 'cancel' },
      {
        text: 'Reverse', style: 'destructive', onPress: () => withError(
          () => supabase.rpc('reverse_settlement', { p_request_id: req.id }),
          async () => {
            if (req.fulfilling_family_id) await notifyFamily(req.fulfilling_family_id, '⚠️ Settlement reversed', `${family.name} reversed the payout for "${req.title}" — it didn't happen`, { path: `/(tabs)/requests?filter=mine` });
            await refreshFamily();
          }
        ),
      },
    ]);
  }

  const contactFamily = isOwn ? req.fulfilling_family : req.requesting_family;
  const showContact = (req.status === 'offered' || req.status === 'accepted' || req.status === 'completed') && contactFamily;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topRow}>
        <TouchableOpacity onPress={() => router.back()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.screenTitle}>Request</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <DirectionTag earning={isFulfiller || !isOwn} hours={req.duration_hours} />

        {(req.is_urgent || req.is_overnight || req.category === 'manual_labor' || isFlexible) && req.status !== 'cancelled' && (
          <View style={styles.modifierRow}>
            {req.is_urgent && <ModifierBadge kind="urgent" />}
            {req.is_overnight && <ModifierBadge kind="overnight" />}
            {req.category === 'manual_labor' && <ModifierBadge kind="rate2x" />}
            {isFlexible && <ModifierBadge kind="flexible" />}
          </View>
        )}

        <View style={styles.headerRow}>
          <Text style={styles.catEmoji}>{cat.emoji}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{req.title}</Text>
            <Text style={styles.catLabel}>{cat.label}</Text>
          </View>
        </View>

        <View style={styles.badgeRow}>
          {isPastDue ? (
            <View style={[styles.badge, { backgroundColor: colors.redLight }]}><Text style={[styles.badgeText, { color: colors.red }]}>⏰ Past date</Text></View>
          ) : (
            <StatusBadge status={req.status} />
          )}
        </View>

        {/* Who */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Requested by</Text>
          <View style={styles.whoRow}>
            <Avatar familyId={req.requesting_family_id} animal={req.requesting_family?.animal} photoUrl={req.requesting_family?.photo_url} size={40} />
            <Text style={styles.whoName}>{isOwn ? 'You' : req.requesting_family?.name}</Text>
          </View>
          {req.category === 'kid_sit' && req.kid_name && <Text style={styles.detailText}>Kid(s): {req.kid_name}</Text>}
          {detailText && <Text style={styles.detailText}>{detailText}</Text>}
        </View>

        {/* When */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>When</Text>
          {req.is_overnight ? (
            <>
              <Text style={styles.detailText}>📥 Drop-off: {formatDate(req.date)} at {req.start_time}</Text>
              {req.end_date && <Text style={styles.detailText}>📤 Pick-up: {formatDate(req.end_date)} at {req.end_time}</Text>}
            </>
          ) : (
            <>
              <Text style={styles.detailText}>📅 {formatDate(req.date)}</Text>
              <Text style={styles.detailText}>🕐 {req.start_time}</Text>
            </>
          )}
          <Text style={styles.detailText}>
            ⏱ {req.category === 'manual_labor' ? `${(req.category_details as { actual_hours?: number } | null)?.actual_hours ?? req.duration_hours / 2}h work · ${req.duration_hours}h charged` : `${req.duration_hours}h`}
          </Text>
        </View>

        {/* Notes */}
        {req.notes && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Notes</Text>
            <Text style={styles.notes}>{req.notes}</Text>
          </View>
        )}

        {/* Status / settlement */}
        {(req.status === 'accepted' || req.status === 'completed') && req.settled_at && !req.reversed_at && (
          <View style={styles.settledBox}>
            <Text style={styles.settledText}>✅ Settled — {req.duration_hours}h paid out</Text>
          </View>
        )}

        {/* Contact */}
        {showContact && contactFamily && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{isOwn ? (req.status === 'offered' ? 'Offered by' : 'Your helper') : 'Contact'}</Text>
            <TouchableOpacity style={styles.contactBox} onPress={() => router.push(`/profile/${contactFamily.id}`)} activeOpacity={0.7}>
              <View style={styles.whoRow}>
                <Avatar familyId={contactFamily.id} animal={contactFamily.animal} photoUrl={contactFamily.photo_url} size={36} />
                <Text style={styles.contactName}>{contactFamily.name}</Text>
                <Text style={styles.contactChevron}>›</Text>
              </View>
              {contactFamily.parent1_name && <Text style={styles.contactLine}>👤 {contactFamily.parent1_name}</Text>}
              {(contactFamily.parent1_phone || contactFamily.phone) && (
                <Text style={styles.contactLine}>📞 {contactFamily.parent1_phone || contactFamily.phone}</Text>
              )}
              <Text style={styles.contactLine}>✉️ {contactFamily.email}</Text>
              {contactFamily.address && <Text style={styles.contactLine}>🏠 {contactFamily.address}</Text>}
              <Text style={styles.contactViewHint}>View full profile →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Chat button */}
        {chatPartnerId && (
          <TouchableOpacity
            style={styles.chatBtn}
            onPress={() => router.push({
              pathname: '/dm/[familyId]',
              params: { familyId: chatPartnerId, name: chatPartnerName ?? '', prefill: `Hi! Regarding #${req.title} ` },
            })}
          >
            <Text style={styles.chatBtnText}>💬 Chat with {chatPartnerName ?? 'them'} about this request</Text>
          </TouchableOpacity>
        )}

        {/* Both sides are locked in — offer to get it on their calendar or set a reminder */}
        {req.status === 'accepted' && (isOwn || isFulfiller) && (
          <View style={styles.calendarRow}>
            <TouchableOpacity
              style={styles.calendarBtn}
              onPress={() => addRequestToCalendar(req, chatPartnerName ?? 'them')}
            >
              <Text style={styles.calendarBtnText}>📅 Add to Calendar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.calendarBtn}
              onPress={() => setReminderPickerVisible(true)}
            >
              <Text style={styles.calendarBtnText}>🔔 Set Reminder</Text>
            </TouchableOpacity>
          </View>
        )}

        <ReminderPicker
          visible={reminderPickerVisible}
          onClose={() => setReminderPickerVisible(false)}
          onConfirm={(whens) => {
            setReminderPickerVisible(false);
            scheduleReminders(req, whens);
          }}
        />

        {/* Actions */}
        <View style={styles.actions}>
          {req.status === 'open' && !isOwn && (
            <TouchableOpacity style={buttonStyles.earn.container} onPress={offerRequest} disabled={busy}>
              <Text style={buttonStyles.earn.text}>Offer to help — Earn {req.duration_hours}h</Text>
            </TouchableOpacity>
          )}
          {req.status === 'open' && isOwn && (
            <>
              <TouchableOpacity style={buttonStyles.secondary.container} onPress={() => router.push({ pathname: '/edit-request', params: { requestId: req.id } })}>
                <Text style={buttonStyles.secondary.text}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={buttonStyles.destructive.container} onPress={cancelRequest} disabled={busy}>
                <Text style={buttonStyles.destructive.text}>Cancel Request</Text>
              </TouchableOpacity>
            </>
          )}
          {req.status === 'offered' && isOwn && (
            <>
              <TouchableOpacity style={buttonStyles.spend.container} onPress={approveOffer} disabled={busy}>
                <Text style={buttonStyles.spend.text}>Approve ✓</Text>
              </TouchableOpacity>
              <TouchableOpacity style={buttonStyles.destructive.container} onPress={declineOffer} disabled={busy}>
                <Text style={buttonStyles.destructive.text}>Decline offer</Text>
              </TouchableOpacity>
            </>
          )}
          {req.status === 'offered' && isFulfiller && (
            <TouchableOpacity style={buttonStyles.secondary.container} onPress={withdrawOffer} disabled={busy}>
              <Text style={buttonStyles.secondary.text}>Withdraw my offer</Text>
            </TouchableOpacity>
          )}
          {req.status === 'accepted' && !req.settled_at && (isOwn || isFulfiller) && (
            <>
              <TouchableOpacity style={buttonStyles.earn.container} onPress={markCompleted} disabled={busy}>
                <Text style={buttonStyles.earn.text}>Mark as Completed ✓</Text>
              </TouchableOpacity>
              <TouchableOpacity style={buttonStyles.destructive.container} onPress={cancelAcceptedRequest} disabled={busy}>
                <Text style={buttonStyles.destructive.text}>{isOwn ? 'Cancel' : 'Back Out'}</Text>
              </TouchableOpacity>
            </>
          )}
          {(req.status === 'accepted' || req.status === 'completed') && req.settled_at && !req.reversed_at && isOwn && (
            <TouchableOpacity style={buttonStyles.destructive.container} onPress={reverseSettlement} disabled={busy}>
              <Text style={buttonStyles.destructive.text}>Didn't happen? Reverse</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  back: { fontSize: 16, color: colors.primary, fontWeight: '600', width: 60 },
  screenTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  scroll: { paddingHorizontal: 20, paddingBottom: 48 },
  notFound: { fontSize: 15, color: colors.textMuted, textAlign: 'center', marginTop: 60, paddingHorizontal: 30 },

  modifierRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },

  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  catEmoji: { fontSize: 32 },
  title: { fontSize: 22, fontWeight: '800', color: colors.text },
  catLabel: { fontSize: 13, color: colors.textSecondary, fontWeight: '600', marginTop: 2 },

  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  badge: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  badgeText: { fontSize: 13, fontWeight: '700' },

  section: { marginBottom: 18 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  whoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  whoName: { fontSize: 16, fontWeight: '700', color: colors.text },
  detailText: { fontSize: 14, color: colors.text, fontWeight: '500', marginBottom: 4 },
  notes: { fontSize: 14, color: colors.textSecondary, fontStyle: 'italic', lineHeight: 20 },

  settledBox: { backgroundColor: colors.greenLight, borderRadius: 12, borderWidth: 1.5, borderColor: colors.green, padding: 12, marginBottom: 18 },
  settledText: { color: colors.sageDark, fontWeight: '700', fontSize: 14, textAlign: 'center' },

  contactBox: { backgroundColor: colors.sageLight, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.sage + '40' },
  contactName: { fontSize: 16, fontWeight: '700', color: colors.text, flex: 1 },
  contactChevron: { fontSize: 20, color: colors.sageDark },
  contactLine: { fontSize: 13, color: colors.text, fontWeight: '500', marginBottom: 2 },
  contactViewHint: { fontSize: 12, color: colors.sageDark, fontWeight: '700', marginTop: 6 },

  chatBtn: { backgroundColor: colors.sageLight, borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1.5, borderColor: colors.sage, marginBottom: 20 },
  chatBtnText: { color: colors.sageDark, fontWeight: '700', fontSize: 15 },
  calendarRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  calendarBtn: { flex: 1, backgroundColor: colors.card, borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1.5, borderColor: colors.border },
  calendarBtnText: { color: colors.text, fontWeight: '700', fontSize: 14 },

  actions: { gap: 10 },
});
