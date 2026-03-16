// app/(dashboard)/_layout.tsx
import { Tabs, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { useStore } from '@/store/useStore';
import { getText } from '@/constants/translations';
import { restoreSession } from '@/services/authService';

function TabIcon({ name, focused, color }: { name: string; focused: boolean; color: string }) {
  return (
    <View style={[styles.tabIcon, focused && styles.tabIconActive]}>
      <MaterialCommunityIcons name={name as any} size={22} color={color} />
    </View>
  );
}

export default function DashboardLayout() {
  const { manager, language, setManager } = useStore();
  const T = getText(language);
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // If manager already in store (e.g. just logged in), skip restore
    if (manager) {
      setChecking(false);
      return;
    }

    // Try to restore session from Firebase Auth
    restoreSession().then((profile) => {
      if (profile) {
        setManager(profile);
        setChecking(false);
      } else {
        setChecking(false);
        router.replace('/(auth)/login');
      }
    });
  }, []);

  if (checking) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.accent} />
        <Text style={styles.loadingText}>Loading dashboard...</Text>
      </View>
    );
  }

  if (!manager) return null;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: '#8899AA',
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <Tabs.Screen
        name="overview"
        options={{
          title: T.dashboard.overview,
          tabBarIcon: ({ focused, color }) => <TabIcon name="view-dashboard" focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="workers"
        options={{
          title: T.dashboard.workers,
          tabBarIcon: ({ focused, color }) => <TabIcon name="account-hard-hat" focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: T.dashboard.alerts,
          tabBarIcon: ({ focused, color }) => <TabIcon name="alarm-light" focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="zones"
        options={{
          title: T.dashboard.zones,
          tabBarIcon: ({ focused, color }) => <TabIcon name="map-marker-radius" focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: T.dashboard.reports,
          tabBarIcon: ({ focused, color }) => <TabIcon name="chart-bar" focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="test"
        options={{
          title: 'Test',
          tabBarIcon: ({ focused, color }) => <TabIcon name="test-tube" focused={focused} color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background, gap: 12 },
  loadingText: { color: Colors.textSecondary, fontSize: 14 },
  tabBar: { backgroundColor: Colors.white, borderTopWidth: 1, borderTopColor: '#E2E8F0', height: 64, paddingBottom: 8, paddingTop: 4 },
  tabLabel: { fontSize: 10 },
  tabIcon: { padding: 4, borderRadius: 8 },
  tabIconActive: { backgroundColor: 'rgba(255,107,0,0.12)' },
});
