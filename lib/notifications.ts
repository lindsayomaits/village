import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function validTokens(...tokens: (string | null | undefined)[]): string[] {
  return tokens.filter((t): t is string => !!t && t.startsWith('ExponentPushToken'));
}

type PushData = { path?: string };

async function sendPush(messages: { to: string; title: string; body: string; sound: string; data?: PushData }[]) {
  if (messages.length === 0) return;
  const maxTries = 3;
  let attempt = 0;
  while (attempt < maxTries) {
    attempt++;
    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages),
      });

      if (!res.ok) {
        const text = await res.text();
        // eslint-disable-next-line no-console
        console.warn(`Push send HTTP ${res.status}`, text);
        // retry on 5xx or network-like issues
        if (res.status >= 500 && attempt < maxTries) {
          await new Promise(r => setTimeout(r, 500 * attempt));
          continue;
        }
        return;
      }

      // parse result and handle per-recipient errors
      const json = await res.json().catch(() => null);
      const results = json?.data ?? json ?? null;
      if (Array.isArray(results)) {
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          const token = messages[i]?.to;
          if (r?.status === 'error') {
            const err = r?.details?.error ?? r?.message ?? 'unknown';
            // If token invalid or not registered, clear it from DB so we don't keep retrying
            if (token && (err === 'DeviceNotRegistered' || err === 'InvalidCredentials' || err === 'DeviceNotRegisteredError')) {
              try {
                await supabase.from('families').update({ push_token: null }).eq('push_token', token);
              } catch (e) {
                // eslint-disable-next-line no-console
                console.error('Failed to clear invalid push token', e);
              }
            }
            // eslint-disable-next-line no-console
            console.warn('Push delivery error for', token, err);
          }
        }
      }

      // success or handled errors — break loop
      return;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Push send attempt error', err);
      if (attempt < maxTries) await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
}

export async function registerForPushNotifications(familyId: string) {
  if (Platform.OS === 'web') return;

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

  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
    await supabase.from('families').update({ push_token: token }).eq('id', familyId);
  } catch (e) {
    // Push token unavailable in dev — will work after EAS deployment
    // eslint-disable-next-line no-console
    console.warn('Unable to register for push notifications', e);
  }
}

export async function notifyConnections(
  familyId: string,
  title: string,
  body: string,
  data?: PushData,
  // Only notify connections who've listed this category as something
  // they're open to helping with (or haven't set preferences at all yet)
  // — otherwise every new request pings your entire network regardless
  // of relevance, e.g. a dog-walk request reaching someone who only
  // marked "professional help".
  category?: string,
) {
  const { data: connections } = await supabase
    .from('connections')
    .select('requester_id, recipient_id')
    .eq('status', 'accepted')
    .or(`requester_id.eq.${familyId},recipient_id.eq.${familyId}`);

  const connectedIds = (connections ?? []).map(c => c.requester_id === familyId ? c.recipient_id : c.requester_id);
  if (connectedIds.length === 0) return;

  const { data: families } = await supabase
    .from('families')
    .select('push_token, services_offered')
    .in('id', connectedIds);

  const relevant = (families ?? []).filter(f =>
    !category || !f.services_offered || f.services_offered.length === 0 || f.services_offered.includes(category)
  );
  const tokens = relevant.flatMap(f => validTokens(f.push_token));
  await sendPush(tokens.map(to => ({ to, title, body, sound: 'default', data })));
}

export async function notifyAdmins(
  title: string,
  body: string,
  data?: PushData,
) {
  // Plain families select would be RLS-blocked when the caller (often just
  // a regular reporting household) isn't connected to the admin — this
  // needs to work regardless, so it goes through a security-definer RPC
  // rather than a direct table read.
  const { data: rows } = await supabase.rpc('get_admin_push_tokens');
  const tokens: string[] = (rows ?? []).flatMap((f: { push_token: string | null }) => validTokens(f.push_token));
  await sendPush(tokens.map((to: string) => ({ to, title, body, sound: 'default', data })));
}

export async function notifyFamily(
  familyId: string,
  title: string,
  body: string,
  data?: PushData,
) {
  const { data: row } = await supabase
    .from('families')
    .select('push_token')
    .eq('id', familyId)
    .single();

  const tokens = validTokens(row?.push_token);
  await sendPush(tokens.map(to => ({ to, title, body, sound: 'default', data })));
}
