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
  const { code } = useLocalSearchParams<{ code?: string }>();
  const [exchanging, setExchanging] = useState(true);
  const [linkValid, setLinkValid] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function exchange() {
      if (!code) { setExchanging(false); return; }
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      setLinkValid(!error);
      setExchanging(false);
    }
    exchange();
  }, [code]);

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
