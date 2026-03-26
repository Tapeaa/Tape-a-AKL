import { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Modal,
  ScrollView,
  Animated,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { MapView, Marker, Polyline, isMapsAvailable } from '@/lib/maps';
import Constants from 'expo-constants';

// Source unique : app.config.js (via Constants.expoConfig.extra)
const GOOGLE_MAPS_API_KEY = Constants.expoConfig?.extra?.googleMapsApiKey || '';

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

export default function ConfirmItineraryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const mapRef = useRef<any>(null);
  const insets = useSafeAreaInsets();

  const [pickup, setPickup] = useState<LocationData | null>(null);
  const [destination, setDestination] = useState<LocationData | null>(null);
  const [stops, setStops] = useState<LocationData[]>([]);
  const [routeCoordinates, setRouteCoordinates] = useState<Array<{ latitude: number; longitude: number }>>([]);
  const [isLoadingRoute, setIsLoadingRoute] = useState(true);
  const [showRouteErrorModal, setShowRouteErrorModal] = useState(false);
  const [routeErrorMessage, setRouteErrorMessage] = useState('');
  const [isAddressListExpanded, setIsAddressListExpanded] = useState(true);

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
        console.error('[CONFIRM_ITINERARY] Error parsing stops:', e);
      }
    }

    console.log('[CONFIRM_ITINERARY] Data loaded:', {
      pickup: { address: pickupData.address, placeId: pickupData.placeId, lat: pickupData.lat, lng: pickupData.lng },
      destination: { address: destinationData.address, placeId: destinationData.placeId, lat: destinationData.lat, lng: destinationData.lng },
      stopsCount: stopsData.length,
    });

    // Vérifier que les données essentielles sont présentes
    if (!pickupData.address || !destinationData.address) {
      console.error('[CONFIRM_ITINERARY] Missing required addresses:', {
        pickup: pickupData.address,
        destination: destinationData.address,
      });
      router.back();
      return;
    }

    setPickup(pickupData);
    setDestination(destinationData);
    setStops(stopsData);


    // Calculer la route avec les données chargées
    calculateRouteAsync(pickupData, destinationData, stopsData).catch((error) => {
      console.error('[CONFIRM_ITINERARY] Unhandled error in calculateRouteAsync:', error);
    });
  }, []);

  // Fonction pour calculer la route - définie en dehors du useEffect
  const calculateRouteAsync = async (
    pickupData: LocationData,
    destinationData: LocationData,
    stopsData: LocationData[]
  ) => {
    console.log('[CONFIRM_ITINERARY] calculateRoute called:', { pickup: pickupData, destination: destinationData, stops: stopsData });
    
    if (!GOOGLE_MAPS_API_KEY) {
      console.error('[CONFIRM_ITINERARY] Google Maps API key not configured');
      setIsLoadingRoute(false);
      return;
    }

    setIsLoadingRoute(true);

    // Déclarer les variables en dehors du try pour qu'elles soient accessibles dans le catch
    let pickupLat = pickupData.lat;
    let pickupLng = pickupData.lng;
    let destinationLat = destinationData.lat;
    let destinationLng = destinationData.lng;

    try {
      // Construire l'URL pour Directions API
      let origin: string;
      let destinationParam: string;

      // Si on n'a pas de coordonnées, on doit faire un geocoding pour obtenir les coordonnées depuis l'adresse
      if (!pickupLat || !pickupLng) {
        if (pickupData.placeId) {
          origin = `place_id:${pickupData.placeId}`;
        } else if (pickupData.address) {
          // Faire un geocoding pour obtenir les coordonnées
          const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(pickupData.address)}&key=${GOOGLE_MAPS_API_KEY}&language=fr&region=pf`;
          const geocodeResponse = await fetch(geocodeUrl);
          const geocodeData = await geocodeResponse.json();
          if (geocodeData.status === 'OK' && geocodeData.results && geocodeData.results.length > 0) {
            const location = geocodeData.results[0].geometry.location;
            pickupLat = location.lat;
            pickupLng = location.lng;
            origin = `${pickupLat},${pickupLng}`;
            console.log('[CONFIRM_ITINERARY] Geocoded pickup:', origin);
            // Mettre à jour l'état avec les coordonnées
            setPickup((prev) => prev ? { ...prev, lat: pickupLat, lng: pickupLng } : null);
          } else {
            console.error('[CONFIRM_ITINERARY] Geocoding failed for pickup');
            setIsLoadingRoute(false);
            return;
          }
        } else {
          console.error('[CONFIRM_ITINERARY] No pickup coordinates or address');
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
          // Faire un geocoding pour obtenir les coordonnées
          const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(destinationData.address)}&key=${GOOGLE_MAPS_API_KEY}&language=fr&region=pf`;
          const geocodeResponse = await fetch(geocodeUrl);
          const geocodeData = await geocodeResponse.json();
          if (geocodeData.status === 'OK' && geocodeData.results && geocodeData.results.length > 0) {
            const location = geocodeData.results[0].geometry.location;
            destinationLat = location.lat;
            destinationLng = location.lng;
            destinationParam = `${destinationLat},${destinationLng}`;
            console.log('[CONFIRM_ITINERARY] Geocoded destination:', destinationParam);
            // Mettre à jour l'état avec les coordonnées
            setDestination((prev) => prev ? { ...prev, lat: destinationLat, lng: destinationLng } : null);
          } else {
            console.error('[CONFIRM_ITINERARY] Geocoding failed for destination');
            setIsLoadingRoute(false);
            return;
          }
        } else {
          console.error('[CONFIRM_ITINERARY] No destination coordinates or address');
          setIsLoadingRoute(false);
          return;
        }
      } else {
        destinationParam = `${destinationLat},${destinationLng}`;
      }

      let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destinationParam)}&mode=driving&key=${GOOGLE_MAPS_API_KEY}&language=fr&region=pf`;

      // Ajouter waypoints si présents
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

      console.log('[CONFIRM_ITINERARY] Fetching directions from:', url);
      const response = await fetch(url);
      const data = await response.json();

      console.log('[CONFIRM_ITINERARY] Directions response:', {
        status: data.status,
        routesCount: data.routes?.length || 0,
        error: data.error_message,
      });

      if (data.status === 'OK' && data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const polyline = route.overview_polyline?.points;

        console.log('[CONFIRM_ITINERARY] Polyline received:', polyline ? `${polyline.substring(0, 50)}...` : 'null');

        if (polyline) {
          // Décoder la polyline (format Google Maps)
          const coordinates = decodePolyline(polyline);
          console.log('[CONFIRM_ITINERARY] Decoded coordinates count:', coordinates.length);
          console.log('[CONFIRM_ITINERARY] First coordinate:', coordinates[0]);
          console.log('[CONFIRM_ITINERARY] Last coordinate:', coordinates[coordinates.length - 1]);
          
          setRouteCoordinates(coordinates);
          
          // Mettre à jour les coordonnées dans les états si elles n'étaient pas définies
          // Utiliser les coordonnées de la route comme fallback
          if (coordinates.length > 0) {
            const firstCoord = coordinates[0];
            const lastCoord = coordinates[coordinates.length - 1];
            
            // Mettre à jour pickup si les coordonnées ne sont pas définies
            setPickup((prevPickup) => {
              if (prevPickup && (!prevPickup.lat || !prevPickup.lng)) {
                console.log('[CONFIRM_ITINERARY] Updating pickup coordinates from route:', firstCoord);
                return { ...prevPickup, lat: firstCoord.latitude, lng: firstCoord.longitude };
              }
              return prevPickup;
            });
            
            // Mettre à jour destination si les coordonnées ne sont pas définies
            setDestination((prevDestination) => {
              if (prevDestination && (!prevDestination.lat || !prevDestination.lng)) {
                console.log('[CONFIRM_ITINERARY] Updating destination coordinates from route:', lastCoord);
                return { ...prevDestination, lat: lastCoord.latitude, lng: lastCoord.longitude };
              }
              return prevDestination;
            });
          }

          // Ajuster la carte pour afficher tout le trajet dans la partie supérieure
          if (mapRef.current && coordinates.length > 0) {
            // Utiliser fitToCoordinates pour centrer le trajet en haut
            if (typeof mapRef.current.fitToCoordinates === 'function') {
              mapRef.current.fitToCoordinates(coordinates, {
                edgePadding: {
                  top: 80,
                  right: 40,
                  bottom: 300, // Beaucoup d'espace en bas pour la section résumé
                  left: 40,
                },
                animated: true,
              });
            } else {
              // Fallback avec animateToRegion
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

              mapRef.current.animateToRegion(
                {
                  latitude: centerLat,
                  longitude: centerLng,
                  latitudeDelta: latDelta,
                  longitudeDelta: lngDelta,
                },
                1000
              );
            }
          }
        } else {
          console.error('[CONFIRM_ITINERARY] No polyline in route');
          // Essayer de créer une ligne droite entre pickup et destination si pas de polyline
          if (pickupLat && pickupLng && destinationLat && destinationLng) {
            console.log('[CONFIRM_ITINERARY] Creating straight line fallback');
            setRouteCoordinates([
              { latitude: pickupLat, longitude: pickupLng },
              { latitude: destinationLat, longitude: destinationLng },
            ]);
          }
        }
      } else {
        // Log sans niveau error pour éviter les problèmes avec Apple
        console.log('[CONFIRM_ITINERARY] Directions status:', data.status, data.error_message || '');
        
        // Afficher le modal stylé pour informer l'utilisateur
        if (data.status === 'ZERO_RESULTS' || data.status === 'NOT_FOUND' || data.status === 'MAX_ROUTE_LENGTH_EXCEEDED') {
          setRouteErrorMessage('Désolé, nous ne pouvons pas calculer d\'itinéraire vers cette destination. Cette zone n\'est peut-être pas accessible par la route.');
          setShowRouteErrorModal(true);
        }
        
        // En cas d'erreur, créer une ligne droite entre pickup et destination
        if (pickupLat && pickupLng && destinationLat && destinationLng) {
          console.log('[CONFIRM_ITINERARY] Creating straight line fallback due to error');
          setRouteCoordinates([
            { latitude: pickupLat, longitude: pickupLng },
            { latitude: destinationLat, longitude: destinationLng },
          ]);
        }
      }
    } catch (error) {
      console.log('[CONFIRM_ITINERARY] Route calculation exception:', error);
      // En cas d'erreur, créer une ligne droite entre pickup et destination
      if (pickupLat && pickupLng && destinationLat && destinationLng) {
        console.log('[CONFIRM_ITINERARY] Creating straight line fallback due to exception');
        setRouteCoordinates([
          { latitude: pickupLat, longitude: pickupLng },
          { latitude: destinationLat, longitude: destinationLng },
        ]);
      }
    } finally {
      setIsLoadingRoute(false);
    }
  };
  
  // Recalculer la route si les coordonnées deviennent disponibles après le chargement initial
  useEffect(() => {
    if (pickup && destination && pickup.address && destination.address) {
      // Vérifier si on a déjà des coordonnées de route ou si on doit recalculer
      const hasCoordinates = (pickup.lat && pickup.lng && destination.lat && destination.lng);
      const needsRecalculation = hasCoordinates && routeCoordinates.length === 0 && !isLoadingRoute;
      
      if (needsRecalculation) {
        console.log('[CONFIRM_ITINERARY] Recalculating route with available coordinates');
        const stopsData = stops || [];
        // Utiliser un timeout pour éviter les appels multiples rapides
        const timeoutId = setTimeout(() => {
          calculateRouteAsync(pickup, destination, stopsData).catch((error) => {
            console.error('[CONFIRM_ITINERARY] Error recalculating route:', error);
          });
        }, 500);
        
        return () => clearTimeout(timeoutId);
      }
    }
  }, [pickup?.lat, pickup?.lng, destination?.lat, destination?.lng]);

  useEffect(() => {
    console.log('[CONFIRM_ITINERARY] State updated:', {
      pickup: pickup ? { lat: pickup.lat, lng: pickup.lng, address: pickup.address } : null,
      destination: destination ? { lat: destination.lat, lng: destination.lng, address: destination.address } : null,
      routeCoordinatesCount: routeCoordinates.length
    });
  }, [pickup, destination, routeCoordinates]);

  const handleConfirm = () => {
    // Rediriger vers la page de sélection de service
    router.push({
      pathname: '/(client)/ride/choose-service',
      params: {
        pickup: pickup?.address || '',
        pickupPlaceId: pickup?.placeId || '',
        pickupLat: pickup?.lat?.toString() || '',
        pickupLng: pickup?.lng?.toString() || '',
        destination: destination?.address || '',
        destinationPlaceId: destination?.placeId || '',
        destinationLat: destination?.lat?.toString() || '',
        destinationLng: destination?.lng?.toString() || '',
        stops: JSON.stringify(stops),
      },
    });
  };

  const handleChange = () => {
    router.back();
  };

  const getMarkerColor = (type: 'pickup' | 'stop' | 'destination') => {
    switch (type) {
      case 'pickup':
        return '#22C55E';
      case 'destination':
        return '#EF4444';
      case 'stop':
        return '#F5C400';
    }
  };

  const allLocations = pickup && destination 
    ? [pickup, ...stops, destination].filter(Boolean)
    : [];

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
              Confirmer l'itinéraire
            </Text>
          </View>
        </View>
        {isMapsAvailable ? (
          <View style={styles.mapContainer}>
          <MapView
            ref={mapRef}
            style={styles.map}
            initialRegion={TAHITI_REGION}
            showsUserLocation={false}
            showsMyLocationButton={false}
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
                    strokeWidth={1.5}
                    lineCap="round"
                    lineJoin="round"
                    geodesic={true}
                  />
                </>
              ) : (
                // Fallback : ligne droite si pas de route calculée mais qu'on a les coordonnées
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
                      strokeWidth={2}
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
          
          {/* Message si itinéraire non disponible (en dehors de MapView) */}
          {!isLoadingRoute && routeCoordinates.length === 0 && (
            <View style={styles.routeMessageOverlay}>
              <Text style={styles.routeMessageText}>Itinéraire non disponible</Text>
            </View>
          )}
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
        </View>
      </View>

      {isLoadingRoute && (
        <LoadingOverlay
          absolute
          title="Calcul du trajet..."
          subtitle="Nous préparons votre itinéraire"
        />
      )}

      <View style={[styles.summaryContainer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        {stops.length > 0 ? (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => setIsAddressListExpanded(!isAddressListExpanded)}
            style={styles.toggleHeaderButton}
          >
            <Ionicons
              name={isAddressListExpanded ? 'chevron-down' : 'chevron-up'}
              size={16}
              color="#6B7280"
            />
            <Text style={styles.toggleHeaderText}>
              {isAddressListExpanded ? 'Réduire' : 'Voir le détail'}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.dragHandleArea}>
            <View style={styles.dragHandle} />
          </View>
        )}

        {isAddressListExpanded ? (
          stops.length > 2 ? (
            <ScrollView
              style={styles.addressScrollView}
              showsVerticalScrollIndicator={true}
              nestedScrollEnabled={true}
              contentContainerStyle={styles.addressListContainer}
            >
              {pickup && (
                <View style={styles.summaryItem}>
                  <View style={styles.summaryIconDepart}>
                    <Ionicons name="radio-button-on" size={16} color="#F5C400" />
                  </View>
                  <View style={styles.summaryTextContainer}>
                    <Text style={styles.summaryLabelDepart}>Départ</Text>
                    <Text style={styles.summaryAddress} numberOfLines={1}>{pickup.address}</Text>
                  </View>
                </View>
              )}

              {stops.map((stop, index) => (
                <View key={stop.id || `stop-${index}`} style={styles.summaryItem}>
                  <View style={styles.summaryIconStop}>
                    <Ionicons name="add-circle" size={16} color="#F59E0B" />
                  </View>
                  <View style={styles.summaryTextContainer}>
                    <Text style={styles.summaryLabelStop}>Arrêt {index + 1}</Text>
                    <Text style={styles.summaryAddress} numberOfLines={1}>{stop.address}</Text>
                  </View>
                </View>
              ))}

              {destination && (
                <View style={styles.summaryItem}>
                  <View style={styles.summaryIconArrivee}>
                    <Ionicons name="location" size={16} color="#EF4444" />
                  </View>
                  <View style={styles.summaryTextContainer}>
                    <Text style={styles.summaryLabelArrivee}>Arrivée</Text>
                    <Text style={styles.summaryAddress} numberOfLines={1}>{destination.address}</Text>
                  </View>
                </View>
              )}

            </ScrollView>
          ) : (
            <View style={styles.addressListContainer}>
              {pickup && (
                <View style={styles.summaryItem}>
                  <View style={styles.summaryIconDepart}>
                    <Ionicons name="radio-button-on" size={16} color="#F5C400" />
                  </View>
                  <View style={styles.summaryTextContainer}>
                    <Text style={styles.summaryLabelDepart}>Départ</Text>
                    <Text style={styles.summaryAddress} numberOfLines={1}>{pickup.address}</Text>
                  </View>
                </View>
              )}

              {stops.map((stop, index) => (
                <View key={stop.id || `stop-${index}`} style={styles.summaryItem}>
                  <View style={styles.summaryIconStop}>
                    <Ionicons name="add-circle" size={16} color="#F59E0B" />
                  </View>
                  <View style={styles.summaryTextContainer}>
                    <Text style={styles.summaryLabelStop}>Arrêt {index + 1}</Text>
                    <Text style={styles.summaryAddress} numberOfLines={1}>{stop.address}</Text>
                  </View>
                </View>
              ))}

              {destination && (
                <View style={styles.summaryItem}>
                  <View style={styles.summaryIconArrivee}>
                    <Ionicons name="location" size={16} color="#EF4444" />
                  </View>
                  <View style={styles.summaryTextContainer}>
                    <Text style={styles.summaryLabelArrivee}>Arrivée</Text>
                    <Text style={styles.summaryAddress} numberOfLines={1}>{destination.address}</Text>
                  </View>
                </View>
              )}
            </View>
          )
        ) : (
          <View style={styles.addressListContainer}>
            <View style={styles.collapsedSummary}>
              <View style={styles.collapsedRow}>
                <View style={styles.summaryIconDepart}>
                  <Ionicons name="radio-button-on" size={14} color="#F5C400" />
                </View>
                <Text style={styles.collapsedAddress} numberOfLines={1}>{pickup?.address}</Text>
              </View>
              <Ionicons name="arrow-forward" size={14} color="#D1D5DB" />
              {stops.length > 0 && (
                <>
                  <View style={styles.stopsCountBadge}>
                    <Text style={styles.stopsCountText}>{stops.length} arrêt{stops.length > 1 ? 's' : ''}</Text>
                  </View>
                  <Ionicons name="arrow-forward" size={14} color="#D1D5DB" />
                </>
              )}
              <View style={styles.collapsedRow}>
                <View style={styles.summaryIconArrivee}>
                  <Ionicons name="location" size={14} color="#EF4444" />
                </View>
                <Text style={styles.collapsedAddress} numberOfLines={1}>{destination?.address}</Text>
              </View>
            </View>
          </View>
        )}

        <View style={styles.confirmationSection}>
          <Text style={styles.confirmationQuestion}>
            Êtes-vous sûr de votre itinéraire ?
          </Text>
          <View style={styles.confirmationButtons}>
            <TouchableOpacity
              style={[styles.confirmationButton, styles.changeButton]}
              onPress={handleChange}
            >
              <Text style={styles.changeButtonText}>Changer</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmationButton, styles.confirmButton]}
              onPress={handleConfirm}
            >
              <Text style={styles.confirmButtonText}>Oui</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Modal d'erreur de trajet stylé */}
      <Modal
        visible={showRouteErrorModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          setShowRouteErrorModal(false);
          router.back();
        }}
      >
        <View style={styles.routeErrorOverlay}>
          <View style={styles.routeErrorModal}>
            <View style={styles.routeErrorIconContainer}>
              <Ionicons name="warning" size={48} color="#F59E0B" />
            </View>
            <Text style={styles.routeErrorTitle}>Trajet non disponible</Text>
            <Text style={styles.routeErrorMessage}>{routeErrorMessage}</Text>
            <TouchableOpacity
              style={styles.routeErrorButton}
              onPress={() => {
                setShowRouteErrorModal(false);
                router.back();
              }}
            >
              <Text style={styles.routeErrorButtonText}>Compris</Text>
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
    backgroundColor: '#FFFFFF',
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
    backgroundColor: '#e5e7eb',
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
  routeMessageOverlay: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  routeMessageText: {
    fontSize: 14,
    color: '#6B7280',
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
  summaryContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    zIndex: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
  toggleHeaderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
  },
  toggleHeaderText: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '600',
  },
  dragHandleArea: {
    paddingVertical: 6,
    alignItems: 'center',
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#D1D5DB',
    borderRadius: 2,
  },
  addressScrollView: {
    maxHeight: 180,
  },
  addressListContainer: {
    paddingHorizontal: 20,
    paddingBottom: 4,
    gap: 8,
  },
  summaryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#FAFAFA',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F0F0F0',
  },
  summaryIconDepart: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(245, 196, 0, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  summaryIconStop: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  summaryIconArrivee: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  summaryTextContainer: {
    flex: 1,
  },
  summaryLabelDepart: {
    fontSize: 10,
    fontWeight: '700',
    color: '#F5C400',
    marginBottom: 1,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryLabelStop: {
    fontSize: 10,
    fontWeight: '700',
    color: '#F59E0B',
    marginBottom: 1,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryLabelArrivee: {
    fontSize: 10,
    fontWeight: '700',
    color: '#EF4444',
    marginBottom: 1,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryAddress: {
    fontSize: 13,
    color: '#1A1A1A',
    fontWeight: '500',
  },
  toggleListButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
    marginTop: 2,
  },
  toggleListText: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
  collapsedSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#FAFAFA',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F0F0F0',
  },
  collapsedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
    minWidth: 0,
  },
  collapsedAddress: {
    fontSize: 12,
    color: '#1A1A1A',
    fontWeight: '500',
    flex: 1,
  },
  stopsCountBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    flexShrink: 0,
  },
  stopsCountText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#D97706',
  },
  confirmationSection: {
    padding: 18,
    paddingTop: 14,
    marginHorizontal: 12,
    marginTop: 4,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#F0F0F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 5,
  },
  confirmationQuestion: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
    textAlign: 'center',
    marginBottom: 14,
  },
  confirmationButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  confirmationButton: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  changeButton: {
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  changeButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6B7280',
  },
  confirmButton: {
    backgroundColor: '#F5C400',
    shadowColor: '#F5C400',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  confirmButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  noRouteContainer: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  noRouteText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
  routeErrorOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  routeErrorModal: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 28,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  routeErrorIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  routeErrorTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 12,
    textAlign: 'center',
  },
  routeErrorMessage: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  routeErrorButton: {
    backgroundColor: '#F5C400',
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 14,
    shadowColor: '#F5C400',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  routeErrorButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A1A',
  },
});
