import { useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { useFocusEffect } from 'expo-router';
import { supabase } from './supabase';

const inExpoGo = Constants.appOwnership === 'expo' || Constants.executionEnvironment === 'storeClient';

// Keep the app-icon badge equal to the in-app unread count. Nothing used
// to clear it, so the icon could show a "1" that matched nothing inside.
function syncAppIconBadge(n: number) {
  if (Platform.OS === 'web' || inExpoGo) return;
  const Notifications = require('expo-notifications') as typeof import('expo-notifications');
  Notifications.setBadgeCountAsync(n).catch(() => {});
}

// Unread count for the Home-screen bell. Refetches on focus and listens for
// new rows in realtime so the badge moves without a manual reload.
export function useUnreadNotifications(familyId: string | undefined) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!familyId) { setCount(0); return; }
    const { count: c } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('family_id', familyId)
      .is('read_at', null);
    setCount(c ?? 0);
    syncAppIconBadge(c ?? 0);
  }, [familyId]);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  useEffect(() => {
    if (!familyId) return;
    const channel = supabase
      .channel(`notifications_unread_${familyId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `family_id=eq.${familyId}` },
        () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [familyId, refresh]);

  return { count, refresh };
}
