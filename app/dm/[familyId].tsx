import { useState, useEffect } from 'react';
import {
  View, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, Modal, Alert,
} from 'react-native';
import { Text } from '../../components/Text';
import { Avatar } from '../../components/Avatar';
import { RichText } from '../../components/RichText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors } from '../../lib/theme';
import { getFamilyAnimal } from '../../lib/animals';
import { notifyFamily } from '../../lib/notifications';
import { lastNamesLabel } from '../../lib/utils';
import { getActiveTrigger, extractTaggedRequests, type MentionEntry } from '../../lib/richText';
import { PersonProfileModal } from '../../components/PersonProfileModal';
import type { DirectMessage, Family, Request } from '../../types';

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👎'];

export default function DMScreen() {
  const { familyId, name, prefill } = useLocalSearchParams<{ familyId: string; name: string; prefill?: string }>();
  const { family } = useAuth();
  const router = useRouter();
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  // Lazy init — only relevant coming from "Chat about this request", where
  // the route is fresh-mounted with a prefill param; never re-applied on
  // re-renders so it can't clobber what the person is actually typing.
  const [body, setBody] = useState(() => prefill ?? '');
  const [sending, setSending] = useState(false);
  const [otherFamily, setOtherFamily] = useState<Family | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [reactionTarget, setReactionTarget] = useState<DirectMessage | null>(null);
  const [cursorPos, setCursorPos] = useState(0);
  const [openRequests, setOpenRequests] = useState<Request[]>([]);

  const otherName = otherFamily ? lastNamesLabel(otherFamily) : (Array.isArray(name) ? name[0] : (name ?? ''));
  const otherId = Array.isArray(familyId) ? familyId[0] : (familyId ?? '');

  // Only the other person in this thread is taggable via @ — it's 1:1.
  const mentionEntries: MentionEntry[] = otherFamily
    ? [{ label: otherFamily.parent1_name?.trim() || otherFamily.name, familyId: otherId, animal: otherFamily.animal }]
    : [];

  const activeTrigger = getActiveTrigger(body, cursorPos);
  const mentionResults = activeTrigger?.type === '@'
    ? mentionEntries.filter(e => e.label.toLowerCase().startsWith(activeTrigger.query.toLowerCase()))
    : [];
  const requestResults = activeTrigger?.type === '#'
    ? openRequests.filter(r => r.title.toLowerCase().startsWith(activeTrigger.query.toLowerCase())).slice(0, 5)
    : [];

  useEffect(() => {
    loadMessages();
    loadOtherFamily();
    loadConnectionStatus();
    loadMuteStatus();
    loadOpenRequests();
    markRead();

    const channel = supabase
      .channel(`dm_thread_${otherId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, (payload) => {
        const msg = payload.new as DirectMessage;
        const isRelevant =
          (msg.from_family_id === family?.id && msg.to_family_id === otherId) ||
          (msg.from_family_id === otherId && msg.to_family_id === family?.id);
        if (!isRelevant) return;
        setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [{ ...msg, reactions: [] }, ...prev]);
        if (msg.to_family_id === family?.id) {
          supabase.from('direct_messages').update({ read_at: new Date().toISOString() }).eq('id', msg.id);
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'direct_messages' }, (payload) => {
        setMessages(prev => prev.filter(m => m.id !== (payload.old as { id: string }).id));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_reactions' }, () => { loadMessages(); })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'dm_reactions' }, () => { loadMessages(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [otherId]);

  async function loadOtherFamily() {
    const { data } = await supabase.from('families').select('*').eq('id', otherId).single();
    if (data) setOtherFamily(data);
  }

  async function loadOpenRequests() {
    // Only live requests are worth tagging with #, and this list is fed to
    // a regex builder on every message render — keep it small.
    const { data } = await supabase
      .from('requests')
      .select('*')
      .eq('post_type', 'request')
      .in('status', ['open', 'offered', 'accepted'])
      .order('created_at', { ascending: false })
      .limit(50);
    setOpenRequests(data ?? []);
  }

  async function loadConnectionStatus() {
    if (!family) return;
    const { data } = await supabase
      .from('connections')
      .select('status')
      .eq('status', 'accepted')
      .or(`and(requester_id.eq.${family.id},recipient_id.eq.${otherId}),and(requester_id.eq.${otherId},recipient_id.eq.${family.id})`)
      .maybeSingle();
    setIsConnected(!!data);
  }

  async function loadMuteStatus() {
    if (!family) return;
    const { data } = await supabase
      .from('mutes').select('family_id')
      .eq('family_id', family.id).eq('muted_family_id', otherId)
      .maybeSingle();
    setIsMuted(!!data);
  }

  async function toggleMuteThread() {
    if (!family) return;
    if (isMuted) {
      const { error } = await supabase.from('mutes').delete().eq('family_id', family.id).eq('muted_family_id', otherId);
      if (error) return Alert.alert('Error', 'Could not unmute.');
      setIsMuted(false);
    } else {
      const { error } = await supabase.from('mutes').insert({ family_id: family.id, muted_family_id: otherId });
      if (error) return Alert.alert('Error', 'Could not mute.');
      setIsMuted(true);
    }
  }

  async function loadMessages() {
    if (!family) return;
    const { data } = await supabase
      .from('direct_messages')
      .select('*, reactions:dm_reactions(*)')
      .or(`and(from_family_id.eq.${family.id},to_family_id.eq.${otherId}),and(from_family_id.eq.${otherId},to_family_id.eq.${family.id})`)
      .order('created_at', { ascending: false })
      .limit(100);
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

  function insertMention(entry: MentionEntry) {
    const before = body.slice(0, cursorPos);
    const after = body.slice(cursorPos);
    const newBefore = before.replace(/@[^\s]*$/, `@${entry.label} `);
    setBody(newBefore + after);
    setCursorPos(newBefore.length);
  }

  function insertRequestTag(req: Request) {
    const before = body.slice(0, cursorPos);
    const after = body.slice(cursorPos);
    const newBefore = before.replace(/#[^\s]*$/, `#${req.title} `);
    setBody(newBefore + after);
    setCursorPos(newBefore.length);
  }

  function goToTaggedRequest(req: Request) {
    router.push(`/request/${req.id}`);
  }

  async function sendMessage() {
    if (!family || !body.trim() || sending) return;
    setSending(true);
    const msgBody = body.trim();
    setBody('');
    setCursorPos(0);
    const { data } = await supabase
      .from('direct_messages')
      .insert({ from_family_id: family.id, to_family_id: otherId, body: msgBody })
      .select('*')
      .single();
    if (data) setMessages(prev => [{ ...data, reactions: [] }, ...prev]);
    setSending(false);
    const { data: muted } = await supabase.rpc('is_muted_by', { p_family_id: otherId });
    if (!muted) notifyFamily(otherId, `💬 ${family.name}`, msgBody, { path: `/dm/${family.id}` }).catch(() => {});
    for (const req of extractTaggedRequests(msgBody, openRequests)) {
      if (req.requesting_family_id === family.id || req.requesting_family_id === otherId) continue;
      notifyFamily(req.requesting_family_id, `📌 ${family.name} tagged your post`, `"${req.title}" was mentioned in a DM`, { path: `/(tabs)/requests?filter=mine` }).catch(() => {});
    }
  }

  async function toggleReaction(messageId: string, emoji: string) {
    if (!family) return;
    const msg = messages.find(m => m.id === messageId);
    const existing = msg?.reactions?.find(r => r.family_id === family.id && r.emoji === emoji);

    if (existing) {
      const { error } = await supabase.from('dm_reactions').delete().eq('id', existing.id);
      if (error) return Alert.alert('Error', 'Could not remove reaction.');
      setMessages(prev => prev.map(m => m.id !== messageId ? m : {
        ...m, reactions: (m.reactions ?? []).filter(r => r.id !== existing.id),
      }));
    } else {
      const { error } = await supabase.from('dm_reactions').insert({ message_id: messageId, family_id: family.id, emoji });
      if (error) return Alert.alert('Error', 'Could not add reaction.');
      loadMessages();
    }
  }

  async function deleteMessage(msg: DirectMessage) {
    const { error } = await supabase.from('direct_messages').delete().eq('id', msg.id);
    if (error) return Alert.alert('Error', error.message);
    setMessages(prev => prev.filter(m => m.id !== msg.id));
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
    const reactionGroups = (item.reactions ?? []).reduce((acc, r) => {
      if (!acc[r.emoji]) acc[r.emoji] = { count: 0, isMine: false };
      acc[r.emoji].count++;
      if (r.family_id === family?.id) acc[r.emoji].isMine = true;
      return acc;
    }, {} as Record<string, { count: number; isMine: boolean }>);

    return (
      <TouchableOpacity onLongPress={() => setReactionTarget(item)} activeOpacity={0.85}>
        <View style={[styles.msgRow, isOwn ? styles.msgRowOwn : styles.msgRowOther]}>
          <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
            <RichText
              body={item.body}
              mentionEntries={mentionEntries}
              openRequests={openRequests}
              myFamilyId={family?.id ?? ''}
              isOwn={isOwn}
              onTagPress={goToTaggedRequest}
              textStyle={[styles.bubbleText, isOwn && styles.bubbleTextOwn]}
            />
            <Text style={[styles.bubbleTime, isOwn && styles.bubbleTimeOwn]}>{formatTime(item.created_at)}</Text>
            {Object.keys(reactionGroups).length > 0 && (
              <View style={styles.reactionsRow}>
                {Object.entries(reactionGroups).map(([emoji, { count, isMine }]) => (
                  <TouchableOpacity
                    key={emoji}
                    style={[styles.reactionPill, isMine && styles.reactionPillMine]}
                    onPress={() => toggleReaction(item.id, emoji)}
                    onLongPress={() => {
                      const names = (item.reactions ?? [])
                        .filter(r => r.emoji === emoji)
                        .map(r => r.family_id === family?.id ? 'You' : otherName)
                        .join('\n');
                      Alert.alert(emoji, names);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`${emoji} reaction, ${count} ${count === 1 ? 'person' : 'people'}${isMine ? ', including you' : ''}. Tap to toggle, hold to see who.`}
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

  const targetIsOwn = reactionTarget?.from_family_id === family?.id;

  return (
    <>
    <PersonProfileModal family={showProfile ? otherFamily : null} onClose={() => setShowProfile(false)} />
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.headerCenter} onPress={() => setShowProfile(true)} disabled={!otherFamily}>
          <Avatar familyId={otherId} animal={otherFamily?.animal} photoUrl={otherFamily?.photo_url} size={28} />
          <Text style={styles.headerName} numberOfLines={1}>{otherName}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.notifBtn} onPress={toggleMuteThread}>
          <Text style={styles.notifIcon}>{isMuted ? '🔕' : '🔔'}</Text>
          <Text style={styles.notifText}>{isMuted ? 'Muted' : 'Notify'}</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {messages.length === 0 ? (
          <View style={[styles.empty, { flex: 1 }]}>
            <Text style={styles.emptyText}>
              {isConnected === false ? `No messages with ${otherName}.` : `Send the first message to ${otherName}!`}
            </Text>
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
        {isConnected === false ? (
          <View style={styles.reconnectBanner}>
            <Text style={styles.reconnectText}>You're no longer connected — you can read past messages, but reconnect in Village to send new ones.</Text>
          </View>
        ) : (
        <>
          {activeTrigger?.type === '@' && mentionResults.length > 0 && (
            <View style={styles.mentionDropdown}>
              {mentionResults.map(e => (
                <TouchableOpacity key={e.familyId} style={styles.mentionItem} onPress={() => insertMention(e)}>
                  <Text style={styles.mentionItemEmoji}>{getFamilyAnimal(e.familyId, e.animal)}</Text>
                  <Text style={styles.mentionItemName}>{e.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {activeTrigger?.type === '#' && requestResults.length > 0 && (
            <View style={styles.mentionDropdown}>
              {requestResults.map(r => (
                <TouchableOpacity key={r.id} style={styles.mentionItem} onPress={() => insertRequestTag(r)}>
                  <Text style={styles.mentionItemEmoji}>📋</Text>
                  <Text style={styles.mentionItemName} numberOfLines={1}>{r.title}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {!activeTrigger && (
            <Text style={styles.composerHint}>Type @ to tag {otherName}, # to tag a post</Text>
          )}
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder={`Message ${otherName}...`}
              placeholderTextColor={colors.textMuted}
              value={body}
              onChangeText={(text) => { setBody(text); setCursorPos(text.length); }}
              onSelectionChange={(e) => setCursorPos(e.nativeEvent.selection.end)}
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
        </>
        )}
      </KeyboardAvoidingView>

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

          {targetIsOwn && (
            <View style={styles.sheetActions}>
              <TouchableOpacity
                style={styles.sheetActionBtn}
                onPress={() => {
                  if (reactionTarget) {
                    Alert.alert('Delete this message?', undefined, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => deleteMessage(reactionTarget) },
                    ]);
                  }
                  setReactionTarget(null);
                }}
              >
                <Text style={styles.deleteText}>Delete message</Text>
              </TouchableOpacity>
            </View>
          )}
          <TouchableOpacity style={styles.sheetCancelBtn} onPress={() => setReactionTarget(null)}>
            <Text style={styles.sheetCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
    </>
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
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  headerAvatar: { fontSize: 20 },
  headerName: { fontSize: 17, fontWeight: '800', color: colors.text, textAlign: 'center' },
  notifBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border },
  notifIcon: { fontSize: 14 },
  notifText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
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
  reactionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 8 },
  reactionPill: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.08)', borderRadius: 14,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  reactionPillMine: { backgroundColor: colors.primaryLight, borderWidth: 1.5, borderColor: colors.primary },
  reactionPillText: { fontSize: 15, fontWeight: '600', color: colors.text },
  mentionDropdown: { borderTopWidth: 1, borderTopColor: colors.borderLight, backgroundColor: colors.card },
  mentionItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  mentionItemEmoji: { fontSize: 18 },
  mentionItemName: { fontSize: 15, fontWeight: '600', color: colors.text },
  composerHint: {
    fontSize: 11, color: colors.textMuted, fontWeight: '500',
    textAlign: 'center', paddingVertical: 4, backgroundColor: colors.card,
  },
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
  reconnectBanner: {
    paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1,
    borderTopColor: colors.borderLight, backgroundColor: colors.card,
  },
  reconnectText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 18, fontWeight: '500' },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 15, color: colors.textMuted, fontWeight: '500', textAlign: 'center' },

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
  sheetCancelBtn: { paddingVertical: 12, alignItems: 'center' },
  sheetCancelText: { fontSize: 15, color: colors.textMuted, fontWeight: '500' },
});
