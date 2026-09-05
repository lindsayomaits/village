import { useState, useEffect, useCallback } from 'react';
import { Tabs } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../lib/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function tabIcon(focused: boolean, name: IconName, focusedName: IconName) {
  return (
    <Ionicons
      name={focused ? focusedName : name}
      size={24}
      color={focused ? colors.sage : colors.textMuted}
    />
  );
}

export default function TabLayout() {
  const { family } = useAuth();
  const [pendingConnections, setPendingConnections] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState(0);

  const loadBadgeCounts = useCallback(async () => {
    if (!family) { setPendingConnections(0); setPendingApprovals(0); return; }
    const [{ count: connCount }, { count: reqCount }] = await Promise.all([
      supabase.from('connections').select('id', { count: 'exact', head: true })
        .eq('status', 'pending').eq('recipient_id', family.id),
      supabase.from('requests').select('id', { count: 'exact', head: true })
        .eq('status', 'offered').eq('requesting_family_id', family.id),
    ]);
    setPendingConnections(connCount ?? 0);
    setPendingApprovals(reqCount ?? 0);
  }, [family?.id]);

  useEffect(() => {
    loadBadgeCounts();
    if (!family) return;
    const channel = supabase
      .channel('tab_badges_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'connections' }, loadBadgeCounts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, loadBadgeCounts)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [family?.id, loadBadgeCounts]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarShowLabel: true,
        tabBarActiveTintColor: colors.sage,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarLabel: 'Home',
          tabBarIcon: ({ focused }) => tabIcon(focused, 'home-outline', 'home'),
        }}
      />
      <Tabs.Screen
        name="requests"
        options={{
          tabBarLabel: 'Requests',
          tabBarIcon: ({ focused }) => tabIcon(focused, 'calendar-outline', 'calendar'),
          tabBarBadge: pendingApprovals > 0 ? pendingApprovals : undefined,
          tabBarBadgeStyle: styles.badge,
        }}
      />
      <Tabs.Screen
        name="members"
        options={{
          tabBarLabel: 'Village',
          tabBarIcon: ({ focused }) => tabIcon(focused, 'people-outline', 'people'),
          tabBarBadge: pendingConnections > 0 ? pendingConnections : undefined,
          tabBarBadgeStyle: styles.badge,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarLabel: 'Profile',
          tabBarIcon: ({ focused }) => tabIcon(focused, 'person-circle-outline', 'person-circle'),
        }}
      />
      {family?.is_admin && (
        <Tabs.Screen
          name="admin"
          options={{
            tabBarLabel: 'Admin',
            tabBarIcon: ({ focused }) => tabIcon(focused, 'shield-outline', 'shield'),
          }}
        />
      )}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.card,
    borderTopColor: colors.border,
    height: 68,
    paddingBottom: 8,
    paddingTop: 4,
  },
  tabLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
  },
  badge: {
    backgroundColor: colors.red,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
});
