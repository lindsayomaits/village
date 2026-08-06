import { Tabs } from 'expo-router';
import { useAuth } from '../../lib/auth';
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
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          tabBarLabel: 'Chat',
          tabBarIcon: ({ focused }) => tabIcon(focused, 'chatbubbles-outline', 'chatbubbles'),
        }}
      />
      <Tabs.Screen
        name="members"
        options={{
          tabBarLabel: 'VillageMates',
          tabBarIcon: ({ focused }) => tabIcon(focused, 'people-outline', 'people'),
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
});
