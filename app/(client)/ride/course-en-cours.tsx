import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Linking, Alert, Platform, Modal, Animated, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { DriverCarIcon } from '@/components/DriverCarIcon';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PaymentResultModal } from '@/components/PaymentResultModal';
import { RatingModal } from '@/components/RatingModal';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { useAuth } from '@/lib/AuthContext';

// FLAG GLOBAL - persiste même après remontage du composant
let globalInitialized = false;
let globalOrderId: string | null = null;
import * as apiModule from '@/lib/api';
import {
  getActiveOrder,
  getOrder,
  getClientToken,
  setClientToken,
  getCurrentOrderId,
  setCurrentOrderId,
  removeClientToken,
  removeCurrentOrderId,
  updateOrderWaitingTime,
  startLiveActivity,
  updateLiveActivity,
  endLiveActivity,
  apiFetch,
  apiPost,
  getFraisServiceConfig,
} from '@/lib/api';
import {
  connectSocketAsync,
  joinClientSession,
  joinRideRoom,
  onDriverAssigned,
  onRideStatusChanged,
  onPaymentStatus,
  onPaymentRetryReady,
  onPaymentSwitchedToCash,
  onRideCancelled,
  onDriverLocationUpdate,
  emitClientLocation,
  cancelRide,
  retryPayment,
  switchToCashPayment,
  disconnectSocket,
  calculateHeading,
  getSocket,
  cleanupOrderConnection,
  onPaidStopStarted,
  onPaidStopEnded,
  onFraisServiceOfferts,
} from '@/lib/socket';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Import conditionnel des maps selon la plateforme (Expo gère automatiquement .native.tsx vs .tsx)
import { MapView, Marker, Polyline, isMapsAvailable } from '@/lib/maps';
import type { Order, LocationUpdate } from '@/lib/types';
import type { OrderDetailsResponse } from '@/lib/api';
import { getDriverLocation } from '@/lib/api';

// Source unique : app.config.js (via Constants.expoConfig.extra)
const GOOGLE_MAPS_API_KEY = Constants.expoConfig?.extra?.googleMapsApiKey || '';

// Fonction pour décoder une polyline Google Maps
const decodePolyline = (encoded: string): Array<{ latitude: number; longitude: number }> => {
  const coordinates: Array<{ latitude: number; longitude: number }> = [];
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;

  while (index < len) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = ((result & 1) !== 0 ? ~(result >> 1) : (result >> 1));
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = ((result & 1) !== 0 ? ~(result >> 1) : (result >> 1));
    lng += dlng;

    coordinates.push({
      latitude: lat * 1e-5,
      longitude: lng * 1e-5,
    });
  }

  return coordinates;
};

export default function CourseEnCoursClientScreen() {
  const cacheOrderFn = apiModule.cacheOrder;
  const getCachedOrderFn = apiModule.getCachedOrder;
  const clearCachedOrderFn = apiModule.clearCachedOrder;

  const router = useRouter();
  const { client } = useAuth();
  const params = useLocalSearchParams<{
    orderId?: string;
    pickup?: string;
    destination?: string;
    totalPrice?: string;
  }>();

  const [order, setOrder] = useState<OrderDetailsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [rideStatus, setRideStatus] = useState<'enroute' | 'arrived' | 'inprogress' | 'completed'>('enroute');
  const [clientLocation, setClientLocation] = useState<{ lat: number; lng: number; heading?: number } | null>(null);
  const [clientSnappedLocation, setClientSnappedLocation] = useState<{ lat: number; lng: number; heading?: number } | null>(null);
  const lastClientLocationForHeading = useRef<{ lat: number; lng: number; timestamp: number } | null>(null);
  const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number; heading?: number } | null>(null);
  const [driverSnappedLocation, setDriverSnappedLocation] = useState<{ lat: number; lng: number; heading?: number } | null>(null);
  const [clientToken, setClientTokenState] = useState<string | null>(null);
  const [routeCoordinates, setRouteCoordinates] = useState<Array<{ latitude: number; longitude: number }>>([]);
  const [driverRouteCoordinates, setDriverRouteCoordinates] = useState<Array<{ latitude: number; longitude: number }>>([]);
  const [driverEta, setDriverEta] = useState<string | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [waitingTime, setWaitingTime] = useState<number>(0); // Timer en secondes
  const [arrivedAt, setArrivedAt] = useState<Date | null>(null); // Timestamp d'arrivée du chauffeur
  const mapRef = useRef<any>(null);
  const [userMovedMap, setUserMovedMap] = useState(false);
  const [initialCenterDone, setInitialCenterDone] = useState(false);
  const recenterTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Refs pour des animations de caméra fluides et stables
  const lastCameraAnimationTime = useRef<number>(0);
  const isAnimatingCamera = useRef<boolean>(false);
  const lastCameraHeading = useRef<number>(0);
  const CAMERA_ANIMATION_THROTTLE = 3000; // Minimum 3 secondes entre chaque animation
  const [showPaymentResult, setShowPaymentResult] = useState(false);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [paymentFlowCompleted, setPaymentFlowCompleted] = useState(false);
  const [paymentPopupDismissed, setPaymentPopupDismissed] = useState(false);
  
  // État pour le modal des frais de service offerts
  const [showFraisOffertsModal, setShowFraisOffertsModal] = useState(false);
  const [fraisOffertsData, setFraisOffertsData] = useState<{
    ancienPrix: number;
    nouveauPrix: number;
    economie: number;
  } | null>(null);
  // Refs pour éviter les problèmes de closure dans les callbacks socket
  const paymentFlowCompletedRef = useRef(false);
  const showPaymentResultRef = useRef(false);
  const [paymentResult, setPaymentResult] = useState<{
    status: 'success' | 'failed';
    amount: number;
    paymentMethod?: 'card' | 'cash';
    cardBrand?: string | null;
    cardLast4?: string | null;
    errorMessage?: string;
    paidStopsCost?: number;
    supplements?: Array<{ nom?: string; name?: string; prixXpf?: number; price?: number; quantity?: number }>;
  } | null>(null);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState<number>(0);
  const [navigationMode, setNavigationMode] = useState(false); // Mode navigation/itinéraire
  const statusBannerScale = useRef(new Animated.Value(1)).current;
  const [showPriceDetailsModal, setShowPriceDetailsModal] = useState(false);
  const [tarifs, setTarifs] = useState<any[]>([]);
  const [supplements, setSupplements] = useState<any[]>([]);
  const [fraisServicePercent, setFraisServicePercent] = useState(15);
  const waitingRate = 47; // Tarif d'attente: 47 XPF/min après 5 min gratuites
  const PAID_STOP_RATE = 42; // Tarif arrêt payant: 42 XPF/min dès la 1ère min
  const liveActivityStartedRef = useRef(false);
  const lastLiveActivityUpdateRef = useRef<number>(0);
  
  // État pour les coûts d'arrêt payant (arrêts pendant la course)
  const [paidStopsCost, setPaidStopsCost] = useState(0);
  const paidStopsCostRef = useRef(0); // Ref pour le polling (évite les closures stale)
  
  // Synchroniser la ref avec l'état
  useEffect(() => {
    paidStopsCostRef.current = paidStopsCost;
  }, [paidStopsCost]);
  
  // États pour le modal d'arrêt payant (contrôlé par le chauffeur)
  const [showPaidStopModal, setShowPaidStopModal] = useState(false);
  const [paidStopDisplaySeconds, setPaidStopDisplaySeconds] = useState(0);
  const [paidStopTotalCost, setPaidStopTotalCost] = useState(0);
  const paidStopAnimationRef = useRef<number | null>(null);
  const paidStopAccumulatedRef = useRef(0);
  const paidStopStartTimeRef = useRef<number | null>(null);
  const showPaidStopModalRef = useRef(false); // Ref pour le polling (évite les dépendances cycliques)

  const locationWatchRef = useRef<Location.LocationSubscription | null>(null);
  const lastClientLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastDriverLocationForRouteRef = useRef<{ lat: number; lng: number } | null>(null);
  const isCalculatingRouteRef = useRef(false);
  const isInitializingRef = useRef(false);
  const lastKnownStatusRef = useRef<string>('enroute'); // Ref pour stocker le dernier statut connu (évite les problèmes de closure stale)
  const socketJoinedRef = useRef<string | null>(null); // Protection contre les rejoins multiples Socket.IO (stocke orderId)
  const insets = useSafeAreaInsets();

  const parseEtaMinutes = (eta: string | null, fallback?: string | null) => {
    const source = eta || fallback || '';
    const match = source.match(/(\d+)/);
    return match ? Number(match[1]) : null;
  };

  const buildLiveActivityUpdates = () => {
    if (!order) return null;
    return {
      status: rideStatus,
      orderId: order.id,
      driverName: order.driverName || 'Chauffeur',
      etaMinutes: parseEtaMinutes(driverEta, order.routeInfo?.duration || null),
      distanceKm: order.routeInfo?.distance ?? null,
      pickupAddress: order.addresses.find((a) => a.type === 'pickup')?.value || null,
      destinationAddress: order.addresses.find((a) => a.type === 'destination')?.value || null,
    };
  };

  // Initialisation : récupérer la commande active (UNE SEULE FOIS)
  useEffect(() => {
    // Protection locale : si order existe déjà, ne rien faire
    if (order) {
      console.log('[COURSE_EN_COURS] Order already loaded, skipping');
      setIsLoading(false);
      return;
    }

    // Protection GLOBALE - Verrouillage SYNCHRONE immédiat
    // On ne skip QUE si globalInitialized est true ET on a déjà un order
    // Sinon on doit quand même charger l'order (car c'est un state local perdu au remontage)
    const wasAlreadyInitialized = globalInitialized;
    
    // Verrouiller IMMÉDIATEMENT de manière synchrone (avant tout code async)
    globalInitialized = true;

    let mounted = true;

    const initializeOrder = async () => {
        
      try {
        let orderId = params.orderId;
        let token: string | null = null;

        // 1. Essayer depuis les params
        if (!orderId) {
          // 2. Essayer depuis le storage local
          orderId = await getCurrentOrderId() ?? undefined;
        }

        if (!orderId) {
          // 3. Essayer depuis l'API (commande active)
          console.log('[COURSE_EN_COURS] No orderId in params/storage, fetching active order from API');
          const activeOrderResponse = await getActiveOrder();
          if (activeOrderResponse.hasActiveOrder && activeOrderResponse.order) {
            orderId = activeOrderResponse.order.id;
            token = activeOrderResponse.clientToken || null;
            console.log('[COURSE_EN_COURS] Active order found:', orderId);
            if (orderId) {
              await setCurrentOrderId(orderId);
            }
            if (token) {
              await setClientToken(token);
            }
          } else {
            console.log('[COURSE_EN_COURS] No active order found');
          }
        } else {
          // Récupérer le token depuis le stockage
          token = await getClientToken();
          console.log('[COURSE_EN_COURS] OrderId from params/storage:', orderId, 'Token:', token ? 'present' : 'missing');
        }

        if (!orderId) {
          if (!mounted) return;
          globalInitialized = false;
          globalOrderId = null;
          Alert.alert('Erreur', 'Aucune commande active trouvée', [
            { text: 'OK', onPress: () => router.replace('/(client)') },
          ]);
          return;
        }

        // Récupérer les détails de la commande
        let orderData;
        try {
          orderData = await getOrder(orderId);
          // Mettre en cache la commande pour résilience en cas de perte de connexion
          if (cacheOrderFn) {
            await cacheOrderFn(orderData);
          }
        } catch (error) {
          // En cas d'erreur réseau, essayer de récupérer depuis le cache
          console.warn('Failed to fetch order, trying cache:', error);
          const cachedOrder = getCachedOrderFn ? await getCachedOrderFn() : null;
          if (cachedOrder && cachedOrder.id === orderId) {
            orderData = cachedOrder;
            console.log('Using cached order data');
          } else {
            throw error;
          }
        }
        if (!mounted) return;

        // Mettre à jour l'état
        globalOrderId = orderId; // Sauvegarder globalement
        setOrder(orderData);
        setClientTokenState(token);
        
        // Initialiser paidStopsCost depuis l'ordre si disponible
        if (orderData.paidStopsCost && orderData.paidStopsCost > 0) {
          console.log('[COURSE_EN_COURS] Initializing paidStopsCost from order:', orderData.paidStopsCost);
          setPaidStopsCost(orderData.paidStopsCost);
        }

        // Initialiser driverLocation si disponible dans l'order
        if (orderData.driver?.currentLocation) {
          console.log('[COURSE_EN_COURS] Initializing driverLocation from order', orderData.driver.currentLocation);
          setDriverLocation({
            lat: orderData.driver.currentLocation.lat,
            lng: orderData.driver.currentLocation.lng,
            heading: orderData.driver.currentLocation.heading,
          });
        } else {
          // Fallback: essayer de récupérer la position du chauffeur depuis l'API
          console.log('[COURSE_EN_COURS] No driver location in order, fetching from API...');
          try {
            const driverLocResponse = await getDriverLocation(orderId);
            if (driverLocResponse && (driverLocResponse as any).hasLocation !== false && driverLocResponse.lat && driverLocResponse.lng) {
              console.log('[COURSE_EN_COURS] Got driver location from API:', driverLocResponse);
              setDriverLocation({
                lat: driverLocResponse.lat,
                lng: driverLocResponse.lng,
                heading: driverLocResponse.heading || 0,
              });
            } else {
              console.log('[COURSE_EN_COURS] No driver location available yet from API');
            }
          } catch (locError) {
            console.log('[COURSE_EN_COURS] Could not fetch driver location:', locError);
          }
        }

        // Mapper le statut de la commande au statut de course
        const statusMap: Record<string, 'enroute' | 'arrived' | 'inprogress' | 'completed'> = {
          accepted: 'enroute',
          driver_enroute: 'enroute',
          driver_arrived: 'arrived',
          in_progress: 'inprogress',
          completed: 'completed',
          payment_pending: 'completed',
          payment_confirmed: 'completed',
        };
        const mappedStatus = (orderData.status && statusMap[orderData.status]) || 'enroute';
        
        // Si le statut est "arrived", initialiser le timer avec l'heure d'arrivée réelle
        if (mappedStatus === 'arrived') {
          console.log('[COURSE_EN_COURS] 🔍 Order data for arrived status:', {
            status: orderData.status,
            driverArrivedAt: orderData.driverArrivedAt,
            rideOption: orderData.rideOption
          });
          const arrivedAtDate = orderData.driverArrivedAt ? new Date(orderData.driverArrivedAt) : new Date();
          setArrivedAt(arrivedAtDate);
          const elapsedSeconds = Math.floor((Date.now() - arrivedAtDate.getTime()) / 1000);
          setWaitingTime(elapsedSeconds > 0 ? elapsedSeconds : 0);
          console.log('[COURSE_EN_COURS] ✅ Initialized arrived timer:', { 
            arrivedAt: arrivedAtDate.toISOString(), 
            elapsedSeconds,
            usingApiTimestamp: !!orderData.driverArrivedAt
          });
        }
        
        setRideStatus(mappedStatus);

        // Connecter Socket.IO et joindre la session (UNE SEULE FOIS par orderId)
        if (token && socketJoinedRef.current !== orderId) {
          socketJoinedRef.current = orderId;
          try {
            await connectSocketAsync();
            // Vérifier que le socket est connecté avant de joindre
            const socket = getSocket();
            if (socket.connected) {
              joinClientSession(orderId, token);
              joinRideRoom(orderId, 'client', { clientToken: token });
              console.log('[COURSE_EN_COURS] Socket connected and joined rooms for order:', orderId);
            } else {
              // Attendre la connexion
              socket.once('connect', () => {
                joinClientSession(orderId, token);
                joinRideRoom(orderId, 'client', { clientToken: token });
                console.log('[COURSE_EN_COURS] Socket connected after wait, joined rooms for order:', orderId);
              });
            }
          } catch (socketError) {
            console.error('Socket connection error:', socketError);
            socketJoinedRef.current = null; // Réessayer au prochain montage si erreur
            // Socket.IO va automatiquement reconnecter grâce à la configuration
          }
        } else if (token && socketJoinedRef.current === orderId) {
          console.log('[COURSE_EN_COURS] Socket already joined for this order, skipping');
        }
      } catch (error: any) {
        console.error('Error initializing order:', error);
        if (!mounted) return;
        globalInitialized = false;
        globalOrderId = null;
        Alert.alert('Erreur', error.message || 'Impossible de charger la commande', [
          { text: 'OK', onPress: () => router.replace('/(client)') },
        ]);
      } finally {
        // Ne PAS réinitialiser globalInitialized ici
        // Il sera réinitialisé seulement quand on quitte la page
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    initializeOrder();

    return () => {
      mounted = false;
    };
  }, []); // UNE SEULE FOIS au montage - NE JAMAIS SE REDÉCLENCHER

  // Les déconnexions Socket.IO sont gérées automatiquement par Socket.IO
  // Pas besoin de restaurer order depuis orderRef - Socket.IO va se reconnecter
  // et les listeners Socket.IO vont mettre à jour l'état

  // Récupérer les tarifs, suppléments et config frais de service pour le détail des prix
  useEffect(() => {
    const fetchTarifsAndSupplements = async () => {
      try {
        const [tarifsData, supplementsData, fraisConfig] = await Promise.all([
          apiFetch<any[]>(`/api/tarifs`).catch(() => []),
          apiFetch<any[]>(`/api/supplements`).catch(() => []),
          getFraisServiceConfig().catch(() => ({ fraisServicePrestataire: 15, commissionPrestataire: 0, commissionSalarieTapea: 0 })),
        ]);
        setTarifs(tarifsData || []);
        setSupplements(supplementsData || []);
        setFraisServicePercent(fraisConfig.fraisServicePrestataire);
        console.log('[COURSE_EN_COURS] Frais de service chargés:', fraisConfig.fraisServicePrestataire + '%');
      } catch (error) {
        console.error('[COURSE_EN_COURS] Error fetching tarifs/supplements:', error);
      }
    };

    // Ne charger qu'une seule fois, pas à chaque changement de order
    if (order?.id && tarifs.length === 0) {
      fetchTarifsAndSupplements();
    }
  }, [order?.id]); // Utiliser order?.id au lieu de order pour éviter les re-déclenchements

  // Suivi GPS du client (envoyer position au chauffeur)
  useEffect(() => {
    if (!order || !clientToken) return;

    const startLocationTracking = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          console.warn('Location permission not granted');
          return;
        }

        locationWatchRef.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced, // Optimisé pour la batterie
            timeInterval: 2500, // Envoyer position toutes les 2.5 secondes (optimisé)
            distanceInterval: 15, // Ou tous les 15 mètres (optimisé)
          },
          (location) => {
            const newLocation = {
              lat: location.coords.latitude,
              lng: location.coords.longitude,
            };
            
            // Calculer le heading basé sur le mouvement ou utiliser celui de la location
            let clientHeading = location.coords.heading || 0;
            if (lastClientLocationForHeading.current && !location.coords.heading) {
              // Calculer le heading depuis le mouvement
              clientHeading = calculateHeading(
                lastClientLocationForHeading.current.lat,
                lastClientLocationForHeading.current.lng,
                newLocation.lat,
                newLocation.lng
              );
            }
            
            // Si on a des coordonnées de route, calculer le heading depuis la route (uniquement quand inprogress)
            if (navigationMode && rideStatus === 'inprogress' && routeCoordinates.length > 1 && clientLocation) {
              // Trouver le point le plus proche sur la route
              let closestIndex = 0;
              let minDistance = Infinity;
              routeCoordinates.forEach((coord, index) => {
                const dist = Math.sqrt(
                  Math.pow(coord.latitude - newLocation.lat, 2) +
                  Math.pow(coord.longitude - newLocation.lng, 2)
                );
                if (dist < minDistance) {
                  minDistance = dist;
                  closestIndex = index;
                }
              });
              
              // Utiliser le prochain point sur la route pour calculer le heading
              if (closestIndex < routeCoordinates.length - 1) {
                const currentPoint = routeCoordinates[closestIndex];
                const nextPoint = routeCoordinates[closestIndex + 1];
                clientHeading = calculateHeading(
                  currentPoint.latitude,
                  currentPoint.longitude,
                  nextPoint.latitude,
                  nextPoint.longitude
                );
              }
            }
            
            setClientLocation({ ...newLocation, heading: clientHeading });
            lastClientLocationRef.current = newLocation;
            lastClientLocationForHeading.current = { ...newLocation, timestamp: Date.now() };

            // Envoyer position au chauffeur via Socket.IO
            if (order.id && clientToken) {
              emitClientLocation(order.id, clientToken, newLocation.lat, newLocation.lng);
            }

            // En mode navigation, mettre à jour la caméra pour suivre le client avec le bon heading (uniquement quand inprogress)
            // Ne pas forcer le zoom ni le centrage si l'utilisateur a bougé la carte
            // Animation throttlée pour éviter les tremblements
            const now = Date.now();
            const timeSinceLastAnimation = now - lastCameraAnimationTime.current;
            
            if (navigationMode && rideStatus === 'inprogress' && mapRef.current && !userMovedMap && !isAnimatingCamera.current && timeSinceLastAnimation >= CAMERA_ANIMATION_THROTTLE) {
              // Utiliser la position snappée si disponible, sinon la position réelle
              const clientPos = clientSnappedLocation || { lat: newLocation.lat, lng: newLocation.lng, heading: clientHeading };
              // Le heading pointe vers la direction du mouvement (pas inversé)
              const newCameraHeading = clientPos.heading || clientHeading;
              
              // Lisser le heading pour éviter les rotations brusques
              let smoothedHeading = newCameraHeading;
              if (lastCameraHeading.current !== 0) {
                // Calculer la différence angulaire la plus courte
                let diff = newCameraHeading - lastCameraHeading.current;
                if (diff > 180) diff -= 360;
                if (diff < -180) diff += 360;
                // Appliquer un lissage (50% vers la nouvelle direction)
                smoothedHeading = (lastCameraHeading.current + diff * 0.5 + 360) % 360;
              }
              lastCameraHeading.current = smoothedHeading;
              
              if (typeof mapRef.current.animateCamera === 'function') {
                isAnimatingCamera.current = true;
                lastCameraAnimationTime.current = now;
                
                mapRef.current.animateCamera({
                  center: { 
                    latitude: clientPos.lat, 
                    longitude: clientPos.lng 
                  },
                  pitch: 45, // Inclinaison réduite pour une meilleure vue
                  heading: smoothedHeading, // Heading lissé
                  altitude: 300, // Altitude plus haute pour une vue plus stable
                }, { duration: 1500 }); // Animation plus longue et fluide
                
                // Réinitialiser le flag après l'animation
                setTimeout(() => {
                  isAnimatingCamera.current = false;
                }, 1500);
              }
            }
          }
        );
      } catch (error) {
        console.error('Error starting location tracking:', error);
      }
    };

    startLocationTracking();

    return () => {
      if (locationWatchRef.current) {
        locationWatchRef.current.remove();
        locationWatchRef.current = null;
      }
    };
  }, [order?.id, clientToken]); // Utiliser order?.id au lieu de order pour éviter les re-déclenchements

  // Écouter l'assignation du chauffeur
  useEffect(() => {
    if (!order?.id) return;

    const unsubscribe = onDriverAssigned((data) => {
      if (data.orderId === order.id) {
        // Ne mettre à jour que si les données ont vraiment changé (évite les re-renders inutiles)
        setOrder(prevOrder => {
          if (!prevOrder) {
            // Si pas d'order, récupérer depuis l'API (mais ne pas le faire ici pour éviter les boucles)
            return prevOrder;
          }
          // Comparer les champs importants pour éviter les mises à jour inutiles
          if (prevOrder.id === data.orderId && 
              prevOrder.assignedDriverId === data.driverId &&
              prevOrder.status === 'accepted') {
            // Pas de changement significatif, ne pas mettre à jour
            return prevOrder;
          }
          // Si changement, mettre à jour avec les données du socket (pas besoin de refetch)
          return {
            ...prevOrder,
            assignedDriverId: data.driverId,
            status: 'accepted',
            // Garder le driver existant si disponible, sinon laisser undefined
            driver: prevOrder.driver || undefined
          };
        });
      }
    });

    return unsubscribe;
  }, [order?.id]); // Utiliser order?.id au lieu de order pour éviter les re-déclenchements

  // Écouter les changements de statut de course via Socket (réponse rapide)
  useEffect(() => {
    if (!order) return;

    const unsubscribe = onRideStatusChanged((data) => {
      const statusData = data as typeof data & {
        waitingTimeMinutes?: number | null;
        paidStopsCost?: number;
        newPaidStopsCost?: number;
      };
      if (data.orderId === order.id) {
        // Update price, driver earnings and waiting time if provided
        if (data.totalPrice !== undefined || statusData.waitingTimeMinutes !== undefined) {
          setOrder(prev => {
            if (!prev) return prev;
            
            // Si on reçoit paidStopsCost via socket, on met à jour l'état local
            if (statusData.paidStopsCost !== undefined) {
              setPaidStopsCost(statusData.paidStopsCost);
            } else if (statusData.newPaidStopsCost !== undefined) {
              setPaidStopsCost(statusData.newPaidStopsCost);
            }

            return { 
              ...prev, 
              totalPrice: data.totalPrice !== undefined ? (data.totalPrice as number) : prev.totalPrice, 
              driverEarnings: data.driverEarnings !== undefined ? (data.driverEarnings as number) : prev.driverEarnings,
              waitingTimeMinutes: statusData.waitingTimeMinutes !== undefined ? (statusData.waitingTimeMinutes as number) : prev.waitingTimeMinutes,
              rideOption: {
                ...prev.rideOption,
                paidStopsCost: statusData.paidStopsCost !== undefined ? statusData.paidStopsCost : 
                               statusData.newPaidStopsCost !== undefined ? statusData.newPaidStopsCost : 
                               (prev.rideOption as any)?.paidStopsCost
              }
            };
          });
        }

        // Mapper le statut reçu du backend au statut de course
        const statusMap: Record<string, 'enroute' | 'arrived' | 'inprogress' | 'completed'> = {
          accepted: 'enroute',
          driver_enroute: 'enroute',
          enroute: 'enroute',
          driver_arrived: 'arrived',
          arrived: 'arrived',
          in_progress: 'inprogress',
          inprogress: 'inprogress',
          completed: 'completed',
          payment_pending: 'completed',
          payment_confirmed: 'completed',
        };
        // Utiliser data.status ou data.orderStatus pour le mapping
        const statusToMap = data.status || data.orderStatus;
        let mappedStatus: 'enroute' | 'arrived' | 'inprogress' | 'completed';
        
        if (statusToMap && statusMap[statusToMap]) {
          mappedStatus = statusMap[statusToMap];
        } else {
          // Fallback vers le statut actuel si aucun mapping ne fonctionne
          console.warn('[Client Course] ⚠️ Statut non mappé:', statusToMap, '-> garde statut actuel');
          return; // Ne pas changer le statut si on ne peut pas le mapper
        }
        
        console.log('[Client Course] ⚡ Status changed via Socket:', statusToMap, '->', mappedStatus);
        
        // Gérer le timer d'attente en utilisant la ref pour éviter les stale closures
        const previousStatus = lastKnownStatusRef.current;
        
        if (mappedStatus === 'arrived' && previousStatus !== 'arrived') {
          // Le chauffeur vient d'arriver, démarrer le timer
          console.log('[COURSE_EN_COURS] 🚗 Driver arrived event received:', {
            driverArrivedAt: data.driverArrivedAt,
            statusTimestamp: data.statusTimestamp,
            previousStatus
          });
          const arrivedTimestamp = data.driverArrivedAt || data.statusTimestamp || new Date().toISOString();
          const arrivedDate = new Date(arrivedTimestamp);
          
          // Ne mettre à jour que si on n'a pas déjà un temps d'arrivée
          // OU si celui du serveur est explicitement fourni (source de vérité)
          if (!arrivedAt || data.driverArrivedAt) {
            const currentArrivedAt = arrivedAt ? arrivedAt.getTime() : 0;
            const newArrivedAt = arrivedDate.getTime();
            
            // On ne remplace que si la différence est significative (> 5s)
            // ou si on n'avait rien localement
            if (!currentArrivedAt || Math.abs(currentArrivedAt - newArrivedAt) > 5000 || data.driverArrivedAt) {
              setArrivedAt(arrivedDate);
              
              // Calculer le temps déjà écoulé pour la synchro immédiate
              const elapsedSeconds = Math.floor((Date.now() - arrivedDate.getTime()) / 1000);
              setWaitingTime(elapsedSeconds > 0 ? elapsedSeconds : 0);
              console.log('[COURSE_EN_COURS] ⏱️ Timer started/synced:', {
                arrivedAt: arrivedDate.toISOString(),
                elapsedSeconds,
                usingSocketTimestamp: !!data.driverArrivedAt
              });
            }
          }
          
          // Mettre à jour l'ordre avec l'heure d'arrivée si disponible
          if (data.driverArrivedAt && order) {
            setOrder({ ...order, driverArrivedAt: data.driverArrivedAt });
          }
        } else if (mappedStatus === 'inprogress' && previousStatus === 'arrived') {
          // Le chauffeur a démarré la course
          if (arrivedAt) {
            // Calculer le temps d'attente final et l'envoyer au serveur
            const elapsedSeconds = Math.floor((Date.now() - arrivedAt.getTime()) / 1000);
            const elapsedMinutes = Math.floor(elapsedSeconds / 60);
            // Envoyer le temps d'attente au serveur uniquement s'il est valide (> 0)
            // Le serveur accepte maintenant 0, mais on évite les requêtes inutiles
            if (order?.id && elapsedMinutes >= 0) {
              updateOrderWaitingTime(order.id, elapsedMinutes).catch(err => {
                // Ne pas logger les erreurs 400 (temps invalide) pour éviter le spam
                if (err instanceof apiModule.ApiError && err.status !== 400) {
                  console.error('[COURSE_EN_COURS] Erreur lors de la mise à jour du temps d\'attente:', err);
                }
              });
            }
            setArrivedAt(null);
          }
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // FRAIS DE SERVICE OFFERTS: Vérifier si les frais sont offerts (indépendant du statut précédent)
        // ═══════════════════════════════════════════════════════════════════════════
        const extendedData = data as typeof data & { fraisServiceOfferts?: boolean };
        if (extendedData.fraisServiceOfferts === true && mappedStatus === 'inprogress' && order) {
          // Calculer l'économie : prix initial (avec frais service) vs prix actuel (sans frais service)
          const initialPrice = (order.rideOption as any)?.initialTotalPrice || Math.round((data.totalPrice || order.totalPrice) * (1 + fraisServicePercent / 100));
          const nouveauPrix = data.totalPrice || order.totalPrice;
          const economie = initialPrice - nouveauPrix;
          
          if (economie > 0) {
            console.log('[COURSE_EN_COURS] 🎁 Frais de service offerts détectés au démarrage!', {
              ancienPrix: initialPrice,
              nouveauPrix,
              economie
            });
            
            setFraisOffertsData({
              ancienPrix: initialPrice,
              nouveauPrix: nouveauPrix,
              economie: economie,
            });
            setShowFraisOffertsModal(true);
          }
        }
        
        // Mettre à jour le statut seulement s'il a vraiment changé
        if (lastKnownStatusRef.current !== mappedStatus) {
          lastKnownStatusRef.current = mappedStatus;
          setRideStatus(mappedStatus);
        } else {
          console.log('[COURSE_EN_COURS] Status unchanged, skipping update:', mappedStatus);
        }
        
        // IMPORTANT: Déclencher le popup de paiement si le statut est payment_confirmed
        // Vérifier aussi data.orderStatus car le type de data.status est restreint
        const orderStatusStr = data.orderStatus as string;
        if (orderStatusStr === 'payment_confirmed') {
          // Utiliser les refs pour éviter les closures stale
          // Ne pas afficher si le flow de paiement est déjà terminé (notation faite)
          if (paymentFlowCompletedRef.current) {
            console.log('[PAYMENT] ✅ Payment confirmed via ride:status:changed but flow already completed (ref), skipping');
            return;
          }
          // Ne pas afficher si le popup est déjà visible
          if (showPaymentResultRef.current) {
            console.log('[PAYMENT] ✅ Payment confirmed via ride:status:changed but popup already visible (ref), skipping');
            return;
          }
          console.log('[PAYMENT] ✅ Payment confirmed detected via ride:status:changed - showing popup');
          setOrder(prev => prev ? { ...prev, status: 'payment_confirmed' } : prev);
          
          // Toujours mettre à jour le paymentResult et afficher le popup
          setPaymentResult({
            status: 'success',
            amount: data.totalPrice || order?.totalPrice || 0,
            paymentMethod: order?.paymentMethod || 'cash',
            cardBrand: null,
            cardLast4: null,
            paidStopsCost: data.paidStopsCost || (order?.rideOption as any)?.paidStopsCost || 0,
            supplements: order?.supplements || [],
          });
          setShowPaymentResult(true);
          setPaymentFlowCompleted(false);
        }
      }
    });

    return unsubscribe;
  }, [order?.id]); // Ne dépendre que de order.id pour éviter les réinscriptions multiples

  // Synchroniser la ref avec le state rideStatus
  useEffect(() => {
    lastKnownStatusRef.current = rideStatus;
  }, [rideStatus]);

  // Synchroniser les refs avec les states pour les callbacks socket
  useEffect(() => {
    paymentFlowCompletedRef.current = paymentFlowCompleted;
  }, [paymentFlowCompleted]);
  
  useEffect(() => {
    showPaymentResultRef.current = showPaymentResult;
  }, [showPaymentResult]);

  // Réinitialiser les flags de blocage quand on change de commande
  // Note: Ne PAS réinitialiser showPaymentResult/paymentResult ici car le fallback useEffect s'en occupe
  const lastResetOrderIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!order?.id) return;
    // Ne réinitialiser que si c'est vraiment une nouvelle commande (pas juste un re-render)
    if (lastResetOrderIdRef.current === order.id) return;
    
    console.log('[PAYMENT] New order detected, resetting payment flags for order:', order.id);
    lastResetOrderIdRef.current = order.id;
    setPaymentPopupDismissed(false);
    setPaymentFlowCompleted(false);
    // Ne PAS réinitialiser showPaymentResult et paymentResult ici
    // Le fallback useEffect s'en occupera quand le statut sera payment_confirmed
  }, [order?.id]);

  // Réinitialiser le blocage quand on change de commande ou de statut
  useEffect(() => {
    if (!order?.id) return;
    if (order.status !== 'payment_confirmed') {
      setPaymentPopupDismissed(false);
    }
  }, [order?.id, order?.status]);

  // ═══════════════════════════════════════════════════════════════════════════
  // ⚠️ STABLE v1.0 - GESTION ARRÊT PAYANT CLIENT - NE PAS MODIFIER SANS DEMANDE
  // Ce useEffect gère l'affichage du popup d'arrêt payant côté client.
  // - Synchronisé avec le chauffeur via Socket.IO (paid:stop:started/ended)
  // - Timer local avec requestAnimationFrame pour affichage fluide
  // - Utilise totalCost du chauffeur comme source de vérité
  // - Polling de secours toutes les 2s pour synchronisation
  // - Gestion des doublons via lastStartTime/lastEndTime
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Note: Le coût d'arrêt payant est maintenant géré uniquement via onPaidStopEnded
  // pour éviter les doublons (l'événement paid:stop:cost:updated n'est plus utilisé)

  // Écouter le début d'un arrêt payant (lancé par le chauffeur)
  useEffect(() => {
    if (!order?.id) return;

    const PAID_STOP_RATE = 42;

    // Fonction pour démarrer le timer local
    const startLocalTimer = (startTime: number, accumulatedSeconds: number) => {
      console.log('[COURSE_EN_COURS] Starting local timer, startTime:', startTime, 'accumulated:', accumulatedSeconds);
      
      paidStopAccumulatedRef.current = accumulatedSeconds;
      paidStopStartTimeRef.current = startTime;
      showPaidStopModalRef.current = true;
      
      setShowPaidStopModal(true);
      
      // Calculer le temps déjà écoulé depuis le début de l'arrêt
      const elapsedSinceStart = Math.floor((Date.now() - startTime) / 1000);
      const totalSeconds = accumulatedSeconds + elapsedSinceStart;
      
      setPaidStopDisplaySeconds(totalSeconds);
      setPaidStopTotalCost(Math.floor(totalSeconds / 60) * PAID_STOP_RATE);
      
      // Arrêter l'ancien timer s'il existe
      if (paidStopAnimationRef.current) {
        cancelAnimationFrame(paidStopAnimationRef.current);
      }
      
      // Démarrer le timer local (synchronisé avec le chauffeur)
      const updateTimer = () => {
        const sTime = paidStopStartTimeRef.current;
        if (!sTime) return;
        
        const currentTime = Date.now();
        const elapsedMs = currentTime - sTime;
        const currentSeconds = Math.floor(elapsedMs / 1000);
        const total = paidStopAccumulatedRef.current + currentSeconds;
        
        setPaidStopDisplaySeconds(total);
        setPaidStopTotalCost(Math.floor(total / 60) * PAID_STOP_RATE);
        
        paidStopAnimationRef.current = requestAnimationFrame(updateTimer);
      };
      
      paidStopAnimationRef.current = requestAnimationFrame(updateTimer);
    };

    // Vérifier au chargement s'il y a un arrêt payant actif (pour la reconnexion)
    const checkActivePaidStop = async () => {
      try {
        const response = await apiFetch<{ active: boolean; startTime?: number; accumulatedSeconds?: number }>(
          `/api/orders/${order.id}/paid-stop/status`
        );
        
        if (response.active && response.startTime !== undefined && response.accumulatedSeconds !== undefined) {
          console.log('[COURSE_EN_COURS] ✅ Found active paid stop, resuming timer');
          startLocalTimer(response.startTime, response.accumulatedSeconds);
        }
      } catch (error) {
        console.log('[COURSE_EN_COURS] No active paid stop or error checking:', error);
      }
    };
    
    checkActivePaidStop();

    // Fonction pour fermer le modal proprement
    const closeModal = () => {
      console.log('[COURSE_EN_COURS] Closing paid stop modal');
      if (paidStopAnimationRef.current) {
        cancelAnimationFrame(paidStopAnimationRef.current);
        paidStopAnimationRef.current = null;
      }
      setShowPaidStopModal(false);
      showPaidStopModalRef.current = false;
      paidStopStartTimeRef.current = null;
    };

    // Ref pour éviter les doublons (le serveur peut envoyer l'événement via room ET directement)
    let lastStartTime: number | null = null;
    let lastEndTime: number | null = null;
    
    const unsubscribeStart = onPaidStopStarted((data) => {
      if (data.orderId === order.id) {
        // Éviter les doublons basés sur le startTime
        if (lastStartTime === data.startTime) {
          console.log('[COURSE_EN_COURS] ⚠️ Duplicate paid:stop:started ignored');
          return;
        }
        lastStartTime = data.startTime;
        
        console.log('[COURSE_EN_COURS] ✅ Paid stop STARTED by driver');
        showPaidStopModalRef.current = true;
        startLocalTimer(data.startTime, data.accumulatedSeconds);
      }
    });

    const unsubscribeEnd = onPaidStopEnded((data) => {
      if (data.orderId === order.id) {
        // Éviter les doublons basés sur newAccumulatedSeconds (unique par arrêt)
        const endKey = data.newAccumulatedSeconds ?? Date.now();
        if (lastEndTime === endKey) {
          console.log('[COURSE_EN_COURS] ⚠️ Duplicate paid:stop:ended ignored');
          return;
        }
        lastEndTime = endKey;
        
        console.log('[COURSE_EN_COURS] ✅ Paid stop ENDED by driver, cost:', data.cost, 'XPF, totalCost:', data.totalCost, 'XPF');
        
        // Mettre à jour le temps accumulé depuis le serveur si disponible
        if (data.newAccumulatedSeconds !== undefined) {
          paidStopAccumulatedRef.current = data.newAccumulatedSeconds;
        } else if (paidStopStartTimeRef.current) {
          const elapsedSeconds = Math.floor((Date.now() - paidStopStartTimeRef.current) / 1000);
          paidStopAccumulatedRef.current += elapsedSeconds;
        }
        
        // Mettre à jour le coût total des arrêts payants
        // Utiliser totalCost si disponible (plus fiable), sinon additionner
        if (data.totalCost !== undefined && data.totalCost > 0) {
          // Utiliser directement le totalCost du chauffeur (= source de vérité)
          setPaidStopsCost(data.totalCost);
          console.log('[COURSE_EN_COURS] Using totalCost from driver:', data.totalCost, 'XPF');
        } else if (data.cost && data.cost > 0) {
          // Fallback: additionner le coût individuel
          setPaidStopsCost(prev => prev + data.cost);
        }
        
        // Fermer le modal
        closeModal();
      }
    });

    // Polling de secours toutes les 2 secondes pour synchroniser l'état du popup
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    pollInterval = setInterval(async () => {
      try {
        const response = await apiFetch<{ active: boolean; startTime?: number; accumulatedSeconds?: number }>(
          `/api/orders/${order.id}/paid-stop/status`
        );
        
        const modalIsShowing = showPaidStopModalRef.current;
        
        // Si arrêt actif sur serveur mais pas de modal affiché -> ouvrir
        if (response.active && response.startTime !== undefined && response.accumulatedSeconds !== undefined) {
          if (!modalIsShowing) {
            console.log('[COURSE_EN_COURS] 🔄 Polling detected active paid stop, opening modal');
            showPaidStopModalRef.current = true;
            startLocalTimer(response.startTime, response.accumulatedSeconds);
          }
        }
        // Si pas d'arrêt actif sur serveur mais modal affiché -> fermer ET mettre à jour le coût
        else if (!response.active && modalIsShowing) {
          console.log('[COURSE_EN_COURS] 🔄 Polling detected paid stop ended, closing modal and updating cost');
          
          // Récupérer l'ordre mis à jour pour avoir le nouveau prix total
          try {
            const updatedOrder = await getOrder(order.id);
            if (updatedOrder) {
              // Calculer le coût des arrêts payants = totalPrice actuel - prix de base
              // Note: Le backend ajoute le coût des arrêts au totalPrice
              const basePrice = 1000 + (updatedOrder.routeInfo?.distance || 0) * 160;
              const newPaidStopsCost = Math.max(0, (updatedOrder.totalPrice || 0) - basePrice);
              
              if (newPaidStopsCost > 0) {
                console.log('[COURSE_EN_COURS] 🔄 Polling: updating paidStopsCost from order:', newPaidStopsCost, 'XPF');
                setPaidStopsCost(newPaidStopsCost);
              }
              
              // Mettre à jour l'ordre local avec les nouvelles données
              // S'assurer que rideOption contient bien paidStopsCost
              const orderWithPaidStops = {
                ...updatedOrder,
                rideOption: {
                  ...updatedOrder.rideOption,
                  paidStopsCost: newPaidStopsCost
                }
              };
              setOrder(orderWithPaidStops);
            }
          } catch (orderError) {
            console.log('[COURSE_EN_COURS] 🔄 Could not fetch updated order:', orderError);
          }
          
          closeModal();
        }
      } catch (error) {
        // Ignorer les erreurs de polling
      }
    }, 2000);

    return () => {
      unsubscribeStart();
      unsubscribeEnd();
      if (paidStopAnimationRef.current) {
        cancelAnimationFrame(paidStopAnimationRef.current);
      }
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [order?.id]);

  // ═══════════════════════════════════════════════════════════════════════════
  // FRAIS DE SERVICE OFFERTS: Écouter quand un salarié TAPEA accepte la course
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!order?.id) return;

    const unsubscribeFraisOfferts = onFraisServiceOfferts((data) => {
      if (data.orderId === order.id) {
        console.log('[COURSE_EN_COURS] 🎉 Frais de service offerts !', data);
        setFraisOffertsData({
          ancienPrix: data.ancienPrix,
          nouveauPrix: data.nouveauPrix,
          economie: data.economie,
        });
        setShowFraisOffertsModal(true);
        
        // Mettre à jour le prix de la commande localement
        setOrder(prev => prev ? {
          ...prev,
          totalPrice: data.nouveauPrix,
        } : prev);
      }
    });

    return () => {
      unsubscribeFraisOfferts();
    };
  }, [order?.id]);

  // ═══════════════════════════════════════════════════════════════════════════
  // FRAIS DE SERVICE OFFERTS: Vérifier au chargement si des frais ont été stockés
  // (depuis la page recherche-chauffeur quand l'événement a été reçu pendant la navigation)
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!order?.id) return;

    const checkStoredFraisOfferts = async () => {
      try {
        const storedData = await AsyncStorage.getItem(`frais_offerts_${order.id}`);
        if (storedData) {
          const data = JSON.parse(storedData);
          // Vérifier que les données ne sont pas trop vieilles (moins de 60 secondes)
          if (Date.now() - data.timestamp < 60000) {
            console.log('[COURSE_EN_COURS] 🎉 Frais de service offerts récupérés depuis AsyncStorage!', data);
            setFraisOffertsData({
              ancienPrix: data.ancienPrix,
              nouveauPrix: data.nouveauPrix,
              economie: data.economie,
            });
            setShowFraisOffertsModal(true);
            
            // Mettre à jour le prix de la commande localement
            setOrder(prev => prev ? {
              ...prev,
              totalPrice: data.nouveauPrix,
            } : prev);
          }
          // Supprimer les données après utilisation
          await AsyncStorage.removeItem(`frais_offerts_${order.id}`);
        }
      } catch (e) {
        console.error('[COURSE_EN_COURS] Erreur récupération frais offerts:', e);
      }
    };

    // Vérifier après un court délai pour laisser le temps au composant de se charger
    const timer = setTimeout(checkStoredFraisOfferts, 500);
    return () => clearTimeout(timer);
  }, [order?.id]);

  // Fonction pour formater le temps d'arrêt
  const formatPaidStopTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Écouter les mises à jour de position du chauffeur via Socket
  useEffect(() => {
    if (!order) {
      console.log('[COURSE_EN_COURS] No order yet, skipping driver location listener setup');
      return;
    }

    console.log('[COURSE_EN_COURS] Setting up driver location listener for order:', order.id);
    
    const unsubscribe = onDriverLocationUpdate((data: LocationUpdate) => {
      console.log('[COURSE_EN_COURS] Driver location event received:', data);
      if (data.orderId === order.id) {
        console.log('[COURSE_EN_COURS] ✅ Driver location update MATCHED order, updating state:', data);
        setDriverLocation({
          lat: data.lat,
          lng: data.lng,
          heading: data.heading,
        });
      } else {
        console.log('[COURSE_EN_COURS] ⚠️ Driver location orderId mismatch:', data.orderId, '!=', order.id);
      }
    });

    return () => {
      console.log('[COURSE_EN_COURS] Cleaning up driver location listener');
      unsubscribe();
    };
  }, [order?.id]);

  // POLLING HTTP DE FALLBACK pour les changements de statut (au cas où Socket.IO ne fonctionne pas)
  useEffect(() => {
    if (!order?.id) return;
    
    let mounted = true;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    
    const pollOrderStatus = async () => {
      if (!mounted || !order?.id) return;
      
      try {
        const response = await apiFetch<OrderDetailsResponse>(`/api/orders/${order.id}`);
        if (!mounted) return;
        
        // Mapper le statut du serveur au statut de course
        const statusMap: Record<string, 'enroute' | 'arrived' | 'inprogress' | 'completed'> = {
          accepted: 'enroute',
          driver_enroute: 'enroute',
          driver_arrived: 'arrived',
          in_progress: 'inprogress',
          completed: 'completed',
          payment_pending: 'completed',
          payment_confirmed: 'completed',
        };
        
        const serverStatus = response.status;
        const mappedStatus = statusMap[serverStatus];
        
        if (mappedStatus && mappedStatus !== lastKnownStatusRef.current) {
          console.log('[COURSE_EN_COURS] 🔄 Polling detected status change:', serverStatus, '->', mappedStatus);
          
          // Gérer le timer d'attente
          const previousStatus = lastKnownStatusRef.current;
          if (mappedStatus === 'arrived' && previousStatus !== 'arrived') {
            const apiArrivedAt = (response as any).driverArrivedAt || (response.rideOption as any)?.driverArrivedAt;
            const arrivedDate = apiArrivedAt ? new Date(apiArrivedAt) : new Date();
            setArrivedAt(arrivedDate);
            const elapsed = Math.floor((Date.now() - arrivedDate.getTime()) / 1000);
            setWaitingTime(elapsed > 0 ? elapsed : 0);
          } else if (mappedStatus === 'inprogress' && previousStatus === 'arrived') {
            if (arrivedAt) {
              const elapsedSeconds = Math.floor((Date.now() - arrivedAt.getTime()) / 1000);
              const elapsedMinutes = Math.floor(elapsedSeconds / 60);
              if (order?.id && elapsedMinutes >= 0) {
                updateOrderWaitingTime(order.id, elapsedMinutes).catch(() => {});
              }
              setArrivedAt(null);
            }
          }
          
          lastKnownStatusRef.current = mappedStatus;
          setRideStatus(mappedStatus);
        }
        
        // ✅ IMPORTANT: Mettre à jour order.status si le serveur renvoie payment_confirmed
        // Cela permet au fallback useEffect d'afficher le popup de confirmation
        if (serverStatus === 'payment_confirmed' && order.status !== 'payment_confirmed') {
          console.log('[COURSE_EN_COURS] 🔄 Polling detected payment_confirmed, updating order.status');
          setOrder(prev => prev ? { ...prev, status: 'payment_confirmed' } : prev);
        }
        
        // ✅ IMPORTANT: Mettre à jour le prix et le temps d'attente depuis le serveur
        // Cela garantit que le prix s'actualise même si le socket ne fonctionne pas
        setOrder(prev => {
          if (!prev) return prev;
          
          // Ne mettre à jour que si les valeurs ont changé
          const priceChanged = response.totalPrice !== prev.totalPrice;
          const waitingChanged = response.waitingTimeMinutes !== prev.waitingTimeMinutes;
          const paidStopsChanged = (response.rideOption as any)?.paidStopsCost !== (prev.rideOption as any)?.paidStopsCost;
          
          if (!priceChanged && !waitingChanged && !paidStopsChanged) {
            return prev;
          }
          
          console.log('[COURSE_EN_COURS] 🔄 Polling: updating order data:', {
            totalPrice: response.totalPrice,
            waitingTimeMinutes: response.waitingTimeMinutes,
            paidStopsCost: (response.rideOption as any)?.paidStopsCost
          });
          
          // Mettre à jour paidStopsCost local si présent
          const newPaidStopsCost = (response.rideOption as any)?.paidStopsCost;
          if (newPaidStopsCost !== undefined && newPaidStopsCost !== paidStopsCostRef.current) {
            setPaidStopsCost(newPaidStopsCost);
          }
          
          const apiDriverArrivedAt = (response as any).driverArrivedAt ?? (response.rideOption as any)?.driverArrivedAt;
          return {
            ...prev,
            totalPrice: response.totalPrice ?? prev.totalPrice,
            driverEarnings: response.driverEarnings ?? prev.driverEarnings,
            waitingTimeMinutes: response.waitingTimeMinutes ?? prev.waitingTimeMinutes,
            driverArrivedAt: apiDriverArrivedAt ?? prev.driverArrivedAt,
            rideOption: {
              ...prev.rideOption,
              paidStopsCost: newPaidStopsCost ?? (prev.rideOption as any)?.paidStopsCost
            }
          };
        });
        
        // Mettre à jour la position du chauffeur depuis le serveur si disponible
        const driverWithLocation = response.driver as any;
        if (driverWithLocation?.currentLocation) {
          const loc = driverWithLocation.currentLocation;
          if (loc.lat && loc.lng) {
            setDriverLocation({
              lat: loc.lat,
              lng: loc.lng,
              heading: loc.heading,
            });
          }
        } else {
          // Fallback: récupérer la position du chauffeur depuis l'API dédiée
          try {
            const driverLocResponse = await getDriverLocation(order.id);
            if (driverLocResponse && (driverLocResponse as any).hasLocation !== false && driverLocResponse.lat && driverLocResponse.lng) {
              setDriverLocation({
                lat: driverLocResponse.lat,
                lng: driverLocResponse.lng,
                heading: driverLocResponse.heading || 0,
              });
            }
          } catch {
            // Silently ignore
          }
        }
      } catch (error) {
        // Silently ignore polling errors
        console.log('[COURSE_EN_COURS] Polling error (silent):', error);
      }
    };
    
    // Démarrer le polling après 5 secondes (laisser Socket.IO une chance de fonctionner d'abord)
    const startTimeout = setTimeout(() => {
      if (mounted) {
        console.log('[COURSE_EN_COURS] 🔄 Starting status polling as fallback');
        pollOrderStatus(); // Premier poll immédiat
        pollInterval = setInterval(pollOrderStatus, 5000); // Puis toutes les 5 secondes
      }
    }, 5000);
    
    return () => {
      mounted = false;
      clearTimeout(startTimeout);
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [order?.id, arrivedAt]);

  // Suivre le chauffeur avec la caméra en mode navigation quand il est en route (sans inclinaison)
  // Ne pas forcer le zoom si l'utilisateur a bougé la carte
  // Animation throttlée pour éviter les tremblements
  useEffect(() => {
    if (!navigationMode || rideStatus !== 'enroute' || !driverSnappedLocation || !mapRef.current) return;
    // Ne pas suivre automatiquement si l'utilisateur a bougé la carte
    if (userMovedMap) return;
    
    // Throttle: ne pas animer si une animation est en cours ou si trop récent
    const now = Date.now();
    if (isAnimatingCamera.current || (now - lastCameraAnimationTime.current) < CAMERA_ANIMATION_THROTTLE) return;

    // Utiliser la position snappée et son heading
    const driverHeading = driverSnappedLocation.heading || 0;

    // Mettre à jour la caméra pour suivre le chauffeur avec le bon heading (sans inclinaison)
    // Ne pas forcer le zoom - garder le zoom actuel de l'utilisateur
    if (typeof mapRef.current.animateCamera === 'function') {
      isAnimatingCamera.current = true;
      lastCameraAnimationTime.current = now;
      
      mapRef.current.animateCamera({
        center: { 
          latitude: driverSnappedLocation.lat, 
          longitude: driverSnappedLocation.lng 
        },
        pitch: 0, // Pas d'inclinaison pour enroute
        heading: driverHeading, // Utiliser le heading du chauffeur pour orienter la vue
        // Ne pas forcer le zoom - garder le zoom actuel
      }, { duration: 1500 }); // Animation plus longue et fluide
      
      setTimeout(() => {
        isAnimatingCamera.current = false;
      }, 1500);
    }
  }, [navigationMode, rideStatus, driverSnappedLocation, userMovedMap]);

  // POLLING HTTP SUPPRIMÉ - Utilisation uniquement de Socket.IO pour les mises à jour en temps réel

  // Timer d'attente quand le chauffeur est arrivé
  useEffect(() => {
    if (rideStatus === 'arrived' && arrivedAt) {
      const interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - arrivedAt.getTime()) / 1000);
        setWaitingTime(elapsed);
      }, 1000);

      return () => clearInterval(interval);
    } else {
      setWaitingTime(0);
    }
  }, [rideStatus, arrivedAt]);

  // Écouter les statuts de paiement
  useEffect(() => {
    if (!order) return;

    const unsubscribe = onPaymentStatus((data) => {
      console.log('[PAYMENT] Received payment:status event:', data);
      if (data.orderId === order.id) {
        // IMPORTANT: Côté client, on ne montre JAMAIS d'erreur de paiement
        // Seuls les succès sont affichés. En cas de problème, le chauffeur annulera la course.
        if (data.status === 'payment_confirmed') {
          // Utiliser les refs pour éviter les closures stale
          // Ne pas afficher si le flow de paiement est déjà terminé (notation faite)
          if (paymentFlowCompletedRef.current) {
            console.log('[PAYMENT] ✅ Payment confirmed but flow already completed (ref), skipping popup');
            return;
          }
          // Ne pas afficher si le popup est déjà visible
          if (showPaymentResultRef.current) {
            console.log('[PAYMENT] ✅ Payment confirmed but popup already visible (ref), skipping');
            return;
          }
          console.log('[PAYMENT] ✅ Payment confirmed - showing popup');
          
          // Mettre à jour le statut de la commande locale
          setOrder(prev => prev ? { ...prev, status: 'payment_confirmed' } : prev);
          
          setPaymentResult({
            status: 'success',
            amount: data.amount || order.totalPrice,
            paymentMethod: (data.paymentMethod as 'card' | 'cash') || order.paymentMethod,
            cardBrand: data.cardBrand,
            cardLast4: data.cardLast4,
            paidStopsCost: (order.rideOption as any)?.paidStopsCost || 0,
            supplements: order.supplements || [],
          });
          setShowPaymentResult(true);
          setPaymentFlowCompleted(false);
        }
        // On ignore payment_failed - le chauffeur gère cela de son côté
      }
    });

    return unsubscribe;
  }, [order?.id]); // Utiliser order?.id au lieu de order pour éviter les re-déclenchements

  // Fallback: afficher le popup si le statut est payment_confirmed mais qu'il n'est pas encore affiché
  useEffect(() => {
    if (order?.status !== 'payment_confirmed') return;
    // Ne pas afficher si le flow de paiement est déjà terminé (notation faite)
    if (paymentFlowCompleted) return;
    // Ne pas afficher si le popup a déjà été fermé (on attend la notation)
    if (paymentPopupDismissed) return;
    // Ne pas afficher si le popup est déjà visible
    if (showPaymentResult) return;
    
    console.log('[PAYMENT] ✅ Order status is payment_confirmed - showing popup via fallback');
    setPaymentResult({
      status: 'success',
      amount: order.totalPrice,
      paymentMethod: order.paymentMethod,
      cardBrand: null,
      cardLast4: null,
      paidStopsCost: (order.rideOption as any)?.paidStopsCost || 0,
      supplements: order.supplements || [],
    });
    setShowPaymentResult(true);
  }, [order?.status, paymentFlowCompleted, paymentPopupDismissed, showPaymentResult]);

  // Polling HTTP de backup pour le statut de paiement (au cas où le socket rate l'événement)
  useEffect(() => {
    if (!order?.id || !clientToken) return;
    // Ne pas faire le polling si le flow de paiement est terminé (notation faite)
    if (paymentFlowCompleted) return;
    // Ne pas faire le polling si le popup a déjà été fermé (on attend la notation)
    if (paymentPopupDismissed) return;
    // Ne pas faire le polling si le popup est déjà affiché
    if (showPaymentResult) return;
    // Ne pas faire le polling si le statut est déjà payment_confirmed (le useEffect précédent s'en occupe)
    if (order.status === 'payment_confirmed') return;
    // Faire le polling si le statut est in_progress, completed, ou payment_pending (en attente de confirmation)
    const statusesForPolling = ['in_progress', 'completed', 'payment_pending'];
    if (!statusesForPolling.includes(order.status)) return;

    const checkPaymentStatus = async () => {
      try {
        const freshOrder = await getOrder(order.id);
        if (freshOrder?.status === 'payment_confirmed') {
          console.log('[PAYMENT] ✅ Payment confirmed detected via HTTP polling');
          setOrder(prev => prev ? { ...prev, status: 'payment_confirmed' } : prev);
          // Le useEffect précédent s'occupera d'afficher le popup
        }
      } catch (error) {
        console.error('[PAYMENT] Error checking payment status:', error);
      }
    };

    // Vérifier toutes les 3 secondes pour une meilleure réactivité
    const interval = setInterval(checkPaymentStatus, 3000);
    return () => clearInterval(interval);
  }, [order?.id, order?.status, clientToken, paymentFlowCompleted, paymentPopupDismissed, showPaymentResult]);

  // Écouter les annulations via Socket + Polling backup
  useEffect(() => {
    if (!order) return;
    let isCancelled = false;

    const handleCancellation = async (cancelledBy: 'driver' | 'client') => {
      if (isCancelled) return; // Éviter les doubles alertes
      isCancelled = true;
      
      const message = cancelledBy === 'driver'
        ? 'Course annulée par le chauffeur.\n\nContactez-nous pour plus d\'infos.'
        : 'La course a été annulée.';
      
      Alert.alert(
        'Course annulée',
        message,
        [
          {
            text: 'OK',
            onPress: async () => {
              try {
                try { await removeClientToken(); } catch (e) { console.log('Error:', e); }
                try { await removeCurrentOrderId(); } catch (e) { console.log('Error:', e); }
                // Nettoyer la connexion Socket pour cet ordre spécifique
                if (order?.id) {
                  try { cleanupOrderConnection(order.id); } catch (e) { console.log('Error:', e); }
                }
                try { disconnectSocket(); } catch (e) { console.log('Error:', e); }
              } catch (error) {
                console.log('Error in cancellation cleanup:', error);
              } finally {
                globalInitialized = false;
                globalOrderId = null;
                socketJoinedRef.current = null;
                router.replace('/(client)');
              }
            },
          },
        ]
      );
    };

    // Écouter via Socket.IO
    const unsubscribe = onRideCancelled((data) => {
      if (data.orderId === order.id) {
        handleCancellation(data.cancelledBy);
        if (order?.id) {
          endLiveActivity(order.id, { status: 'cancelled' }).catch(() => {});
          liveActivityStartedRef.current = false;
        }
      }
    });

    // POLLING HTTP SUPPRIMÉ - Les annulations sont gérées uniquement via Socket.IO

    return () => {
      unsubscribe();
    };
  }, [order?.id]); // Utiliser order?.id au lieu de order pour éviter les re-déclenchements

  useEffect(() => {
    if (!order?.id) return;
    if (!liveActivityStartedRef.current) {
      const updates = buildLiveActivityUpdates();
      if (updates) {
        startLiveActivity(order.id, updates).catch(() => {});
        liveActivityStartedRef.current = true;
        lastLiveActivityUpdateRef.current = Date.now();
      }
      return;
    }

    const now = Date.now();
    if (now - lastLiveActivityUpdateRef.current < 60000) return;
    const updates = buildLiveActivityUpdates();
    if (updates) {
      updateLiveActivity(order.id, updates).catch(() => {});
      lastLiveActivityUpdateRef.current = now;
    }
  }, [order?.id, rideStatus, driverEta]);

  useEffect(() => {
    if (rideStatus !== 'completed' || !order?.id) return;
    endLiveActivity(order.id, { status: 'completed' }).catch(() => {});
    liveActivityStartedRef.current = false;
  }, [rideStatus, order?.id]);

  // Nettoyage à la fermeture - NE PAS déconnecter Socket car on veut garder la connexion active
  // Socket.IO gère déjà les reconnexions automatiques
  useEffect(() => {
    return () => {
      if (locationWatchRef.current) {
        locationWatchRef.current.remove();
      }
      // NE PAS déconnecter Socket ici - laisser Socket.IO gérer les reconnexions
      // disconnectSocket() causait des déconnexions/reconnexions en boucle
    };
  }, []);

  // Fonction pour calculer la route
  const calculateRouteAsync = async () => {
    if (!order || !GOOGLE_MAPS_API_KEY) {
      return;
    }

    const pickup = order.addresses.find((a) => a.type === 'pickup');
    const destination = order.addresses.find((a) => a.type === 'destination');
    const stops = order.addresses.filter((a) => a.type === 'stop');

    if (!pickup || !destination || !pickup.lat || !pickup.lng || !destination.lat || !destination.lng) {
      console.log('[COURSE_EN_COURS] Missing coordinates for route calculation');
      return;
    }

    try {
      let origin = `${pickup.lat},${pickup.lng}`;
      let destinationParam = `${destination.lat},${destination.lng}`;

      let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destinationParam)}&mode=driving&key=${GOOGLE_MAPS_API_KEY}&language=fr&region=pf`;

      // Ajouter waypoints si présents
      if (stops.length > 0) {
        const waypoints = stops
          .map((stop) => {
            if (stop.lat && stop.lng) return `${stop.lat},${stop.lng}`;
            return null;
          })
          .filter((w): w is string => !!w);

        if (waypoints.length > 0) {
          url += `&waypoints=${encodeURIComponent(waypoints.join('|'))}`;
        }
      }

      const response = await fetch(url);
      const data = await response.json();

      if (data.status === 'OK' && data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const polyline = route.overview_polyline?.points;

        if (polyline) {
          const coordinates = decodePolyline(polyline);
          setRouteCoordinates(coordinates);
          // NE PAS centrer ici - le centrage est géré par le useEffect dédié (inprogressCenteredRef)
          // Centrer ici causait des recentrages répétés indésirables
        } else {
          // Fallback : ligne droite
          setRouteCoordinates([
            { latitude: pickup.lat, longitude: pickup.lng },
            { latitude: destination.lat, longitude: destination.lng },
          ]);
        }
      } else {
        // Fallback : ligne droite en cas d'erreur
        setRouteCoordinates([
          { latitude: pickup.lat, longitude: pickup.lng },
          { latitude: destination.lat, longitude: destination.lng },
        ]);
      }
    } catch (error) {
      console.error('[COURSE_EN_COURS] Error calculating route:', error);
      // Fallback : ligne droite
      const pickup = order.addresses.find((a) => a.type === 'pickup');
      const destination = order.addresses.find((a) => a.type === 'destination');
      if (pickup?.lat && pickup?.lng && destination?.lat && destination?.lng) {
        setRouteCoordinates([
          { latitude: pickup.lat, longitude: pickup.lng },
          { latitude: destination.lat, longitude: destination.lng },
        ]);
      }
    }
  };

  // Fonction pour calculer la route du chauffeur jusqu'au point de départ
  const calculateDriverRouteAsync = async () => {
    console.log('[COURSE_EN_COURS] calculateDriverRouteAsync called', { driverLocation, hasOrder: !!order, hasApiKey: !!GOOGLE_MAPS_API_KEY });
    if (!driverLocation || !order || !GOOGLE_MAPS_API_KEY) {
      console.log('[COURSE_EN_COURS] Missing requirements for driver route calculation');
      return;
    }

    const pickup = order.addresses.find((a) => a.type === 'pickup');
    if (!pickup || !pickup.lat || !pickup.lng) {
      return;
    }

    try {
      const origin = `${driverLocation.lat},${driverLocation.lng}`;
      const destinationParam = `${pickup.lat},${pickup.lng}`;
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destinationParam)}&mode=driving&key=${GOOGLE_MAPS_API_KEY}&language=fr&region=pf`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.status === 'OK' && data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const polyline = route.overview_polyline?.points;

        if (polyline) {
          const coordinates = decodePolyline(polyline);
          console.log('[COURSE_EN_COURS] Driver route calculated', { coordinatesCount: coordinates.length });
          setDriverRouteCoordinates(coordinates);

          // NE PAS centrer ici - le centrage est géré par le useEffect de centrage initial
          // Le centrage à chaque mise à jour de position causait le zoom compulsif

          // Calculer la durée estimée
          if (route.legs && route.legs.length > 0) {
            const duration = route.legs[0].duration?.text || null;
            console.log('[COURSE_EN_COURS] Driver ETA calculated', { duration });
            setDriverEta(duration);
          }
        } else {
          // Fallback : ligne droite
          setDriverRouteCoordinates([
            { latitude: driverLocation.lat, longitude: driverLocation.lng },
            { latitude: pickup.lat, longitude: pickup.lng },
          ]);
          setDriverEta(null);
        }
      } else {
        // Fallback : ligne droite
        setDriverRouteCoordinates([
          { latitude: driverLocation.lat, longitude: driverLocation.lng },
          { latitude: pickup.lat, longitude: pickup.lng },
        ]);
        setDriverEta(null);
      }
    } catch (error) {
      console.error('[COURSE_EN_COURS] Error calculating driver route:', error);
      // Fallback : ligne droite
      const pickup = order.addresses.find((a) => a.type === 'pickup');
      if (pickup && pickup.lat && pickup.lng) {
        setDriverRouteCoordinates([
          { latitude: driverLocation.lat, longitude: driverLocation.lng },
          { latitude: pickup.lat, longitude: pickup.lng },
        ]);
      }
      setDriverEta(null);
    }
  };

  // Calculer la route quand l'order est chargé
  useEffect(() => {
    if (order && order.addresses) {
      calculateRouteAsync();
    }
  }, [order?.id, rideStatus]); // Utiliser order?.id au lieu de order pour éviter les re-déclenchements

  // Fonction pour "snapper" la position du chauffeur sur la route la plus proche
  const snapDriverToRoute = (
    driverPos: { lat: number; lng: number; heading?: number },
    route: Array<{ latitude: number; longitude: number }>
  ): { lat: number; lng: number; heading: number } | null => {
    if (route.length === 0) return null;
    
    // Trouver le point le plus proche sur la route
    let closestIndex = 0;
    let minDistance = Infinity;
    let closestPoint = route[0];
    
    route.forEach((coord, index) => {
      const dist = Math.sqrt(
        Math.pow(coord.latitude - driverPos.lat, 2) +
        Math.pow(coord.longitude - driverPos.lng, 2)
      );
      if (dist < minDistance) {
        minDistance = dist;
        closestIndex = index;
        closestPoint = coord;
      }
    });
    
    // Calculer le heading depuis le point le plus proche vers le prochain point
    let heading = driverPos.heading || 0;
    if (closestIndex < route.length - 1) {
      const currentPoint = route[closestIndex];
      const nextPoint = route[closestIndex + 1];
      heading = calculateHeading(
        currentPoint.latitude,
        currentPoint.longitude,
        nextPoint.latitude,
        nextPoint.longitude
      );
    } else if (closestIndex > 0) {
      // Si on est à la fin de la route, utiliser le segment précédent
      const prevPoint = route[closestIndex - 1];
      const currentPoint = route[closestIndex];
      heading = calculateHeading(
        prevPoint.latitude,
        prevPoint.longitude,
        currentPoint.latitude,
        currentPoint.longitude
      );
    }
    
    return {
      lat: closestPoint.latitude,
      lng: closestPoint.longitude,
      heading: heading,
    };
  };

  // Fonction pour "snapper" la position du client sur la route la plus proche
  const snapClientToRoute = (
    clientPos: { lat: number; lng: number; heading?: number },
    route: Array<{ latitude: number; longitude: number }>
  ): { lat: number; lng: number; heading: number } | null => {
    if (route.length === 0) return null;
    
    // Trouver le point le plus proche sur la route
    let closestIndex = 0;
    let minDistance = Infinity;
    let closestPoint = route[0];
    
    route.forEach((coord, index) => {
      const dist = Math.sqrt(
        Math.pow(coord.latitude - clientPos.lat, 2) +
        Math.pow(coord.longitude - clientPos.lng, 2)
      );
      if (dist < minDistance) {
        minDistance = dist;
        closestIndex = index;
        closestPoint = coord;
      }
    });
    
    // Calculer le heading depuis le point le plus proche vers le prochain point
    let heading = clientPos.heading || 0;
    if (closestIndex < route.length - 1) {
      const currentPoint = route[closestIndex];
      const nextPoint = route[closestIndex + 1];
      heading = calculateHeading(
        currentPoint.latitude,
        currentPoint.longitude,
        nextPoint.latitude,
        nextPoint.longitude
      );
    } else if (closestIndex > 0) {
      // Si on est à la fin de la route, utiliser le segment précédent
      const prevPoint = route[closestIndex - 1];
      const currentPoint = route[closestIndex];
      heading = calculateHeading(
        prevPoint.latitude,
        prevPoint.longitude,
        currentPoint.latitude,
        currentPoint.longitude
      );
    }
    
    return {
      lat: closestPoint.latitude,
      lng: closestPoint.longitude,
      heading: heading,
    };
  };

  // Activer/désactiver le mode navigation selon le statut
  useEffect(() => {
    // Activer le mode navigation uniquement quand la course est en cours (inprogress)
    if (rideStatus === 'inprogress') {
      setNavigationMode(true);
    } else {
      // Désactiver le mode navigation pour les autres statuts (y compris les arrêts)
      setNavigationMode(false);
    }
  }, [rideStatus]);


  // Calculer la route du chauffeur quand sa position change - UNIQUEMENT si le chauffeur est en route
  useEffect(() => {
    if (!order) return;
    
    console.log('[COURSE_EN_COURS] useEffect driverLocation/order changed', { driverLocation, hasOrder: !!order, rideStatus });
    
    // Ne calculer la route que si le chauffeur est en route (pas arrivé, pas en cours)
    if (rideStatus === 'enroute' && driverLocation && driverLocation.lat && driverLocation.lng && order.id) {
      // Vérifier si la position a vraiment changé (éviter les recalculs inutiles)
      const lastLocation = lastDriverLocationForRouteRef.current;
      const hasLocationChanged = !lastLocation || 
        Math.abs(lastLocation.lat - driverLocation.lat) > 0.0001 || 
        Math.abs(lastLocation.lng - driverLocation.lng) > 0.0001;
      
      // Éviter les appels multiples simultanés
      if (hasLocationChanged && !isCalculatingRouteRef.current) {
        console.log('[COURSE_EN_COURS] Calling calculateDriverRouteAsync');
        isCalculatingRouteRef.current = true;
        lastDriverLocationForRouteRef.current = { lat: driverLocation.lat, lng: driverLocation.lng };
        calculateDriverRouteAsync().finally(() => {
          isCalculatingRouteRef.current = false;
        });
      }
    } else {
      // Nettoyer les coordonnées si le chauffeur est arrivé ou la course a démarré
      if (rideStatus === 'arrived' || rideStatus === 'inprogress') {
        setDriverRouteCoordinates([]);
        setDriverEta(null);
        lastDriverLocationForRouteRef.current = null;
      }
      console.log('[COURSE_EN_COURS] Not calling calculateDriverRouteAsync', { 
        hasDriverLocation: !!driverLocation,
        hasDriverLat: driverLocation?.lat,
        hasDriverLng: driverLocation?.lng,
        hasOrder: !!order,
        rideStatus
      });
    }
  }, [driverLocation?.lat, driverLocation?.lng, order?.id, rideStatus]);

  // Calculer la position snappée du chauffeur sur la route quand il est en route
  useEffect(() => {
    if (rideStatus === 'enroute' && driverLocation && driverRouteCoordinates.length > 0) {
      const snapped = snapDriverToRoute(driverLocation, driverRouteCoordinates);
      if (snapped) {
        setDriverSnappedLocation(snapped);
      } else {
        // Si on ne peut pas snapper, utiliser la position réelle
        setDriverSnappedLocation(driverLocation);
      }
    } else {
      // Si le chauffeur n'est pas en route, utiliser la position réelle
      setDriverSnappedLocation(driverLocation);
    }
  }, [driverLocation, driverRouteCoordinates, rideStatus]);

  // Calculer la position snappée du client sur la route quand la course est en cours
  useEffect(() => {
    if (rideStatus === 'inprogress' && clientLocation && routeCoordinates.length > 0) {
      const snapped = snapClientToRoute(clientLocation, routeCoordinates);
      if (snapped) {
        setClientSnappedLocation(snapped);
      } else {
        // Si on ne peut pas snapper, utiliser la position réelle
        setClientSnappedLocation(clientLocation);
      }
    } else {
      // Si la course n'est pas en cours, utiliser la position réelle
      setClientSnappedLocation(clientLocation);
    }
  }, [clientLocation, routeCoordinates, rideStatus]);

  // Note: L'animation de caméra pour suivre le client est gérée dans le useEffect de tracking GPS
  // pour éviter les doubles animations et les tremblements. Ce useEffect est désactivé.

  // Fonction pour centrer la carte sur le chauffeur
  const centerOnDriver = (animated = true) => {
    if (!mapRef.current || !driverLocation?.lat || !driverLocation?.lng) {
      console.log('[COURSE_EN_COURS] Cannot center on driver:', { hasMap: !!mapRef.current, driverLocation });
      return;
    }
    
    // En mode navigation, on suit automatiquement avec followsUserLocation
    if (navigationMode) {
      return;
    }
    
    // Offset différent selon le statut :
    // - Pour 'enroute' : on décale vers le bas pour voir le chauffeur au-dessus de la section blanche
    // - Pour 'arrived' : on décale aussi pour voir le chauffeur dans la partie supérieure (bloc blanc en bas)
    const latOffset = rideStatus === 'arrived' ? 0.002 : 0.0025;
    
    // Zoom différent selon le statut : beaucoup moins rapproché pour "enroute"
    const zoom = rideStatus === 'enroute' ? 10 : 15; // Zoom plus rapproché pour 'arrived'
    const delta = rideStatus === 'enroute' ? 0.04 : 0.008; // Delta plus petit pour 'arrived' = plus zoomé
    
    console.log('[COURSE_EN_COURS] Centering on driver:', { lat: driverLocation.lat, lng: driverLocation.lng, rideStatus, latOffset, delta });
    
    if (typeof mapRef.current.animateToRegion === 'function') {
      mapRef.current.animateToRegion(
        {
          latitude: driverLocation.lat - latOffset,
          longitude: driverLocation.lng,
          latitudeDelta: delta,
          longitudeDelta: delta,
        },
        animated ? 1000 : 0
      );
    } else if (typeof mapRef.current.animateCamera === 'function') {
      mapRef.current.animateCamera({
        center: {
          latitude: driverLocation.lat - latOffset,
          longitude: driverLocation.lng,
        },
        zoom: zoom,
      }, { duration: animated ? 1000 : 0 });
    }
  };

  // Gérer le mouvement de la carte par l'utilisateur
  const handleMapPanDrag = () => {
    console.log('[COURSE_EN_COURS] User moved the map');
    setUserMovedMap(true);
    
    // Annuler tout timer précédent
    if (recenterTimeoutRef.current) {
      clearTimeout(recenterTimeoutRef.current);
    }
    
    // Recentrer automatiquement après 6 secondes d'inactivité
    recenterTimeoutRef.current = setTimeout(() => {
      console.log('[COURSE_EN_COURS] Auto-recentering after 6s');
      setUserMovedMap(false);
      if (rideStatus === 'enroute' || rideStatus === 'arrived') {
        centerOnDriver(true);
      }
    }, 6000);
  };

  // Nettoyer le timer au démontage
  useEffect(() => {
    return () => {
      if (recenterTimeoutRef.current) {
        clearTimeout(recenterTimeoutRef.current);
      }
    };
  }, []);

  // Centrage INITIAL uniquement au premier chargement (une seule fois)
  useEffect(() => {
    if (initialCenterDone) return;
    if (!mapRef.current) return;
    
    // Attendre d'avoir la position du chauffeur
    if (driverLocation?.lat && driverLocation?.lng) {
      console.log('[COURSE_EN_COURS] Initial center on driver');
      centerOnDriver(false);
      setInitialCenterDone(true);
    }
  }, [driverLocation, initialCenterDone]);

  // Recentrer UNIQUEMENT quand le statut change (pas à chaque update de position)
  const lastRideStatusRef = useRef<string | null>(null);
  useEffect(() => {
    // Ne recentrer que si le statut a VRAIMENT changé
    if (lastRideStatusRef.current === rideStatus) return;
    lastRideStatusRef.current = rideStatus;
    
    if (!mapRef.current || !driverLocation?.lat || !driverLocation?.lng) return;

    console.log('[COURSE_EN_COURS] Status changed to:', rideStatus, '- recentering');
    
    // Pour 'arrived', TOUJOURS forcer le recentrage (reset userMovedMap)
    if (rideStatus === 'arrived') {
      setUserMovedMap(false); // Reset pour forcer le centrage
      centerOnDriver(true);
    } else if (rideStatus === 'enroute' && !userMovedMap) {
      // Pour 'enroute', ne recentrer que si l'utilisateur n'a pas bougé la carte
      centerOnDriver(true);
    }
  }, [rideStatus, driverLocation, userMovedMap]);

  // Centrer le trajet UNE SEULE FOIS quand on passe en mode "inprogress"
  const inprogressCenteredRef = useRef(false);
  useEffect(() => {
    // Ne centrer qu'une fois et si l'utilisateur n'a pas bougé la carte
    if (inprogressCenteredRef.current) return;
    if (userMovedMap) return;
    if (rideStatus !== 'inprogress') return;
    if (!mapRef.current || routeCoordinates.length === 0) return;

    console.log('[COURSE_EN_COURS] Centering on route (inprogress - ONE TIME)');
    inprogressCenteredRef.current = true;
    
    const pickup = order?.addresses.find((a) => a.type === 'pickup');
    const destination = order?.addresses.find((a) => a.type === 'destination');
    
    if (pickup && destination && pickup.lat && pickup.lng && destination.lat && destination.lng) {
      if (typeof mapRef.current.fitToCoordinates === 'function') {
        mapRef.current.fitToCoordinates(routeCoordinates, {
          edgePadding: {
            top: 80,
            right: 40,
            bottom: 260,
            left: 40,
          },
          animated: true,
        });
      } else {
        const bounds = {
          minLat: Math.min(...routeCoordinates.map((c) => c.latitude)),
          maxLat: Math.max(...routeCoordinates.map((c) => c.latitude)),
          minLng: Math.min(...routeCoordinates.map((c) => c.longitude)),
          maxLng: Math.max(...routeCoordinates.map((c) => c.longitude)),
        };

        const centerLat = (bounds.minLat + bounds.maxLat) / 2;
        const centerLng = (bounds.minLng + bounds.maxLng) / 2;
        const latDelta = Math.max((bounds.maxLat - bounds.minLat) * 1.5, 0.01);
        const lngDelta = Math.max((bounds.maxLng - bounds.minLng) * 1.5, 0.01);
        const adjustedCenterLat = centerLat - latDelta * 0.18;

        mapRef.current.animateToRegion(
          {
            latitude: adjustedCenterLat,
            longitude: centerLng,
            latitudeDelta: latDelta,
            longitudeDelta: lngDelta,
          },
          1000
        );
      }
    }
  }, [rideStatus, routeCoordinates, order?.id, userMovedMap]); // Utiliser order?.id au lieu de order pour éviter les re-déclenchements

  const formatPrice = (price: number) => {
    return `${price.toLocaleString('fr-FR')} XPF`;
  };

  const handleCall = () => {
    if (order?.driver?.phone) {
      // Utiliser le numéro du chauffeur configuré dans le dashboard
      const phoneNumber = order.driver.phone.startsWith('+') 
        ? order.driver.phone 
        : `+${order.driver.phone}`;
      Linking.openURL(`tel:${phoneNumber}`);
    } else if (order?.driver?.id) {
      // Fallback si le numéro n'est pas disponible
      console.warn('[CourseEnCours] Numéro de téléphone du chauffeur non disponible');
      Alert.alert(
        'Numéro indisponible',
        'Le numéro de téléphone du chauffeur n\'est pas disponible pour le moment.',
        [{ text: 'OK' }]
      );
    }
  };

  const handleMessage = () => {
    if (order?.id) {
      // Réinitialiser le compteur de messages non lus quand on ouvre le chat
      setUnreadMessagesCount(0);
      // Ouvrir le chat intégré
      router.push({
        pathname: '/(client)/ride/chat',
        params: {
          orderId: order.id,
          driverName: order.driver?.name || 'Chauffeur',
          clientToken: clientToken || '',
        },
      });
    }
  };

  // Fonction pour récupérer le nombre de messages non lus du chauffeur
  const fetchUnreadMessagesCount = async () => {
    if (!order?.id) return;
    
    try {
      const messages = await apiFetch<any[]>(`/api/messages/order/${order.id}/client`);
      // Compter les messages non lus envoyés par le chauffeur
      const unreadCount = messages?.filter(
        (msg: any) => msg.senderType === 'driver' && !msg.isRead
      ).length || 0;
      setUnreadMessagesCount(unreadCount);
    } catch (error) {
      console.error('[CourseEnCours] Error fetching unread messages:', error);
    }
  };

  // Vérifier les messages non lus périodiquement
  useEffect(() => {
    if (!order?.id) return;

    // Vérifier immédiatement
    fetchUnreadMessagesCount();

    // Vérifier toutes les 5 secondes
    const interval = setInterval(() => {
      fetchUnreadMessagesCount();
    }, 5000);

    return () => clearInterval(interval);
  }, [order?.id]);

  // Écouter les nouveaux messages via socket
  useEffect(() => {
    if (!order?.id || !clientToken) return;

    const socket = getSocket();
    if (!socket) return;

    const handleNewMessage = (data: any) => {
      // Si c'est un message du chauffeur et non lu, incrémenter le compteur
      if (data.senderType === 'driver' && !data.isRead) {
        setUnreadMessagesCount(prev => prev + 1);
      }
    };

    socket.on('message:new', handleNewMessage);

    return () => {
      socket.off('message:new', handleNewMessage);
    };
  }, [order?.id, clientToken]);

  // Animation de pulsation pour la bulle d'état
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(statusBannerScale, {
          toValue: 1.03,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(statusBannerScale, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  const handleCancel = () => {
    setShowCancelModal(true);
  };

  const handleConfirmCancel = async () => {
    if (!order) return;
    setIsCancelling(true);
    try {
      // Essayer d'annuler via Socket si on a le token
      if (clientToken) {
        await cancelRide(order.id, 'client', 'Annulé par le client', { clientToken });
      }
      // Nettoyer les données locales dans tous les cas
      await forceCleanupAndExit();
    } catch (error) {
      console.error('[COURSE_EN_COURS] Error cancelling ride:', error);
      // Même en cas d'erreur, proposer la sortie forcée
      Alert.alert(
        'Problème de connexion',
        'Impossible de contacter le serveur. Voulez-vous forcer la sortie et nettoyer les données locales ?',
        [
          { text: 'Non', style: 'cancel' },
          { text: 'Oui, forcer', onPress: forceCleanupAndExit },
        ]
      );
    } finally {
      setIsCancelling(false);
    }
  };

  // Fonction pour forcer le nettoyage et sortir (sans appel serveur)
  const forceCleanupAndExit = async () => {
    console.log('[COURSE_EN_COURS] Force cleanup and exit');
    const currentOrderId = order?.id;
    setShowCancelModal(false);
    
    try {
      // Nettoyer TOUTES les données locales (avec try-catch individuel)
      try { await removeClientToken(); } catch (e) { console.log('Error removing client token:', e); }
      try { await removeCurrentOrderId(); } catch (e) { console.log('Error removing order id:', e); }
      try { if (clearCachedOrderFn) await clearCachedOrderFn(); } catch (e) { console.log('Error clearing cache:', e); }
      
      // Arrêter le suivi GPS
      if (locationWatchRef.current) {
        try { locationWatchRef.current.remove(); } catch (e) { console.log('Error removing location watch:', e); }
        locationWatchRef.current = null;
      }
      
      // Nettoyer la connexion Socket pour cet ordre spécifique
      if (currentOrderId) {
        try { cleanupOrderConnection(currentOrderId); } catch (e) { console.log('Error cleaning up order connection:', e); }
      }
      try { disconnectSocket(); } catch (e) { console.log('Error disconnecting socket:', e); }
    } catch (error) {
      console.log('Error in forceCleanupAndExit:', error);
    } finally {
      // TOUJOURS réinitialiser les flags et naviguer
      globalInitialized = false;
      globalOrderId = null;
      socketJoinedRef.current = null;
      
      router.replace('/(client)');
    }
  };

  const handlePaymentRetry = () => {
    if (!order || !clientToken) return;
    setShowPaymentResult(false);
    retryPayment(order.id, clientToken);
  };

  const handleSwitchToCash = () => {
    if (!order || !clientToken) return;
    setShowPaymentResult(false);
    switchToCashPayment(order.id, clientToken);
  };

  const handleComplete = async (skipPaymentCheck = false) => {
    // skipPaymentCheck = true quand appelé depuis onComplete de RatingModal (notation terminée)
    if (!skipPaymentCheck && !paymentFlowCompleted && order?.status === 'payment_confirmed') {
      setShowPaymentResult(true);
      return;
    }
    const currentOrderId = order?.id;
    try {
      // Fermer tous les modals AVANT de naviguer
      setShowPaymentResult(false);
      setShowRatingModal(false);
      setPaymentResult(null);
      // NE PAS remettre paymentFlowCompleted à false ici car ça permettrait aux listeners de réafficher le popup
      // Il sera reset au prochain montage du composant
      
      // Nettoyer les données (avec try-catch individuel pour ne pas bloquer)
      try { await removeClientToken(); } catch (e) { console.log('Error removing client token:', e); }
      try { await removeCurrentOrderId(); } catch (e) { console.log('Error removing order id:', e); }
      try { if (clearCachedOrderFn) await clearCachedOrderFn(); } catch (e) { console.log('Error clearing cache:', e); }
      
      // Arrêter le suivi GPS
      if (locationWatchRef.current) {
        try { locationWatchRef.current.remove(); } catch (e) { console.log('Error removing location watch:', e); }
        locationWatchRef.current = null;
      }
      
      // Nettoyer la connexion Socket pour cet ordre spécifique
      if (currentOrderId) {
        try { cleanupOrderConnection(currentOrderId); } catch (e) { console.log('Error cleaning up order connection:', e); }
      }
      try { disconnectSocket(); } catch (e) { console.log('Error disconnecting socket:', e); }
    } catch (error) {
      console.log('Error in handleComplete cleanup:', error);
    } finally {
      // TOUJOURS réinitialiser les flags et naviguer, même en cas d'erreur
      globalInitialized = false;
      globalOrderId = null;
      socketJoinedRef.current = null;
      
      router.replace('/(client)');
    }
  };

  const getWaitingPrice = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    if (mins < 5) return 0;
    return (mins - 5) * 42;
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Fonction pour obtenir le tarif kilométrique selon l'heure de la commande
  const getPricePerKmForOrder = (orderCreatedAt: string): { price: number; period: 'jour' | 'nuit' } => {
    if (!orderCreatedAt || !order) {
      // Utiliser les tarifs du back office ou défaut
      const tarifJour = tarifs.find(t => t.typeTarif === 'kilometre_jour');
      return { price: tarifJour?.prixXpf || 150, period: 'jour' };
    }
    
    const orderDate = new Date(orderCreatedAt);
    const orderHour = orderDate.getHours();
    const orderMinutes = orderHour * 60 + orderDate.getMinutes();
    
    const kilometreTarifs = tarifs.filter(t => 
      t.typeTarif === 'kilometre_jour' || t.typeTarif === 'kilometre_nuit'
    );
    
    for (const tarif of kilometreTarifs) {
      if (tarif.heureDebut && tarif.heureFin) {
        const [debutH, debutM] = tarif.heureDebut.split(':').map(Number);
        const [finH, finM] = tarif.heureFin.split(':').map(Number);
        const debutMinutes = debutH * 60 + (debutM || 0);
        const finMinutes = finH * 60 + (finM || 0);
        
        let isInRange = false;
        if (debutMinutes <= finMinutes) {
          isInRange = orderMinutes >= debutMinutes && orderMinutes < finMinutes;
        } else {
          isInRange = orderMinutes >= debutMinutes || orderMinutes < finMinutes;
        }
        
        if (isInRange) {
          const period = tarif.typeTarif === 'kilometre_jour' ? 'jour' : 'nuit';
          return { price: tarif.prixXpf, period };
        }
      } else {
        if (tarif.typeTarif === 'kilometre_jour' && orderHour >= 6 && orderHour < 18) {
          return { price: tarif.prixXpf, period: 'jour' };
        }
        if (tarif.typeTarif === 'kilometre_nuit' && (orderHour >= 18 || orderHour < 6)) {
          return { price: tarif.prixXpf, period: 'nuit' };
        }
      }
    }
    
    const isNight = orderHour >= 18 || orderHour < 6;
    // Utiliser les tarifs du back office ou défaut
    const tarifNuit = tarifs.find(t => t.typeTarif === 'kilometre_nuit');
    const tarifJour = tarifs.find(t => t.typeTarif === 'kilometre_jour');
    return { 
      price: isNight 
        ? (tarifNuit?.prixXpf || 260)
        : (tarifJour?.prixXpf || 150), 
      period: isNight ? 'nuit' : 'jour' 
    };
  };

  // Fonction pour obtenir la prise en charge
  const getBasePrice = (): number => {
    const priseEnCharge = tarifs.find(t => t.typeTarif === 'prise_en_charge');
    return priseEnCharge?.prixXpf || 1000;
  };

  const getStatusText = () => {
    switch (rideStatus) {
      case 'enroute':
        return 'Votre chauffeur arrive vers vous';
      case 'arrived':
        return 'Votre chauffeur vous attend';
      case 'inprogress':
        return 'Course en cours';
      case 'completed':
        return 'Course terminée';
      default:
        return '';
    }
  };

  const getStatusColor = () => {
    switch (rideStatus) {
      case 'enroute':
        return '#3B82F6'; // Bleu
      case 'arrived':
        return '#EF4444'; // Rouge
      case 'inprogress':
        return '#F5C400'; // Jaune
      case 'completed':
        return '#22C55E'; // Vert
      default:
        return '#6b7280';
    }
  };

  if (isLoading) {
    return (
      <LoadingOverlay
        title="Reconnexion à votre course..."
        subtitle="Chargement des informations en cours"
      />
    );
  }

  if (!order) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <Ionicons name="alert-circle" size={64} color="#EF4444" />
          <Text variant="h3" style={styles.loadingText}>
            Commande non trouvée
          </Text>
          <Button title="Retour" onPress={async () => {
            try {
              try { await removeClientToken(); } catch (e) {}
              try { await removeCurrentOrderId(); } catch (e) {}
              try { disconnectSocket(); } catch (e) {}
            } catch (e) {}
            globalInitialized = false;
            globalOrderId = null;
            socketJoinedRef.current = null;
            router.replace('/(client)');
          }} fullWidth style={{ marginTop: 20 }} />
        </View>
      </SafeAreaView>
    );
  }

  const pickup = order.addresses.find((a) => a.type === 'pickup');
  const destination = order.addresses.find((a) => a.type === 'destination');
  const stops = order.addresses.filter((a) => a.type === 'stop');

  return (
    <View style={styles.container}>
      {/* Timer d'attente synchronisé en haut */}
      {rideStatus === 'arrived' && (
        <View style={styles.topTimerContainer}>
          <View style={styles.topTimerBubble}>
            <Text style={styles.topTimerLabel}>LE CHAUFFEUR VOUS ATTEND</Text>
            <View style={styles.topTimerRow}>
              <Text style={[styles.topTimerValue, waitingTime >= 300 ? { color: '#F5C400' } : {}]}>
                {formatTimer(waitingTime)}
              </Text>
              {waitingTime >= 300 && (
                <Text style={styles.topTimerPrice}>
                  +{getWaitingPrice(waitingTime)} XPF
                </Text>
              )}
            </View>
          </View>
        </View>
      )}
      {/* MAP PLEIN ÉCRAN */}
      {isMapsAvailable ? (
        <View style={styles.mapBackground}>
          {/* @ts-ignore - onPanDrag and onTouchStart are valid props for MapView */}
          <MapView
            ref={mapRef}
            style={styles.map}
            initialRegion={{
              latitude: driverLocation?.lat || clientLocation?.lat || -17.5399,
              longitude: driverLocation?.lng || clientLocation?.lng || -149.5686,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            }}
            showsUserLocation={!!clientLocation || (navigationMode && rideStatus === 'inprogress')}
            showsMyLocationButton={false}
            showsCompass={false}
            followsUserLocation={navigationMode && rideStatus === 'inprogress' && !userMovedMap}
            userLocationPriority="high"
            userLocationUpdateInterval={1000}
            onPanDrag={handleMapPanDrag}
            onTouchStart={handleMapPanDrag}
            onRegionChangeComplete={handleMapPanDrag}
            // Note: La caméra est contrôlée via animateCamera dans les useEffects
            // pour des animations fluides et stables, sans tremblements
          >
            {/* Tracé du trajet - Ligne jaune avec ligne noire au centre */}
            {routeCoordinates.length > 0 ? (
              <>
                {/* @ts-ignore - Polyline types are correctly handled by the maps library */}
                <Polyline
                  coordinates={routeCoordinates}
                  strokeColor="rgba(245, 196, 0, 0.75)"
                  strokeWidth={6}
                  lineCap="round"
                  lineJoin="round"
                  geodesic={true}
                />
                {/* @ts-ignore - Polyline types are correctly handled by the maps library */}
                <Polyline
                  coordinates={routeCoordinates}
                  strokeColor="#1A1A1A"
                  strokeWidth={1}
                  lineCap="round"
                  lineJoin="round"
                  geodesic={true}
                />
              </>
            ) : (
              // Fallback : ligne droite si pas de route calculée mais qu'on a les coordonnées
              pickup && destination && pickup.lat && pickup.lng && destination.lat && destination.lng && (
                <>
                  {/* @ts-ignore - Polyline types are correctly handled by the maps library */}
                  <Polyline
                    coordinates={[
                      { latitude: pickup.lat, longitude: pickup.lng },
                      { latitude: destination.lat, longitude: destination.lng },
                    ]}
                    strokeColor="rgba(245, 196, 0, 0.75)"
                    strokeWidth={6}
                    lineCap="round"
                    lineJoin="round"
                    geodesic={true}
                  />
                  {/* @ts-ignore - Polyline types are correctly handled by the maps library */}
                  <Polyline
                    coordinates={[
                      { latitude: pickup.lat, longitude: pickup.lng },
                      { latitude: destination.lat, longitude: destination.lng },
                    ]}
                    strokeColor="#1A1A1A"
                    strokeWidth={1}
                    lineCap="round"
                    lineJoin="round"
                    geodesic={true}
                  />
                </>
              )
            )}

            {/* Tracé en pointillés du chauffeur jusqu'au point de départ - UNIQUEMENT si le chauffeur est en route */}
            {rideStatus === 'enroute' && driverLocation && driverRouteCoordinates.length > 0 && (
              <>
                {/* @ts-ignore - Polyline types are correctly handled by the maps library */}
                <Polyline
                  coordinates={driverRouteCoordinates}
                  strokeColor="#000000"
                  strokeWidth={2}
                  lineDashPattern={[8, 4]}
                  lineCap="round"
                  lineJoin="round"
                  geodesic={true}
                  tracksViewChanges={false}
                />
                {/* Timer d'arrivée au milieu du tracé */}
                {driverEta && driverRouteCoordinates.length > 0 && (
                  <>
                    {/* @ts-ignore - Marker types are correctly handled by the maps library */}
                    <Marker
                      coordinate={driverRouteCoordinates[Math.floor(driverRouteCoordinates.length / 2)]}
                      anchor={{ x: 0.5, y: 0.5 }}
                      tracksViewChanges={false}
                    >
                      <View style={styles.etaContainer}>
                        <Text style={styles.etaText}>{driverEta}</Text>
                      </View>
                    </Marker>
                  </>
                )}
              </>
            )}
            {/* Fallback: ligne droite si pas de route calculée mais qu'on a les coordonnées - UNIQUEMENT si en route */}
            {rideStatus === 'enroute' && driverLocation && driverRouteCoordinates.length === 0 && pickup && pickup.lat && pickup.lng && (
              // @ts-ignore - Polyline types are correctly handled by the maps library
              <Polyline
                coordinates={[
                  { latitude: driverLocation.lat, longitude: driverLocation.lng },
                  { latitude: pickup.lat, longitude: pickup.lng },
                ]}
                strokeColor="#000000"
                strokeWidth={2}
                lineDashPattern={[8, 4]}
                lineCap="round"
                lineJoin="round"
                geodesic={true}
                tracksViewChanges={false}
              />
            )}

            {/* Chauffeur - Caché quand la course est en cours (inprogress) */}
            {(() => {
              // Utiliser la position snappée si le chauffeur est en route, sinon la position réelle
              const driverPos = rideStatus === 'enroute' && driverSnappedLocation 
                ? driverSnappedLocation 
                : driverLocation;
              
              if (!driverPos || !driverPos.lat || !driverPos.lng || rideStatus === 'inprogress') {
                console.log('[COURSE_EN_COURS] Driver marker not shown:', { driverPos, rideStatus });
                return null;
              }
              
              // Calculer la rotation : l'icône pointe vers le haut (Nord = 0°) dans le fichier image
              // Le heading est calculé où 0° = Nord
              // Si l'icône est perpendiculaire au trajet, il faut ajouter 90° pour l'aligner
              const rotation = (driverPos.heading || 0) + 90;
              
              return (
                <>
                  {/* @ts-ignore - zIndex and tracksViewChanges are valid props for Marker */}
                  <Marker
                    coordinate={{ 
                      latitude: driverPos.lat, 
                      longitude: driverPos.lng 
                    }}
                    anchor={{ x: 0.5, y: 0.5 }}
                    tracksViewChanges={false}
                    zIndex={999}
                    tappable={false}
                    flat={true}
                    title={undefined}
                    description={undefined}
                  >
                    <DriverCarIcon 
                      size={48} 
                      rotation={rotation} 
                    />
                  </Marker>
                </>
              );
            })()}

            {null}

            {/* Marqueur de départ */}
            {pickup && pickup.lat !== undefined && pickup.lat !== null && pickup.lng !== undefined && pickup.lng !== null && (
              <>
                {/* @ts-ignore - zIndex is a valid prop for Marker */}
                <Marker
                  coordinate={{ latitude: pickup.lat, longitude: pickup.lng }}
                  anchor={{ x: 0.5, y: 0.85 }}
                  zIndex={1}
                >
                <View style={styles.markerContainer}>
                  <Image
                    source={require('@/assets/images/Iconeacpp(1).gif')}
                    style={styles.markerIconDepart}
                  />
                  <View style={styles.markerLabelBlackDepart}>
                    <Text style={styles.markerLabelTextWhite}>Départ</Text>
                  </View>
                </View>
              </Marker>
              </>
            )}

            {/* Marqueurs d'arrêts */}
            {stops.map((stop, index) =>
              (stop.lat !== undefined && stop.lng !== undefined) ? (
                <React.Fragment key={stop.id || `stop-${index}`}>
                  {/* @ts-ignore - zIndex is a valid prop for Marker */}
                  <Marker
                    coordinate={{ latitude: stop.lat!, longitude: stop.lng! }}
                    anchor={{ x: 0.5, y: 1 }}
                    zIndex={2}
                  >
                  <View style={styles.markerContainer}>
                    <Image
                      source={require('@/assets/images/stopppp.gif')}
                      style={styles.markerIconStop}
                    />
                  </View>
                </Marker>
                </React.Fragment>
              ) : null
            )}

            {/* Marqueur d'arrivée */}
            {destination && destination.lat !== undefined && destination.lat !== null && destination.lng !== undefined && destination.lng !== null && (
              <>
                {/* @ts-ignore - zIndex is a valid prop for Marker */}
                <Marker
                  coordinate={{ latitude: destination.lat, longitude: destination.lng }}
                  anchor={{ x: 0.5, y: 1 }}
                  zIndex={1}
                >
                <View style={styles.markerContainer}>
                  <Image
                    source={require('@/assets/images/Icone_acpp_(5)_1764132915723_1767064460978.png')}
                    style={styles.markerIcon}
                  />
                  <View style={styles.markerLabelBlack}>
                    <Text style={styles.markerLabelTextWhite}>Arrivée</Text>
                  </View>
                </View>
              </Marker>
              </>
            )}
          </MapView>
        </View>
      ) : (
        <View style={styles.mapPlaceholder}>
          <Ionicons name="map-outline" size={64} color="#a3ccff" />
          <Text style={styles.mapPlaceholderText}>
            {Platform.OS === 'web'
              ? 'Carte disponible sur mobile uniquement'
              : 'Créez un Development Build pour activer la carte'}
          </Text>
        </View>
      )}

      {/* BULLE "COURSE EN COURS" EN OVERLAY, CENTRÉE */}
      <View style={[styles.headerOverlay, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity 
          onPress={() => setShowCancelModal(true)}
          style={styles.cancelButton}
        >
          <Ionicons name="close" size={24} color="#1a1a1a" />
        </TouchableOpacity>
        <View style={styles.titleBubbleContainer}>
        <View style={styles.titleBubble}>
          <Text variant="h3" style={styles.headerTitle}>
            {rideStatus === 'enroute' && driverEta
              ? `Arrivé dans ${driverEta}`
              : 'Course en cours'}
          </Text>
        </View>
        
        {/* Bulle verte supprimée car doublon avec le timer du haut */}
      </View>
      </View>

      {/* CONTENU EN BAS : bannière statut + bloc blanc avec chauffeur + prix */}
      <View style={styles.bottomContent}>
        {/* BANNIÈRE STATUT AU-DESSUS DU BLOC BLANC */}
        <View style={styles.statusBannerContainer}>
          <Animated.View 
            style={[
              styles.statusBanner, 
              { 
                backgroundColor: getStatusColor(), 
                shadowColor: getStatusColor(),
                transform: [{ scale: statusBannerScale }]
              }
            ]}
          >
            <Ionicons
              name={rideStatus === 'arrived' || rideStatus === 'completed' ? 'checkmark-circle' : 'car'}
              size={24}
              color="#FFFFFF"
            />
            <Text style={styles.statusText}>{getStatusText()}</Text>
          </Animated.View>
        </View>

        {/* BLOC BLANC AVEC CHAUFFEUR + PRIX */}
        <View style={[styles.bottomSheet, { paddingBottom: insets.bottom + 16 }]}>
          {order.driver ? (
            <View style={styles.driverAndPriceCard}>
              <View style={styles.driverHeader}>
                <View style={styles.driverAvatar}>
                  <Image
                    source={order.driver.photoUrl ? { uri: order.driver.photoUrl } : require('@/assets/images/250-150.png')}
                    style={styles.driverAvatarImage}
                    resizeMode="cover"
                  />
                </View>
                <View style={styles.driverInfoContainer}>
                  <View style={styles.driverInfo}>
                    {(() => {
                      const fullName = order.driver.name || `${order.driver.vehicleModel || 'Chauffeur'}`;
                      const nameParts = fullName.trim().split(' ');
                      const firstName = nameParts[0] || fullName;
                      const lastName = nameParts.slice(1).join(' ') || '';
                      
                      // Ajuster la taille de la police du prénom selon sa longueur
                      // Pour éviter qu'il passe à la ligne et qu'il soit tronqué
                      // Calcul progressif pour garder le texte toujours lisible
                      // Réduction plus agressive pour éviter les pointillés
                      let firstNameFontSize = 18;
                      if (firstName.length > 8) {
                        firstNameFontSize = 17;
                      }
                      if (firstName.length > 10) {
                        firstNameFontSize = 16;
                      }
                      if (firstName.length > 12) {
                        firstNameFontSize = 15;
                      }
                      if (firstName.length > 14) {
                        firstNameFontSize = 14;
                      }
                      if (firstName.length > 16) {
                        firstNameFontSize = 13;
                      }
                      if (firstName.length > 18) {
                        firstNameFontSize = 12;
                      }
                      if (firstName.length > 20) {
                        firstNameFontSize = 11;
                      }
                      if (firstName.length > 22) {
                        firstNameFontSize = 10;
                      }
                      if (firstName.length > 25) {
                        firstNameFontSize = 9;
                      }
                      // Pour les prénoms très longs, réduire encore plus
                      if (firstName.length > 28) {
                        firstNameFontSize = 8;
                      }
                      
                      return (
                        <View style={styles.driverNameBubble}>
                          <Text 
                            style={[
                              styles.driverFirstName,
                              { fontSize: firstNameFontSize, lineHeight: firstNameFontSize + 4 }
                            ]}
                            numberOfLines={1}
                          >
                            {firstName}
                          </Text>
                          {lastName ? (
                            <Text style={[styles.driverLastName, { color: '#Ff914d' }]}>
                              {lastName}
                            </Text>
                          ) : null}
                        </View>
                      );
                    })()}
                  </View>
                  <View style={styles.contactButtons}>
                    <TouchableOpacity style={styles.contactButton} onPress={handleCall}>
                      <Ionicons name="call" size={20} color="#22C55E" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.contactButton} onPress={handleMessage}>
                      <View style={styles.messageButtonContainer}>
                        <Ionicons name="chatbubble" size={20} color="#3B82F6" />
                        {unreadMessagesCount > 0 && (
                          <View style={styles.messageBadge}>
                            <Text style={styles.messageBadgeText}>
                              {unreadMessagesCount > 9 ? '9+' : unreadMessagesCount}
                            </Text>
                          </View>
                        )}
                      </View>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
              
              {/* Infos véhicule et plaque - Cachées uniquement en mode navigation (inprogress) */}
              {rideStatus !== 'inprogress' && (order.driver.vehicleModel || order.driver.vehiclePlate) && (
                <View style={styles.vehicleRow}>
                  <Ionicons name="car" size={20} color="#6b7280" />
                  <Text variant="body">
                    {[order.driver.vehicleModel, order.driver.vehicleColor].filter(Boolean).join(' ')}
                  </Text>
                  {order.driver.vehiclePlate && (
                    <View style={styles.plateBadge}>
                      <Text style={styles.plateText}>{order.driver.vehiclePlate}</Text>
                    </View>
                  )}
                </View>
              )}

              {/* Séparateur entre infos chauffeur et prix */}
              <View style={styles.driverPriceSeparator} />

              {/* Prix intégré dans le même bloc */}
              <View style={styles.priceRow}>
                <Text variant="label" style={styles.priceLabel}>
                  Prix de la course
                </Text>
                <View style={styles.priceWithInfo}>
                  <Text variant="h2" style={styles.priceText}>
                    {formatPrice(order.totalPrice)}
                  </Text>
                  <TouchableOpacity 
                    onPress={() => setShowPriceDetailsModal(true)}
                    style={styles.infoIconButton}
                  >
                    <Ionicons name="information-circle" size={20} color="#22C55E" />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ) : (
            <Card style={styles.priceCard}>
              <Text variant="label">Prix de la course</Text>
              <View style={styles.priceWithInfo}>
                <Text variant="h2" style={styles.priceText}>
                  {formatPrice(order.totalPrice)}
                </Text>
                <TouchableOpacity 
                  onPress={() => setShowPriceDetailsModal(true)}
                  style={styles.infoIconButton}
                >
                  <Ionicons name="information-circle" size={20} color="#22C55E" />
                </TouchableOpacity>
              </View>
            </Card>
          )}

          {/* Le bouton "Terminer" ne s'affiche qu'après le flow paiement/notation */}
          {order.status === 'payment_confirmed' && paymentFlowCompleted && (
            <View style={styles.footer}>
              <Button title="Terminer" onPress={handleComplete} fullWidth />
            </View>
          )}
          
          {/* Bouton pour quitter quand la course est terminée mais bloquée */}
          {rideStatus === 'completed' && order.status !== 'payment_confirmed' && (
            <View style={styles.footer}>
              <Button 
                title="Retour à l'accueil" 
                onPress={handleComplete} 
                fullWidth 
              />
            </View>
          )}
        </View>
      </View>

      {/* Modals de paiement / notation */}
      {paymentResult && (
        <PaymentResultModal
          visible={showPaymentResult}
          status={paymentResult.status}
          amount={paymentResult.amount}
          paymentMethod={paymentResult.paymentMethod}
          cardBrand={paymentResult.cardBrand}
          cardLast4={paymentResult.cardLast4}
          errorMessage={paymentResult.errorMessage}
          waitingTimeMinutes={order?.waitingTimeMinutes ?? null}
          paidStopsCost={paymentResult.paidStopsCost}
          supplements={paymentResult.supplements}
          passengers={order?.passengers}
          orderId={order?.id}
          fraisServiceOfferts={(order?.rideOption as any)?.fraisServiceOfferts === true}
          initialTotalPrice={(order?.rideOption as any)?.initialTotalPrice}
          fraisServicePercent={fraisServicePercent}
          onRetry={handlePaymentRetry}
          onSwitchToCash={handleSwitchToCash}
          onClose={() => {
            setShowPaymentResult(false);
            setPaymentPopupDismissed(true);
            // Afficher directement le modal de notation après la fermeture du pop-up de paiement
            if (paymentResult && paymentResult.status === 'success') {
              // Petit délai pour une meilleure UX
              setTimeout(() => {
                setShowRatingModal(true);
              }, 300);
            }
          }}
        />
      )}

      {/* MODAL DE NOTATION DU CHAUFFEUR */}
      <RatingModal
        visible={showRatingModal}
        driverName={order?.driver?.name || 'votre chauffeur'}
        onSubmit={async (score, comment) => {
          if (!order) {
            console.error('[Rating] Missing order:', { hasOrder: false });
            throw new Error('Données de commande manquantes.');
          }
          try {
            console.log('[Rating] Submitting rating:', { 
              orderId: order.id, 
              score, 
              hasComment: !!comment, 
            });
            
            const responseData = await apiPost<{ success: boolean; ratingId: string }>(
              `/api/orders/${order.id}/rate-driver`,
              { score, comment }
            );
            
            console.log('[Rating] ✅ Rating submitted successfully:', responseData);
          } catch (error: any) {
            console.error('[Rating] Exception during rating submission:', error);
            // Re-lancer l'erreur pour que RatingModal puisse l'afficher
            throw error;
          }
        }}
        onComplete={() => {
          setShowRatingModal(false);
          setPaymentFlowCompleted(true);
          // Passer true pour ignorer la vérification paymentFlowCompleted (problème de timing React)
          handleComplete(true);
        }}
      />

      {/* MODAL ARRÊT PAYANT (contrôlé par le chauffeur) */}
      <Modal
        visible={showPaidStopModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {}} // Empêcher la fermeture - seul le chauffeur peut fermer
      >
        <View style={styles.paidStopModalOverlay}>
          <View style={styles.paidStopModalContent}>
            {/* Header */}
            <View style={styles.paidStopModalHeader}>
              <View style={styles.paidStopModalIconCircle}>
                <Ionicons name="pause" size={32} color="#FFFFFF" />
              </View>
              <Text style={styles.paidStopModalTitle}>Arrêt en cours</Text>
              <Text style={styles.paidStopModalSubtitle}>Le chauffeur a fait un arrêt...</Text>
            </View>

            {/* Timer */}
            <View style={styles.paidStopTimerContainer}>
              <Text style={styles.paidStopTimerLabel}>Durée totale des arrêts</Text>
              <Text style={styles.paidStopTimerValue}>{formatPaidStopTime(paidStopDisplaySeconds)}</Text>
            </View>

            {/* Prix */}
            <View style={styles.paidStopCostContainer}>
              <Text style={styles.paidStopCostLabel}>Coût des arrêts</Text>
              <Text style={styles.paidStopCostValue}>{paidStopTotalCost.toLocaleString()} XPF</Text>
              <Text style={styles.paidStopCostRate}>42 XPF / minute</Text>
            </View>

            {/* Message d'info */}
            <View style={styles.paidStopInfoContainer}>
              <Ionicons name="information-circle" size={20} color="#6B7280" />
              <Text style={styles.paidStopInfoText}>
                Ce montant sera ajouté au prix final de votre course
              </Text>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL DÉTAILS DE PRIX */}
      <Modal
        visible={showPriceDetailsModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowPriceDetailsModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.priceDetailsModalContent}>
            <View style={styles.priceDetailsModalHeader}>
              <Text variant="h2" style={styles.priceDetailsModalTitle}>
                Détails de la tarification
              </Text>
              <TouchableOpacity
                onPress={() => setShowPriceDetailsModal(false)}
                style={styles.closeButton}
              >
                <Ionicons name="close" size={24} color="#1a1a1a" />
              </TouchableOpacity>
            </View>
            
            <ScrollView 
              style={styles.priceDetailsScrollView}
              contentContainerStyle={styles.priceDetailsContent}
              showsVerticalScrollIndicator={true}
            >
              {(() => {
                if (!order) return null;
                
                // Tour de l'île: prix fixe simple
                const isTourType = order.rideOption?.id === 'tour';
                const TOUR_FIXED_PRICE = 30000;
                
                if (isTourType) {
                  return (
                    <>
                      <View style={styles.priceDetailRow}>
                        <View style={styles.priceDetailRowLeft}>
                          <View style={styles.priceDetailIconContainer}>
                            <Ionicons name="compass" size={16} color="#22C55E" />
                          </View>
                          <Text style={styles.priceDetailLabel}>Tour de l'île (forfait)</Text>
                        </View>
                        <Text style={styles.priceDetailValue}>{formatPrice(TOUR_FIXED_PRICE)}</Text>
                      </View>
                      
                      <View style={styles.priceDetailSeparator} />
                      
                      <View style={[styles.priceDetailRow, { backgroundColor: '#F0FDF4', padding: 12, borderRadius: 8 }]}>
                        <Text style={[styles.priceDetailLabel, { fontWeight: '700', color: '#22C55E' }]}>Total</Text>
                        <Text style={[styles.priceDetailValue, { fontWeight: '700', color: '#22C55E', fontSize: 18 }]}>{formatPrice(TOUR_FIXED_PRICE)}</Text>
                      </View>
                    </>
                  );
                }
                
                const basePrice = getBasePrice();
                const kmPrice = getPricePerKmForOrder(order.createdAt);
                
                // Distance
                let distanceKm = 0;
                if (order.routeInfo?.distance) {
                  distanceKm = parseFloat(String(order.routeInfo.distance));
                } else if (order.estimatedDistance) {
                  distanceKm = order.estimatedDistance / 1000;
                }
                const distancePrice = distanceKm > 0 ? Math.round(distanceKm * kmPrice.price) : 0;
                
                // Suppléments
                const orderSupplements = order.supplements || [];
                const supplementsTotal = orderSupplements.reduce((sum: number, supp: any) => {
                  const supplementData = supplements.find(s => s.id === supp.id);
                  return sum + (supplementData?.prixXpf || supp.prixXpf || 0) * (supp.quantity || 1);
                }, 0);
                
                // Majoration passagers (500 XPF si >= 5 passagers)
                const passengers = order.passengers || 1;
                const majorationPassagers = passengers >= 5 ? 500 : 0;
                
                // Attente Pickup (Point A)
                let waitingMinutes = order.waitingTimeMinutes || 0;
                if (rideStatus === 'arrived' && waitingTime > 0) {
                  waitingMinutes = Math.floor(waitingTime / 60);
                }
                const waitingFee = waitingMinutes > 5 ? (waitingMinutes - 5) * 42 : 0;
                
                // Arrêts Payants (Point B)
                const persistedPaidStops = (order.rideOption as any)?.paidStopsCost || 0;
                const displayPaidStops = Math.max(persistedPaidStops, paidStopsCost);
                
                return (
                  <>
                    {/* Prise en charge */}
                    <View style={styles.priceDetailRow}>
                      <View style={styles.priceDetailRowLeft}>
                        <View style={styles.priceDetailIconContainer}>
                          <Ionicons name="car" size={16} color="#22C55E" />
                        </View>
                        <Text style={styles.priceDetailLabel}>Prise en charge</Text>
                      </View>
                      <Text style={styles.priceDetailValue}>{formatPrice(basePrice)}</Text>
                    </View>
                    
                    {/* Distance */}
                    <View style={styles.priceDetailRow}>
                      <View style={styles.priceDetailRowLeft}>
                        <View style={styles.priceDetailIconContainer}>
                          <Ionicons name="map" size={16} color="#22C55E" />
                        </View>
                        <View style={styles.priceDetailLabelContainer}>
                          <Text style={styles.priceDetailLabel}>Distance parcourue</Text>
                          <Text style={styles.priceDetailSubLabel}>
                            {distanceKm.toFixed(2)} km × {kmPrice.price} XPF
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.priceDetailValue}>{formatPrice(distancePrice)}</Text>
                    </View>
                    
                    {/* Suppléments (détail) */}
                    {orderSupplements.length > 0 && orderSupplements.map((supp: any, index: number) => {
                      const supplementData = supplements.find(s => s.id === supp.id);
                      const unitPrice = supplementData?.prixXpf || supp.prixXpf || supp.price || 0;
                      const quantity = supp.quantity || 1;
                      const suppPrice = unitPrice * quantity;
                      const suppName = supplementData?.nom || supp.nom || supp.name || 'Supplément';
                      return (
                        <View key={index} style={styles.priceDetailRow}>
                          <View style={styles.priceDetailRowLeft}>
                            <View style={styles.priceDetailIconContainer}>
                              <Ionicons name="add-circle" size={16} color="#F59E0B" />
                            </View>
                            <View style={styles.priceDetailLabelContainer}>
                              <Text style={styles.priceDetailLabel}>{suppName}</Text>
                              {quantity > 1 && (
                                <Text style={styles.priceDetailSubLabel}>
                                  {quantity} × {unitPrice} XPF
                                </Text>
                              )}
                            </View>
                          </View>
                          <Text style={[styles.priceDetailValue, { color: '#F59E0B' }]}>{formatPrice(suppPrice)}</Text>
                        </View>
                      );
                    })}
                    
                    {/* Majoration passagers (≥5 passagers) */}
                    {majorationPassagers > 0 && (
                      <View style={styles.priceDetailRow}>
                        <View style={styles.priceDetailRowLeft}>
                          <View style={styles.priceDetailIconContainer}>
                            <Ionicons name="people" size={16} color="#F59E0B" />
                          </View>
                          <View style={styles.priceDetailLabelContainer}>
                            <Text style={styles.priceDetailLabel}>+5 passagers ou plus</Text>
                            <Text style={styles.priceDetailSubLabel}>
                              {passengers} passagers
                            </Text>
                          </View>
                        </View>
                        <Text style={[styles.priceDetailValue, { color: '#F59E0B' }]}>{formatPrice(majorationPassagers)}</Text>
                      </View>
                    )}
                    
                    {/* Attente Pickup */}
                    {waitingFee > 0 && (
                      <View style={styles.priceDetailRow}>
                        <View style={styles.priceDetailRowLeft}>
                          <View style={styles.priceDetailIconContainer}>
                            <Ionicons name="time" size={16} color="#F5C400" />
                          </View>
                          <View style={styles.priceDetailLabelContainer}>
                            <Text style={styles.priceDetailLabel}>Temps d'attente</Text>
                            <Text style={styles.priceDetailSubLabel}>
                              {waitingMinutes} min (5 min gratuites)
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.priceDetailValue}>{formatPrice(waitingFee)}</Text>
                      </View>
                    )}
                    
                    {/* Arrêts Payants */}
                    {displayPaidStops > 0 && (
                      <View style={styles.priceDetailRow}>
                        <View style={styles.priceDetailRowLeft}>
                          <View style={styles.priceDetailIconContainer}>
                            <Ionicons name="pause-circle" size={16} color="#EF4444" />
                          </View>
                          <View style={styles.priceDetailLabelContainer}>
                            <Text style={styles.priceDetailLabel}>Arrêts payants</Text>
                            <Text style={styles.priceDetailSubLabel}>
                              Facturé 42 XPF / min
                            </Text>
                          </View>
                        </View>
                        <Text style={[styles.priceDetailValue, { color: '#EF4444' }]}>
                          {formatPrice(displayPaidStops)}
                        </Text>
                      </View>
                    )}
                    
                    {/* Frais de service (% configurable) */}
                    {(() => {
                      const rideOpt = order.rideOption as any;
                      const fraisOfferts = rideOpt?.fraisServiceOfferts === true;
                      // Calculer les frais de service : soit depuis initialTotalPrice, soit X% du subtotal
                      const initialPrice = rideOpt?.initialTotalPrice;
                      let fraisService = 0;
                      
                      if (initialPrice && initialPrice > order.totalPrice) {
                        // Prix initial disponible (salarié TAPEA qui a offert les frais)
                        fraisService = initialPrice - order.totalPrice;
                      } else if (!fraisOfferts) {
                        // Pas offert : calculer X% du subtotal (le totalPrice inclut déjà les frais)
                        // subtotal = totalPrice / (1 + X/100), donc frais = totalPrice - subtotal
                        const subtotalEstime = Math.round(order.totalPrice / (1 + fraisServicePercent / 100));
                        fraisService = order.totalPrice - subtotalEstime;
                      }
                      
                      // Toujours afficher la ligne si on a un montant de frais
                      if (fraisService > 0 || fraisOfferts) {
                        // Si offert mais pas de montant calculé, estimer les frais
                        if (fraisOfferts && fraisService === 0) {
                          fraisService = Math.round(order.totalPrice * 0.15);
                        }
                        
                        return (
                          <View style={styles.priceDetailRow}>
                            <View style={styles.priceDetailRowLeft}>
                              <View style={styles.priceDetailIconContainer}>
                                <Ionicons 
                                  name={fraisOfferts ? "gift" : "pricetag"} 
                                  size={16} 
                                  color={fraisOfferts ? "#22C55E" : "#3B82F6"} 
                                />
                              </View>
                              <View style={styles.priceDetailLabelContainer}>
                                <Text style={styles.priceDetailLabel}>Frais de service ({fraisServicePercent}%)</Text>
                                {fraisOfferts && (
                                  <Text style={[styles.priceDetailSubLabel, { color: '#22C55E', fontWeight: '600' }]}>
                                    Offerts par Tāpe'a
                                  </Text>
                                )}
                              </View>
                            </View>
                            {fraisOfferts ? (
                              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Text style={[styles.priceDetailValue, { 
                                  textDecorationLine: 'line-through', 
                                  color: '#9CA3AF',
                                  marginRight: 8
                                }]}>
                                  {formatPrice(fraisService)}
                                </Text>
                                <Text style={[styles.priceDetailValue, { color: '#22C55E', fontWeight: '700' }]}>
                                  Offert
                                </Text>
                              </View>
                            ) : (
                              <Text style={[styles.priceDetailValue, { color: '#3B82F6' }]}>
                                {formatPrice(fraisService)}
                              </Text>
                            )}
                          </View>
                        );
                      }
                      return null;
                    })()}
                    
                    <View style={styles.priceDetailSeparator} />
                    
                    <View style={styles.priceDetailRowTotal}>
                      <Text style={styles.priceDetailLabelTotal}>Total TTC</Text>
                      <Text style={styles.priceDetailValueTotal}>{formatPrice(order.totalPrice || 0)}</Text>
                    </View>
                  </>
                );
              })()}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* MODAL D'ANNULATION */}
      <Modal
        visible={showCancelModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowCancelModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Ionicons name="alert-circle" size={48} color="#EF4444" />
              <Text variant="h2" style={styles.modalTitle}>
                Annuler la course ?
              </Text>
              <Text variant="body" style={styles.modalMessage}>
                Êtes-vous sûr de vouloir annuler cette course ? Cette action est irréversible.
              </Text>
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={() => setShowCancelModal(false)}
                disabled={isCancelling}
              >
                <Text style={styles.modalButtonCancelText}>Non, garder</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonConfirm]}
                onPress={handleConfirmCancel}
                disabled={isCancelling}
              >
                {isCancelling ? (
                  <Text style={styles.modalButtonConfirmText}>Annulation...</Text>
                ) : (
                  <Text style={styles.modalButtonConfirmText}>Oui, annuler</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL FRAIS DE SERVICE OFFERTS - Notification positive quand un salarié TAPEA accepte */}
      <Modal
        visible={showFraisOffertsModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowFraisOffertsModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.fraisOffertsModalContent}>
            {/* Confetti/Celebration background effect */}
            <View style={styles.fraisOffertsHeader}>
              <View style={styles.fraisOffertsIconCircle}>
                <Ionicons name="gift" size={40} color="#22C55E" />
              </View>
              <Text variant="h2" style={styles.fraisOffertsTitle}>
                Bonne nouvelle !
              </Text>
              <Text style={styles.fraisOffertsSubtitle}>
                Les frais de service vous sont offerts ! 🎉
              </Text>
            </View>
            
            {fraisOffertsData && (
              <View style={styles.fraisOffertsDetails}>
                <View style={styles.fraisOffertsRow}>
                  <Text style={styles.fraisOffertsLabel}>Ancien prix</Text>
                  <Text style={styles.fraisOffertsOldPrice}>
                    {fraisOffertsData.ancienPrix.toLocaleString()} XPF
                  </Text>
                </View>
                <View style={styles.fraisOffertsDivider} />
                <View style={styles.fraisOffertsRow}>
                  <Text style={styles.fraisOffertsLabel}>Nouveau prix</Text>
                  <Text style={styles.fraisOffertsNewPrice}>
                    {fraisOffertsData.nouveauPrix.toLocaleString()} XPF
                  </Text>
                </View>
                <View style={styles.fraisOffertsSavings}>
                  <Ionicons name="sparkles" size={18} color="#22C55E" />
                  <Text style={styles.fraisOffertsSavingsText}>
                    Vous économisez {fraisOffertsData.economie.toLocaleString()} XPF
                  </Text>
                </View>
              </View>
            )}

            <TouchableOpacity
              style={styles.fraisOffertsButton}
              onPress={() => setShowFraisOffertsModal(false)}
            >
              <Text style={styles.fraisOffertsButtonText}>Super, merci !</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  mapBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 0,
  },
  map: {
    flex: 1,
  },
  mapPlaceholder: {
    flex: 1,
    backgroundColor: '#e8f4ff',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  mapPlaceholderText: {
    marginTop: 16,
    fontSize: 14,
    color: '#5c5c5c',
    textAlign: 'center',
  },
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  cancelButton: {
    position: 'absolute',
    right: 16,
    top: 58,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  titleBubbleContainer: {
    alignItems: 'center',
    gap: 8,
  },
  titleBubble: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  waitingFeeBubble: {
    backgroundColor: '#22C55E',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    // Effet néon vert prononcé
    shadowColor: '#22C55E',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 16,
    elevation: 10,
    // Pas de bordure
  },
  waitingFeeText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    lineHeight: 20,
  },
  headerTitle: {
    fontWeight: '700',
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  topTimerContainer: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
  },
  topTimerBubble: {
    backgroundColor: 'rgba(26, 26, 26, 0.9)',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 25,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(245, 196, 0, 0.3)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 8,
  },
  topTimerLabel: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 2,
  },
  topTimerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  topTimerValue: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  topTimerPrice: {
    color: '#F5C400',
    fontSize: 14,
    fontWeight: '700',
  },
  bottomContent: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -28,
    gap: 6,
  },
  statusBannerContainer: {
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  bottomSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingHorizontal: 16,
    paddingTop: 0,
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 10,
    position: 'relative',
    overflow: 'visible',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 16,
    textAlign: 'center',
  },
  content: {
    flex: 1,
    padding: 20,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 10,
    borderRadius: 12,
    // Effet néon (shadowColor défini dynamiquement via inline style)
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 12,
    elevation: 8,
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  driverCard: {
    padding: 16,
    marginBottom: 16,
  },
  driverAndPriceCard: {
    padding: 16,
    paddingTop: 16,
    marginBottom: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 0,
  },
  driverHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  driverAvatar: {
    width: 190,
    height: 120,
    overflow: 'hidden',
    borderRadius: 8,
  },
  driverAvatarImage: {
    width: '100%',
    height: '100%',
  },
  driverInfoContainer: {
    flex: 1,
    marginLeft: 16,
    justifyContent: 'space-between',
  },
  driverInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  driverName: {
    flex: 1,
  },
  driverNameBubble: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
    maxWidth: '100%',
    overflow: 'visible',
  },
  driverFirstName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
    lineHeight: 22,
    flexShrink: 1,
    includeFontPadding: false,
  },
  driverLastName: {
    fontSize: 13,
    fontWeight: '400',
    color: '#6B7280',
    marginTop: 2,
    lineHeight: 16,
  },
  contactButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  contactButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#f9fafb',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  messageButtonContainer: {
    position: 'relative',
    width: 20,
    height: 20,
  },
  messageBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#EF4444',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  messageBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 14,
  },
  vehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 12,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  plateBadge: {
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    marginLeft: 'auto',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  plateText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
  },
  tripCard: {
    padding: 16,
    marginBottom: 16,
  },
  tripRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  tripLine: {
    width: 2,
    height: 24,
    backgroundColor: '#e5e7eb',
    marginLeft: 5,
    marginVertical: 4,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 4,
  },
  tripAddress: {
    flex: 1,
  },
  priceCard: {
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
  },
  priceLabel: {
    color: '#4B5563',
  },
  priceText: {
    color: '#F5C400',
  },
  driverPriceSeparator: {
    height: 1,
    backgroundColor: '#f3f4f6',
    marginTop: 12,
    marginBottom: 4,
  },
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    overflow: 'visible',
  },
  markerIcon: {
    width: 60,
    height: 60,
  },
  markerIconDepart: {
    width: 72,
    height: 72,
  },
  markerIconStop: {
    width: 40,
    height: 40,
  },
  markerLabelBlack: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 2,
  },
  markerLabelBlackDepart: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: -12,
  },
  markerLabelTextWhite: {
    fontSize: 10,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  driverMarkerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverIcon: {
    width: 48,
    height: 48,
  },
  etaContainer: {
    backgroundColor: '#000000',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  etaText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  footer: {
    padding: 20,
    paddingBottom: 32,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  modalHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    marginTop: 16,
    marginBottom: 12,
    textAlign: 'center',
    fontWeight: '700',
    color: '#1a1a1a',
  },
  modalMessage: {
    textAlign: 'center',
    color: '#6b7280',
    lineHeight: 22,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonCancel: {
    backgroundColor: '#f3f4f6',
  },
  modalButtonCancelText: {
    color: '#374151',
    fontSize: 16,
    fontWeight: '600',
  },
  modalButtonConfirm: {
    backgroundColor: '#EF4444',
  },
  modalButtonConfirmText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  priceWithInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoIconButton: {
    padding: 4,
  },
  priceDetailsModalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    width: '90%',
    maxWidth: 400,
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
    borderWidth: 1,
    borderColor: '#22C55E',
  },
  priceDetailsModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: '#22C55E',
  },
  priceDetailsModalTitle: {
    fontWeight: '700',
    color: '#1a1a1a',
    fontSize: 20,
  },
  closeButton: {
    padding: 4,
  },
  priceDetailsScrollView: {
    flexGrow: 0,
  },
  priceDetailsContent: {
    gap: 12,
    paddingBottom: 8,
  },
  priceDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D1FAE5',
  },
  priceDetailRowLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
    gap: 10,
  },
  priceDetailIconContainer: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#D1FAE5',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  priceDetailLabelContainer: {
    flex: 1,
  },
  priceDetailLabel: {
    fontSize: 14,
    color: '#1a1a1a',
    fontWeight: '600',
    flexShrink: 1,
  },
  priceDetailSubLabel: {
    fontSize: 12,
    color: '#22C55E',
    marginTop: 4,
    fontWeight: '500',
  },
  priceDetailValue: {
    fontSize: 14,
    color: '#1a1a1a',
    fontWeight: '700',
    marginLeft: 12,
  },
  priceDetailSeparator: {
    height: 2,
    backgroundColor: '#22C55E',
    marginVertical: 12,
    borderRadius: 1,
  },
  priceDetailRowTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 8,
    marginTop: 8,
    paddingHorizontal: 12,
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#22C55E',
  },
  priceDetailLabelTotal: {
    fontSize: 18,
    color: '#1a1a1a',
    fontWeight: '700',
  },
  priceDetailValueTotal: {
    fontSize: 22,
    color: '#22C55E',
    fontWeight: '700',
  },
  // Styles pour le modal d'arrêt payant (fond blanc)
  paidStopModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  paidStopModalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 32,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    // Ombre douce
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  paidStopModalHeader: {
    alignItems: 'center',
    marginBottom: 28,
  },
  paidStopModalIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    // Effet ombre
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  paidStopModalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  paidStopModalSubtitle: {
    fontSize: 14,
    color: '#6B7280',
  },
  paidStopTimerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    paddingVertical: 20,
    paddingHorizontal: 24,
    backgroundColor: '#F3F4F6',
    borderRadius: 16,
    width: '100%',
    minHeight: 100,
  },
  paidStopTimerLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  paidStopTimerValue: {
    fontSize: 40,
    fontWeight: '800',
    color: '#1a1a1a',
    lineHeight: 48,
  },
  paidStopCostContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    paddingVertical: 20,
    paddingHorizontal: 24,
    backgroundColor: '#ECFDF5',
    borderRadius: 16,
    width: '100%',
    minHeight: 110,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  paidStopCostLabel: {
    fontSize: 12,
    color: '#059669',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  paidStopCostValue: {
    fontSize: 32,
    fontWeight: '800',
    color: '#059669',
    marginBottom: 6,
    lineHeight: 40,
  },
  paidStopCostRate: {
    fontSize: 12,
    color: '#10B981',
  },
  paidStopInfoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    width: '100%',
    gap: 10,
  },
  paidStopInfoText: {
    flex: 1,
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 18,
  },
  // ═══════════════════════════════════════════════════════════════════════════
  // STYLES MODAL FRAIS DE SERVICE OFFERTS
  // ═══════════════════════════════════════════════════════════════════════════
  fraisOffertsModalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    padding: 28,
    width: '90%',
    maxWidth: 360,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  fraisOffertsHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  fraisOffertsIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#DCFCE7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  fraisOffertsTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 8,
  },
  fraisOffertsSubtitle: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
  },
  fraisOffertsDetails: {
    width: '100%',
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
  },
  fraisOffertsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  fraisOffertsLabel: {
    fontSize: 14,
    color: '#6B7280',
  },
  fraisOffertsOldPrice: {
    fontSize: 16,
    color: '#9CA3AF',
    textDecorationLine: 'line-through',
  },
  fraisOffertsNewPrice: {
    fontSize: 20,
    fontWeight: '700',
    color: '#22C55E',
  },
  fraisOffertsDivider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 8,
  },
  fraisOffertsSavings: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  fraisOffertsSavingsText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#22C55E',
  },
  fraisOffertsButton: {
    backgroundColor: '#22C55E',
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 16,
    shadowColor: '#22C55E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  fraisOffertsButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
