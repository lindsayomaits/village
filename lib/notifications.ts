import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
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

async function sendPush(messages: { to: string; title: string; body: string; sound: string }[]) {
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
                await supabase.from('families').update({ partner_push_token: null }).eq('partner_push_token', token);
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

export async function registerForPushNotifications(familyId: string, isPartner: boolean) {
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
    const token = (await Notifications.getExpoPushTokenAsync()).data;
    const field = isPartner ? 'partner_push_token' : 'push_token';
    await supabase.from('families').update({ [field]: token }).eq('id', familyId);
  } catch {
    // Push token unavailable in dev — will work after EAS deployment
    // eslint-disable-next-line no-console
    console.warn('Unable to register for push notifications');
  }
}

export async function notifyConnections(
  familyId: string,
  title: string,
  body: string,
) {
  const { data: connections } = await supabase
    .from('connections')
    .select('requester_id, recipient_id')
    .eq('status', 'accepted')
    .or(`requester_id.eq.${familyId},recipient_id.eq.${familyId}`);

  const connectedIds = (connections ?? []).map(c => c.requester_id === familyId ? c.recipient_id : c.requester_id);
  if (connectedIds.length === 0) return;

  const { data } = await supabase
    .from('families')
    .select('push_token, partner_push_token')
    .in('id', connectedIds);

  const tokens = (data ?? []).flatMap(f => validTokens(f.push_token, f.partner_push_token));
  await sendPush(tokens.map(to => ({ to, title, body, sound: 'default' })));
}

export async function notifyAdmins(
  title: string,
  body: string,
) {
  // Plain families select would be RLS-blocked when the caller (often just
  // a regular reporting household) isn't connected to the admin — this
  // needs to work regardless, so it goes through a security-definer RPC
  // rather than a direct table read.
  const { data } = await supabase.rpc('get_admin_push_tokens');
  const tokens: string[] = (data ?? []).flatMap((f: { push_token: string | null; partner_push_token: string | null }) =>
    validTokens(f.push_token, f.partner_push_token));
  await sendPush(tokens.map((to: string) => ({ to, title, body, sound: 'default' })));
}

export async function notifyFamily(
  familyId: string,
  title: string,
  body: string,
) {
  const { data } = await supabase
    .from('families')
    .select('push_token, partner_push_token')
    .eq('id', familyId)
    .single();

  const tokens = validTokens(data?.push_token, data?.partner_push_token);
  await sendPush(tokens.map(to => ({ to, title, body, sound: 'default' })));
}

export async function notifyVillage(
  senderFamilyId: string,
  senderName: string,
  body: string,
  mentionedTargets: { familyId: string; target: 'primary' | 'partner' | 'both' }[],
) {
  const { data } = await supabase
    .from('families')
    .select('id, push_token, partner_push_token, village_notifications')
    .neq('id', senderFamilyId);

  const messages: { to: string; title: string; body: string; sound: string }[] = [];

  for (const f of (data ?? [])) {
    const pref = f.village_notifications ?? 'all';
    if (pref === 'muted') continue;
    const mention = mentionedTargets.find(t => t.familyId === f.id);
    const isMentioned = !!mention;
    if (pref === 'mentions' && !isMentioned) continue;

    const title = isMentioned ? `${senderName} mentioned you` : `${senderName} in VillageMates`;
    // A mention pings only the tagged person's device; an ordinary
    // broadcast (not mentioned, pref = 'all') still reaches the whole household.
    const tokens = !isMentioned ? validTokens(f.push_token, f.partner_push_token)
      : mention.target === 'primary' ? validTokens(f.push_token)
      : mention.target === 'partner' ? validTokens(f.partner_push_token)
      : validTokens(f.push_token, f.partner_push_token);
    for (const to of tokens) {
      messages.push({ to, title, body, sound: 'default' });
    }
  }

  await sendPush(messages);
}
