export const colors = {
  // Brand palette
  primary: '#E07B65',       // Coral — CTAs, buttons, active states
  primaryLight: '#FDEEE9',
  primaryDark: '#C4614E',
  sage: '#7D9E8C',          // Sage — gradients, accents, progress
  sageLight: '#EBF2EE',
  sageDark: '#5A7A69',
  background: '#FAF7F2',    // Cream
  card: '#FFFFFF',
  border: '#DDD5C8',        // Warm taupe
  borderLight: '#EDE6DC',

  // Text
  text: '#2B3832',          // Dark forest
  textSecondary: '#637168',
  textMuted: '#9BAD9F',

  // Status — all derived from coral/sage, no unrelated hues. Token names
  // are kept (rather than renamed across every call site) but every value
  // below is now a coral or sage tint/shade, not a true blue/purple/amber.
  // Adjacent statuses alternate hue family (sage/coral/coral/sage) so
  // they stay visually distinct even with only two hues to draw from —
  // "Available" and "Accepted" being both sage-ish was the exact
  // confusion this was meant to fix.
  green: '#6B9E7A',         // sage — "open/available"
  greenLight: '#E8F4EC',
  red: '#C9574D',           // coral — danger/urgent/destructive only
  redLight: '#FCECEA',
  amber: '#C99A7C',         // muted coral-tan — "pending", was true orange
  amberLight: '#F5EAE1',
  blue: '#C4614E',          // coral (primaryDark) — "accepted", was true blue/navy
  blueLight: '#FDEEE9',
  purple: '#3E5647',        // deep sage — "completed", was true purple
  purpleLight: '#E3ECE7',
};

export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semiBold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extraBold: 'Inter_800ExtraBold',
};

// Six button roles, 48px minimum target. "Spend" and "earn" are both
// primary actions — which one applies depends on whether the tap moves
// hours out of or into the tapper's balance — everything else is a
// secondary/ghost/destructive/disabled variant shared across both.
export const buttonStyles = {
  spend: { container: { minHeight: 48, borderRadius: 12, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: colors.primary }, text: { color: '#fff', fontWeight: '700' as const, fontSize: 15 } },
  earn: { container: { minHeight: 48, borderRadius: 12, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: colors.sage }, text: { color: '#fff', fontWeight: '700' as const, fontSize: 15 } },
  secondary: { container: { minHeight: 48, borderRadius: 12, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card }, text: { color: colors.text, fontWeight: '700' as const, fontSize: 15 } },
  ghost: { container: { minHeight: 48, borderRadius: 12, alignItems: 'center' as const, justifyContent: 'center' as const }, text: { color: colors.textSecondary, fontWeight: '700' as const, fontSize: 15 } },
  destructive: { container: { minHeight: 48, borderRadius: 12, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 1.5, borderColor: colors.red + '60' }, text: { color: colors.red, fontWeight: '700' as const, fontSize: 15 } },
  disabled: { container: { minHeight: 48, borderRadius: 12, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: colors.borderLight }, text: { color: colors.textMuted, fontWeight: '700' as const, fontSize: 15 } },
};
