import { useState } from 'react';
import {
  View, TextInput, TouchableOpacity, StyleSheet, Image,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { Text } from '../../components/Text';
import { supabase } from '../../lib/supabase';
import { colors } from '../../lib/theme';
import { isValidEmail } from '../../lib/utils';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email || !password) return Alert.alert('Please fill in all fields');
    if (!isValidEmail(email)) return Alert.alert('Invalid email', 'Please enter a valid email address.');
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { Alert.alert('Login failed', error.message); return; }
    router.replace('/(tabs)/');
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.inner}>
        <Image source={require('../../assets/icon.png')} style={styles.logo} />
        <Text style={styles.title}>VillageMates</Text>
        <Text style={styles.subtitle}>Log in to your account</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textMuted}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <View style={styles.passwordRow}>
          <TextInput
            style={styles.passwordInput}
            placeholder="Password"
            placeholderTextColor={colors.textMuted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
          />
          <TouchableOpacity
            style={styles.eyeBtn}
            onPress={() => setShowPassword(v => !v)}
            accessibilityRole="button"
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
          >
            <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁️'}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Log In</Text>}
        </TouchableOpacity>

        <Link href="/(auth)/forgot-password" asChild>
          <TouchableOpacity style={styles.forgotLink}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>
        </Link>

        <Link href="/(auth)/signup" asChild>
          <TouchableOpacity style={styles.link}>
            <Text style={styles.linkText}>Don't have an account? <Text style={styles.linkBold}>Join with invite code</Text></Text>
          </TouchableOpacity>
        </Link>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  logo: { width: 72, height: 72, alignSelf: 'center', marginBottom: 10, borderRadius: 16 },
  title: { fontSize: 32, fontWeight: '800', color: colors.text, textAlign: 'center', marginBottom: 6 },
  subtitle: { fontSize: 15, color: colors.textSecondary, textAlign: 'center', marginBottom: 36, fontWeight: '500' },
  input: {
    backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: 14, paddingHorizontal: 18, paddingVertical: 15,
    fontSize: 16, color: colors.text, marginBottom: 12,
    fontFamily: 'Inter_400Regular',
    shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 4, elevation: 1,
  },
  passwordRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: 14, marginBottom: 12, paddingRight: 12,
    shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 4, elevation: 1,
  },
  passwordInput: { flex: 1, paddingHorizontal: 18, paddingVertical: 15, fontSize: 16, color: colors.text, fontFamily: 'Inter_400Regular' },
  eyeBtn: { padding: 6 },
  eyeIcon: { fontSize: 20 },
  button: {
    backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 17,
    alignItems: 'center', marginTop: 8,
    shadowColor: colors.primary, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  forgotLink: { marginTop: 16, alignItems: 'center' },
  forgotText: { color: colors.textSecondary, fontSize: 14, fontWeight: '500' },
  link: { marginTop: 16, alignItems: 'center' },
  linkText: { color: colors.textSecondary, fontSize: 14, fontWeight: '500' },
  linkBold: { color: colors.primary, fontWeight: '700' },
});
