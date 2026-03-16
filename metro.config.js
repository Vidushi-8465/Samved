const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.sourceExts.push('cjs');

// CRITICAL: Disable package exports to fix the Firebase registration error
config.resolver.unstable_enablePackageExports = false;

module.exports = config;