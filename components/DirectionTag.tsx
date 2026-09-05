import { View, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Text } from './Text';
import { colors } from '../lib/theme';

// Every request shows the hour consequence *for the person reading it* —
// sign, arrow, and background tint all agree, so it survives a half-second
// glance. Earning (helping someone) reads southwest/sage; spending (your
// own request, once fulfilled) reads northeast/coral. There's no separate
// "offering" post type anymore — only which side of a request you're on.
export function DirectionTag({ earning, hours }: { earning: boolean; hours: number }) {
  const color = earning ? colors.sageDark : colors.primaryDark;
  const bg = earning ? colors.greenLight : colors.primaryLight;
  return (
    <View style={[styles.strip, { backgroundColor: bg }]}>
      <MaterialIcons name={earning ? 'call-received' : 'call-made'} size={15} color={color} />
      <Text style={[styles.label, { color }]}>REQUEST</Text>
      <Text style={[styles.hours, { color }]}>
        {earning ? `you'd earn +${hours}h` : `you'd spend -${hours}h`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  hours: { fontSize: 12, fontWeight: '600', marginLeft: 'auto' },
});
