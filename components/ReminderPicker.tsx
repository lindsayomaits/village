import { useState } from 'react';
import { Modal, View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from './Text';
import { colors } from '../lib/theme';
import { REMINDER_OPTIONS, type ReminderOffset } from '../lib/calendarReminders';

export function ReminderPicker({
  visible,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: (whens: ReminderOffset[]) => void;
}) {
  const [selected, setSelected] = useState<Set<ReminderOffset>>(new Set());

  function toggle(key: ReminderOffset) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function confirm() {
    onConfirm(Array.from(selected));
    setSelected(new Set());
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Set a reminder</Text>
          <Text style={styles.subtitle}>Pick one or more — you'll get a notification for each.</Text>

          {REMINDER_OPTIONS.map(opt => {
            const checked = selected.has(opt.key);
            return (
              <TouchableOpacity key={opt.key} style={styles.row} onPress={() => toggle(opt.key)}>
                <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                  {checked && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text style={styles.rowLabel}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmBtn, selected.size === 0 && styles.confirmBtnDisabled]}
              onPress={confirm}
              disabled={selected.size === 0}
            >
              <Text style={styles.confirmBtnText}>Set {selected.size > 0 ? `(${selected.size})` : ''}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', paddingHorizontal: 24 },
  sheet: { backgroundColor: colors.card, borderRadius: 20, padding: 22 },
  title: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 4 },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  checkboxChecked: { backgroundColor: colors.sage, borderColor: colors.sage },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: '800' },
  rowLabel: { fontSize: 15, color: colors.text, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  cancelBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', borderWidth: 1.5, borderColor: colors.border },
  cancelBtnText: { color: colors.textSecondary, fontWeight: '700' },
  confirmBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: colors.sage },
  confirmBtnDisabled: { backgroundColor: colors.sageLight },
  confirmBtnText: { color: '#fff', fontWeight: '700' },
});
