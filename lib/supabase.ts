import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  const msg = 'Missing Supabase env vars: EXPO_PUBLIC_SUPABASE_URL and/or EXPO_PUBLIC_SUPABASE_ANON_KEY.';
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    throw new Error(msg);
  } else if (process.env.NODE_ENV !== 'production') {
    throw new Error(msg);
  } else {
    // In production we log the error to surface the problem without crashing immediately.
    // This is a last-resort fallback; please ensure env vars are provided in build config.
    // eslint-disable-next-line no-console
    console.error(msg);
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
