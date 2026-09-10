import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import { Text } from './Text';
import { colors } from '../lib/theme';

const FLOOR = -20;

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
  const requestingPower = balance - FLOOR;
  const fillPct = Math.max(4, Math.min(100, (requestingPower / 40) * 100));
  const commitmentLabel = (n: number) => `${n} ${n === 1 ? 'commitment' : 'commitments'}`;

  const incomingCaption = `on the way${pendingIncomingCount > 0 ? ` · ${commitmentLabel(pendingIncomingCount)}` : ''}`;
  const outgoingCaption = `if fulfilled${pendingOutgoingCount > 0 ? ` · ${commitmentLabel(pendingOutgoingCount)}` : ''}`;

  return (
    <LinearGradient colors={[colors.sage, colors.sageDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
      <View style={styles.topRow}>
        <Text style={styles.label}>YOUR HOUR BANK</Text>
        <TouchableOpacity style={styles.historyBtn} onPress={onPress}>
          <Text style={styles.historyBtnText}>History →</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.balance} numberOfLines={1} adjustsFontSizeToFit>{balance}</Text>
      <Text style={styles.balanceCaption}>hours available</Text>

      <View style={styles.pendingRow}>
        <TouchableOpacity
          style={styles.pendingBox}
          onPress={onPressIncoming}
          disabled={!onPressIncoming}
          activeOpacity={0.7}
          accessibilityRole={onPressIncoming ? 'button' : undefined}
          accessibilityLabel={onPressIncoming ? `Hours on the way, ${incomingCaption}. Opens what you've offered to help with.` : undefined}
        >
          <View style={styles.pendingHeader}>
            <MaterialIcons name="call-received" size={15} color="#fff" />
            <Text style={styles.pendingAmount}>+{pendingIncoming}h</Text>
            {onPressIncoming && <MaterialIcons name="chevron-right" size={16} color="rgba(255,255,255,0.6)" style={styles.chevron} />}
          </View>
          <Text style={styles.pendingCaption}>{incomingCaption}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.pendingBox}
          onPress={onPressOutgoing}
          disabled={!onPressOutgoing}
          activeOpacity={0.7}
          accessibilityRole={onPressOutgoing ? 'button' : undefined}
          accessibilityLabel={onPressOutgoing ? `Hours if fulfilled, ${outgoingCaption}. Opens your own requests.` : undefined}
        >
          <View style={styles.pendingHeader}>
            <MaterialIcons name="call-made" size={15} color="#fff" />
            <Text style={styles.pendingAmount}>-{pendingOutgoing}h</Text>
            {onPressOutgoing && <MaterialIcons name="chevron-right" size={16} color="rgba(255,255,255,0.6)" style={styles.chevron} />}
          </View>
          <Text style={styles.pendingCaption}>{outgoingCaption}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.track}>
        <View style={[styles.trackFill, { width: `${fillPct}%` }]} />
      </View>
      <View style={styles.trackLabels}>
        <Text style={styles.trackLabel}>{FLOOR}h limit</Text>
        <Text style={styles.trackLabel}>{requestingPower}h of requesting power</Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, padding: 20, marginBottom: 20 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 1, color: 'rgba(255,255,255,0.85)' },
  historyBtn: { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  historyBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  balance: { fontSize: 48, fontWeight: '800', color: '#fff', letterSpacing: -1, lineHeight: 52 },
  balanceCaption: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.85)', marginBottom: 16 },
  pendingRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  pendingBox: { flex: 1, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 14, padding: 12, gap: 2 },
  pendingHeader: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  pendingAmount: { fontSize: 17, fontWeight: '700', color: '#fff' },
  chevron: { marginLeft: 'auto' },
  pendingCaption: { fontSize: 12, fontWeight: '500', color: 'rgba(255,255,255,0.75)' },
  track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  trackFill: { height: '100%', backgroundColor: '#fff', borderRadius: 3 },
  trackLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  trackLabel: { fontSize: 12, fontWeight: '500', color: 'rgba(255,255,255,0.75)' },
});
