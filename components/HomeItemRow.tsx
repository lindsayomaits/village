import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Text } from './Text';
import { colors } from '../lib/theme';

// The shared clean list-row: avatar, plain-language subtitle, a single
// meta line, and either an amount pill or a chevron on the right. Used
// across Home's sections so "Coming up," "My requests," and eventually
// Board all read the same way instead of each inventing their own layout.
export function HomeItemRow({
  animalEmoji, title, subtitle, meta, statusPill, amountText, earning, accentColor, onPress,
}: {
  animalEmoji: string;
  title: string;
  subtitle: string;
  meta: string;
  statusPill?: React.ReactNode;
  amountText?: string | null;
  // Which way the hours move for the viewer — picks the arrow icon.
  // Ignored when amountText is null.
  earning?: boolean;
  accentColor: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={[styles.card, { borderLeftColor: accentColor }]} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.avatarWrap}>
        <Text style={styles.avatarEmoji}>{animalEmoji}</Text>
      </View>
      <View style={styles.info}>
        {statusPill}
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
        <Text style={styles.meta}>{meta}</Text>
      </View>
      {amountText ? (
        <View style={[styles.amountPill, { backgroundColor: accentColor }]}>
          <MaterialIcons name={earning ? 'call-received' : 'call-made'} size={13} color="#fff" />
          <Text style={styles.amountPillText}>{amountText}</Text>
        </View>
      ) : (
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.card, borderRadius: 16, padding: 12, marginBottom: 10,
    borderWidth: 1, borderColor: colors.borderLight, borderLeftWidth: 4,
  },
  avatarWrap: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.sageLight, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarEmoji: { fontSize: 22 },
  info: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  meta: { fontSize: 11, color: colors.textMuted, fontWeight: '600', letterSpacing: 0.3 },
  amountPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 7, flexShrink: 0 },
  amountPillText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
