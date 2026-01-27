import { useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  Keyboard,
  ActivityIndicator,
  Platform,
  ScrollView,
  Modal,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { apiFetch } from '@/lib/api';
import Constants from 'expo-constants';

// Obtenir la clé Google Maps API depuis les variables d'environnement
// Source unique : app.config.js (via Constants.expoConfig.extra)
const GOOGLE_MAPS_API_KEY = Constants.expoConfig?.extra?.googleMapsApiKey || '';
const HEIGHT_SURCHARGE_THRESHOLD_METERS = 250;
const HEIGHT_SURCHARGE_AMOUNT = 500;

// Log pour debug - FORCE l'affichage au chargement du module
console.log('[ITINERARY] ===== INITIALIZATION =====');
console.log('[ITINERARY] Google Maps API Key loaded:', {
  hasKey: !!GOOGLE_MAPS_API_KEY,
  keyLength: GOOGLE_MAPS_API_KEY?.length || 0,
  fromConfig: !!Constants.expoConfig?.extra?.googleMapsApiKey,
});
console.log('[ITINERARY] ========================');

type PlacePrediction = {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
};

type LocationPoint = {
  id: string;
  type: 'pickup' | 'stop' | 'destination';
  address: string;
  placeId: string | null;
  coordinates: { lat: number; lng: number } | null;
};

export default function ItineraryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [locations, setLocations] = useState<LocationPoint[]>([
    { id: 'pickup', type: 'pickup', address: '', placeId: null, coordinates: null },
    { id: 'destination', type: 'destination', address: '', placeId: null, coordinates: null },
  ]);
  const [activeInputId, setActiveInputId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<PlacePrediction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [heightPopupVisible, setHeightPopupVisible] = useState(false);
  const heightPopupKeyRef = useRef<string | null>(null);
  const heightPopupShownRef = useRef<string | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const inputRefs = useRef<Map<string, TextInput>>(new Map());

  const fetchElevations = async (coords: Array<{ lat: number; lng: number }>): Promise<number[]> => {
    if (!GOOGLE_MAPS_API_KEY || coords.length === 0) return [];
    const locations = coords.map((c) => `${c.lat},${c.lng}`).join('|');
    const url = `https://maps.googleapis.com/maps/api/elevation/json?locations=${encodeURIComponent(
      locations
    )}&key=${GOOGLE_MAPS_API_KEY}`;

    try {
      const response = await fetch(url);
      if (!response.ok) return [];
      const data: any = await response.json();
      if (data.status !== 'OK' || !Array.isArray(data.results)) return [];
      return data.results
        .map((r: any) => Number(r?.elevation))
        .filter((e: number) => Number.isFinite(e));
    } catch (error) {
      console.warn('[ITINERARY] Elevation failed:', error);
      return [];
    }
  };

  const geocodeAddress = async (address: string): Promise<{ lat: number; lng: number } | null> => {
    if (!GOOGLE_MAPS_API_KEY || !address) return null;
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}&language=fr&region=pf`;
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const data: any = await response.json();
      if (data.status !== 'OK' || !Array.isArray(data.results) || data.results.length === 0) return null;
      const location = data.results[0]?.geometry?.location;
      if (!location) return null;
      return { lat: Number(location.lat), lng: Number(location.lng) };
    } catch (error) {
      console.warn('[ITINERARY] Geocode failed:', error);
      return null;
    }
  };

  // Préremplir destination si on vient de la sélection sur la carte
  useEffect(() => {
    const destinationAddress = params.destinationAddress as string;
    const destinationLat = params.destinationLat as string;
    const destinationLng = params.destinationLng as string;

    if (destinationAddress) {
      setLocations((prev) =>
        prev.map((loc) =>
          loc.id === 'destination'
            ? {
                ...loc,
                address: destinationAddress,
                placeId: null,
                coordinates: destinationLat && destinationLng
                  ? { lat: parseFloat(destinationLat), lng: parseFloat(destinationLng) }
                  : null,
              }
            : loc
        )
      );
    }
  }, [params.destinationAddress, params.destinationLat, params.destinationLng]);

  // Focus automatique sur le champ destination si demandé (ouvre le clavier)
  useEffect(() => {
    const focusField = params.focusField as string;
    if (focusField === 'destination' || focusField === 'pickup') {
      // Petit délai pour laisser le composant se monter
      setTimeout(() => {
        const inputRef = inputRefs.current.get(focusField);
        if (inputRef) {
          inputRef.focus();
        }
        setActiveInputId(focusField);
      }, 300);
    }
  }, [params.focusField]);

  useEffect(() => {
    const pickup = locations.find((loc) => loc.type === 'pickup');
    const destination = locations.find((loc) => loc.type === 'destination');

    const destinationReady = !!destination?.placeId || !!destination?.coordinates;
    if (!destinationReady) {
      if (heightPopupVisible) setHeightPopupVisible(false);
      heightPopupShownRef.current = null;
      heightPopupKeyRef.current = null;
      return;
    }

    const key = [
      pickup?.placeId || '',
      pickup?.coordinates ? `${pickup.coordinates.lat},${pickup.coordinates.lng}` : '',
      destination?.placeId || '',
      destination?.coordinates ? `${destination.coordinates.lat},${destination.coordinates.lng}` : '',
    ].join('|');

    if (heightPopupKeyRef.current === key) return;
    heightPopupKeyRef.current = key;

    const checkHeights = async () => {
      try {
        const response = await apiFetch<{ applies: boolean }>(
          '/api/height-surcharge-check',
          {
            method: 'POST',
            body: JSON.stringify({
              pickup: {
                value: pickup?.address || '',
                placeId: pickup?.placeId || '',
                lat: pickup?.coordinates?.lat,
                lng: pickup?.coordinates?.lng,
              },
              destination: {
                value: destination?.address || '',
                placeId: destination?.placeId || '',
                lat: destination?.coordinates?.lat,
                lng: destination?.coordinates?.lng,
              },
            }),
          }
        );
        if (response?.applies) {
          if (heightPopupShownRef.current !== key) {
            heightPopupShownRef.current = key;
            setHeightPopupVisible(true);
          }
        } else {
          setHeightPopupVisible(false);
          heightPopupShownRef.current = null;
        }
      } catch (error) {
        console.warn('[ITINERARY] Height surcharge check failed:', error);
      }
    };

    checkHeights();
  }, [locations]);

  console.log('[ITINERARY] Component rendered:', {
    activeInputId,
    suggestionsCount: suggestions.length,
    isLoading,
    hasGoogleMapsKey: !!GOOGLE_MAPS_API_KEY,
  });

  const fetchPlacePredictions = async (input: string) => {
    console.log('[ITINERARY] fetchPlacePredictions called with:', input);
    
    if (!input || input.length < 3) {
      console.log('[ITINERARY] Input too short, clearing suggestions');
      setSuggestions([]);
      return;
    }

    if (!GOOGLE_MAPS_API_KEY) {
      console.error('[ITINERARY] ❌ Google Maps API key not configured!');
      setSuggestions([]);
      return;
    }

    setIsLoading(true);
    console.log('[ITINERARY] Fetching predictions for:', input);
    
    try {
      // Utiliser directement l'API Google Places
      const googleUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&components=country:pf&key=${GOOGLE_MAPS_API_KEY}&language=fr`;
      
      console.log('[ITINERARY] Calling Google Places API...');
      const response = await fetch(googleUrl);
      const googleData = await response.json();
      
      console.log('[ITINERARY] Google API response:', {
        status: googleData.status,
        predictionsCount: googleData.predictions?.length || 0,
        error: googleData.error_message,
      });
      
      if (googleData.status === 'OK' && googleData.predictions) {
        // Convertir le format Google en format attendu
        const predictions: PlacePrediction[] = googleData.predictions.map((p: any) => ({
          place_id: p.place_id,
          description: p.description,
          structured_formatting: {
            main_text: p.structured_formatting?.main_text || p.description.split(',')[0],
            secondary_text: p.structured_formatting?.secondary_text || p.description.split(',').slice(1).join(',').trim(),
          },
        }));
        
        console.log('[ITINERARY] ✅ Setting suggestions:', predictions.length);
        setSuggestions(predictions);
      } else if (googleData.status === 'ZERO_RESULTS') {
        // Pas de résultats trouvés - c'est normal pour certaines recherches
        console.log('[ITINERARY] Aucun résultat pour cette recherche');
        setSuggestions([]);
      } else {
        // Vraie erreur API
        console.warn('[ITINERARY] Google Places API:', googleData.status, googleData.error_message);
        setSuggestions([]);
      }
    } catch (error) {
      console.error('[ITINERARY] ❌ Error fetching place predictions:', error);
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPlaceDetails = async (placeId: string) => {
    if (!GOOGLE_MAPS_API_KEY) {
      console.error('[ITINERARY] Google Maps API key not configured for place details');
      return null;
    }

    try {
      // Utiliser directement l'API Google Places
      const googleUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=geometry&key=${GOOGLE_MAPS_API_KEY}`;
      
      const response = await fetch(googleUrl);
      const googleData = await response.json();
      
      if (googleData.status === 'OK' && googleData.result?.geometry?.location) {
        return {
          lat: googleData.result.geometry.location.lat,
          lng: googleData.result.geometry.location.lng,
        };
      } else {
        console.error('[ITINERARY] Google Places Details API error:', googleData.status, googleData.error_message);
      }
    } catch (error) {
      console.error('[ITINERARY] Error fetching place details:', error);
    }
    return null;
  };

  const reverseGeocode = async (lat: number, lng: number): Promise<string | null> => {
    console.log('[ITINERARY] reverseGeocode called:', { lat, lng, hasApiKey: !!GOOGLE_MAPS_API_KEY });
    
    if (!GOOGLE_MAPS_API_KEY) {
      console.error('[ITINERARY] ❌ Google Maps API key not configured for reverse geocoding');
      console.error('[ITINERARY] Constants.expoConfig?.extra:', Constants.expoConfig?.extra);
      console.error('[ITINERARY] googleMapsApiKey:', Constants.expoConfig?.extra?.googleMapsApiKey);
      return null;
    }

    try {
      const googleUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}&language=fr`;
      console.log('[ITINERARY] Calling Google Geocoding API...');
      
      const response = await fetch(googleUrl);
      const googleData = await response.json();
      
      console.log('[ITINERARY] Google Geocoding API response:', {
        status: googleData.status,
        resultsCount: googleData.results?.length || 0,
        errorMessage: googleData.error_message
      });
      
      if (googleData.status === 'OK' && googleData.results && googleData.results.length > 0) {
        const address = googleData.results[0].formatted_address;
        console.log('[ITINERARY] ✅ Address found:', address);
        return address;
      } else {
        console.error('[ITINERARY] ❌ Reverse geocoding error:', {
          status: googleData.status,
          errorMessage: googleData.error_message,
          errorDetails: googleData
        });
        
        // Messages d'erreur spécifiques selon le statut
        if (googleData.status === 'REQUEST_DENIED') {
          console.error('[ITINERARY] API key is invalid or missing permissions');
        } else if (googleData.status === 'OVER_QUERY_LIMIT') {
          console.error('[ITINERARY] API quota exceeded');
        } else if (googleData.status === 'ZERO_RESULTS') {
          console.error('[ITINERARY] No results found for this location');
        }
      }
    } catch (error) {
      console.error('[ITINERARY] ❌ Network error during reverse geocoding:', error);
      if (error instanceof Error) {
        console.error('[ITINERARY] Error message:', error.message);
        console.error('[ITINERARY] Error stack:', error.stack);
      }
    }
    return null;
  };

  const handleUseCurrentLocation = async () => {
    if (!activeInputId) return;

    setIsLoadingLocation(true);
    
    try {
      if (Platform.OS === 'web') {
        if (!navigator.geolocation) {
          alert('La géolocalisation n\'est pas disponible sur votre appareil');
          setIsLoadingLocation(false);
          return;
        }

        navigator.geolocation.getCurrentPosition(
          async (position) => {
            const { latitude, longitude } = position.coords;
            const address = await reverseGeocode(latitude, longitude);
            
            if (address) {
              setLocations((prev) =>
                prev.map((loc) =>
                  loc.id === activeInputId
                    ? {
                        ...loc,
                        address: address,
                        placeId: null,
                        coordinates: { lat: latitude, lng: longitude },
                      }
                    : loc
                )
              );
              setSuggestions([]);
              setActiveInputId(null);
              Keyboard.dismiss();
            } else {
              console.error('[ITINERARY] Failed to get address from reverse geocoding');
              if (!GOOGLE_MAPS_API_KEY) {
                alert('Erreur de configuration : La clé Google Maps API n\'est pas disponible. Impossible de récupérer l\'adresse.');
              } else {
                alert('Impossible de récupérer l\'adresse de votre position. Vérifiez votre connexion internet.');
              }
            }
            setIsLoadingLocation(false);
          },
          (error) => {
            console.error('[ITINERARY] Error getting location:', error);
            alert('Impossible d\'obtenir votre position');
            setIsLoadingLocation(false);
          },
          { enableHighAccuracy: true, timeout: 10000 }
        );
      } else {
        const Location = require('expo-location');
        const { status } = await Location.requestForegroundPermissionsAsync();
        
        if (status !== 'granted') {
          alert('Permission de localisation refusée');
          setIsLoadingLocation(false);
          return;
        }

        const location = await Location.getCurrentPositionAsync({});
        const { latitude, longitude } = location.coords;
        const address = await reverseGeocode(latitude, longitude);
        
        if (address) {
          setLocations((prev) =>
            prev.map((loc) =>
              loc.id === activeInputId
                ? {
                    ...loc,
                    address: address,
                    placeId: null,
                    coordinates: { lat: latitude, lng: longitude },
                  }
                : loc
            )
          );
          setSuggestions([]);
          setActiveInputId(null);
          Keyboard.dismiss();
        } else {
          console.error('[ITINERARY] Failed to get address from reverse geocoding');
          if (!GOOGLE_MAPS_API_KEY) {
            alert('Erreur de configuration : La clé Google Maps API n\'est pas disponible. Impossible de récupérer l\'adresse.');
          } else {
            alert('Impossible de récupérer l\'adresse de votre position. Vérifiez votre connexion internet.');
          }
        }
        setIsLoadingLocation(false);
      }
    } catch (error) {
      console.error('[ITINERARY] Error handling current location:', error);
      alert('Erreur lors de la récupération de votre position');
      setIsLoadingLocation(false);
    }
  };

  // Écouter les paramètres de retour de map-selector
  useEffect(() => {
    const handleMapSelected = async () => {
      if (params.mapSelectedAddress && params.mapSelectedInputId) {
        const selectedInputId = params.mapSelectedInputId as string;
        const selectedAddress = params.mapSelectedAddress as string;
        const coords = await geocodeAddress(selectedAddress);
        
        setLocations((prev) =>
          prev.map((loc) =>
            loc.id === selectedInputId
              ? {
                  ...loc,
                  address: selectedAddress,
                  placeId: null,
                  coordinates: coords,
                }
              : loc
          )
        );
        
        setSuggestions([]);
        setActiveInputId(null);
        Keyboard.dismiss();
        
        // Nettoyer les params
        router.setParams({
          mapSelectedAddress: undefined,
          mapSelectedInputId: undefined,
        });
      }
    };

    handleMapSelected();
  }, [params.mapSelectedAddress, params.mapSelectedInputId]);

  const handleAddressChange = (id: string, text: string) => {
    console.log('[ITINERARY] handleAddressChange called:', { id, text, textLength: text.length });
    
    setLocations((prev) =>
      prev.map((loc) =>
        loc.id === id ? { ...loc, address: text, placeId: null, coordinates: null } : loc
      )
    );

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    
    debounceRef.current = setTimeout(() => {
      console.log('[ITINERARY] Debounce timeout - calling fetchPlacePredictions');
      fetchPlacePredictions(text);
    }, 300);
  };

  const handleSelectSuggestion = async (prediction: PlacePrediction) => {
    if (!activeInputId) return;

    const coordinates = await fetchPlaceDetails(prediction.place_id);

    setLocations((prev) =>
      prev.map((loc) =>
        loc.id === activeInputId
          ? {
              ...loc,
              address: prediction.description,
              placeId: prediction.place_id,
              coordinates,
            }
          : loc
      )
    );

    setSuggestions([]);
    setActiveInputId(null);
    Keyboard.dismiss();
  };

  const handleClearInput = (id: string) => {
    setLocations((prev) =>
      prev.map((loc) =>
        loc.id === id
          ? {
              ...loc,
              address: '',
              placeId: null,
              coordinates: null,
            }
          : loc
      )
    );
    setSuggestions([]);
    if (activeInputId === id) {
      setActiveInputId(null);
      Keyboard.dismiss();
    }
  };

  const handleAddStop = () => {
    const stopCount = locations.filter((l) => l.type === 'stop').length;
    if (stopCount >= 3) return;

    const newStop: LocationPoint = {
      id: `stop-${Date.now()}`,
      type: 'stop',
      address: '',
      placeId: null,
      coordinates: null,
    };

    setLocations((prev) => {
      const destinationIndex = prev.findIndex((l) => l.type === 'destination');
      const newLocations = [...prev];
      newLocations.splice(destinationIndex, 0, newStop);
      return newLocations;
    });
  };

  const handleRemoveStop = (id: string) => {
    setLocations((prev) => prev.filter((loc) => loc.id !== id));
  };

  const handleConfirm = () => {
    const pickup = locations.find((l) => l.type === 'pickup');
    const destination = locations.find((l) => l.type === 'destination');
    const stops = locations.filter((l) => l.type === 'stop');

    if (!pickup?.address || !destination?.address) {
      alert('Veuillez renseigner les adresses de départ et d\'arrivée');
      return;
    }

    router.push({
      pathname: '/(client)/ride/confirm-itinerary',
      params: {
        pickup: pickup.address,
        pickupPlaceId: pickup.placeId || '',
        pickupLat: pickup.coordinates?.lat?.toString() || '',
        pickupLng: pickup.coordinates?.lng?.toString() || '',
        destination: destination.address,
        destinationPlaceId: destination.placeId || '',
        destinationLat: destination.coordinates?.lat?.toString() || '',
        destinationLng: destination.coordinates?.lng?.toString() || '',
        stops: JSON.stringify(
          stops.map((s) => ({
            id: s.id,
            address: s.address,
            placeId: s.placeId,
            type: 'stop' as const,
            ...(s.coordinates ? { lat: s.coordinates.lat, lng: s.coordinates.lng } : {}),
          }))
        ),
      },
    });
  };

  const getPlaceholder = (type: LocationPoint['type']) => {
    switch (type) {
      case 'pickup':
        return 'Adresse de départ';
      case 'destination':
        return 'Où allez-vous ?';
      case 'stop':
        return 'Ajouter un arrêt';
    }
  };

  const getDotColor = (type: LocationPoint['type']) => {
    switch (type) {
      case 'pickup':
        return '#22C55E';
      case 'destination':
        return '#EF4444';
      case 'stop':
        return '#F5C400';
    }
  };

  const canAddMoreStops = locations.filter((l) => l.type === 'stop').length < 3;
  const isValid =
    locations.find((l) => l.type === 'pickup')?.address &&
    locations.find((l) => l.type === 'destination')?.address;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Modal visible={heightPopupVisible} transparent animationType="fade">
        <View style={styles.heightModalOverlay}>
          <View style={styles.heightModalCard}>
            <View style={styles.heightModalHeader}>
              <View style={styles.heightModalIconCircle}>
                <Ionicons name="alert-circle" size={22} color="#F59E0B" />
              </View>
              <Text style={styles.heightModalTitle}>Adresse en hauteur</Text>
            </View>
            <Text style={styles.heightModalText}>
              Votre adresse est dans les hauteurs, des frais s'appliqueront.
            </Text>
            <View style={styles.heightFeeWrapper}>
              <View style={styles.heightFeePill}>
                <Text style={styles.heightFeeText}>+{HEIGHT_SURCHARGE_AMOUNT} XPF</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.heightModalButton}
              onPress={() => setHeightPopupVisible(false)}
              activeOpacity={0.9}
            >
              <Text style={styles.heightModalButtonText}>Accepter</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
        </TouchableOpacity>
        <Text variant="h2">Itinéraire</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView 
        style={styles.content} 
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}
        onScrollBeginDrag={() => Keyboard.dismiss()}
      >
        <View style={styles.locationsContainer}>
          <View style={styles.timeline}>
            {locations.map((loc, index) => (
              <View key={loc.id} style={styles.timelineItem}>
                <View
                  style={[
                    styles.timelineDot,
                    { backgroundColor: getDotColor(loc.type) },
                  ]}
                />
                {index < locations.length - 1 && <View style={styles.timelineLine} />}
              </View>
            ))}
          </View>

          <View style={styles.inputsContainer}>
            {locations.map((loc) => (
              <View key={loc.id} style={styles.inputRow}>
                <View style={styles.inputWrapper}>
                  <TextInput
                    ref={(ref) => {
                      if (ref) {
                        inputRefs.current.set(loc.id, ref);
                      }
                    }}
                    style={styles.addressInput}
                    placeholder={getPlaceholder(loc.type)}
                    placeholderTextColor="#9CA3AF"
                    value={loc.address}
                    onChangeText={(text) => handleAddressChange(loc.id, text)}
                    onFocus={() => {
                      console.log('[ITINERARY] Input focused:', loc.id);
                      setActiveInputId(loc.id);
                    }}
                  />
                  {loc.address && (
                    <TouchableOpacity
                      style={styles.removeButton}
                      onPress={() => {
                        if (loc.type === 'stop') {
                          handleRemoveStop(loc.id);
                        } else {
                          handleClearInput(loc.id);
                        }
                      }}
                    >
                      <Ionicons name="close-circle" size={20} color="#9CA3AF" />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))}

            {canAddMoreStops && (
              <TouchableOpacity style={styles.addStopButton} onPress={handleAddStop}>
                <Ionicons name="add-circle-outline" size={20} color="#F5C400" />
                <Text style={styles.addStopText}>Ajouter un arrêt</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {(() => {
          const shouldShow = activeInputId !== null;
          console.log('[ITINERARY] Rendering suggestions container:', {
            activeInputId,
            suggestionsCount: suggestions.length,
            isLoading,
            isLoadingLocation,
            shouldShow,
          });
          
          if (!shouldShow) return null;
          
          const activeLocation = locations.find((loc) => loc.id === activeInputId);
          const shouldShowLocationOptions = activeLocation && ['pickup', 'destination', 'stop'].includes(activeLocation.type);
          // Afficher les options de localisation uniquement si l'input est vide
          const showLocationOptions = shouldShowLocationOptions && !activeLocation?.address;
          
          return (
            <View style={styles.suggestionsContainer}>
              {/* Options de localisation - uniquement pour pickup, destination et stop, et seulement si l'input est vide */}
              {showLocationOptions && (
                <>
                  <TouchableOpacity
                    style={styles.suggestionItem}
                    onPress={handleUseCurrentLocation}
                    disabled={isLoadingLocation}
                  >
                    <Ionicons name="locate" size={20} color="#F5C400" />
                    <View style={styles.suggestionText}>
                      <Text style={styles.suggestionMain}>
                        {isLoadingLocation ? 'Récupération de votre position...' : 'Me récupérer à ma position'}
                      </Text>
                      {isLoadingLocation && (
                        <ActivityIndicator size="small" color="#F5C400" style={{ marginTop: 4 }} />
                      )}
                    </View>
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    style={styles.suggestionItem}
                    onPress={() => {
                      if (activeInputId) {
                        router.push({
                          pathname: '/(client)/ride/map-selector',
                          params: {
                            inputId: activeInputId,
                            type: activeLocation?.type || 'pickup',
                          },
                        });
                      }
                    }}
                  >
                    <Ionicons name="map-outline" size={20} color="#F5C400" />
                    <View style={styles.suggestionText}>
                      <Text style={styles.suggestionMain}>
                        Sélectionner le point sur la map
                      </Text>
                    </View>
                  </TouchableOpacity>
                </>
              )}
              
              {isLoading && !isLoadingLocation && (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color="#F5C400" />
                  <Text style={{ marginTop: 8, color: '#6B7280', fontSize: 14 }}>Recherche...</Text>
                </View>
              )}
              {!isLoading && !isLoadingLocation && suggestions.length > 0 && suggestions.map((item) => (
                <TouchableOpacity
                  key={item.place_id}
                  style={styles.suggestionItem}
                  onPress={() => handleSelectSuggestion(item)}
                >
                  <Ionicons name="location-outline" size={20} color="#6B7280" />
                  <View style={styles.suggestionText}>
                    <Text style={styles.suggestionMain}>
                      {item.structured_formatting?.main_text || item.description}
                    </Text>
                    {item.structured_formatting?.secondary_text && (
                      <Text style={styles.suggestionSecondary}>
                        {item.structured_formatting.secondary_text}
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              ))}
              {!isLoading && !isLoadingLocation && suggestions.length === 0 && (
                <View style={styles.loadingContainer}>
                  <Text style={{ color: '#6B7280', fontSize: 14 }}>Votre adresse sélectionnée s'affichera ici</Text>
                </View>
              )}
            </View>
          );
        })()}

      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.confirmButton, !isValid && styles.confirmButtonDisabled]}
          onPress={handleConfirm}
          disabled={!isValid}
        >
          <Text style={styles.confirmButtonText}>{"Confirmer l'itinéraire"}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 120,
  },
  locationsContainer: {
    flexDirection: 'row',
  },
  timeline: {
    width: 24,
    alignItems: 'center',
    paddingTop: 18,
  },
  timelineItem: {
    alignItems: 'center',
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  timelineLine: {
    width: 2,
    height: 52,
    backgroundColor: '#E5E7EB',
  },
  inputsContainer: {
    flex: 1,
    gap: 12,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 16,
  },
  addressInput: {
    flex: 1,
    height: 52,
    fontSize: 16,
    color: '#1A1A1A',
  },
  removeButton: {
    padding: 4,
  },
  addStopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  addStopText: {
    fontSize: 14,
    color: '#F5C400',
    fontWeight: '600',
  },
  suggestionsContainer: {
    marginTop: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    overflow: 'hidden',
  },
  loadingContainer: {
    padding: 16,
    alignItems: 'center',
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  suggestionText: {
    flex: 1,
  },
  suggestionMain: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  suggestionSecondary: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 32 : 20,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  confirmButton: {
    backgroundColor: '#F5C400',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  confirmButtonDisabled: {
    backgroundColor: '#E5E7EB',
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  heightModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  heightModalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 22,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  heightModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  heightModalIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heightModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  heightModalText: {
    fontSize: 14,
    color: '#4B5563',
    lineHeight: 20,
    marginBottom: 14,
  },
  heightFeeWrapper: {
    alignItems: 'center',
    marginBottom: 18,
  },
  heightFeePill: {
    backgroundColor: '#16A34A',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    shadowColor: '#22C55E',
    shadowOpacity: 0.8,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  heightFeeText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 0.4,
  },
  heightModalButton: {
    backgroundColor: '#F5C400',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  heightModalButtonText: {
    color: '#1A1A1A',
    fontWeight: '700',
    fontSize: 16,
  },
});
