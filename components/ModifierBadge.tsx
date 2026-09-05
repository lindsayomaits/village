import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { colors } from '../lib/theme';

const MODIFIER: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap; fill?: string; color: string; border?: string }> = {
  urgent:    { label: 'Urgent',         icon: 'alert-circle',       fill: colors.red, color: '#fff' },
  overnight: { label: 'Overnight',      icon: 'moon-outline',       color: colors.sageDark, border: colors.sage + '60' },
  rate2x:    { label: '2× rate',        icon: 'flash-outline',      color: colors.amber, border: colors.amber + '60' },
  flexible:  { label: 'Flexible dates', icon: 'calendar-outline',   color: colors.textSecondary, border: colors.border },
  sent:      { label: 'Sent to you',    icon: 'arrow-redo-outline', color: colors.textSecondary, border: colors.border },
};

export function ModifierBadge({ kind }: { kind: keyof typeof MODIFIER }) {
  const m = MODIFIER[kind];
  return (
    <View style={[styles.chip, m.fill ? { backgroundColor: m.fill } : { borderWidth: 1.5, borderColor: m.border }]}>
      <Ionicons name={m.icon} size={13} color={m.color} />
      <Text style={[styles.text, { color: m.color }]}>{m.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20, alignSelf: 'flex-start' },
  text: { fontSize: 12, fontWeight: '600' },
});
