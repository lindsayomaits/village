import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { colors } from '../lib/theme';

// Status is never carried by color alone — each one pairs a distinct
// border style (hollow / dashed / solid / flat / struck-through) with its
// own glyph, so the badge still reads correctly in greyscale.
const STATUS_STYLE: Record<string, {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  border: 'hollow' | 'dashed' | 'none';
  fill?: string;
  color: string;
  strike?: boolean;
}> = {
  open:      { label: 'Open',      icon: 'ellipse-outline',          border: 'hollow', color: colors.textSecondary },
  offered:   { label: 'Pending',   icon: 'hourglass-outline',        border: 'dashed', fill: colors.amberLight, color: colors.amber },
  accepted:  { label: 'Accepted',  icon: 'checkmark-circle',         border: 'none',   fill: colors.sage,        color: '#fff' },
  completed: { label: 'Completed', icon: 'checkmark-done-outline',   border: 'none',   fill: colors.borderLight, color: colors.textSecondary },
  cancelled: { label: 'Cancelled', icon: 'close-circle-outline',     border: 'hollow', color: colors.textMuted, strike: true },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.open;
  return (
    <View
      style={[
        styles.badge,
        s.border === 'hollow' && { borderWidth: 1.5, borderColor: colors.border },
        s.border === 'dashed' && { borderWidth: 1.5, borderColor: colors.amber + '80', borderStyle: 'dashed' },
        s.fill && { backgroundColor: s.fill },
      ]}
    >
      <Ionicons name={s.icon} size={13} color={s.color} />
      <Text style={[styles.text, { color: s.color }, s.strike && styles.strike]}>{s.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, alignSelf: 'flex-start' },
  text: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
  strike: { textDecorationLine: 'line-through' },
});
