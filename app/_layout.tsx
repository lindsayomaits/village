import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold } from '@expo-google-fonts/inter';
import * as SplashScreen from 'expo-splash-screen';
import type * as NotificationsType from 'expo-notifications';
import Constants from 'expo-constants';
import { AuthProvider, useAuth } from '../lib/auth';
import { ErrorBoundary } from '../components/ErrorBoundary';

SplashScreen.preventAutoHideAsync();

// Remote push (and the notification-tap APIs below) were removed from
// Expo Go in SDK 53 and merely importing 'expo-notifications' throws there
// — skip wiring them up, and require the module lazily, in Expo Go.
const inExpoGo = Constants.appOwnership === 'expo' || Constants.executionEnvironment === 'storeClient';

function useNotificationDeepLinks() {
  const router = useRouter();

  useEffect(() => {
    if (Platform.OS === 'web' || inExpoGo) return;

    const Notifications = require('expo-notifications') as typeof NotificationsType;

    function routeFromResponse(response: NotificationsType.NotificationResponse | null) {
      const path = response?.notification.request.content.data?.path;
      if (typeof path === 'string') router.push(path as never);
    }

    // Cold start: app was launched by tapping a notification.
    Notifications.getLastNotificationResponseAsync().then(routeFromResponse);

    // Warm/background: app was already running when the notification was tapped.
    const sub = Notifications.addNotificationResponseReceivedListener(routeFromResponse);
    return () => sub.remove();
  }, [router]);
}

function RootLayoutNav() {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  useNotificationDeepLinks();

  useEffect(() => {
    if (loading) return;
    const inAuth = segments[0] === '(auth)';
    const onResetPassword = (segments as string[])[1] === 'reset-password';
    if (!session && !inAuth) router.replace('/(auth)/login');
    else if (session && inAuth && !onResetPassword) router.replace('/(tabs)/');
  }, [session, loading, segments]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <ErrorBoundary>
      <AuthProvider>
        <RootLayoutNav />
      </AuthProvider>
    </ErrorBoundary>
  );
}
