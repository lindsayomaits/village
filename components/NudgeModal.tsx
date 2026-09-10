import { useState, useEffect } from 'react';
import { View, Modal, ScrollView, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import type { Family } from '../types';

// Ping one specific connection about an open request of yours. Server-side
// rate-limited to once per person per request per 24h (nudge_connection).
export function NudgeModal({
  requestId, visible, onClose,
}: {
  requestId: string; visible: boolean; onClose: () => void;
}) {
  const { family } = useAuth();
  const [connections, setConnections] = useState<Family[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [nudged, setNudged] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!visible || !family) return;
    setLoading(true);
    supabase
      .from('connections')
      .select('requester_id, recipient_id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${family.id},recipient_id.eq.${family.id}`)
      .then(async ({ data }) => {
        const ids = (data ?? []).map(c => c.requester_id === family.id ? c.recipient_id : c.requester_id);
        if (ids.length === 0) { setConnections([]); setLoading(false); return; }
        const { data: fams } = await supabase.from('families').select('*').in('id', ids).order('name');
        setConnections(fams ?? []);
        setLoading(false);
      });
  }, [visible, family?.id]);

  async function nudge(target: Family) {
    setBusyId(target.id);
    const { error } = await supabase.rpc('nudge_connection', { p_request_id: requestId, p_to_family_id: target.id });
    setBusyId(null);
    if (error) return Alert.alert('Could not nudge', error.message);
    setNudged(prev => new Set(prev).add(target.id));
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>Nudge a connection</Text>
        <Text style={styles.sub}>They'll get a notification pointing at this request.</Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
        ) : connections.length === 0 ? (
          <Text style={styles.empty}>You have no connections yet.</Text>
        ) : (
          <ScrollView style={{ maxHeight: 340 }}>
            {connections.map(c => {
              const done = nudged.has(c.id);
              return (
                <View key={c.id} style={styles.row}>
                  <Avatar familyId={c.id} animal={c.animal} photoUrl={c.photo_url} size={34} />
                  <Text style={styles.name}>{c.name}</Text>
                  <TouchableOpacity
                    style={[styles.btn, done && styles.btnDone]}
                    onPress={() => nudge(c)}
                    disabled={done || busyId === c.id}
                  >
                    {busyId === c.id
                      ? <ActivityIndicator color={colors.primary} size="small" />
                      : <Text style={[styles.btnText, done && styles.btnTextDone]}>{done ? 'Nudged ✓' : 'Nudge'}</Text>}
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>
        )}
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeText}>Done</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 22, paddingBottom: 40 },
  handle: { width: 40, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 10 },
  title: { fontSize: 18, fontWeight: '800', color: colors.text, textAlign: 'center' },
  sub: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginTop: 4, marginBottom: 16 },
  empty: { fontSize: 14, color: colors.textMuted, textAlign: 'center', marginVertical: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
  name: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  btn: { borderWidth: 1.5, borderColor: colors.primary, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 8, minWidth: 84, alignItems: 'center' },
  btnDone: { borderColor: colors.border },
  btnText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  btnTextDone: { color: colors.textMuted },
  closeBtn: { marginTop: 14, borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1.5, borderColor: colors.border },
  closeText: { fontSize: 15, color: colors.textSecondary, fontWeight: '700' },
});
