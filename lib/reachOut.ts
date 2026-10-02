import { Alert, Linking } from 'react-native';
import type { useRouter } from 'expo-router';
import type { Family } from '../types';

// After backing out of (or cancelling) something another household was
// counting on, nudge the person who did it to actually talk to them —
// a push notification alone is a cold way to find out your sitter fell
// through. Android caps Alert at three buttons, so: later / call / message.
export function promptReachOut(
  router: ReturnType<typeof useRouter>,
  other: Pick<Family, 'id' | 'name' | 'parent1_name' | 'parent1_phone'> | null | undefined,
  { title, message, prefill }: { title: string; message: string; prefill: string },
) {
  if (!other) return;
  const phoneDigits = other.parent1_phone?.replace(/\D/g, '') ?? '';
  const firstName = other.parent1_name?.trim().split(/\s+/)[0] || other.name;

  Alert.alert(title, message, [
    { text: 'Later', style: 'cancel' },
    ...(phoneDigits
      ? [{ text: `Call ${firstName}`, onPress: () => { Linking.openURL(`tel:${phoneDigits}`); } }]
      : []),
    {
      text: 'Message',
      onPress: () => router.push({ pathname: '/dm/[familyId]', params: { familyId: other.id, name: other.name, prefill } }),
    },
  ]);
}
