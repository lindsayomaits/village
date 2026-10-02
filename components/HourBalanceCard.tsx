import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Text } from './Text';
import { colors } from '../lib/theme';

export function HourBalanceCard({
  balance, pendingIncoming, pendingOutgoing, pendingIncomingCount, pendingOutgoingCount,
  onPress, onPressIncoming, onPressOutgoing,
}: {
  balance: number; pendingIncoming: number; pendingOutgoing: number;
  pendingIncomingCount: number; pendingOutgoingCount: number;
  onPress: () => void;
  // Tap targets for the two pending tiles — "on the way" jumps to the
  // things you've offered to help with, "if fulfilled" to your own posts.
  onPressIncoming?: () => void;
  onPressOutgoing?: () => void;
}) {
  const commitmentLabel = (n: number) => `${n} ${n === 1 ? 'commitment' : 'commitments'}`;

  const incomingCaption = `on the way${pendingIncomingCount > 0 ? ` · ${commitmentLabel(pendingIncomingCount)}` : ''}`;
  const outgoingCaption = `if fulfilled${pendingOutgoingCount > 0 ? ` · ${commitmentLabel(pendingOutgoingCount)}` : ''}`;

  const projected = balance + pendingIncoming - pendingOutgoing;
  const net = pendingIncoming - pendingOutgoing;
  const flowTotal = pendingIncoming + pendingOutgoing;
  const fmt = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}h`;

  return (
    <LinearGradient colors={[colors.sage, colors.sageDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
      <View style={styles.topRow}>
        <Text style={styles.label}>YOUR HOUR BANK</Text>
        <TouchableOpacity style={styles.historyBtn} onPress={onPress}>
          <Text style={styles.historyBtnText}>History →</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.balanceRow}>
        <Text style={styles.balance} numberOfLines={1} adjustsFontSizeToFit>{balance}</Text>
        {balance < 0 && (
          <View style={styles.negativeChip}>
            <Ionicons name="alert-circle" size={13} color="#fff" />
            <Text style={styles.negativeChipText}>below zero</Text>
          </View>
        )}
      </View>
      <Text style={styles.balanceCaption}>hours available</Text>

      <View style={styles.pendingRow}>
        <TouchableOpacity
          style={[styles.pendingBox, styles.pendingBoxIn]}
          onPress={onPressIncoming}
          disabled={!onPressIncoming}
          activeOpacity={0.7}
          accessibilityRole={onPressIncoming ? 'button' : undefined}
          accessibilityLabel={onPressIncoming ? `Plus ${pendingIncoming} hours on the way, ${incomingCaption}. Opens what you've offered to help with.` : undefined}
        >
          <View style={styles.pendingHeader}>
            <View style={[styles.iconCircle, { backgroundColor: colors.green }]}>
              <Ionicons name="add" size={16} color="#fff" />
            </View>
            <Text style={[styles.pendingAmount, { color: IN_COLOR }]}>{pendingIncoming}h</Text>
            {onPressIncoming && <MaterialIcons name="chevron-right" size={18} color={colors.textMuted} style={styles.chevron} />}
          </View>
          <Text style={styles.pendingCaption}>{incomingCaption}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.pendingBox, styles.pendingBoxOut]}
          onPress={onPressOutgoing}
          disabled={!onPressOutgoing}
          activeOpacity={0.7}
          accessibilityRole={onPressOutgoing ? 'button' : undefined}
          accessibilityLabel={onPressOutgoing ? `Minus ${pendingOutgoing} hours if fulfilled, ${outgoingCaption}. Opens your own requests.` : undefined}
        >
          <View style={styles.pendingHeader}>
            <View style={[styles.iconCircle, { backgroundColor: colors.red }]}>
              <Ionicons name="remove" size={16} color="#fff" />
            </View>
            <Text style={[styles.pendingAmount, { color: colors.red }]}>{pendingOutgoing}h</Text>
            {onPressOutgoing && <MaterialIcons name="chevron-right" size={18} color={colors.textMuted} style={styles.chevron} />}
          </View>
          <Text style={styles.pendingCaption}>{outgoingCaption}</Text>
        </TouchableOpacity>
      </View>

      {/* In vs out at a glance — green share is what's coming in, red what's
          going out — then where the balance lands once it all settles. */}
      {flowTotal > 0 && (
        <View style={styles.projection} accessibilityLabel={`If everything goes through, your balance goes from ${balance} to ${projected} hours`}>
          <View style={styles.flowBar}>
            {pendingIncoming > 0 && <View style={{ flex: pendingIncoming, backgroundColor: colors.green }} />}
            {pendingOutgoing > 0 && <View style={{ flex: pendingOutgoing, backgroundColor: colors.red }} />}
          </View>
          <View style={styles.projectionRow}>
            <Text style={styles.projectionText}>
              If everything goes through: <Text style={styles.projectionStrong}>{projected}h</Text>
            </Text>
            <View style={[styles.netPill, { backgroundColor: net > 0 ? colors.greenLight : net < 0 ? colors.redLight : colors.borderLight }]}>
              <Text style={[styles.netPillText, { color: net > 0 ? IN_COLOR : net < 0 ? colors.red : colors.textSecondary }]}>{fmt(net)}</Text>
            </View>
          </View>
        </View>
      )}
    </LinearGradient>
  );
}

// Darker than colors.green so the amount reads on white at a glance.
const IN_COLOR = '#3F7A52';

const styles = StyleSheet.create({
  card: { borderRadius: 20, padding: 20, marginBottom: 20 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 1, color: 'rgba(255,255,255,0.85)' },
  historyBtn: { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  historyBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  balance: { fontSize: 48, fontWeight: '800', color: '#fff', letterSpacing: -1, lineHeight: 52 },
  negativeChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.red, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4 },
  negativeChipText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  balanceCaption: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.85)', marginBottom: 16 },
  pendingRow: { flexDirection: 'row', gap: 10 },
  pendingBox: { flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 12, gap: 4, borderLeftWidth: 4 },
  pendingBoxIn: { borderLeftColor: colors.green },
  pendingBoxOut: { borderLeftColor: colors.red },
  pendingHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  iconCircle: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  pendingAmount: { fontSize: 20, fontWeight: '800' },
  chevron: { marginLeft: 'auto' },
  pendingCaption: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  projection: { marginTop: 12, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 14, padding: 12, gap: 8 },
  flowBar: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2 },
  projectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  projectionText: { flex: 1, fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.9)' },
  projectionStrong: { fontWeight: '800', color: '#fff' },
  netPill: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  netPillText: { fontSize: 13, fontWeight: '800' },
});
