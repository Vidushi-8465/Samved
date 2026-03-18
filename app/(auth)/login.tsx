// app/(auth)/login.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Animated, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, Shadows } from '@/constants/theme';
import { useStore } from '@/store/useStore';
import { getText } from '@/constants/translations';
import { loginManager, biometricLogin, checkBiometricAvailable } from '@/services/authService';

export default function LoginScreen() {
  const { language, setLanguage, setManager } = useStore();
  const T = getText(language);

  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
    checkBiometricAvailable().then(setBiometricAvailable);
  }, []);

  const shakeError = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  };

  // ── LOGIN ──────────────────────────────────────────────────
  const handleLogin = async () => {
    if (!employeeId || !password) {
      setError(T.login.error.empty);
      shakeError();
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Use email directly as typed — supports full email or plain ID
      const email = employeeId.includes('@')
        ? employeeId.trim()
        : `${employeeId.trim()}@gmail.com`;

      const profile = await loginManager(email, password);
      setManager(profile);
      router.replace('/(dashboard)/overview');
    } catch (err: any) {
      console.log(err);
      const msg = err.message || '';
      if (msg.includes('Access denied')) {
        setError(T.login.error.access);
      } else if (msg.includes('network') || msg.includes('Network')) {
        setError(T.login.error.network);
      } else {
        setError(T.login.error.invalid);
      }
      shakeError();
    } finally {
      setLoading(false);
    }
  };

  // ── BIOMETRIC ──────────────────────────────────────────────
  const handleBiometric = async () => {
    setLoading(true);
    setError('');
    try {
      const profile = await biometricLogin();
      if (profile) {
        setManager(profile);
        router.replace('/(dashboard)/overview');
      } else {
        setError('Biometric authentication failed');
      }
    } catch (err) {
      setError('Biometric authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={Colors.white} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.langToggle}
          onPress={() => setLanguage(language === 'en' ? 'mr' : 'en')}
        >
          <Text style={styles.langText}>{language === 'en' ? 'मराठी' : 'EN'}</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>

          {/* Branding */}
          <Animated.View
            style={[styles.brandSection, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
          >
            <View style={styles.logoOuter}>
              <View style={styles.logoInner}>
                <MaterialCommunityIcons name="shield-account" size={40} color={Colors.accent} />
              </View>
            </View>
            <Text style={styles.appName}>SMC LiveMonitor</Text>
            <Text style={styles.subName}>{T.login.subtitle}</Text>
            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <MaterialCommunityIcons name="star-four-points" size={10} color={Colors.accent} />
              <View style={styles.dividerLine} />
            </View>
          </Animated.View>

          {/* Form Card */}
          <Animated.View
            style={[styles.card, { opacity: fadeAnim, transform: [{ translateX: shakeAnim }] }]}
          >
            <Text style={styles.cardTitle}>{T.login.title}</Text>

            {/* Email / Employee ID */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Email</Text>
              <View style={styles.inputWrapper}>
                <MaterialCommunityIcons
                  name="email-outline"
                  size={20}
                  color={Colors.textSecondary}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Enter Your Email Address"
                  placeholderTextColor={Colors.textMuted}
                  value={employeeId}
                  onChangeText={setEmployeeId}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                />
              </View>
            </View>

            {/* Password */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{T.login.password}</Text>
              <View style={styles.inputWrapper}>
                <MaterialCommunityIcons
                  name="lock"
                  size={20}
                  color={Colors.textSecondary}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="••••••••"
                  placeholderTextColor={Colors.textMuted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeBtn}
                >
                  <MaterialCommunityIcons
                    name={showPassword ? 'eye-off' : 'eye'}
                    size={20}
                    color={Colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Error message */}
            {error ? (
              <View style={styles.errorBox}>
                <MaterialCommunityIcons name="alert-circle" size={16} color={Colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {/* Forgot Password */}
            <TouchableOpacity style={styles.forgotBtn}>
              <Text style={styles.forgotText}>{T.login.forgotPassword}</Text>
            </TouchableOpacity>

            {/* Login Button */}
            <TouchableOpacity
              style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={Colors.white} size="small" />
              ) : (
                <>
                  <MaterialCommunityIcons name="login" size={18} color={Colors.white} />
                  <Text style={styles.loginBtnText}>{T.login.loginBtn}</Text>
                </>
              )}
            </TouchableOpacity>

            {/* Biometric (mobile only) */}
            {biometricAvailable && (
              <>
                <View style={styles.orRow}>
                  <View style={styles.orLine} />
                  <Text style={styles.orText}>OR</Text>
                  <View style={styles.orLine} />
                </View>
                <TouchableOpacity
                  style={styles.biometricBtn}
                  onPress={handleBiometric}
                  disabled={loading}
                >
                  <MaterialCommunityIcons name="fingerprint" size={22} color={Colors.primary} />
                  <Text style={styles.biometricBtnText}>{T.login.biometricBtn}</Text>
                </TouchableOpacity>
              </>
            )}
          </Animated.View>

          {/* Notice */}
          <View style={styles.notice}>
            <MaterialCommunityIcons name="information-outline" size={14} color={Colors.textSecondary} />
            <Text style={styles.noticeText}>{T.login.notice}</Text>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.primary },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  backBtn: { padding: 8 },
  langToggle: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  langText: { color: Colors.white, fontSize: 12 },
  brandSection: { alignItems: 'center', paddingVertical: Spacing.xl },
  logoOuter: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: 'rgba(255,107,0,0.15)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: 'rgba(255,107,0,0.4)',
    marginBottom: Spacing.md,
  },
  logoInner: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: 'rgba(255,107,0,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },
  appName: { color: Colors.white, fontSize: 26, fontWeight: 'bold', letterSpacing: 0.5 },
  subName: { color: '#B8C8D8', fontSize: 13, marginTop: 4 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: Spacing.md },
  dividerLine: { width: 40, height: 1, backgroundColor: 'rgba(255,107,0,0.4)' },
  card: {
    backgroundColor: Colors.white,
    marginHorizontal: Spacing.md,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    ...Shadows.lg,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.textPrimary,
    marginBottom: Spacing.lg,
    textAlign: 'center',
  },
  inputGroup: { marginBottom: Spacing.md },
  inputLabel: { fontSize: 13, color: Colors.textSecondary, marginBottom: 6 },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  inputIcon: { paddingLeft: Spacing.sm },
  input: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: Spacing.sm,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  eyeBtn: { padding: Spacing.sm },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.dangerBg,
    borderRadius: BorderRadius.sm,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  errorText: { color: Colors.danger, fontSize: 13, flex: 1 },
  forgotBtn: { alignSelf: 'flex-end', marginBottom: Spacing.md },
  forgotText: { color: Colors.primary, fontSize: 13 },
  loginBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    ...Shadows.md,
  },
  loginBtnDisabled: { opacity: 0.7 },
  loginBtnText: { color: Colors.white, fontSize: 16, fontWeight: '600' },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: Spacing.md },
  orLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  orText: { fontSize: 12, color: Colors.textMuted },
  biometricBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: 12,
  },
  biometricBtnText: { color: Colors.primary, fontSize: 14 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
  },
  noticeText: { color: '#8899AA', fontSize: 12, flex: 1 },
});
