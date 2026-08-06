import { useState, useEffect } from 'react';
import {
  View, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Text } from '../../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors } from '../../lib/theme';
import { notifyFamily } from '../../lib/notifications';
import type { DirectMessage } from '../../types';

export default function DMScreen() {
  const { familyId, name } = useLocalSearchParams<{ familyId: string; name: string }>();
  const { family } = useAuth();
  const router = useRouter();
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const otherName = Array.isArray(name) ? name[0] : (name ?? '');
  const otherId = Array.isArray(familyId) ? familyId[0] : (familyId ?? '');

  useEffect(() => {
    loadMessages();
    markRead();

    const channel = supabase
      .channel(`dm_thread_${otherId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, (payload) => {
        const msg = payload.new as DirectMessage;
        const isRelevant =
          (msg.from_family_id === family?.id && msg.to_family_id === otherId) ||
          (msg.from_family_id === otherId && msg.to_family_id === family?.id);
        if (!isRelevant) return;
        setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [msg, ...prev]);
        if (msg.to_family_id === family?.id) {
          supabase.from('direct_messages').update({ read_at: new Date().toISOString() }).eq('id', msg.id);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [otherId]);

  async function loadMessages() {
    if (!family) return;
    const { data } = await supabase
      .from('direct_messages')
      .select('*')
      .or(`and(from_family_id.eq.${family.id},to_family_id.eq.${otherId}),and(from_family_id.eq.${otherId},to_family_id.eq.${family.id})`)
      .order('created_at', { ascending: false });
    setMessages(data ?? []);
  }

  async function markRead() {
    if (!family) return;
    await supabase
      .from('direct_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('to_family_id', family.id)
      .eq('from_family_id', otherId)
      .is('read_at', null);
  }

  async function sendMessage() {
    if (!family || !body.trim() || sending) return;
    setSending(true);
    const msgBody = body.trim();
    setBody('');
    const { data } = await supabase
      .from('direct_messages')
      .insert({ from_family_id: family.id, to_family_id: otherId, body: msgBody })
      .select('*')
      .single();
    if (data) setMessages(prev => [data, ...prev]);
    setSending(false);
    notifyFamily(otherId, `💬 ${family.name}`, msgBody).catch(() => {});
  }

  function formatTime(iso: string) {
    const d = new Date(iso);
    if (d.toDateString() === new Date().toDateString()) {
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  const renderMessage = ({ item }: { item: DirectMessage }) => {
    const isOwn = item.from_family_id === family?.id;
    return (
      <View style={[styles.msgRow, isOwn ? styles.msgRowOwn : styles.msgRowOther]}>
        <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
          <Text style={[styles.bubbleText, isOwn && styles.bubbleTextOwn]}>{item.body}</Text>
          <Text style={[styles.bubbleTime, isOwn && styles.bubbleTimeOwn]}>{formatTime(item.created_at)}</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerName} numberOfLines={1}>{otherName}</Text>
        <View style={{ width: 60 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {messages.length === 0 ? (
          <View style={[styles.empty, { flex: 1 }]}>
            <Text style={styles.emptyText}>Send the first message to {otherName}!</Text>
          </View>
        ) : (
          <FlatList
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            inverted
            contentContainerStyle={styles.list}
          />
        )}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder={`Message ${otherName}...`}
            placeholderTextColor={colors.textMuted}
            value={body}
            onChangeText={setBody}
            multiline
          />
          <TouchableOpacity
            style={[styles.sendBtn, !body.trim() && styles.sendBtnDisabled]}
            onPress={sendMessage}
            disabled={sending || !body.trim()}
          >
            <Text style={styles.sendIcon}>↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight, backgroundColor: colors.card,
  },
  back: { fontSize: 16, color: colors.primary, fontWeight: '600', width: 60 },
  headerName: { fontSize: 17, fontWeight: '800', color: colors.text, flex: 1, textAlign: 'center' },
  list: { paddingHorizontal: 16, paddingBottom: 8 },
  msgRow: { marginBottom: 6 },
  msgRowOwn: { alignItems: 'flex-end' },
  msgRowOther: { alignItems: 'flex-start' },
  bubble: { maxWidth: '78%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleOther: { backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.borderLight },
  bubbleOwn: { backgroundColor: colors.sage },
  bubbleText: { fontSize: 15, color: colors.text, lineHeight: 21 },
  bubbleTextOwn: { color: '#fff' },
  bubbleTime: { fontSize: 10, color: colors.textMuted, marginTop: 4, textAlign: 'right' },
  bubbleTimeOwn: { color: 'rgba(255,255,255,0.65)' },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 16,
    paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.borderLight,
    backgroundColor: colors.card,
  },
  input: {
    flex: 1, backgroundColor: colors.background, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: colors.text,
    maxHeight: 100,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: colors.sage,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: colors.border },
  sendIcon: { fontSize: 18, color: '#fff', fontWeight: '800' },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 15, color: colors.textMuted, fontWeight: '500', textAlign: 'center' },
});
