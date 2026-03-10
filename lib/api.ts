      import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Source unique : app.config.js (via Constants.expoConfig.extra)
// app.config.js lit process.env.EXPO_PUBLIC_API_URL au build time depuis EAS
export const API_URL = Constants.expoConfig?.extra?.apiUrl || '';
const DEBUG_API_LOGS = false;


// Log l'URL API utilisée
if (DEBUG_API_LOGS) {
  if (API_URL) {
    if (__DEV__) {
      console.log(`[API] 🔧 Development mode - Using API URL: ${API_URL}`);
    } else {
      console.log(`[API] 🚀 Production mode - Using API URL: ${API_URL}`);
    }
  } else {
    console.warn('[API] ⚠️  No API URL configured!');
  }
}

const CLIENT_SESSION_KEY = 'clientSessionId';
const DRIVER_SESSION_KEY = 'driverSessionId';
const SUPPORT_LAST_SEEN_KEY = 'supportLastSeenId';
const DELETED_CONVERSATIONS_KEY = 'deletedConversationsMap';

// Helper pour détecter si on est sur le web
const isWeb = Platform.OS === 'web';

// Stockage sécurisé avec fallback localStorage pour le web
async function secureGet(key: string): Promise<string | null> {
  if (isWeb) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function secureSet(key: string, value: string): Promise<void> {
  if (isWeb) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Ignore errors
    }
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    // Ignore errors
  }
}

async function secureDelete(key: string): Promise<void> {
  if (isWeb) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore errors
    }
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Ignore errors
  }
}

export async function getClientSessionId(): Promise<string | null> {
  return secureGet(CLIENT_SESSION_KEY);
}

export async function setClientSessionId(sessionId: string): Promise<void> {
  return secureSet(CLIENT_SESSION_KEY, sessionId);
}

export async function removeClientSessionId(): Promise<void> {
  return secureDelete(CLIENT_SESSION_KEY);
}

export async function getDriverSessionId(): Promise<string | null> {
  return secureGet(DRIVER_SESSION_KEY);
}

export async function setDriverSessionId(sessionId: string): Promise<void> {
  return secureSet(DRIVER_SESSION_KEY, sessionId);
}

export async function removeDriverSessionId(): Promise<void> {
  return secureDelete(DRIVER_SESSION_KEY);
}

export async function getSupportLastSeenId(): Promise<string | null> {
  return secureGet(SUPPORT_LAST_SEEN_KEY);
}

export async function setSupportLastSeenId(messageId: string): Promise<void> {
  return secureSet(SUPPORT_LAST_SEEN_KEY, messageId);
}

export async function removeSupportLastSeenId(): Promise<void> {
  return secureDelete(SUPPORT_LAST_SEEN_KEY);
}

export async function getDeletedConversationsMap(): Promise<Record<string, number>> {
  const raw = await secureGet(DELETED_CONVERSATIONS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function setDeletedConversationsMap(map: Record<string, number>): Promise<void> {
  return secureSet(DELETED_CONVERSATIONS_KEY, JSON.stringify(map));
}

export async function removeDeletedConversationsMap(): Promise<void> {
  return secureDelete(DELETED_CONVERSATIONS_KEY);
}

interface FetchOptions extends RequestInit {
  skipAuth?: boolean;
  retry?: boolean;
  maxRetries?: number;
}

export class ApiError extends Error {
  status: number;
  isNetworkError: boolean;
  isServerError: boolean;

  constructor(message: string, status: number = 0, isNetworkError: boolean = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.isNetworkError = isNetworkError;
    this.isServerError = status >= 500;
  }
}

/**
 * Retry automatique pour les erreurs réseau
 * Ne retry PAS les erreurs d'authentification (4xx sauf 408, 429)
 */
async function fetchWithRetry<T>(
  fetchFn: () => Promise<T>,
  maxRetries: number = 3,
  retryDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetchFn();
    } catch (error) {
      lastError = error as Error;
      
      // Ne retry que pour les erreurs réseau ou serveur (5xx)
      // Ne PAS retry les erreurs client (4xx) sauf 408 (timeout) et 429 (rate limit)
      const isRetryable = 
        (error instanceof ApiError && (
          error.isNetworkError || 
          (error.isServerError && error.status >= 500) ||
          (error.status === 408 || error.status === 429)
        )) ||
        (error instanceof Error && error.message.includes('network'));
      
      // Ne pas retry les erreurs d'authentification (401, 403) ou de validation (400)
      const isAuthError = error instanceof ApiError && 
        (error.status === 400 || error.status === 401 || error.status === 403 || error.status === 404);
      
      if (isAuthError || !isRetryable || attempt === maxRetries) {
        throw error;
      }
      
      // Attendre avant de retry (exponential backoff)
      const delay = retryDelay * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
      
      if (DEBUG_API_LOGS) {
        console.log(`[API] Retry attempt ${attempt + 1}/${maxRetries} for ${fetchFn.toString().substring(0, 50)}...`);
      }
    }
  }
  
  throw lastError || new Error('Unknown error');
}

export async function apiFetch<T = unknown>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> {
  const { skipAuth = false, retry = true, maxRetries = 3, ...fetchOptions } = options;
  
  // Désactiver le retry pour les endpoints d'authentification (les erreurs d'auth ne doivent pas être retentées)
  const isAuthEndpoint = endpoint.includes('/auth/') || endpoint.includes('/driver/login');
  const shouldRetry = retry && !isAuthEndpoint;
  
  if (!API_URL) {
    throw new ApiError(
      'Serveur non configuré. L\'application fonctionne en mode hors-ligne.',
      0,
      true
    );
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (!skipAuth) {
    const sessionId = await getClientSessionId();
    if (sessionId) {
      // Cookie classique pour le backend (web / navigateur)
      headers['Cookie'] = `clientSessionId=${sessionId}`;
      // Header explicite pour React Native / Render (voir commit "Support X-Client-Session-Id header")
      headers['X-Client-Session-Id'] = sessionId;
    }
  }


  // Construire l'URL en évitant la duplication du préfixe /api
  let url: string;
  if (endpoint.startsWith('http')) {
    url = endpoint;
  } else {
    // Si l'endpoint commence par /api et API_URL se termine par /api, on retire /api de l'endpoint
    const normalizedEndpoint = endpoint.startsWith('/api') && API_URL.endsWith('/api')
      ? endpoint.replace(/^\/api/, '')
      : endpoint;
    url = `${API_URL}${normalizedEndpoint}`;
    
  }

  if (DEBUG_API_LOGS) {
    console.log(`[API] Constructed URL: ${url} (from endpoint: ${endpoint}, API_URL: ${API_URL})`);
  }

  const performFetch = async (): Promise<T> => {
    let response: Response;
    
    // Timeout de 15 secondes pour éviter que l'app "freeze"
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    try {
      response = await fetch(url, {
        ...fetchOptions,
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (networkError: any) {
      clearTimeout(timeoutId);
      
      // Message d'erreur plus clair selon le type d'erreur
      if (networkError?.name === 'AbortError') {
        throw new ApiError(
          'Le serveur met trop de temps à répondre. Veuillez réessayer.',
          0,
          true
        );
      }
      
      throw new ApiError(
        'Impossible de contacter le serveur. Vérifiez votre connexion internet.',
        0,
        true
      );
    }

    // Extraire le cookie de session de la réponse si disponible
    // Pour les routes d'authentification, on extrait le cookie même avec skipAuth
    const setCookieHeader = response.headers.get('set-cookie');
    const isAuthEndpoint = endpoint.includes('/auth/login') || endpoint.includes('/auth/register') || endpoint.includes('/auth/verify');
    const isDriverLogin = endpoint.includes('/driver/login');
    
    if (setCookieHeader && (!skipAuth || isAuthEndpoint || isDriverLogin)) {
      // Extraire clientSessionId pour les clients
      const clientSessionMatch = setCookieHeader.match(/clientSessionId=([^;]+)/);
      if (clientSessionMatch && clientSessionMatch[1]) {
        await setClientSessionId(clientSessionMatch[1]);
      }
      
      // Extraire driverSessionId pour les chauffeurs
      const driverSessionMatch = setCookieHeader.match(/driverSessionId=([^;]+)/);
      if (driverSessionMatch && driverSessionMatch[1]) {
        await setDriverSessionId(driverSessionMatch[1]);
      }
    }

    // Toujours essayer de parser le JSON, même en cas d'erreur
    let data: any = null;
    const contentType = response.headers.get('content-type');
    const isJson = contentType && contentType.includes('application/json');
    
    if (isJson) {
      try {
        const text = await response.text();
        if (text) {
          data = JSON.parse(text);
          
        }
      } catch (parseError) {
        // Si le parsing JSON échoue, on continue avec data = null
        if (DEBUG_API_LOGS) {
          console.warn(`[API] Failed to parse JSON response for ${endpoint}:`, parseError);
        }
        
      }
    }

    if (!response.ok) {
      
      // Ne pas logger les erreurs attendues (session expirée, code invalide) comme ERROR
      const isVerificationError = endpoint.includes('/api/auth/verify') && (response.status === 400 || response.status === 401);
      const isSessionExpired = endpoint.includes('/api/auth/me') && response.status === 401;
      const isExpectedError = isVerificationError || isSessionExpired;
      
      if (DEBUG_API_LOGS && !isExpectedError) {
        console.error(`[API] Error ${response.status} on ${endpoint}:`, data || 'No JSON response');
      } else if (DEBUG_API_LOGS && isSessionExpired) {
        // Session expirée est normale, pas de console.error pour Apple
        console.log(`[API] Session expirée (status 401) - this is expected, will redirect to login`);
      } else if (DEBUG_API_LOGS && isVerificationError) {
        // Log silencieux en mode dev seulement, pas de console.error pour Apple
        console.log(`[API] Verification code rejected (status ${response.status}) - this is expected`);
      }
      
      // Utiliser le message d'erreur du serveur si disponible
      let errorMessage = 'Une erreur est survenue';
      if (data) {
        errorMessage = data.error || data.message || data.errorMessage || errorMessage;
        if (data.details) {
          errorMessage += ` Détails: ${JSON.stringify(data.details)}`;
        }
      } else {
        // Messages d'erreur par défaut selon le code de statut
        switch (response.status) {
          case 400:
            errorMessage = 'Requête invalide. Vérifiez les données envoyées.';
            break;
          case 401:
            errorMessage = 'Code incorrect. Veuillez vérifier votre code d\'accès.';
            break;
          case 403:
            errorMessage = 'Accès refusé. Votre compte peut être désactivé.';
            break;
          case 404:
            errorMessage = 'Ressource non trouvée sur le serveur.';
            break;
          case 502:
            errorMessage = 'Le serveur backend est inaccessible. Vérifiez que le serveur est démarré et accessible.';
            break;
          case 503:
            errorMessage = 'Le serveur est temporairement indisponible. Réessayez dans quelques instants.';
            break;
          case 500:
            errorMessage = 'Erreur interne du serveur. Le serveur rencontre un problème technique.';
            break;
          default:
            errorMessage = `Erreur serveur (${response.status}). Réessayez plus tard.`;
        }
      }
      
      throw new ApiError(errorMessage, response.status, response.status === 0);
    }


    return data as T;
  };

  // Utiliser retry si activé (par défaut true, mais pas pour les endpoints d'auth)
  if (shouldRetry) {
    return fetchWithRetry(performFetch, maxRetries, 1000);
  }
  
  return performFetch();
}

export async function apiPost<T = unknown>(
  endpoint: string,
  body: Record<string, unknown>,
  options: FetchOptions = {}
): Promise<T> {
  // Nettoyer le body pour enlever les valeurs undefined
  const cleanedBody = JSON.parse(JSON.stringify(body));
  
  if (__DEV__) {
    console.log(`[API] POST ${endpoint}`, cleanedBody);
  }
  
  return apiFetch<T>(endpoint, {
    method: 'POST',
    body: JSON.stringify(cleanedBody),
    ...options,
  });
}

export async function apiPatch<T = unknown>(
  endpoint: string,
  body: Record<string, unknown>,
  options: FetchOptions = {}
): Promise<T> {
  return apiFetch<T>(endpoint, {
    method: 'PATCH',
    body: JSON.stringify(body),
    ...options,
  });
}

export async function apiDelete<T = unknown>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> {
  return apiFetch<T>(endpoint, {
    method: 'DELETE',
    ...options,
  });
}

export async function startLiveActivity(
  orderId: string,
  updates: Record<string, any>
): Promise<{ success: boolean }> {
  return apiPost('/api/live-activities/start', { orderId, updates });
}

export async function updateLiveActivity(
  orderId: string,
  updates: Record<string, any>
): Promise<{ success: boolean }> {
  return apiPost('/api/live-activities/update', { orderId, updates });
}

export async function endLiveActivity(
  orderId: string,
  updates: Record<string, any>
): Promise<{ success: boolean }> {
  return apiPost('/api/live-activities/end', { orderId, updates });
}

// ============================================
// FONCTIONS API SPÉCIFIQUES POUR LES COMMANDES
// ============================================

import type { Order, AddressField, Supplement, RouteInfo } from './types';

export interface CreateOrderData {
  clientName: string;
  clientPhone: string;
  addresses: AddressField[];
  rideOption: {
    id: string;
    title: string;
    price: number;
    pricePerKm: number;
  };
  routeInfo?: RouteInfo;
  passengers: number;
  supplements: Supplement[];
  paymentMethod: 'cash' | 'card';
  selectedCardId?: string;
  totalPrice: number;
  driverEarnings: number;
  scheduledTime?: string | null;
  isAdvanceBooking: boolean;
}

export interface CreateOrderResponse {
  order: Order;
  clientToken: string;
}

/**
 * Crée une nouvelle commande
 */
export async function createOrder(orderData: CreateOrderData): Promise<CreateOrderResponse> {
  return apiPost<CreateOrderResponse>('/api/orders', orderData as any);
}

/**
 * Récupère la commande active du client
 */
export interface ActiveOrderResponse {
  hasActiveOrder: boolean;
  order?: Order;
  clientToken?: string;
}

export async function getActiveOrder(): Promise<ActiveOrderResponse> {
  return apiFetch<ActiveOrderResponse>('/api/orders/active/client');
}

/**
 * Récupère la commande active du chauffeur
 */
export interface ActiveDriverOrderResponse {
  hasActiveOrder: boolean;
  order?: Order;
}

export async function getActiveDriverOrder(sessionId: string): Promise<ActiveDriverOrderResponse> {
  return apiFetch<ActiveDriverOrderResponse>(`/api/orders/active/driver?sessionId=${encodeURIComponent(sessionId)}`);
}

/**
 * Récupère les détails d'une commande par son ID
 */
export interface OrderDetailsResponse extends Order {
  driver?: {
    id: string;
    name: string;
    phone: string;
    vehicleModel: string | null;
    vehicleColor: string | null;
    vehiclePlate: string | null;
    averageRating: number | null;
    photoUrl?: string | null;
  };
}

export async function getOrder(orderId: string): Promise<OrderDetailsResponse> {
  return apiFetch<OrderDetailsResponse>(`/api/orders/${orderId}`);
}

/**
 * Annule une commande (côté client)
 * Permet d'annuler une course en attente ou en cours
 */
export interface CancelOrderResponse {
  success: boolean;
  message?: string;
}

export async function cancelOrder(orderId: string, clientToken: string, reason?: string): Promise<CancelOrderResponse> {
  try {
    const response = await apiPost<CancelOrderResponse>(`/api/orders/${orderId}/cancel`, {
      clientToken,
      role: 'client',
      reason: reason || 'Annulé par le client',
    });
    return response;
  } catch (error) {
    console.error('[API] Cancel order error:', error);
    // Si l'erreur est "commande déjà terminée/annulée", on considère ça comme un succès
    if (error instanceof ApiError && (error.status === 400 || error.status === 404)) {
      return { success: true, message: 'Commande déjà terminée ou annulée' };
    }
    throw error;
  }
}

export interface UpdateWaitingTimeResponse {
  success: boolean;
  waitingTimeMinutes?: number | null;
  totalPrice?: number;
  waitingFee?: number;
  error?: string;
}

export async function updateOrderWaitingTime(orderId: string, waitingTimeMinutes: number): Promise<UpdateWaitingTimeResponse> {
  try {
    const response = await apiPost<UpdateWaitingTimeResponse>(`/api/orders/${orderId}/waiting-time`, {
      waitingTimeMinutes,
    });
    return response;
  } catch (error) {
    console.error('[API] Update waiting time error:', error);
    if (error instanceof ApiError) {
      return { success: false, error: error.message };
    }
    throw error;
  }
}

/**
 * Récupère la position GPS du chauffeur (polling backup si Socket.IO échoue)
 */
export interface DriverLocationResponse {
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  timestamp: number;
}

export async function getDriverLocation(orderId: string): Promise<DriverLocationResponse | null> {
  try {
    return await apiFetch<DriverLocationResponse>(`/api/orders/${orderId}/driver-location`);
  } catch (error) {
    // Si le chauffeur n'a pas encore envoyé sa position, retourner null
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Stockage du clientToken pour authentification Socket.IO
 */
const CLIENT_TOKEN_KEY = 'clientToken';
const CURRENT_ORDER_ID_KEY = 'currentOrderId';

export async function getClientToken(): Promise<string | null> {
  return secureGet(CLIENT_TOKEN_KEY);
}

export async function setClientToken(token: string): Promise<void> {
  return secureSet(CLIENT_TOKEN_KEY, token);
}

export async function removeClientToken(): Promise<void> {
  return secureDelete(CLIENT_TOKEN_KEY);
}

export async function getCurrentOrderId(): Promise<string | null> {
  return secureGet(CURRENT_ORDER_ID_KEY);
}

export async function setCurrentOrderId(orderId: string): Promise<void> {
  return secureSet(CURRENT_ORDER_ID_KEY, orderId);
}

export async function removeCurrentOrderId(): Promise<void> {
  return secureDelete(CURRENT_ORDER_ID_KEY);
}

// Cache pour les données de commande (en cas de perte de connexion)
const ORDER_CACHE_KEY = 'cachedOrder';
const ORDER_CACHE_TIMESTAMP_KEY = 'cachedOrderTimestamp';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export async function cacheOrder(order: any): Promise<void> {
  try {
    await secureSet(ORDER_CACHE_KEY, JSON.stringify(order));
    await secureSet(ORDER_CACHE_TIMESTAMP_KEY, Date.now().toString());
  } catch (error) {
    console.warn('Failed to cache order:', error);
  }
}

export async function getCachedOrder(): Promise<any | null> {
  try {
    const cachedData = await secureGet(ORDER_CACHE_KEY);
    const timestamp = await secureGet(ORDER_CACHE_TIMESTAMP_KEY);
    
    if (!cachedData || !timestamp) {
      return null;
    }
    
    const cacheAge = Date.now() - parseInt(timestamp, 10);
    if (cacheAge > CACHE_DURATION) {
      // Cache expiré, nettoyer
      await clearCachedOrder();
      return null;
    }
    
    return JSON.parse(cachedData);
  } catch (error) {
    console.warn('Failed to get cached order:', error);
    return null;
  }
}

export async function clearCachedOrder(): Promise<void> {
  try {
    await secureDelete(ORDER_CACHE_KEY);
    await secureDelete(ORDER_CACHE_TIMESTAMP_KEY);
  } catch (error) {
    console.warn('Failed to clear cached order:', error);
  }
}

// ============ FRAIS DE SERVICE CONFIG ============

export async function getFraisServiceConfig(): Promise<{
  fraisServicePrestataire: number;
  commissionPrestataire: number;
  commissionSalarieTapea: number;
}> {
  try {
    const response = await apiFetch<{
      success: boolean;
      config: {
        fraisServicePrestataire: number;
        commissionPrestataire: number;
        commissionSalarieTapea: number;
      };
    }>('/api/frais-service-config', { skipAuth: true });
    
    return response.config || {
      fraisServicePrestataire: 15,
      commissionPrestataire: 0,
      commissionSalarieTapea: 0,
    };
  } catch (error) {
    console.warn('Failed to get frais service config, using defaults:', error);
    return {
      fraisServicePrestataire: 15,
      commissionPrestataire: 0,
      commissionSalarieTapea: 0,
    };
  }
}
