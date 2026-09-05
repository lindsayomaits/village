import { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, TextInput, Modal, Alert, ActivityIndicator } from 'react-native';
import { Text } from '../components/Text';
import { Avatar } from '../components/Avatar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { getFamilyAnimal } from '../lib/animals';
import type { Family, GroupChat } from '../types';

export default function ChatsScreen() {
  const { family } = useAuth();
  const router = useRouter();

  const [families, setFamilies] = useState<Family[]>([]);
  const [connectedIds, setConnectedIds] = useState<Set<string>>(new Set());
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  const [dmHistoryIds, setDmHistoryIds] = useState<Set<string>>(new Set());
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

  const [groups, setGroups] = useState<GroupChat[]>([]);
  const [groupUnread, setGroupUnread] = useState<Record<string, number>>({});
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());
  const [creatingGroup, setCreatingGroup] = useState(false);

  const directFamilies = families.filter(f => connectedIds.has(f.id));
  // Households you've messaged before but aren't connected to anymore —
  // history stays reachable (read-only) instead of just vanishing.
  const pastConversations = families.filter(f => !connectedIds.has(f.id) && dmHistoryIds.has(f.id) && !blockedIds.has(f.id));

  useFocusEffect(useCallback(() => {
    loadBlocked();
    loadFamilies();
    loadConnections();
    loadDmHistoryIds();
    loadUnreadCounts();
    loadGroups();
  }, [family?.id]));

  useEffect(() => {
    if (!family) return;
    const channel = supabase
      .channel('dm_unread_rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages',
        filter: `to_family_id=eq.${family.id}` }, () => { loadUnreadCounts(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages' }, () => { loadGroupUnread(groups); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [family?.id, groups]);

  async function loadBlocked() {
    if (!family) return;
    const { data, error } = await supabase.from('blocks').select('blocked_id').eq('blocker_id', family.id);
    if (error) {
      // eslint-disable-next-line no-console
      console.error('loadBlocked error', error);
      return;
    }
    setBlockedIds(new Set((data ?? []).map((b: { blocked_id: string }) => b.blocked_id)));
  }

  async function loadFamilies() {
    if (!family) return;
    // families_public covers everyone (name/animal only, no PII); families
    // additionally returns parent names but only for rows RLS allows (self,
    // admin, or connected) — merge so connected households get real names.
    const [{ data: pub, error }, { data: full }] = await Promise.all([
      supabase.from('families_public').select('*').neq('id', family.id).order('name'),
      supabase.from('families').select('*').neq('id', family.id),
    ]);
    if (error) {
      // eslint-disable-next-line no-console
      console.error('loadFamilies error', error);
      return;
    }
    const fullById = new Map((full ?? []).map((f: Family) => [f.id, f]));
    setFamilies((pub ?? []).map((p: Family) => fullById.get(p.id) ?? p));
  }

  async function loadDmHistoryIds() {
    if (!family) return;
    const { data, error } = await supabase
      .from('direct_messages')
      .select('from_family_id, to_family_id')
      .or(`from_family_id.eq.${family.id},to_family_id.eq.${family.id}`);
    if (error) {
      // eslint-disable-next-line no-console
      console.error('loadDmHistoryIds error', error);
      return;
    }
    const ids = new Set<string>();
    for (const row of (data ?? [])) {
      const otherId = row.from_family_id === family.id ? row.to_family_id : row.from_family_id;
      if (otherId !== family.id) ids.add(otherId);
    }
    setDmHistoryIds(ids);
  }

  async function loadConnections() {
    if (!family) return;
    const { data, error } = await supabase
      .from('connections').select('requester_id, recipient_id').eq('status', 'accepted')
      .or(`requester_id.eq.${family.id},recipient_id.eq.${family.id}`);
    if (error) {
      // eslint-disable-next-line no-console
      console.error('loadConnections error', error);
      return;
    }
    setConnectedIds(new Set((data ?? []).map(c => c.requester_id === family.id ? c.recipient_id : c.requester_id)));
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

  async function loadGroups() {
    if (!family) return;
    const { data: memberships } = await supabase.from('group_chat_members').select('group_id').eq('family_id', family.id);
    const groupIds = (memberships ?? []).map(m => m.group_id);
    if (groupIds.length === 0) { setGroups([]); setGroupUnread({}); return; }
    const { data } = await supabase.from('group_chats').select('*').in('id', groupIds).order('created_at', { ascending: false });
    const loaded = data ?? [];
    setGroups(loaded);
    await loadGroupUnread(loaded);
  }

  async function loadGroupUnread(groupList: GroupChat[]) {
    if (!family || groupList.length === 0) return;
    const { data: reads } = await supabase.from('group_message_reads').select('group_id, last_read_at').eq('family_id', family.id);
    const lastReadByGroup = new Map((reads ?? []).map(r => [r.group_id, r.last_read_at]));
    const counts: Record<string, number> = {};
    await Promise.all(groupList.map(async g => {
      const since = lastReadByGroup.get(g.id) ?? g.created_at;
      const { count } = await supabase
        .from('group_messages')
        .select('id', { count: 'exact', head: true })
        .eq('group_id', g.id)
        .neq('from_family_id', family.id)
        .gt('created_at', since);
      counts[g.id] = count ?? 0;
    }));
    setGroupUnread(counts);
  }

  async function createGroup() {
    if (!family || !newGroupName.trim() || selectedMemberIds.size === 0) return;
    setCreatingGroup(true);
    const { data, error } = await supabase.rpc('create_group_chat', {
      p_name: newGroupName.trim(),
      p_member_ids: Array.from(selectedMemberIds),
    });
    setCreatingGroup(false);
    if (error) return Alert.alert('Error', error.message);
    setShowCreateGroup(false);
    setNewGroupName('');
    setSelectedMemberIds(new Set());
    await loadGroups();
    if (data) router.push(`/group/${data}`);
  }

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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>Messages</Text>
        {directFamilies.length > 0 ? (
          <TouchableOpacity style={styles.newGroupBtn} onPress={() => setShowCreateGroup(true)}>
            <Text style={styles.newGroupBtnText}>+ Group</Text>
          </TouchableOpacity>
        ) : <View style={{ width: 60 }} />}
      </View>

      {!family && (
        <View style={styles.unlinkBanner}>
          <Text style={styles.unlinkText}>⚠️ We couldn't find your profile. Try signing out and back in — if this keeps happening, contact support.</Text>
        </View>
      )}

      <FlatList
        data={directFamilies}
        keyExtractor={(item) => item.id}
        renderItem={renderFamily}
        contentContainerStyle={styles.dmList}
        ListHeaderComponent={
          groups.length > 0 ? (
            <View style={styles.groupsSection}>
              <Text style={styles.sectionLabel}>Groups</Text>
              {groups.map(g => {
                const unread = groupUnread[g.id] ?? 0;
                return (
                  <TouchableOpacity key={g.id} style={styles.dmRow} onPress={() => router.push(`/group/${g.id}`)}>
                    <View style={styles.dmAvatar}>
                      <Text style={styles.dmAvatarText}>👥</Text>
                    </View>
                    <Text style={styles.dmName}>{g.name}</Text>
                    {unread > 0 && (
                      <View style={styles.unreadBadge}>
                        <Text style={styles.unreadText}>{unread}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
              <Text style={[styles.sectionLabel, { marginTop: 12 }]}>Direct Messages</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>👥</Text>
            <Text style={styles.emptyText}>Connect with people in Village to start a chat</Text>
            <TouchableOpacity style={styles.emptyActionBtn} onPress={() => router.push('/(tabs)/members')}>
              <Text style={styles.emptyActionBtnText}>Go to Village</Text>
            </TouchableOpacity>
          </View>
        }
        ListFooterComponent={pastConversations.length > 0 ? (
          <View style={styles.pastConvoSection}>
            <Text style={styles.pastConvoHeader}>Past Conversations</Text>
            <Text style={styles.pastConvoHint}>No longer connected — you can still read, not send.</Text>
            {pastConversations.map(item => (
              <TouchableOpacity
                key={item.id}
                style={[styles.dmRow, styles.dmRowPast]}
                onPress={() => router.push({ pathname: '/dm/[familyId]', params: { familyId: item.id, name: item.name } })}
              >
                <View style={styles.dmAvatar}>
                  <Text style={styles.dmAvatarText}>{getFamilyAnimal(item.id, item.animal)}</Text>
                </View>
                <Text style={styles.dmName}>{item.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      />

      <Modal visible={showCreateGroup} transparent animationType="slide" onRequestClose={() => setShowCreateGroup(false)}>
        <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setShowCreateGroup(false)} />
        <View style={styles.createSheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.createTitle}>New Group</Text>
          <TextInput
            style={styles.createNameInput}
            placeholder="Group name"
            placeholderTextColor={colors.textMuted}
            value={newGroupName}
            onChangeText={setNewGroupName}
          />
          <Text style={styles.createSubLabel}>Add people</Text>
          <FlatList
            style={styles.createMemberList}
            data={directFamilies}
            keyExtractor={item => item.id}
            renderItem={({ item }) => {
              const selected = selectedMemberIds.has(item.id);
              return (
                <TouchableOpacity
                  style={styles.memberPickRow}
                  onPress={() => setSelectedMemberIds(prev => {
                    const next = new Set(prev);
                    if (selected) next.delete(item.id); else next.add(item.id);
                    return next;
                  })}
                >
                  <Avatar familyId={item.id} animal={item.animal} photoUrl={item.photo_url} size={32} />
                  <Text style={styles.memberPickName}>{item.name}</Text>
                  <View style={[styles.checkbox, selected && styles.checkboxChecked]}>
                    {selected && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                </TouchableOpacity>
              );
            }}
          />
          <TouchableOpacity
            style={[styles.createBtn, (!newGroupName.trim() || selectedMemberIds.size === 0) && styles.createBtnDisabled]}
            onPress={createGroup}
            disabled={creatingGroup || !newGroupName.trim() || selectedMemberIds.size === 0}
          >
            {creatingGroup ? <ActivityIndicator color="#fff" /> : <Text style={styles.createBtnText}>Create Group</Text>}
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, marginBottom: 12 },
  back: { fontSize: 17, color: colors.primary, fontWeight: '600', width: 60 },
  title: { fontSize: 20, fontWeight: '800', color: colors.text },
  dmList: { paddingHorizontal: 20, paddingTop: 4 },
  dmRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 16, padding: 14, marginBottom: 8, borderWidth: 1.5, borderColor: colors.borderLight },
  dmAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.sageLight, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  dmAvatarText: { fontSize: 22 },
  dmName: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  unreadBadge: { backgroundColor: colors.primary, borderRadius: 12, minWidth: 24, height: 24, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  unreadText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  pastConvoSection: { marginTop: 16 },
  pastConvoHeader: { fontSize: 13, fontWeight: '700', color: colors.textMuted, marginBottom: 2 },
  pastConvoHint: { fontSize: 12, color: colors.textMuted, marginBottom: 10 },
  dmRowPast: { opacity: 0.6 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 40, marginBottom: 10 },
  emptyText: { fontSize: 15, color: colors.textMuted, fontWeight: '500', textAlign: 'center' },
  emptyActionBtn: { backgroundColor: colors.primary, borderRadius: 14, paddingHorizontal: 20, paddingVertical: 12, marginTop: 16 },
  emptyActionBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  unlinkBanner: {
    backgroundColor: colors.amberLight, borderRadius: 12, marginHorizontal: 16,
    marginBottom: 10, padding: 12, borderWidth: 1, borderColor: colors.amber,
  },
  unlinkText: { fontSize: 13, color: colors.amber, lineHeight: 18, fontWeight: '500' },

  newGroupBtn: { backgroundColor: colors.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  newGroupBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  groupsSection: { marginBottom: 8 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  createSheet: {
    backgroundColor: colors.card, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingBottom: 32, maxHeight: '80%',
  },
  sheetHandle: { width: 40, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 8 },
  createTitle: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 14, textAlign: 'center' },
  createNameInput: {
    backgroundColor: colors.background, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, color: colors.text, marginBottom: 16,
  },
  createSubLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginBottom: 8 },
  createMemberList: { maxHeight: 260, marginBottom: 16 },
  memberPickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  memberPickName: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.border,
    backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: '#fff', fontSize: 13, fontWeight: '800' },
  createBtn: { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  createBtnDisabled: { backgroundColor: colors.border },
  createBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
