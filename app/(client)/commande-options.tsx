import { useState, useEffect, useRef } from 'react';
import { 
  View, 
  StyleSheet, 
  ScrollView, 
  TouchableOpacity, 
  ActivityIndicator, 
  Alert, 
  Modal, 
  Platform,
  Animated,
  Dimensions,
  FlatList,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { RIDE_OPTIONS, type Supplement, type RouteInfo, type PaymentMethod } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { apiFetch, getFraisServiceConfig } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import Constants from 'expo-constants';
import { useTarifs, isNightRate, type TarifsConfig } from '@/lib/tarifs';
// Sélecteur de date/heure personnalisé (compatible Expo Go)

const { width } = Dimensions.get('window');

const GOOGLE_MAPS_API_KEY = Constants.expoConfig?.extra?.googleMapsApiKey || '';
const HEIGHT_SURCHARGE_THRESHOLD_METERS = 250;
const HEIGHT_SURCHARGE_AMOUNT = 500;

type LatLng = { lat: number; lng: number };

function parseCoord(value?: string): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function geocodeAddress(query: { placeId?: string; address?: string }): Promise<LatLng | null> {
  if (!GOOGLE_MAPS_API_KEY) return null;
  const placeId = query.placeId?.trim();
  const address = query.address?.trim();
  if (!placeId && !address) return null;

  const q = placeId
    ? `place_id=${encodeURIComponent(placeId)}`
    : `address=${encodeURIComponent(address || '')}`;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?${q}&key=${GOOGLE_MAPS_API_KEY}&language=fr&region=pf`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn('[COMMANDE_OPTIONS] Geocode error:', response.status, response.statusText);
      return null;
    }
    const data: any = await response.json();
    if (data.status !== 'OK' || !Array.isArray(data.results) || data.results.length === 0) {
      console.warn('[COMMANDE_OPTIONS] Geocode response:', data.status, data.error_message);
      return null;
    }
    const location = data.results[0]?.geometry?.location;
    if (!location) return null;
    return { lat: Number(location.lat), lng: Number(location.lng) };
  } catch (error) {
    console.warn('[COMMANDE_OPTIONS] Geocode failed:', error);
    return null;
  }
}

async function fetchElevations(coords: LatLng[]): Promise<number[]> {
  if (!GOOGLE_MAPS_API_KEY || coords.length === 0) return [];
  const locations = coords.map((c) => `${c.lat},${c.lng}`).join('|');
  const url = `https://maps.googleapis.com/maps/api/elevation/json?locations=${encodeURIComponent(
    locations
  )}&key=${GOOGLE_MAPS_API_KEY}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn('[COMMANDE_OPTIONS] Elevation error:', response.status, response.statusText);
      return [];
    }
    const data: any = await response.json();
    if (data.status !== 'OK' || !Array.isArray(data.results)) {
      console.warn('[COMMANDE_OPTIONS] Elevation response:', data.status, data.error_message);
      return [];
    }
    return data.results
      .map((r: any) => Number(r?.elevation))
      .filter((e: number) => Number.isFinite(e));
  } catch (error) {
    console.warn('[COMMANDE_OPTIONS] Elevation failed:', error);
    return [];
  }
}

// Helper pour mapper les noms de suppléments aux icônes
function getSupplementIcon(nom: string): string {
  const nomLower = nom.toLowerCase();
  if (nomLower.includes('bagage')) return 'briefcase';
  if (nomLower.includes('animal') || nomLower.includes('animaux')) return 'paw';
  if (nomLower.includes('encombrant') || nomLower.includes('surf') || nomLower.includes('vélo')) return 'cube';
  if (nomLower.includes('passager')) return 'people';
  return 'add-circle';
}

// Suppléments par défaut (utilisés si non chargés depuis l'API)
const DEFAULT_SUPPLEMENTS = [
  {
    id: 'bagages',
    name: 'Bagages +5 kg',
    description: 'Par unité chargée à bord',
    price: 100,
    icon: 'briefcase',
  },
  {
    id: 'animaux',
    name: 'Animaux',
    description: 'Par animal transporté',
    price: 100,
    icon: 'paw',
  },
  {
    id: 'encombrant',
    name: 'Encombrant',
    description: 'Glacière, surf, vélo, sac de golf, poussette...',
    price: 500,
    icon: 'cube',
  },
];

// Fonction pour calculer le prix réel selon les tarifs du back-office
// Inclut les frais de service (configurable) pour les prestataires
const calculateRealPrice = (
  distanceKm: number,
  passengersCount: number,
  supplements: Array<{ id: string; quantity: number; price: number }>,
  scheduledDate: Date | undefined,
  tarifsConfig: TarifsConfig | null,
  fraisServicePercent: number = 15
): {
  priseEnCharge: number;
  tarifKm: number;
  prixKm: number;
  isNight: boolean;
  majorationPassagers: number;
  hasMajorationPassagers: boolean;
  supplementsTotal: number;
  subtotal: number; // Prix avant frais de service
  fraisService: number; // Frais de service (% configurable)
  fraisServicePercent: number; // % pour affichage
  total: number;
} => {
  // Utiliser les tarifs du back-office ou les valeurs par défaut
  const priseEnCharge = tarifsConfig?.priseEnCharge ?? 1000;
  const tarifJour = tarifsConfig?.tarifJourKm ?? 130;
  const tarifNuit = tarifsConfig?.tarifNuitKm ?? 260;
  const heureDebutJour = tarifsConfig?.heureDebutJour ?? 6;
  const heureFinJour = tarifsConfig?.heureFinJour ?? 20;
  const majorationPassagersValue = 500; // Fixe pour l'instant
  
  const checkDate = scheduledDate || new Date();
  const isNight = isNightRate(checkDate, tarifsConfig ?? undefined);
  const tarifKm = isNight ? tarifNuit : tarifJour;
  
  // Prix au kilomètre
  const prixKm = Math.round(distanceKm * tarifKm);
  
  // Majoration passagers : 500 F UNE SEULE FOIS si 5 passagers ou plus
  const hasMajorationPassagers = passengersCount >= 5;
  const majorationPassagers = hasMajorationPassagers ? majorationPassagersValue : 0;
  
  // Total suppléments sélectionnés
  const supplementsTotal = supplements.reduce((sum, s) => sum + (s.price * s.quantity), 0);
  
  // Sous-total (prix de base sans frais de service)
  const subtotal = priseEnCharge + prixKm + majorationPassagers + supplementsTotal;
  
  // Frais de service TAPEA (% configurable du sous-total)
  // Ces frais peuvent être offerts si un salarié TAPEA accepte la course
  const fraisService = Math.round(subtotal * fraisServicePercent / 100);
  
  // Total avec frais de service
  const total = subtotal + fraisService;
  
  return {
    priseEnCharge,
    tarifKm,
    prixKm,
    isNight,
    majorationPassagers,
    hasMajorationPassagers,
    supplementsTotal,
    subtotal,
    fraisService,
    fraisServicePercent,
    total,
  };
};

const getPlacesApiUrl = (): string => {
  const domain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS;
  if (domain) {
    return `https://${domain}/api`;
  }
  // Source unique : app.config.js (via Constants.expoConfig.extra)
  return Constants.expoConfig?.extra?.apiUrl || '';
};

const PLACES_API_URL = getPlacesApiUrl();

export default function CommandeOptionsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    type: string;
    pickup?: string;
    pickupPlaceId?: string;
    pickupLat?: string;
    pickupLng?: string;
    destination?: string;
    destinationPlaceId?: string;
    destinationLat?: string;
    destinationLng?: string;
    stops?: string;
  }>();
  const selectedOption = RIDE_OPTIONS.find((o) => o.id === params.type) || RIDE_OPTIONS[0];

  const { client } = useAuth();
  
  // Hook pour récupérer les tarifs dynamiques depuis le back-office
  const { tarifs, loading: tarifsLoading } = useTarifs();
  
  // State pour les frais de service configurables
  const [fraisServicePercent, setFraisServicePercent] = useState(15);
  
  // Utiliser les suppléments du back-office ou les valeurs par défaut
  const SUPPLEMENTS_OFFICIELS = (tarifs?.supplements && tarifs.supplements.length > 0)
    ? tarifs.supplements.map(s => ({
        id: s.id,
        name: s.nom,
        description: s.description || '',
        price: s.prixXpf,
        icon: getSupplementIcon(s.nom),
      }))
    : DEFAULT_SUPPLEMENTS;
  const [pickup, setPickup] = useState(params.pickup || '');
  const [destination, setDestination] = useState(params.destination || '');
  const [stops, setStops] = useState<Array<{ id: string; address: string }>>([]);
  const [passengers, setPassengers] = useState(1);
  const [supplements, setSupplements] = useState<Supplement[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('card');
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [showCardModal, setShowCardModal] = useState(false);
  const [showCardTPEModal, setShowCardTPEModal] = useState(false);
  // Pour les réservations à l'avance, activer par défaut
  const isReservationType = params.type === 'reservation';
  const [isAdvanceBooking, setIsAdvanceBooking] = useState(isReservationType);
  const [scheduledTime, setScheduledTime] = useState<Date>(() => {
    // Par défaut, mettre la date à dans 1 heure
    const date = new Date();
    date.setHours(date.getHours() + 1);
    date.setMinutes(0);
    return date;
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [distance, setDistance] = useState<number>(5);
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);
  const routeCalculationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [driverComment, setDriverComment] = useState(''); // Commentaire pour le chauffeur
  const [priceAnimated, setPriceAnimated] = useState(false); // Pour l'animation du prix
  const [showSupplementInfo, setShowSupplementInfo] = useState<string | null>(null); // Pour les bulles info
  const [isSubmitting, setIsSubmitting] = useState(false); // Protection anti-double clic
  const [heightSurchargeApplied, setHeightSurchargeApplied] = useState(false);
  const [heightSurchargeLoading, setHeightSurchargeLoading] = useState(false);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const priceScaleAnim = useRef(new Animated.Value(0.95)).current;
  const priceOpacityAnim = useRef(new Animated.Value(0)).current;

  // Récupérer la config des frais de service au chargement
  useEffect(() => {
    getFraisServiceConfig().then(config => {
      setFraisServicePercent(config.fraisServicePrestataire);
      console.log('[CommandeOptions] Frais de service chargés:', config.fraisServicePrestataire + '%');
    });
  }, []);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 50,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Animation du bloc prix quand il devient visible
  const triggerPriceAnimation = () => {
    if (!priceAnimated) {
      setPriceAnimated(true);
      Animated.parallel([
        Animated.spring(priceScaleAnim, {
          toValue: 1,
          tension: 100,
          friction: 6,
          useNativeDriver: true,
        }),
        Animated.timing(priceOpacityAnim, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
      ]).start();
    }
  };

  // Récupérer les cartes bancaires
  const { data: paymentMethods = [] } = useQuery<PaymentMethod[]>({
    queryKey: ['payment-methods', client?.id],
    queryFn: () => apiFetch<PaymentMethod[]>(`/api/stripe/payment-methods/${client?.id}`),
    enabled: !!client?.id && paymentMethod === 'card',
  });

  useEffect(() => {
    if (paymentMethods.length > 0 && !selectedCardId) {
      const defaultCard = paymentMethods.find(m => m.isDefault) || paymentMethods[0];
      setSelectedCardId(defaultCard.id);
    }
  }, [paymentMethods, selectedCardId]);

  useEffect(() => {
    const rawStops = params.stops;
    if (typeof rawStops === 'string' && rawStops !== '' && rawStops !== '[]') {
      try {
        const parsed = JSON.parse(rawStops) as Array<{ id?: string; address?: string; value?: string }>;
        if (Array.isArray(parsed)) {
          const mapped = parsed
            .map((stop, index) => ({
              id: stop.id || `stop-${index}`,
              address: (stop.address || stop.value || '').trim(),
            }))
            .filter((s) => s.address.length > 0);
          setStops(mapped);
        } else {
          setStops([]);
        }
      } catch (e) {
        setStops([]);
      }
    } else {
      setStops([]);
    }
  }, [params.stops]);

  useEffect(() => {
    if (paymentMethod === 'cash') {
      setSelectedCardId(null);
    }
    // Note: le popup pour carte est affiché directement dans le onPress du bouton
  }, [paymentMethod]);

  // Calculer la route
  useEffect(() => {
    if (routeCalculationTimeoutRef.current) {
      clearTimeout(routeCalculationTimeoutRef.current);
    }

    routeCalculationTimeoutRef.current = setTimeout(async () => {
      const pickupPlaceId = params.pickupPlaceId;
      const destinationPlaceId = params.destinationPlaceId;
      const pickupLat = params.pickupLat;
      const pickupLng = params.pickupLng;
      const destinationLat = params.destinationLat;
      const destinationLng = params.destinationLng;

      if ((pickupPlaceId && destinationPlaceId) || (pickupLat && pickupLng && destinationLat && destinationLng)) {
        setIsCalculatingRoute(true);
        try {
          let origin: string;
          let destinationParam: string;

          if (pickupPlaceId && destinationPlaceId) {
            origin = `place_id:${pickupPlaceId}`;
            destinationParam = `place_id:${destinationPlaceId}`;
          } else if (pickupLat && pickupLng && destinationLat && destinationLng) {
            origin = `${pickupLat},${pickupLng}`;
            destinationParam = `${destinationLat},${destinationLng}`;
          } else {
            return;
          }

          // Source unique : app.config.js (via Constants.expoConfig.extra)
          const googleMapsApiKey = Constants.expoConfig?.extra?.googleMapsApiKey || '';
          
          if (!googleMapsApiKey) {
            console.error('[COMMANDE_OPTIONS] ❌ Google Maps API key not configured! Cannot calculate route.');
            console.error('[COMMANDE_OPTIONS] Constants.expoConfig?.extra:', Constants.expoConfig?.extra);
            setIsCalculatingRoute(false);
            Alert.alert(
              'Erreur de configuration',
              'La clé Google Maps API n\'est pas configurée. Impossible de calculer l\'itinéraire.',
              [{ text: 'OK' }]
            );
            return;
          }
          
          if (googleMapsApiKey) {
            let googleUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destinationParam)}&mode=driving&key=${googleMapsApiKey}&language=fr&region=pf`;

            const response = await fetch(googleUrl);
            const googleData = await response.json();

          if (googleData.status === 'OK' && googleData.routes && googleData.routes.length > 0) {
              const route = googleData.routes[0];
              let totalDistance = 0;
              let totalDuration = 0;

              route.legs.forEach((leg: any) => {
                totalDistance += leg.distance?.value || 0;
                totalDuration += leg.duration?.value || 0;
              });

              const distanceKm = totalDistance / 1000;
              const durationMin = Math.round(totalDuration / 60);
              const durationText = durationMin < 60
                ? `${durationMin} min`
                : `${Math.floor(durationMin / 60)}h${durationMin % 60 > 0 ? ` ${durationMin % 60}min` : ''}`;

              setDistance(distanceKm);
              setRouteInfo({ distance: distanceKm, duration: durationText });

              // Animation du prix
              Animated.sequence([
                Animated.timing(priceScaleAnim, { toValue: 1.1, duration: 150, useNativeDriver: true }),
                Animated.spring(priceScaleAnim, { toValue: 1, friction: 3, useNativeDriver: true }),
              ]).start();
            }
          }
        } catch (error) {
          console.error('Error calculating route:', error);
        } finally {
          setIsCalculatingRoute(false);
        }
      }
    }, 500);

    return () => {
      if (routeCalculationTimeoutRef.current) {
        clearTimeout(routeCalculationTimeoutRef.current);
      }
    };
  }, [params.pickupPlaceId, params.destinationPlaceId, params.pickupLat, params.pickupLng, params.destinationLat, params.destinationLng]);

  useEffect(() => {
    let isActive = true;

    const checkHeightSurcharge = async () => {
      setHeightSurchargeLoading(true);
      try {
        const response = await apiFetch<{ applies: boolean }>('/api/height-surcharge-check', {
          method: 'POST',
          body: JSON.stringify({
            pickup: {
              value: params.pickup || '',
              placeId: params.pickupPlaceId || '',
              lat: params.pickupLat ? Number(params.pickupLat) : undefined,
              lng: params.pickupLng ? Number(params.pickupLng) : undefined,
            },
            destination: {
              value: params.destination || '',
              placeId: params.destinationPlaceId || '',
              lat: params.destinationLat ? Number(params.destinationLat) : undefined,
              lng: params.destinationLng ? Number(params.destinationLng) : undefined,
            },
          }),
        });

        if (isActive) {
          setHeightSurchargeApplied(!!response?.applies);
        }
      } catch (error) {
        console.warn('[COMMANDE_OPTIONS] Height surcharge check failed:', error);
      } finally {
        if (isActive) setHeightSurchargeLoading(false);
      }
    };

    checkHeightSurcharge();
    return () => {
      isActive = false;
    };
  }, [
    params.pickup,
    params.destination,
    params.pickupPlaceId,
    params.destinationPlaceId,
    params.pickupLat,
    params.pickupLng,
    params.destinationLat,
    params.destinationLng,
  ]);

    // Calcul du prix réel avec tarifs du back-office
    // Pour le tour de l'île, prix fixe de 30000 XPF
    const isTourType = params.type === 'tour';
    const TOUR_FIXED_PRICE = 30000;
    
    // Utiliser distance > 0 pour s'assurer qu'on a une vraie distance calculée
    const effectiveDistance = distance > 0 ? distance : 0;
    const realPriceData = isTourType 
      ? { priseEnCharge: TOUR_FIXED_PRICE, tarifKm: 0, prixKm: 0, isNight: false, majorationPassagers: 0, supplementsTotal: 0, subtotal: TOUR_FIXED_PRICE, fraisService: 0, fraisServicePercent: 0, total: TOUR_FIXED_PRICE, hasMajorationPassagers: false }
      : calculateRealPrice(
          effectiveDistance,
          passengers,
          supplements,
          isAdvanceBooking ? scheduledTime : undefined,
          tarifs,  // Passer les tarifs dynamiques
          fraisServicePercent  // Passer le % de frais de service
        );
    const heightSurcharge = (heightSurchargeApplied && !isTourType) ? HEIGHT_SURCHARGE_AMOUNT : 0;
    const displayTotal = realPriceData.total + heightSurcharge;
    const totalPrice = isTourType ? TOUR_FIXED_PRICE : realPriceData.total;
    // Pour les tours, le chauffeur garde tout. Pour les autres, driverEarnings = subtotal (sans frais service)
  const driverEarnings = isTourType ? TOUR_FIXED_PRICE : realPriceData.subtotal;
  const formatPrice = (price: number) => `${price.toLocaleString('fr-FR')} F`;

  const handleSupplementToggle = (supplementId: string) => {
    const existing = supplements.find((s) => s.id === supplementId);
    if (existing) {
      if (existing.quantity > 1) {
        setSupplements(supplements.map((s) => s.id === supplementId ? { ...s, quantity: s.quantity - 1 } : s));
      } else {
        setSupplements(supplements.filter((s) => s.id !== supplementId));
      }
    } else {
      const supp = SUPPLEMENTS_OFFICIELS.find((s) => s.id === supplementId);
      if (supp) setSupplements([...supplements, { ...supp, quantity: 1 }]);
    }
  };

  const handleAddSupplement = (supplementId: string) => {
    const existing = supplements.find((s) => s.id === supplementId);
    if (existing) {
      setSupplements(supplements.map((s) => s.id === supplementId ? { ...s, quantity: s.quantity + 1 } : s));
    } else {
      const supp = SUPPLEMENTS_OFFICIELS.find((s) => s.id === supplementId);
      if (supp) setSupplements([...supplements, { ...supp, quantity: 1 }]);
    }
  };

  const handleOrder = () => {
    // Protection anti-double clic
    if (isSubmitting) {
      console.log('[ORDER] ⚠️ Already submitting, ignoring click');
      return;
    }
    
    // Vérifier que le calcul de route est terminé avant de continuer
    if (isCalculatingRoute) {
      Alert.alert('Calcul en cours', 'Veuillez patienter pendant le calcul de votre trajet...');
      return;
    }
    
    // Vérifier que la distance et routeInfo sont disponibles
    if (!routeInfo || distance <= 0) {
      Alert.alert('Calcul en cours', 'Le calcul de votre trajet n\'est pas encore terminé. Veuillez patienter...');
      return;
    }
    
    setIsSubmitting(true);
    
    const trimmedPickup = pickup?.trim() || '';
    const trimmedDestination = destination?.trim() || '';

    if (!trimmedPickup || !trimmedDestination) {
      Alert.alert('Erreur', 'Veuillez renseigner les adresses de départ et d\'arrivée.');
      setIsSubmitting(false);
      return;
    }

    // Pas besoin de carte enregistrée - le chauffeur proposera le paiement

    if (isAdvanceBooking && scheduledTime <= new Date()) {
      Alert.alert('Erreur', 'La date et l\'heure de réservation doivent être dans le futur.');
      setIsSubmitting(false);
      return;
    }

    if (totalPrice <= 0 || isNaN(totalPrice)) {
      Alert.alert('Erreur', 'Le prix calculé est invalide.');
      setIsSubmitting(false);
      return;
    }

    // S'assurer que routeInfo est disponible avec la distance réelle
    if (!routeInfo || distance <= 0) {
      Alert.alert('Calcul en cours', 'Le calcul de votre trajet n\'est pas encore terminé. Veuillez patienter...');
      setIsSubmitting(false);
      return;
    }
    
    const finalRouteInfo: RouteInfo = routeInfo;

    let stopsParam = JSON.stringify([]);
    if (params.stops && params.stops !== '' && params.stops !== '[]') {
      try {
        const parsedStops = JSON.parse(params.stops);
        if (Array.isArray(parsedStops)) stopsParam = params.stops;
      } catch (e) {}
    }

    // Recalculer le prix une dernière fois juste avant la navigation pour être sûr d'avoir la valeur exacte
    // Pour le tour de l'île, utiliser le prix fixe (pas de frais de service)
    const finalPriceData = isTourType
      ? { priseEnCharge: TOUR_FIXED_PRICE, tarifKm: 0, prixKm: 0, isNight: false, majorationPassagers: 0, supplementsTotal: 0, subtotal: TOUR_FIXED_PRICE, fraisService: 0, fraisServicePercent: 0, total: TOUR_FIXED_PRICE, hasMajorationPassagers: false }
      : calculateRealPrice(
          distance, // Utiliser la distance réelle calculée
          passengers,
          supplements,
          isAdvanceBooking ? scheduledTime : undefined,
          tarifs,
          fraisServicePercent  // Passer le % de frais de service
        );
    
    // Prix final pour le tour ou calculé
    const finalTotalPrice = isTourType ? TOUR_FIXED_PRICE : finalPriceData.total;
    // Pour les tours, le chauffeur garde tout. Pour les autres, driverEarnings = subtotal (sans frais service)
    const finalDriverEarnings = isTourType ? TOUR_FIXED_PRICE : finalPriceData.subtotal;
    
    // Vérifier que le prix est valide
    if (finalTotalPrice <= 0 || isNaN(finalTotalPrice)) {
      Alert.alert('Erreur', 'Le prix calculé est invalide. Veuillez réessayer.');
      setIsSubmitting(false);
      return;
    }
    
    // Détails du prix pour le chauffeur avec le prix recalculé
    const priceDetails = {
      priseEnCharge: finalPriceData.priseEnCharge,
      tarifKm: finalPriceData.tarifKm,
      prixKm: finalPriceData.prixKm,
      isNight: finalPriceData.isNight,
      majorationPassagers: finalPriceData.majorationPassagers,
      passagersSupplementaires: finalPriceData.hasMajorationPassagers ? finalPriceData.majorationPassagers : undefined,
      supplementsTotal: finalPriceData.supplementsTotal,
      subtotal: finalPriceData.subtotal, // Prix sans frais de service
      fraisService: finalPriceData.fraisService, // 15% frais de service
      total: finalPriceData.total,
    };

    router.push({
      pathname: '/(client)/ride/recherche-chauffeur',
      params: {
        type: params.type || 'immediate',
        pickup: trimmedPickup,
        pickupPlaceId: params.pickupPlaceId || '',
        pickupLat: params.pickupLat || '',
        pickupLng: params.pickupLng || '',
        destination: trimmedDestination,
        destinationPlaceId: params.destinationPlaceId || '',
        destinationLat: params.destinationLat || '',
        destinationLng: params.destinationLng || '',
        stops: stopsParam,
        passengers: Math.max(1, Math.min(8, passengers)).toString(),
        supplements: JSON.stringify(supplements.filter(s => s && s.quantity > 0)),
        paymentMethod,
        selectedCardId: '', // Pas de carte requise - le chauffeur gère le paiement
        isAdvanceBooking: isAdvanceBooking.toString(),
        scheduledTime: (isAdvanceBooking && scheduledTime) ? scheduledTime.toISOString() : '',
        totalPrice: finalTotalPrice.toString(),
        driverEarnings: finalDriverEarnings.toString(),
        routeInfo: JSON.stringify(finalRouteInfo),
        priceDetails: JSON.stringify(priceDetails), // Détails complets du prix
        driverComment: driverComment.trim(), // Commentaire pour le chauffeur
      },
    });
  };

  const formatDateTime = (date: Date) => {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${day}/${month}/${year} à ${hours}:${minutes}`;
  };

  const getTypeIcon = () => {
    switch (params.type) {
      case 'immediate': return 'flash';
      case 'reservation': return 'calendar';
      case 'tour': return 'compass';
      default: return 'car';
    }
  };

  const getTypeColor = () => {
    // Couleur unifiée jaune pour toutes les pages
    return ['#F5C400', '#F5C400'];
  };

  return (
    <View style={styles.container}>
      {/* Header fixe */}
      <SafeAreaView edges={['top']} style={styles.headerSafeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <View style={styles.backButtonCircle}>
              <Ionicons name="arrow-back" size={22} color="#1a1a1a" />
            </View>
          </TouchableOpacity>
          <View style={styles.headerTitleContainer}>
            <View style={[styles.headerIconCircle, { backgroundColor: getTypeColor()[0] }]}>
              <Ionicons name={getTypeIcon() as any} size={24} color="#FFFFFF" />
            </View>
            <Text variant="h2" style={styles.headerTitle}>{selectedOption.title}</Text>
          </View>
          <View style={{ width: 48 }} />
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={[styles.animatedContainer, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          {/* Route Summary Card */}
          <View style={styles.routeCard}>
            <View style={styles.routeHeader}>
              <Ionicons name="navigate" size={20} color={getTypeColor()[0]} />
              <Text style={styles.routeHeaderText}>Votre trajet</Text>
              {routeInfo && (
                <View style={styles.routeBadge}>
                  <Text style={styles.routeBadgeText}>{routeInfo.duration}</Text>
                </View>
              )}
            </View>
            
            <View style={styles.routeTimeline}>
              {/* Départ */}
              <View style={styles.routePoint}>
                <View style={[styles.routeDot, { backgroundColor: '#22C55E' }]}>
                  <Ionicons name="radio-button-on" size={12} color="#FFFFFF" />
                </View>
                <View style={styles.routePointContent}>
                  <Text style={styles.routeLabel}>Départ</Text>
                  <Text style={styles.routeAddress} numberOfLines={2}>{pickup || 'Non défini'}</Text>
                </View>
              </View>

              <View style={styles.routeLine} />

              {/* Arrêts */}
              {stops.map((stop, index) => (
                <View key={stop.id}>
                  <View style={styles.routePoint}>
                    <View style={[styles.routeDot, { backgroundColor: '#F59E0B' }]}>
                      <Text style={styles.stopNumber}>{index + 1}</Text>
                    </View>
                    <View style={styles.routePointContent}>
                      <Text style={styles.routeLabel}>Arrêt {index + 1}</Text>
                      <Text style={styles.routeAddress} numberOfLines={2}>{stop.address}</Text>
                    </View>
                  </View>
                  <View style={styles.routeLine} />
                </View>
              ))}

              {/* Arrivée */}
              <View style={styles.routePoint}>
                <View style={[styles.routeDot, { backgroundColor: '#EF4444' }]}>
                  <Ionicons name="flag" size={12} color="#FFFFFF" />
                </View>
                <View style={styles.routePointContent}>
                  <Text style={styles.routeLabel}>Arrivée</Text>
                  <Text style={styles.routeAddress} numberOfLines={2}>{destination || 'Non défini'}</Text>
                </View>
              </View>
            </View>

            {/* Distance info */}
            <View style={styles.distanceInfo}>
              <View style={styles.distanceItem}>
                <Ionicons name="speedometer-outline" size={18} color="#6B7280" />
                <Text style={styles.distanceText}>
                  {isCalculatingRoute ? 'Calcul...' : `${distance.toFixed(1)} km`}
                </Text>
              </View>
              {routeInfo?.duration && (
                <View style={styles.distanceItem}>
                  <Ionicons name="time-outline" size={18} color="#6B7280" />
                  <Text style={styles.distanceText}>{routeInfo.duration}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Payment Section */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Ionicons name="wallet" size={22} color="#1a1a1a" />
              <Text style={styles.sectionTitle}>Paiement</Text>
            </View>
            <View style={styles.paymentOptions}>
              <TouchableOpacity
                style={[styles.paymentOption, paymentMethod === 'cash' && styles.paymentOptionSelected]}
                onPress={() => setPaymentMethod('cash')}
              >
                <View style={[styles.paymentIconCircle, paymentMethod === 'cash' && styles.paymentIconCircleSelected]}>
                  <Ionicons name="cash" size={28} color={paymentMethod === 'cash' ? '#FFFFFF' : '#6B7280'} />
                </View>
                <Text style={[styles.paymentText, paymentMethod === 'cash' && styles.paymentTextSelected]}>Espèces</Text>
                {paymentMethod === 'cash' && (
                  <View style={styles.checkMark}>
                    <Ionicons name="checkmark-circle" size={24} color="#22C55E" />
                  </View>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.paymentOption, paymentMethod === 'card' && styles.paymentOptionSelected]}
                onPress={() => {
                  setPaymentMethod('card');
                  setShowCardTPEModal(true);
                }}
              >
                <View style={[styles.paymentIconCircle, paymentMethod === 'card' && styles.paymentIconCircleSelected]}>
                  <Ionicons name="card" size={28} color={paymentMethod === 'card' ? '#FFFFFF' : '#6B7280'} />
                </View>
                <Text style={[styles.paymentText, paymentMethod === 'card' && styles.paymentTextSelected]}>Carte</Text>
                {paymentMethod === 'card' && (
                  <View style={styles.checkMark}>
                    <Ionicons name="checkmark-circle" size={24} color="#22C55E" />
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* Passengers Section */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Ionicons name="people" size={22} color="#1a1a1a" />
              <Text style={styles.sectionTitle}>Passagers</Text>
            </View>
            <View style={styles.passengerSelector}>
              <TouchableOpacity
                style={[styles.passengerButton, passengers <= 1 && styles.passengerButtonDisabled]}
                onPress={() => setPassengers(Math.max(1, passengers - 1))}
                disabled={passengers <= 1}
              >
                <Ionicons name="remove" size={24} color={passengers <= 1 ? '#D1D5DB' : '#1a1a1a'} />
              </TouchableOpacity>
              <View style={styles.passengerCount}>
                <Text style={styles.passengerNumber}>{passengers}</Text>
                <Text style={styles.passengerLabel}>personne{passengers > 1 ? 's' : ''}</Text>
              </View>
              <TouchableOpacity
                style={[styles.passengerButton, passengers >= 8 && styles.passengerButtonDisabled]}
                onPress={() => setPassengers(Math.min(8, passengers + 1))}
                disabled={passengers >= 8}
              >
                <Ionicons name="add" size={24} color={passengers >= 8 ? '#D1D5DB' : '#1a1a1a'} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Supplements Section - Masqué pour Tour de l'île */}
          {!isTourType && (
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Ionicons name="cube" size={22} color="#1a1a1a" />
              <Text style={styles.sectionTitle}>Suppléments</Text>
            </View>
            <View style={styles.supplementsList}>
              {SUPPLEMENTS_OFFICIELS.map((supp) => {
                const added = supplements.find((s) => s.id === supp.id);
                const iconColors: { [key: string]: { bg: string; icon: string } } = {
                  bagages: { bg: '#EEF2FF', icon: '#4F46E5' },
                  animaux: { bg: '#FEF3C7', icon: '#F59E0B' },
                  encombrant: { bg: '#FEE2E2', icon: '#EF4444' },
                };
                const colors = iconColors[supp.id] || { bg: '#F3F4F6', icon: '#6B7280' };
                return (
                  <View key={supp.id} style={[styles.supplementItem, added && styles.supplementItemActive]}>
                    <View style={[styles.supplementIcon, { backgroundColor: colors.bg }]}>
                      <Ionicons
                        name={supp.icon as any}
                        size={24}
                        color={colors.icon}
                      />
                    </View>
                    <View style={styles.supplementInfo}>
                      <View style={styles.supplementTitleRow}>
                        <Text style={styles.supplementName}>{supp.name}</Text>
                        <TouchableOpacity 
                          style={styles.infoButton}
                          onPress={() => setShowSupplementInfo(showSupplementInfo === supp.id ? null : supp.id)}
                        >
                          <Ionicons name="information-circle" size={18} color="#9CA3AF" />
                        </TouchableOpacity>
                      </View>
                      {showSupplementInfo === supp.id && (
                        <View style={styles.infoBubble}>
                          <Text style={styles.infoBubbleText}>{supp.description}</Text>
                        </View>
                      )}
                      <Text style={styles.supplementPrice}>{formatPrice(supp.price)}</Text>
                    </View>
                    <View style={styles.supplementControls}>
                      {added && (
                        <TouchableOpacity style={styles.supplementControlBtn} onPress={() => handleSupplementToggle(supp.id)}>
                          <Ionicons name="remove" size={18} color="#6B7280" />
                        </TouchableOpacity>
                      )}
                      <View style={styles.supplementQuantity}>
                        <Text style={styles.supplementQuantityText}>{added?.quantity || 0}</Text>
                      </View>
                      <TouchableOpacity style={styles.supplementControlBtn} onPress={() => handleAddSupplement(supp.id)}>
                        <Ionicons name="add" size={18} color="#1a1a1a" />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
          )}

          {/* Commentaire pour le chauffeur */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Ionicons name="chatbubble-ellipses" size={22} color="#1a1a1a" />
              <Text style={styles.sectionTitle}>Message au chauffeur</Text>
            </View>
            <View style={styles.commentInputContainer}>
              <Input
                placeholder="Ex: Je serai devant le portail bleu, j'ai 2 valises..."
                value={driverComment}
                onChangeText={setDriverComment}
                multiline
                numberOfLines={3}
                style={styles.commentInput}
                placeholderTextColor="#9CA3AF"
              />
            </View>
            <Text style={styles.commentHint}>
              <Ionicons name="information-circle-outline" size={14} color="#6B7280" /> Optionnel - Ce message sera visible par votre chauffeur
            </Text>
          </View>

          {/* Reservation Toggle - Seulement pour les réservations à l'avance */}
          {isReservationType && (
            <View style={styles.sectionCard}>
              <View style={styles.reservationHeader}>
                <View style={[styles.reservationIcon, styles.reservationIconActive]}>
                  <Ionicons name="calendar" size={22} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.reservationTitle}>Date et heure de prise en charge</Text>
                  <Text style={styles.reservationSubtitle}>Choisissez quand vous souhaitez être pris en charge</Text>
                </View>
              </View>
              <TouchableOpacity style={styles.dateTimeSelector} onPress={() => setShowDatePicker(true)}>
                <Ionicons name="time" size={20} color="#F5C400" />
                <Text style={styles.dateTimeText}>{formatDateTime(scheduledTime)}</Text>
                <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
              </TouchableOpacity>
            </View>
          )}

          {/* Price Summary - Tarifs officiels */}
          <Animated.View 
            style={[
              styles.priceCard, 
              { 
                transform: [{ scale: priceScaleAnim }],
                opacity: priceOpacityAnim,
              }
            ]}
            onLayout={triggerPriceAnimation}
          >
            <View style={styles.priceGradient}>
              <View style={styles.priceHeader}>
                <Text style={styles.priceHeaderText}>Détail du tarif</Text>
                {isCalculatingRoute && <ActivityIndicator size="small" color="#F5C400" />}
              </View>
              
              {/* Indicateur jour/nuit */}
              <View style={[styles.tarifIndicator, realPriceData.isNight ? styles.tarifIndicatorNight : styles.tarifIndicatorDay]}>
                <Ionicons 
                  name={realPriceData.isNight ? "moon" : "sunny"} 
                  size={16} 
                  color={realPriceData.isNight ? "#6366F1" : "#F59E0B"} 
                />
                <Text style={[styles.tarifIndicatorText, realPriceData.isNight ? styles.tarifIndicatorTextNight : styles.tarifIndicatorTextDay]}>
                  Tarif {realPriceData.isNight ? "nuit" : "jour"} ({realPriceData.tarifKm} F/km)
                </Text>
              </View>
              
              <View style={styles.priceBreakdown}>
                {/* Prise en charge - toujours 1000 F */}
                <View style={styles.priceRow}>
                  <Text style={styles.priceLabel}>Prise en charge</Text>
                  <Text style={styles.priceValue}>{formatPrice(realPriceData.priseEnCharge)}</Text>
                </View>
                
                {/* Distance */}
                <View style={styles.priceRow}>
                  <Text style={styles.priceLabel}>Distance ({distance.toFixed(1)} km × {realPriceData.tarifKm} F)</Text>
                  <Text style={styles.priceValue}>{formatPrice(realPriceData.prixKm)}</Text>
                </View>
                
                {/* Majoration passagers si 5 ou plus */}
                {realPriceData.hasMajorationPassagers && (
                  <View style={styles.priceRow}>
                    <Text style={styles.priceLabel}>+5 passagers ou plus</Text>
                    <Text style={styles.priceValue}>{formatPrice(realPriceData.majorationPassagers)}</Text>
                  </View>
                )}
                
                {/* Suppléments sélectionnés */}
                {supplements.length > 0 && (
                  <View style={styles.priceRow}>
                    <Text style={styles.priceLabel}>Suppléments</Text>
                    <Text style={styles.priceValue}>{formatPrice(realPriceData.supplementsTotal)}</Text>
                  </View>
                )}

                {/* Majoration hauteur */}
                {heightSurchargeApplied && (
                  <View style={styles.priceRow}>
                    <Text style={styles.priceLabel}>Majoration hauteur (≥250 m)</Text>
                    <Text style={styles.priceValue}>{formatPrice(HEIGHT_SURCHARGE_AMOUNT)}</Text>
                  </View>
                )}

                {/* Frais de service TAPEA (% configurable) - Pas pour les tours */}
                {!isTourType && realPriceData.fraisService > 0 && (
                  <View style={styles.priceRowService}>
                    <View style={styles.priceRowServiceLeft}>
                      <Text style={styles.priceLabelService}>Frais de service ({realPriceData.fraisServicePercent}%)</Text>
                      <Text style={styles.priceServiceHint}>Peut être offert selon le chauffeur</Text>
                    </View>
                    <Text style={styles.priceValueService}>{formatPrice(realPriceData.fraisService)}</Text>
                  </View>
                )}
              </View>

              {/* Note hauteurs - informative */}
              <View style={styles.hauteursNote}>
                <Ionicons name="information-circle" size={16} color="#22C55E" />
                <Text style={styles.hauteursNoteText}>
                  {heightSurchargeLoading
                    ? "Vérification de l'altitude en cours..."
                    : heightSurchargeApplied
                      ? "Majoration hauteur appliquée (destination ou départ ≥ 250 m)."
                      : "Des frais supplémentaires peuvent s'appliquer si votre destination se situe dans les hauteurs, en cas d'attente de la part du chauffeur ou d'arrêt demandé."}
                </Text>
              </View>

              <View style={styles.priceDivider} />
              
              <View style={styles.totalSection}>
                <Text style={styles.totalLabel}>Total estimé</Text>
                <Text style={styles.totalAmount}>{formatPrice(displayTotal)}</Text>
              </View>
            </View>
          </Animated.View>
        </Animated.View>
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity 
          style={[
            styles.orderButton, 
            { backgroundColor: getTypeColor()[0] },
            (isSubmitting || isCalculatingRoute || !routeInfo || distance <= 0) && { opacity: 0.6 }
          ]} 
          onPress={handleOrder}
          disabled={isSubmitting || isCalculatingRoute || !routeInfo || distance <= 0}
          activeOpacity={0.8}
        >
          <View style={styles.orderButtonInner}>
            {(isSubmitting || isCalculatingRoute) ? (
              <ActivityIndicator size="small" color="#1a1a1a" />
            ) : (
              <Ionicons name="checkmark-circle" size={24} color="#1a1a1a" />
            )}
            <Text style={styles.orderButtonText}>
              {isSubmitting ? 'Création en cours...' : isCalculatingRoute ? 'Calcul du trajet...' : 'Commander maintenant'}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Modal Paiement par TPE */}
      <Modal visible={showCardTPEModal} transparent animationType="fade" onRequestClose={() => setShowCardTPEModal(false)}>
        <View style={styles.tpeModalOverlay}>
          <View style={styles.tpeModalContent}>
            <View style={styles.tpeModalIcon}>
              <Ionicons name="card" size={48} color="#F5C400" />
            </View>
            <Text style={styles.tpeModalTitle}>Paiement par carte</Text>
            <Text style={styles.tpeModalText}>
              Votre chauffeur vous proposera un paiement par TPE (terminal de paiement) à votre arrivée à destination.
            </Text>
            <TouchableOpacity 
              style={styles.tpeModalButton}
              onPress={() => setShowCardTPEModal(false)}
            >
              <Text style={styles.tpeModalButtonText}>Compris</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Card Selection Modal */}
      <Modal visible={showCardModal} transparent animationType="slide" onRequestClose={() => setShowCardModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Sélectionner une carte</Text>
              <TouchableOpacity onPress={() => setShowCardModal(false)}>
                <Ionicons name="close-circle" size={28} color="#6B7280" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalScroll}>
              {paymentMethods.map((card) => (
                <TouchableOpacity
                  key={card.id}
                  style={[styles.cardOption, selectedCardId === card.id && styles.cardOptionSelected]}
                  onPress={() => { setSelectedCardId(card.id); setShowCardModal(false); }}
                >
                  <View style={styles.cardIcon}>
                    <Ionicons name="card" size={24} color={selectedCardId === card.id ? '#F5C400' : '#6B7280'} />
                  </View>
                  <View style={styles.cardInfo}>
                    <Text style={styles.cardBrand}>{card.brand.toUpperCase()} •••• {card.last4}</Text>
                    <Text style={styles.cardExpiry}>Expire {card.expiryMonth.toString().padStart(2, '0')}/{card.expiryYear}</Text>
                  </View>
                  {card.isDefault && <View style={styles.defaultBadge}><Text style={styles.defaultBadgeText}>Par défaut</Text></View>}
                  {selectedCardId === card.id && <Ionicons name="checkmark-circle" size={24} color="#22C55E" />}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.addCardBtn} onPress={() => { setShowCardModal(false); router.push('/(client)/cartes-bancaires'); }}>
              <Ionicons name="add-circle" size={24} color="#F5C400" />
              <Text style={styles.addCardText}>Ajouter une carte</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Custom Date/Time Picker Modal (compatible Expo Go) */}
      <Modal visible={showDatePicker || showTimePicker} transparent animationType="slide" onRequestClose={() => { setShowDatePicker(false); setShowTimePicker(false); }}>
        <View style={styles.datePickerModal}>
          <View style={styles.datePickerContent}>
            <View style={styles.datePickerHeader}>
              <TouchableOpacity onPress={() => { setShowDatePicker(false); setShowTimePicker(false); }}>
                <Text style={styles.datePickerBack}>Annuler</Text>
              </TouchableOpacity>
              <Text style={styles.datePickerTitle}>Date et heure</Text>
              <TouchableOpacity onPress={() => { setShowDatePicker(false); setShowTimePicker(false); }}>
                <Text style={styles.datePickerDone}>Confirmer</Text>
              </TouchableOpacity>
            </View>
            
            {/* Sélection de la date */}
            <View style={styles.customPickerSection}>
              <Text style={styles.customPickerLabel}>Date de prise en charge</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dateScrollView}>
                {Array.from({ length: 14 }, (_, i) => {
                  const date = new Date();
                  date.setDate(date.getDate() + i);
                  const isSelected = scheduledTime.toDateString() === date.toDateString();
                  const dayNames = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
                  const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
                  return (
                    <TouchableOpacity
                      key={i}
                      style={[styles.dateOption, isSelected && styles.dateOptionSelected]}
                      onPress={() => {
                        const newDate = new Date(scheduledTime);
                        newDate.setFullYear(date.getFullYear());
                        newDate.setMonth(date.getMonth());
                        newDate.setDate(date.getDate());
                        setScheduledTime(newDate);
                      }}
                    >
                      <Text style={[styles.dateOptionDay, isSelected && styles.dateOptionTextSelected]}>
                        {i === 0 ? "Auj." : i === 1 ? "Dem." : dayNames[date.getDay()]}
                      </Text>
                      <Text style={[styles.dateOptionNumber, isSelected && styles.dateOptionTextSelected]}>
                        {date.getDate()}
                      </Text>
                      <Text style={[styles.dateOptionMonth, isSelected && styles.dateOptionTextSelected]}>
                        {monthNames[date.getMonth()]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {/* Sélection de l'heure */}
            <View style={styles.customPickerSection}>
              <Text style={styles.customPickerLabel}>Heure de prise en charge</Text>
              <View style={styles.timePickerRow}>
                {/* Heures */}
                <View style={styles.timePickerColumn}>
                  <Text style={styles.timePickerColumnLabel}>Heure</Text>
                  <ScrollView style={styles.timeScrollView} showsVerticalScrollIndicator={false}>
                    {Array.from({ length: 24 }, (_, h) => {
                      const isSelected = scheduledTime.getHours() === h;
                      const now = new Date();
                      const isToday = scheduledTime.toDateString() === now.toDateString();
                      const isPast = isToday && h < now.getHours();
                      return (
                        <TouchableOpacity
                          key={h}
                          style={[styles.timeOption, isSelected && styles.timeOptionSelected, isPast && styles.timeOptionDisabled]}
                          onPress={() => {
                            if (!isPast) {
                              const newDate = new Date(scheduledTime);
                              newDate.setHours(h);
                              setScheduledTime(newDate);
                            }
                          }}
                          disabled={isPast}
                        >
                          <Text style={[styles.timeOptionText, isSelected && styles.timeOptionTextSelected, isPast && styles.timeOptionTextDisabled]}>
                            {h.toString().padStart(2, '0')}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
                
                <Text style={styles.timeSeparator}>:</Text>
                
                {/* Minutes */}
                <View style={styles.timePickerColumn}>
                  <Text style={styles.timePickerColumnLabel}>Minutes</Text>
                  <ScrollView style={styles.timeScrollView} showsVerticalScrollIndicator={false}>
                    {Array.from({ length: 60 }, (_, i) => i).map((m) => {
                      const isSelected = scheduledTime.getMinutes() === m;
                      const now = new Date();
                      const isToday = scheduledTime.toDateString() === now.toDateString();
                      const isSameHour = scheduledTime.getHours() === now.getHours();
                      const isPast = isToday && isSameHour && m < now.getMinutes();
                      return (
                        <TouchableOpacity
                          key={m}
                          style={[styles.timeOption, isSelected && styles.timeOptionSelected, isPast && styles.timeOptionDisabled]}
                          onPress={() => {
                            if (!isPast) {
                              const newDate = new Date(scheduledTime);
                              newDate.setMinutes(m);
                              setScheduledTime(newDate);
                            }
                          }}
                          disabled={isPast}
                        >
                          <Text style={[styles.timeOptionText, isSelected && styles.timeOptionTextSelected, isPast && styles.timeOptionTextDisabled]}>
                            {m.toString().padStart(2, '0')}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              </View>
            </View>

            {/* Résumé */}
            <View style={styles.dateTimeSummary}>
              <Ionicons name="calendar" size={24} color="#F5C400" />
              <Text style={styles.dateTimeSummaryText}>
                {formatDateTime(scheduledTime)}
              </Text>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  headerSafeArea: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    padding: 4,
  },
  backButtonCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#1a1a1a',
    fontWeight: '700',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 140,
  },
  animatedContainer: {
    gap: 16,
  },
  routeCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 5,
  },
  routeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 8,
  },
  routeHeaderText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    flex: 1,
  },
  routeBadge: {
    backgroundColor: '#FEF9E7',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  routeBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#F5C400',
  },
  routeTimeline: {
    paddingLeft: 8,
  },
  routePoint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  routeDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stopNumber: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  routePointContent: {
    flex: 1,
    paddingBottom: 8,
  },
  routeLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  routeAddress: {
    fontSize: 14,
    color: '#1a1a1a',
    fontWeight: '500',
  },
  routeLine: {
    width: 2,
    height: 20,
    backgroundColor: '#E5E7EB',
    marginLeft: 13,
    marginVertical: 4,
  },
  distanceInfo: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  distanceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  distanceText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  passengerSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
    paddingVertical: 8,
  },
  passengerButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  passengerButtonDisabled: {
    backgroundColor: '#F9FAFB',
  },
  passengerCount: {
    alignItems: 'center',
    minWidth: 80,
    minHeight: 60,
    justifyContent: 'center',
  },
  passengerNumber: {
    fontSize: 42,
    fontWeight: '700',
    color: '#1a1a1a',
    lineHeight: 48,
  },
  passengerLabel: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  supplementsList: {
    gap: 12,
  },
  supplementItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 16,
    backgroundColor: '#F9FAFB',
    gap: 12,
  },
  supplementItemActive: {
    backgroundColor: '#FEF3C7',
  },
  supplementIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  supplementInfo: {
    flex: 1,
  },
  supplementName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  supplementTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  infoButton: {
    padding: 2,
  },
  infoBubble: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 4,
    marginBottom: 2,
  },
  infoBubbleText: {
    fontSize: 11,
    color: '#6B7280',
    lineHeight: 14,
  },
  supplementPrice: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F5C400',
    marginTop: 4,
  },
  supplementControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  supplementControlBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  supplementQuantity: {
    minWidth: 28,
    alignItems: 'center',
  },
  supplementQuantityText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  paymentOptions: {
    flexDirection: 'row',
    gap: 12,
  },
  paymentOption: {
    flex: 1,
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#F9FAFB',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  paymentOptionSelected: {
    backgroundColor: '#FEF9E7',
    borderColor: '#F5C400',
  },
  paymentIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  paymentIconCircleSelected: {
    backgroundColor: '#F5C400',
  },
  paymentText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  paymentTextSelected: {
    color: '#F5C400',
  },
  commentInputContainer: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 8,
  },
  commentInput: {
    minHeight: 80,
    padding: 12,
    fontSize: 14,
    color: '#1a1a1a',
    textAlignVertical: 'top',
  },
  commentHint: {
    fontSize: 12,
    color: '#6B7280',
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkMark: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  selectedCardBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    padding: 14,
    backgroundColor: '#FEF9E7',
    borderRadius: 12,
  },
  selectedCardText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  reservationToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reservationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  reservationLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  reservationIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  reservationIconActive: {
    backgroundColor: '#F5C400',
  },
  reservationTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  reservationSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  toggleSwitch: {
    width: 52,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E5E7EB',
    padding: 2,
    justifyContent: 'center',
  },
  toggleSwitchActive: {
    backgroundColor: '#F5C400',
  },
  toggleThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  toggleThumbActive: {
    transform: [{ translateX: 24 }],
  },
  dateTimeSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
    padding: 14,
    backgroundColor: '#FEF9E7',
    borderRadius: 12,
  },
  dateTimeText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  priceCard: {
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  priceGradient: {
    padding: 24,
    backgroundColor: '#1a1a1a',
    borderRadius: 24,
  },
  priceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  priceHeaderText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  priceBreakdown: {
    gap: 12,
  },
  tarifIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 16,
  },
  tarifIndicatorDay: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  tarifIndicatorNight: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
  },
  tarifIndicatorText: {
    fontSize: 13,
    fontWeight: '600',
  },
  tarifIndicatorTextDay: {
    color: '#F59E0B',
  },
  tarifIndicatorTextNight: {
    color: '#6366F1',
  },
  hauteursNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    padding: 12,
    borderRadius: 10,
    marginTop: 12,
  },
  hauteursNoteText: {
    flex: 1,
    fontSize: 12,
    color: '#22C55E',
    fontWeight: '500',
    lineHeight: 16,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 24,
  },
  priceRowService: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  priceRowServiceLeft: {
    flex: 1,
  },
  priceLabel: {
    fontSize: 14,
    color: '#9CA3AF',
    flex: 1,
  },
  priceLabelService: {
    fontSize: 14,
    color: '#F5C400',
    fontWeight: '600',
  },
  priceServiceHint: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  priceValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'right',
    minWidth: 100,
  },
  priceValueService: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F5C400',
    textAlign: 'right',
    minWidth: 100,
  },
  priceDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginVertical: 16,
  },
  totalSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'nowrap',
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    flexShrink: 0,
  },
  totalAmount: {
    fontSize: 24,
    fontWeight: '800',
    color: '#F5C400',
    flexShrink: 0,
    textAlign: 'right',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    paddingBottom: 32,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  orderButton: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  orderButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 18,
  },
  orderButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  // Styles pour le modal TPE
  tpeModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  tpeModalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    width: '100%',
    maxWidth: 340,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
  },
  tpeModalIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  tpeModalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 12,
    textAlign: 'center',
  },
  tpeModalText: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  tpeModalButton: {
    backgroundColor: '#F5C400',
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 12,
    shadowColor: '#F5C400',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  tpeModalButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    paddingBottom: 32,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  modalScroll: {
    maxHeight: 300,
  },
  cardOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 12,
    backgroundColor: '#F9FAFB',
  },
  cardOptionSelected: {
    backgroundColor: '#FEF9E7',
    borderWidth: 2,
    borderColor: '#F5C400',
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardInfo: {
    flex: 1,
  },
  cardBrand: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  cardExpiry: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  defaultBadge: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  defaultBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  addCardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: '#FEF9E7',
    borderRadius: 12,
  },
  addCardText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F5C400',
  },
  datePickerModal: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  datePickerContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 40,
  },
  datePickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  datePickerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  datePickerDone: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F5C400',
  },
  datePickerBack: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6B7280',
  },
  customPickerSection: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  customPickerLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dateScrollView: {
    flexDirection: 'row',
  },
  dateOption: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginRight: 10,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    minWidth: 70,
  },
  dateOptionSelected: {
    backgroundColor: '#F5C400',
  },
  dateOptionDay: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 4,
  },
  dateOptionNumber: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  dateOptionMonth: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6B7280',
    marginTop: 2,
  },
  dateOptionTextSelected: {
    color: '#FFFFFF',
  },
  timePickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  timePickerColumn: {
    alignItems: 'center',
  },
  timePickerColumnLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
    marginBottom: 8,
  },
  timeScrollView: {
    maxHeight: 160,
    width: 80,
  },
  timeOption: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginVertical: 4,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
  },
  timeOptionSelected: {
    backgroundColor: '#F5C400',
  },
  timeOptionDisabled: {
    backgroundColor: '#F9FAFB',
    opacity: 0.5,
  },
  timeOptionText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  timeOptionTextSelected: {
    color: '#FFFFFF',
  },
  timeOptionTextDisabled: {
    color: '#D1D5DB',
  },
  timeSeparator: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1a1a1a',
    marginHorizontal: 8,
    marginTop: 24,
  },
  dateTimeSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 20,
    paddingHorizontal: 24,
    marginHorizontal: 20,
    marginTop: 8,
    backgroundColor: '#FEF9E7',
    borderRadius: 16,
  },
  dateTimeSummaryText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
  },
});
