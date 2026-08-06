import { useState, useCallback } from 'react';
import {
  View, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Share, Switch,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Text } from '../../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors } from '../../lib/theme';
import { getFamilyAnimal, ANIMALS } from '../../lib/animals';
import { calcAge } from '../../lib/utils';
import type { KidEntry } from '../../types';

export default function ProfileScreen() {
  const { family, session, signOut, refreshFamily } = useAuth();
  const router = useRouter();

  const [name, setName] = useState('');
  const [parent1Name, setParent1Name] = useState('');
  const [parent1Phone, setParent1Phone] = useState('');
  const [parent2Name, setParent2Name] = useState('');
  const [parent2Phone, setParent2Phone] = useState('');
  const [address, setAddress] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [kidsInfo, setKidsInfo] = useState('');
  const [chosenAnimal, setChosenAnimal] = useState<string | null>(null);
  const [kids, setKids] = useState<KidEntry[]>([]);
  const [servicesOffered, setServicesOffered] = useState<string[]>([]);
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [togglingDiscoverable, setTogglingDiscoverable] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  useFocusEffect(useCallback(() => {
    if (family) {
      setName(family.name ?? '');
      setParent1Name(family.parent1_name ?? '');
      setParent1Phone(family.parent1_phone ?? '');
      setParent2Name(family.parent2_name ?? '');
      setParent2Phone(family.parent2_phone ?? '');
      setAddress(family.address ?? '');
      setEmergencyContact(family.emergency_contact ?? '');
      setKidsInfo(family.kids_info ?? '');
      setKids(family.kids_data ?? []);
      setChosenAnimal(family.animal ?? null);
      setServicesOffered(family.services_offered ?? []);
      setDirty(false);
    }
  }, [family?.id]));

  function field(setter: (v: string) => void) {
    return (v: string) => { setter(v); setDirty(true); };
  }

  async function handleInvitePartner() {
    if (!family) return;
    setGeneratingInvite(true);
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const { error } = await supabase.from('invites').insert({
      code,
      created_by: family.id,
      invite_type: 'partner',
      family_id: family.id,
    });
    setGeneratingInvite(false);
    if (error) return Alert.alert('Error', error.message);
    await Share.share({
      message: `Join me on VillageMates, the babysitting exchange app!\n\nUse this code to create your account: ${code}\n\nOn the sign-up screen, tap "Joining my partner's account" and enter this code.`,
    });
  }

  async function handleShareConnectCode() {
    if (!family?.connect_code) return;
    await Share.share({
      message: `Let's connect on VillageMates!\n\nEnter my code in the "Find People" tab to connect instantly: ${family.connect_code}`,
    });
  }

  async function toggleDiscoverable(value: boolean) {
    if (!family) return;
    setTogglingDiscoverable(true);
    const { error } = await supabase.from('families').update({ discoverable: value }).eq('id', family.id);
    setTogglingDiscoverable(false);
    if (error) return Alert.alert('Error', error.message);
    await refreshFamily();
  }

  function handleDeleteAccount() {
    const isPartner = !!family && session?.user.id === family.partner_user_id;
    Alert.alert(
      isPartner ? 'Leave this household?' : 'Delete your account?',
      isPartner
        ? "This unlinks your login from the household. The household itself, and its other parent's access, are unaffected."
        : 'This permanently removes your personal info (name, phone, address, kids notes) and signs you out. Past chat and transaction history stays, since other households rely on it, but without your personal details attached.\n\nThis cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isPartner ? 'Leave' : 'Delete My Account', style: 'destructive',
          onPress: async () => {
            setDeletingAccount(true);
            const { error } = await supabase.rpc('delete_own_account');
            setDeletingAccount(false);
            if (error) return Alert.alert('Error', error.message);
            await signOut();
          },
        },
      ]
    );
  }

  async function handleSave() {
    if (!family) return;
    if (!name.trim()) return Alert.alert('Household name is required');
    setSaving(true);
    const { error } = await supabase
      .from('families')
      .update({
        name: name.trim(),
        parent1_name: parent1Name.trim() || null,
        parent1_phone: parent1Phone.trim() || null,
        parent2_name: parent2Name.trim() || null,
        parent2_phone: parent2Phone.trim() || null,
        address: address.trim() || null,
        emergency_contact: emergencyContact.trim() || null,
        kids_info: kidsInfo.trim() || null,
        kids_data: kids.filter(k => k.name.trim()).length > 0
          ? kids.filter(k => k.name.trim()).map(k => ({ name: k.name.trim(), birthday: k.birthday }))
          : null,
        animal: chosenAnimal || null,
        services_offered: servicesOffered.length > 0 ? servicesOffered : null,
      })
      .eq('id', family.id);
    setSaving(false);
    if (error) return Alert.alert('Error', error.message);
    await refreshFamily();
    setDirty(false);
    Alert.alert('Saved!', 'Your profile has been updated.');
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Profile</Text>

          {!family && (
            <View style={styles.unlinkBanner}>
              <Text style={styles.unlinkText}>
                ⚠️ Your account isn't linked to a household. If you're a partner, ask the primary account holder to go to Profile → Partner Access and re-send the partner invite code. Sign out and sign up again using that code.
              </Text>
            </View>
          )}

          <View style={styles.animalCard}>
            <Text style={styles.animalEmoji}>
              {family ? getFamilyAnimal(family.id, chosenAnimal) : ''}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.animalLabel}>Your village animal</Text>
              <Text style={styles.emailValue}>{family?.email}</Text>
            </View>
          </View>

          <Text style={styles.sectionHead}>Choose your animal</Text>
          <View style={styles.animalGrid}>
            {ANIMALS.map((a) => {
              const isSelected = (chosenAnimal ?? getFamilyAnimal(family?.id ?? '', null)) === a;
              return (
                <TouchableOpacity
                  key={a}
                  style={[styles.animalOption, isSelected && styles.animalOptionSelected]}
                  onPress={() => { setChosenAnimal(a); setDirty(true); }}
                >
                  <Text style={styles.animalOptionEmoji}>{a}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Household name */}
          <Text style={styles.sectionHead}>Household</Text>
          <Text style={styles.label}>Household name <Text style={styles.required}>*</Text></Text>
          <TextInput style={styles.input} value={name} onChangeText={field(setName)}
            placeholder="e.g. The Smith Household" placeholderTextColor={colors.textMuted} />

          {/* Parent 1 */}
          <Text style={styles.sectionHead}>Adult 1</Text>
          <Text style={styles.label}>Name</Text>
          <TextInput style={styles.input} value={parent1Name} onChangeText={field(setParent1Name)}
            placeholder="e.g. Sarah Smith" placeholderTextColor={colors.textMuted} />
          <Text style={styles.label}>Phone</Text>
          <TextInput style={styles.input} value={parent1Phone} onChangeText={field(setParent1Phone)}
            placeholder="e.g. (555) 123-4567" placeholderTextColor={colors.textMuted} keyboardType="phone-pad" />

          {/* Parent 2 */}
          <Text style={styles.sectionHead}>Adult 2</Text>
          <Text style={styles.label}>Name</Text>
          <TextInput style={styles.input} value={parent2Name} onChangeText={field(setParent2Name)}
            placeholder="e.g. Tom Smith" placeholderTextColor={colors.textMuted} />
          <Text style={styles.label}>Phone</Text>
          <TextInput style={styles.input} value={parent2Phone} onChangeText={field(setParent2Phone)}
            placeholder="e.g. (555) 987-6543" placeholderTextColor={colors.textMuted} keyboardType="phone-pad" />

          {/* Address & Emergency */}
          <Text style={styles.sectionHead}>Contact Details</Text>
          <Text style={styles.label}>Home address</Text>
          <TextInput style={styles.input} value={address} onChangeText={field(setAddress)}
            placeholder="e.g. 42 Maple St, Springfield" placeholderTextColor={colors.textMuted} />
          <Text style={styles.label}>Emergency contact</Text>
          <Text style={styles.hint}>Name + phone of someone to call if neither parent is reachable.</Text>
          <TextInput style={styles.input} value={emergencyContact} onChangeText={field(setEmergencyContact)}
            placeholder="e.g. Grandma Jo — (555) 246-8101" placeholderTextColor={colors.textMuted} />

          {/* Kids */}
          <Text style={styles.sectionHead}>Kids</Text>
          <Text style={styles.hint}>Add each child — their name and birthday will show as their age to other families.</Text>

          {kids.map((kid, i) => (
            <View key={i} style={styles.kidCard}>
              <View style={styles.kidCardHeader}>
                <Text style={styles.kidLabel}>Child {i + 1}</Text>
                <TouchableOpacity onPress={() => { setKids(prev => prev.filter((_, j) => j !== i)); setPickerIndex(null); setDirty(true); }}>
                  <Text style={styles.removeKidText}>Remove</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={styles.input}
                value={kid.name}
                onChangeText={v => { setKids(prev => prev.map((k, j) => j === i ? { ...k, name: v } : k)); setDirty(true); }}
                placeholder="Child's name"
                placeholderTextColor={colors.textMuted}
              />
              <TouchableOpacity
                style={styles.birthdayBtn}
                onPress={() => { setPickerIndex(pickerIndex === i ? null : i); }}
              >
                <Text style={styles.birthdayBtnLabel}>Birthday</Text>
                <Text style={styles.birthdayBtnValue}>
                  {kid.birthday
                    ? `${new Date(kid.birthday + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}  ·  age ${calcAge(kid.birthday)}`
                    : 'Tap to add'}
                </Text>
              </TouchableOpacity>
              {pickerIndex === i && (
                <View>
                  <DateTimePicker
                    value={kid.birthday ? new Date(kid.birthday + 'T12:00:00') : new Date(2019, 0, 1)}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    maximumDate={new Date()}
                    onChange={(event, date) => {
                      if (date) {
                        const iso = date.toISOString().split('T')[0];
                        setKids(prev => prev.map((k, j) => j === i ? { ...k, birthday: iso } : k));
                        setDirty(true);
                      }
                      if (Platform.OS === 'android') setPickerIndex(null);
                    }}
                  />
                  {Platform.OS === 'ios' && (
                    <TouchableOpacity style={styles.pickerDoneBtn} onPress={() => setPickerIndex(null)}>
                      <Text style={styles.pickerDoneText}>Done</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          ))}

          <TouchableOpacity style={styles.addKidBtn} onPress={() => { setKids(prev => [...prev, { name: '', birthday: null }]); setDirty(true); }}>
            <Text style={styles.addKidBtnText}>+ Add a child</Text>
          </TouchableOpacity>

          <Text style={styles.label}>Sitter notes</Text>
          <Text style={styles.hint}>Allergies, bedtime, anything else a sitter should know.</Text>
          <TextInput
            style={[styles.input, styles.textArea]} value={kidsInfo} onChangeText={field(setKidsInfo)}
            placeholder="e.g. Mia is allergic to peanuts. Bedtime 8pm for both kids."
            placeholderTextColor={colors.textMuted} multiline numberOfLines={3} textAlignVertical="top"
          />

          {/* What I can help with */}
          <Text style={styles.sectionHead}>What I can help with</Text>
          <Text style={styles.hint}>Other households will see this on your profile when they're looking for help.</Text>
          {([
            { key: 'kid_sit',           label: 'Kid-sitting',      emoji: '👧' },
            { key: 'dog',               label: 'Pet care',          emoji: '🐾' },
            { key: 'manual_labor',      label: 'Manual labor',      emoji: '🔨' },
            { key: 'professional',      label: 'Professional help', emoji: '🎓' },
            { key: 'cooking',           label: 'Cooking / baking',  emoji: '🍳' },
            { key: 'elder_care',        label: 'Elder care',        emoji: '🤝' },
            { key: 'physical_training', label: 'Physical training', emoji: '🏃' },
            { key: 'errands',           label: 'Errands',           emoji: '🛒' },
          ] as { key: string; label: string; emoji: string }[]).map(({ key, label, emoji }) => {
            const checked = servicesOffered.includes(key);
            return (
              <TouchableOpacity
                key={key}
                style={styles.serviceRow}
                onPress={() => {
                  setServicesOffered(prev =>
                    checked ? prev.filter(s => s !== key) : [...prev, key]
                  );
                  setDirty(true);
                }}
                activeOpacity={0.7}
              >
                <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                  {checked && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text style={styles.serviceEmoji}>{emoji}</Text>
                <Text style={[styles.serviceLabel, checked && styles.serviceLabelChecked]}>{label}</Text>
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity
            style={[styles.saveBtn, !dirty && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving || !dirty}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Changes</Text>}
          </TouchableOpacity>

          <Text style={styles.sectionHead}>Partner Access</Text>
          {family?.partner_user_id ? (
            <View style={styles.partnerLinkedCard}>
              <Text style={styles.partnerLinkedText}>Your partner has joined this household account.</Text>
            </View>
          ) : (
            <>
              <Text style={styles.hint}>
                Your partner can create their own login tied to your household. Tap below to generate a one-time invite code to send them.
              </Text>
              <TouchableOpacity
                style={styles.invitePartnerBtn}
                onPress={handleInvitePartner}
                disabled={generatingInvite}
              >
                {generatingInvite
                  ? <ActivityIndicator color={colors.primary} />
                  : <Text style={styles.invitePartnerText}>Invite Your Partner</Text>}
              </TouchableOpacity>
            </>
          )}

          <Text style={styles.sectionHead}>Connecting</Text>
          <Text style={styles.hint}>
            Share your code with a household you know for an instant connection — no searching, no waiting for them to accept.
          </Text>
          <TouchableOpacity style={styles.connectCodeCard} onPress={handleShareConnectCode} disabled={!family?.connect_code}>
            <View>
              <Text style={styles.connectCodeLabel}>Your connect code</Text>
              <Text style={styles.connectCodeValue}>{family?.connect_code ?? '——————'}</Text>
            </View>
            <Text style={styles.connectCodeShare}>Share</Text>
          </TouchableOpacity>

          <View style={styles.discoverableRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.discoverableLabel}>Show up in "Find People" search</Text>
              <Text style={styles.hint}>
                Off means people can only reach you with your connect code — you won't appear when others browse or search by name.
              </Text>
            </View>
            <Switch
              value={family?.discoverable ?? true}
              onValueChange={toggleDiscoverable}
              disabled={togglingDiscoverable || !family}
              trackColor={{ false: colors.borderLight, true: colors.primary }}
            />
          </View>

          <TouchableOpacity style={styles.historyBtn} onPress={() => router.push('/history')}>
            <Text style={styles.historyBtnText}>View Hour History</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.signOutBtn}
            onPress={() => Alert.alert('Sign out?', undefined, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign Out', style: 'destructive', onPress: signOut },
            ])}
          >
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.deleteAccountBtn}
            onPress={handleDeleteAccount}
            disabled={deletingAccount}
          >
            {deletingAccount
              ? <ActivityIndicator color={colors.red} />
              : <Text style={styles.deleteAccountText}>
                  {session?.user.id === family?.partner_user_id ? 'Leave Household' : 'Delete My Account'}
                </Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: 20, paddingBottom: 48 },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, paddingTop: 16, marginBottom: 20 },
  unlinkBanner: {
    backgroundColor: '#FFF3CD', borderRadius: 12, padding: 14, marginBottom: 16,
    borderWidth: 1, borderColor: '#FFCC00',
  },
  unlinkText: { fontSize: 13, color: '#7A5F00', lineHeight: 19, fontWeight: '500' },
  animalCard: {
    backgroundColor: colors.card, borderRadius: 14, padding: 16, marginBottom: 8,
    borderWidth: 1.5, borderColor: colors.borderLight,
    flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  animalEmoji: { fontSize: 40 },
  animalLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '600', marginBottom: 4 },
  animalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  animalOption: {
    width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.borderLight,
  },
  animalOptionSelected: { borderColor: colors.sage, backgroundColor: colors.sageLight, borderWidth: 2.5 },
  animalOptionEmoji: { fontSize: 26 },
  emailValue: { fontSize: 15, color: colors.text, fontWeight: '600' },
  sectionHead: {
    fontSize: 13, fontWeight: '800', color: colors.sage, marginTop: 22, marginBottom: 4,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  label: { fontSize: 14, fontWeight: '700', color: '#374151', marginBottom: 6, marginTop: 12 },
  required: { color: colors.red },
  hint: { fontSize: 12, color: colors.textMuted, marginBottom: 8, lineHeight: 17 },
  input: {
    backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 16, color: colors.text,
  },
  textArea: { height: 90, textAlignVertical: 'top' },
  kidCard: {
    backgroundColor: colors.background, borderRadius: 14, borderWidth: 1.5,
    borderColor: colors.border, padding: 14, marginBottom: 10,
  },
  kidCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  kidLabel: { fontSize: 13, fontWeight: '800', color: colors.sage, textTransform: 'uppercase', letterSpacing: 0.6 },
  removeKidText: { fontSize: 13, color: colors.red, fontWeight: '600' },
  birthdayBtn: {
    marginTop: 10, backgroundColor: colors.card, borderRadius: 12,
    borderWidth: 1.5, borderColor: colors.borderLight, padding: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  birthdayBtnLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  birthdayBtnValue: { fontSize: 13, color: colors.text, fontWeight: '500' },
  pickerDoneBtn: { alignItems: 'flex-end', paddingVertical: 8, paddingHorizontal: 4 },
  pickerDoneText: { fontSize: 15, color: colors.primary, fontWeight: '700' },
  addKidBtn: {
    borderWidth: 1.5, borderColor: colors.sage, borderStyle: 'dashed',
    borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 4,
  },
  addKidBtnText: { fontSize: 15, color: colors.sage, fontWeight: '700' },
  saveBtn: {
    backgroundColor: colors.primary, borderRadius: 16, paddingVertical: 17,
    alignItems: 'center', marginTop: 28,
    shadowColor: colors.primary, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  saveBtnDisabled: { backgroundColor: colors.border, shadowOpacity: 0 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  partnerLinkedCard: {
    backgroundColor: colors.sageLight, borderRadius: 14, padding: 14,
    borderWidth: 1.5, borderColor: colors.sage, marginBottom: 4,
  },
  partnerLinkedText: { fontSize: 14, color: colors.sageDark, fontWeight: '600' },
  invitePartnerBtn: {
    borderWidth: 1.5, borderColor: colors.primary, borderRadius: 16,
    paddingVertical: 16, alignItems: 'center', marginTop: 8,
  },
  invitePartnerText: { fontSize: 16, color: colors.primary, fontWeight: '700' },
  connectCodeCard: {
    backgroundColor: colors.card, borderRadius: 14, padding: 16, marginTop: 4, marginBottom: 16,
    borderWidth: 1.5, borderColor: colors.borderLight,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  connectCodeLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '600', marginBottom: 4 },
  connectCodeValue: { fontSize: 22, color: colors.text, fontWeight: '800', letterSpacing: 2 },
  connectCodeShare: { fontSize: 15, color: colors.primary, fontWeight: '700' },
  discoverableRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 8, marginBottom: 8,
  },
  discoverableLabel: { fontSize: 15, color: colors.text, fontWeight: '600', marginBottom: 4 },
  historyBtn: {
    marginTop: 12, borderRadius: 16, paddingVertical: 16, alignItems: 'center',
    backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.borderLight,
  },
  historyBtnText: { fontSize: 15, color: colors.text, fontWeight: '700' },
  signOutBtn: {
    marginTop: 12, borderRadius: 16, paddingVertical: 17, alignItems: 'center',
    borderWidth: 1.5, borderColor: colors.border,
  },
  signOutText: { fontSize: 16, color: colors.textSecondary, fontWeight: '700' },
  deleteAccountBtn: { marginTop: 20, paddingVertical: 12, alignItems: 'center' },
  deleteAccountText: { fontSize: 14, color: colors.red, fontWeight: '600' },
  serviceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 13, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  checkbox: {
    width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card,
  },
  checkboxChecked: { backgroundColor: colors.sage, borderColor: colors.sage },
  checkmark: { fontSize: 14, color: '#fff', fontWeight: '800', lineHeight: 16 },
  serviceEmoji: { fontSize: 20 },
  serviceLabel: { fontSize: 15, color: colors.textSecondary, fontWeight: '500', flex: 1 },
  serviceLabelChecked: { color: colors.text, fontWeight: '700' },
});
