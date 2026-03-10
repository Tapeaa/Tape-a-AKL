import { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, ActivityIndicator, TouchableOpacity, Alert, Modal, ScrollView, BackHandler } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { useAuth } from '@/lib/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { createOrder, setClientToken, setCurrentOrderId, removeClientToken, removeCurrentOrderId, getOrder, cancelOrder, getClientToken, ApiError } from '@/lib/api';
import {
  connectSocketAsync,
  joinClientSession,
  joinRideRoom,
  onDriverAssigned,
  onBookingConfirmed,
  onOrderExpired,
  onClientJoinError,
  onFraisServiceOfferts,
  disconnectSocket,
} from '@/lib/socket';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AddressField, Supplement } from '@/lib/types';
import { apiFetch } from '@/lib/api';

export default function RechercheChauffeureScreen() {
  const router = useRouter();
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{
    type: string;
    pickup: string;
    pickupPlaceId?: string;
    pickupLat?: string;
    pickupLng?: string;
    destination: string;
    destinationPlaceId?: string;
    destinationLat?: string;
    destinationLng?: string;
    stops?: string;
    passengers: string;
    supplements?: string;
    totalPrice: string;
    driverEarnings: string;
    paymentMethod: string;
    selectedCardId?: string;
    routeInfo?: string;
    scheduledTime?: string;
    isAdvanceBooking?: string;
    driverComment?: string;
    // Pour reprendre une recherche existante
    orderId?: string;
    resumeSearch?: string;
  }>();

  const [status, setStatus] = useState<'creating' | 'searching' | 'found' | 'expired' | 'error'>('searching'); // Affiche directement l'écran de recherche
  const [searchTime, setSearchTime] = useState(0);
  const [orderCreatedAt, setOrderCreatedAt] = useState<Date | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [clientToken, setClientTokenState] = useState<string | null>(null);
  const [orderDetails, setOrderDetails] = useState<any | null>(null);
  const [driverInfo, setDriverInfo] = useState<{
    name: string;
    driverId: string;
    sessionId: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tarifs, setTarifs] = useState<any[]>([]);
  const [tarifsLoaded, setTarifsLoaded] = useState(false);
  const [showPriceDetailsModal, setShowPriceDetailsModal] = useState(false);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // RÉSERVATION À L'AVANCE: État pour le popup de confirmation de réservation
  // ═══════════════════════════════════════════════════════════════════════════
  const [showBookingConfirmModal, setShowBookingConfirmModal] = useState(false);
  const [bookingConfirmData, setBookingConfirmData] = useState<{
    driverName: string;
    scheduledTime: string;
  } | null>(null);
  const bookingModalShownRef = useRef(false); // Ref pour éviter les doublons

  const searchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expirationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Protection anti-double création de commande
  const isCreatingRef = useRef(false);
  const orderCreatedRef = useRef(false);
  
  // Référence pour tracker si le cleanup a déjà été effectué
  const cleanupDoneRef = useRef(false);
  
  // Protection anti-navigation multiple vers course-en-cours
  const hasNavigatedRef = useRef(false);

  // Charger les tarifs au montage
  useEffect(() => {
    const loadTarifs = async () => {
      try {
        const tarifsData = await apiFetch<any[]>('/api/tarifs').catch(() => []);
        setTarifs(tarifsData || []);
        setTarifsLoaded(true);
        console.log('[ORDER] Tarifs loaded:', tarifsData);
      } catch (error) {
        console.error('[ORDER] Error loading tarifs:', error);
        setTarifsLoaded(true); // Marquer comme chargé même en cas d'erreur pour ne pas bloquer
      }
    };
    loadTarifs();
  }, []);

  // Créer la commande au chargement ou reprendre une recherche existante
  useEffect(() => {
    let mounted = true;

    const createOrderAndJoin = async () => {
      // Protection anti-double création
      if (isCreatingRef.current || orderCreatedRef.current) {
        console.log('[ORDER] ⚠️ Order creation already in progress or completed, skipping');
        return;
      }
      
      // Attendre que les tarifs soient chargés AVANT de commencer la création
      if (!tarifsLoaded) {
        console.log('[ORDER] ⏳ Waiting for tarifs to load...');
        return; // Attendre le prochain rendu
      }
      
      isCreatingRef.current = true;
      
      let orderData: any = null;
      
      // Si on reprend une recherche existante
      if (params.resumeSearch === 'true' && params.orderId) {
        console.log('[ORDER] Resuming existing search for order:', params.orderId);
        
        try {
          // Récupérer le token client stocké
          const storedToken = await getClientToken();
          
          if (storedToken) {
            setOrderId(params.orderId);
            setClientTokenState(storedToken);
            
            // Récupérer la commande depuis le serveur pour avoir les vraies infos (date de création, etc.)
            try {
              const orderData = await getOrder(params.orderId);
              if (orderData) {
                setOrderCreatedAt(new Date(orderData.createdAt));
                setOrderDetails(orderData);
                console.log('[ORDER] Order data loaded for resume:', {
                  createdAt: orderData.createdAt,
                  status: orderData.status,
                  totalPrice: orderData.totalPrice,
                });
              } else {
                setOrderCreatedAt(new Date()); // Fallback
              }
            } catch (orderError) {
              console.error('[ORDER] Error fetching order data:', orderError);
              setOrderCreatedAt(new Date()); // Fallback
            }
            
            // Se reconnecter au socket
            try {
              await connectSocketAsync();
              joinClientSession(params.orderId, storedToken);
              // Rejoindre la room pour recevoir les messages des chauffeurs
              joinRideRoom(params.orderId, 'client', { clientToken: storedToken });
              setStatus('searching');
            } catch (socketError) {
              console.error('Socket reconnection error:', socketError);
              setStatus('searching');
            }
            isCreatingRef.current = false;
            return;
          }
        } catch (error) {
          console.error('[ORDER] Error resuming search:', error);
          // Continuer pour créer une nouvelle commande
        }
      }
      
      try {
        console.log('[ORDER] Starting order creation with params:', {
          pickup: params.pickup,
          destination: params.destination,
          type: params.type,
          totalPrice: params.totalPrice,
          driverEarnings: params.driverEarnings,
          stops: params.stops,
          passengers: params.passengers,
          supplements: params.supplements,
          paymentMethod: params.paymentMethod,
          isAdvanceBooking: params.isAdvanceBooking,
        });
        
        // Si on reprend une recherche, on a déjà les paramètres, pas besoin de valider
        // Valider les paramètres requis seulement si on crée une nouvelle commande
        if (!params.resumeSearch && (!params.pickup || !params.destination)) {
          console.error('[ORDER] Missing required addresses:', { pickup: params.pickup, destination: params.destination });
          throw new Error('Les adresses de départ et d\'arrivée sont requises.');
        }
        
        // Si on reprend une recherche et qu'on a déjà les paramètres, utiliser ceux-ci
        if (params.resumeSearch === 'true' && params.orderId && params.pickup && params.destination) {
          console.log('[ORDER] Resuming with provided params, no need to create new order');
          // Les paramètres sont déjà passés, on peut les utiliser directement
          // Le code ci-dessous ne sera pas exécuté car on a déjà return plus haut
        }

        // Préparer les adresses (nettoyer pour ne pas envoyer undefined)
        const addresses: AddressField[] = [
          {
            id: 'pickup',
            value: params.pickup || '',
            placeId: params.pickupPlaceId || null,
            type: 'pickup',
            ...(params.pickupLat && params.pickupLng
              ? { lat: parseFloat(params.pickupLat), lng: parseFloat(params.pickupLng) }
              : {}),
          },
          {
            id: 'destination',
            value: params.destination || '',
            placeId: params.destinationPlaceId || null,
            type: 'destination',
            ...(params.destinationLat && params.destinationLng
              ? { lat: parseFloat(params.destinationLat), lng: parseFloat(params.destinationLng) }
              : {}),
          },
        ];

        // Ajouter les arrêts intermédiaires si présents
        if (params.stops && params.stops !== '[]' && params.stops.trim() !== '') {
          try {
            const stops = JSON.parse(params.stops) as AddressField[];
            if (Array.isArray(stops)) {
              addresses.push(...stops.filter(stop => stop && stop.value));
            }
          } catch (e) {
            console.warn('Failed to parse stops:', e);
          }
        }

        // Préparer les suppléments
        let supplements: Supplement[] = [];
        if (params.supplements && params.supplements !== '[]' && params.supplements.trim() !== '') {
          try {
            const parsedSupplements = JSON.parse(params.supplements);
            if (Array.isArray(parsedSupplements)) {
              // S'assurer que tous les suppléments ont la structure attendue
              supplements = parsedSupplements
                .filter((s: any) => s && s.id && s.name && s.price !== undefined && s.quantity !== undefined && s.quantity > 0)
                .map((s: any) => ({
                  id: s.id,
                  name: s.name,
                  icon: s.icon || 'add-circle', // Valeur par défaut si manquant
                  price: typeof s.price === 'number' ? s.price : parseFloat(s.price) || 0,
                  quantity: typeof s.quantity === 'number' ? s.quantity : parseInt(s.quantity, 10) || 0,
                }));
            }
          } catch (e) {
            console.warn('Failed to parse supplements:', e);
          }
        }

        // Préparer routeInfo
        let routeInfo = undefined;
        if (params.routeInfo && params.routeInfo.trim() !== '' && params.routeInfo !== 'null') {
          try {
            const parsedRouteInfo = JSON.parse(params.routeInfo);
            if (parsedRouteInfo && typeof parsedRouteInfo === 'object') {
              routeInfo = parsedRouteInfo;
            }
          } catch (e) {
            console.warn('Failed to parse routeInfo:', e);
          }
        }

        // Préparer les données de commande
        const rideOptionId = params.type || 'immediate';
        
        // Récupérer les tarifs du back office (utiliser les valeurs du back office uniquement)
        const priseEnChargeTarif = tarifs.find(t => t.typeTarif === 'prise_en_charge');
        const priseEnCharge = priseEnChargeTarif?.prixXpf || 1000;
        
        console.log('[ORDER] Using tarifs from back office:', {
          tarifsCount: tarifs.length,
          priseEnCharge,
          tarifs: tarifs.map(t => ({ type: t.typeTarif, prix: t.prixXpf }))
        });
        
        // Déterminer le tarif kilométrique selon l'heure (actuelle ou de réservation)
        const isAdvanceBooking = params.isAdvanceBooking === 'true' || rideOptionId === 'reservation';
        const scheduledTime = (isAdvanceBooking && params.scheduledTime && params.scheduledTime !== '') 
          ? params.scheduledTime 
          : null;
        
        const referenceDate = scheduledTime ? new Date(scheduledTime) : new Date();
        const referenceHour = referenceDate.getHours();
        const isNight = referenceHour >= 18 || referenceHour < 6;
        
        const tarifJour = tarifs.find(t => t.typeTarif === 'kilometre_jour');
        const tarifNuit = tarifs.find(t => t.typeTarif === 'kilometre_nuit');
        const pricePerKm = isNight 
          ? (tarifNuit?.prixXpf || 260)
          : (tarifJour?.prixXpf || 150);
        
        // Pour le tour de l'île, utiliser un prix fixe
        const tourPrice = rideOptionId === 'tour' ? 30000 : priseEnCharge;
        
        const rideOptions = {
          immediate: { 
            id: 'immediate', 
            title: 'Chauffeur immédiat',
            price: priseEnCharge,
            pricePerKm: pricePerKm,
          },
          reservation: { 
            id: 'reservation', 
            title: 'Réserver à l\'avance',
            price: priseEnCharge,
            pricePerKm: pricePerKm, // Utilise le tarif de l'heure de réservation
          },
          tour: { 
            id: 'tour', 
            title: 'Tour de l\'Île',
            price: tourPrice,
            pricePerKm: 0, // Pas de tarif kilométrique pour le tour
          },
        };
        const selectedRideOption = rideOptions[rideOptionId as keyof typeof rideOptions] || rideOptions.immediate;
        
        console.log('[ORDER] Selected ride option:', selectedRideOption);

        // Nettoyer les addresses pour ne pas envoyer undefined ou null
        const cleanedAddresses = addresses
          .filter(addr => addr && addr.value && addr.value.trim() !== '')
          .map((addr) => {
            const cleaned: any = {
              id: addr.id,
              value: addr.value.trim(),
              placeId: addr.placeId || null,
              type: addr.type,
            };
            if (addr.lat !== undefined && addr.lat !== null && !isNaN(addr.lat)) {
              cleaned.lat = addr.lat;
            }
            if (addr.lng !== undefined && addr.lng !== null && !isNaN(addr.lng)) {
              cleaned.lng = addr.lng;
            }
            return cleaned;
          });

        // Valider qu'on a au moins pickup et destination
        if (cleanedAddresses.length < 2) {
          throw new Error('Les adresses de départ et d\'arrivée sont requises.');
        }

        // Calculer les prix si manquants
        console.log('[ORDER] Price params:', {
          totalPrice: params.totalPrice,
          driverEarnings: params.driverEarnings,
          type: params.type,
        });
        
        const totalPrice = parseFloat(params.totalPrice || '0');
        const driverEarnings = parseFloat(params.driverEarnings || '0');
        
        console.log('[ORDER] Parsed prices:', { totalPrice, driverEarnings });
        
        if (isNaN(totalPrice) || totalPrice <= 0) {
          console.error('[ORDER] Invalid totalPrice:', params.totalPrice, 'parsed as:', totalPrice);
          throw new Error(`Le prix total de la commande est invalide (${params.totalPrice || 'non défini'}).`);
        }

        // isAdvanceBooking et scheduledTime sont déjà définis plus haut lors de la création de rideOption

        orderData = {
          clientName: client ? `${client.firstName} ${client.lastName}` : 'Client',
          clientPhone: client?.phone || '+68900000000',
          addresses: cleanedAddresses,
          rideOption: selectedRideOption,
          ...(routeInfo ? { routeInfo } : {}),
          passengers: Math.max(1, Math.min(8, parseInt(params.passengers || '1', 10))),
          // Filtrer et nettoyer les suppléments pour ne garder que les champs attendus par le schéma
          supplements: supplements
            .filter((s) => s && s.quantity && s.quantity > 0)
            .map((s) => ({
              id: s.id,
              name: s.name,
              icon: s.icon || 'add-circle', // Valeur par défaut si manquant
              price: s.price,
              quantity: s.quantity,
              // Ne pas inclure 'description' ou d'autres champs supplémentaires
            })),
          paymentMethod: (params.paymentMethod === 'card' ? 'card' : 'cash') as 'cash' | 'card',
          driverComment: params.driverComment || null, // Message du client pour le chauffeur
          // Note: selectedCardId n'est pas dans le schéma insertOrderSchema, il sera utilisé plus tard pour le paiement
          totalPrice,
          driverEarnings: driverEarnings > 0 ? driverEarnings : Math.round(totalPrice * 0.8),
          scheduledTime: scheduledTime, // TOUJOURS inclus, null si ce n'est pas une réservation
          isAdvanceBooking: isAdvanceBooking,
        };

        // Log pour vérifier que scheduledTime est bien inclus
        console.log('[ORDER] Order data before sending:', JSON.stringify(orderData, null, 2));
        console.log('[ORDER] scheduledTime value:', scheduledTime, 'type:', typeof scheduledTime);

        // Créer la commande
        const response = await createOrder(orderData);
        
        if (!mounted) return;

        if (!response || !response.order || !response.order.id) {
          throw new Error('Réponse invalide du serveur. La commande n\'a pas pu être créée.');
        }

        // Marquer comme créé pour empêcher la double création
        orderCreatedRef.current = true;
        
        setOrderId(response.order.id);
        setOrderDetails(response.order);
        setClientTokenState(response.clientToken);
        // Stocker le timestamp de création pour le timer
        const createdAt = response.order.createdAt ? new Date(response.order.createdAt) : new Date();
        setOrderCreatedAt(createdAt);
        await setClientToken(response.clientToken);
        await setCurrentOrderId(response.order.id);

        console.log('[ORDER] ✅ Order created successfully:', response.order.id, 'at:', createdAt.toISOString());
        console.log('[ORDER] Client token:', response.clientToken ? 'present' : 'missing');

        // Connecter Socket.IO et joindre la session
        // Ajouter un délai pour laisser le temps au backend de finaliser la création et enregistrer le token
        try {
          await connectSocketAsync();
          // Attendre que le backend ait finalisé la création de la commande et enregistré le token
          await new Promise(resolve => setTimeout(resolve, 1000));
          console.log('[ORDER] Joining client session with orderId:', response.order.id, 'token:', response.clientToken ? 'present' : 'missing');
          
          // Réessayer plusieurs fois si nécessaire
          let joinAttempts = 0;
          const maxAttempts = 3;
          const joinWithRetry = () => {
            joinAttempts++;
            console.log(`[ORDER] Join attempt ${joinAttempts}/${maxAttempts}`);
            joinClientSession(response.order.id, response.clientToken);
            // Rejoindre la room pour recevoir les messages des chauffeurs
            joinRideRoom(response.order.id, 'client', { clientToken: response.clientToken });
          };
          
          joinWithRetry();
          setStatus('searching');
        } catch (socketError) {
          console.error('Socket connection error:', socketError);
          // Continuer quand même, le polling HTTP peut servir de fallback
          setStatus('searching');
        }
      } catch (err: any) {
        console.error('Error creating order:', err);
        console.error('Error details:', {
          message: err?.message,
          status: err?.status,
          isNetworkError: err?.isNetworkError,
          stack: err?.stack,
          name: err?.name,
        });
        if (orderData) {
          console.error('Order data that failed:', JSON.stringify(orderData, null, 2));
        } else {
          console.error('Order data was not prepared due to earlier error');
        }
        if (!mounted) return;
        
        // Afficher un message d'erreur plus détaillé
        let errorMessage = 'Erreur lors de la création de la commande';
        
        // Gérer les ApiError spécifiquement
        if (err instanceof ApiError) {
          errorMessage = err.message;
          
          // Messages spécifiques selon le type d'erreur
          if (err.isNetworkError) {
            errorMessage = 'Impossible de contacter le serveur. Vérifiez votre connexion internet et réessayez.';
          } else if (err.status >= 500) {
            errorMessage = 'Le serveur rencontre un problème technique. Réessayez dans quelques instants.';
          } else if (err.status === 400) {
            errorMessage = err.message || 'Données invalides. Vérifiez que toutes les informations sont correctes.';
          } else if (err.status === 401 || err.status === 403) {
            errorMessage = 'Vous devez être connecté pour créer une commande. Veuillez vous reconnecter.';
          } else if (err.status === 404) {
            errorMessage = 'Service non disponible. Veuillez réessayer plus tard.';
          }
        } else if (err instanceof Error) {
          errorMessage = err.message || 'Une erreur inattendue s\'est produite.';
        } else if (err?.message) {
          errorMessage = err.message;
        } else if (typeof err === 'string') {
          errorMessage = err;
        } else {
          // Fallback pour les erreurs inconnues
          errorMessage = 'Une erreur inattendue s\'est produite lors de la création de la commande.';
        }
        
        // Si on a un statut mais que ce n'est pas une ApiError, essayer d'extraire le message
        if (err?.status && !(err instanceof ApiError)) {
          if (err.status >= 500) {
            errorMessage = 'Le serveur rencontre un problème. Vérifiez que toutes les informations sont correctes et réessayez.';
          } else if (err.status === 400) {
            errorMessage = err?.message || 'Données invalides. Vérifiez que toutes les informations sont correctes.';
          } else if (err.status === 401 || err.status === 403) {
            errorMessage = 'Vous devez être connecté pour créer une commande.';
          }
        }
        
        // Vérifier si c'est une erreur réseau
        if (err?.isNetworkError || (err?.message && (err.message.includes('network') || err.message.includes('fetch')))) {
          errorMessage = 'Impossible de contacter le serveur. Vérifiez votre connexion internet.';
        }
        
        setError(errorMessage);
        setStatus('error');
        // Réinitialiser le flag de création en cas d'erreur pour permettre une nouvelle tentative
        isCreatingRef.current = false;
      }
    };

    createOrderAndJoin();

    return () => {
      mounted = false;
    };
  }, [tarifsLoaded]); // Réexécuter quand les tarifs sont chargés

  // Timer de recherche - calcule le temps réel depuis la création de la commande
  useEffect(() => {
    if (status === 'searching' && orderCreatedAt) {
      // Calculer immédiatement le temps écoulé
      const updateElapsedTime = () => {
        const elapsed = Math.floor((Date.now() - orderCreatedAt.getTime()) / 1000);
        setSearchTime(Math.max(0, elapsed));
      };
      
      // Mettre à jour immédiatement
      updateElapsedTime();
      
      // Puis toutes les secondes
      searchTimerRef.current = setInterval(updateElapsedTime, 1000);
    }

    return () => {
      if (searchTimerRef.current) {
        clearInterval(searchTimerRef.current);
      }
    };
  }, [status, orderCreatedAt]);

  // Timer d'expiration (5 minutes, aligné avec le backend)
  useEffect(() => {
    if (status === 'searching' && orderId) {
      expirationTimerRef.current = setTimeout(() => {
        setStatus('expired');
      }, 5 * 60 * 1000); // 5 minutes (300 secondes), aligné avec le backend
    }

    return () => {
      if (expirationTimerRef.current) {
        clearTimeout(expirationTimerRef.current);
      }
    };
  }, [status, orderId]);

  // Écouter l'assignation du chauffeur via Socket
  useEffect(() => {
    if (!orderId || status !== 'searching') return;

    const unsubscribeDriverAssigned = onDriverAssigned((data) => {
      if (data.orderId === orderId) {
        // Ne naviguer qu'une seule fois pour éviter les boucles infinies
        if (!hasNavigatedRef.current) {
          console.log('[ORDER] Driver assigned via socket, navigating to course-en-cours');
          hasNavigatedRef.current = true;
          router.replace({
            pathname: '/(client)/ride/course-en-cours',
            params: {
              orderId,
              pickup: params.pickup,
              destination: params.destination,
              totalPrice: params.totalPrice,
            },
          });
        }
      }
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // FRAIS DE SERVICE OFFERTS: Écouter quand un salarié TAPEA accepte
    // Stocker les infos pour les afficher sur la page course-en-cours
    // ═══════════════════════════════════════════════════════════════════════════
    const unsubscribeFraisOfferts = onFraisServiceOfferts(async (data) => {
      if (data.orderId === orderId) {
        console.log('[ORDER] 🎉 Frais de service offerts reçus pendant recherche!', data);
        // Stocker les données dans AsyncStorage pour les récupérer sur course-en-cours
        try {
          await AsyncStorage.setItem(`frais_offerts_${orderId}`, JSON.stringify({
            ancienPrix: data.ancienPrix,
            nouveauPrix: data.nouveauPrix,
            economie: data.economie,
            timestamp: Date.now(),
          }));
          console.log('[ORDER] Frais offerts stockés dans AsyncStorage');
        } catch (e) {
          console.error('[ORDER] Erreur stockage frais offerts:', e);
        }
      }
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // RÉSERVATION À L'AVANCE: Écouter la confirmation de réservation
    // ═══════════════════════════════════════════════════════════════════════════
    const unsubscribeBookingConfirmed = onBookingConfirmed((data) => {
      if (data.orderId === orderId && !bookingModalShownRef.current) {
        console.log('[ORDER] ✅ Booking confirmed via socket:', data);
        // Afficher le popup de confirmation au lieu de naviguer
        bookingModalShownRef.current = true;
        setBookingConfirmData({
          driverName: data.driverName,
          scheduledTime: data.scheduledTime,
        });
        setShowBookingConfirmModal(true);
        setStatus('found');
      }
    });

    const unsubscribeOrderExpired = onOrderExpired((data) => {
      if (data.orderId === orderId) {
        setStatus('expired');
      }
    });

    const unsubscribeJoinError = onClientJoinError((data) => {
      console.log('[ORDER] Client join info:', data.message);
      if (data.message === 'Commande non trouvée') {
        console.log('[ORDER] Order not found on server - waiting for expiration or driver assignment');
        return;
      }
      setError(data.message);
      setStatus('error');
    });

    return () => {
      unsubscribeDriverAssigned();
      unsubscribeFraisOfferts();
      unsubscribeBookingConfirmed();
      unsubscribeOrderExpired();
      unsubscribeJoinError();
    };
  }, [orderId, status]);

  // Polling fallback - vérifier le statut de la commande toutes les 3 secondes
  // Ceci est un backup en cas de problème avec Socket.IO
  useEffect(() => {
    if (!orderId || status !== 'searching') return;

    const pollOrderStatus = async () => {
      try {
        const orderData = await getOrder(orderId);
        setOrderDetails(orderData);
        console.log('[ORDER] Polling - order status:', orderData.status);
        
        // ═══ RÉSERVATION À L'AVANCE: Gérer le statut 'booked' ═══
        if (orderData.status === 'booked' && orderData.assignedDriverId) {
          // Réservation confirmée - afficher le popup
          if (!bookingModalShownRef.current) {
            console.log('[ORDER] ✅ Booking confirmed via polling, showing modal');
            console.log('[ORDER] Driver name:', orderData.driver?.name);
            console.log('[ORDER] Scheduled time:', orderData.scheduledTime);
            bookingModalShownRef.current = true;
            setBookingConfirmData({
              driverName: orderData.driver?.name || 'Chauffeur',
              scheduledTime: orderData.scheduledTime || '',
            });
            setShowBookingConfirmModal(true);
            setStatus('found');
          }
        }
        // Si un chauffeur a été assigné (statut accepted ou plus avancé)
        else {
          const acceptedStatuses = ['accepted', 'driver_enroute', 'driver_arrived', 'in_progress', 'completed', 'payment_pending', 'payment_confirmed'];
          if (acceptedStatuses.includes(orderData.status) && orderData.assignedDriverId) {
            // Ne naviguer qu'une seule fois pour éviter les boucles infinies
            if (!hasNavigatedRef.current) {
              console.log('[ORDER] Driver assigned via polling, navigating to course-en-cours');
              hasNavigatedRef.current = true;
              router.replace({
                pathname: '/(client)/ride/course-en-cours',
                params: {
                  orderId,
                  pickup: params.pickup,
                  destination: params.destination,
                  totalPrice: params.totalPrice,
                },
              });
            }
          }
        }
        
        if (orderData.status === 'expired' || orderData.status === 'cancelled') {
          setStatus('expired');
        }
      } catch (error) {
        console.log('[ORDER] Polling error (continuing):', error);
        // Ne pas afficher d'erreur, le polling continuera
      }
    };

    // Premier poll après 2 secondes, puis toutes les 3 secondes
    const initialTimeout = setTimeout(pollOrderStatus, 2000);
    const pollInterval = setInterval(pollOrderStatus, 3000);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(pollInterval);
    };
  }, [orderId, status, params]);

  // ═══════════════════════════════════════════════════════════════════════════
  // RÉSERVATION À L'AVANCE: Empêcher le retour en arrière si réservation confirmée
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      // Si une réservation est confirmée, empêcher le retour en arrière
      if (status === 'found' && !driverInfo && showBookingConfirmModal) {
        // Rediriger vers l'accueil ou les commandes au lieu de retourner
        setShowBookingConfirmModal(false);
        router.replace('/(client)');
        return true; // Empêcher le comportement par défaut
      }
      return false; // Comportement normal
    });

    return () => backHandler.remove();
  }, [status, driverInfo, showBookingConfirmModal, router]);

  // Cleanup automatique : Annuler la commande si le client quitte la page
  useEffect(() => {
    // Réinitialiser le flag de cleanup quand le composant monte
    cleanupDoneRef.current = false;
    
    return () => {
      // Cleanup quand le composant se démonte (retour arrière, fermeture de l'app, etc.)
      if (cleanupDoneRef.current) return; // Éviter les doubles cleanups
      cleanupDoneRef.current = true;
      
      const cleanup = async () => {
        // Ne nettoyer que si on est toujours en recherche (pas si on a trouvé un chauffeur ou autre)
        if (orderId && clientToken && status === 'searching') {
          try {
            // Vérifier le statut réel de la commande avant d'annuler
            // Si un chauffeur a été assigné, ne pas annuler
            const orderData = await getOrder(orderId);
            const acceptedStatuses = ['accepted', 'driver_enroute', 'driver_arrived', 'in_progress', 'completed', 'payment_pending', 'payment_confirmed'];
            
            if (orderData.assignedDriverId || acceptedStatuses.includes(orderData.status)) {
              console.log('[ORDER] Driver already assigned or order in progress, skipping auto-cancel:', orderId, 'status:', orderData.status);
              // Ne pas annuler, juste nettoyer les données locales
            } else {
              console.log('[ORDER] Auto-cancelling order on unmount:', orderId);
              await cancelOrder(orderId, clientToken, 'Client a quitté la page de recherche');
            }
          } catch (error) {
            console.error('[ORDER] Error checking order status or auto-cancelling:', error);
            // En cas d'erreur, ne pas annuler pour éviter d'annuler une commande valide
          }
        }
        // Nettoyer les données locales dans tous les cas
        if (clientToken) {
          await removeClientToken().catch(() => {});
        }
        if (orderId) {
          await removeCurrentOrderId().catch(() => {});
        }
        disconnectSocket();
      };
      cleanup();
    };
  }, [orderId, clientToken, status]);

  const formatPrice = (price: string) => {
    const num = parseFloat(price);
    return `${num.toLocaleString('fr-FR')} XPF`;
  };

  // Annuler la recherche et la commande côté serveur (avec confirmation)
  const handleCancel = () => {
    Alert.alert(
      'Annuler la recherche ?',
      'Êtes-vous sûr de vouloir annuler cette recherche ? La commande sera annulée et ne sera plus visible pour les chauffeurs.',
      [
        {
          text: 'Non, garder',
          style: 'cancel',
        },
        {
          text: 'Oui, annuler',
          style: 'destructive',
          onPress: async () => {
            try {
              // Annuler la commande côté serveur
              if (orderId && clientToken) {
                console.log('[ORDER] Cancelling order:', orderId);
                await cancelOrder(orderId, clientToken, 'Recherche annulée par le client');
              }
            } catch (error) {
              console.error('[ORDER] Error cancelling order:', error);
              // On continue quand même le nettoyage local
            }
            
            // Nettoyer les données stockées
            if (clientToken) {
              await removeClientToken();
            }
            if (orderId) {
              await removeCurrentOrderId();
            }
            disconnectSocket();
            router.replace('/(client)');
          },
        },
      ]
    );
  };
  
  // Retourner à la page d'accueil SANS annuler la recherche - laisser la course visible
  const handleGoHome = async () => {
    // Marquer que le cleanup automatique ne doit PAS annuler (on veut garder la course active)
    cleanupDoneRef.current = true;
    
    // Ne PAS annuler la commande - on veut qu'elle reste active pour affichage sur la page d'accueil
    // Ne PAS nettoyer les données locales - elles sont nécessaires pour afficher la course sur la page d'accueil
    
    // Ne PAS déconnecter le socket - nécessaire pour recevoir les mises à jour
    
    // Aller directement à la page d'accueil
    router.replace('/(client)');
  };

  // Retourner à la page taxi immédiat ET annuler la course avec confirmation
  const handleGoBackToTaxiImmediat = () => {
    Alert.alert(
      'Annuler la recherche ?',
      'Êtes-vous sûr de vouloir retourner à la page de commande ? La recherche en cours sera annulée et la commande ne sera plus visible pour les chauffeurs.',
      [
        {
          text: 'Non, garder',
          style: 'cancel',
        },
        {
          text: 'Oui, annuler',
          style: 'destructive',
          onPress: async () => {
            // Récupérer les infos de la commande avant de l'annuler pour les passer à commande-options
            let fetchedOrderData = null;
            if (orderId) {
              try {
                fetchedOrderData = await getOrder(orderId);
              } catch (error) {
                console.error('[ORDER] Error fetching order before cancel:', error);
              }
            }
            
            try {
              // Annuler la commande côté serveur
              if (orderId && clientToken) {
                console.log('[ORDER] Cancelling order on back to taxi immediat:', orderId);
                await cancelOrder(orderId, clientToken, 'Retour à la page de commande - recherche annulée');
              }
            } catch (error) {
              console.error('[ORDER] Error cancelling order:', error);
              // On continue quand même le nettoyage local
            }
            
            // Nettoyer les données stockées
            if (clientToken) {
              await removeClientToken();
            }
            if (orderId) {
              await removeCurrentOrderId();
            }
            disconnectSocket();
            
            // Retourner à la page commande-options avec les paramètres de la commande annulée
            if (fetchedOrderData) {
              const addresses = fetchedOrderData.addresses || [];
              const pickupAddress = addresses.find((a: any) => a.type === 'pickup' || !a.type) || addresses[0];
              const destinationAddress = addresses.find((a: any) => a.type === 'destination') || addresses[addresses.length - 1];
              const stops = addresses.filter((a: any) => a.type === 'stop') || [];
              const pickupAddressAny = pickupAddress as any;
              const destinationAddressAny = destinationAddress as any;
              
              router.replace({
                pathname: '/(client)/commande-options',
                params: {
                  type: fetchedOrderData.rideOption?.id || 'immediate',
                  pickup: pickupAddressAny?.value || pickupAddressAny?.address || params.pickup || '',
                  pickupPlaceId: pickupAddressAny?.placeId || params.pickupPlaceId || '',
                  pickupLat: pickupAddressAny?.lat?.toString() || pickupAddressAny?.coordinates?.lat?.toString() || params.pickupLat || '',
                  pickupLng: pickupAddressAny?.lng?.toString() || pickupAddressAny?.coordinates?.lng?.toString() || params.pickupLng || '',
                  destination: destinationAddressAny?.value || destinationAddressAny?.address || params.destination || '',
                  destinationPlaceId: destinationAddressAny?.placeId || params.destinationPlaceId || '',
                  destinationLat: destinationAddressAny?.lat?.toString() || destinationAddressAny?.coordinates?.lat?.toString() || params.destinationLat || '',
                  destinationLng: destinationAddressAny?.lng?.toString() || destinationAddressAny?.coordinates?.lng?.toString() || params.destinationLng || '',
                  stops: stops.length > 0 ? JSON.stringify(stops) : params.stops || '',
                },
              });
            } else {
              // Fallback : utiliser les params actuels si on ne peut pas récupérer la commande
              router.replace({
                pathname: '/(client)/commande-options',
                params: {
                  type: params.type || 'immediate',
                  pickup: params.pickup || '',
                  pickupPlaceId: params.pickupPlaceId || '',
                  pickupLat: params.pickupLat || '',
                  pickupLng: params.pickupLng || '',
                  destination: params.destination || '',
                  destinationPlaceId: params.destinationPlaceId || '',
                  destinationLat: params.destinationLat || '',
                  destinationLng: params.destinationLng || '',
                  stops: params.stops || '',
                },
              });
            }
          },
        },
      ]
    );
  };

  const handleConfirm = () => {
    if (!orderId) {
      Alert.alert('Erreur', 'Commande non trouvée');
      return;
    }

    router.replace({
      pathname: '/(client)/ride/course-en-cours',
      params: {
        orderId,
        pickup: params.pickup,
        destination: params.destination,
        totalPrice: params.totalPrice,
      },
    });
  };

  if (status === 'creating') {
    return (
      <LoadingOverlay
        title="Création de la commande..."
        subtitle="Veuillez patienter"
      />
    );
  }

  if (status === 'error') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleCancel} style={styles.backButton}>
            <Ionicons name="close" size={24} color="#1a1a1a" />
          </TouchableOpacity>
          <Text variant="h2">
            Erreur
          </Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.searchingContainer}>
          <Ionicons name="alert-circle" size={64} color="#EF4444" />
          <Text variant="h3" style={styles.searchingText}>
            Erreur
          </Text>
          <Text variant="body" style={styles.errorText}>
            {error || 'Une erreur est survenue'}
          </Text>
        </View>

        <View style={styles.footer}>
          <Button title="Retour" onPress={handleGoBackToTaxiImmediat} fullWidth />
        </View>
      </SafeAreaView>
    );
  }

  if (status === 'searching') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleGoHome} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
          </TouchableOpacity>
          <Text variant="h2">Recherche en cours</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.searchingContainer}>
          <View style={styles.pulseContainer}>
            <ActivityIndicator size="large" color="#F5C400" />
          </View>
          <Text variant="h3" style={styles.searchingText}>
            {"Recherche d'un chauffeur..."}
          </Text>
          <Text variant="body" style={styles.searchingSubtext}>
            {Math.floor(searchTime / 60)}:{(searchTime % 60).toString().padStart(2, '0')}
          </Text>
          {searchTime >= 120 && (
            <Text variant="body" style={styles.waitingMessage}>
              Désolé pour l'attente, nous nous efforçons de trouver un chauffeur
            </Text>
          )}

          <Card style={styles.tripCard}>
            {/* Départ */}
            <View style={styles.tripRow}>
              <View style={[styles.dot, { backgroundColor: '#22C55E' }]} />
              <Text variant="body" numberOfLines={2} style={styles.tripAddress}>
                {params.pickup}
              </Text>
            </View>

            {/* Arrêts intermédiaires pendant la recherche */}
            {params.stops && params.stops !== '[]' && (
              <>
                {(() => {
                  try {
                    const parsed = JSON.parse(params.stops) as Array<{ value?: string; address?: string; id?: string }>;
                    return parsed
                      .filter((s) => (s.value || s.address)?.trim())
                      .map((s, index) => (
                        <View key={s.id || `stop-${index}`} style={styles.tripRow}>
                          <View style={[styles.dot, { backgroundColor: '#F5C400' }]} />
                          <Text variant="body" numberOfLines={2} style={styles.tripAddress}>
                            {(s.value || s.address || '').trim()}
                          </Text>
                        </View>
                      ));
                  } catch {
                    return null;
                  }
                })()}
              </>
            )}

            {/* Destination */}
            <View style={styles.tripRow}>
              <View style={[styles.dot, { backgroundColor: '#EF4444' }]} />
              <Text variant="body" numberOfLines={2} style={styles.tripAddress}>
                {params.destination}
              </Text>
            </View>

            <View style={styles.tripPriceRow}>
              <Text variant="label">Prix estimé</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TouchableOpacity
                  onPress={() => setShowPriceDetailsModal(true)}
                  style={styles.infoButton}
                >
                  <Ionicons name="information-circle" size={20} color="#22C55E" />
                </TouchableOpacity>
                <Text variant="h3" style={styles.priceText}>
                  {formatPrice(String(orderDetails?.totalPrice ?? params.totalPrice ?? '0'))}
                </Text>
              </View>
            </View>
          </Card>
        </View>

        {/* Price Details Modal */}
        <Modal
          visible={showPriceDetailsModal}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setShowPriceDetailsModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text variant="h2" style={styles.modalTitle}>Détails de la commande</Text>
                <TouchableOpacity
                  onPress={() => setShowPriceDetailsModal(false)}
                  style={styles.modalCloseButton}
                >
                  <Ionicons name="close" size={24} color="#1a1a1a" />
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.modalScrollView} showsVerticalScrollIndicator={false}>
                {(() => {
                  // Tour de l'île: prix fixe, pas de décomposition
                  const isTourType = params.type === 'tour';
                  const TOUR_FIXED_PRICE = 30000;
                  
                  if (isTourType) {
                    return (
                      <View style={styles.detailSection}>
                        <Text style={styles.detailSectionTitle}>Détails du tarif</Text>
                        <View style={styles.priceDetailRow}>
                          <Text style={styles.priceDetailLabel}>Tour de l'île (forfait)</Text>
                          <Text style={styles.priceDetailValue}>{formatPrice(TOUR_FIXED_PRICE.toString())}</Text>
                        </View>
                        <View style={styles.priceDetailSeparator} />
                        <View style={styles.priceDetailRowTotal}>
                          <Text style={styles.priceDetailLabelTotal}>Prix total</Text>
                          <Text style={styles.priceDetailValueTotal}>{formatPrice(TOUR_FIXED_PRICE.toString())}</Text>
                        </View>
                      </View>
                    );
                  }
                  
                  // Calculer les prix basés sur les tarifs et params
                  const priseEnCharge = tarifs.find(t => t.typeTarif === 'prise_en_charge')?.prixXpf || 1000;
                  const routeInfo = params.routeInfo ? JSON.parse(params.routeInfo) : null;
                  const distance = routeInfo?.distance || 0;
                  
                  // Déterminer si c'est jour ou nuit
                  const orderDate = orderCreatedAt || new Date();
                  const orderHour = orderDate instanceof Date ? orderDate.getHours() : new Date(orderDate).getHours();
                  const tarifJour = tarifs.find(t => t.typeTarif === 'kilometre_jour');
                  const tarifNuit = tarifs.find(t => t.typeTarif === 'kilometre_nuit');
                  
                  // Déterminer le tarif kilométrique
                  let pricePerKm = tarifJour?.prixXpf || 150;
                  let period: 'jour' | 'nuit' = 'jour';
                  
                  if (tarifJour?.heureDebut && tarifJour.heureFin) {
                    const [debutH] = tarifJour.heureDebut.split(':').map(Number);
                    const [finH] = tarifJour.heureFin.split(':').map(Number);
                    if (debutH <= finH) {
                      if (orderHour >= debutH && orderHour < finH) {
                        pricePerKm = tarifJour.prixXpf;
                        period = 'jour';
                      } else {
                        pricePerKm = tarifNuit?.prixXpf || 260;
                        period = 'nuit';
                      }
                    }
                  } else {
                    if (orderHour >= 6 && orderHour < 20) {
                      pricePerKm = tarifJour?.prixXpf || 150;
                      period = 'jour';
                    } else {
                      pricePerKm = tarifNuit?.prixXpf || 260;
                      period = 'nuit';
                    }
                  }
                  
                  const distancePrice = distance * pricePerKm;
                  
                  // Suppléments
                  let supplements: Supplement[] = [];
                  if (params.supplements && params.supplements !== '[]' && params.supplements.trim() !== '') {
                    try {
                      const parsed = JSON.parse(params.supplements);
                      if (Array.isArray(parsed)) {
                        supplements = parsed.filter((s: any) => s && s.price && s.quantity);
                      }
                    } catch (e) {
                      console.warn('Failed to parse supplements:', e);
                    }
                  }
                  const effectiveSupplements = Array.isArray(orderDetails?.supplements) && orderDetails.supplements.length > 0
                    ? orderDetails.supplements
                    : supplements;
                  const supplementsTotal = effectiveSupplements.reduce(
                    (sum: number, s: any) => sum + (s.price * (s.quantity || 1)),
                    0
                  );
                  
                  // Majoration passagers (500 XPF si >= 5 passagers)
                  const passengers = parseInt(params.passengers || '1', 10);
                  const majorationPassagers = passengers >= 5 ? 500 : 0;
                  
                  return (
                    <>
                      {/* Décomposition du prix */}
                      <View style={styles.detailSection}>
                        <Text style={styles.detailSectionTitle}>Décomposition du prix</Text>
                        
                        {/* Prise en charge */}
                        <View style={styles.priceDetailRow}>
                          <Text style={styles.priceDetailLabel}>Prise en charge</Text>
                          <Text style={styles.priceDetailValue}>{formatPrice(priseEnCharge.toString())}</Text>
                        </View>
                        
                        {/* Distance × tarif kilométrique */}
                        {distance > 0 && (
                          <View style={styles.priceDetailRow}>
                            <View style={styles.priceDetailLabelContainer}>
                              <Text style={styles.priceDetailLabel}>
                                {distance.toFixed(2)} km × {pricePerKm} XPF/km ({period})
                              </Text>
                            </View>
                            <Text style={styles.priceDetailValue}>{formatPrice(distancePrice.toString())}</Text>
                          </View>
                        )}
                        
                        {/* Majoration passagers */}
                        {majorationPassagers > 0 && (
                          <View style={styles.priceDetailRow}>
                            <Text style={styles.priceDetailLabel}>Majoration passagers (≥5)</Text>
                            <Text style={styles.priceDetailValue}>{formatPrice(majorationPassagers.toString())}</Text>
                          </View>
                        )}
                        
                        {/* Suppléments */}
                        {supplementsTotal > 0 && (
                          <View style={styles.priceDetailRow}>
                            <Text style={styles.priceDetailLabel}>Suppléments</Text>
                            <Text style={styles.priceDetailValue}>{formatPrice(supplementsTotal.toString())}</Text>
                          </View>
                        )}
                        
                        <View style={styles.priceDetailSeparator} />
                        
                        {/* Prix total */}
                        <View style={styles.priceDetailRowTotal}>
                          <Text style={styles.priceDetailLabelTotal}>Prix total</Text>
                          <Text style={styles.priceDetailValueTotal}>{formatPrice(String(orderDetails?.totalPrice ?? params.totalPrice ?? '0'))}</Text>
                        </View>
                      </View>

                      {/* Suppléments détaillés */}
                      {effectiveSupplements.length > 0 && (
                        <View style={styles.detailSection}>
                          <Text style={styles.detailSectionTitle}>Détails des suppléments</Text>
                          {effectiveSupplements.map((supplement: any, index: number) => (
                            <View key={index} style={styles.supplementRow}>
                              <View style={styles.supplementInfo}>
                                {supplement.icon && (
                                  <Ionicons name={supplement.icon as any} size={20} color="#22C55E" style={{ marginRight: 8 }} />
                                )}
                                <Text style={styles.supplementName}>{supplement.name}</Text>
                                {supplement.quantity > 1 && (
                                  <Text style={styles.supplementQuantity}> × {supplement.quantity}</Text>
                                )}
                              </View>
                              <Text style={styles.supplementPrice}>
                                {formatPrice(((supplement.price || 0) * (supplement.quantity || 1)).toString())}
                              </Text>
                            </View>
                          ))}
                        </View>
                      )}

                      {/* Message du client */}
                      {params.driverComment && (
                        <View style={styles.detailSection}>
                          <Text style={styles.detailSectionTitle}>Message pour le chauffeur</Text>
                          <View style={styles.messageBox}>
                            <Text style={styles.messageText}>{params.driverComment}</Text>
                          </View>
                        </View>
                      )}

                      {/* Informations de course */}
                      <View style={styles.detailSection}>
                        <Text style={styles.detailSectionTitle}>Informations</Text>
                        <View style={styles.infoRow}>
                          <Text style={styles.infoLabel}>Passagers:</Text>
                          <Text style={styles.infoValue}>{passengers}</Text>
                        </View>
                        <View style={styles.infoRow}>
                          <Text style={styles.infoLabel}>Paiement:</Text>
                          <Text style={styles.infoValue}>
                            {params.paymentMethod === 'card' ? 'Carte (TPE)' : 'Espèces'}
                          </Text>
                        </View>
                      </View>
                    </>
                  );
                })()}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* ═══════════════════════════════════════════════════════════════════════════
            RÉSERVATION À L'AVANCE: Modal de confirmation de réservation
            ═══════════════════════════════════════════════════════════════════════════ */}
        <Modal
          visible={showBookingConfirmModal}
          transparent={true}
          animationType="slide"
          onRequestClose={() => {}}
        >
          <View style={styles.bookingModalOverlay}>
            <View style={styles.bookingModalContent}>
              <View style={styles.bookingModalIconContainer}>
                <Ionicons name="checkmark-circle" size={64} color="#22C55E" />
              </View>
              
              <Text style={styles.bookingModalTitle}>Réservation confirmée !</Text>
              <Text style={styles.bookingModalSubtitle}>
                Un chauffeur a accepté votre réservation
              </Text>
              
              {/* Infos chauffeur */}
              <View style={styles.bookingDriverCard}>
                <View style={styles.bookingDriverAvatar}>
                  <Ionicons name="person" size={32} color="#F5C400" />
                </View>
                <View style={styles.bookingDriverInfo}>
                  <Text style={styles.bookingDriverName}>
                    {bookingConfirmData?.driverName || 'Chauffeur'}
                  </Text>
                  <Text style={styles.bookingDriverLabel}>Votre chauffeur</Text>
                </View>
              </View>
              
              {/* Date et heure de réservation */}
              {bookingConfirmData?.scheduledTime && (
                <View style={styles.bookingScheduleCard}>
                  <Ionicons name="calendar" size={24} color="#8B5CF6" />
                  <View style={styles.bookingScheduleInfo}>
                    <Text style={styles.bookingScheduleDate}>
                      {new Date(bookingConfirmData.scheduledTime).toLocaleDateString('fr-FR', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                        timeZone: 'Pacific/Tahiti',
                      })}
                    </Text>
                    <Text style={styles.bookingScheduleTime}>
                      à {new Date(bookingConfirmData.scheduledTime).toLocaleTimeString('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'Pacific/Tahiti',
                      })}
                    </Text>
                  </View>
                </View>
              )}
              
              {/* Adresses */}
              <View style={styles.bookingAddressesCard}>
                <View style={styles.bookingAddressRow}>
                  <View style={[styles.dot, { backgroundColor: '#22C55E' }]} />
                  <Text style={styles.bookingAddressText} numberOfLines={1}>
                    {params.pickup}
                  </Text>
                </View>
                <View style={styles.bookingAddressLine} />
                <View style={styles.bookingAddressRow}>
                  <View style={[styles.dot, { backgroundColor: '#EF4444' }]} />
                  <Text style={styles.bookingAddressText} numberOfLines={1}>
                    {params.destination}
                  </Text>
                </View>
              </View>
              
              {/* Prix */}
              <View style={styles.bookingPriceRow}>
                <Text style={styles.bookingPriceLabel}>Prix estimé</Text>
                <Text style={styles.bookingPriceValue}>
                  {formatPrice(params.totalPrice || '0')}
                </Text>
              </View>
              
              {/* Boutons */}
              <View style={styles.bookingModalButtons}>
                <TouchableOpacity
                  style={styles.bookingViewButton}
                  onPress={() => {
                    setShowBookingConfirmModal(false);
                    // Invalider les queries pour forcer le rafraîchissement
                    queryClient.invalidateQueries({ queryKey: ['client-orders'] });
                    // Naviguer vers commandes avec un paramètre pour indiquer qu'on vient du modal
                    // La page commandes nettoiera l'historique si nécessaire
                    router.replace({
                      pathname: '/(client)/commandes',
                      params: { fromBooking: 'true' }
                    });
                  }}
                >
                  <Ionicons name="list" size={20} color="#FFFFFF" />
                  <Text style={styles.bookingViewButtonText}>Voir mes réservations</Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={styles.bookingCloseButton}
                  onPress={() => {
                    setShowBookingConfirmModal(false);
                    router.replace('/(client)');
                  }}
                >
                  <Text style={styles.bookingCloseButtonText}>Retour à l'accueil</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <View style={styles.footer}>
          <View style={styles.footerButtons}>
            <TouchableOpacity style={styles.homeButton} onPress={handleGoBackToTaxiImmediat}>
              <Ionicons name="arrow-back" size={18} color="#6B7280" />
              <Text style={styles.homeButtonText}>Retour</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
              <Ionicons name="close-circle" size={18} color="#EF4444" />
              <Text style={styles.cancelButtonText}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (status === 'found' && driverInfo) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleCancel} style={styles.backButton}>
            <Ionicons name="close" size={24} color="#1a1a1a" />
          </TouchableOpacity>
          <Text variant="h2">Chauffeur trouvé</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.foundContainer}>
          <View style={styles.driverCard}>
            <View style={styles.driverAvatar}>
              <Ionicons name="person" size={48} color="#F5C400" />
            </View>
            <Text variant="h3">{driverInfo.name}</Text>
          </View>

          <Card style={styles.tripCard}>
            {/* Départ */}
            <View style={styles.tripRow}>
              <View style={[styles.dot, { backgroundColor: '#22C55E' }]} />
              <Text variant="body" numberOfLines={2} style={styles.tripAddress}>
                {params.pickup}
              </Text>
            </View>

            {/* Arrêts intermédiaires lorsque le chauffeur est trouvé */}
            {params.stops && params.stops !== '[]' && (
              <>
                {(() => {
                  try {
                    const parsed = JSON.parse(params.stops) as Array<{ value?: string; address?: string; id?: string }>;
                    return parsed
                      .filter((s) => (s.value || s.address)?.trim())
                      .map((s, index) => (
                        <View key={s.id || `stop-found-${index}`} style={styles.tripRow}>
                          <View style={[styles.dot, { backgroundColor: '#F5C400' }]} />
                          <Text variant="body" numberOfLines={2} style={styles.tripAddress}>
                            {(s.value || s.address || '').trim()}
                          </Text>
                        </View>
                      ));
                  } catch {
                    return null;
                  }
                })()}
              </>
            )}

            {/* Destination */}
            <View style={styles.tripRow}>
              <View style={[styles.dot, { backgroundColor: '#EF4444' }]} />
              <Text variant="body" numberOfLines={2} style={styles.tripAddress}>
                {params.destination}
              </Text>
            </View>

            <View style={styles.tripPriceRow}>
              <Text variant="label">Prix de la course</Text>
              <Text variant="h3" style={styles.priceText}>
                {formatPrice(params.totalPrice || '0')}
              </Text>
            </View>
          </Card>
        </View>

        <View style={styles.footer}>
          <Button title="Commencer la course" onPress={handleConfirm} fullWidth />
        </View>
      </SafeAreaView>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RÉSERVATION À L'AVANCE: Cas où status='found' mais pas de driverInfo
  // Le modal de confirmation de réservation s'affiche par-dessus
  // ═══════════════════════════════════════════════════════════════════════════
  if (status === 'found' && !driverInfo) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {/* Fond avec indicateur de chargement */}
        <View style={styles.bookingBackdrop}>
          <View style={styles.bookingBackdropContent}>
            <Ionicons name="checkmark-circle" size={80} color="#22C55E" />
            <Text style={styles.bookingBackdropText}>Réservation confirmée !</Text>
          </View>
        </View>
        
        {/* Modal de confirmation de réservation */}
        <Modal
          visible={showBookingConfirmModal}
          transparent={true}
          animationType="slide"
          onRequestClose={() => {}}
        >
          <View style={styles.bookingModalOverlay}>
            <View style={styles.bookingModalContent}>
              <View style={styles.bookingModalIconContainer}>
                <Ionicons name="checkmark-circle" size={64} color="#22C55E" />
              </View>
              
              <Text style={styles.bookingModalTitle}>Réservation confirmée !</Text>
              <Text style={styles.bookingModalSubtitle}>
                Un chauffeur a accepté votre réservation
              </Text>
              
              {/* Infos chauffeur */}
              <View style={styles.bookingDriverCard}>
                <View style={styles.bookingDriverAvatar}>
                  <Ionicons name="person" size={32} color="#F5C400" />
                </View>
                <View style={styles.bookingDriverInfo}>
                  <Text style={styles.bookingDriverName}>
                    {bookingConfirmData?.driverName || 'Chauffeur'}
                  </Text>
                  <Text style={styles.bookingDriverLabel}>Votre chauffeur</Text>
                </View>
              </View>
              
              {/* Date et heure de réservation */}
              {bookingConfirmData?.scheduledTime && (
                <View style={styles.bookingScheduleCard}>
                  <Ionicons name="calendar" size={24} color="#8B5CF6" />
                  <View style={styles.bookingScheduleInfo}>
                    <Text style={styles.bookingScheduleDate}>
                      {new Date(bookingConfirmData.scheduledTime).toLocaleDateString('fr-FR', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                        timeZone: 'Pacific/Tahiti',
                      })}
                    </Text>
                    <Text style={styles.bookingScheduleTime}>
                      à {new Date(bookingConfirmData.scheduledTime).toLocaleTimeString('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'Pacific/Tahiti',
                      })}
                    </Text>
                  </View>
                </View>
              )}
              
              {/* Adresses */}
              <View style={styles.bookingAddressesCard}>
                <View style={styles.bookingAddressRow}>
                  <View style={[styles.dot, { backgroundColor: '#22C55E' }]} />
                  <Text style={styles.bookingAddressText} numberOfLines={1}>
                    {params.pickup}
                  </Text>
                </View>
                <View style={styles.bookingAddressLine} />
                <View style={styles.bookingAddressRow}>
                  <View style={[styles.dot, { backgroundColor: '#EF4444' }]} />
                  <Text style={styles.bookingAddressText} numberOfLines={1}>
                    {params.destination}
                  </Text>
                </View>
              </View>
              
              {/* Prix */}
              <View style={styles.bookingPriceRow}>
                <Text style={styles.bookingPriceLabel}>Prix estimé</Text>
                <Text style={styles.bookingPriceValue}>
                  {formatPrice(params.totalPrice || '0')}
                </Text>
              </View>
              
              {/* Boutons */}
              <View style={styles.bookingModalButtons}>
                <TouchableOpacity
                  style={styles.bookingViewButton}
                  onPress={() => {
                    setShowBookingConfirmModal(false);
                    // Invalider les queries pour forcer le rafraîchissement
                    queryClient.invalidateQueries({ queryKey: ['client-orders'] });
                    // Naviguer vers commandes avec un paramètre pour indiquer qu'on vient du modal
                    // La page commandes nettoiera l'historique si nécessaire
                    router.replace({
                      pathname: '/(client)/commandes',
                      params: { fromBooking: 'true' }
                    });
                  }}
                >
                  <Ionicons name="list" size={20} color="#FFFFFF" />
                  <Text style={styles.bookingViewButtonText}>Voir mes réservations</Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={styles.bookingCloseButton}
                  onPress={() => {
                    setShowBookingConfirmModal(false);
                    router.replace('/(client)');
                  }}
                >
                  <Text style={styles.bookingCloseButtonText}>Retour à l'accueil</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  if (status === 'expired') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleGoHome} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
          </TouchableOpacity>
          <Text variant="h2">Commande expirée</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView 
          style={styles.expiredScrollView}
          contentContainerStyle={styles.expiredScrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.expiredContainer}>
            {/* Icône avec animation visuelle */}
            <View style={styles.expiredIconWrapper}>
              <View style={styles.expiredIconBg}>
                <View style={styles.expiredIconInner}>
                  <Ionicons name="time-outline" size={56} color="#F5C400" />
                </View>
              </View>
              <View style={styles.expiredIconRing} />
            </View>

            {/* Titre principal avec meilleure typographie */}
            <Text style={styles.expiredTitle}>
              Aucun chauffeur disponible
            </Text>

            {/* Message d'excuses dans une carte élégante */}
            <View style={styles.expiredMessageCard}>
              <View style={styles.expiredMessageIconWrapper}>
                <Ionicons name="information-circle" size={24} color="#F5C400" />
              </View>
              <Text style={styles.expiredMessage}>
                Nous sommes vraiment désolés, mais aucun chauffeur n'était disponible dans votre secteur au moment de votre commande.
              </Text>
              <Text style={styles.expiredMessageDetail}>
                Nos chauffeurs peuvent être très sollicités. N'hésitez pas à réessayer dans quelques instants !
              </Text>
            </View>

            {/* Suggestions avec design premium */}
            <View style={styles.expiredSuggestionsSection}>
              <Text style={styles.expiredSuggestionsSectionTitle}>💡 Nos conseils</Text>
              <View style={styles.expiredSuggestionsGrid}>
                <View style={styles.expiredSuggestionCard}>
                  <View style={styles.expiredSuggestionIconWrapper}>
                    <Ionicons name="time" size={26} color="#F5C400" />
                  </View>
                  <Text style={styles.expiredSuggestionTitle}>Réessayez plus tard</Text>
                  <Text style={styles.expiredSuggestionDescription}>
                    Attendez 5-10 minutes puis relancez votre recherche
                  </Text>
                </View>
                
                <View style={styles.expiredSuggestionCard}>
                  <View style={styles.expiredSuggestionIconWrapper}>
                    <Ionicons name="location" size={26} color="#F5C400" />
                  </View>
                  <Text style={styles.expiredSuggestionTitle}>Vérifiez l'adresse</Text>
                  <Text style={styles.expiredSuggestionDescription}>
                    Assurez-vous que votre localisation est correcte
                  </Text>
                </View>
                
                <View style={styles.expiredSuggestionCard}>
                  <View style={styles.expiredSuggestionIconWrapper}>
                    <Ionicons name="calendar-outline" size={26} color="#F5C400" />
                  </View>
                  <Text style={styles.expiredSuggestionTitle}>Réservation à l'avance</Text>
                  <Text style={styles.expiredSuggestionDescription}>
                    Planifiez votre course à l'avance pour plus de garantie
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </ScrollView>

        {/* Footer avec design premium */}
        <View style={styles.expiredFooter}>
          <TouchableOpacity
            style={styles.expiredRetryButton}
            onPress={() => {
              if (clientToken) {
                removeClientToken();
              }
              if (orderId) {
                removeCurrentOrderId();
              }
              disconnectSocket();
              router.replace('/(client)');
            }}
            activeOpacity={0.85}
          >
            <Ionicons name="refresh-circle" size={22} color="#1a1a1a" style={{ marginRight: 10 }} />
            <Text style={styles.expiredRetryButtonText}>Réessayer maintenant</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.expiredBackButton}
            onPress={handleGoHome}
            activeOpacity={0.7}
          >
            <Ionicons name="home-outline" size={18} color="#6B7280" style={{ marginRight: 6 }} />
            <Text style={styles.expiredBackButtonText}>Retour à l'accueil</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  searchingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  pulseContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  searchingText: {
    marginBottom: 8,
    textAlign: 'center',
  },
  searchingSubtext: {
    color: '#6b7280',
    marginBottom: 16,
  },
  waitingMessage: {
    color: '#F59E0B',
    textAlign: 'center',
    marginBottom: 16,
    paddingHorizontal: 20,
    fontStyle: 'italic',
  },
  errorText: {
    color: '#EF4444',
    textAlign: 'center',
    marginTop: 16,
  },
  foundContainer: {
    flex: 1,
    padding: 20,
    alignItems: 'center',
  },
  driverCard: {
    alignItems: 'center',
    marginBottom: 24,
  },
  driverAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  tripCard: {
    padding: 16,
    width: '100%',
  },
  tripRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
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
  tripPriceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 12,
    marginTop: 4,
  },
  priceText: {
    color: '#F5C400',
  },
  notFoundContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  // Page Commande expirée - Design premium moderne
  expiredScrollView: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  expiredScrollContent: {
    flexGrow: 1,
    paddingBottom: 24,
  },
  expiredContainer: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 32,
    paddingBottom: 20,
  },
  expiredIconWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
    position: 'relative',
  },
  expiredIconBg: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#FFF9E6',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 5,
    borderColor: '#F5C400',
    shadowColor: '#F5C400',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 12,
  },
  expiredIconInner: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  expiredIconRing: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 2,
    borderColor: 'rgba(245, 196, 0, 0.2)',
    borderStyle: 'dashed',
  },
  expiredTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1a1a1a',
    textAlign: 'center',
    marginBottom: 24,
    letterSpacing: 0.3,
    paddingHorizontal: 16,
    lineHeight: 34,
  },
  expiredMessageCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    marginBottom: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 6,
    borderWidth: 1,
    borderColor: '#F5F5F5',
  },
  expiredMessageIconWrapper: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFF9E6',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    alignSelf: 'center',
  },
  expiredMessage: {
    fontSize: 16,
    color: '#374151',
    textAlign: 'center',
    lineHeight: 26,
    marginBottom: 12,
    fontWeight: '600',
  },
  expiredMessageDetail: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
    fontWeight: '400',
  },
  expiredSuggestionsSection: {
    width: '100%',
    maxWidth: 360,
    marginTop: 8,
  },
  expiredSuggestionsSectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 16,
    paddingHorizontal: 4,
    letterSpacing: 0.2,
  },
  expiredSuggestionsGrid: {
    gap: 14,
  },
  expiredSuggestionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 20,
    borderWidth: 1.5,
    borderColor: '#FFF4E6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 4,
  },
  expiredSuggestionIconWrapper: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#FFF9E6',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
    borderWidth: 2,
    borderColor: 'rgba(245, 196, 0, 0.2)',
  },
  expiredSuggestionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 6,
    letterSpacing: 0.1,
  },
  expiredSuggestionDescription: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
    fontWeight: '400',
  },
  expiredFooter: {
    padding: 20,
    paddingTop: 20,
    paddingBottom: 34,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 6,
  },
  expiredRetryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5C400',
    paddingVertical: 18,
    paddingHorizontal: 32,
    borderRadius: 16,
    marginBottom: 12,
    shadowColor: '#F5C400',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
    minHeight: 58,
    borderWidth: 1,
    borderColor: 'rgba(245, 196, 0, 0.3)',
  },
  expiredRetryButtonText: {
    color: '#1a1a1a',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  expiredBackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  expiredBackButtonText: {
    color: '#6B7280',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  notFoundText: {
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  notFoundSubtext: {
    color: '#6b7280',
    textAlign: 'center',
  },
  footer: {
    padding: 20,
    paddingBottom: 32,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  footerButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  homeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#F3F4F6',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  homeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  cancelButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FEE2E2',
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  cancelButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#EF4444',
  },
  // Info button and modal styles
  infoButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F0FDF4',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  modalCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalScrollView: {
    paddingHorizontal: 20,
  },
  detailSection: {
    marginTop: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  detailSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 12,
  },
  priceDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  priceDetailLabelContainer: {
    flex: 1,
    marginRight: 16,
  },
  priceDetailLabel: {
    fontSize: 14,
    color: '#6B7280',
    flexShrink: 1,
  },
  priceDetailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  priceDetailSeparator: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 12,
  },
  priceDetailRowTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  priceDetailLabelTotal: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  priceDetailValueTotal: {
    fontSize: 16,
    fontWeight: '700',
    color: '#22C55E',
  },
  supplementRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  supplementInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  supplementName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  supplementQuantity: {
    fontSize: 14,
    color: '#6B7280',
    marginLeft: 4,
  },
  supplementPrice: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  messageBox: {
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
  },
  messageText: {
    fontSize: 14,
    color: '#1a1a1a',
    lineHeight: 20,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  infoLabel: {
    fontSize: 14,
    color: '#6B7280',
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  // ═══════════════════════════════════════════════════════════════════════════
  // RÉSERVATION À L'AVANCE: Styles pour le backdrop et le modal de confirmation
  // ═══════════════════════════════════════════════════════════════════════════
  bookingBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
  },
  bookingBackdropContent: {
    alignItems: 'center',
    gap: 16,
  },
  bookingBackdropText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#22C55E',
  },
  bookingModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  bookingModalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  bookingModalIconContainer: {
    marginBottom: 16,
  },
  bookingModalTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 8,
    textAlign: 'center',
  },
  bookingModalSubtitle: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 24,
  },
  bookingDriverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F3FF',
    borderRadius: 16,
    padding: 16,
    width: '100%',
    marginBottom: 16,
  },
  bookingDriverAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  bookingDriverInfo: {
    flex: 1,
  },
  bookingDriverName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  bookingDriverLabel: {
    fontSize: 14,
    color: '#8B5CF6',
    marginTop: 2,
  },
  bookingScheduleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F3FF',
    borderRadius: 16,
    padding: 16,
    width: '100%',
    marginBottom: 16,
    gap: 12,
  },
  bookingScheduleInfo: {
    flex: 1,
  },
  bookingScheduleDate: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    textTransform: 'capitalize',
  },
  bookingScheduleTime: {
    fontSize: 20,
    fontWeight: '700',
    color: '#8B5CF6',
  },
  bookingAddressesCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    padding: 16,
    width: '100%',
    marginBottom: 16,
  },
  bookingAddressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  bookingAddressLine: {
    width: 2,
    height: 20,
    backgroundColor: '#E5E7EB',
    marginLeft: 5,
    marginVertical: 4,
  },
  bookingAddressText: {
    fontSize: 14,
    color: '#1a1a1a',
    marginLeft: 12,
    flex: 1,
  },
  bookingPriceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    marginBottom: 16,
  },
  bookingPriceLabel: {
    fontSize: 16,
    color: '#6B7280',
  },
  bookingPriceValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#22C55E',
  },
  bookingModalButtons: {
    width: '100%',
    gap: 12,
  },
  bookingViewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8B5CF6',
    paddingVertical: 16,
    borderRadius: 16,
    gap: 8,
  },
  bookingViewButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  bookingCloseButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
    paddingVertical: 16,
    borderRadius: 16,
  },
  bookingCloseButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6B7280',
  },
});
