import { Image, Text, View, StyleSheet } from 'react-native';
import { getFamilyAnimal } from '../lib/animals';
import { colors } from '../lib/theme';

export function Avatar({
  familyId, animal, photoUrl, size = 40, style,
}: {
  familyId: string; animal?: string | null; photoUrl?: string | null; size?: number;
  // Loose on purpose: this gets passed to either an Image or a View
  // depending on whether a photo is set, and their style types don't
  // unify cleanly.
  style?: Record<string, unknown>;
}) {
  const dimension = { width: size, height: size, borderRadius: size / 2 };
  if (photoUrl) {
    return <Image source={{ uri: photoUrl }} style={[styles.image, dimension, style]} />;
  }
  return (
    <View style={[styles.fallback, dimension, style]}>
      <Text style={{ fontSize: size * 0.55 }}>{getFamilyAnimal(familyId, animal)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: colors.card },
  fallback: { backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
});
