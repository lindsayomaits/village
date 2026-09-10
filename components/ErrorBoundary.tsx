import { Component, type ReactNode } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from './Text';
import { colors } from '../lib/theme';

type Props = { children: ReactNode };
type State = { error: Error | null };

// App-wide catch for render/lifecycle throws. Without this, any uncaught
// error in a screen unmounts the whole tree to a blank white screen with
// no way back. This shows a recoverable message instead.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error('Uncaught render error', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.container}>
        <Text style={styles.icon}>😕</Text>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>
          The screen hit an unexpected error. Tap below to try again — if it
          keeps happening, restart the app.
        </Text>
        <TouchableOpacity style={styles.btn} onPress={() => this.setState({ error: null })}>
          <Text style={styles.btnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  icon: { fontSize: 48 },
  title: { fontSize: 20, fontWeight: '800', color: colors.text },
  body: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  btn: { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 28, marginTop: 8 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
