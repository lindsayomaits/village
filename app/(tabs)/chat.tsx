import { useState, useEffect, useCallback } from 'react';
import {
  View, StyleSheet, FlatList, TextInput, TouchableOpacity,
  Alert, KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { Text } from '../../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors } from '../../lib/theme';
import { getFamilyAnimal } from '../../lib/animals';
import { notifyVillage } from '../../lib/notifications';
import type { Post, Family, PostReaction } from '../../types';

type Tab = 'village' | 'direct';
type NotifPref = 'all' | 'mentions' | 'muted';

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👎'];

function getMentionAtCursor(text: string, cursor: number): string | null {
  const before = text.slice(0, cursor);
  const match = before.match(/@([^\s]*)$/);
  return match ? match[1] : null;
}

function extractMentionedIds(body: string, allFamilies: Family[]): string[] {
  const ids: string[] = [];
  for (const f of allFamilies) {
    const escaped = f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`@${escaped}(?:\\s|$)`).test(body)) ids.push(f.id);
  }
  return ids;
}

function MentionText({
  body, allFamilies, myFamilyId, isOwn,
}: {
  body: string; allFamilies: Family[]; myFamilyId: string; isOwn: boolean;
}) {
  const names = allFamilies.map(f => f.name).sort((a, b) => b.length - a.length);
  if (names.length === 0) {
    return <Text style={[styles.bubbleText, isOwn && styles.bubbleTextOwn]}>{body}</Text>;
  }
  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`@(${escaped.join('|')})`, 'g');
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(body)) !== null) {
    if (m.index > last) parts.push(body.slice(last, m.index));
    const mentioned = allFamilies.find(f => f.name === m![1]);
    const isMe = mentioned?.id === myFamilyId;
    parts.push(
      <Text key={m.index} style={[styles.mention, isOwn ? styles.mentionOwn : styles.mentionOther, isMe && (isOwn ? styles.mentionMeOwn : styles.mentionMe)]}>
        {m[0]}
      </Text>
    );
    last = pattern.lastIndex;
  }
  if (last < body.length) parts.push(body.slice(last));
  return <Text style={[styles.bubbleText, isOwn && styles.bubbleTextOwn]}>{parts}</Text>;
}

export default function ChatScreen() {
  const { family } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('village');

  const [posts, setPosts] = useState<Post[]>([]);
  const [mutes, setMutes] = useState<Set<string>>(new Set());
  const [postBody, setPostBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [notifPref, setNotifPref] = useState<NotifPref>('all');
  const [cursorPos, setCursorPos] = useState(0);
  const [reactionTarget, setReactionTarget] = useState<Post | null>(null);

  const [families, setFamilies] = useState<Family[]>([]);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

  const mentionQuery = getMentionAtCursor(postBody, cursorPos);
  const mentionResults = mentionQuery !== null
    ? families.filter(f => f.name.toLowerCase().startsWith(mentionQuery.toLowerCase())).slice(0, 5)
    : [];

  useFocusEffect(useCallback(() => {
    loadPosts();
    loadMutes();
    loadFamilies();
    loadUnreadCounts();
    setNotifPref(family?.village_notifications ?? 'all');
  }, [family?.id]));

  useEffect(() => {
    const channel = supabase
      .channel('village_chat_rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, async (payload) => {
        const newId = (payload.new as Post).id;
        const { data } = await supabase
          .from('posts')
          .select('*, family:families_public!family_id(*), reactions:post_reactions(*)')
          .eq('id', newId)
          .single();
        if (data) setPosts(prev => prev.some(p => p.id === newId) ? prev : [data, ...prev]);
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'posts' }, (payload) => {
        setPosts(prev => prev.filter(p => p.id !== (payload.old as { id: string }).id));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'post_reactions' }, () => { loadPosts(); })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'post_reactions' }, () => { loadPosts(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (!family) return;
    const channel = supabase
      .channel('dm_unread_rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages',
        filter: `to_family_id=eq.${family.id}` }, () => { loadUnreadCounts(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [family?.id]);

  async function loadPosts() {
    const { data, error } = await supabase
      .from('posts')
      .select('*, family:families_public!family_id(*), reactions:post_reactions(*)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      // eslint-disable-next-line no-console
      console.error('loadPosts error', error);
      Alert.alert('Error', 'Could not load posts. Check your connection.');
      return;
    }
    setPosts(data ?? []);
  }

  async function loadMutes() {
    if (!family) return;
    const { data, error } = await supabase.from('mutes').select('muted_family_id').eq('family_id', family.id);
    if (error) {
      // eslint-disable-next-line no-console
      console.error('loadMutes error', error);
      return;
    }
    setMutes(new Set((data ?? []).map((m: { muted_family_id: string }) => m.muted_family_id)));
  }

  async function loadFamilies() {
    if (!family) return;
    const { data, error } = await supabase.from('families_public').select('*').neq('id', family.id).order('name');
    if (error) {
      // eslint-disable-next-line no-console
      console.error('loadFamilies error', error);
      return;
    }
    setFamilies(data ?? []);
  }

  async function loadUnreadCounts() {
    if (!family) return;
    const { data, error } = await supabase
      .from('direct_messages').select('from_family_id')
      .eq('to_family_id', family.id).is('read_at', null);
    if (error) {
      // eslint-disable-next-line no-console
      console.error('loadUnreadCounts error', error);
      return;
    }
    const counts: Record<string, number> = {};
    for (const row of (data ?? [])) counts[row.from_family_id] = (counts[row.from_family_id] ?? 0) + 1;
    setUnreadCounts(counts);
  }

  async function cycleNotifPref() {
    if (!family) return;
    const prev = notifPref;
    const next: NotifPref = notifPref === 'all' ? 'mentions' : notifPref === 'mentions' ? 'muted' : 'all';
    setNotifPref(next);
    const { error } = await supabase.from('families').update({ village_notifications: next }).eq('id', family.id);
    if (error) {
      // revert
      setNotifPref(prev);
      // eslint-disable-next-line no-console
      console.error('cycleNotifPref error', error);
      Alert.alert('Error', 'Could not update notification preferences.');
    }
  }

  function insertMention(f: Family) {
    const before = postBody.slice(0, cursorPos);
    const after = postBody.slice(cursorPos);
    const newText = before.replace(/@[^\s]*$/, `@${f.name} `) + after;
    setPostBody(newText);
    setCursorPos(before.replace(/@[^\s]*$/, `@${f.name} `).length);
  }

  async function sendPost() {
    if (!family || !postBody.trim()) return;
    setPosting(true);
    const body = postBody.trim();
    setPostBody('');
    setCursorPos(0);

    const { data, error } = await supabase
      .from('posts')
      .insert({ family_id: family.id, body })
      .select('*, family:families_public!family_id(*), reactions:post_reactions(*)')
      .single();

    if (error) {
      setPostBody(body);
      setPosting(false);
      return Alert.alert('Could not send', error.message);
    }

    if (data) setPosts(prev => [data, ...prev]);
    notifyVillage(family.id, family.name, body, extractMentionedIds(body, families)).catch(() => {});
    setPosting(false);
  }

  async function toggleReaction(postId: string, emoji: string) {
    if (!family) return;
    const post = posts.find(p => p.id === postId);
    const existing = post?.reactions?.find(r => r.family_id === family.id && r.emoji === emoji);

    if (existing) {
      const { error } = await supabase.from('post_reactions').delete().eq('id', existing.id);
      if (error) {
        // eslint-disable-next-line no-console
        console.error('toggleReaction delete error', error);
        Alert.alert('Error', 'Could not remove reaction.');
        return;
      }
      setPosts(prev => prev.map(p => p.id !== postId ? p : {
        ...p, reactions: (p.reactions ?? []).filter(r => r.id !== existing.id),
      }));
    } else {
      const temp: PostReaction = { id: `temp-${Date.now()}`, post_id: postId, family_id: family.id, emoji, created_at: new Date().toISOString() };
      setPosts(prev => prev.map(p => p.id !== postId ? p : { ...p, reactions: [...(p.reactions ?? []), temp] }));
      const { error } = await supabase.from('post_reactions').insert({ post_id: postId, family_id: family.id, emoji });
      if (error) {
        // rollback temp reaction
        setPosts(prev => prev.map(p => p.id !== postId ? p : ({ ...p, reactions: (p.reactions ?? []).filter(r => !r.id?.toString().startsWith('temp-')) })));
        // eslint-disable-next-line no-console
        console.error('toggleReaction insert error', error);
        Alert.alert('Error', 'Could not add reaction.');
      }
    }
  }

  async function deletePost(post: Post) {
    const { error } = await supabase.from('posts').delete().eq('id', post.id);
    if (error) return Alert.alert('Error', error.message);
    setPosts(prev => prev.filter(p => p.id !== post.id));
  }

  async function toggleMute(familyId: string) {
    if (!family) return;
    const isMuted = mutes.has(familyId);
    if (isMuted) {
      const { error } = await supabase.from('mutes').delete().eq('family_id', family.id).eq('muted_family_id', familyId);
      if (error) {
        // eslint-disable-next-line no-console
        console.error('toggleMute unmute error', error);
        Alert.alert('Error', 'Could not unmute.');
        return;
      }
      setMutes(prev => { const next = new Set(prev); next.delete(familyId); return next; });
    } else {
      const { error } = await supabase.from('mutes').insert({ family_id: family.id, muted_family_id: familyId });
      if (error) {
        // eslint-disable-next-line no-console
        console.error('toggleMute mute error', error);
        Alert.alert('Error', 'Could not mute.');
        return;
      }
      setMutes(prev => new Set([...prev, familyId]));
    }
  }

  function formatTime(iso: string) {
    const d = new Date(iso);
    if (d.toDateString() === new Date().toDateString()) {
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  const renderPost = ({ item }: { item: Post }) => {
    const isOwn = item.family_id === family?.id;

    const reactionGroups = (item.reactions ?? []).reduce((acc, r) => {
      if (!acc[r.emoji]) acc[r.emoji] = { count: 0, isMine: false };
      acc[r.emoji].count++;
      if (r.family_id === family?.id) acc[r.emoji].isMine = true;
      return acc;
    }, {} as Record<string, { count: number; isMine: boolean }>);

    return (
      <TouchableOpacity onLongPress={() => setReactionTarget(item)} activeOpacity={0.85}>
        <View style={[styles.postRow, isOwn ? styles.postRowOwn : styles.postRowOther]}>
          <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
            <Text style={[styles.bubbleFamily, isOwn && styles.bubbleFamilyOwn]}>
              {getFamilyAnimal(item.family_id, item.family?.animal)}{'  '}{item.family?.name ?? (isOwn ? family?.name : '…')}
            </Text>
            <MentionText body={item.body} allFamilies={families} myFamilyId={family?.id ?? ''} isOwn={isOwn} />
            <Text style={[styles.bubbleTime, isOwn && styles.bubbleTimeOwn]}>{formatTime(item.created_at)}</Text>
            {Object.keys(reactionGroups).length > 0 && (
              <View style={styles.reactionsRow}>
                {Object.entries(reactionGroups).map(([emoji, { count, isMine }]) => (
                  <TouchableOpacity
                    key={emoji}
                    style={[styles.reactionPill, isMine && styles.reactionPillMine]}
                    onPress={() => toggleReaction(item.id, emoji)}
                    accessibilityRole="button"
                    accessibilityLabel={`${emoji} reaction, ${count} ${count === 1 ? 'person' : 'people'}${isMine ? ', including you' : ''}. Tap to toggle.`}
                  >
                    <Text style={styles.reactionPillText}>{emoji} {count}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderFamily = ({ item }: { item: Family }) => {
    const unread = unreadCounts[item.id] ?? 0;
    return (
      <TouchableOpacity
        style={styles.dmRow}
        onPress={() => router.push({ pathname: '/dm/[familyId]', params: { familyId: item.id, name: item.name } })}
      >
        <View style={styles.dmAvatar}>
          <Text style={styles.dmAvatarText}>{getFamilyAnimal(item.id, item.animal)}</Text>
        </View>
        <Text style={styles.dmName}>{item.name}</Text>
        {unread > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadText}>{unread}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const visiblePosts = posts.filter(p => !mutes.has(p.family_id));
  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);
  const notifLabel = notifPref === 'all' ? 'All' : notifPref === 'mentions' ? 'Mentions' : 'Muted';
  const notifIcon = notifPref === 'muted' ? '🔕' : '🔔';
  const targetIsOwn = reactionTarget?.family_id === family?.id;
  const targetIsMuted = mutes.has(reactionTarget?.family_id ?? '');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Messages</Text>
        {tab === 'village' && (
          <TouchableOpacity style={styles.notifBtn} onPress={cycleNotifPref}>
            <Text style={styles.notifIcon}>{notifIcon}</Text>
            <Text style={styles.notifText}>{notifLabel}</Text>
          </TouchableOpacity>
        )}
      </View>

      {!family && (
        <View style={styles.unlinkBanner}>
          <Text style={styles.unlinkText}>
            ⚠️ Your account isn't linked to a family yet — you can read but not post. Ask your partner to check the Profile tab and re-send the partner invite, or contact your admin.
          </Text>
        </View>
      )}

      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, tab === 'village' && styles.tabActive]} onPress={() => setTab('village')}>
          <Text style={[styles.tabText, tab === 'village' && styles.tabTextActive]}>VillageMates Chat</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'direct' && styles.tabActive]} onPress={() => setTab('direct')}>
          <Text style={[styles.tabText, tab === 'direct' && styles.tabTextActive]}>
            Direct{totalUnread > 0 ? ` (${totalUnread})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {tab === 'village' ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
          {visiblePosts.length === 0 ? (
            <View style={[styles.empty, { flex: 1 }]}>
              <Text style={styles.emptyIcon}>💬</Text>
              <Text style={styles.emptyText}>No messages yet — say hi to your VillageMates!</Text>
            </View>
          ) : (
            <FlatList
              data={visiblePosts}
              keyExtractor={(item) => item.id}
              renderItem={renderPost}
              inverted
              contentContainerStyle={styles.postList}
            />
          )}
          {mentionQuery !== null && mentionResults.length > 0 && (
            <View style={styles.mentionDropdown}>
              {mentionResults.map(f => (
                <TouchableOpacity key={f.id} style={styles.mentionItem} onPress={() => insertMention(f)}>
                  <Text style={styles.mentionItemEmoji}>{getFamilyAnimal(f.id, f.animal)}</Text>
                  <Text style={styles.mentionItemName}>{f.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="Message your VillageMates..."
              placeholderTextColor={colors.textMuted}
              value={postBody}
              onChangeText={(text) => { setPostBody(text); setCursorPos(text.length); }}
              onSelectionChange={(e) => setCursorPos(e.nativeEvent.selection.end)}
              multiline
            />
            <TouchableOpacity
              style={[styles.sendBtn, !postBody.trim() && styles.sendBtnDisabled]}
              onPress={sendPost}
              disabled={posting || !postBody.trim()}
            >
              <Text style={styles.sendIcon}>↑</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      ) : (
        <FlatList
          data={families}
          keyExtractor={(item) => item.id}
          renderItem={renderFamily}
          contentContainerStyle={styles.dmList}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>👥</Text>
              <Text style={styles.emptyText}>No other families yet</Text>
            </View>
          }
        />
      )}

      {/* Reaction bottom sheet */}
      <Modal
        visible={!!reactionTarget}
        transparent
        animationType="slide"
        onRequestClose={() => setReactionTarget(null)}
      >
        <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setReactionTarget(null)} />
        <View style={styles.reactionSheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetHint}>Hold to react · tap to toggle</Text>
          <View style={styles.emojiRow}>
            {REACTION_EMOJIS.map(emoji => {
              const isMine = reactionTarget?.reactions?.some(r => r.family_id === family?.id && r.emoji === emoji);
              return (
                <TouchableOpacity
                  key={emoji}
                  style={[styles.emojiBtn, isMine && styles.emojiBtnActive]}
                  onPress={() => { if (reactionTarget) toggleReaction(reactionTarget.id, emoji); setReactionTarget(null); }}
                  accessibilityRole="button"
                  accessibilityLabel={`React with ${emoji}`}
                >
                  <Text style={styles.emojiChar}>{emoji}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.sheetActions}>
            {targetIsOwn ? (
              <TouchableOpacity
                style={styles.sheetActionBtn}
                onPress={() => {
                  if (reactionTarget) {
                    Alert.alert('Delete this message?', undefined, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => deletePost(reactionTarget) },
                    ]);
                  }
                  setReactionTarget(null);
                }}
              >
                <Text style={styles.deleteText}>Delete message</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.sheetActionBtn}
                onPress={() => {
                  if (reactionTarget) toggleMute(reactionTarget.family_id);
                  setReactionTarget(null);
                }}
              >
                <Text style={styles.muteText}>{targetIsMuted ? 'Unmute their posts' : 'Mute their posts'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.sheetCancelBtn} onPress={() => setReactionTarget(null)}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, marginBottom: 12 },
  title: { fontSize: 24, fontWeight: '800', color: colors.text },
  notifBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border },
  notifIcon: { fontSize: 14 },
  notifText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  tabs: { flexDirection: 'row', paddingHorizontal: 20, gap: 8, marginBottom: 12 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 20, backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center' },
  tabActive: { backgroundColor: colors.sage, borderColor: colors.sage },
  tabText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  tabTextActive: { color: '#fff' },
  postList: { paddingHorizontal: 16, paddingBottom: 8 },
  postRow: { marginBottom: 8 },
  postRowOwn: { alignItems: 'flex-end' },
  postRowOther: { alignItems: 'flex-start' },
  bubble: { maxWidth: '82%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleOther: { backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.borderLight },
  bubbleOwn: { backgroundColor: colors.sage },
  bubbleFamily: { fontSize: 11, fontWeight: '700', color: colors.sageDark, marginBottom: 3 },
  bubbleFamilyOwn: { color: 'rgba(255,255,255,0.75)' },
  bubbleText: { fontSize: 15, color: colors.text, lineHeight: 21 },
  bubbleTextOwn: { color: '#fff' },
  bubbleTime: { fontSize: 10, color: colors.textMuted, marginTop: 4, textAlign: 'right' },
  bubbleTimeOwn: { color: 'rgba(255,255,255,0.6)' },
  mention: { fontWeight: '700' },
  mentionOther: { color: colors.sageDark },
  mentionOwn: { color: 'rgba(255,255,255,0.95)' },
  mentionMe: { color: colors.primary },
  mentionMeOwn: { color: '#fff', textDecorationLine: 'underline' },
  reactionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 8 },
  reactionPill: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.08)', borderRadius: 14,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  reactionPillMine: { backgroundColor: colors.primaryLight, borderWidth: 1.5, borderColor: colors.primary },
  reactionPillText: { fontSize: 17, fontWeight: '600', color: colors.text },
  mentionDropdown: { borderTopWidth: 1, borderTopColor: colors.borderLight, backgroundColor: colors.card },
  mentionItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  mentionItemEmoji: { fontSize: 18 },
  mentionItemName: { fontSize: 15, fontWeight: '600', color: colors.text },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.borderLight, backgroundColor: colors.card },
  input: { flex: 1, backgroundColor: colors.background, borderWidth: 1.5, borderColor: colors.border, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: colors.text, maxHeight: 100 },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.sage, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: colors.border },
  sendIcon: { fontSize: 18, color: '#fff', fontWeight: '800' },
  dmList: { paddingHorizontal: 20, paddingTop: 4 },
  dmRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 16, padding: 14, marginBottom: 8, borderWidth: 1.5, borderColor: colors.borderLight },
  dmAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.sageLight, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  dmAvatarText: { fontSize: 22 },
  dmName: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  unreadBadge: { backgroundColor: colors.primary, borderRadius: 12, minWidth: 24, height: 24, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  unreadText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 40, marginBottom: 10 },
  emptyText: { fontSize: 15, color: colors.textMuted, fontWeight: '500', textAlign: 'center' },

  unlinkBanner: {
    backgroundColor: '#FFF3CD', borderRadius: 12, marginHorizontal: 16,
    marginBottom: 10, padding: 12, borderWidth: 1, borderColor: '#FFCC00',
  },
  unlinkText: { fontSize: 13, color: '#7A5F00', lineHeight: 18, fontWeight: '500' },

  // Reaction sheet
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  reactionSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingBottom: 44,
  },
  sheetHandle: { width: 40, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 8 },
  sheetHint: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginBottom: 16, fontWeight: '500' },
  emojiRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 20 },
  emojiBtn: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.background,
  },
  emojiBtnActive: { backgroundColor: colors.primaryLight, borderWidth: 2, borderColor: colors.primary },
  emojiChar: { fontSize: 28 },
  sheetActions: { borderTopWidth: 1, borderTopColor: colors.borderLight },
  sheetActionBtn: { paddingVertical: 16, alignItems: 'center' },
  deleteText: { fontSize: 16, fontWeight: '700', color: colors.red },
  muteText: { fontSize: 16, fontWeight: '600', color: colors.textSecondary },
  sheetCancelBtn: { paddingVertical: 12, alignItems: 'center' },
  sheetCancelText: { fontSize: 15, color: colors.textMuted, fontWeight: '500' },
});
