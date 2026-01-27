import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { 
  View, 
  StyleSheet, 
  ScrollView, 
  Image, 
  TouchableOpacity, 
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Platform,
  Linking,
  Alert,
  ActivityIndicator,
  Modal
} from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Image as ExpoImage } from 'expo-image';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/lib/AuthContext';
import { MapView, Marker, isMapsAvailable } from '@/lib/maps';
import MenuBurger from '@/components/MenuBurger';
import { 
  getActiveOrder, 
  apiFetch,
  removeClientToken, 
  removeCurrentOrderId, 
  clearCachedOrder,
  getCurrentOrderId,
  API_URL,
  getSupportLastSeenId,
  setSupportLastSeenId
} from '@/lib/api';
import { onRideStatusChanged, onDriverAssigned } from '@/lib/socket';

const { width, height } = Dimensions.get('window');

// Images du carousel par défaut (fallback)
const defaultCarouselImages = [
  { id: '1', title: 'AVEIAA', imageUrl: null, source: require('@/assets/images/AVEIAA.png') },
  { id: '2', title: 'TAPEPE', imageUrl: null, source: require('@/assets/images/TAPEPE.png') },
  { id: '3', title: 'HIOP', imageUrl: null, source: require('@/assets/images/HIOP.png') },
];

interface CarouselImage {
  id: string;
  title: string;
  imageUrl: string | null;
  source?: any;
  linkUrl?: string | null;
}

interface SupportMessage {
  id: string;
  content: string;
  isRead: boolean;
  createdAt: string;
  senderType: 'admin' | 'client' | 'driver';
  senderId?: string | null;
}

const categories = [
  { id: 'tarifs', label: 'Tarifs', icon: null, ionicon: 'pricetag' as const, href: '/(client)/tarifs' },
  { id: 'commandes', label: 'Commandes', icon: null, ionicon: 'receipt' as const, href: '/(client)/commandes' },
  { id: 'messages', label: 'Messages', icon: null, ionicon: 'chatbubbles' as const, href: '/(client)/messages' },
  { id: 'contact', label: 'Contact', icon: null, ionicon: 'call' as const, href: '/(client)/support' },
];

const TAHITI_REGION = {
  latitude: -17.5516,
  longitude: -149.5585,
  latitudeDelta: 0.0922,
  longitudeDelta: 0.0421,
};

// Points de route DISPERSÉS sur terre (pas alignés)
const ROAD_NETWORK = [
  // Zone Papeete centre
  { latitude: -17.5380, longitude: -149.5620, connections: [1, 3] },
  // Zone Pirae
  { latitude: -17.5340, longitude: -149.5480, connections: [0, 2] },
  // Zone Arue
  { latitude: -17.5280, longitude: -149.5320, connections: [1] },
  // Zone Tipaerui (sud de Papeete)
  { latitude: -17.5520, longitude: -149.5700, connections: [0, 4] },
  // Zone Faa'a (sud-ouest)
  { latitude: -17.5580, longitude: -149.5850, connections: [3, 5] },
  // Zone Punaauia
  { latitude: -17.5700, longitude: -149.6020, connections: [4] },
];

// Générateur pseudo-aléatoire avec seed (pour avoir les mêmes positions pendant 2h)
const seededRandom = (seed: number) => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

// Obtenir le "slot" de 2 heures actuel (change toutes les 2h)
const getTwoHourSlot = () => {
  const now = Date.now();
  return Math.floor(now / (2 * 60 * 60 * 1000)); // Slot de 2 heures
};

// Generate random car positions on roads around Papeete (stable pendant 2h)
const generateRandomCarPositions = (count: number = 6, slot?: number) => {
  const currentSlot = slot ?? getTwoHourSlot();
  const positions = [];
  const usedIndices: number[] = [];
  
  for (let i = 0; i < count; i++) {
    // Seed basé sur le slot de 2h et l'index de la voiture
    const seed = currentSlot * 100 + i;
    
    // Choisir un point de route basé sur le seed
    let randomIndex = Math.floor(seededRandom(seed) * ROAD_NETWORK.length);
    
    // Éviter les doublons
    let attempts = 0;
    while (usedIndices.includes(randomIndex) && attempts < ROAD_NETWORK.length) {
      randomIndex = (randomIndex + 1) % ROAD_NETWORK.length;
      attempts++;
    }
    usedIndices.push(randomIndex);
    
    const roadPoint = ROAD_NETWORK[randomIndex];
    
    // Décalage aléatoire dans toutes les directions (~50-100m)
    const offsetLat = (seededRandom(seed + 500) - 0.5) * 0.001;
    const offsetLng = (seededRandom(seed + 600) - 0.5) * 0.001;
    
    // Rotation aléatoire variée (pas alignée)
    const baseRotations = [0, 45, 90, 135, 180, 225, 270, 315];
    const baseRot = baseRotations[Math.floor(seededRandom(seed + 700) * baseRotations.length)];
    const rotationVariation = (seededRandom(seed + 800) - 0.5) * 30; // ±15°
    const finalRotation = (baseRot + rotationVariation + 360) % 360;
    
    positions.push({
      id: `car-${i}`,
      latitude: roadPoint.latitude + offsetLat,
      longitude: roadPoint.longitude + offsetLng,
      rotation: finalRotation,
      currentNodeIndex: randomIndex,
    });
  }
  return positions;
};

// Image voiture
const carImage = require('@/assets/images/voiture.png');

export default function ClientHomeScreen() {
  const router = useRouter();
  const { client } = useAuth();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const mapRef = useRef<any>(null);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const carouselScrollRef = useRef<ScrollView>(null);
  const [currentCarouselIndex, setCurrentCarouselIndex] = useState(0);
  const autoScrollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mapRecenterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [carouselImages, setCarouselImages] = useState<CarouselImage[]>(defaultCarouselImages);
  const [activeOrder, setActiveOrder] = useState<any | null>(null);
  const [isCheckingOrder, setIsCheckingOrder] = useState(true);
  const [showActiveOrderModal, setShowActiveOrderModal] = useState(false);
  const [carPositions, setCarPositions] = useState(() => generateRandomCarPositions(6));
  const [supportMessages, setSupportMessages] = useState<SupportMessage[]>([]);
  const [isLoadingSupport, setIsLoadingSupport] = useState(false);
  const [lastSeenSupportId, setLastSeenSupportId] = useState<string | null>(null);

  const handleCarouselPress = async (linkUrl?: string | null) => {
    if (!linkUrl) {
      return;
    }

    const trimmedLink = linkUrl.trim();
    if (!trimmedLink) {
      return;
    }

    if (trimmedLink.startsWith('/')) {
      router.push(trimmedLink as any);
      return;
    }

    const externalUrl = trimmedLink.match(/^https?:\/\//i)
      ? trimmedLink
      : `https://${trimmedLink}`;

    const canOpen = await Linking.canOpenURL(externalUrl);
    if (!canOpen) {
      Alert.alert('Lien invalide', 'Impossible d’ouvrir ce lien.');
      return;
    }

    await Linking.openURL(externalUrl);
  };

  const loadSupportMessages = useCallback(async () => {
    if (!client) {
      setSupportMessages([]);
      return;
    }
    setIsLoadingSupport(true);
    try {
      const data = await apiFetch<{ messages: SupportMessage[] }>('/api/messages/direct');
      setSupportMessages(data?.messages || []);
    } catch (error) {
      console.log('[Support] Error loading messages:', error);
      setSupportMessages([]);
    } finally {
      setIsLoadingSupport(false);
    }
  }, [client]);

  useEffect(() => {
    loadSupportMessages();
    const interval = setInterval(loadSupportMessages, 15000);
    return () => clearInterval(interval);
  }, [loadSupportMessages]);

  // Changer les positions des voitures toutes les 2 heures (vérifier régulièrement si le slot a changé)
  useEffect(() => {
    let currentSlot = getTwoHourSlot();
    
    const carInterval = setInterval(() => {
      const newSlot = getTwoHourSlot();
      if (newSlot !== currentSlot) {
        currentSlot = newSlot;
        setCarPositions(generateRandomCarPositions(6, newSlot));
      }
    }, 60000); // Vérifier chaque minute si le slot a changé
    
    return () => clearInterval(carInterval);
  }, []);

  // Petits mouvements subtils des voitures (quasi statiques)
  useEffect(() => {
    const subtleMovement = setInterval(() => {
      setCarPositions(prev => {
        const newPositions = [...prev];
        // Choisir 1-2 voitures au hasard
        const numCars = 1 + Math.floor(Math.random() * 2);
        for (let i = 0; i < numCars; i++) {
          const carIndex = Math.floor(Math.random() * newPositions.length);
          const car = newPositions[carIndex];
          
          // Très petit mouvement (~10-20m) - comme une voiture au ralenti
          const tinyMove = 0.0002;
          newPositions[carIndex] = {
            ...car,
            latitude: car.latitude + (Math.random() - 0.5) * tinyMove,
            longitude: car.longitude + (Math.random() - 0.5) * tinyMove,
            // Petite rotation occasionnelle (±5°)
            rotation: (car.rotation + (Math.random() - 0.5) * 10 + 360) % 360,
          };
        }
        return newPositions;
      });
    }, 4000 + Math.random() * 3000); // Toutes les 4-7 secondes
    
    return () => clearInterval(subtleMovement);
  }, []);

  useEffect(() => {
    let isMounted = true;
    getSupportLastSeenId()
      .then((stored) => {
        if (isMounted) {
          setLastSeenSupportId(stored);
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  const unreadSupportCount = useMemo(
    () => supportMessages.filter((msg) => !msg.isRead && msg.senderType === 'admin').length,
    [supportMessages]
  );

  const latestSupportMessage = useMemo(
    () => supportMessages.find((msg) => msg.senderType === 'admin') || supportMessages[0],
    [supportMessages]
  );

  const latestAdminMessageId = useMemo(
    () => supportMessages.find((msg) => msg.senderType === 'admin')?.id ?? null,
    [supportMessages]
  );

  const shouldShowSupportCard = useMemo(() => {
    if (!latestAdminMessageId) return false;
    return latestAdminMessageId !== lastSeenSupportId;
  }, [latestAdminMessageId, lastSeenSupportId]);

  const handleOpenSupportMessages = useCallback(async () => {
    try {
      await apiFetch('/api/messages/direct/read', { method: 'POST' });
      setSupportMessages((prev) =>
        prev.map((msg) =>
          msg.senderType === 'admin' ? { ...msg, isRead: true } : msg
        )
      );
      if (latestAdminMessageId) {
        await setSupportLastSeenId(latestAdminMessageId);
        setLastSeenSupportId(latestAdminMessageId);
      }
    } catch (error) {
      console.log('[Support] Error marking messages read:', error);
    } finally {
      router.push('/(client)/support-chat');
    }
  }, [router, latestAdminMessageId]);

  // Charger les images du carousel depuis l'API
  useEffect(() => {
    const fetchCarouselImages = async () => {
      try {
        const response = await fetch(`${API_URL}/carousel`);
        if (response.ok) {
          const data = await response.json();
          if (data.images && data.images.length > 0) {
            // Transformer les images de l'API au format attendu
            const apiImages: CarouselImage[] = data.images.map((img: any) => ({
              id: img.id,
              title: img.title,
              imageUrl: img.imageUrl,
              linkUrl: img.linkUrl,
            }));
            setCarouselImages(apiImages);
            console.log('[Carousel] Loaded', apiImages.length, 'images from API');
          }
        }
      } catch (error) {
        console.log('[Carousel] Using default images, API error:', error);
        // En cas d'erreur, garder les images par défaut
      }
    };

    fetchCarouselImages();
    
    // Rafraîchir les images toutes les 30 secondes pour les mises à jour en temps réel
    const refreshInterval = setInterval(fetchCarouselImages, 30000);
    
    return () => clearInterval(refreshInterval);
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // LISTENER SOCKET.IO GLOBAL : Navigation automatique vers course-en-cours
  // Écoute les changements de statut même si le client n'est pas sur l'accueil
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    // Listener pour les changements de statut de course
    const unsubscribeStatus = onRideStatusChanged((data) => {
      console.log('[Home] Status changed via Socket:', data);

      // Vérifier si on a une course active avant de rediriger
      getActiveOrder().then((response) => {
        if (response.hasActiveOrder && response.order) {
          const status = response.order.status;
          // Rediriger si la course est active (pas pending)
          if (status !== 'pending') {
            console.log('[Home] Auto-navigating to course-en-cours, status:', status);
            router.replace('/(client)/ride/course-en-cours');
          }
        }
      }).catch((err) => {
        console.error('[Home] Error checking active order:', err);
      });
    });

    // Listener pour l'assignation d'un chauffeur
    const unsubscribeDriver = onDriverAssigned((data) => {
      console.log('[Home] Driver assigned via Socket:', data);

      // Vérifier si on a une course active avant de rediriger
      getActiveOrder().then((response) => {
        if (response.hasActiveOrder && response.order) {
          console.log('[Home] Auto-navigating to course-en-cours, driver assigned');
          router.replace('/(client)/ride/course-en-cours');
        }
      }).catch((err) => {
        console.error('[Home] Error checking active order:', err);
      });
    });

    return () => {
      unsubscribeStatus();
      unsubscribeDriver();
    };
  }, [router]);

  // Référence pour savoir si on a déjà redirigé
  const hasRedirectedRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Vérifier si une course est en cours et afficher la section de chargement
  useEffect(() => {
    const checkAndCleanupOrders = async () => {
      // Si on a déjà redirigé, ne plus vérifier
      if (hasRedirectedRef.current) {
        return;
      }
      
      setIsCheckingOrder(true);
      try {
        // TOUJOURS vérifier côté serveur si le client a une course active (même sans cache local)
        const activeOrderResponse = await getActiveOrder();
        
        if (activeOrderResponse.hasActiveOrder && activeOrderResponse.order) {
          const order = activeOrderResponse.order;
          const status = order.status;
          
          // Si la course est active (en attente ou chauffeur assigné), afficher la section de chargement
          if (['pending', 'accepted', 'driver_enroute', 'driver_arrived', 'in_progress'].includes(status)) {
            setActiveOrder(order);
            
            // Si la course a un chauffeur assigné ou est en cours, naviguer vers la page course-en-cours
            if (status !== 'pending') {
              // Marquer comme redirigé et arrêter le polling AVANT de rediriger
              hasRedirectedRef.current = true;
              if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
              }
              router.replace('/(client)/ride/course-en-cours');
              return;
            }
          } else {
            // Course terminée/annulée - nettoyer silencieusement
            console.log('[Home] Course terminée, nettoyage du cache local');
            setActiveOrder(null);
            await removeClientToken();
            await removeCurrentOrderId();
            await clearCachedOrder();
          }
        } else {
          // Pas de course active sur le serveur
          setActiveOrder(null);
          
          // Nettoyer le cache local s'il existe mais qu'il n'y a pas de course active côté serveur
          const cachedOrderId = await getCurrentOrderId();
          if (cachedOrderId) {
            console.log('[Home] Pas de course active côté serveur mais cache local existe, nettoyage...');
            await removeClientToken();
            await removeCurrentOrderId();
            await clearCachedOrder();
          }
        }
      } catch (error) {
        console.log('[Home] Erreur vérification course:', error);
        setActiveOrder(null);
        // En cas d'erreur réseau, ne pas bloquer l'utilisateur
      } finally {
        setIsCheckingOrder(false);
      }
    };
    
    // Réinitialiser le flag de redirection au montage
    hasRedirectedRef.current = false;
    
    checkAndCleanupOrders();
    
    // Vérifier régulièrement (toutes les 3 secondes) si la course a évolué
    intervalRef.current = setInterval(checkAndCleanupOrders, 3000);
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      (async () => {
        try {
          const Location = require('expo-location');
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const location = await Location.getCurrentPositionAsync({});
            setUserLocation({
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
            });
          }
        } catch (e) {
          console.log('Location not available');
        }
      })();
    }
  }, []);

  // Défilement automatique du carousel toutes les 6 secondes
  useEffect(() => {
    const startAutoScroll = () => {
      autoScrollTimerRef.current = setInterval(() => {
        setCurrentCarouselIndex((prevIndex) => {
          const nextIndex = (prevIndex + 1) % carouselImages.length;
          if (carouselScrollRef.current) {
            carouselScrollRef.current.scrollTo({
              x: nextIndex * width,
              animated: true,
            });
          }
          return nextIndex;
        });
      }, 6000);
    };

    startAutoScroll();

    return () => {
      if (autoScrollTimerRef.current) {
        clearInterval(autoScrollTimerRef.current);
      }
    };
  }, []);

  const handleCarouselScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(offsetX / width);
    setCurrentCarouselIndex(index);
    
    // Réinitialiser le timer après un scroll manuel
    if (autoScrollTimerRef.current) {
      clearInterval(autoScrollTimerRef.current);
    }
    autoScrollTimerRef.current = setInterval(() => {
      setCurrentCarouselIndex((prevIndex) => {
        const nextIndex = (prevIndex + 1) % carouselImages.length;
        if (carouselScrollRef.current) {
          carouselScrollRef.current.scrollTo({
            x: nextIndex * width,
            animated: true,
          });
        }
        return nextIndex;
      });
    }, 6000);
  };

  const handleCategoryPress = (category: typeof categories[0]) => {
    setSelectedCategory(category.id);
    router.push(category.href as any);
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const maxScroll = contentSize.width - layoutMeasurement.width;
    const progress = maxScroll > 0 ? contentOffset.x / maxScroll : 0;
    setScrollProgress(progress);
  };

  const handleSearchPress = async () => {
    // Vérifier s'il y a déjà une course active
    try {
      const activeOrderResponse = await getActiveOrder();
      
      if (activeOrderResponse.hasActiveOrder && activeOrderResponse.order) {
        const order = activeOrderResponse.order;
        const status = order.status;
        
        // Si la course est active (en attente ou chauffeur assigné), afficher un message stylé
        if (['pending', 'accepted', 'driver_enroute', 'driver_arrived', 'in_progress'].includes(status)) {
          setActiveOrder(order);
          setShowActiveOrderModal(true);
          return;
        }
      }
      
      // Pas de course active, permettre de commander
      router.push('/(client)/ride/itinerary?focusField=destination');
    } catch (error) {
      console.error('[Home] Erreur lors de la vérification de course active:', error);
      // En cas d'erreur, permettre quand même de commander (ne pas bloquer l'utilisateur)
      router.push('/(client)/ride/itinerary?focusField=destination');
    }
  };

  const handleRecenter = () => {
    if (mapRef.current && userLocation) {
      mapRef.current.animateToRegion({
        ...userLocation,
        latitudeDelta: 0.035,
        longitudeDelta: 0.035,
      }, 800);
    }
  };

  // Recentrage automatique après 7 secondes d'inactivité
  const handleMapInteraction = () => {
    // Annuler le timer précédent s'il existe
    if (mapRecenterTimerRef.current) {
      clearTimeout(mapRecenterTimerRef.current);
    }
    // Démarrer un nouveau timer de 20 secondes
    mapRecenterTimerRef.current = setTimeout(() => {
      handleRecenter();
    }, 20000);
  };

  // Nettoyer le timer au démontage
  useEffect(() => {
    return () => {
      if (mapRecenterTimerRef.current) {
        clearTimeout(mapRecenterTimerRef.current);
      }
    };
  }, []);

  // Centrer la carte sur la position utilisateur dès qu'elle est disponible
  useEffect(() => {
    if (userLocation && mapRef.current) {
      mapRef.current.animateToRegion({
        ...userLocation,
        latitudeDelta: 0.035,
        longitudeDelta: 0.035,
      }, 500);
    }
  }, [userLocation]);

  const renderMap = () => {
    if (MapView && Platform.OS !== 'web') {
      return (
        <>
          {/* @ts-ignore - MapView types are correctly handled by the maps library */}
          <MapView
            ref={mapRef}
            style={styles.map}
            initialRegion={userLocation ? {
              ...userLocation,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            } : TAHITI_REGION}
            showsUserLocation={false}
            showsMyLocationButton={false}
            showsPointsOfInterest={true}
            showsBuildings={true}
            showsIndoors={true}
            showsIndoorLevelPicker={true}
            mapType="standard"
            pitchEnabled={true}
            rotateEnabled={true}
            zoomEnabled={true}
            scrollEnabled={true}
            onRegionChangeComplete={handleMapInteraction}
            onPoiClick={(e: any) => {
              const poi = e.nativeEvent;
              if (poi && poi.name) {
                Alert.alert(
                  poi.name,
                  poi.placeId ? `Ouvrir dans Maps ?` : '',
                  poi.placeId ? [
                    { text: 'Annuler', style: 'cancel' },
                    { 
                      text: 'Ouvrir', 
                      onPress: () => {
                        const url = Platform.OS === 'ios' 
                          ? `maps://?q=${encodeURIComponent(poi.name)}&ll=${poi.coordinate.latitude},${poi.coordinate.longitude}`
                          : `geo:${poi.coordinate.latitude},${poi.coordinate.longitude}?q=${encodeURIComponent(poi.name)}`;
                        Linking.openURL(url);
                      }
                    }
                  ] : [{ text: 'OK' }]
                );
              }
            }}
          >
            {/* Voitures autour de Papeete - rendues en premier (en dessous) */}
            {Marker && carPositions.map((car) => (
              // @ts-ignore
              <Marker
                key={car.id}
                coordinate={{ latitude: car.latitude, longitude: car.longitude }}
                anchor={{ x: 0.5, y: 0.5 }}
                zIndex={1}
              >
                <Image
                  source={carImage}
                  style={[styles.carMarkerImage, { transform: [{ rotate: `${car.rotation}deg` }] }]}
                  resizeMode="contain"
                />
              </Marker>
            ))}
            
            {/* Position utilisateur - rendue en dernier (au-dessus, priorité) */}
            {userLocation && Marker && (
              <>
                {/* @ts-ignore */}
                <Marker
                  coordinate={userLocation}
                  anchor={{ x: 0.5, y: 1 }}
                  centerOffset={{ x: 0, y: -10 }}
                  zIndex={999}
                >
                  <ExpoImage
                    source={require('@/assets/images/Iconeacpp(1).gif')}
                    style={styles.userMarkerImage}
                    contentFit="contain"
                  />
                </Marker>
              </>
            )}
          </MapView>
        </>
      );
    }

    return (
      <View style={styles.mapPlaceholder}>
        <Ionicons name="map-outline" size={64} color="#a3ccff" />
        <Text style={styles.mapPlaceholderText}>
          {Platform.OS === 'web' 
            ? 'Carte disponible sur mobile' 
            : 'Créez un Development Build pour activer la carte'}
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Map Background */}
      <View style={styles.mapBackground}>
        {renderMap()}
      </View>

      {/* Header */}
      <SafeAreaView style={styles.header} edges={['top']}>
        <View style={styles.headerContent}>
          <MenuBurger />

          <Image
            source={require('@/assets/images/logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />

          <TouchableOpacity
            style={styles.supportButton}
            onPress={() => router.push('/(client)/support')}
          >
            <Ionicons name="chatbubble" size={20} color="#ffffff" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Modal Course en cours - Stylée */}
      <Modal
        visible={showActiveOrderModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowActiveOrderModal(false)}
      >
        <TouchableOpacity 
          style={styles.activeOrderModalOverlay}
          activeOpacity={1}
          onPress={() => setShowActiveOrderModal(false)}
        >
          <TouchableOpacity 
            style={styles.activeOrderModalContent}
            activeOpacity={1}
            onPress={(e) => e.stopPropagation()}
          >
            {/* Icône avec fond circulaire */}
            <View style={styles.activeOrderModalIconContainer}>
              <View style={styles.activeOrderModalIconBg}>
                <Ionicons name="car-sport" size={40} color="#F5C400" />
              </View>
            </View>
            
            {/* Titre */}
            <Text style={styles.activeOrderModalTitle}>Course en cours</Text>
            
            {/* Message */}
            <Text style={styles.activeOrderModalMessage}>
              Vous avez déjà une course active.{'\n'}Terminez-la avant d'en commander une nouvelle.
            </Text>
            
            {/* Boutons */}
            <View style={styles.activeOrderModalButtons}>
              <TouchableOpacity
                style={[styles.activeOrderModalButton, styles.activeOrderModalButtonSecondary]}
                onPress={() => setShowActiveOrderModal(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.activeOrderModalButtonTextSecondary}>Retour</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.activeOrderModalButton, styles.activeOrderModalButtonPrimary]}
                onPress={() => {
                  if (!activeOrder) return;
                  setShowActiveOrderModal(false);
                  
                  if (activeOrder.status === 'pending') {
                    const addresses = activeOrder.addresses || [];
                    const pickupAddress = addresses.find((a: any) => a.type === 'pickup' || !a.type) || addresses[0];
                    const destinationAddress = addresses.find((a: any) => a.type === 'destination') || addresses[addresses.length - 1];
                    const stops = addresses.filter((a: any) => a.type === 'stop') || [];
                    
                    router.push({
                      pathname: '/(client)/ride/recherche-chauffeur',
                      params: {
                        orderId: activeOrder.id,
                        resumeSearch: 'true',
                        type: activeOrder.rideOption?.id || 'immediate',
                        pickup: pickupAddress?.address || pickupAddress?.value || '',
                        pickupPlaceId: pickupAddress?.placeId || '',
                        pickupLat: pickupAddress?.lat?.toString() || pickupAddress?.coordinates?.lat?.toString() || '',
                        pickupLng: pickupAddress?.lng?.toString() || pickupAddress?.coordinates?.lng?.toString() || '',
                        destination: destinationAddress?.address || destinationAddress?.value || '',
                        destinationPlaceId: destinationAddress?.placeId || '',
                        destinationLat: destinationAddress?.lat?.toString() || destinationAddress?.coordinates?.lat?.toString() || '',
                        destinationLng: destinationAddress?.lng?.toString() || destinationAddress?.coordinates?.lng?.toString() || '',
                        stops: stops.length > 0 ? JSON.stringify(stops) : '',
                        passengers: activeOrder.passengers?.toString() || '1',
                        supplements: activeOrder.supplements ? JSON.stringify(activeOrder.supplements) : '',
                        totalPrice: activeOrder.totalPrice?.toString() || '0',
                        driverEarnings: activeOrder.driverEarnings?.toString() || '0',
                        paymentMethod: activeOrder.paymentMethod || 'cash',
                        routeInfo: activeOrder.routeInfo ? JSON.stringify(activeOrder.routeInfo) : '',
                        scheduledTime: activeOrder.scheduledTime || '',
                        isAdvanceBooking: activeOrder.isAdvanceBooking ? 'true' : 'false',
                      },
                    });
                  } else {
                    router.replace('/(client)/ride/course-en-cours');
                  }
                }}
                activeOpacity={0.8}
              >
                <Ionicons name="arrow-forward" size={18} color="#1a1a1a" style={{ marginRight: 6 }} />
                <Text style={styles.activeOrderModalButtonTextPrimary} numberOfLines={1}>Voir ma course</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Category Bubbles */}
      <View style={styles.categoriesContainer}>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoriesScroll}
          onScroll={handleScroll}
          scrollEventThrottle={16}
        >
          {categories.map((category) => {
            const isSelected = selectedCategory === category.id;
            return (
              <TouchableOpacity
                key={category.id}
                style={[
                  styles.categoryBubble,
                  isSelected ? styles.categoryBubbleSelected : styles.categoryBubbleDefault
                ]}
                onPress={() => handleCategoryPress(category)}
              >
                {category.icon ? (
                  <Image
                    source={category.icon}
                    style={styles.categoryIcon}
                    resizeMode="contain"
                  />
                ) : category.ionicon ? (
                  <View style={styles.categoryIconContainer}>
                    <Ionicons 
                      name={category.ionicon} 
                      size={24} 
                      color={isSelected ? '#FFFFFF' : '#F5C400'} 
                    />
                  </View>
                ) : null}
                <Text
                  style={[
                    styles.categoryLabel,
                    isSelected ? styles.categoryLabelSelected : styles.categoryLabelDefault
                  ]}
                >
                  {category.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.scrollIndicatorContainer}>
          <View style={styles.scrollIndicatorTrack} />
          <View 
            style={[
              styles.scrollIndicatorThumb,
              { left: `${scrollProgress * 70}%` }
            ]} 
          />
        </View>
      </View>

      {/* Section de chargement - Course en recherche (juste en dessous du menu de bulles) */}
      {activeOrder && activeOrder.status === 'pending' && (
        <View style={styles.searchingSection}>
          <View style={styles.searchingSectionContent}>
            <ActivityIndicator size="small" color="#F5C400" style={styles.searchingIcon} />
            <View style={styles.searchingTextContainer}>
              <Text style={styles.searchingSectionTitle}>Recherche en cours...</Text>
              <Text style={styles.searchingSectionSubtitle} numberOfLines={2}>
                {(() => {
                  // Afficher le prix et les adresses
                  const addresses = activeOrder.addresses || [];
                  const pickupAddress = addresses.find((a: any) => a.type === 'pickup' || !a.type) || addresses[0];
                  const destinationAddress = addresses.find((a: any) => a.type === 'destination') || addresses[addresses.length - 1];
                  
                  const pickup = pickupAddress?.address || pickupAddress?.value || '';
                  const destination = destinationAddress?.address || destinationAddress?.value || '';
                  const price = activeOrder.totalPrice ? `${activeOrder.totalPrice.toLocaleString('fr-FR')} XPF` : '';
                  
                  if (pickup && destination && price) {
                    return `${pickup} → ${destination} • ${price}`;
                  } else if (pickup && price) {
                    return `${pickup} • ${price}`;
                  } else if (pickup) {
                    return pickup;
                  }
                  return 'Recherche d\'un chauffeur';
                })()}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.searchingButton}
              onPress={() => {
                if (activeOrder?.id) {
                  // Récupérer toutes les infos de la commande pour les passer en paramètres
                  const addresses = activeOrder.addresses || [];
                  const pickupAddress = addresses.find((a: any) => a.type === 'pickup' || !a.type) || addresses[0];
                  const destinationAddress = addresses.find((a: any) => a.type === 'destination') || addresses[addresses.length - 1];
                  const stops = addresses.filter((a: any) => a.type === 'stop') || [];
                  
                  router.push({
                    pathname: '/(client)/ride/recherche-chauffeur',
                    params: {
                      orderId: activeOrder.id,
                      resumeSearch: 'true',
                      // Passer toutes les infos de la commande
                      type: activeOrder.rideOption?.id || 'immediate',
                      pickup: pickupAddress?.address || pickupAddress?.value || '',
                      pickupPlaceId: pickupAddress?.placeId || '',
                      pickupLat: pickupAddress?.lat?.toString() || pickupAddress?.coordinates?.lat?.toString() || '',
                      pickupLng: pickupAddress?.lng?.toString() || pickupAddress?.coordinates?.lng?.toString() || '',
                      destination: destinationAddress?.address || destinationAddress?.value || '',
                      destinationPlaceId: destinationAddress?.placeId || '',
                      destinationLat: destinationAddress?.lat?.toString() || destinationAddress?.coordinates?.lat?.toString() || '',
                      destinationLng: destinationAddress?.lng?.toString() || destinationAddress?.coordinates?.lng?.toString() || '',
                      stops: stops.length > 0 ? JSON.stringify(stops) : '',
                      passengers: activeOrder.passengers?.toString() || '1',
                      supplements: activeOrder.supplements ? JSON.stringify(activeOrder.supplements) : '',
                      totalPrice: activeOrder.totalPrice?.toString() || '0',
                      driverEarnings: activeOrder.driverEarnings?.toString() || '0',
                      paymentMethod: activeOrder.paymentMethod || 'cash',
                      routeInfo: activeOrder.routeInfo ? JSON.stringify(activeOrder.routeInfo) : '',
                      scheduledTime: activeOrder.scheduledTime || '',
                      isAdvanceBooking: activeOrder.isAdvanceBooking ? 'true' : 'false',
                    },
                  });
                }
              }}
            >
              <Text style={styles.searchingButtonText}>Voir</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {shouldShowSupportCard && (
        <View style={styles.supportMessageCardContainer}>
          <TouchableOpacity
            style={styles.supportMessageCard}
            onPress={handleOpenSupportMessages}
            activeOpacity={0.85}
          >
            <View style={styles.supportMessageIcon}>
              <Ionicons name="chatbubbles" size={22} color="#1a1a1a" />
            </View>
            <View style={styles.supportMessageContent}>
              <Text style={styles.supportMessageTitle}>Messages du support</Text>
              <Text style={styles.supportMessageSubtitle} numberOfLines={2}>
                {latestSupportMessage
                  ? latestSupportMessage.content
                  : isLoadingSupport
                  ? 'Chargement des messages...'
                  : 'Aucun message pour le moment'}
              </Text>
            </View>
            {unreadSupportCount > 0 && (
              <View style={styles.supportMessageBadge}>
                <Text style={styles.supportMessageBadgeText}>
                  {unreadSupportCount > 99 ? '99+' : unreadSupportCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Image Carousel with Liquid Glass Effect */}
      <View style={styles.carouselContainer}>
        <ScrollView
          ref={carouselScrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={handleCarouselScroll}
          scrollEventThrottle={16}
          decelerationRate="fast"
        >
          {carouselImages.map((image) => (
            <View key={image.id} style={styles.carouselItem}>
              <View style={styles.liquidGlassOuter}>
                {/* Fond flou du cadre */}
                <BlurView intensity={80} tint="light" style={styles.liquidGlassBlurBg} />
                {/* Cadre intérieur avec l'image */}
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => handleCarouselPress(image.linkUrl)}
                  style={styles.liquidGlassInner}
                >
                  {image.imageUrl ? (
                    <ExpoImage
                      source={{ uri: image.imageUrl }}
                      style={styles.carouselImage}
                      contentFit="cover"
                      transition={300}
                    />
                  ) : image.source ? (
                    <Image
                      source={image.source as any}
                      style={styles.carouselImage}
                      resizeMode="cover"
                    />
                  ) : null}
                </TouchableOpacity>
                {/* Reflet subtil en haut du cadre */}
                <View style={styles.liquidGlassHighlight} />
              </View>
            </View>
          ))}
        </ScrollView>
        
        {/* Indicateurs de pagination */}
        <View style={styles.carouselIndicators}>
          {carouselImages.map((_, index) => (
            <View
              key={index}
              style={[
                styles.carouselIndicator,
                currentCarouselIndex === index && styles.carouselIndicatorActive,
              ]}
            />
          ))}
        </View>
      </View>

      {/* Bottom Panel */}
      <View style={styles.bottomPanel}>
        <View style={styles.bottomPanelContent}>
          <View style={styles.searchRow}>
            <TouchableOpacity 
              style={styles.searchInputContainer}
              onPress={handleSearchPress}
            >
              <Ionicons name="search" size={20} color="#5c5c5c" />
              <Text style={styles.searchPlaceholder}>Où allez-vous ?</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.mapPickerButton}
              onPress={() => router.push('/(client)/ride/map-selector?field=destination')}
            >
              <Ionicons name="map" size={20} color="#5c5c5c" />
            </TouchableOpacity>
          </View>
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
  map: {
    ...StyleSheet.absoluteFillObject,
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
  userMarkerImage: {
    width: 88,
    height: 88,
  },
  carMarkerImage: {
    width: 42,
    height: 42,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
  logo: {
    height: 58,
    width: 118,
    marginTop: 0,
  },
  supportButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F5C400',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#F5C400',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  categoriesContainer: {
    position: 'absolute',
    top: 105,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  supportMessageCardContainer: {
    position: 'absolute',
    top: 175,
    left: 16,
    right: 16,
    zIndex: 9,
  },
  supportMessageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF9E6',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#F5E3A4',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  supportMessageIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F5C400',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  supportMessageContent: {
    flex: 1,
  },
  supportMessageTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  supportMessageSubtitle: {
    fontSize: 12,
    color: '#6B7280',
  },
  supportMessageBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    marginLeft: 8,
  },
  supportMessageBadgeText: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  categoriesScroll: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  categoryBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    marginRight: 4,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  categoryBubbleDefault: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  categoryBubbleSelected: {
    backgroundColor: '#F5C400',
    shadowColor: '#F5C400',
    shadowOpacity: 0.3,
  },
  categoryIcon: {
    width: 22,
    height: 22,
    marginRight: 10,
  },
  categoryIconContainer: {
    width: 22,
    height: 22,
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryLabel: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  categoryLabelDefault: {
    color: '#343434',
  },
  categoryLabelSelected: {
    color: '#FFFFFF',
  },
  scrollIndicatorContainer: {
    display: 'none',
  },
  scrollIndicatorTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
    borderRadius: 2,
  },
  scrollIndicatorThumb: {
    position: 'absolute',
    top: 0,
    width: '30%',
    height: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 2,
  },
  carouselContainer: {
    position: 'absolute',
    bottom: 115,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  carouselItem: {
    width: width,
    paddingHorizontal: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  liquidGlassOuter: {
    width: width - 38,
    aspectRatio: 3.5,
    borderRadius: 20,
    padding: 3,
    position: 'relative',
    overflow: 'hidden',
    // Ombre colorée style Apple
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 15 },
    shadowOpacity: 0.15,
    shadowRadius: 25,
    elevation: 20,
  },
  liquidGlassBlurBg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 24,
  },
  liquidGlassInner: {
    flex: 1,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  liquidGlassHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  carouselImageContainer: {
    width: '100%',
    height: '100%',
    borderRadius: 18,
    overflow: 'hidden',
  },
  carouselIndicators: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
    gap: 8,
  },
  carouselIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#000000',
    opacity: 0.3,
  },
  carouselIndicatorActive: {
    width: 8,
    height: 8,
    borderRadius: 4,
    opacity: 1,
  },
  carouselImage: {
    width: '100%',
    height: '100%',
  },
  bottomPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  bottomPanelContent: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.08,
    shadowRadius: 30,
    elevation: 20,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 14,
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  searchPlaceholder: {
    flex: 1,
    color: '#adb5bd',
    fontSize: 16,
    fontWeight: '500',
  },
  mapPickerButton: {
    width: 52,
    height: 52,
    backgroundColor: '#F5C400',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#F5C400',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  searchingSection: {
    position: 'absolute',
    top: 175, // Juste en dessous du menu de bulles (105 + ~60-70 pour la hauteur des bulles + indicateur)
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    marginHorizontal: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    zIndex: 15,
  },
  searchingSectionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  searchingIcon: {
    marginRight: 12,
  },
  searchingTextContainer: {
    flex: 1,
    marginRight: 12,
  },
  searchingSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  searchingSectionSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 18,
  },
  searchingButton: {
    backgroundColor: '#F5C400',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  searchingButtonText: {
    color: '#1a1a1a',
    fontWeight: '600',
    fontSize: 14,
  },
  // Modal Course en cours - Design amélioré
  activeOrderModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  activeOrderModalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    padding: 28,
    width: '100%',
    maxWidth: 380,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 32,
    elevation: 16,
    borderWidth: 1,
    borderColor: 'rgba(245, 196, 0, 0.1)',
  },
  activeOrderModalIconContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  activeOrderModalIconBg: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FFF9E6',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#F5C400',
    shadowColor: '#F5C400',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  activeOrderModalTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1a1a1a',
    textAlign: 'center',
    marginBottom: 14,
    letterSpacing: 0.3,
  },
  activeOrderModalMessage: {
    fontSize: 15,
    color: '#4B5563',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
    paddingHorizontal: 4,
  },
  activeOrderModalButtons: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  activeOrderModalButton: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    minHeight: 52,
  },
  activeOrderModalButtonPrimary: {
    flex: 1,
    backgroundColor: '#F5C400',
    shadowColor: '#F5C400',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  activeOrderModalButtonSecondary: {
    flexShrink: 0,
    minWidth: 100,
    backgroundColor: '#F9FAFB',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
  },
  activeOrderModalButtonTextPrimary: {
    color: '#1a1a1a',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  activeOrderModalButtonTextSecondary: {
    color: '#6B7280',
    fontSize: 15,
    fontWeight: '600',
  },
});
