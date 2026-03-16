// app/index.tsx
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Animated,
  Dimensions, StyleSheet, Image
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows } from '@/constants/theme';
import { useStore } from '@/store/useStore';
import { getText } from '@/constants/translations';

const { width } = Dimensions.get('window');

const TICKER_TEXT = '🔶 सुरक्षा प्रथम • Safety First  🔷 Daily PPE check mandatory  🔶 Report hazards immediately  🔷 Regular health checkups  🔶 सुरक्षित काम, सुरक्षित जीवन  ';

const FEATURES = [
  { icon: 'wifi', titleKey: 'realtime', descKey: 'realtimeDesc', color: '#3498DB' },
  { icon: 'gas-cylinder', titleKey: 'gas', descKey: 'gasDesc', color: '#E74C3C' },
  { icon: 'alarm-light', titleKey: 'sos', descKey: 'sosDesc', color: '#FF6B00' },
  { icon: 'heart-pulse', titleKey: 'health', descKey: 'healthDesc', color: '#2ECC71' },
];

export default function HomeScreen() {
  const { language, setLanguage, manager } = useStore();
  const T = getText(language);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;
  const tickerAnim = useRef(new Animated.Value(width)).current;
  const [tickerRunning, setTickerRunning] = useState(false);

  useEffect(() => {
    if (manager) {
      router.replace('/(dashboard)/overview');
      return;
    }

    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 700, useNativeDriver: true }),
    ]).start();

    startTicker();
  }, []);

  const startTicker = () => {
    tickerAnim.setValue(width);
    Animated.loop(
      Animated.timing(tickerAnim, {
        toValue: -(width * 3),
        duration: 18000,
        useNativeDriver: true,
      })
    ).start();
    setTickerRunning(true);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Government Bar */}
      <View style={styles.govBar}>
        <Text style={styles.govBarText}>🇮🇳  Government of Maharashtra  |  महाराष्ट्र शासन</Text>
      </View>

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.logoContainer}>
            <View style={styles.logoCircle}>
              <MaterialCommunityIcons name="shield-check" size={28} color={Colors.accent} />
            </View>
            <View>
              <Text style={styles.headerTitle}>SurakshaNet</Text>
              <Text style={styles.headerSubtitle}>{T.municipality}</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.langToggle}
            onPress={() => setLanguage(language === 'en' ? 'mr' : 'en')}
          >
            <Text style={styles.langText}>{language === 'en' ? 'मराठी' : 'EN'}</Text>
          </TouchableOpacity>
        </View>

        {/* Nav Strip */}
        <View style={styles.navStrip}>
          {['Home', 'About SMC', 'Services', 'Contact'].map((item) => (
            <Text key={item} style={styles.navItem}>{item}</Text>
          ))}
        </View>
      </View>

      {/* Ticker */}
      <View style={styles.ticker}>
        <View style={styles.tickerBadge}>
          <Text style={styles.tickerBadgeText}>LIVE</Text>
        </View>
        <View style={styles.tickerTrack}>
          <Animated.Text style={[styles.tickerText, { transform: [{ translateX: tickerAnim }] }]}>
            {TICKER_TEXT}
          </Animated.Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
        {/* Hero Section */}
        <Animated.View style={[styles.hero, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.heroOverlay}>
            <View style={styles.heroBadge}>
              <MaterialCommunityIcons name="hard-hat" size={16} color={Colors.accent} />
              <Text style={styles.heroBadgeText}>Solapur Municipal Corporation</Text>
            </View>
            <Text style={styles.heroTitle}>{T.home.welcome}</Text>
            <Text style={styles.heroSubtitle}>{T.home.subtitle}</Text>
            <TouchableOpacity style={styles.heroBtn} onPress={() => router.push('/(auth)/login')}>
              <MaterialCommunityIcons name="login" size={18} color={Colors.white} />
              <Text style={styles.heroBtnText}>{T.home.loginBtn}</Text>
              <MaterialCommunityIcons name="arrow-right" size={16} color={Colors.white} />
            </TouchableOpacity>
          </View>

          {/* Decorative Worker Icons */}
          <View style={styles.heroIcons}>
            {['broom', 'dump-truck', 'recycle', 'water'].map((icon, i) => (
              <View key={icon} style={[styles.heroIconBubble, { opacity: 0.15 + i * 0.08 }]}>
                <MaterialCommunityIcons name={icon as any} size={24} color={Colors.white} />
              </View>
            ))}
          </View>
        </Animated.View>

        {/* Stats Strip */}
        <View style={styles.statsStrip}>
          {[
            { label: T.home.stats.workers, value: '247', icon: 'account-hard-hat', color: Colors.primary },
            { label: T.home.stats.alerts, value: '3', icon: 'alarm-light', color: Colors.danger },
            { label: T.home.stats.zones, value: '5', icon: 'map-marker-radius', color: Colors.accent },
            { label: T.home.stats.safe, value: '244', icon: 'shield-check', color: Colors.success },
          ].map((stat) => (
            <View key={stat.label} style={styles.statCard}>
              <MaterialCommunityIcons name={stat.icon as any} size={22} color={stat.color} />
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {/* Features Grid */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionDivider} />
            <Text style={styles.sectionTitle}>Our Safety Features</Text>
            <View style={styles.sectionDivider} />
          </View>
          <View style={styles.featuresGrid}>
            {FEATURES.map((feat) => (
              <View key={feat.titleKey} style={styles.featureCard}>
                <View style={[styles.featureIconBg, { backgroundColor: feat.color + '18' }]}>
                  <MaterialCommunityIcons name={feat.icon as any} size={28} color={feat.color} />
                </View>
                <Text style={styles.featureTitle}>{T.home.features[feat.titleKey as keyof typeof T.home.features]}</Text>
                <Text style={styles.featureDesc}>{T.home.features[feat.descKey as keyof typeof T.home.features]}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* About Section */}
        <View style={[styles.section, styles.aboutSection]}>
          <MaterialCommunityIcons name="information" size={20} color={Colors.primaryLight} />
          <Text style={styles.aboutTitle}>About This System</Text>
          <Text style={styles.aboutText}>
            SurakshaNet is an IoT-powered safety monitoring system deployed by the Solapur Municipal Corporation to ensure the well-being of all sanitation workers across 5 zones of Solapur city. Real-time sensor data including gas levels, body temperature, and GPS location is monitored 24/7.
          </Text>
        </View>

        {/* Login CTA */}
        <View style={styles.ctaSection}>
          <Text style={styles.ctaText}>Authorized Manager Access</Text>
          <TouchableOpacity style={styles.ctaBtn} onPress={() => router.push('/(auth)/login')}>
            <MaterialCommunityIcons name="account-lock" size={20} color={Colors.white} />
            <Text style={styles.ctaBtnText}>{T.home.loginBtn}</Text>
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerTitle}>Solapur Municipal Corporation</Text>
          <Text style={styles.footerText}>247, Saat Rasta, Solapur - 413 003, Maharashtra</Text>
          <Text style={styles.footerText}>📞 0217-2723500  |  📧 commissioner@solapurmahanagar.gov.in</Text>
          <View style={styles.footerDivider} />
          <Text style={styles.footerSmall}>© 2025 SMC. All rights reserved. | SurakshaNet v1.0</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  govBar: { backgroundColor: '#0A1F3D', paddingVertical: 5, paddingHorizontal: Spacing.md },
  govBarText: { color: '#B8C8D8', fontSize: 11, textAlign: 'center', fontFamily: 'Poppins_400Regular' },
  header: { backgroundColor: Colors.primary },
  headerContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  logoContainer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  logoCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,107,0,0.2)', justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: Colors.accent },
  headerTitle: { color: Colors.white, fontSize: 18, fontFamily: 'Poppins_700Bold' },
  headerSubtitle: { color: '#B8C8D8', fontSize: 11, fontFamily: 'Poppins_400Regular' },
  langToggle: { backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: BorderRadius.full, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  langText: { color: Colors.white, fontSize: 12, fontFamily: 'Poppins_600SemiBold' },
  navStrip: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.15)', paddingHorizontal: Spacing.md },
  navItem: { color: '#B8C8D8', fontSize: 12, fontFamily: 'Poppins_400Regular', paddingVertical: 8, marginRight: Spacing.md },
  ticker: { backgroundColor: '#0A1F3D', flexDirection: 'row', alignItems: 'center', height: 32, overflow: 'hidden' },
  tickerBadge: { backgroundColor: Colors.danger, paddingHorizontal: 8, paddingVertical: 4, marginLeft: Spacing.sm },
  tickerBadgeText: { color: Colors.white, fontSize: 10, fontFamily: 'Poppins_700Bold' },
  tickerTrack: { flex: 1, overflow: 'hidden' },
  tickerText: { color: '#FFD580', fontSize: 12, fontFamily: 'Poppins_400Regular', paddingLeft: 8, width: width * 4 },
  hero: { backgroundColor: Colors.primary, paddingHorizontal: Spacing.md, paddingTop: Spacing.xl, paddingBottom: Spacing.xxl, overflow: 'hidden' },
  heroOverlay: { zIndex: 1 },
  heroBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,107,0,0.2)', borderWidth: 1, borderColor: Colors.accent, borderRadius: BorderRadius.full, paddingHorizontal: 12, paddingVertical: 4, alignSelf: 'flex-start', marginBottom: Spacing.md },
  heroBadgeText: { color: Colors.accent, fontSize: 11, fontFamily: 'Poppins_500Medium' },
  heroTitle: { color: Colors.white, fontSize: 26, fontFamily: 'Poppins_700Bold', lineHeight: 34, marginBottom: Spacing.sm },
  heroSubtitle: { color: '#B8C8D8', fontSize: 14, fontFamily: 'Poppins_400Regular', lineHeight: 22, marginBottom: Spacing.lg },
  heroBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.accent, paddingVertical: 12, paddingHorizontal: Spacing.lg, borderRadius: BorderRadius.md, alignSelf: 'flex-start', ...Shadows.md },
  heroBtnText: { color: Colors.white, fontSize: 15, fontFamily: 'Poppins_600SemiBold' },
  heroIcons: { position: 'absolute', right: -10, top: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 8, width: 120 },
  heroIconBubble: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' },
  statsStrip: { flexDirection: 'row', backgroundColor: Colors.white, marginHorizontal: Spacing.md, marginTop: -20, borderRadius: BorderRadius.lg, ...Shadows.md, overflow: 'hidden' },
  statCard: { flex: 1, alignItems: 'center', paddingVertical: Spacing.md, gap: 4, borderRightWidth: 1, borderRightColor: Colors.border },
  statValue: { fontSize: 20, fontFamily: 'Poppins_700Bold', color: Colors.textPrimary },
  statLabel: { fontSize: 9, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary, textAlign: 'center' },
  section: { padding: Spacing.md, marginTop: Spacing.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: Spacing.md },
  sectionDivider: { flex: 1, height: 1, backgroundColor: Colors.border },
  sectionTitle: { fontSize: 13, fontFamily: 'Poppins_600SemiBold', color: Colors.textSecondary },
  featuresGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  featureCard: { width: (width - Spacing.md * 2 - Spacing.sm) / 2, backgroundColor: Colors.white, borderRadius: BorderRadius.md, padding: Spacing.md, ...Shadows.sm },
  featureIconBg: { width: 52, height: 52, borderRadius: BorderRadius.md, justifyContent: 'center', alignItems: 'center', marginBottom: Spacing.sm },
  featureTitle: { fontSize: 13, fontFamily: 'Poppins_600SemiBold', color: Colors.textPrimary, marginBottom: 4 },
  featureDesc: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary, lineHeight: 16 },
  aboutSection: { backgroundColor: Colors.infoBg, marginHorizontal: Spacing.md, borderRadius: BorderRadius.md, borderLeftWidth: 4, borderLeftColor: Colors.primary },
  aboutTitle: { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: Colors.primary, marginBottom: 6 },
  aboutText: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: Colors.textSecondary, lineHeight: 20 },
  ctaSection: { margin: Spacing.md, backgroundColor: Colors.primary, borderRadius: BorderRadius.lg, padding: Spacing.lg, alignItems: 'center', gap: Spacing.md, ...Shadows.lg },
  ctaText: { color: '#B8C8D8', fontSize: 13, fontFamily: 'Poppins_400Regular' },
  ctaBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.accent, paddingVertical: 12, paddingHorizontal: Spacing.xl, borderRadius: BorderRadius.md },
  ctaBtnText: { color: Colors.white, fontSize: 15, fontFamily: 'Poppins_600SemiBold' },
  footer: { backgroundColor: '#0A1F3D', padding: Spacing.lg, marginTop: Spacing.md, alignItems: 'center', gap: 6 },
  footerTitle: { color: Colors.white, fontSize: 14, fontFamily: 'Poppins_600SemiBold' },
  footerText: { color: '#8899AA', fontSize: 12, fontFamily: 'Poppins_400Regular', textAlign: 'center' },
  footerDivider: { height: 1, width: '80%', backgroundColor: 'rgba(255,255,255,0.1)', marginVertical: 4 },
  footerSmall: { color: '#556677', fontSize: 11, fontFamily: 'Poppins_400Regular' },
});
