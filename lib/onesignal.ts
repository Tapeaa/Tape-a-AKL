import Constants from 'expo-constants';

const ONESIGNAL_APP_ID = Constants.expoConfig?.extra?.oneSignalAppId || 'e5e23506-2176-47ce-9861-cae3b49ed002';

// Variable pour stocker OneSignal une fois chargé
let OneSignalModule: any = null;
let isInitialized = false;
let moduleLoadAttempted = false;

/**
 * Vérifie si les modules natifs sont disponibles (pas en Expo Go)
 */
function areNativeModulesAvailable(): boolean {
  try {
    // Check if we're in Expo Go by looking for the native module
    const { NativeModules } = require('react-native');
    return NativeModules.OneSignal !== undefined && NativeModules.OneSignal !== null;
  } catch {
    return false;
  }
}

/**
 * Charge OneSignal de manière sécurisée - uniquement si les modules natifs sont disponibles
 */
function getOneSignal() {
  if (OneSignalModule) return OneSignalModule;
  if (moduleLoadAttempted) return null;
  
  moduleLoadAttempted = true;
  
  // Ne pas tenter de charger si les modules natifs ne sont pas disponibles
  if (!areNativeModulesAvailable()) {
    console.log('[OneSignal] Native modules not available (Expo Go detected) - skipping');
    return null;
  }
  
  try {
    const { OneSignal } = require('react-native-onesignal');
    OneSignalModule = OneSignal;
    return OneSignal;
  } catch (error) {
    console.log('[OneSignal] Failed to load module:', error);
    return null;
  }
}

/**
 * Initialise OneSignal pour les notifications push
 */
export function initializeOneSignal() {
  if (isInitialized) return;
  
  const OneSignal = getOneSignal();
  if (!OneSignal) {
    console.log('[OneSignal] Skipping initialization - module not available');
    return;
  }
  
  try {
    // Initialiser OneSignal avec l'App ID
    OneSignal.initialize(ONESIGNAL_APP_ID);
    
    // Demander la permission pour les notifications (iOS)
    OneSignal.Notifications.requestPermission(true);
    
    isInitialized = true;
    console.log('[OneSignal] ✅ Initialized with App ID:', ONESIGNAL_APP_ID);
  } catch (error) {
    console.log('[OneSignal] Initialization error:', error);
  }
}

/**
 * Définit l'ID externe de l'utilisateur (pour cibler un client spécifique)
 */
export function setClientExternalId(clientId: string) {
  const OneSignal = getOneSignal();
  if (!OneSignal || !clientId) return;
  
  try {
    OneSignal.login(clientId);
    console.log('[OneSignal] Set external user ID:', clientId);
  } catch (error) {
    console.log('[OneSignal] Error setting external ID:', error);
  }
}

/**
 * Supprime l'ID externe (déconnexion)
 */
export function removeExternalId() {
  const OneSignal = getOneSignal();
  if (!OneSignal) return;
  
  try {
    OneSignal.logout();
    console.log('[OneSignal] Removed external user ID');
  } catch (error) {
    console.log('[OneSignal] Error removing external ID:', error);
  }
}

/**
 * Ajoute un tag au client
 */
export function addClientTag(key: string, value: string) {
  const OneSignal = getOneSignal();
  if (!OneSignal) return;
  
  try {
    OneSignal.User.addTag(key, value);
    console.log(`[OneSignal] Added tag: ${key}=${value}`);
  } catch (error) {
    console.log('[OneSignal] Error adding tag:', error);
  }
}

/**
 * Ajoute plusieurs tags
 */
export function addClientTags(tags: Record<string, string>) {
  const OneSignal = getOneSignal();
  if (!OneSignal) return;
  
  try {
    OneSignal.User.addTags(tags);
    console.log('[OneSignal] Added tags:', tags);
  } catch (error) {
    console.log('[OneSignal] Error adding tags:', error);
  }
}

/**
 * Écoute les notifications reçues
 */
export function onNotificationReceived(callback: (notification: any) => void) {
  const OneSignal = getOneSignal();
  if (!OneSignal) return;
  
  try {
    OneSignal.Notifications.addEventListener('foregroundWillDisplay', (event: any) => {
      console.log('[OneSignal] Notification received in foreground:', event.notification);
      callback(event.notification);
      event.preventDefault();
      event.notification.display();
    });
  } catch (error) {
    console.log('[OneSignal] Error setting notification listener:', error);
  }
}

/**
 * Écoute les clics sur les notifications
 */
export function onNotificationClicked(callback: (notification: any) => void) {
  const OneSignal = getOneSignal();
  if (!OneSignal) return;
  
  try {
    OneSignal.Notifications.addEventListener('click', (event: any) => {
      console.log('[OneSignal] Notification clicked:', event.notification);
      callback(event.notification);
    });
  } catch (error) {
    console.log('[OneSignal] Error setting click listener:', error);
  }
}

/**
 * Récupère l'ID de souscription OneSignal
 */
export async function getSubscriptionId(): Promise<string | null> {
  const OneSignal = getOneSignal();
  if (!OneSignal) return null;
  
  try {
    const subscriptionId = OneSignal.User.pushSubscription.getPushSubscriptionId();
    console.log('[OneSignal] Subscription ID:', subscriptionId);
    return subscriptionId;
  } catch (error) {
    console.log('[OneSignal] Error getting subscription ID:', error);
    return null;
  }
}

/**
 * Vérifie si les notifications sont activées
 */
export function areNotificationsEnabled(): boolean {
  const OneSignal = getOneSignal();
  if (!OneSignal) return false;
  
  try {
    return OneSignal.User.pushSubscription.getOptedIn();
  } catch (error) {
    console.log('[OneSignal] Error checking notifications status:', error);
    return false;
  }
}

/**
 * Vérifie si OneSignal est disponible
 */
export function isOneSignalAvailable(): boolean {
  return getOneSignal() !== null;
}

export default {
  initializeOneSignal,
  setClientExternalId,
  removeExternalId,
  addClientTag,
  addClientTags,
  onNotificationReceived,
  onNotificationClicked,
  getSubscriptionId,
  areNotificationsEnabled,
  isOneSignalAvailable,
};
