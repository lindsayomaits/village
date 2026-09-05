import { createContext, useContext, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { supabase } from './supabase';
import { registerForPushNotifications } from './notifications';
import type { Family } from '../types';
import type { Session } from '@supabase/supabase-js';

type AuthContextType = {
  session: Session | null;
  family: Family | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshFamily: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  session: null,
  family: null,
  loading: true,
  signOut: async () => {},
  refreshFamily: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [family, setFamily] = useState<Family | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadFamily(userId: string) {
    const { data } = await supabase
      .from('families')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (data && data.is_active === false) {
      setFamily(null);
      Alert.alert('Account removed', 'An admin has removed your profile from VillageMates.');
      await supabase.auth.signOut();
      return;
    }

    setFamily(data ?? null);
    if (data) registerForPushNotifications(data.id);
  }

  async function refreshFamily() {
    if (session?.user.id) await loadFamily(session.user.id);
  }

  // Balance can change from outside this device's own actions — an admin
  // adjustment, a gift, a settlement someone else triggered — with no
  // screen navigation here to prompt a refetch. Without this, the hour
  // bank silently goes stale until something else happens to reload it.
  useEffect(() => {
    if (!family?.id) return;
    const channel = supabase
      .channel(`family_self_${family.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'families', filter: `id=eq.${family.id}` },
        (payload) => setFamily(payload.new as Family))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [family?.id]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadFamily(session.user.id).finally(() => setLoading(false));
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) loadFamily(session.user.id);
      else setFamily(null);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    setFamily(null);
  }

  return (
    <AuthContext.Provider value={{ session, family, loading, signOut, refreshFamily }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
