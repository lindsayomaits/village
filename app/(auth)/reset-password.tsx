import { useEffect, useState } from 'react';
import {
  View, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from '../../components/Text';
import { supabase } from '../../lib/supabase';
import { colors } from '../../lib/theme';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    code?: string | string[];
    token?: string | string[];
    token_hash?: string | string[];
    type?: string | string[];
    access_token?: string | string[];
    refresh_token?: string | string[];
  }>();

  const code = Array.isArray(params.code) ? params.code[0] : params.code;
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  const tokenHash = Array.isArray(params.token_hash) ? params.token_hash[0] : params.token_hash;
  const type = Array.isArray(params.type) ? params.type[0] : params.type;
  const accessToken = Array.isArray(params.access_token) ? params.access_token[0] : params.access_token;
  const refreshToken = Array.isArray(params.refresh_token) ? params.refresh_token[0] : params.refresh_token;

  const [exchanging, setExchanging] = useState(true);
  const [linkValid, setLinkValid] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function exchange() {
      try {
        const hashString = Platform.OS === 'web' ? window.location.hash : '';
        const hashParams = new URLSearchParams(hashString.startsWith('#') ? hashString.slice(1) : hashString);

        const hashCode = hashParams.get('code') ?? undefined;
        const hashToken = hashParams.get('token') ?? undefined;
        const hashTokenHash = hashParams.get('token_hash') ?? undefined;
        const hashType = hashParams.get('type') ?? undefined;
        const hashAccessToken = hashParams.get('access_token') ?? undefined;
        const hashRefreshToken = hashParams.get('refresh_token') ?? undefined;

        const effectiveCode = code ?? hashCode;
        const effectiveToken = token ?? hashToken;
        const effectiveTokenHash = tokenHash ?? hashTokenHash;
        const effectiveType = type ?? hashType;
        const effectiveAccessToken = accessToken ?? hashAccessToken;
        const effectiveRefreshToken = refreshToken ?? hashRefreshToken;

        if (effectiveCode) {
          const { error } = await supabase.auth.exchangeCodeForSession(effectiveCode);
          setLinkValid(!error);
          setExchanging(false);
          return;
        }

        if (effectiveAccessToken && effectiveRefreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: effectiveAccessToken,
            refresh_token: effectiveRefreshToken,
          });
          setLinkValid(!error);
          setExchanging(false);
          return;
        }

        const recoveryHash = effectiveTokenHash ?? effectiveToken;
        if (recoveryHash && effectiveType === 'recovery') {
          const { error } = await supabase.auth.verifyOtp({ token_hash: recoveryHash, type: 'recovery' });
          setLinkValid(!error);
          setExchanging(false);
          return;
        }

        setLinkValid(false);
        setExchanging(false);
      } catch {
        setLinkValid(false);
        setExchanging(false);
      }
    }
    exchange();
  }, [accessToken, code, refreshToken, token, tokenHash, type]);

  async function handleSetPassword() {
    if (password.length < 6) return Alert.alert('Password too short', 'Password must be at least 6 characters.');
    if (password !== confirmPassword) return Alert.alert("Passwords don't match");
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) return Alert.alert('Error', error.message);
    Alert.alert('Password updated!', 'You can now use your new password.', [
      { text: 'Continue', onPress: () => router.replace('/(tabs)/') },
    ]);
  }

  if (exchanging) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!linkValid) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Link expired</Text>
        <Text style={styles.subtitle}>This reset link is invalid or expired. Request a new one from the login screen.</Text>
        <TouchableOpacity style={styles.button} onPress={() => router.replace('/(auth)/login')}>
          <Text style={styles.buttonText}>Back to Login</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.inner}>
        <Text style={styles.title}>Set a new password</Text>
        <Text style={styles.subtitle}>Choose a new password for your account.</Text>

        <TextInput
          style={styles.input}
          placeholder="New password"
          placeholderTextColor={colors.textMuted}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoFocus
        />
        <TextInput
          style={styles.input}
          placeholder="Confirm new password"
          placeholderTextColor={colors.textMuted}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
        />

        <TouchableOpacity style={styles.button} onPress={handleSetPassword} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Set Password</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 16 },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  title: { fontSize: 28, fontWeight: '800', color: colors.text, marginBottom: 10, textAlign: 'center' },
  subtitle: { fontSize: 15, color: colors.textSecondary, marginBottom: 32, lineHeight: 22, textAlign: 'center' },
  input: {
    backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: 14, paddingHorizontal: 18, paddingVertical: 15,
    fontSize: 16, color: colors.text, marginBottom: 14,
    fontFamily: 'Inter_400Regular',
  },
  button: {
    backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 17,
    alignItems: 'center',
    shadowColor: colors.primary, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
