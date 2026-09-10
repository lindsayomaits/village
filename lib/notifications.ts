import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from './supabase';

const inExpoGo = Constants.appOwnership === 'expo' || Constants.executionEnvironment === 'storeClient';

// Merely importing 'expo-notifications' throws in Expo Go (SDK 53+ dropped
// remote push there), so it must be required lazily and only outside Expo Go
// — a static top-level import would crash every screen that pulls this file in.
function getNotifications() {
  return require('expo-notifications') as typeof import('expo-notifications');
}

if (!inExpoGo) {
  getNotifications().setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

type PushData = { path?: string };

// Push delivery + inbox history now happen together, server-side, in one
// SECURITY DEFINER call (see supabase-schema.sql, migration 85). The client
// no longer talks to exp.host directly or manages retries/invalid-token
// cleanup — Postgres does, via pg_net, the same way the cron jobs already
// did. Every outbound notification also lands as a `notifications` row so
// there's a history to browse (app/notifications.tsx).

export async function notifyFamily(
  familyId: string,
  title: string,
  body: string,
  data?: PushData,
) {
  const { error } = await supabase.rpc('app_notify', {
    p_family_id: familyId,
    p_title: title,
    p_body: body,
    p_path: data?.path ?? null,
  });
  // eslint-disable-next-line no-console
  if (error) console.warn('app_notify failed', error.message);
}

export async function notifyConnections(
  _familyId: string,
  title: string,
  body: string,
  data?: PushData,
  // Only connections who've listed this category as something they're open
  // to helping with (or haven't set any preference) are notified — a
  // dog-walk request shouldn't ping someone who only offers "professional
  // help". Filtering happens server-side now.
  category?: string,
) {
  const { error } = await supabase.rpc('app_notify_connections', {
    p_title: title,
    p_body: body,
    p_path: data?.path ?? null,
    p_category: category ?? null,
  });
  // eslint-disable-next-line no-console
  if (error) console.warn('app_notify_connections failed', error.message);
}

export async function notifyAdmins(
  title: string,
  body: string,
  data?: PushData,
) {
  const { error } = await supabase.rpc('app_notify_admins', {
    p_title: title,
    p_body: body,
    p_path: data?.path ?? null,
  });
  // eslint-disable-next-line no-console
  if (error) console.warn('app_notify_admins failed', error.message);
}

// Registers this device's Expo push token against the family row. Cheap to
// call, but it writes to `families` every time — callers should only invoke
// it when the token might actually have changed (see lib/auth.tsx), not on
// every screen focus.
export async function registerForPushNotifications(familyId: string) {
  if (Platform.OS === 'web') return;
  // Remote push was removed from Expo Go in SDK 53 — skip registration
  // there so login doesn't crash; only development/production builds
  // actually deliver push anyway.
  if (inExpoGo) return;

  const Notifications = getNotifications();

  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;

    if (existing !== 'granted') {
      const { status: requested } = await Notifications.requestPermissionsAsync();
      status = requested;
    }

    if (status !== 'granted') return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'VillageMates',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;

    // Only write if it actually changed — avoids a families UPDATE (and the
    // realtime echo it triggers) on every call.
    const { data: row } = await supabase.from('families').select('push_token').eq('id', familyId).single();
    if (row?.push_token !== token) {
      await supabase.from('families').update({ push_token: token }).eq('id', familyId);
    }
  } catch (e) {
    // Push token unavailable in dev — will work after EAS deployment
    // eslint-disable-next-line no-console
    console.warn('Unable to register for push notifications', e);
  }
}
