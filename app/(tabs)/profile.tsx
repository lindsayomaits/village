import { useState, useCallback } from 'react';
import {
  View, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Share, Switch,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Text } from '../../components/Text';
import { Avatar } from '../../components/Avatar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors } from '../../lib/theme';
import { getFamilyAnimal, ANIMALS } from '../../lib/animals';
import { calcAge } from '../../lib/utils';
import { pickAndUploadAvatar, removeAvatar } from '../../lib/photos';
import { notifyFamily } from '../../lib/notifications';
import { OnboardingIntro } from '../../components/OnboardingIntro';
import type { KidEntry, PetEntry, Block, Partnership, Family } from '../../types';

const PET_SIZES = ['Small', 'Medium', 'Large'] as const;

export default function ProfileScreen() {
  const { family, signOut, refreshFamily } = useAuth();
  const router = useRouter();

  const [name, setName] = useState('');
  const [parent1Name, setParent1Name] = useState('');
  const [parent1Phone, setParent1Phone] = useState('');
  const [address, setAddress] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [chosenAnimal, setChosenAnimal] = useState<string | null>(null);
  const [kids, setKids] = useState<KidEntry[]>([]);
  const [pets, setPets] = useState<PetEntry[]>([]);
  const [servicesOffered, setServicesOffered] = useState<string[]>([]);
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [togglingDiscoverable, setTogglingDiscoverable] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [blockedHouseholds, setBlockedHouseholds] = useState<Block[]>([]);
  const [partnership, setPartnership] = useState<Partnership | null>(null);
  const [partner, setPartner] = useState<Family | null>(null);
  const [unlinking, setUnlinking] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [showIntro, setShowIntro] = useState(false);

  async function handleChangePhoto() {
    if (!family) return;
    setUploadingPhoto(true);
    try {
      const url = await pickAndUploadAvatar(family.id);
      if (url) await refreshFamily();
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleRemovePhoto() {
    if (!family) return;
    setUploadingPhoto(true);
    try {
      const ok = await removeAvatar(family.id);
      if (ok) await refreshFamily();
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function loadBlocked() {
    if (!family) return;
    const { data: blocks } = await supabase
      .from('blocks')
      .select('*')
      .eq('blocker_id', family.id)
      .order('created_at', { ascending: false });
    const blockedIds = (blocks ?? []).map(b => b.blocked_id);
    if (blockedIds.length === 0) { setBlockedHouseholds([]); return; }
    // families_public (not families) so this still resolves even if you
    // blocked someone you were never connected to — full family rows are
    // PII-gated by connection and wouldn't return a row for them.
    const { data: names } = await supabase.from('families_public').select('id, name').in('id', blockedIds);
    const nameById = new Map((names ?? []).map(n => [n.id, n.name]));
    setBlockedHouseholds((blocks ?? []).map(b => ({ ...b, blocked: nameById.has(b.blocked_id) ? { name: nameById.get(b.blocked_id) } as Block['blocked'] : undefined })));
  }

  async function unblockHousehold(blockId: string) {
    const { error } = await supabase.from('blocks').delete().eq('id', blockId);
    if (error) return Alert.alert('Error', error.message);
    setBlockedHouseholds(prev => prev.filter(b => b.id !== blockId));
  }

  async function loadPartnership() {
    if (!family) { setPartnership(null); setPartner(null); return; }
    const { data } = await supabase
      .from('partnerships')
      .select('*')
      .or(`profile_a_id.eq.${family.id},profile_b_id.eq.${family.id}`)
      .maybeSingle();
    if (!data) { setPartnership(null); setPartner(null); return; }
    setPartnership(data);
    const partnerId = data.profile_a_id === family.id ? data.profile_b_id : data.profile_a_id;
    const { data: partnerRow } = await supabase.from('families').select('*').eq('id', partnerId).single();
    setPartner(partnerRow ?? null);
  }

  async function unlinkPartner() {
    if (!partnership) return;
    Alert.alert('Unlink from partner?', `You and ${partner?.name ?? 'your partner'} will each keep your own profiles — this just removes the link between them.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unlink', style: 'destructive', onPress: async () => {
          setUnlinking(true);
          const { error } = await supabase.rpc('leave_partnership', { p_partnership_id: partnership.id });
          setUnlinking(false);
          if (error) return Alert.alert('Error', error.message);
          if (partner) await notifyFamily(partner.id, '💔 Partner unlinked', `${family?.name ?? 'Your partner'} unlinked from you — you each keep your own profile and balance.`, { path: '/(tabs)/profile' });
          await loadPartnership();
        },
      },
    ]);
  }

  useFocusEffect(useCallback(() => {
    loadBlocked();
    loadPartnership();
    // Refocusing this tab used to always overwrite the form from server
    // state, silently discarding anything typed but not yet saved (e.g.
    // add a kid, switch tabs, come back — the kid was gone). Only load
    // from `family` when there's nothing unsaved to protect.
    if (family && !dirty) {
      setName(family.name ?? '');
      setParent1Name(family.parent1_name ?? '');
      setParent1Phone(family.parent1_phone ?? '');
      setAddress(family.address ?? '');
      setEmergencyContact(family.emergency_contact ?? '');
      setKids(family.kids_data ?? []);
      setPets(family.pets_data ?? []);
      setChosenAnimal(family.animal ?? null);
      setServicesOffered(family.services_offered ?? []);
    }
  }, [family?.id, dirty]));

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
      message: `Join me on VillageMates, a neighbor network for trading help — sitting, errands, meals, and more!\n\nUse this code to create your account: ${code}\n\nOn the sign-up screen, tap "Joining my partner's account" and enter this code.`,
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
    Alert.alert(
      'Delete your account?',
      'This permanently removes your personal info (name, phone, address, kids notes), unlinks any partner, and signs you out. Past chat and transaction history stays, since other people rely on it, but without your personal details attached.\n\nThis cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete My Account', style: 'destructive',
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
    if (!name.trim()) return Alert.alert('Name is required');
    setSaving(true);
    const { error } = await supabase
      .from('families')
      .update({
        name: name.trim(),
        parent1_name: parent1Name.trim() || null,
        parent1_phone: parent1Phone.trim() || null,
        address: address.trim() || null,
        emergency_contact: emergencyContact.trim() || null,
        kids_data: kids.filter(k => k.name.trim()).length > 0
          ? kids.filter(k => k.name.trim()).map(k => ({ name: k.name.trim(), birthday: k.birthday, notes: k.notes?.trim() || null }))
          : null,
        pets_data: pets.filter(p => p.name.trim()).length > 0
          ? pets.filter(p => p.name.trim()).map(p => ({ name: p.name.trim(), animal: p.animal.trim(), size: p.size, notes: p.notes?.trim() || null }))
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
    <>
    <OnboardingIntro visible={showIntro} onDone={() => setShowIntro(false)} />
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Profile</Text>

          {!family && (
            <View style={styles.unlinkBanner}>
              <Text style={styles.unlinkText}>
                ⚠️ We couldn't find your profile. Try signing out and back in — if this keeps happening, contact support.
              </Text>
            </View>
          )}

          <View style={styles.animalCard}>
            <TouchableOpacity onPress={handleChangePhoto} disabled={uploadingPhoto || !family}>
              <Avatar familyId={family?.id ?? ''} animal={chosenAnimal} photoUrl={family?.photo_url} size={56} />
              <View style={styles.photoEditBadge}>
                {uploadingPhoto ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.photoEditBadgeText}>✏️</Text>}
              </View>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.animalLabel}>{family?.photo_url ? 'Tap to change photo' : 'Add a profile photo'}</Text>
              <Text style={styles.emailValue}>{family?.email}</Text>
              {family?.photo_url && (
                <TouchableOpacity onPress={handleRemovePhoto} disabled={uploadingPhoto}>
                  <Text style={styles.removePhotoText}>Remove photo</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <Text style={styles.sectionHead}>{family?.photo_url ? 'Fallback animal' : 'Choose your animal'}</Text>
          <Text style={styles.hint}>Shown when you don't have a photo set.</Text>
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

          {/* Display name */}
          <Text style={styles.sectionHead}>Your Profile</Text>
          <Text style={styles.label}>Display name <Text style={styles.required}>*</Text></Text>
          <TextInput style={styles.input} value={name} onChangeText={field(setName)}
            placeholder="e.g. The Smith Family" placeholderTextColor={colors.textMuted} />
          <Text style={styles.label}>Your name</Text>
          <TextInput style={styles.input} value={parent1Name} onChangeText={field(setParent1Name)}
            placeholder="e.g. Sarah Smith" placeholderTextColor={colors.textMuted} />
          <Text style={styles.label}>Phone</Text>
          <TextInput style={styles.input} value={parent1Phone} onChangeText={field(setParent1Phone)}
            placeholder="e.g. (555) 123-4567" placeholderTextColor={colors.textMuted} keyboardType="phone-pad" />

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
          {kids.length === 0 && (
            <TouchableOpacity style={styles.addKidBtn} onPress={() => { setKids([{ name: '', birthday: null, notes: null }]); setDirty(true); }}>
              <Text style={styles.addKidBtnText}>+ Add Kids</Text>
            </TouchableOpacity>
          )}

          {kids.length > 0 && (
            <Text style={styles.hint}>Add each child — their name and birthday will show as their age to other families.</Text>
          )}

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
              <Text style={styles.careNotesLabel}>Care notes</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={kid.notes ?? ''}
                onChangeText={v => { setKids(prev => prev.map((k, j) => j === i ? { ...k, notes: v } : k)); setDirty(true); }}
                placeholder="Allergies, bedtime, anything a helper should know"
                placeholderTextColor={colors.textMuted}
                multiline numberOfLines={2} textAlignVertical="top"
              />
            </View>
          ))}

          {kids.length > 0 && (
            <TouchableOpacity style={styles.addKidBtn} onPress={() => { setKids(prev => [...prev, { name: '', birthday: null, notes: null }]); setDirty(true); }}>
              <Text style={styles.addKidBtnText}>+ Add another child</Text>
            </TouchableOpacity>
          )}

          {/* Pets */}
          <Text style={styles.sectionHead}>Pets</Text>
          {pets.length === 0 && (
            <TouchableOpacity style={styles.addKidBtn} onPress={() => { setPets([{ name: '', animal: '', size: null, notes: null }]); setDirty(true); }}>
              <Text style={styles.addKidBtnText}>+ Add Pet</Text>
            </TouchableOpacity>
          )}

          {pets.length > 0 && (
            <Text style={styles.hint}>Add each pet so a helper knows who they're looking after.</Text>
          )}

          {pets.map((pet, i) => (
            <View key={i} style={styles.kidCard}>
              <View style={styles.kidCardHeader}>
                <Text style={styles.kidLabel}>Pet {i + 1}</Text>
                <TouchableOpacity onPress={() => { setPets(prev => prev.filter((_, j) => j !== i)); setDirty(true); }}>
                  <Text style={styles.removeKidText}>Remove</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={styles.input}
                value={pet.name}
                onChangeText={v => { setPets(prev => prev.map((p, j) => j === i ? { ...p, name: v } : p)); setDirty(true); }}
                placeholder="Pet's name"
                placeholderTextColor={colors.textMuted}
              />
              <TextInput
                style={styles.input}
                value={pet.animal}
                onChangeText={v => { setPets(prev => prev.map((p, j) => j === i ? { ...p, animal: v } : p)); setDirty(true); }}
                placeholder="e.g. Dog, Cat, Golden Retriever"
                placeholderTextColor={colors.textMuted}
              />
              <View style={styles.segmentRow}>
                {PET_SIZES.map(size => (
                  <TouchableOpacity
                    key={size}
                    style={[styles.segmentBtn, pet.size === size && styles.segmentBtnActive]}
                    onPress={() => { setPets(prev => prev.map((p, j) => j === i ? { ...p, size } : p)); setDirty(true); }}
                  >
                    <Text style={[styles.segmentText, pet.size === size && styles.segmentTextActive]}>{size}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.careNotesLabel}>Care notes</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={pet.notes ?? ''}
                onChangeText={v => { setPets(prev => prev.map((p, j) => j === i ? { ...p, notes: v } : p)); setDirty(true); }}
                placeholder="Feeding instructions, vet info, anything a helper should know"
                placeholderTextColor={colors.textMuted}
                multiline numberOfLines={2} textAlignVertical="top"
              />
            </View>
          ))}

          {pets.length > 0 && (
            <TouchableOpacity style={styles.addKidBtn} onPress={() => { setPets(prev => [...prev, { name: '', animal: '', size: null, notes: null }]); setDirty(true); }}>
              <Text style={styles.addKidBtnText}>+ Add another pet</Text>
            </TouchableOpacity>
          )}

          {/* What I can help with */}
          <Text style={styles.sectionHead}>What I can help with</Text>
          <Text style={styles.hint}>Other people will see this on your profile when they're looking for help.</Text>
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

          <Text style={styles.sectionHead}>Your Partner</Text>
          {partner ? (
            <View style={styles.partnerLinkedCard}>
              <Text style={styles.partnerLinkedText}>Linked with {partner.name}{partner.parent1_name ? ` (${partner.parent1_name})` : ''} — their own profile, own login, own balance.</Text>
              <TouchableOpacity onPress={unlinkPartner} disabled={unlinking}>
                {unlinking
                  ? <ActivityIndicator color={colors.red} />
                  : <Text style={styles.unblockText}>Unlink</Text>}
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={styles.hint}>
                Invite your partner to create their own linked profile — their own login, own balance, own kid visibility, just connected to yours. Tap below to generate a one-time invite code to send them.
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
            Share your code with someone you know for an instant connection — no searching, no waiting for them to accept.
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

          {blockedHouseholds.length > 0 && (
            <>
              <Text style={styles.sectionHead}>Blocked People</Text>
              {blockedHouseholds.map(b => (
                <View key={b.id} style={styles.blockedRow}>
                  <Text style={styles.blockedName}>{b.blocked?.name ?? 'Someone'}</Text>
                  <TouchableOpacity onPress={() => unblockHousehold(b.id)}>
                    <Text style={styles.unblockText}>Unblock</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </>
          )}

          <TouchableOpacity style={styles.historyBtn} onPress={() => setShowIntro(true)}>
            <Text style={styles.historyBtnText}>How VillageMates Works</Text>
          </TouchableOpacity>

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
              : <Text style={styles.deleteAccountText}>Delete My Account</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: 20, paddingBottom: 48 },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, paddingTop: 16, marginBottom: 20 },
  unlinkBanner: {
    backgroundColor: colors.amberLight, borderRadius: 12, padding: 14, marginBottom: 16,
    borderWidth: 1, borderColor: colors.amber,
  },
  unlinkText: { fontSize: 13, color: colors.amber, lineHeight: 19, fontWeight: '500' },
  animalCard: {
    backgroundColor: colors.card, borderRadius: 14, padding: 16, marginBottom: 8,
    borderWidth: 1.5, borderColor: colors.borderLight,
    flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  animalEmoji: { fontSize: 40 },
  animalLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '600', marginBottom: 4 },
  photoEditBadge: {
    position: 'absolute', bottom: -2, right: -2, width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.card,
  },
  photoEditBadgeText: { fontSize: 10 },
  removePhotoText: { fontSize: 12, color: colors.red, fontWeight: '600', marginTop: 4 },
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
  careNotesLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginTop: 10, marginBottom: 4 },
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
  segmentRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  segmentBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: colors.borderLight, backgroundColor: colors.card, alignItems: 'center' },
  segmentBtnActive: { backgroundColor: colors.sageLight, borderColor: colors.sage },
  segmentText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  segmentTextActive: { color: colors.sageDark, fontWeight: '700' },
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
  blockedRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, paddingHorizontal: 14, backgroundColor: colors.card,
    borderRadius: 12, borderWidth: 1.5, borderColor: colors.borderLight, marginBottom: 8,
  },
  blockedName: { fontSize: 14, color: colors.text, fontWeight: '600' },
  unblockText: { fontSize: 13, color: colors.primary, fontWeight: '700' },
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
