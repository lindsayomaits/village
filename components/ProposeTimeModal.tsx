import { useState, useEffect } from 'react';
import { View, Modal, TouchableOpacity, TextInput, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Text } from './Text';
import { colors, buttonStyles } from '../lib/theme';
import { combineDateAndTime, toLocalDateString, todayString } from '../lib/utils';

function toTimeDisplay(d: Date) {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function toDateDisplay(d: Date) {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// "I can't do that exact time — can you do this one?" Used for offering on
// a request at a different time, countering an offer, and rescheduling an
// accepted booking. The caller decides what submitting means.
export function ProposeTimeModal({
  visible, onClose, onSubmit, heading, subheading, initialDate, initialTime, windowHint,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (date: string, time: string, note: string) => Promise<void>;
  heading: string;
  subheading?: string;
  initialDate: string;
  initialTime: string;
  // For a flexible request, the window/time-of-day the requester gave.
  windowHint?: string | null;
}) {
  const [date, setDate] = useState(new Date());
  const [time, setTime] = useState(new Date());
  const [note, setNote] = useState('');
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const [busy, setBusy] = useState(false);

  // Reset every time it opens, starting from the request's own date/time
  // (or today, if that's already passed).
  useEffect(() => {
    if (!visible) return;
    const start = initialDate < todayString() ? todayString() : initialDate;
    setDate(new Date(start + 'T00:00:00'));
    setTime(combineDateAndTime(start, initialTime));
    setNote('');
    setBusy(false);
  }, [visible]);

  async function submit() {
    setBusy(true);
    try {
      await onSubmit(toLocalDateString(date), toTimeDisplay(time), note.trim());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <Text style={styles.heading}>{heading}</Text>
          {subheading ? <Text style={styles.sub}>{subheading}</Text> : null}
          {windowHint ? (
            <View style={styles.hintBox}>
              <Text style={styles.hintText}>🗓 Their window: {windowHint}</Text>
            </View>
          ) : null}

          <View style={styles.row}>
            <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowDate(true)}>
              <Text style={styles.pickerLabel}>Date</Text>
              <Text style={styles.pickerValue}>📅 {toDateDisplay(date)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowTime(true)}>
              <Text style={styles.pickerLabel}>Time</Text>
              <Text style={styles.pickerValue}>🕐 {toTimeDisplay(time)}</Text>
            </TouchableOpacity>
          </View>
          {showDate && <DateTimePicker value={date} mode="date" minimumDate={new Date()} onChange={(_, s) => { setShowDate(false); if (s) setDate(s); }} />}
          {showTime && <DateTimePicker value={time} mode="time" onChange={(_, s) => { setShowTime(false); if (s) setTime(s); }} />}

          <TextInput
            style={styles.note}
            value={note}
            onChangeText={setNote}
            placeholder="Add a note (optional) — e.g. I can't do mornings, but after 3 works"
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={280}
          />

          <TouchableOpacity style={[buttonStyles.earn.container, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={buttonStyles.earn.text}>Send — does this work?</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={buttonStyles.ghost.container} onPress={onClose} disabled={busy}>
            <Text style={buttonStyles.ghost.text}>Never mind</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, gap: 12 },
  heading: { fontSize: 19, fontWeight: '800', color: colors.text },
  sub: { fontSize: 14, color: colors.textSecondary, lineHeight: 20, marginTop: -4 },
  hintBox: { backgroundColor: colors.sageLight, borderRadius: 12, padding: 10 },
  hintText: { fontSize: 13, color: colors.sageDark, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 10 },
  pickerBtn: { flex: 1, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, padding: 12, gap: 2 },
  pickerLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  pickerValue: { fontSize: 15, fontWeight: '700', color: colors.text },
  note: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, padding: 12, minHeight: 64, fontSize: 14, color: colors.text, textAlignVertical: 'top' },
});
