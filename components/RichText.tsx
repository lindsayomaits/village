import { StyleSheet, StyleProp, TextStyle } from 'react-native';
import { Text } from './Text';
import { colors } from '../lib/theme';
import { buildSegments, type MentionEntry } from '../lib/richText';
import type { Request } from '../types';

// @mentions and #request-tags, shared between Village Chat and DMs so
// both render/parse the same way instead of two copies drifting apart.
export function RichText({
  body, mentionEntries, openRequests, myFamilyId, isOwn, onTagPress, textStyle,
}: {
  body: string; mentionEntries: MentionEntry[]; openRequests: Request[];
  myFamilyId: string; isOwn: boolean;
  onTagPress: (request: Request) => void;
  textStyle?: StyleProp<TextStyle>;
}) {
  if (mentionEntries.length === 0 && openRequests.length === 0) {
    return <Text style={textStyle}>{body}</Text>;
  }
  const segments = buildSegments(body, mentionEntries, openRequests);
  return (
    <Text style={textStyle}>
      {segments.map((seg, i) => {
        if (seg.type === 'text') return <Text key={i}>{seg.text}</Text>;
        if (seg.type === 'mention') {
          const isMe = seg.entry.familyId === myFamilyId;
          return (
            <Text key={i} style={[styles.mention, isOwn ? styles.mentionOwn : styles.mentionOther, isMe && (isOwn ? styles.mentionMeOwn : styles.mentionMe)]}>
              {seg.label}
            </Text>
          );
        }
        return (
          <Text key={i} style={[styles.tag, isOwn ? styles.tagOwn : styles.tagOther]} onPress={() => onTagPress(seg.request)}>
            {seg.label}
          </Text>
        );
      })}
    </Text>
  );
}

const styles = StyleSheet.create({
  mention: { fontWeight: '700' },
  mentionOther: { color: colors.sageDark },
  mentionOwn: { color: 'rgba(255,255,255,0.95)' },
  mentionMe: { color: colors.primary },
  mentionMeOwn: { color: '#fff', textDecorationLine: 'underline' },
  tag: { fontWeight: '700', textDecorationLine: 'underline' },
  tagOther: { color: colors.primary },
  tagOwn: { color: '#fff' },
});
