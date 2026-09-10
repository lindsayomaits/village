import { useState, useEffect, useCallback } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { useRouter } from 'expo-router';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import type { RequestComment } from '../types';

// A thread anchored to a request, visible to everyone who can see the
// request (requester, fulfiller, connections). Replaces the old
// "Chat about this request" DM-prefill trick.
export function RequestComments({ requestId }: { requestId: string }) {
  const { family } = useAuth();
  const router = useRouter();
  const [comments, setComments] = useState<RequestComment[]>([]);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('request_comments')
      .select('*, family:families!family_id(id, name, animal, photo_url)')
      .eq('request_id', requestId)
      .order('created_at', { ascending: true });
    setComments((data ?? []) as RequestComment[]);
  }, [requestId]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`request_comments_${requestId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'request_comments', filter: `request_id=eq.${requestId}` },
        () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [requestId, load]);

  async function post() {
    if (!family || !body.trim() || sending) return;
    setSending(true);
    const text = body.trim();
    setBody('');
    const { error } = await supabase
      .from('request_comments')
      .insert({ request_id: requestId, family_id: family.id, body: text });
    setSending(false);
    if (error) { setBody(text); return Alert.alert('Error', error.message); }
    await load();
    supabase.rpc('notify_request_comment', { p_request_id: requestId, p_body: text }).then(() => {});
  }

  async function remove(id: string) {
    Alert.alert('Delete this comment?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await supabase.from('request_comments').delete().eq('id', id);
          setComments(prev => prev.filter(c => c.id !== id));
        },
      },
    ]);
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Comments</Text>
      {comments.length === 0 ? (
        <Text style={styles.empty}>No comments yet — ask a question or leave a note here so everyone following this request can see it.</Text>
      ) : (
        comments.map(c => {
          const mine = c.family_id === family?.id;
          return (
            <View key={c.id} style={styles.comment}>
              <TouchableOpacity onPress={() => c.family && router.push(`/profile/${c.family.id}`)} disabled={!c.family}>
                <Avatar familyId={c.family_id} animal={c.family?.animal} photoUrl={c.family?.photo_url} size={30} />
              </TouchableOpacity>
              <View style={styles.commentBody}>
                <View style={styles.commentHead}>
                  <Text style={styles.commentName}>{mine ? 'You' : (c.family?.name ?? 'Someone')}</Text>
                  <Text style={styles.commentTime}>{new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</Text>
                </View>
                <Text style={styles.commentText}>{c.body}</Text>
                {mine && (
                  <TouchableOpacity onPress={() => remove(c.id)}>
                    <Text style={styles.deleteLink}>Delete</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Add a comment..."
          placeholderTextColor={colors.textMuted}
          value={body}
          onChangeText={setBody}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendBtn, !body.trim() && styles.sendBtnDisabled]}
          onPress={post}
          disabled={sending || !body.trim()}
        >
          <Text style={styles.sendIcon}>↑</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 20 },
  label: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  empty: { fontSize: 13, color: colors.textMuted, lineHeight: 19, marginBottom: 12 },
  comment: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  commentBody: { flex: 1, gap: 2 },
  commentHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  commentName: { fontSize: 13, fontWeight: '700', color: colors.text },
  commentTime: { fontSize: 11, color: colors.textMuted },
  commentText: { fontSize: 14, color: colors.text, lineHeight: 20 },
  deleteLink: { fontSize: 12, color: colors.red, fontWeight: '600', marginTop: 2 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 4 },
  input: {
    flex: 1, backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: colors.text, maxHeight: 100,
  },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.sage, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: colors.border },
  sendIcon: { fontSize: 17, color: '#fff', fontWeight: '800' },
});
