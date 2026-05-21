import { Text as RNText, TextProps, StyleSheet } from 'react-native';
import { colors } from '../lib/theme';

const weightToFont: Record<string, string> = {
  '400': 'Inter_400Regular',
  '500': 'Inter_500Medium',
  '600': 'Inter_600SemiBold',
  '700': 'Inter_700Bold',
  '800': 'Inter_800ExtraBold',
  'normal': 'Inter_400Regular',
  'bold': 'Inter_700Bold',
};

export function Text({ style, ...props }: TextProps) {
  const flat = StyleSheet.flatten(style) ?? {};
  const weight = String(flat.fontWeight ?? '400');
  const fontFamily = weightToFont[weight] ?? 'Inter_400Regular';
  return <RNText style={[{ fontFamily, color: colors.text }, style]} {...props} />;
}
