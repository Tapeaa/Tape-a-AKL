import { useEffect, useState, useCallback } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import 'react-native-reanimated';
import { View, StyleSheet, ActivityIndicator, Image, Animated, Platform, Dimensions } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Constants from 'expo-constants';
import { Asset } from 'expo-asset';
import { Text } from '@/components/ui/Text';

import { AuthProvider } from '@/lib/AuthContext';
import { queryClient } from '@/lib/queryClient';
import { StripeProvider, isStripeAvailable } from '@/lib/stripe';
import { NetworkStatus } from '@/components/NetworkStatus';
import MessageNotification from '@/components/MessageNotification';
import { initializeOneSignal } from '@/lib/onesignal';
import { UpdateRequiredModal } from '@/components/UpdateRequiredModal';
import { apiFetch } from '@/lib/api';

SplashScreen.preventAutoHideAsync();

const stripePublishableKey = Constants.expoConfig?.extra?.stripePublishableKey || '';

// ========================================
// TOUTES LES IMAGES DE L'APPLICATION
// Chargées AVANT l'affichage de l'app
// ========================================
const allAppImages = [
  // Logo principal
  require('@/assets/images/logo.png'),
  
  // Icônes du menu déroulant (écran d'accueil)
  require('@/assets/images/icon-tarifs.png'),
  require('@/assets/images/icon-commandes.png'),
  require('@/assets/images/icon-documents.png'),
  require('@/assets/images/icon-contact.png'),
  require('@/assets/images/icon-paiement.png'),
  require('@/assets/images/icon-reservation.png'),
  require('@/assets/images/icon-taxi-immediat.png'),
  require('@/assets/images/icon-tour.png'),
  
  // Carousel partenaires
  require('@/assets/images/aveia.png'),
  require('@/assets/images/tapea.png'),
  require('@/assets/images/hiplounge.png'),
  
  // Marqueurs de carte (CRITIQUES pour l'UX)
  require('@/assets/images/Icone_acpp_(5)_1764132915723_1767064460978.png'),
  require('@/assets/images/Iconeacpp(1).gif'),
  // require('@/assets/images/Iconearrivéee.gif'), // Image manquante, commentée
  require('@/assets/images/iconeposition.gif'),
  require('@/assets/images/lestop.png'),
  require('@/assets/images/stopl.png'),
  require('@/assets/images/stopppp.gif'),
  require('@/assets/images/250-150.png'),
  require('@/assets/images/user-marker.png'),
  require('@/assets/images/Icone-position-client.png'),
  require('@/assets/images/Icone_acpp__1764076202750_1767064460978.png'),
  require('@/assets/images/Icone_acpp_(2)_1764128496499_1767064468618.png'),
  
  // Véhicules et services
  require('@/assets/images/voiture.png'),
  require('@/assets/images/taxi.png'),
  require('@/assets/images/renault-trafic-van.png'),
  
  // Profils et avatars
  require('@/assets/images/pdpclient.png'),
  require('@/assets/images/Pdpexemple.png'),
  
  // Images de services/catégories
  require('@/assets/images/1_1764131703346_1767064437791.png'),
  require('@/assets/images/2_1764131703346_1767064437791.png'),
  require('@/assets/images/3_1764131703346_1767064437791.png'),
  require('@/assets/images/1_1764131264721_1767064437791.png'),
  require('@/assets/images/2_1764131264721_1767064437791.png'),
  require('@/assets/images/3_1764131264721_1767064437791.png'),
  require('@/assets/images/6_1764076802813_1767064437791.png'),
  require('@/assets/images/7_1764076802813_1767064437791.png'),
  require('@/assets/images/8_1764076802813_1767064437791.png'),
  require('@/assets/images/9_1764076802813_1767064437791.png'),
  require('@/assets/images/10_1764076802814_1767064437791.png'),
  
  // Autres images
  require('@/assets/images/2.png'),
  require('@/assets/images/3.png'),
  require('@/assets/images/4.png'),
  require('@/assets/images/island.png'),
  require('@/assets/images/calendar.png'),
  require('@/assets/images/discount.png'),
  require('@/assets/images/icon.png'),
  require('@/assets/images/APPLICATION_MOBILE-3_1764074134063_1767064437792.png'),
  require('@/assets/images/APPLICATION_MOBILE-6_1764074860081_1767064437792.png'),
];

const StripeProviderWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  if (isStripeAvailable && StripeProvider) {
    return (
      <StripeProvider
        publishableKey={stripePublishableKey}
        merchantIdentifier="merchant.com.tapea"
      >
        {children}
      </StripeProvider>
    );
  }
  return <View style={{ flex: 1 }}>{children}</View>;
};

// Précharger la vidéo splash et retourner l'URI locale (pour affichage fiable)
async function preloadSplashVideo(): Promise<string | null> {
  try {
    const asset = Asset.fromModule(SPLASH_VIDEO);
    await asset.downloadAsync();
    const uri = asset.localUri ?? asset.uri;
    console.log('[Preload] ✅ Vidéo splash chargée:', uri ? 'OK' : 'pas d\'URI');
    return uri;
  } catch (e) {
    console.warn('[Preload] Erreur vidéo splash:', e);
    return null;
  }
}

// Fonction pour précharger toutes les images avec progression
async function preloadAllImages(onProgress: (loaded: number, total: number) => void): Promise<void> {
  const total = allAppImages.length;
  let loaded = 0;
  
  console.log(`[Preload] Début du chargement de ${total} images...`);
  
  // Charger les images par lots de 5 pour optimiser la vitesse
  const batchSize = 5;
  for (let i = 0; i < allAppImages.length; i += batchSize) {
    const batch = allAppImages.slice(i, i + batchSize);
    
    await Promise.all(
      batch.map(async (imageSource) => {
        try {
          await Asset.fromModule(imageSource).downloadAsync();
          loaded++;
          onProgress(loaded, total);
        } catch (error) {
          console.warn(`[Preload] Erreur pour une image:`, error);
          loaded++;
          onProgress(loaded, total);
        }
      })
    );
  }
  
  console.log(`[Preload] ✅ ${loaded}/${total} images chargées!`);
}

// Vidéo splash screen - 0129(1) (1).mp4 (copie = splash-opening.mp4 pour compatibilité Metro)
const SPLASH_VIDEO = require('@/assets/images/splash-opening.mp4');

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Écran de chargement personnalisé avec vidéo splash
function LoadingScreen({ progress, loadedCount, totalCount, videoUri }: { progress: number; loadedCount: number; totalCount: number; videoUri: string | null }) {
  const videoSource = videoUri ? { uri: videoUri } : SPLASH_VIDEO;
  
  return (
    <View style={styles.loadingContainer}>
      <StatusBar style="light" />
      
      {/* Vidéo splash en plein écran */}
      {Platform.OS !== 'web' ? (
        <Video
          source={videoSource}
          style={styles.splashVideo}
          resizeMode={ResizeMode.COVER}
          shouldPlay
          isLooping={false}
          isMuted
          useNativeControls={false}
          usePoster={false}
        />
      ) : (
        <Image
          source={require('@/assets/images/logo.png')}
          style={styles.fallbackLogo}
          resizeMode="contain"
        />
      )}
      
      {/* Overlay semi-transparent avec barre de progression */}
      <View style={styles.progressOverlay}>
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressBar, { width: `${Math.min(100, progress)}%` }]} />
        </View>
        <Text style={styles.progressText}>
          {progress < 100 
            ? `Chargement... ${loadedCount}/${totalCount}`
            : 'Prêt !'}
        </Text>
        {progress < 100 && (
          <ActivityIndicator size="small" color="#F5C400" style={styles.spinner} />
        )}
      </View>
    </View>
  );
}

export default function RootLayout() {
  const [appIsReady, setAppIsReady] = useState(false);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadedCount, setLoadedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(allAppImages.length);
  
  // État pour la mise à jour forcée
  const [updateRequired, setUpdateRequired] = useState(false);
  const [updateMessage, setUpdateMessage] = useState('');
  const [updateStoreUrl, setUpdateStoreUrl] = useState('');
  
  const [fontsLoaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  // Debug: Log des variables d'environnement au runtime
  useEffect(() => {
    console.log('=== RUNTIME DEBUG (APP STARTUP) ===');
    console.log('Constants.expoConfig?.extra:', Constants.expoConfig?.extra);
    console.log('apiUrl:', Constants.expoConfig?.extra?.apiUrl || 'NOT SET');
    console.log('googleMapsApiKey:', Constants.expoConfig?.extra?.googleMapsApiKey ? `PRESENT (length: ${Constants.expoConfig?.extra?.googleMapsApiKey.length})` : 'MISSING');
    console.log('stripePublishableKey:', Constants.expoConfig?.extra?.stripePublishableKey ? `PRESENT (length: ${Constants.expoConfig?.extra?.stripePublishableKey.length})` : 'MISSING');
    console.log('oneSignalAppId:', Constants.expoConfig?.extra?.oneSignalAppId || 'NOT SET');
    console.log('====================================');
  }, []);

  // Vérifier si une mise à jour est requise
  async function checkAppVersion() {
    try {
      const appVersion = Constants.expoConfig?.version || '1.0.0';
      const platform = Platform.OS;
      
      console.log(`[Version Check] Checking version: ${appVersion} on ${platform}`);
      
      const response = await apiFetch<{
        minVersion: string;
        forceUpdate: boolean;
        needsUpdate: boolean;
        message: string;
        storeUrl: string;
      }>(`/api/app/version-check?app=client&version=${appVersion}&platform=${platform}`);
      
      console.log('[Version Check] Response:', response);
      
      if (response?.forceUpdate && response?.needsUpdate) {
        console.log('[Version Check] ⚠️ Update required!');
        setUpdateRequired(true);
        setUpdateMessage(response.message || 'Une mise à jour est requise.');
        setUpdateStoreUrl(response.storeUrl || '');
      }
    } catch (error) {
      console.log('[Version Check] Error (continuing anyway):', error);
      // En cas d'erreur, on laisse l'app continuer
    }
  }

  // Précharger TOUTES les images AVANT d'afficher l'app
  useEffect(() => {
    async function prepareApp() {
      try {
        console.log('[Preload] Début du préchargement complet...');
        
        // Précharger la vidéo splash et obtenir l'URI locale
        const uri = await preloadSplashVideo();
        setVideoUri(uri);
        
        // Laisser React re-render avec la vidéo avant de cacher le splash
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Cacher le splash natif quand la vidéo est prête
        await SplashScreen.hideAsync();
        
        // Précharger toutes les images avec progression réelle
        await preloadAllImages((loaded, total) => {
          setLoadedCount(loaded);
          setTotalCount(total);
          setLoadingProgress(Math.round((loaded / total) * 100));
        });
        
        // Petit délai pour s'assurer que tout est en mémoire
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Durée minimum du splash vidéo pour que l'utilisateur puisse le voir (2 secondes)
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Vérifier la version de l'app
        await checkAppVersion();
        
        // Initialiser OneSignal pour les notifications push
        try {
          initializeOneSignal();
          console.log('[OneSignal] Initialized successfully');
        } catch (error) {
          console.log('[OneSignal] Initialization error (expected in Expo Go):', error);
        }
        
        console.log('[Preload] ✅ Toutes les ressources sont prêtes!');
        
      } catch (e) {
        console.warn('[Preload] Erreur:', e);
      } finally {
        setAppIsReady(true);
      }
    }

    if (fontsLoaded) {
      prepareApp();
    }
  }, [fontsLoaded]);

  const onLayoutRootView = useCallback(async () => {
    if (appIsReady) {
      await SplashScreen.hideAsync();
    }
  }, [appIsReady]);

  if (!fontsLoaded || !appIsReady) {
    return <LoadingScreen progress={loadingProgress} loadedCount={loadedCount} totalCount={totalCount} videoUri={videoUri} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <QueryClientProvider client={queryClient}>
        <StripeProviderWrapper>
          <AuthProvider>
            <NetworkStatus />
            <MessageNotification />
            {/* Modal de mise à jour obligatoire */}
            <UpdateRequiredModal
              visible={updateRequired}
              message={updateMessage}
              storeUrl={updateStoreUrl}
            />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(client)" />
              <Stack.Screen name="+not-found" />
            </Stack>
            <StatusBar style="dark" />
          </AuthProvider>
        </StripeProviderWrapper>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  splashVideo: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
  fallbackLogo: {
    width: 180,
    height: 80,
    alignSelf: 'center',
    marginTop: '40%',
  },
  progressOverlay: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  progressTrack: {
    width: '80%',
    height: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#F5C400',
    borderRadius: 3,
  },
  progressText: {
    marginTop: 16,
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.9)',
    fontWeight: '500',
  },
  spinner: {
    marginTop: 24,
  },
});
