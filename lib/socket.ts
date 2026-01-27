import { io, Socket } from 'socket.io-client';
import Constants from 'expo-constants';
import type { Order, LocationUpdate } from './types';

// Source unique : app.config.js (via Constants.expoConfig.extra)
const API_URL = Constants.expoConfig?.extra?.apiUrl || '';

// Socket.IO doit se connecter à l'URL de base sans /api
// Retirer /api de l'URL pour Socket.IO
const getSocketUrl = (): string => {
  if (!API_URL) return '';
  // Si l'URL se termine par /api, retirer /api
  if (API_URL.endsWith('/api')) {
    return API_URL.slice(0, -4); // Retirer '/api'
  }
  // Si l'URL se termine par /api/, retirer /api/
  if (API_URL.endsWith('/api/')) {
    return API_URL.slice(0, -5); // Retirer '/api/'
  }
  return API_URL;
};

const SOCKET_URL = getSocketUrl();

let socket: Socket | null = null;

// Stockage des callbacks pour réinscription après reconnexion (avec clé unique pour éviter les doublons)
const reconnectCallbacks: Map<string, () => void> = new Map();

// Fonction pour réinscrire tous les listeners après reconnexion
function rejoinRoomsAfterReconnect() {
  reconnectCallbacks.forEach((callback, key) => {
    try {
      console.log(`[Socket] Re-executing reconnect callback: ${key}`);
      callback();
    } catch (error) {
      console.error(`[Socket] Error re-executing reconnect callback ${key}:`, error);
    }
  });
}

// Ajouter un callback de reconnexion avec une clé unique
function addReconnectCallback(key: string, callback: () => void) {
  reconnectCallbacks.set(key, callback);
}

// Supprimer un callback de reconnexion
function removeReconnectCallback(key: string) {
  reconnectCallbacks.delete(key);
}

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity, // Tentatives infinies
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000, // Max 10 secondes entre tentatives
      timeout: 120000, // 120 secondes (2 minutes) - compatible avec le backend pingTimeout
      forceNew: false, // Réutiliser la connexion si possible
      withCredentials: false, // Pas besoin de credentials pour Socket.IO sur Render
      path: '/socket.io/', // Chemin par défaut de Socket.IO
      // Configuration pour éviter les déconnexions fréquentes (compatible avec le backend)
      upgrade: true, // Permettre l'upgrade vers websocket
      rememberUpgrade: true, // Se souvenir de l'upgrade
    });

    // Gestion des événements de reconnexion
    socket.on('connect', () => {
      console.log('[Socket] Connected');
      // Réinscrire tous les listeners après reconnexion
      rejoinRoomsAfterReconnect();
    });

    socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
      // Ne pas reconnecter manuellement pour "io client disconnect" - laisser Socket.IO gérer
      // Les déconnexions sont normales sur mobile (changement réseau, zones faibles, etc.)
      if (reason === 'io server disconnect') {
        // Le serveur a déconnecté, reconnecter manuellement
        socket?.connect();
      } else if (reason === 'transport close' || reason === 'transport error') {
        // Erreur de transport, Socket.IO va automatiquement reconnecter
        console.log('[Socket] Transport error, Socket.IO will auto-reconnect');
      }
      // Pour "io client disconnect", Socket.IO va automatiquement reconnecter grâce à reconnection: true
    });

    socket.on('reconnect', (attemptNumber) => {
      console.log(`[Socket] Reconnected after ${attemptNumber} attempts`);
      // Réinscrire tous les listeners après reconnexion
      rejoinRoomsAfterReconnect();
    });

    socket.on('reconnect_attempt', (attemptNumber) => {
      console.log(`[Socket] Reconnection attempt ${attemptNumber}`);
    });

    socket.on('reconnect_error', (error) => {
      console.error('[Socket] Reconnection error:', error.message);
    });

    socket.on('reconnect_failed', () => {
      console.error('[Socket] Reconnection failed after all attempts');
      // Essayer de reconnecter manuellement après un délai
      setTimeout(() => {
        if (socket && !socket.connected) {
          console.log('[Socket] Attempting manual reconnection...');
          socket.connect();
        }
      }, 5000);
    });

    socket.on('connect_error', (error) => {
      console.error('[Socket] Connection error:', error.message);
    });
  }
  return socket;
}

export function connectSocket(): Socket {
  const s = getSocket();
  if (!s.connected) {
    s.connect();
  }
  return s;
}

export function isSocketConnected(): boolean {
  return socket?.connected ?? false;
}

export async function connectSocketAsync(): Promise<Socket> {
  const s = getSocket();

  if (s.connected) {
    return s;
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Socket connection timeout'));
    }, 30000); // 30 secondes - plus long pour tolérer les connexions lentes

    s.once('connect', () => {
      clearTimeout(timeout);
      console.log('Socket connected successfully');
      resolve(s);
    });

    s.once('connect_error', (error) => {
      clearTimeout(timeout);
      console.error('Socket connection error:', error);
      reject(error);
    });

    s.connect();
  });
}

export function disconnectSocket(): void {
  // Nettoyer les sessions et rooms jointes
  clearJoinedSessions();
  
  if (socket?.connected) {
    socket.disconnect();
  }
}

export async function joinDriverSessionAsync(sessionId: string): Promise<boolean> {
  try {
    const s = await connectSocketAsync();

    return new Promise((resolve) => {
      s.emit('driver:join', { sessionId }, (ack: { success: boolean }) => {
        if (ack?.success) {
          console.log('Joined driver session successfully:', sessionId);
          resolve(true);
        } else {
          console.warn('Join driver session failed:', sessionId);
          resolve(false);
        }
      });

      setTimeout(() => {
        console.log('Join session no ack, assuming success');
        resolve(true);
      }, 3000);
    });
  } catch (error) {
    console.error('Failed to join driver session:', error);
    return false;
  }
}

export function joinDriverSession(sessionId: string): void {
  const s = getSocket();
  
  const joinSession = () => {
    if (s.connected) {
      s.emit('driver:join', { sessionId });
      console.log(`[Socket] Driver joined session: ${sessionId}`);
    }
  };

  // Enregistrer le callback avec une clé unique pour éviter les doublons
  addReconnectCallback(`driver-session-${sessionId}`, joinSession);

  if (s.connected) {
    joinSession();
  } else {
    s.once('connect', joinSession);
    s.connect();
  }
}

export function updateDriverStatus(sessionId: string, isOnline: boolean): void {
  const s = getSocket();
  console.log(`[Socket] updateDriverStatus called: sessionId=${sessionId}, isOnline=${isOnline}, connected=${s.connected}`);
  if (s.connected) {
    s.emit('driver:status', { sessionId, isOnline });
    console.log(`[Socket] driver:status event emitted`);
  } else {
    console.warn(`[Socket] Cannot update driver status: socket not connected. Attempting to connect...`);
    // Essayer de se connecter puis émettre
    s.once('connect', () => {
      console.log(`[Socket] Socket connected, now emitting driver:status`);
      s.emit('driver:status', { sessionId, isOnline });
    });
    s.connect();
  }
}

export function acceptOrder(orderId: string, sessionId: string): void {
  const s = getSocket();
  if (s.connected) {
    s.emit('order:accept', { orderId, sessionId });
  }
}

export function declineOrder(orderId: string, sessionId: string): void {
  const s = getSocket();
  if (s.connected) {
    s.emit('order:decline', { orderId, sessionId });
  }
}

export function onNewOrder(callback: (order: Order) => void): () => void {
  const s = getSocket();
  s.on('order:new', callback);
  return () => s.off('order:new', callback);
}

export function onPendingOrders(callback: (orders: Order[]) => void): () => void {
  const s = getSocket();
  s.on('orders:pending', callback);
  return () => s.off('orders:pending', callback);
}

export function onOrderTaken(callback: (data: { orderId: string }) => void): () => void {
  const s = getSocket();
  s.on('order:taken', callback);
  return () => s.off('order:taken', callback);
}

export function onOrderExpired(callback: (data: { orderId: string }) => void): () => void {
  const s = getSocket();
  s.on('order:expired', callback);
  return () => s.off('order:expired', callback);
}

export function onOrderAcceptSuccess(callback: (order: Order) => void): () => void {
  const s = getSocket();
  s.on('order:accept:success', callback);
  return () => s.off('order:accept:success', callback);
}

export function onOrderAcceptError(callback: (data: { message: string }) => void): () => void {
  const s = getSocket();
  s.on('order:accept:error', callback);
  return () => s.off('order:accept:error', callback);
}

// Track which sessions/rooms are already joined to prevent duplicates
const joinedSessions = new Set<string>();
const joinedRooms = new Set<string>();

export function joinClientSession(orderId: string, clientToken?: string): void {
  const sessionKey = `client-session-${orderId}`;
  
  // Éviter les rejoins multiples
  if (joinedSessions.has(sessionKey)) {
    console.log(`[Socket] Already joined client session ${orderId}, skipping`);
    return;
  }
  
  const s = getSocket();
  
  const joinSession = () => {
    if (s.connected) {
      // Vérifier à nouveau avant d'émettre
      if (!joinedSessions.has(sessionKey)) {
        s.emit('client:join', { orderId, clientToken });
        joinedSessions.add(sessionKey);
        console.log(`[Socket] Client joined session: ${orderId} with token: ${clientToken ? 'yes' : 'no'}`);
      }
    }
  };

  // Enregistrer le callback avec une clé unique pour éviter les doublons
  addReconnectCallback(sessionKey, joinSession);

  if (s.connected) {
    joinSession();
  } else {
    s.once('connect', joinSession);
    s.connect();
  }
}

// Fonction pour nettoyer les sessions jointes (appelée lors de la déconnexion)
export function clearJoinedSessions(): void {
  joinedSessions.clear();
  joinedRooms.clear();
}

// Fonction pour nettoyer les sessions/rooms d'un ordre spécifique ET les callbacks de reconnexion
// À appeler quand on quitte une commande
export function cleanupOrderConnection(orderId: string): void {
  // Supprimer les sessions jointes pour cet ordre
  const sessionKey = `client-session-${orderId}`;
  const roomKey = `ride-room-${orderId}-client`;
  
  joinedSessions.delete(sessionKey);
  joinedRooms.delete(roomKey);
  
  // Supprimer les callbacks de reconnexion pour cet ordre
  removeReconnectCallback(sessionKey);
  removeReconnectCallback(roomKey);
  
  console.log(`[Socket] Cleaned up connection for order: ${orderId}`);
}

// Nettoyer TOUTES les sessions/rooms et callbacks (reset complet)
export function cleanupAllConnections(): void {
  joinedSessions.clear();
  joinedRooms.clear();
  reconnectCallbacks.clear();
  console.log('[Socket] Cleaned up all connections');
}

export function onClientJoinError(
  callback: (data: { message: string }) => void
): () => void {
  const s = getSocket();
  s.on('client:join:error', callback);
  return () => s.off('client:join:error', callback);
}

export function onDriverAssigned(
  callback: (data: {
    orderId: string;
    driverName: string;
    driverId: string;
    sessionId: string;
  }) => void
): () => void {
  const s = getSocket();
  s.on('order:driver:assigned', callback);
  return () => s.off('order:driver:assigned', callback);
}

// ═══════════════════════════════════════════════════════════════════════════
// RÉSERVATION À L'AVANCE: Listener pour la confirmation de réservation
// ═══════════════════════════════════════════════════════════════════════════
export function onBookingConfirmed(
  callback: (data: {
    orderId: string;
    driverName: string;
    driverId: string;
    sessionId: string;
    orderStatus: string;
    scheduledTime: string;
    timestamp: number;
  }) => void
): () => void {
  const s = getSocket();
  const handler = (data: any) => {
    console.log('[Socket] Booking confirmed received:', data.orderId);
    callback(data);
  };
  s.on('order:booking:confirmed', handler);
  return () => s.off('order:booking:confirmed', handler);
}

export function updateRideStatus(
  orderId: string,
  sessionId: string,
  status: 'enroute' | 'arrived' | 'inprogress' | 'completed'
): void {
  const s = getSocket();
  if (s.connected) {
    s.emit('ride:status:update', { orderId, sessionId, status });
  }
}

export function joinRideRoom(
  orderId: string,
  role: 'driver' | 'client' = 'driver',
  credentials?: { sessionId?: string; clientToken?: string }
): void {
  const roomKey = `ride-room-${orderId}-${role}`;
  
  // Éviter les rejoins multiples
  if (joinedRooms.has(roomKey)) {
    console.log(`[Socket] Already joined ride room ${orderId} as ${role}, skipping`);
    return;
  }
  
  const s = getSocket();
  const payload = { orderId, role, ...credentials };

  const joinRoom = () => {
    if (s.connected) {
      // Vérifier à nouveau avant d'émettre
      if (!joinedRooms.has(roomKey)) {
        s.emit('ride:join', payload);
        joinedRooms.add(roomKey);
        console.log(`[Socket] Joined ride room: ${orderId} as ${role}`);
      }
    }
  };

  // Enregistrer le callback avec une clé unique pour éviter les doublons
  addReconnectCallback(roomKey, joinRoom);

  if (s.connected) {
    joinRoom();
  } else {
    s.once('connect', joinRoom);
    s.connect();
  }
}

export function onRideStatusChanged(
  callback: (data: {
    orderId: string;
    status: 'enroute' | 'arrived' | 'inprogress' | 'completed';
    orderStatus: string;
    driverName: string;
    statusTimestamp?: number;
    totalPrice?: number;
    driverEarnings?: number;
    driverArrivedAt?: string;
    waitingTimeMinutes?: number | null;
    paidStopsCost?: number;
    newPaidStopsCost?: number;
  }) => void
): () => void {
  const s = getSocket();
  console.log('[SOCKET] Setting up ride:status:changed listener, socket connected:', s.connected);
  s.on('ride:status:changed', (data) => {
    console.log('[SOCKET] ✅ ride:status:changed event received:', data);
    callback(data);
  });
  return () => {
    console.log('[SOCKET] Removing ride:status:changed listener');
    s.off('ride:status:changed');
  };
}

export function confirmPayment(
  orderId: string,
  confirmed: boolean,
  role: 'driver' | 'client',
  credentials?: { sessionId?: string; clientToken?: string }
): void {
  const s = getSocket();
  if (s.connected) {
    s.emit('payment:confirm', { orderId, confirmed, role, ...credentials });
  }
}

export function onPaymentStatus(
  callback: (data: {
    orderId: string;
    status: string;
    confirmed: boolean;
    driverConfirmed?: boolean;
    clientConfirmed?: boolean;
    amount?: number;
    paymentMethod?: string;
    cardBrand?: string | null;
    cardLast4?: string | null;
    errorMessage?: string;
  }) => void
): () => void {
  const s = getSocket();
  s.on('payment:status', callback);
  return () => s.off('payment:status', callback);
}

// Écouter les coûts d'arrêt payant envoyés par le chauffeur
export function onPaidStopCostUpdated(
  callback: (data: {
    orderId: string;
    stopCost: number;
    stopDurationMinutes: number;
    newTotalPrice: number;
  }) => void
): () => void {
  const s = getSocket();
  console.log('[SOCKET] Setting up paid:stop:cost:updated listener');
  s.on('paid:stop:cost:updated', (data) => {
    console.log('[SOCKET] ✅ paid:stop:cost:updated received:', data);
    callback(data);
  });
  return () => {
    console.log('[SOCKET] Removing paid:stop:cost:updated listener');
    s.off('paid:stop:cost:updated');
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ STABLE v1.0 - SOCKET EVENTS ARRÊT PAYANT - NE PAS MODIFIER SANS DEMANDE
// Ces fonctions gèrent la communication Socket.IO pour les arrêts payants.
// - onPaidStopStarted: reçoit le signal de début d'arrêt du chauffeur
// - onPaidStopEnded: reçoit le signal de fin + coût total calculé
// - Utilise des handlers spécifiques pour s.off() propre
// ═══════════════════════════════════════════════════════════════════════════

// Écouter le début d'un arrêt payant (lancé par le chauffeur)
export function onPaidStopStarted(
  callback: (data: {
    orderId: string;
    startTime: number;
    accumulatedSeconds: number;
  }) => void
): () => void {
  const s = getSocket();
  console.log('[SOCKET] Setting up paid:stop:started listener');
  
  // Garder une référence à la callback wrapper pour pouvoir la supprimer spécifiquement
  const handler = (data: any) => {
    console.log('[SOCKET] ✅ paid:stop:started received:', data);
    callback(data);
  };
  
  s.on('paid:stop:started', handler);
  
  return () => {
    console.log('[SOCKET] Removing paid:stop:started listener');
    s.off('paid:stop:started', handler);
  };
}

// Écouter la fin d'un arrêt payant (quand le chauffeur reprend la course)
export function onPaidStopEnded(
  callback: (data: {
    orderId: string;
    cost: number;
    durationMinutes: number;
    newAccumulatedSeconds?: number;
    totalCost?: number; // Coût total cumulé des arrêts payants
  }) => void
): () => void {
  const s = getSocket();
  console.log('[SOCKET] Setting up paid:stop:ended listener');
  
  // Garder une référence à la callback wrapper pour pouvoir la supprimer spécifiquement
  const handler = (data: any) => {
    console.log('[SOCKET] ✅ paid:stop:ended received:', data);
    callback(data);
  };
  
  s.on('paid:stop:ended', handler);
  
  return () => {
    console.log('[SOCKET] Removing paid:stop:ended listener');
    s.off('paid:stop:ended', handler);
  };
}

export function retryPayment(orderId: string, clientToken: string): void {
  const s = getSocket();
  if (s.connected) {
    s.emit('payment:retry', { orderId, clientToken });
  }
}

export function switchToCashPayment(orderId: string, clientToken: string): void {
  const s = getSocket();
  if (s.connected) {
    s.emit('payment:switch-cash', { orderId, clientToken });
    console.log(`[Socket] payment:switch-cash emitted for order ${orderId}`);
  }
}

export function onPaymentRetryReady(
  callback: (data: {
    orderId: string;
    message: string;
  }) => void
): () => void {
  const s = getSocket();
  s.on('payment:retry:ready', callback);
  return () => s.off('payment:retry:ready', callback);
}

export function onPaymentSwitchedToCash(
  callback: (data: {
    orderId: string;
    amount: number;
    message: string;
  }) => void
): () => void {
  const s = getSocket();
  s.on('payment:switched-to-cash', callback);
  return () => s.off('payment:switched-to-cash', callback);
}

export function cancelRide(
  orderId: string,
  role: 'driver' | 'client',
  reason?: string,
  credentials?: { sessionId?: string; clientToken?: string }
): void {
  const s = getSocket();
  if (s.connected) {
    s.emit('ride:cancel', { orderId, role, reason, ...credentials });
  }
}

export function onRideCancelled(
  callback: (data: {
    orderId: string;
    cancelledBy: 'driver' | 'client';
    reason: string;
  }) => void
): () => void {
  const s = getSocket();
  s.on('ride:cancelled', callback);
  return () => s.off('ride:cancelled', callback);
}

export function emitDriverLocation(
  orderId: string,
  sessionId: string,
  lat: number,
  lng: number,
  heading?: number,
  speed?: number
): void {
  const s = getSocket();
  if (s.connected) {
    s.emit('location:driver:update', {
      orderId,
      sessionId,
      lat,
      lng,
      heading,
      speed,
      timestamp: Date.now(),
    });
  }
}

export function emitClientLocation(
  orderId: string,
  clientToken: string,
  lat: number,
  lng: number
): void {
  const s = getSocket();
  if (s.connected) {
    s.emit('location:client:update', {
      orderId,
      clientToken,
      lat,
      lng,
      timestamp: Date.now(),
    });
  }
}

export function onDriverLocationUpdate(callback: (data: LocationUpdate) => void): () => void {
  const s = getSocket();
  console.log('[SOCKET] Setting up driver location listener, socket connected:', s.connected);
  s.on('location:driver', (data) => {
    console.log('[SOCKET] location:driver event received:', data);
    callback(data);
  });
  return () => {
    console.log('[SOCKET] Removing driver location listener');
    s.off('location:driver');
  };
}

export function onClientLocationUpdate(callback: (data: LocationUpdate) => void): () => void {
  const s = getSocket();
  s.on('location:client', callback);
  return () => s.off('location:client', callback);
}

export function calculateHeading(
  prevLat: number,
  prevLng: number,
  currLat: number,
  currLng: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  const dLng = toRad(currLng - prevLng);
  const lat1 = toRad(prevLat);
  const lat2 = toRad(currLat);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  let bearing = toDeg(Math.atan2(y, x));
  return (bearing + 360) % 360;
}
