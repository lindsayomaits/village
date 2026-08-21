import { useState, useEffect } from 'react';
import {
  View, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { Text } from '../../components/Text';
import { Avatar } from '../../components/Avatar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors } from '../../lib/theme';
import { getFamilyAnimal } from '../../lib/animals';
import type { GroupChat, GroupChatMember, GroupMessage } from '../../types';

export default function GroupChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { family } = useAuth();
  const router = useRouter();

  const [group, setGroup] = useState<GroupChat | null>(null);
  const [members, setMembers] = useState<GroupChatMember[]>([]);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [showMembers, setShowMembers] = useState(false);

  useEffect(() => {
    if (!id || !family) return;
    loadGroup();
    loadMembers();
    loadMessages();
    markRead();

    const channel = supabase
      .channel(`group_thread_${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages', filter: `group_id=eq.${id}` }, async (payload) => {
        const msgId = (payload.new as GroupMessage).id;
        const { data } = await supabase
          .from('group_messages')
          .select('*, from_family:families!from_family_id(*)')
          .eq('id', msgId)
          .single();
        if (data) setMessages(prev => prev.some(m => m.id === data.id) ? prev : [data, ...prev]);
        markRead();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [id, family?.id]);

  async function loadGroup() {
    const { data } = await supabase.from('group_chats').select('*').eq('id', id).single();
    setGroup(data ?? null);
  }

  async function loadMembers() {
    const { data } = await supabase
      .from('group_chat_members')
      .select('*, family:families!family_id(*)')
      .eq('group_id', id);
    setMembers(data ?? []);
  }

  async function loadMessages() {
    const { data } = await supabase
      .from('group_messages')
      .select('*, from_family:families!from_family_id(*)')
      .eq('group_id', id)
      .order('created_at', { ascending: false });
    setMessages(data ?? []);
  }

  async function markRead() {
    if (!family || !id) return;
    // Composite PK (group_id, family_id) — must name it explicitly or
    // PostgREST can't resolve the conflict target and the upsert silently
    // no-ops on repeat visits, leaving last_read_at stuck at the seed value
    // from group creation and the unread badge never clearing.
    const { error } = await supabase
      .from('group_message_reads')
      .upsert({ group_id: id, family_id: family.id, last_read_at: new Date().toISOString() }, { onConflict: 'group_id,family_id' });
    if (error) {
      // eslint-disable-next-line no-console
      console.error('markRead (group) error', error);
    }
  }

  async function sendMessage() {
    if (!family || !id || !body.trim() || sending) return;
    setSending(true);
    const msgBody = body.trim();
    setBody('');
    const { data } = await supabase
      .from('group_messages')
      .insert({ group_id: id, from_family_id: family.id, body: msgBody })
      .select('*, from_family:families!from_family_id(*)')
      .single();
    if (data) setMessages(prev => [data, ...prev]);
    setSending(false);
    await markRead();
    supabase.rpc('notify_group_message', { p_group_id: id, p_sender_name: family.name, p_body: msgBody }).then(() => {});
  }

  async function leaveGroup() {
    Alert.alert('Leave this group?', `You'll stop seeing "${group?.name}" and its messages.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave', style: 'destructive', onPress: async () => {
          if (!family || !id) return;
          const { error } = await supabase.from('group_chat_members').delete().eq('group_id', id).eq('family_id', family.id);
          if (error) return Alert.alert('Error', error.message);
          router.back();
        },
      },
    ]);
  }

  function formatTime(iso: string) {
    const d = new Date(iso);
    if (d.toDateString() === new Date().toDateString()) {
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  const renderMessage = ({ item }: { item: GroupMessage }) => {
    const isOwn = item.from_family_id === family?.id;
    return (
      <View style={[styles.msgRow, isOwn ? styles.msgRowOwn : styles.msgRowOther]}>
        {!isOwn && (
          <View style={styles.msgAvatarWrap}>
            <Avatar familyId={item.from_family_id} animal={item.from_family?.animal} photoUrl={item.from_family?.photo_url} size={26} />
          </View>
        )}
        <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
          {!isOwn && <Text style={styles.bubbleSender}>{item.from_family?.name ?? 'Someone'}</Text>}
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
        <TouchableOpacity style={styles.headerCenter} onPress={() => setShowMembers(v => !v)}>
          <Text style={styles.headerName} numberOfLines={1}>{group?.name ?? 'Group'}</Text>
          <Text style={styles.headerSub}>{members.length} {members.length === 1 ? 'person' : 'people'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={leaveGroup}>
          <Text style={styles.leaveText}>Leave</Text>
        </TouchableOpacity>
      </View>

      {showMembers && (
        <View style={styles.membersPanel}>
          {members.map(m => (
            <View key={m.family_id} style={styles.memberRow}>
              <Avatar familyId={m.family_id} animal={m.family?.animal} photoUrl={m.family?.photo_url} size={24} />
              <Text style={styles.memberName}>{m.family?.name ?? '…'}{m.family_id === family?.id ? ' (you)' : ''}</Text>
            </View>
          ))}
        </View>
      )}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {messages.length === 0 ? (
          <View style={[styles.empty, { flex: 1 }]}>
            <Text style={styles.emptyText}>Send the first message to the group!</Text>
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
            placeholder={`Message ${group?.name ?? 'the group'}...`}
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
  back: { fontSize: 16, color: colors.primary, fontWeight: '600', width: 56 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerName: { fontSize: 17, fontWeight: '800', color: colors.text, textAlign: 'center' },
  headerSub: { fontSize: 11, color: colors.textMuted, fontWeight: '600', marginTop: 1 },
  leaveText: { fontSize: 13, color: colors.red, fontWeight: '600', width: 56, textAlign: 'right' },

  membersPanel: {
    backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.borderLight,
    paddingHorizontal: 20, paddingVertical: 12, gap: 10,
  },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  memberName: { fontSize: 14, fontWeight: '600', color: colors.text },

  list: { paddingHorizontal: 16, paddingBottom: 8 },
  msgRow: { marginBottom: 8, flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  msgRowOwn: { justifyContent: 'flex-end' },
  msgRowOther: { justifyContent: 'flex-start' },
  msgAvatarWrap: { marginBottom: 2 },
  bubble: { maxWidth: '74%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleOther: { backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.borderLight },
  bubbleOwn: { backgroundColor: colors.sage },
  bubbleSender: { fontSize: 11, fontWeight: '700', color: colors.sageDark, marginBottom: 3 },
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
