import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Text } from './Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors } from '../lib/theme';

export type LegalSection = {
  heading?: string;
  paragraphs?: string[];
  bullets?: string[];
};

export function LegalScreen({
  title, updated, intro, sections,
}: {
  title: string;
  updated: string;
  intro: string[];
  sections: LegalSection[];
}) {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        <View style={{ width: 52 }} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.docTitle}>{title}</Text>
        <Text style={styles.updated}>{updated}</Text>
        {intro.map((p, i) => <Text key={i} style={styles.para}>{p}</Text>)}
        {sections.map((s, i) => (
          <View key={i} style={styles.section}>
            {s.heading ? <Text style={styles.heading}>{s.heading}</Text> : null}
            {(s.paragraphs ?? []).map((p, j) => <Text key={j} style={styles.para}>{p}</Text>)}
            {(s.bullets ?? []).map((b, j) => (
              <View key={j} style={styles.bulletRow}>
                <Text style={styles.bulletDot}>•</Text>
                <Text style={styles.bulletText}>{b}</Text>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  backBtn: { paddingVertical: 4, width: 52 },
  backText: { fontSize: 16, color: colors.primary, fontWeight: '600' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: colors.text, flex: 1, textAlign: 'center' },
  scroll: { paddingHorizontal: 22, paddingVertical: 20, paddingBottom: 48 },
  docTitle: { fontSize: 24, fontWeight: '800', color: colors.text, marginBottom: 4 },
  updated: { fontSize: 12, color: colors.textMuted, fontWeight: '600', marginBottom: 18 },
  section: { marginTop: 20 },
  heading: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: 8 },
  para: { fontSize: 14, color: colors.textSecondary, lineHeight: 21, marginBottom: 10 },
  bulletRow: { flexDirection: 'row', gap: 8, marginBottom: 5 },
  bulletDot: { fontSize: 14, color: colors.textMuted, lineHeight: 21 },
  bulletText: { flex: 1, fontSize: 14, color: colors.textSecondary, lineHeight: 21 },
});
