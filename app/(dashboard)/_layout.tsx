// app/(dashboard)/_layout.tsx
import { Tabs, useRouter, usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  PanResponder,
  Animated,
  Dimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { useStore } from '@/store/useStore';
import { getText } from '@/constants/translations';
import { restoreSession } from '@/services/authService';

const TAB_ROUTES = [
  { key: 'overview', path: '/(dashboard)/overview' },
  { key: 'workers', path: '/(dashboard)/workers' },
  { key: 'alerts', path: '/(dashboard)/alerts' },
  { key: 'zones', path: '/(dashboard)/zones' },
  { key: 'reports', path: '/(dashboard)/reports' },
  { key: 'samved', path: '/(dashboard)/samved' },
  { key: 'test', path: '/(dashboard)/test' },
] as const;

const { width } = Dimensions.get('window');
const TAB_WIDTH = width / TAB_ROUTES.length;

// Lower threshold = more responsive swipe
const SWIPE_THRESHOLD = 50;
const SWIPE_VELOCITY_THRESHOLD = 0.3;

function TabIcon({ name, focused, color }: any) {
  return (
    <View style={[styles.tabIcon, focused && styles.tabIconActive]}>
      <MaterialCommunityIcons name={name} size={22} color={color} />
    </View>
  );
}

export default function DashboardLayout() {
  const { manager, language, setManager } = useStore();
  const T = getText(language);
  const router = useRouter();
  const pathname = usePathname();

  const [checking, setChecking] = useState(true);

  const indicatorX = useRef(new Animated.Value(0)).current;

  const currentRoute = pathname.split('/').pop() || 'overview';
  const currentIdx = TAB_ROUTES.findIndex((route) => route.key === currentRoute);

  // ✅ KEY FIX: Keep a ref that always holds the latest index.
  // PanResponder is created once (useRef) so its closure never updates —
  // reading currentIdxRef.current inside it always gives the fresh value.
  const currentIdxRef = useRef(currentIdx);
  useEffect(() => {
    currentIdxRef.current = currentIdx;
  }, [currentIdx]);

  // Animate indicator on tab change
  useEffect(() => {
    if (currentIdx !== -1) {
      Animated.spring(indicatorX, {
        toValue: currentIdx * TAB_WIDTH,
        useNativeDriver: true,
        tension: 80,   // snappier spring
        friction: 10,
      }).start();
    }
  }, [currentIdx]);

  // Auth check
  useEffect(() => {
    if (manager) {
      setChecking(false);
      return;
    }
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

  const panResponder = useRef(
    PanResponder.create({
      // ✅ Only claim the gesture when it's clearly horizontal
      onMoveShouldSetPanResponder: (_, { dx, dy, vx }) => {
        const isHorizontal = Math.abs(dx) > Math.abs(dy) * 2;
        const hasMoved = Math.abs(dx) > 10;
        return isHorizontal && hasMoved;
      },

      onPanResponderTerminationRequest: () => false, // don't let others steal

      onPanResponderRelease: (_, { dx, vx }) => {
        // ✅ Read from ref — always the current tab index
        const idx = currentIdxRef.current;
        if (idx === -1) return;

        const swipedLeft = dx < -SWIPE_THRESHOLD || vx < -SWIPE_VELOCITY_THRESHOLD;
        const swipedRight = dx > SWIPE_THRESHOLD || vx > SWIPE_VELOCITY_THRESHOLD;

        if (swipedLeft && idx < TAB_ROUTES.length - 1) {
          router.replace(TAB_ROUTES[idx + 1].path);
        } else if (swipedRight && idx > 0) {
          router.replace(TAB_ROUTES[idx - 1].path);
        }
      },
    })
  ).current;

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
    <View style={styles.container}>
      <View style={{ flex: 1 }} {...panResponder.panHandlers}>
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
              tabBarIcon: ({ focused, color }) => (
                <TabIcon name="view-dashboard" focused={focused} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="workers"
            options={{
              title: T.dashboard.workers,
              tabBarIcon: ({ focused, color }) => (
                <TabIcon name="account-hard-hat" focused={focused} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="alerts"
            options={{
              title: T.dashboard.alerts,
              tabBarIcon: ({ focused, color }) => (
                <TabIcon name="alarm-light" focused={focused} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="zones"
            options={{
              title: T.dashboard.zones,
              tabBarIcon: ({ focused, color }) => (
                <TabIcon name="map-marker-radius" focused={focused} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="reports"
            options={{
              title: T.dashboard.reports,
              tabBarIcon: ({ focused, color }) => (
                <TabIcon name="chart-bar" focused={focused} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="samved"
            options={{
              title: T.dashboard.samved,
              tabBarIcon: ({ focused, color }) => (
                <TabIcon name="brain" focused={focused} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="test"
            options={{
              title: 'Simulation',
              tabBarIcon: ({ focused, color }) => (
                <TabIcon name="test-tube" focused={focused} color={color} />
              ),
            }}
          />
        </Tabs>
      </View>

      {/* Animated tab indicator */}
      <Animated.View
        style={[
          styles.indicator,
          {
            width: TAB_WIDTH,
            transform: [{ translateX: indicatorX }],
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
    gap: 12,
  },

  loadingText: {
    color: Colors.textSecondary,
    fontSize: 14,
  },

  tabBar: {
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    height: 64,
    paddingBottom: 8,
    paddingTop: 4,
  },

  tabLabel: {
    fontSize: 10,
  },

  tabIcon: {
    padding: 4,
    borderRadius: 8,
  },

  tabIconActive: {
    backgroundColor: 'rgba(255,107,0,0.12)',
  },

  indicator: {
    position: 'absolute',
    bottom: 0,
    height: 3,
    backgroundColor: '#ff6b00',
  },
});