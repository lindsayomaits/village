import { useState } from 'react';
import { View, Modal, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { colors } from '../lib/theme';

const ANIMAL_PREVIEW = ['🦊', '🦉', '🐻', '🐢'];

const SLIDES = ['welcome', 'hours', 'village'] as const;

export function OnboardingIntro({ visible, onDone }: { visible: boolean; onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const slide = SLIDES[index];
  const isLast = index === SLIDES.length - 1;

  function next() {
    if (isLast) onDone();
    else setIndex(index + 1);
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <View style={styles.container}>
        <LinearGradient colors={[colors.sage, colors.sageDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <TouchableOpacity style={styles.skip} onPress={onDone} hitSlop={12}>
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>

          {slide === 'welcome' && (
            <View style={styles.heroContent}>
              <View style={styles.logoCircle}>
                <Image source={require('../assets/icon.png')} style={styles.logoImage} />
              </View>
              <Text style={styles.heroTitle}>Welcome to{'\n'}VillageMates! 👋</Text>
            </View>
          )}

          {slide === 'hours' && (
            <View style={styles.heroContent}>
              <Text style={styles.heroEyebrow}>YOUR STARTING BALANCE</Text>
              <View style={styles.balanceRow}>
                <Text style={styles.balanceNumber}>10</Text>
                <Text style={styles.balanceUnit}>hours</Text>
              </View>
            </View>
          )}

          {slide === 'village' && (
            <View style={styles.heroContent}>
              <View style={styles.avatarRow}>
                {ANIMAL_PREVIEW.map((a, i) => (
                  <View key={i} style={[styles.avatarBubble, i > 0 && { marginLeft: -14 }]}>
                    <Text style={styles.avatarEmoji}>{a}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.heroTitle}>Find your people</Text>
            </View>
          )}
        </LinearGradient>

        <View style={styles.content}>
          {slide === 'welcome' && (
            <>
              <Text style={styles.body}>
                A small circle of neighbors who help each other — no app fees, no money changing hands. Just hours, traded for real help.
              </Text>
              <View style={styles.bullets}>
                <View style={styles.bullet}>
                  <View style={[styles.bulletIcon, { backgroundColor: colors.sageLight }]}>
                    <Text style={styles.bulletEmoji}>🤝</Text>
                  </View>
                  <Text style={styles.bulletText}>A school pickup, a dog walk, a fence fixed — help of every kind counts</Text>
                </View>
                <View style={styles.bullet}>
                  <View style={[styles.bulletIcon, { backgroundColor: colors.primaryLight }]}>
                    <Ionicons name="lock-closed" size={16} color={colors.primaryDark} />
                  </View>
                  <Text style={styles.bulletText}>Private by design — you only ever see people you've connected with</Text>
                </View>
              </View>
            </>
          )}

          {slide === 'hours' && (
            <View style={styles.rules}>
              <View style={styles.rule}>
                <View style={[styles.ruleIcon, { backgroundColor: colors.greenLight }]}>
                  <MaterialIcons name="call-received" size={18} color={colors.sageDark} />
                </View>
                <View style={styles.ruleText}>
                  <Text style={styles.ruleTitle}>Help someone, hours come in</Text>
                  <Text style={styles.ruleBody}>An hour of your time is an hour in your bank.</Text>
                </View>
              </View>
              <View style={styles.rule}>
                <View style={[styles.ruleIcon, { backgroundColor: colors.primaryLight }]}>
                  <MaterialIcons name="call-made" size={18} color={colors.primaryDark} />
                </View>
                <View style={styles.ruleText}>
                  <Text style={styles.ruleTitle}>Ask for help, hours go out</Text>
                  <Text style={styles.ruleBody}>Nothing moves until the day it actually happens.</Text>
                </View>
              </View>
              <View style={styles.rule}>
                <View style={[styles.ruleIcon, { backgroundColor: colors.amberLight }]}>
                  <Ionicons name="trending-down-outline" size={18} color={colors.amber} />
                </View>
                <View style={styles.ruleText}>
                  <Text style={styles.ruleTitle}>You can go to -20h</Text>
                  <Text style={styles.ruleBody}>Being in the hole with neighbors is normal. Below -10h, help someone before posting again.</Text>
                </View>
              </View>
            </View>
          )}

          {slide === 'village' && (
            <>
              <Text style={styles.body}>
                Your board is empty until you connect with someone — one person is all it takes to bring the whole app to life.
              </Text>
              <View style={styles.bullets}>
                <View style={styles.bullet}>
                  <View style={[styles.bulletIcon, { backgroundColor: colors.sageLight }]}>
                    <Ionicons name="qr-code" size={16} color={colors.sageDark} />
                  </View>
                  <Text style={styles.bulletText}>Share your connect code, or search for people you already know</Text>
                </View>
                <View style={styles.bullet}>
                  <View style={[styles.bulletIcon, { backgroundColor: colors.primaryLight }]}>
                    <Ionicons name="chatbubbles" size={16} color={colors.primaryDark} />
                  </View>
                  <Text style={styles.bulletText}>Once connected, message them and see what they're open to helping with</Text>
                </View>
              </View>
            </>
          )}
        </View>

        <View style={styles.bottom}>
          <View style={styles.dots}>
            {SLIDES.map((s, i) => (
              <View key={s} style={[styles.dot, i === index && styles.dotActive]} />
            ))}
          </View>
          <TouchableOpacity style={styles.nextBtn} onPress={next}>
            <Text style={styles.nextBtnText}>{isLast ? "Let's go" : 'Next'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  hero: { height: '38%', paddingHorizontal: 28, paddingTop: 14 },
  skip: { alignSelf: 'flex-end' },
  skipText: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.85)', padding: 8 },
  heroContent: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  logoCircle: { width: 76, height: 76, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  logoImage: { width: 76, height: 76, borderRadius: 20 },
  heroTitle: { fontSize: 26, fontWeight: '800', color: '#fff', textAlign: 'center', lineHeight: 32, letterSpacing: -0.5 },
  heroEyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 1.2, color: 'rgba(255,255,255,0.8)' },
  balanceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  balanceNumber: { fontSize: 64, fontWeight: '800', color: '#fff', letterSpacing: -2, lineHeight: 66 },
  balanceUnit: { fontSize: 20, fontWeight: '700', color: 'rgba(255,255,255,0.9)', marginBottom: 8 },
  avatarRow: { flexDirection: 'row' },
  avatarBubble: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.sage },
  avatarEmoji: { fontSize: 26 },

  content: { flex: 1, paddingHorizontal: 28, paddingTop: 24, gap: 18 },
  body: { fontSize: 16, lineHeight: 23, color: colors.textSecondary },
  bullets: { gap: 14 },
  bullet: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  bulletIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  bulletEmoji: { fontSize: 15 },
  bulletText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.text, fontWeight: '500', paddingTop: 5 },

  rules: { gap: 16 },
  rule: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  ruleIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  ruleText: { flex: 1, gap: 2 },
  ruleTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  ruleBody: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },

  bottom: { paddingHorizontal: 28, paddingVertical: 20, gap: 16 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.borderLight },
  dotActive: { backgroundColor: colors.primary, width: 18 },
  nextBtn: { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  nextBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
