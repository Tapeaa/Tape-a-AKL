import { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Alert,
  Animated,
  PanResponder,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { MapView, Marker, Polyline, isMapsAvailable } from '@/lib/maps';
import Constants from 'expo-constants';
import { RIDE_OPTIONS } from '@/lib/types';
import { useTarifs, isNightRate, getCurrentRateLabel, type TarifsConfig } from '@/lib/tarifs';
import { apiFetch } from '@/lib/api';

// Source unique : app.config.js (via Constants.expoConfig.extra)
const GOOGLE_MAPS_API_KEY = Constants.expoConfig?.extra?.googleMapsApiKey || '';
const HEIGHT_SURCHARGE_AMOUNT = 500;

// Log pour debug - vérifier si la clé est disponible
if (__DEV__ || !GOOGLE_MAPS_API_KEY) {
  console.log('[CHOOSE_SERVICE] Google Maps API Key:', {
    hasKey: !!GOOGLE_MAPS_API_KEY,
    keyLength: GOOGLE_MAPS_API_KEY?.length || 0,
    fromConfig: !!Constants.expoConfig?.extra?.googleMapsApiKey,
  });
}

const TAHITI_REGION = {
  latitude: -17.5516,
  longitude: -149.5585,
  latitudeDelta: 0.0922,
  longitudeDelta: 0.0421,
};

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

type LocationData = {
  id: string;
  type: 'pickup' | 'stop' | 'destination';
  address: string;
  placeId?: string;
  lat?: number;
  lng?: number;
};

type ServiceType = 'immediate' | 'advance' | 'tour';

export default function ChooseServiceScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const mapRef = useRef<any>(null);
  const insets = useSafeAreaInsets();
  const liftAnim = useRef(new Animated.Value(0)).current;
  const scrollStartY = useRef(0);
  const panStartDy = useRef(0);
  
  // Hook pour récupérer les tarifs dynamiques depuis le back-office
  const { tarifs, loading: tarifsLoading } = useTarifs();

  const [pickup, setPickup] = useState<LocationData | null>(null);
  const [destination, setDestination] = useState<LocationData | null>(null);
  const [stops, setStops] = useState<LocationData[]>([]);
  const [routeCoordinates, setRouteCoordinates] = useState<Array<{ latitude: number; longitude: number }>>([]);
  const [isLoadingRoute, setIsLoadingRoute] = useState(true);
  const [selectedService, setSelectedService] = useState<ServiceType | null>('immediate');
  const [routeDistance, setRouteDistance] = useState<number>(0);
  const [heightSurchargeApplied, setHeightSurchargeApplied] = useState(false);

  useEffect(() => {
    // Récupérer les données depuis les params
    const parseCoord = (value: string | undefined): number | undefined => {
      if (!value || value.trim() === '') return undefined;
      const parsed = parseFloat(value);
      return isNaN(parsed) ? undefined : parsed;
    };

    const pickupData: LocationData = {
      id: 'pickup',
      type: 'pickup',
      address: params.pickup as string || '',
      placeId: params.pickupPlaceId as string || '',
      lat: parseCoord(params.pickupLat as string | undefined),
      lng: parseCoord(params.pickupLng as string | undefined),
    };

    const destinationData: LocationData = {
      id: 'destination',
      type: 'destination',
      address: params.destination as string || '',
      placeId: params.destinationPlaceId as string || '',
      lat: parseCoord(params.destinationLat as string | undefined),
      lng: parseCoord(params.destinationLng as string | undefined),
    };

    let stopsData: LocationData[] = [];
    if (params.stops) {
      try {
        const parsedStops = JSON.parse(params.stops as string) as any[];
        stopsData = parsedStops.map((stop) => ({
          id: stop.id || `stop-${Date.now()}`,
          type: 'stop' as const,
          address: stop.address || '',
          placeId: stop.placeId || '',
          lat: parseCoord(stop.lat?.toString()),
          lng: parseCoord(stop.lng?.toString()),
        }));
      } catch (e) {
        console.error('[CHOOSE_SERVICE] Error parsing stops:', e);
      }
    }

    setPickup(pickupData);
    setDestination(destinationData);
    setStops(stopsData);

    // Calculer la route
    calculateRouteAsync(pickupData, destinationData, stopsData).catch((error) => {
      console.error('[CHOOSE_SERVICE] Error calculating route:', error);
    });

    // Vérifier la majoration hauteur
    const checkHeightSurcharge = async () => {
      try {
        const response = await apiFetch<{ applies: boolean }>('/api/height-surcharge-check', {
          method: 'POST',
          body: JSON.stringify({
            pickup: {
              value: pickupData.address,
              placeId: pickupData.placeId || '',
              lat: pickupData.lat,
              lng: pickupData.lng,
            },
            destination: {
              value: destinationData.address,
              placeId: destinationData.placeId || '',
              lat: destinationData.lat,
              lng: destinationData.lng,
            },
          }),
        });
        if (response?.applies) {
          setHeightSurchargeApplied(true);
          console.log('[CHOOSE_SERVICE] Majoration hauteur appliquée');
        }
      } catch (e) {
        console.warn('[CHOOSE_SERVICE] Height surcharge check failed:', e);
      }
    };
    checkHeightSurcharge();
  }, []);

  const calculateRouteAsync = async (
    pickupData: LocationData,
    destinationData: LocationData,
    stopsData: LocationData[]
  ) => {
    if (!GOOGLE_MAPS_API_KEY) {
      console.error('[CHOOSE_SERVICE] ❌ Google Maps API key not configured! Cannot calculate route.');
      console.error('[CHOOSE_SERVICE] Constants.expoConfig?.extra:', Constants.expoConfig?.extra);
      setIsLoadingRoute(false);
      Alert.alert(
        'Erreur de configuration',
        'La clé Google Maps API n\'est pas configurée. Impossible de calculer l\'itinéraire.',
        [{ text: 'OK' }]
      );
      return;
    }

    setIsLoadingRoute(true);

    try {
      let origin: string;
      let destinationParam: string;

      let pickupLat = pickupData.lat;
      let pickupLng = pickupData.lng;
      let destinationLat = destinationData.lat;
      let destinationLng = destinationData.lng;

      if (!pickupLat || !pickupLng) {
        if (pickupData.placeId) {
          origin = `place_id:${pickupData.placeId}`;
        } else if (pickupData.address) {
          const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(pickupData.address)}&key=${GOOGLE_MAPS_API_KEY}&language=fr&region=pf`;
          const geocodeResponse = await fetch(geocodeUrl);
          const geocodeData = await geocodeResponse.json();
          if (geocodeData.status === 'OK' && geocodeData.results && geocodeData.results.length > 0) {
            const location = geocodeData.results[0].geometry.location;
            pickupLat = location.lat;
            pickupLng = location.lng;
            origin = `${pickupLat},${pickupLng}`;
            setPickup((prev) => prev ? { ...prev, lat: pickupLat, lng: pickupLng } : null);
          } else {
            setIsLoadingRoute(false);
            return;
          }
        } else {
          setIsLoadingRoute(false);
          return;
        }
      } else {
        origin = `${pickupLat},${pickupLng}`;
      }

      if (!destinationLat || !destinationLng) {
        if (destinationData.placeId) {
          destinationParam = `place_id:${destinationData.placeId}`;
        } else if (destinationData.address) {
          const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(destinationData.address)}&key=${GOOGLE_MAPS_API_KEY}&language=fr&region=pf`;
          const geocodeResponse = await fetch(geocodeUrl);
          const geocodeData = await geocodeResponse.json();
          if (geocodeData.status === 'OK' && geocodeData.results && geocodeData.results.length > 0) {
            const location = geocodeData.results[0].geometry.location;
            destinationLat = location.lat;
            destinationLng = location.lng;
            destinationParam = `${destinationLat},${destinationLng}`;
            setDestination((prev) => prev ? { ...prev, lat: destinationLat, lng: destinationLng } : null);
          } else {
            setIsLoadingRoute(false);
            return;
          }
        } else {
          setIsLoadingRoute(false);
          return;
        }
      } else {
        destinationParam = `${destinationLat},${destinationLng}`;
      }

      let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destinationParam)}&mode=driving&key=${GOOGLE_MAPS_API_KEY}&language=fr&region=pf`;

      if (stopsData.length > 0) {
        const waypoints = stopsData
          .map((stop) => {
            if (stop.placeId) return `place_id:${stop.placeId}`;
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

        // Calculer la distance totale
        let totalDistance = 0; // en mètres
        if (route.legs && route.legs.length > 0) {
          route.legs.forEach((leg: any) => {
            totalDistance += leg.distance?.value || 0;
          });
        }
        const distanceKm = totalDistance / 1000;
        setRouteDistance(distanceKm);
        console.log('[CHOOSE_SERVICE] Route distance calculated:', distanceKm, 'km');

        if (polyline) {
          const coordinates = decodePolyline(polyline);
          setRouteCoordinates(coordinates);

          if (mapRef.current && coordinates.length > 0) {
            // Sur cette page, on veut que l'itinéraire soit un peu plus haut
            // pour laisser de la place au bottom sheet.
            if (typeof mapRef.current.fitToCoordinates === 'function') {
              mapRef.current.fitToCoordinates(coordinates, {
                edgePadding: {
                  top: 80,
                  right: 40,
                  bottom: 260, // plus d'espace en bas pour le bloc des services
                  left: 40,
                },
                animated: true,
              });
            } else {
              const bounds = {
                minLat: Math.min(...coordinates.map((c) => c.latitude)),
                maxLat: Math.max(...coordinates.map((c) => c.latitude)),
                minLng: Math.min(...coordinates.map((c) => c.longitude)),
                maxLng: Math.max(...coordinates.map((c) => c.longitude)),
              };

              const centerLat = (bounds.minLat + bounds.maxLat) / 2;
              const centerLng = (bounds.minLng + bounds.maxLng) / 2;
              const latDelta = Math.max((bounds.maxLat - bounds.minLat) * 1.5, 0.01);
              const lngDelta = Math.max((bounds.maxLng - bounds.minLng) * 1.5, 0.01);

              // Légèrement décaler le centre vers le bas pour que la route
              // soit visuellement plus haute.
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
        } else if (pickupLat && pickupLng && destinationLat && destinationLng) {
          setRouteCoordinates([
            { latitude: pickupLat, longitude: pickupLng },
            { latitude: destinationLat, longitude: destinationLng },
          ]);
        }
      } else if (pickupLat && pickupLng && destinationLat && destinationLng) {
        setRouteCoordinates([
          { latitude: pickupLat, longitude: pickupLng },
          { latitude: destinationLat, longitude: destinationLng },
        ]);
      }
    } catch (error) {
      console.error('[CHOOSE_SERVICE] Error calculating route:', error);
      if (pickup?.lat && pickup?.lng && destination?.lat && destination?.lng) {
        setRouteCoordinates([
          { latitude: pickup.lat, longitude: pickup.lng },
          { latitude: destination.lat, longitude: destination.lng },
        ]);
      }
    } finally {
      setIsLoadingRoute(false);
    }
  };

  const handleServiceSelect = (serviceType: ServiceType) => {
    setSelectedService(serviceType);
    
    // Trouver l'option de service correspondante
    const rideOptionId = serviceType === 'immediate' ? 'immediate' : serviceType === 'advance' ? 'reservation' : 'tour';
    
    console.log('[CHOOSE_SERVICE] Service selected:', {
      serviceType,
      rideOptionId,
      routeDistance,
      stopsCount: stops.length,
    });

    // Formater les arrêts dans un format compatible avec AddressField / commande-options
    const formattedStops = stops.map((s, index) => ({
      id: s.id || `stop-${index}`,
      // "value" est le champ utilisé par AddressField côté backend
      value: s.address,
      // "address" sert pour l'affichage dans le récap
      address: s.address,
      placeId: s.placeId || '',
      type: 'stop' as const,
      ...(typeof s.lat === 'number' && typeof s.lng === 'number'
        ? { lat: s.lat, lng: s.lng }
        : {}),
    }));

    console.log('[CHOOSE_SERVICE] Formatted stops for params:', formattedStops);

    // Rediriger vers la page de récapitulatif (commande-options)
    router.push({
      pathname: '/(client)/commande-options',
      params: {
        type: rideOptionId,
        pickup: pickup?.address || '',
        pickupPlaceId: pickup?.placeId || '',
        pickupLat: pickup?.lat?.toString() || '',
        pickupLng: pickup?.lng?.toString() || '',
        destination: destination?.address || '',
        destinationPlaceId: destination?.placeId || '',
        destinationLat: destination?.lat?.toString() || '',
        destinationLng: destination?.lng?.toString() || '',
        stops: JSON.stringify(formattedStops),
      },
    });
  };

  // Calcul des prix en temps réel basé sur la distance et l'heure
  // Utiliser les tarifs dynamiques du back-office
  const priseEnCharge = tarifs?.priseEnCharge ?? 1000;
  const tarifJourKm = tarifs?.tarifJourKm ?? 130;
  const tarifNuitKm = tarifs?.tarifNuitKm ?? 260;
  
  const currentRateLabel = getCurrentRateLabel(new Date(), tarifs ?? undefined);
  const isNight = isNightRate(new Date(), tarifs ?? undefined);
  const ratePerKm = isNight ? tarifNuitKm : tarifJourKm;
  
  // Calculer le prix estimé pour taxi immédiat/réservation
  const heightSurcharge = heightSurchargeApplied ? HEIGHT_SURCHARGE_AMOUNT : 0;
  const estimatedPrice = routeDistance > 0 
    ? priseEnCharge + Math.round(routeDistance * ratePerKm) + heightSurcharge
    : priseEnCharge + heightSurcharge;

  const services = [
    {
      id: 'immediate' as ServiceType,
      title: 'Chauffeur ⚡',
      duration: '10 - 20 min',
      passengers: '1 - 8',
      price: routeDistance > 0 ? `${estimatedPrice.toLocaleString('fr-FR')} XPF` : `${priseEnCharge} XPF + ${ratePerKm} XPF/km`,
      rate: currentRateLabel,
      image: require('@/assets/images/1_1764131703346_1767064437791.png'),
    },
    {
      id: 'advance' as ServiceType,
      title: 'Réservation',
      duration: '45 - 1h',
      passengers: '1 - 8',
      price: routeDistance > 0 ? `${estimatedPrice.toLocaleString('fr-FR')} XPF` : `${priseEnCharge} XPF + tarif/km`,
      rate: 'Selon heure réservée',
      image: require('@/assets/images/2_1764131703346_1767064437791.png'),
    },
    {
      id: 'tour' as ServiceType,
      title: 'Tour de l\'Île',
      duration: '4 - 5h',
      passengers: '4 - 8',
      price: '30.000 XPF',
      rate: 'Forfait',
      image: require('@/assets/images/3_1764131703346_1767064437791.png'),
    },
  ];

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 6,
      onPanResponderGrant: (_, gestureState) => {
        panStartDy.current = gestureState.dy;
      },
      onPanResponderRelease: (_, gestureState) => {
        const delta = gestureState.dy - panStartDy.current;
        if (delta < -10) {
          liftServiceList();
        } else if (delta > 10) {
          resetServiceList();
        }
      },
      onPanResponderTerminationRequest: () => true,
    })
  ).current;

  const liftServiceList = () => {
    Animated.timing(liftAnim, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
  };

  const resetServiceList = () => {
    Animated.timing(liftAnim, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  };

  useEffect(() => {
    return () => {};
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.mapBackground}>
        <View style={styles.mapContainer}>
          {/* Header en overlay */}
          <View style={[styles.headerOverlay, { paddingTop: insets.top + 12 }]}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButtonBubble}>
              <Ionicons name="arrow-back" size={20} color="#1a1a1a" />
            </TouchableOpacity>
            <View style={styles.titleBubble}>
              <Text variant="h3" style={styles.headerTitle}>
                Choisissez votre service
              </Text>
            </View>
          </View>
          {isMapsAvailable ? (
            <>
              <MapView
                ref={mapRef}
                style={styles.map}
                initialRegion={TAHITI_REGION}
                showsUserLocation={false}
                showsMyLocationButton={false}
                toolbarEnabled={false}
              >
                {/* Tracé du trajet - Ligne jaune avec ligne noire au centre */}
                {routeCoordinates.length > 0 ? (
                  <>
                    {/* Ligne jaune (fond) */}
                  <Polyline
                    coordinates={routeCoordinates}
                      strokeColor="rgba(245, 196, 0, 0.75)"
                    strokeWidth={6}
                    lineCap="round"
                    lineJoin="round"
                    geodesic={true}
                  />
                    {/* Ligne noire (centre) */}
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
                  pickup && destination && pickup.lat && pickup.lng && destination.lat && destination.lng && (
                    <>
                      {/* Ligne jaune (fond) */}
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
                      {/* Ligne noire (centre) */}
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

                {/* Marqueur de départ */}
                {pickup && pickup.lat !== undefined && pickup.lat !== null && pickup.lng !== undefined && pickup.lng !== null && (
                  <Marker
                    coordinate={{ latitude: pickup.lat, longitude: pickup.lng }}
                    anchor={{ x: 0.5, y: 0.85 }}
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
                )}

                {/* Marqueurs d'arrêts */}
                {stops.map((stop, index) =>
                  (stop.lat !== undefined && stop.lng !== undefined) ? (
                    <Marker
                      key={stop.id || `stop-${index}`}
                      coordinate={{ latitude: stop.lat!, longitude: stop.lng! }}
                      anchor={{ x: 0.5, y: 1 }}
                    >
                      <View style={styles.markerContainer}>
                        <Image
                          source={require('@/assets/images/lestop.png')}
                          style={styles.markerIconStop}
                        />
                      </View>
                    </Marker>
                  ) : null
                )}

                {/* Marqueur d'arrivée */}
                {destination && destination.lat !== undefined && destination.lat !== null && destination.lng !== undefined && destination.lng !== null && (
                  <Marker
                    coordinate={{ latitude: destination.lat, longitude: destination.lng }}
                    anchor={{ x: 0.5, y: 1 }}
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
                )}
              </MapView>
            </>
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
        </View>
      </View>

      {isLoadingRoute && (
        <LoadingOverlay
          absolute
          title="Calcul du trajet..."
          subtitle="Nous préparons votre itinéraire"
        />
      )}

      {/* Bottom Sheet avec sélection de service */}
      <View style={styles.serviceContainer}>
        <Animated.View
          {...panResponder.panHandlers}
          style={[
            styles.serviceListPanel,
            {
              transform: [
                {
                  translateY: liftAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -88],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={styles.dragHandle} />
          <ScrollView 
            style={styles.serviceScroll} 
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.serviceContent}
            scrollEventThrottle={16}
            onScrollBeginDrag={(event) => {
              scrollStartY.current = event.nativeEvent.contentOffset.y;
            }}
            onScrollEndDrag={(event) => {
              const endY = event.nativeEvent.contentOffset.y;
              const delta = endY - scrollStartY.current;
              if (delta > 10) {
                liftServiceList();
              } else if (delta < -10) {
                resetServiceList();
              }
            }}
            onMomentumScrollEnd={(event) => {
              const endY = event.nativeEvent.contentOffset.y;
              const delta = endY - scrollStartY.current;
              if (delta > 10) {
                liftServiceList();
              } else if (delta < -10) {
                resetServiceList();
              }
            }}
          >
            {services.map((service) => (
              <View key={service.id}>
                <TouchableOpacity
                  style={[
                    styles.serviceCard,
                    selectedService === service.id && styles.serviceCardSelected,
                  ]}
                  onPress={() => setSelectedService(service.id)}
                >
                  {selectedService === service.id && (
                    <View style={styles.selectionHighlight} />
                  )}
                  <View style={styles.imageContainer}>
                    <Image source={service.image} style={styles.serviceImage} resizeMode="cover" />
                  </View>
                  <View style={styles.serviceInfo}>
                    <Text style={styles.serviceTitle}>{service.title}</Text>
                    <View style={styles.serviceDetails}>
                      <Text style={styles.serviceDetail}>{service.duration}</Text>
                      <Text style={styles.serviceDetail}>•</Text>
                      <Text style={styles.serviceDetail}>{service.passengers}</Text>
                    </View>
                  </View>
                  <View style={styles.servicePrice}>
                    <View style={styles.priceTag}>
                    <Text style={styles.servicePriceText}>{service.price}</Text>
                    </View>
                    <Text style={styles.serviceRateText}>{service.rate}</Text>
                  </View>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        </Animated.View>

        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={styles.continueButton}
            onPress={() => {
              if (selectedService) {
                handleServiceSelect(selectedService);
              }
            }}
            disabled={!selectedService}
          >
            <Text style={styles.continueButtonText}>Poursuivre ma commande</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => router.back()}
          >
            <Text style={styles.cancelButtonText}>Annuler</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  mapBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 0,
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  map: {
    flex: 1,
  },
  mapPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#E3F2FD',
  },
  mapPlaceholderText: {
    marginTop: 16,
    fontSize: 16,
    color: '#64B5F6',
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
    paddingHorizontal: 16,
    paddingBottom: 12,
    zIndex: 10,
  },
  backButtonBubble: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    position: 'absolute',
    left: 16,
    top: 60,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  titleBubble: {
    alignSelf: 'center',
    marginLeft: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  headerTitle: {
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  markerContainer: {
    alignItems: 'center',
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
  serviceContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '38%',
    zIndex: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
  serviceListPanel: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    zIndex: 5,
    paddingTop: 10,
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  serviceScroll: {
    flex: 1,
  },
  serviceContent: {
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 120,
  },
  serviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 4,
    marginHorizontal: 4,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#F0F0F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
    minHeight: 64,
  },
  serviceCardSelected: {
    borderColor: '#F5C400',
    borderWidth: 2,
  },
  imageContainer: {
    width: 70,
    height: 53,
    marginRight: 12,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  serviceImage: {
    width: '100%',
    height: '100%',
  },
  serviceInfo: {
    flex: 1,
    marginRight: 8,
  },
  serviceTitle: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: Platform.select({ ios: 'AvenirNext-DemiBold', android: 'sans-serif-medium', default: 'System' }),
    color: '#1a1a1a',
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  serviceDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  serviceDetail: {
    fontSize: 10,
    color: '#8B8B8B',
    fontWeight: '600',
  },
  servicePrice: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    flexShrink: 0,
    marginLeft: 6,
  },
  priceTag: {
    backgroundColor: '#FEF9E7',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#F5C400',
  },
  servicePriceText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#B8860B',
    textAlign: 'right',
  },
  serviceRateText: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 4,
    textAlign: 'right',
    fontWeight: '600',
  },
  actionButtons: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    padding: 20,
    paddingTop: 16,
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 10,
    zIndex: 10,
  },
  continueButton: {
    flex: 1,
    backgroundColor: '#F5C400',
    borderRadius: 20,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  cancelButton: {
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  selectionHighlight: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(245, 196, 0, 0.15)',
  },
  serviceSeparator: {
    height: 1,
    width: '55%',
    backgroundColor: '#E5E7EB',
    alignSelf: 'center',
    marginVertical: 4,
  },
});
