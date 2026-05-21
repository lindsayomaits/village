import { useState, useCallback } from 'react';
import {
  View, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert, TextInput, Modal,
} from 'react-native';
import { Text } from '../../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors } from '../../lib/theme';
import type { Family, Invite } from '../../types';

export default function AdminScreen() {
  const { family: adminFamily } = useAuth();
  const [families, setFamilies] = useState<Family[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [adjustModal, setAdjustModal] = useState(false);
  const [selectedFamily, setSelectedFamily] = useState<Family | null>(null);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [adjusting, setAdjusting] = useState(false);

  async function loadData() {
    const [{ data: fams }, { data: invs }] = await Promise.all([
      supabase.from('families').select('*').order('name'),
      supabase.from('invites').select('*').order('created_at', { ascending: false }).limit(10),
    ]);
    setFamilies(fams ?? []);
    setInvites(invs ?? []);
    setLoading(false);
  }

  useFocusEffect(useCallback(() => { loadData(); }, []));

  async function onRefresh() {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }

  async function generateInvite() {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const { error } = await supabase.from('invites').insert({ code, created_by: adminFamily?.id });
    if (error) return Alert.alert('Error', error.message);
    Alert.alert('Invite code created! 🎉', `Share this code with your friend:\n\n${code}`);
    loadData();
  }

  function openAdjust(f: Family) {
    setSelectedFamily(f);
    setAdjustAmount('');
    setAdjustNote('');
    setAdjustModal(true);
  }

  async function submitAdjustment() {
    if (!selectedFamily || !adjustAmount) return;
    const hours = parseFloat(adjustAmount);
    if (isNaN(hours) || hours === 0) return Alert.alert('Enter a valid number (e.g. 3 to add, -2 to subtract)');
    const newBalance = selectedFamily.hours_balance + hours;
    if (newBalance < -20) return Alert.alert('This would bring the household below -20h');

    setAdjusting(true);
    const { error } = await supabase.rpc('admin_adjust_balance', {
      p_family_id: selectedFamily.id,
      p_hours: hours,
      p_note: adjustNote.trim() || null,
      p_admin_id: adminFamily?.id,
    });
    setAdjusting(false);
    if (error) return Alert.alert('Error', error.message);
    setAdjustModal(false);
    loadData();
  }

  async function removeFamily(f: Family) {
    Alert.alert(`Remove ${f.name}?`, 'This will remove them from the group permanently.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          await supabase.from('families').delete().eq('id', f.id);
          loadData();
        },
      },
    ]);
  }

  const renderFamily = ({ item }: { item: Family }) => (
    <View style={styles.card}>
      <View style={styles.cardLeft}>
        <Text style={styles.familyName}>{item.name}</Text>
        <Text style={styles.familyEmail}>{item.email}</Text>
      </View>
      <Text style={[
        styles.balance,
        { color: item.hours_balance < 0 ? colors.red : item.hours_balance <= 3 ? colors.amber : colors.green }
      ]}>
        {item.hours_balance > 0 ? '+' : ''}{item.hours_balance}h
      </Text>
      <View style={styles.cardActions}>
        <TouchableOpacity style={styles.editBtn} onPress={() => openAdjust(item)}>
          <Text style={styles.editBtnText}>Adjust</Text>
        </TouchableOpacity>
        {!item.is_admin && (
          <TouchableOpacity style={styles.removeBtn} onPress={() => removeFamily(item)}>
            <Text style={styles.removeBtnText}>Remove</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Text style={styles.title}>Admin</Text>

      <View style={styles.inviteSection}>
        <View style={styles.inviteHeader}>
          <Text style={styles.sectionLabel}>Invite Codes</Text>
          <TouchableOpacity style={styles.generateBtn} onPress={generateInvite}>
            <Text style={styles.generateBtnText}>+ Generate</Text>
          </TouchableOpacity>
        </View>
        {invites.length === 0 ? (
          <Text style={styles.noInvites}>No invite codes yet — generate one to invite a partner</Text>
        ) : (
          invites.slice(0, 3).map((inv) => (
            <View key={inv.id} style={styles.inviteRow}>
              <Text style={styles.inviteCode}>{inv.code}</Text>
              <Text style={[styles.inviteStatus, { color: inv.used_by ? colors.textMuted : colors.green }]}>
                {inv.used_by ? 'Used' : 'Active'}
              </Text>
            </View>
          ))
        )}
      </View>

      <Text style={[styles.sectionLabel, { paddingHorizontal: 20, marginBottom: 10 }]}>
        Households ({families.length})
      </Text>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
      ) : (
        <FlatList
          data={families}
          keyExtractor={(item) => item.id}
          renderItem={renderFamily}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        />
      )}

      <Modal visible={adjustModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Adjust Balance</Text>
            <Text style={styles.modalFamily}>{selectedFamily?.name}</Text>
            <Text style={styles.modalCurrent}>Current balance: {selectedFamily?.hours_balance}h</Text>

            <Text style={styles.inputLabel}>Hours to add or subtract</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 3 to add, -2 to subtract"
              placeholderTextColor={colors.textMuted}
              value={adjustAmount}
              onChangeText={setAdjustAmount}
              keyboardType="numbers-and-punctuation"
            />

            <Text style={styles.inputLabel}>Reason (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Correction for October sit"
              placeholderTextColor={colors.textMuted}
              value={adjustNote}
              onChangeText={setAdjustNote}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelModalBtn} onPress={() => setAdjustModal(false)}>
                <Text style={styles.cancelModalText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={submitAdjustment} disabled={adjusting}>
                {adjusting ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText}>Apply</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, paddingHorizontal: 20, paddingTop: 16, marginBottom: 16 },
  inviteSection: {
    backgroundColor: colors.card, marginHorizontal: 20, borderRadius: 18, padding: 16,
    marginBottom: 20, borderWidth: 1.5, borderColor: colors.borderLight,
  },
  inviteHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionLabel: { fontSize: 16, fontWeight: '800', color: colors.text },
  generateBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7 },
  generateBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  noInvites: { fontSize: 13, color: colors.textMuted },
  inviteRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7 },
  inviteCode: { fontSize: 20, fontWeight: '800', letterSpacing: 3, color: colors.text },
  inviteStatus: { fontSize: 13, fontWeight: '700' },
  list: { paddingHorizontal: 20, paddingBottom: 32 },
  card: {
    backgroundColor: colors.card, borderRadius: 16, padding: 14, marginBottom: 10,
    borderWidth: 1.5, borderColor: colors.borderLight, flexDirection: 'row', alignItems: 'center',
  },
  cardLeft: { flex: 1 },
  familyName: { fontSize: 15, fontWeight: '700', color: colors.text },
  familyEmail: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  balance: { fontSize: 18, fontWeight: '800', marginHorizontal: 10 },
  cardActions: { flexDirection: 'column', gap: 5 },
  editBtn: { backgroundColor: colors.primaryLight, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  editBtnText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  removeBtn: { backgroundColor: colors.redLight, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  removeBtnText: { color: colors.red, fontSize: 13, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 24, paddingBottom: 44 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: colors.text, marginBottom: 4 },
  modalFamily: { fontSize: 16, color: colors.primary, fontWeight: '700', marginBottom: 2 },
  modalCurrent: { fontSize: 14, color: colors.textSecondary, marginBottom: 16 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: colors.background, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, color: colors.text,
  },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 22 },
  cancelModalBtn: { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  cancelModalText: { fontSize: 15, color: colors.textSecondary, fontWeight: '700' },
  confirmBtn: { flex: 1, backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  confirmText: { fontSize: 15, color: '#fff', fontWeight: '700' },
});
