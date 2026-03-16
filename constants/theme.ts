// constants/theme.ts
export const Colors = {
  primary: '#1A3C6E',       // SMC Navy
  primaryLight: '#2756A0',
  accent: '#FF6B00',        // Saffron
  accentLight: '#FF8C33',
  success: '#2ECC71',
  successBg: '#E8F8F0',
  danger: '#E74C3C',
  dangerBg: '#FDEDEC',
  warning: '#F39C12',
  warningBg: '#FEF9E7',
  info: '#3498DB',
  infoBg: '#EBF5FB',
  white: '#FFFFFF',
  background: '#F0F4F8',
  surface: '#FFFFFF',
  surfaceSecondary: '#F8FAFC',
  border: '#E2E8F0',
  textPrimary: '#1A202C',
  textSecondary: '#64748B',
  textMuted: '#94A3B8',
  overlay: 'rgba(26, 60, 110, 0.85)',
};

export const Fonts = {
  heading: 'Poppins_700Bold',
  headingSemi: 'Poppins_600SemiBold',
  body: 'Poppins_400Regular',
  bodyMedium: 'Poppins_500Medium',
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const BorderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
};

export const Shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: '#1A3C6E',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
  },
};
