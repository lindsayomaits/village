import { useState, useEffect } from 'react';
import { View, Modal, ScrollView, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { useRouter } from 'expo-router';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { getFamilyAnimal } from '../lib/animals';
import { formatPhone, displayKidsData, displayPetsData, renderKidsInfo } from '../lib/utils';
import { notifyFamily, notifyAdmins } from '../lib/notifications';
import type { Family, Connection, RequestCategory } from '../types';

const GIFT_HOUR_OPTIONS = [0.5, 1, 2, 3, 4, 5, 8, 10];

const CATEGORY_LABELS: Record<RequestCategory, { emoji: string; label: string }> = {
  kid_sit:           { emoji: '👧', label: 'Kids' },
  dog:               { emoji: '🐾', label: 'Pets' },
  manual_labor:      { emoji: '🔨', label: 'Labor' },
  professional:      { emoji: '🎓', label: 'Pro help' },
  cooking:           { emoji: '🍳', label: 'Cooking' },
  elder_care:        { emoji: '🤝', label: 'Elder care' },
  physical_training: { emoji: '🏃', label: 'Fitness' },
  errands:           { emoji: '🛒', label: 'Errands' },
};

type Status = 'none' | 'pending_sent' | 'pending_received' | 'connected';

// The single "view a household" experience — used from the Village tab,
// from a DM's header, and anywhere else someone's name is tappable. Fetches
// its own connection status for the pair rather than requiring the caller
// to already have that data loaded, so it drops in anywhere with just a
// target Family.
export function PersonProfileModal({
  family, onClose, onChanged,
}: {
  family: Family | null;
  onClose: () => void;
  // Called after an action that changes shared state (connect/accept/
  // decline/disconnect/block) so the caller can refresh its own list.
  onChanged?: () => void;
}) {
  const { family: myHousehold } = useAuth();
  const router = useRouter();

  const [conn, setConn] = useState<Connection | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [giftOpen, setGiftOpen] = useState(false);
  const [giftHours, setGiftHours] = useState(1);
  const [giftNote, setGiftNote] = useState('');
  const [giftLoading, setGiftLoading] = useState(false);

  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<string | null>(null);
  const [reportNote, setReportNote] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);

  useEffect(() => {
    if (!family || !myHousehold) { setConn(null); return; }
    supabase
      .from('connections')
      .select('*')
      .or(`and(requester_id.eq.${myHousehold.id},recipient_id.eq.${family.id}),and(requester_id.eq.${family.id},recipient_id.eq.${myHousehold.id})`)
      .maybeSingle()
      .then(({ data }) => setConn(data as Connection | null));
  }, [family?.id, myHousehold?.id]);

  function close() {
    setGiftOpen(false);
    setReportOpen(false);
    onClose();
  }

  const status: Status = !conn ? 'none'
    : conn.status === 'accepted' ? 'connected'
    : conn.requester_id === myHousehold?.id ? 'pending_sent' : 'pending_received';

  async function sendConnectionRequest() {
    if (!myHousehold || !family) return;
    setActionLoading(true);
    const { error } = await supabase.from('connections').insert({
      requester_id: myHousehold.id,
      recipient_id: family.id,
      status: 'pending',
    });
    setActionLoading(false);
    if (error) {
      if (error.code === '23505') return; // already in progress — silently resolved by the refetch below
      return;
    }
    notifyFamily(family.id, '🤝 New connection request', `${myHousehold.name} wants to connect with you`, { path: '/(tabs)/members?tab=pending' }).catch(() => {});
    onChanged?.();
    close();
  }

  async function acceptConnection() {
    if (!conn || !myHousehold) return;
    setActionLoading(true);
    const { error } = await supabase.from('connections').update({ status: 'accepted' }).eq('id', conn.id);
    setActionLoading(false);
    if (error) return;
    notifyFamily(conn.requester_id, '🎉 Connection accepted', `${myHousehold.name} accepted your connection request`, { path: '/(tabs)/members?tab=my_network' }).catch(() => {});
    onChanged?.();
    close();
  }

  async function declineConnection() {
    if (!conn) return;
    setActionLoading(true);
    await supabase.from('connections').delete().eq('id', conn.id);
    setActionLoading(false);
    onChanged?.();
    close();
  }

  function disconnect() {
    if (!conn || !family) return;
    setActionLoading(true);
    supabase.from('connections').delete().eq('id', conn.id).then(() => {
      setActionLoading(false);
      onChanged?.();
      close();
    });
  }

  async function submitGift() {
    if (!family || !myHousehold) return;
    const currentBalance = myHousehold.hours_balance ?? 0;
    const newBalance = currentBalance - giftHours;
    if (newBalance < 0) return;
    setGiftLoading(true);
    const { error } = await supabase.rpc('gift_hours', {
      p_recipient_id: family.id,
      p_hours: giftHours,
      p_note: giftNote.trim() || null,
    });
    setGiftLoading(false);
    if (error) return;
    await notifyFamily(family.id, '🎁 You received a gift!', `${myHousehold.name} gifted you ${giftHours}h${giftNote.trim() ? ` — "${giftNote.trim()}"` : ''}`, { path: '/(tabs)/profile' });
    setGiftOpen(false);
    close();
  }

  async function submitReport() {
    if (!myHousehold || !family || !reportReason) return;
    setReportSubmitting(true);
    const { error } = await supabase.from('reports').insert({
      reporter_id: myHousehold.id,
      reported_id: family.id,
      reason: reportReason,
      note: reportNote.trim() || null,
    });
    setReportSubmitting(false);
    if (error) return;
    notifyAdmins('🚩 New report', `${myHousehold.name} reported ${family.name} — ${reportReason}`, { path: '/(tabs)/admin' }).catch(() => {});
    setReportOpen(false);
    close();
  }

  function block() {
    if (!family) return;
    setActionLoading(true);
    supabase.rpc('block_household', { p_blocked_id: family.id }).then(({ error }) => {
      setActionLoading(false);
      if (error) return;
      onChanged?.();
      close();
    });
  }

  return (
    <>
      <Modal visible={!!family} transparent animationType="slide" onRequestClose={close}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={close} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          {family && (
            <ScrollView bounces={false} contentContainerStyle={styles.sheetContent}>
              <Avatar familyId={family.id} animal={family.animal} photoUrl={family.photo_url} size={80} style={{ marginTop: 8, marginBottom: 8 }} />
              <Text style={styles.sheetName}>{family.name}</Text>

              {(family.parent1_name || family.parent1_phone) && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Contact</Text>
                  <View style={styles.infoRight}>
                    {family.parent1_name && <Text style={styles.infoValue}>{family.parent1_name}</Text>}
                    {family.parent1_phone && <Text style={styles.infoSub}>{formatPhone(family.parent1_phone)}</Text>}
                  </View>
                </View>
              )}

              {family.kids_data && family.kids_data.length > 0 && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Kids</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.infoValue}>{displayKidsData(family.kids_data)}</Text>
                    {family.kids_data.filter(k => k.notes?.trim()).map((k, i) => (
                      <Text key={i} style={styles.careNoteText}>{k.name}: {renderKidsInfo(k.notes)}</Text>
                    ))}
                  </View>
                </View>
              )}

              {family.pets_data && family.pets_data.length > 0 && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Pets</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.infoValue}>{displayPetsData(family.pets_data)}</Text>
                    {family.pets_data.filter(p => p.notes?.trim()).map((p, i) => (
                      <Text key={i} style={styles.careNoteText}>{p.name}: {renderKidsInfo(p.notes)}</Text>
                    ))}
                  </View>
                </View>
              )}

              {status !== 'connected' && family.id !== myHousehold?.id &&
                !family.parent1_name && !family.kids_data?.length && !family.pets_data?.length && (
                <Text style={styles.connectHint}>Connect with them to see contact info.</Text>
              )}

              {family.services_offered && family.services_offered.length > 0 && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Helps with</Text>
                  <View style={styles.serviceChips}>
                    {family.services_offered
                      .filter((key): key is RequestCategory => !!CATEGORY_LABELS[key as RequestCategory])
                      .map(key => (
                        <View key={key} style={styles.serviceChip}>
                          <Text style={styles.serviceChipText}>
                            {CATEGORY_LABELS[key as RequestCategory].emoji} {CATEGORY_LABELS[key as RequestCategory].label}
                          </Text>
                        </View>
                      ))}
                  </View>
                </View>
              )}

              {family.id !== myHousehold?.id && (
                <View style={styles.actionButtons}>
                  {status === 'connected' && (
                    <>
                      <TouchableOpacity style={styles.messageBtn} onPress={() => { close(); router.push(`/dm/${family.id}`); }}>
                        <Text style={styles.messageBtnText}>Send a Message</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.messageBtn} onPress={() => { close(); router.push({ pathname: '/new-request', params: { targetId: family.id } }); }}>
                        <Text style={styles.messageBtnText}>🙋 Request Help Directly</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.giftBtn} onPress={() => setGiftOpen(true)}>
                        <Text style={styles.giftBtnText}>🎁 Gift Hours</Text>
                      </TouchableOpacity>
                    </>
                  )}

                  {status === 'none' && (
                    <TouchableOpacity style={styles.connectBtn} onPress={sendConnectionRequest} disabled={actionLoading}>
                      <Text style={styles.connectBtnText}>Connect</Text>
                    </TouchableOpacity>
                  )}

                  {status === 'pending_sent' && (
                    <View style={styles.pendingInfo}>
                      <Text style={styles.pendingInfoText}>Connection request sent — waiting for them to accept.</Text>
                      <TouchableOpacity style={styles.revokeBtn} onPress={declineConnection} disabled={actionLoading}>
                        <Text style={styles.revokeBtnText}>Revoke Request</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {status === 'pending_received' && (
                    <View style={styles.incomingActions}>
                      <TouchableOpacity style={styles.acceptBtn} onPress={acceptConnection} disabled={actionLoading}>
                        <Text style={styles.acceptBtnText}>Accept Request</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.declineBtn} onPress={declineConnection} disabled={actionLoading}>
                        <Text style={styles.declineBtnText}>Decline</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {status === 'connected' && (
                    <TouchableOpacity style={styles.disconnectBtn} onPress={disconnect} disabled={actionLoading}>
                      <Text style={styles.disconnectBtnText}>Disconnect</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {family.id !== myHousehold?.id && (
                <View style={styles.safetyRow}>
                  <TouchableOpacity onPress={() => setReportOpen(true)}>
                    <Text style={styles.safetyLinkText}>Report</Text>
                  </TouchableOpacity>
                  <Text style={styles.safetyDivider}>·</Text>
                  <TouchableOpacity onPress={block} disabled={actionLoading}>
                    <Text style={styles.safetyLinkText}>Block</Text>
                  </TouchableOpacity>
                </View>
              )}

              <TouchableOpacity style={styles.closeBtn} onPress={close}>
                <Text style={styles.closeBtnText}>Close</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </Modal>

      <Modal visible={giftOpen} transparent animationType="slide" onRequestClose={() => setGiftOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setGiftOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          {family && (
            <ScrollView bounces={false} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetAnimal}>{getFamilyAnimal(family.id, family.animal)}</Text>
              <Text style={styles.giftTitle}>Gift Hours to {family.name}</Text>
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
                  <TouchableOpacity key={h} style={[styles.giftHourBtn, giftHours === h && styles.giftHourBtnActive]} onPress={() => setGiftHours(h)}>
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

              <TouchableOpacity style={[styles.giftSubmitBtn, giftLoading && { opacity: 0.6 }]} onPress={submitGift} disabled={giftLoading}>
                <Text style={styles.giftSubmitText}>{giftLoading ? 'Sending...' : `Send ${giftHours}h to ${family.name} 🎁`}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.closeBtn} onPress={() => setGiftOpen(false)}>
                <Text style={styles.closeBtnText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </Modal>

      <Modal visible={reportOpen} transparent animationType="slide" onRequestClose={() => setReportOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setReportOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          {family && (
            <ScrollView bounces={false} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
              <Text style={styles.giftTitle}>Report {family.name}</Text>
              <Text style={styles.giftSub}>This goes to an admin for review, not to {family.name}.</Text>

              <Text style={styles.giftLabel}>Reason</Text>
              {['Inappropriate behavior', 'Safety concern', 'Spam', 'Other'].map(r => (
                <TouchableOpacity key={r} style={[styles.reportReasonRow, reportReason === r && styles.reportReasonRowActive]} onPress={() => setReportReason(r)}>
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

              <TouchableOpacity style={[styles.giftSubmitBtn, (!reportReason || reportSubmitting) && { opacity: 0.6 }]} onPress={submitReport} disabled={!reportReason || reportSubmitting}>
                <Text style={styles.giftSubmitText}>{reportSubmitting ? 'Submitting...' : 'Submit Report'}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.closeBtn} onPress={() => setReportOpen(false)}>
                <Text style={styles.closeBtnText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
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
  careNoteText: { fontSize: 12, color: colors.textSecondary, fontStyle: 'italic', marginTop: 2 },
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
  acceptBtn: { flex: 2, backgroundColor: colors.sageDark, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  acceptBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  declineBtn: { flex: 1, backgroundColor: colors.card, borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1.5, borderColor: colors.borderLight },
  declineBtnText: { color: colors.primaryDark, fontWeight: '700', fontSize: 15 },
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
