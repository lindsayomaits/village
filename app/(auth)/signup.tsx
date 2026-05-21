import { useState } from 'react';
import {
  View, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { Text } from '../../components/Text';
import { supabase } from '../../lib/supabase';
import { colors } from '../../lib/theme';

type Mode = 'new_household' | 'partner';

export default function SignupScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('new_household');
  const [householdName, setHouseholdName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [partnerCode, setPartnerCode] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSignup() {
    if (!agreedToTerms) return Alert.alert('Terms & Conditions', 'Please agree to the Terms & Conditions to continue.');
    if (!email || !password) return Alert.alert('Please fill in all fields');
    if (mode === 'new_household' && !householdName) return Alert.alert('Please enter your household name');
    if (mode === 'partner' && !partnerCode) return Alert.alert('Please enter the partner code from your household');
    setLoading(true);

    if (mode === 'new_household') {
      await signUpNewHousehold();
    } else {
      await signUpAsPartner();
    }
    setLoading(false);
  }

  async function signUpNewHousehold() {
    const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
    if (authError || !authData.user) {
      return Alert.alert('Sign up failed', authError?.message ?? 'Unknown error');
    }

    const { error: householdError } = await supabase.from('families').insert({
      user_id: authData.user.id,
      name: householdName.trim(),
      email: email.trim().toLowerCase(),
      hours_balance: 10,
      is_admin: false,
    });
    if (householdError) return Alert.alert('Error creating household', householdError.message);

    Alert.alert('Welcome to The Village! 🌟', 'You start with 10 hours. Connect with households you know to get started.', [
      { text: "Let's go!", onPress: () => router.replace('/(tabs)/') },
    ]);
  }

  async function signUpAsPartner() {
    const { data: invite, error: inviteError } = await supabase
      .from('invites')
      .select('*')
      .eq('code', partnerCode.trim().toUpperCase())
      .eq('invite_type', 'partner')
      .is('used_by', null)
      .single();
    if (inviteError || !invite) {
      return Alert.alert('Invalid partner code', 'Please check the code and try again. Make sure your partner sent you a partner invite from the app.');
    }

    const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
    if (authError || !authData.user) {
      return Alert.alert('Sign up failed', authError?.message ?? 'Unknown error');
    }

    const { error: joinError } = await supabase.rpc('join_as_partner', { p_code: partnerCode.trim().toUpperCase() });
    if (joinError) return Alert.alert('Error joining household', joinError.message);

    Alert.alert("You're in! 🌟", "You've been added to your partner's household account.", [
      { text: "Let's go!", onPress: () => router.replace('/(tabs)/') },
    ]);
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>🌟</Text>
        <Text style={styles.title}>Join The Village</Text>

        {/* Mode toggle */}
        <View style={styles.toggle}>
          <TouchableOpacity
            style={[styles.toggleBtn, mode === 'new_household' && styles.toggleBtnActive]}
            onPress={() => setMode('new_household')}
          >
            <Text style={[styles.toggleText, mode === 'new_household' && styles.toggleTextActive]}>
              New household
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, mode === 'partner' && styles.toggleBtnActive]}
            onPress={() => setMode('partner')}
          >
            <Text style={[styles.toggleText, mode === 'partner' && styles.toggleTextActive]}>
              Joining my partner
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.subtitle}>
          {mode === 'new_household'
            ? 'Create your household, then connect with people you know and trust'
            : 'Your partner sent you a code — use it below to join their household'}
        </Text>

        {mode === 'new_household' && (
          <>
            <Text style={styles.label}>Household Name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. The Smith Household"
              placeholderTextColor={colors.textMuted}
              value={householdName}
              onChangeText={setHouseholdName}
            />
          </>
        )}

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          placeholder="you@example.com"
          placeholderTextColor={colors.textMuted}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <Text style={styles.label}>Password</Text>
        <View style={styles.passwordRow}>
          <TextInput
            style={styles.passwordInput}
            placeholder="Min. 6 characters"
            placeholderTextColor={colors.textMuted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
          />
          <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword(v => !v)}>
            <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁️'}</Text>
          </TouchableOpacity>
        </View>

        {mode === 'partner' && (
          <>
            <Text style={styles.label}>Partner Code</Text>
            <TextInput
              style={[styles.input, styles.codeInput]}
              placeholder="XXXXXX"
              placeholderTextColor={colors.textMuted}
              value={partnerCode}
              onChangeText={setPartnerCode}
              autoCapitalize="characters"
            />
          </>
        )}

        {/* Terms & Conditions */}
        <TouchableOpacity style={styles.termsRow} onPress={() => setAgreedToTerms(v => !v)} activeOpacity={0.7}>
          <View style={[styles.checkbox, agreedToTerms && styles.checkboxChecked]}>
            {agreedToTerms && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.termsText}>
            I agree to the{' '}
            <Text style={styles.termsLink}>Terms & Conditions</Text>
            {' '}and{' '}
            <Text style={styles.termsLink}>Privacy Policy</Text>
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.button} onPress={handleSignup} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>
                {mode === 'new_household' ? 'Create Account' : "Join Partner's Account"}
              </Text>}
        </TouchableOpacity>

        <Link href="/(auth)/login" asChild>
          <TouchableOpacity style={styles.link}>
            <Text style={styles.linkText}>Already have an account? <Text style={styles.linkBold}>Log in</Text></Text>
          </TouchableOpacity>
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  inner: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 40 },
  logo: { fontSize: 56, textAlign: 'center', marginBottom: 10 },
  title: { fontSize: 30, fontWeight: '800', color: colors.text, textAlign: 'center', marginBottom: 16 },
  toggle: {
    flexDirection: 'row', backgroundColor: colors.card,
    borderRadius: 14, borderWidth: 1.5, borderColor: colors.border,
    padding: 4, marginBottom: 12,
  },
  toggleBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  toggleBtnActive: { backgroundColor: colors.primary },
  toggleText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  toggleTextActive: { color: '#fff', fontWeight: '700' },
  subtitle: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginBottom: 20, fontWeight: '500' },
  label: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: 14, paddingHorizontal: 18, paddingVertical: 14,
    fontSize: 16, color: colors.text, fontFamily: 'Inter_400Regular',
    shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 4, elevation: 1,
  },
  passwordRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: 14, paddingRight: 12,
    shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 4, elevation: 1,
  },
  passwordInput: { flex: 1, paddingHorizontal: 18, paddingVertical: 14, fontSize: 16, color: colors.text, fontFamily: 'Inter_400Regular' },
  eyeBtn: { padding: 6 },
  eyeIcon: { fontSize: 20 },
  codeInput: { letterSpacing: 4, textAlign: 'center', fontSize: 22, fontWeight: '700' },
  termsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 20, gap: 12 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 2, borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: '#fff', fontSize: 13, fontWeight: '800' },
  termsText: { flex: 1, fontSize: 13, color: colors.textSecondary, lineHeight: 20 },
  termsLink: { color: colors.primary, fontWeight: '700' },
  button: {
    backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 17,
    alignItems: 'center', marginTop: 20,
    shadowColor: colors.primary, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  link: { marginTop: 24, alignItems: 'center' },
  linkText: { color: colors.textSecondary, fontSize: 14, fontWeight: '500' },
  linkBold: { color: colors.primary, fontWeight: '700' },
});
