import { useState } from 'react';
import {
  View, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '../../components/Text';
import { supabase } from '../../lib/supabase';
import { colors } from '../../lib/theme';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleReset() {
    if (!email) return Alert.alert('Please enter your email address');
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: 'babysitexchange://reset-password',
    });
    setLoading(false);
    if (error) return Alert.alert('Error', error.message);
    setSent(true);
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.inner}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Reset Password</Text>
        <Text style={styles.subtitle}>
          Enter the email you signed up with and we'll send you a reset link.
        </Text>

        {sent ? (
          <View style={styles.successBox}>
            <Text style={styles.successIcon}>📬</Text>
            <Text style={styles.successTitle}>Check your inbox!</Text>
            <Text style={styles.successText}>
              We sent a password reset link to {email}. Follow the link to set a new password, then come back and log in.
            </Text>
            <TouchableOpacity style={styles.button} onPress={() => router.back()}>
              <Text style={styles.buttonText}>Back to Login</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <TextInput
              style={styles.input}
              placeholder="Email address"
              placeholderTextColor={colors.textMuted}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoFocus
            />
            <TouchableOpacity style={styles.button} onPress={handleReset} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send Reset Link</Text>}
            </TouchableOpacity>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  backBtn: { position: 'absolute', top: 60, left: 28 },
  backText: { fontSize: 16, color: colors.primary, fontWeight: '600' },
  title: { fontSize: 28, fontWeight: '800', color: colors.text, marginBottom: 10 },
  subtitle: { fontSize: 15, color: colors.textSecondary, marginBottom: 32, lineHeight: 22 },
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
  successBox: { alignItems: 'center', gap: 10 },
  successIcon: { fontSize: 52, marginBottom: 4 },
  successTitle: { fontSize: 22, fontWeight: '800', color: colors.text },
  successText: { fontSize: 15, color: colors.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 12 },
});
