// components/StatCard.tsx
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows } from '@/constants/theme';

interface Props {
  icon: string;
  label: string;
  value: string;
  color: string;
  urgent?: boolean;
}

export default function StatCard({ icon, label, value, color, urgent }: Props) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (urgent) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.06, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [urgent]);

  return (
    <Animated.View style={[styles.card, { borderTopColor: color, transform: [{ scale: pulseAnim }] }]}>
      <View style={[styles.iconBg, { backgroundColor: color + '18' }]}>
        <MaterialCommunityIcons name={icon as any} size={22} color={color} />
      </View>
      <Text style={[styles.value, { color }]}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: Colors.white,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderTopWidth: 3,
    gap: 4,
    ...Shadows.sm,
  },
  iconBg: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  value: {
    fontSize: 24,
    fontFamily: 'Poppins_700Bold',
  },
  label: {
    fontSize: 11,
    fontFamily: 'Poppins_400Regular',
    color: Colors.textSecondary,
  },
});
