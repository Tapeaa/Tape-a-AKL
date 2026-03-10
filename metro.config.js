// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Configurer l'alias @/ pour Metro
config.resolver.alias = {
  '@': path.resolve(__dirname),
};

// Configurer le resolver pour gérer correctement les assets
config.resolver.assetExts = [
  ...config.resolver.assetExts,
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'mp4',
];

// Exclure react-native-maps sur le web
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Sur le web, remplacer react-native-maps par un module vide
  if (platform === 'web' && moduleName === 'react-native-maps') {
    return {
      filePath: require.resolve('./lib/maps.web.tsx'),
      type: 'sourceFile',
    };
  }
  
  // Utiliser le resolver par défaut pour tous les modules (y compris les assets)
  // Metro gère automatiquement les assets et l'alias @/ pour les modules JS/TS
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
