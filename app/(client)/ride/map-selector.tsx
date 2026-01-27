import { useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Alert,
  Image,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { MapView, Marker, isMapsAvailable } from '@/lib/maps';
import Constants from 'expo-constants';

// Source unique : app.config.js (via Constants.expoConfig.extra)
const GOOGLE_MAPS_API_KEY = Constants.expoConfig?.extra?.googleMapsApiKey || '';

// Log pour debug - vérifier si la clé est disponible
if (__DEV__ || !GOOGLE_MAPS_API_KEY) {
  console.log('[MAP_SELECTOR] Google Maps API Key:', {
    hasKey: !!GOOGLE_MAPS_API_KEY,
    keyLength: GOOGLE_MAPS_API_KEY?.length || 0,
    fromConfig: !!Constants.expoConfig?.extra?.googleMapsApiKey,
    configValue: Constants.expoConfig?.extra?.googleMapsApiKey?.substring(0, 10) + '...' || 'undefined'
  });
}

const TAHITI_REGION = {
  latitude: -17.5516,
  longitude: -149.5585,
  latitudeDelta: 0.0922,
  longitudeDelta: 0.0421,
};

export default function MapSelectorScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const inputId = params.inputId as string;
  const type = params.type as 'pickup' | 'destination' | 'stop';
  const field = params.field as 'destination' | 'pickup' | undefined; // Depuis la page d'accueil

  const [centerCoordinate, setCenterCoordinate] = useState<{ latitude: number; longitude: number } | null>(null);
  const [address, setAddress] = useState<string>('');
  const [isLoadingAddress, setIsLoadingAddress] = useState(false);
  const mapRef = useRef<any>(null);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const lastGeocodeRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      (async () => {
        try {
          const Location = require('expo-location');
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const location = await Location.getCurrentPositionAsync({});
            const coords = {
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
            };
            setUserLocation(coords);
            setCenterCoordinate(coords);
            
            if (mapRef.current) {
              mapRef.current.animateToRegion({
                ...coords,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              }, 1000);
            }
            
            // Récupérer l'adresse initiale
            const addressResult = await reverseGeocode(coords.latitude, coords.longitude);
            if (addressResult) {
              setAddress(addressResult);
            }
          }
        } catch (e) {
          console.log('Location not available');
        }
      })();
    }
    
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const reverseGeocode = async (lat: number, lng: number): Promise<string | null> => {
    if (!GOOGLE_MAPS_API_KEY) {
      console.error('[MAP_SELECTOR] ❌ Google Maps API key not configured! Cannot reverse geocode.');
      console.error('[MAP_SELECTOR] Constants.expoConfig?.extra:', Constants.expoConfig?.extra);
      Alert.alert(
        'Erreur de configuration',
        'La clé Google Maps API n\'est pas configurée. Impossible de récupérer l\'adresse.',
        [{ text: 'OK' }]
      );
      return null;
    }

    setIsLoadingAddress(true);
    try {
      const googleUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}&language=fr`;
      
      const response = await fetch(googleUrl);
      const googleData = await response.json();
      
      if (googleData.status === 'OK' && googleData.results && googleData.results.length > 0) {
        return googleData.results[0].formatted_address;
      } else {
        console.error('[MAP_SELECTOR] Reverse geocoding error:', googleData.status, googleData.error_message);
      }
    } catch (error) {
      console.error('[MAP_SELECTOR] Error reverse geocoding:', error);
    } finally {
      setIsLoadingAddress(false);
    }
    return null;
  };

  const handleRegionChangeComplete = async (region: any) => {
    const center = {
      latitude: region.latitude,
      longitude: region.longitude,
    };
    
    setCenterCoordinate(center);
    
    // Vérifier si les coordonnées ont vraiment changé (au moins 10 mètres)
    const hasChanged = !lastGeocodeRef.current || 
      Math.abs(center.latitude - lastGeocodeRef.current.lat) > 0.0001 ||
      Math.abs(center.longitude - lastGeocodeRef.current.lng) > 0.0001;
    
    if (!hasChanged) {
      return; // Ne pas recharger si les coordonnées n'ont pas vraiment changé
    }
    
    setIsLoadingAddress(true);

    // Debounce pour éviter trop d'appels API (augmenté à 1 seconde)
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    
    debounceRef.current = setTimeout(async () => {
      lastGeocodeRef.current = { lat: center.latitude, lng: center.longitude };
      const addressResult = await reverseGeocode(center.latitude, center.longitude);
      if (addressResult) {
        setAddress(addressResult);
      } else {
        setAddress('');
      }
    }, 1000);
  };

  const handleConfirm = () => {
    if (!centerCoordinate || !address) {
      Alert.alert('Erreur', 'Veuillez déplacer la carte pour sélectionner une adresse');
      return;
    }
    if (isLoadingAddress) {
      Alert.alert('Adresse en cours', 'Veuillez patienter pendant le chargement de l\'adresse.');
      return;
    }

    // Si on vient de la page d'accueil (paramètre field), aller vers itinerary
    if (field) {
      router.replace({
        pathname: '/(client)/ride/itinerary',
        params: {
          [`${field}Address`]: address,
          [`${field}Lat`]: centerCoordinate.latitude.toString(),
          [`${field}Lng`]: centerCoordinate.longitude.toString(),
        },
      } as any);
      return;
    }

    // Sinon, retourner à la page précédente (comportement original)
    router.back();
    
    // Utiliser un petit délai pour s'assurer que la page précédente est montée
    setTimeout(() => {
      router.setParams({
        mapSelectedAddress: address,
        mapSelectedInputId: inputId,
      });
    }, 300);
  };

  const getTypeLabel = () => {
    switch (type) {
      case 'pickup':
        return 'Sélectionnez votre point de départ';
      case 'destination':
        return 'Sélectionnez votre destination';
      case 'stop':
        return 'Sélectionnez un arrêt';
      default:
        return 'Sélectionnez un point';
    }
  };

  const getMarkerColor = () => {
    switch (type) {
      case 'pickup':
        return '#22C55E';
      case 'destination':
        return '#EF4444';
      case 'stop':
        return '#F5C400';
      default:
        return '#F5C400';
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
        </TouchableOpacity>
        <Text variant="h3" style={styles.headerTitle}>
          {getTypeLabel()}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.mapContainer}>
        {isMapsAvailable && Platform.OS !== 'web' ? (
          <>
            <MapView
              ref={mapRef}
              style={styles.map}
              initialRegion={userLocation ? {
                ...userLocation,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              } : TAHITI_REGION}
              showsUserLocation
              showsMyLocationButton={false}
              onRegionChangeComplete={handleRegionChangeComplete}
            />
            {/* Marqueur fixe au centre de l'écran avec l'icône */}
            <View style={styles.centerMarkerContainer} pointerEvents="none">
              <Image
                source={require('@/assets/images/Icone_acpp_(5)_1764132915723_1767064460978.png')}
                style={styles.centerMarkerIcon}
                resizeMode="contain"
              />
            </View>
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

      <View style={styles.infoContainer}>
        {isLoadingAddress ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#F5C400" />
            <Text style={styles.loadingText}>Récupération de l'adresse...</Text>
          </View>
        ) : address ? (
          <View style={styles.addressContainer}>
            <Ionicons name="location" size={20} color="#F5C400" />
            <Text style={styles.addressText} numberOfLines={2}>{address}</Text>
          </View>
        ) : (
          <View style={styles.instructionContainer}>
            <Ionicons name="information-circle-outline" size={20} color="#6B7280" />
            <Text style={styles.instructionText}>Déplacez la carte pour sélectionner votre adresse</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.confirmButton,
            (!centerCoordinate || !address || isLoadingAddress) && styles.confirmButtonDisabled,
          ]}
          onPress={handleConfirm}
          disabled={!centerCoordinate || !address || isLoadingAddress}
        >
          <Text style={styles.confirmButtonText}>Confirmer</Text>
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
  headerTitle: {
    flex: 1,
    textAlign: 'center',
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  map: {
    flex: 1,
  },
  centerMarkerContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginTop: -40,
    marginLeft: -30,
    width: 60,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  centerMarkerIcon: {
    width: 60,
    height: 80,
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
  infoContainer: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#6B7280',
  },
  addressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F9FAFB',
    padding: 12,
    borderRadius: 8,
  },
  addressText: {
    flex: 1,
    fontSize: 15,
    color: '#1A1A1A',
    fontWeight: '500',
  },
  instructionContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F9FAFB',
    padding: 12,
    borderRadius: 8,
  },
  instructionText: {
    flex: 1,
    fontSize: 14,
    color: '#6B7280',
  },
  footer: {
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
});
