import { useState, useCallback, useEffect } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Text } from '../../components/Text';
import { Avatar } from '../../components/Avatar';
import { ReminderPicker } from '../../components/ReminderPicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors, buttonStyles } from '../../lib/theme';
import { notifyFamily, notifyConnections } from '../../lib/notifications';
import { formatPhone, todayString } from '../../lib/utils';
import { isExpired, lastDay, proposalAwaitingMe, formatShortDate } from '../../lib/requestState';
import { promptReachOut } from '../../lib/reachOut';
import { ProposeTimeModal } from '../../components/ProposeTimeModal';
import { addRequestToCalendar, scheduleReminders } from '../../lib/calendarReminders';
import { StatusBadge } from '../../components/StatusBadge';
import { DirectionTag } from '../../components/DirectionTag';
import { ModifierBadge } from '../../components/ModifierBadge';
import { RequestComments } from '../../components/RequestComments';
import { NudgeModal } from '../../components/NudgeModal';
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
  const { id, propose } = useLocalSearchParams<{ id: string; propose?: string }>();
  const { family, refreshFamily } = useAuth();
  const router = useRouter();
  const [reqState, setReqState] = useState<Request | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reminderPickerVisible, setReminderPickerVisible] = useState(false);
  const [nudgeVisible, setNudgeVisible] = useState(false);
  const [proposeVisible, setProposeVisible] = useState(false);
  const [autoProposeDone, setAutoProposeDone] = useState(false);

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

  // Arriving from a list card's "Suggest a different time" opens the
  // picker straight away, once.
  useEffect(() => {
    if (propose === '1' && reqState && !autoProposeDone) {
      setAutoProposeDone(true);
      setProposeVisible(true);
    }
  }, [propose, reqState, autoProposeDone]);

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
  // Multi-day (overnight/flexible) requests aren't past until the actual
  // end date passes, not the start/drop-off date. An open/offered one
  // past its date is expired (nobody confirmed, no hours move); an
  // accepted one past its date is just waiting on the settlement sweep.
  const today = todayString();
  const expired = isExpired(req, today);
  const isPastDue = req.status === 'accepted' && !req.settled_at && lastDay(req) < today;
  const hasProposal = !!req.proposed_date && !!req.proposed_start_time;
  const proposalForMe = proposalAwaitingMe(req, family?.id);
  const canPropose = !expired && !isPastDue && (
    (req.status === 'open' && !isOwn)
    || (req.status === 'offered' && (isOwn || isFulfiller))
    || (req.status === 'accepted' && !req.settled_at && (isOwn || isFulfiller))
  );
  const cat = CATEGORY_LABELS[req.category];
  const detailText = categoryDetailText(req.category, req.category_details);
  const isFlexible = !!(req.category_details as { timing_flexible?: boolean } | null)?.timing_flexible;

  // Who to chat with: as the requester, whoever's engaged (accepted/offered)
  // or directly targeted; as anyone else, always the requester.
  const chatPartnerId = isOwn ? (req.fulfilling_family_id ?? req.target_household_id) : req.requesting_family_id;
  const chatPartnerName = isOwn ? (req.fulfilling_family?.name ?? req.target_household?.name) : req.requesting_family?.name;
  const proposerName = req.proposed_by === family?.id
    ? 'You'
    : req.proposed_by === req.requesting_family_id ? (req.requesting_family?.name ?? 'They') : (req.fulfilling_family?.name ?? 'They');
  const otherPartyName = isOwn ? req.fulfilling_family?.name : req.requesting_family?.name;

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
    Alert.alert(
      isFlexible ? 'When works for you?' : 'Offer to help?',
      isFlexible
        ? `Their timing is flexible (${req.start_time}). Offer as posted, or suggest a specific day and time. If approved, you'll earn ${req.duration_hours}h.`
        : `If approved, you'll earn ${req.duration_hours}h. Can't make ${req.start_time}? Suggest a different time instead.`,
      [
      { text: 'Not now', style: 'cancel' },
      { text: 'Suggest a time', onPress: () => setProposeVisible(true) },
      {
        text: isFlexible ? 'Any time works' : 'Send offer', onPress: () => withError(
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
    if (!family) return;
    const requester = req.requesting_family;
    Alert.alert('Withdraw your offer?', 'The request goes back to available.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Withdraw', style: 'destructive', onPress: () => withError(
          () => supabase.rpc('retract_offer', { p_request_id: req.id }),
          async () => {
            await notifyFamily(req.requesting_family_id, '↩️ Offer withdrawn', `${family.name} withdrew their offer on "${req.title}" — it's back on the board`, { path: `/request/${req.id}` });
            promptReachOut(router, requester, {
              title: `Let ${requester?.name ?? 'them'} know?`,
              message: "They've been notified, but a quick personal note goes a long way.",
              prefill: `Hi! I'm sorry — I had to withdraw my offer for "${req.title}" on ${formatDate(req.date)}. `,
            });
          }
        ),
      },
    ]);
  }

  async function submitProposal(date: string, time: string, note: string) {
    if (!family) return;
    const { error } = await supabase.rpc('propose_request_time', {
      p_request_id: req.id, p_date: date, p_start_time: time, p_note: note || null,
    });
    if (error) { Alert.alert('Error', error.message); return; }
    setProposeVisible(false);
    const otherId = isOwn ? req.fulfilling_family_id : req.requesting_family_id;
    const when = `${formatShortDate(date)} at ${time}`;
    if (otherId) {
      await notifyFamily(
        otherId,
        req.status === 'open' ? `🙋 ${family.name} can help — at a different time` : '🕐 New time suggested',
        `${family.name} suggested ${when} for "${req.title}". Does that work?${note ? ` "${note}"` : ''}`,
        { path: `/request/${req.id}` },
      );
    }
    await loadRequest();
  }

  function respondToProposal(accept: boolean) {
    if (!family || !req.proposed_date || !req.proposed_start_time) return;
    const when = `${formatShortDate(req.proposed_date)} at ${req.proposed_start_time}`;
    const willBook = req.status === 'offered';
    const body = accept
      ? willBook
        ? `This books ${proposerName} for ${when}. ${isOwn ? `${req.duration_hours}h will be deducted from your balance once it happens.` : `You'll earn ${req.duration_hours}h once it happens.`}`
        : `The booking moves to ${when}.`
      : willBook
        ? `${proposerName} said they can only do ${when} — passing puts the request back on the board.`
        : 'The original time stays as it was.';
    Alert.alert(accept ? `${when} works?` : "That time doesn't work?", body, [
      { text: 'Back', style: 'cancel' },
      {
        text: accept ? 'Yes, confirm ✓' : "Doesn't work", style: accept ? 'default' : 'destructive', onPress: () => withError(
          () => supabase.rpc('respond_to_time_proposal', { p_request_id: req.id, p_accept: accept }),
          async () => {
            if (req.proposed_by) {
              await notifyFamily(
                req.proposed_by,
                accept ? '✅ New time confirmed' : "❌ That time didn't work",
                accept
                  ? `${family.name} confirmed ${when} for "${req.title}"`
                  : `${family.name} can't do ${when} for "${req.title}"${willBook ? ' — the request is back on the board' : ' — the original time stands'}`,
                { path: `/request/${req.id}` },
              );
            }
            await refreshFamily();
          }
        ),
      },
    ]);
  }

  function openToVillage() {
    if (!family) return;
    Alert.alert(
      'Open to your whole village?',
      `Right now only ${req.target_household?.name ?? 'one household'} can see this. Opening it lets all your connections see it and offer to help.`,
      [
        { text: 'Keep private', style: 'cancel' },
        {
          text: 'Open it up', onPress: () => withError(
            () => supabase.from('requests').update({ target_household_id: null }).eq('id', req.id),
            () => notifyConnections(
              family.id,
              `${req.is_urgent ? '❗️ URGENT: ' : ''}${cat.emoji} New request in VillageMates`,
              `${family.name} needs help: "${req.title}" on ${formatShortDate(req.date)}`,
              { path: `/request/${req.id}` },
              req.category,
            ),
          ),
        },
      ],
    );
  }

  function removeExpired() {
    Alert.alert('Remove this request?', "It'll be deleted for good. No hours were ever moved for it.", [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          setBusy(true);
          const { error } = await supabase.from('requests').delete().eq('id', req.id);
          setBusy(false);
          if (error) return Alert.alert('Error', error.message);
          router.back();
        },
      },
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
            const otherFamily = isOwn ? req.fulfilling_family : req.requesting_family;
            if (other) await notifyFamily(other, '⚠️ Cancelled', isOwn ? `${family.name} cancelled for ${formatDate(req.date)}` : `${family.name} backed out — post is available again`, { path: `/request/${req.id}` });
            await refreshFamily();
            promptReachOut(router, otherFamily, {
              title: `Reach out to ${otherFamily?.name ?? 'them'}?`,
              message: within24h
                ? "It's less than a day away — please contact them directly so they're not left without help."
                : "They've been notified, but a personal message helps them re-plan.",
              prefill: isOwn
                ? `Hi! I'm sorry — I had to cancel "${req.title}" on ${formatDate(req.date)}. `
                : `Hi! I'm so sorry — I have to back out of "${req.title}" on ${formatDate(req.date)}. `,
            });
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
          {expired ? (
            <StatusBadge status="expired" />
          ) : isPastDue ? (
            <View style={[styles.badge, { backgroundColor: colors.redLight }]}><Text style={[styles.badgeText, { color: colors.red }]}>⏰ Past date</Text></View>
          ) : (
            <StatusBadge status={req.status} />
          )}
          {isOwn && req.target_household_id && !expired && req.status === 'open' && <ModifierBadge kind="private" />}
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

        {expired && (
          <View style={styles.expiredBox}>
            <Text style={styles.expiredTitle}>⌛ This request expired</Text>
            <Text style={styles.expiredText}>
              {isOwn
                ? 'Its date passed without a confirmed helper, so no hours moved. Repost it with a new date, or remove it.'
                : 'Its date passed without a confirmed helper — no hours moved.'}
            </Text>
          </View>
        )}

        {/* Pending time suggestion */}
        {hasProposal && !expired && (
          <View style={[styles.proposalBox, proposalForMe && styles.proposalBoxAction]}>
            <Text style={styles.proposalLabel}>
              {req.proposed_by === family?.id ? 'You suggested a different time' : `${proposerName} suggested a different time`}
            </Text>
            <Text style={styles.proposalWhen}>📅 {formatDate(req.proposed_date!)} · {req.proposed_start_time}</Text>
            <Text style={styles.proposalWas}>Originally: {formatShortDate(req.date)} · {req.start_time}</Text>
            {req.proposed_note ? <Text style={styles.proposalNote}>"{req.proposed_note}"</Text> : null}
            {proposalForMe ? (
              <View style={styles.proposalActions}>
                <TouchableOpacity style={buttonStyles.earn.container} onPress={() => respondToProposal(true)} disabled={busy}>
                  <Text style={buttonStyles.earn.text}>Works for me ✓</Text>
                </TouchableOpacity>
                <View style={styles.proposalRow}>
                  <TouchableOpacity style={[buttonStyles.secondary.container, { flex: 1 }]} onPress={() => setProposeVisible(true)} disabled={busy}>
                    <Text style={buttonStyles.secondary.text}>Suggest another</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[buttonStyles.destructive.container, { flex: 1 }]} onPress={() => respondToProposal(false)} disabled={busy}>
                    <Text style={buttonStyles.destructive.text}>Doesn't work</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <Text style={styles.proposalWaiting}>⏳ Waiting for {otherPartyName ?? 'them'} to confirm</Text>
            )}
          </View>
        )}

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
              {contactFamily.parent1_phone && (
                <Text style={styles.contactLine}>📞 {formatPhone(contactFamily.parent1_phone)}</Text>
              )}
              <Text style={styles.contactLine}>✉️ {contactFamily.email}</Text>
              {contactFamily.address && <Text style={styles.contactLine}>🏠 {contactFamily.address}</Text>}
              <Text style={styles.contactViewHint}>View full profile →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Private DM to the other party */}
        {chatPartnerId && (
          <TouchableOpacity
            style={styles.chatBtn}
            onPress={() => router.push({
              pathname: '/dm/[familyId]',
              params: { familyId: chatPartnerId, name: chatPartnerName ?? '' },
            })}
          >
            <Text style={styles.chatBtnText}>💬 Message {chatPartnerName ?? 'them'} privately</Text>
          </TouchableOpacity>
        )}

        {/* Shared comment thread for this request */}
        <RequestComments requestId={req.id} />

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

        <NudgeModal requestId={req.id} visible={nudgeVisible} onClose={() => setNudgeVisible(false)} />

        <ProposeTimeModal
          visible={proposeVisible}
          onClose={() => setProposeVisible(false)}
          onSubmit={submitProposal}
          heading={req.status === 'accepted' ? 'Reschedule' : 'Suggest a different time'}
          subheading={
            req.status === 'open'
              ? `This sends your offer to ${req.requesting_family?.name ?? 'them'} for the time you pick — they can confirm or pass.`
              : `${otherPartyName ?? 'They'} will be asked to confirm. ${req.status === 'accepted' ? 'Until they do, the current time stands.' : ''}`
          }
          initialDate={req.proposed_date ?? req.date}
          initialTime={req.proposed_start_time ?? req.start_time}
          windowHint={isFlexible ? `${formatShortDate(req.date)}${req.end_date && req.end_date !== req.date ? ` – ${formatShortDate(req.end_date)}` : ''} · ${req.start_time}` : null}
        />

        {/* Actions */}
        <View style={styles.actions}>
          {expired && isOwn && (
            <>
              <TouchableOpacity style={buttonStyles.earn.container} onPress={() => router.push({ pathname: '/edit-request', params: { requestId: req.id } })}>
                <Text style={buttonStyles.earn.text}>Repost with a new date</Text>
              </TouchableOpacity>
              <TouchableOpacity style={buttonStyles.destructive.container} onPress={removeExpired} disabled={busy}>
                <Text style={buttonStyles.destructive.text}>Remove</Text>
              </TouchableOpacity>
            </>
          )}
          {!expired && req.status === 'open' && !isOwn && (
            <>
              <TouchableOpacity style={buttonStyles.earn.container} onPress={offerRequest} disabled={busy}>
                <Text style={buttonStyles.earn.text}>Offer to help — Earn {req.duration_hours}h</Text>
              </TouchableOpacity>
              <TouchableOpacity style={buttonStyles.secondary.container} onPress={() => setProposeVisible(true)} disabled={busy}>
                <Text style={buttonStyles.secondary.text}>🕐 {isFlexible ? 'Pick a time that works for me' : 'Suggest a different time'}</Text>
              </TouchableOpacity>
            </>
          )}
          {!expired && req.status === 'open' && isOwn && (
            <>
              {req.target_household_id && (
                <TouchableOpacity style={buttonStyles.earn.container} onPress={openToVillage} disabled={busy}>
                  <Text style={buttonStyles.earn.text}>🏘 Open to entire village</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={buttonStyles.earn.container} onPress={() => setNudgeVisible(true)}>
                <Text style={buttonStyles.earn.text}>👋 Nudge a connection</Text>
              </TouchableOpacity>
              <TouchableOpacity style={buttonStyles.secondary.container} onPress={() => router.push({ pathname: '/edit-request', params: { requestId: req.id } })}>
                <Text style={buttonStyles.secondary.text}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={buttonStyles.destructive.container} onPress={cancelRequest} disabled={busy}>
                <Text style={buttonStyles.destructive.text}>Cancel Request</Text>
              </TouchableOpacity>
            </>
          )}
          {!expired && req.status === 'offered' && isOwn && !hasProposal && (
            <>
              <TouchableOpacity style={buttonStyles.spend.container} onPress={approveOffer} disabled={busy}>
                <Text style={buttonStyles.spend.text}>Approve ✓</Text>
              </TouchableOpacity>
              <TouchableOpacity style={buttonStyles.secondary.container} onPress={() => setProposeVisible(true)} disabled={busy}>
                <Text style={buttonStyles.secondary.text}>🕐 Ask for a different time</Text>
              </TouchableOpacity>
              <TouchableOpacity style={buttonStyles.destructive.container} onPress={declineOffer} disabled={busy}>
                <Text style={buttonStyles.destructive.text}>Decline offer</Text>
              </TouchableOpacity>
            </>
          )}
          {!expired && req.status === 'offered' && isOwn && hasProposal && !proposalForMe && (
            <TouchableOpacity style={buttonStyles.destructive.container} onPress={declineOffer} disabled={busy}>
              <Text style={buttonStyles.destructive.text}>Decline offer</Text>
            </TouchableOpacity>
          )}
          {!expired && req.status === 'offered' && isFulfiller && (
            <>
              {!hasProposal && (
                <TouchableOpacity style={buttonStyles.secondary.container} onPress={() => setProposeVisible(true)} disabled={busy}>
                  <Text style={buttonStyles.secondary.text}>🕐 Change the time I offered</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={buttonStyles.secondary.container} onPress={withdrawOffer} disabled={busy}>
                <Text style={buttonStyles.secondary.text}>Withdraw my offer</Text>
              </TouchableOpacity>
            </>
          )}
          {req.status === 'accepted' && !req.settled_at && (isOwn || isFulfiller) && (
            <>
              <TouchableOpacity style={buttonStyles.earn.container} onPress={markCompleted} disabled={busy}>
                <Text style={buttonStyles.earn.text}>Mark as Completed ✓</Text>
              </TouchableOpacity>
              {canPropose && !hasProposal && (
                <TouchableOpacity style={buttonStyles.secondary.container} onPress={() => setProposeVisible(true)} disabled={busy}>
                  <Text style={buttonStyles.secondary.text}>🕐 Reschedule</Text>
                </TouchableOpacity>
              )}
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

  expiredBox: { backgroundColor: colors.borderLight, borderRadius: 12, padding: 14, marginBottom: 18, gap: 4 },
  expiredTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  expiredText: { fontSize: 13, color: colors.textSecondary, lineHeight: 19 },

  proposalBox: { backgroundColor: colors.amberLight, borderRadius: 14, padding: 14, marginBottom: 18, gap: 4, borderWidth: 1.5, borderColor: colors.amber + '60', borderStyle: 'dashed' },
  proposalBoxAction: { borderStyle: 'solid', borderColor: colors.primary },
  proposalLabel: { fontSize: 12, fontWeight: '700', color: colors.primaryDark, textTransform: 'uppercase', letterSpacing: 0.4 },
  proposalWhen: { fontSize: 17, fontWeight: '800', color: colors.text },
  proposalWas: { fontSize: 12, color: colors.textSecondary, textDecorationLine: 'line-through' },
  proposalNote: { fontSize: 13, color: colors.text, fontStyle: 'italic', marginTop: 4 },
  proposalWaiting: { fontSize: 13, color: colors.textSecondary, fontWeight: '600', marginTop: 6 },
  proposalActions: { gap: 8, marginTop: 10 },
  proposalRow: { flexDirection: 'row', gap: 8 },

  actions: { gap: 10 },
});
