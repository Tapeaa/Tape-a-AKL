import { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { apiFetch } from '@/lib/api';
import { downloadInvoicePDF } from '@/lib/pdf-download';
import type { Order } from '@/lib/types';

const statusLabels: Record<string, { label: string; color: string; icon: string }> = {
  pending: { label: 'En attente', color: '#F59E0B', icon: 'time' },
  accepted: { label: 'Acceptée', color: '#3B82F6', icon: 'checkmark-circle' },
  booked: { label: 'Réservée', color: '#8B5CF6', icon: 'calendar' },  // ═══ RÉSERVATION À L'AVANCE ═══
  driver_enroute: { label: 'Chauffeur en route', color: '#3B82F6', icon: 'car' },
  driver_arrived: { label: 'Chauffeur arrivé', color: '#8B5CF6', icon: 'location' },
  in_progress: { label: 'En cours', color: '#10B981', icon: 'navigate' },
  completed: { label: 'Terminée', color: '#22C55E', icon: 'checkmark-done-circle' },
  cancelled: { label: 'Annulée', color: '#EF4444', icon: 'close-circle' },
  expired: { label: 'Expirée', color: '#6B7280', icon: 'timer' },
  payment_pending: { label: 'Paiement en attente', color: '#F59E0B', icon: 'card' },
  payment_confirmed: { label: 'Payée', color: '#22C55E', icon: 'checkmark-circle' },
  payment_failed: { label: 'Paiement échoué', color: '#EF4444', icon: 'card' },
};

// Composant de bulle d'état animée avec effet de respiration
function AnimatedStatusBadge({ color, label, icon }: { color: string; label: string; icon?: string }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Animation de pulsation légère et continue
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 1.03,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  return (
    <Animated.View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 20,
          backgroundColor: color + '20',
          transform: [{ scale: scaleAnim }],
        },
      ]}
    >
      {icon && <Ionicons name={icon as any} size={16} color={color} style={{ marginRight: 6 }} />}
      <Text variant="caption" style={{ color, fontWeight: '600' }}>
        {label}
      </Text>
    </Animated.View>
  );
}

export default function CourseDetailsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tarifs, setTarifs] = useState<any[]>([]);

  useEffect(() => {
    const loadOrder = async () => {
      if (!id) {
        setError('ID de course manquant');
        setLoading(false);
        return;
      }

      try {
        // Charger les tarifs en parallèle
        const [orderData, tarifsData] = await Promise.all([
          apiFetch<Order>(`/api/orders/${id}`),
          apiFetch<any[]>(`/api/tarifs`).catch(() => []) // Si erreur, retourner tableau vide
        ]);
        
        setOrder(orderData);
        setTarifs(tarifsData || []);
      } catch (err) {
        console.error('[CourseDetails] Error loading order:', err);
        setError('Impossible de charger les détails de la course');
      } finally {
        setLoading(false);
      }
    };

    loadOrder();
  }, [id]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatPrice = (price: number | undefined | null) => {
    if (price === undefined || price === null) return '0 XPF';
    return `${price.toLocaleString('fr-FR')} XPF`;
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 60) {
      return `${minutes} min`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins > 0 ? `${mins}min` : ''}`;
  };

  const formatDistance = (meters: number) => {
    if (meters < 1000) {
      return `${meters} m`;
    }
    return `${(meters / 1000).toFixed(1)} km`;
  };

  // Fonction pour obtenir le tarif kilométrique selon l'heure de la commande
  const getPricePerKmForOrder = (orderCreatedAt: string): { price: number; period: 'jour' | 'nuit' } => {
    if (!orderCreatedAt) {
      // Fallback : utiliser les tarifs du back office ou défaut
      const tarifJour = tarifs.find(t => t.typeTarif === 'kilometre_jour');
      const fallbackPrice = tarifJour?.prixXpf || 150;
      return { price: fallbackPrice, period: 'jour' };
    }
    
    const orderDate = new Date(orderCreatedAt);
    const orderHour = orderDate.getHours();
    const orderMinutes = orderHour * 60 + orderDate.getMinutes();
    
    // Chercher le tarif kilométrique approprié
    // kilometre_jour : généralement 6h-18h (150 XPF)
    // kilometre_nuit : généralement 18h-6h (260 XPF)
    const kilometreTarifs = tarifs.filter(t => 
      t.typeTarif === 'kilometre_jour' || t.typeTarif === 'kilometre_nuit'
    );
    
    // Trouver le tarif qui correspond à l'heure de la commande
    for (const tarif of kilometreTarifs) {
      if (tarif.heureDebut && tarif.heureFin) {
        // Parser les heures (format HH:MM)
        const [debutH, debutM] = tarif.heureDebut.split(':').map(Number);
        const [finH, finM] = tarif.heureFin.split(':').map(Number);
        const debutMinutes = debutH * 60 + (debutM || 0);
        const finMinutes = finH * 60 + (finM || 0);
        
        // Gérer le cas où la plage horaire traverse minuit (ex: 18h-6h)
        let isInRange = false;
        if (debutMinutes <= finMinutes) {
          // Plage normale (ex: 6h-18h)
          isInRange = orderMinutes >= debutMinutes && orderMinutes < finMinutes;
        } else {
          // Plage qui traverse minuit (ex: 18h-6h)
          isInRange = orderMinutes >= debutMinutes || orderMinutes < finMinutes;
        }
        
        if (isInRange) {
          const period = tarif.typeTarif === 'kilometre_jour' ? 'jour' : 'nuit';
          console.log(`[CourseDetails] Tarif trouvé: ${tarif.typeTarif} (${tarif.heureDebut}-${tarif.heureFin}) = ${tarif.prixXpf} XPF pour commande à ${orderHour}h${orderDate.getMinutes()}`);
          return { price: tarif.prixXpf, period };
        }
      } else {
        // Si pas de plage horaire, utiliser le type pour déterminer
        // Par défaut : jour = 6h-18h, nuit = 18h-6h
        if (tarif.typeTarif === 'kilometre_jour' && orderHour >= 6 && orderHour < 18) {
          console.log(`[CourseDetails] Tarif jour trouvé (sans plage): ${tarif.prixXpf} XPF`);
          return { price: tarif.prixXpf, period: 'jour' };
        }
        if (tarif.typeTarif === 'kilometre_nuit' && (orderHour >= 18 || orderHour < 6)) {
          console.log(`[CourseDetails] Tarif nuit trouvé (sans plage): ${tarif.prixXpf} XPF`);
          return { price: tarif.prixXpf, period: 'nuit' };
        }
      }
    }
    
    // Fallback : utiliser les tarifs du back office ou défaut selon l'heure
    const isNight = orderHour >= 18 || orderHour < 6;
    const tarifNuit = tarifs.find(t => t.typeTarif === 'kilometre_nuit');
    const tarifJour = tarifs.find(t => t.typeTarif === 'kilometre_jour');
    const fallbackPrice = isNight 
      ? (tarifNuit?.prixXpf || 260)
      : (tarifJour?.prixXpf || 150);
    console.log(`[CourseDetails] Aucun tarif trouvé, utilisation du fallback: ${fallbackPrice} XPF`);
    return { price: fallbackPrice, period: isNight ? 'nuit' : 'jour' };
  };

  // Fonction pour obtenir la prise en charge (toujours 1000 XPF)
  const getBasePrice = (): number => {
    // Chercher le tarif de prise en charge
    const priseEnCharge = tarifs.find(t => t.typeTarif === 'prise_en_charge');
    if (priseEnCharge) {
      return priseEnCharge.prixXpf;
    }
    // Défaut : 1000 XPF
    return 1000;
  };

  if (loading) {
    return (
      <LoadingOverlay
        title="Chargement de la course..."
        subtitle="Récupération des détails"
      />
    );
  }

  if (error || !order) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
          </TouchableOpacity>
          <Text variant="h2">Détails de la course</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={64} color="#EF4444" />
          <Text style={styles.errorText}>{error || 'Course introuvable'}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => router.back()}>
            <Text style={styles.retryButtonText}>Retour</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const status = statusLabels[order.status] || { label: order.status, color: '#6B7280', icon: 'help-circle' };
  const pickup = order.addresses.find((a) => a.type === 'pickup');
  const destination = order.addresses.find((a) => a.type === 'destination');
  const stops = order.addresses.filter((a) => a.type === 'stop');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
        </TouchableOpacity>
        <Text variant="h2">Détails de la course</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Statut et Date */}
        <Card style={styles.statusCard}>
          <AnimatedStatusBadge color={status.color} icon={status.icon} label={status.label} />
          <Text style={styles.dateText}>{formatDate(order.createdAt)}</Text>
          <Text style={styles.timeText}>à {formatTime(order.createdAt)}</Text>
        </Card>

        {/* Trajet */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Trajet</Text>
          
          <View style={styles.addressContainer}>
            {/* Départ */}
            <View style={styles.addressRow}>
              <View style={styles.addressIconContainer}>
                <View style={[styles.addressDot, { backgroundColor: '#22C55E' }]} />
              </View>
              <View style={styles.addressContent}>
                <Text style={styles.addressLabel}>Départ</Text>
                <Text style={styles.addressValue}>{pickup?.value || 'Non spécifié'}</Text>
              </View>
            </View>

            {/* Ligne de connexion */}
            <View style={styles.connectionLine} />

            {/* Arrêts intermédiaires */}
            {stops.map((stop, index) => (
              <View key={`stop-${index}`}>
                <View style={styles.addressRow}>
                  <View style={styles.addressIconContainer}>
                    <View style={[styles.addressDot, { backgroundColor: '#F59E0B' }]}>
                      <Text style={styles.stopNumber}>{index + 1}</Text>
                    </View>
                  </View>
                  <View style={styles.addressContent}>
                    <Text style={styles.addressLabel}>Arrêt {index + 1}</Text>
                    <Text style={styles.addressValue}>{stop.value || 'Non spécifié'}</Text>
                  </View>
                </View>
                <View style={styles.connectionLine} />
              </View>
            ))}

            {/* Arrivée */}
            <View style={styles.addressRow}>
              <View style={styles.addressIconContainer}>
                <View style={[styles.addressDot, { backgroundColor: '#EF4444' }]} />
              </View>
              <View style={styles.addressContent}>
                <Text style={styles.addressLabel}>Arrivée</Text>
                <Text style={styles.addressValue}>{destination?.value || 'Non spécifié'}</Text>
              </View>
            </View>
          </View>

          {/* Infos trajet */}
          <View style={styles.tripInfo}>
            <View style={styles.tripInfoItem}>
              <Ionicons name="time-outline" size={20} color="#6B7280" />
              <Text style={styles.tripInfoText}>
                {order.estimatedDuration ? formatDuration(order.estimatedDuration) : 'N/A'}
              </Text>
            </View>
            <View style={styles.tripInfoDivider} />
            <View style={styles.tripInfoItem}>
              <Ionicons name="navigate-outline" size={20} color="#6B7280" />
              <Text style={styles.tripInfoText}>
                {order.estimatedDistance ? formatDistance(order.estimatedDistance) : 'N/A'}
              </Text>
            </View>
          </View>
        </Card>

        {/* Chauffeur */}
        {order.assignedDriverId && (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Chauffeur</Text>
            <View style={styles.driverInfo}>
              <View style={styles.driverAvatar}>
                <Ionicons name="person" size={28} color="#FFFFFF" />
              </View>
              <View style={styles.driverDetails}>
                <Text style={styles.driverName}>
                  {(order as any).driverName || 'Chauffeur TAPEA'}
                </Text>
                <Text style={styles.driverVehicle}>Véhicule professionnel</Text>
              </View>
            </View>
          </Card>
        )}

        {/* Type de service */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Service</Text>
          <View style={styles.serviceInfo}>
            <View style={styles.serviceIcon}>
              <Ionicons name="car" size={24} color="#F5C400" />
            </View>
            <View style={styles.serviceDetails}>
              <Text style={styles.serviceName}>{order.rideOption.title}</Text>
              <Text style={styles.serviceDescription}>
                {order.rideOption.description || 'Service de transport TAPEA'}
              </Text>
            </View>
          </View>
          
          {order.passengers && (
            <View style={styles.passengerInfo}>
              <Ionicons name="people-outline" size={20} color="#6B7280" />
              <Text style={styles.passengerText}>
                {order.passengers} passager{order.passengers > 1 ? 's' : ''}
              </Text>
            </View>
          )}
        </Card>

        {/* Options et suppléments */}
        {order.supplements && order.supplements.length > 0 && (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Options</Text>
            {order.supplements.map((supplement, index) => (
              <View key={index} style={styles.supplementRow}>
                <View style={styles.supplementInfo}>
                  <Ionicons name="add-circle-outline" size={18} color="#6B7280" />
                  <Text style={styles.supplementName}>{supplement.name}</Text>
                </View>
                <Text style={styles.supplementPrice}>
                  +{formatPrice(supplement.price * (supplement.quantity || 1))}
                </Text>
              </View>
            ))}
          </Card>
        )}

        {/* Prix - Détail complet */}
        <Card style={styles.priceCard}>
          <Text style={styles.sectionTitle}>Tarification</Text>
          
          {/* Calcul de la décomposition du prix */}
          {(() => {
            // Prise en charge (toujours 1000 XPF depuis les tarifs)
            const basePrice = getBasePrice();
            
            // Distance × tarif kilométrique selon l'heure de la commande
            const distance = order.routeInfo?.distance ? parseFloat(String(order.routeInfo.distance)) : 0;
            const { price: pricePerKm, period: pricePeriod } = getPricePerKmForOrder(order.createdAt);
            const distancePrice = distance * pricePerKm;
            
            // Suppléments
            const supplementsTotal = order.supplements?.reduce((acc, s) => acc + (s.price * (s.quantity || 1)), 0) || 0;
            
            // Majoration passagers (500 XPF si >= 5 passagers)
            const passengers = order.passengers || 1;
            const majorationPassagers = passengers >= 5 ? 500 : 0;
            
            // ═══════════════════════════════════════════════════════════════════════════
            // RÉSERVATION À L'AVANCE: Pour les réservations (booked), on n'affiche que
            // les informations de base : prise en charge, tarif kilométrique, suppléments, majoration
            // Pas de temps d'attente ni d'arrêts payants car la course n'a pas encore commencé
            // ═══════════════════════════════════════════════════════════════════════════
            const isBooked = order.status === 'booked';
            
            // Temps d'attente (42 XPF par minute après 5 min gratuites) - seulement si course commencée
            const waitingTime = isBooked ? 0 : (order.waitingTimeMinutes || 0);
            const waitingFee = isBooked ? 0 : (waitingTime > 5 ? (waitingTime - 5) * 42 : 0);
            
            // Prix calculé (base + distance + supplements + majoration + attente si applicable)
            const calculatedBase = basePrice + distancePrice + supplementsTotal + majorationPassagers + waitingFee;
            
            // Arrêts payants = différence entre le prix total et le prix calculé - seulement si course commencée
            const totalPrice = order.totalPrice || 0;
            const paidStopsFee = isBooked ? 0 : Math.max(0, totalPrice - calculatedBase);
            
            return (
              <>
                {/* Prise en charge */}
                <View style={styles.priceRow}>
                  <Text style={styles.priceLabel}>Prise en charge</Text>
                  <Text style={styles.priceValue}>{formatPrice(basePrice)}</Text>
                </View>
                
                {/* Distance × tarif kilométrique */}
                {distance > 0 && (
                  <View style={styles.priceRow}>
                    <Text style={styles.priceLabel}>
                      {distance.toFixed(1)} km × {formatPrice(pricePerKm)} ({pricePeriod})
                    </Text>
                    <View style={styles.priceValueContainer}>
                      <Text style={styles.priceValue}>{formatPrice(distancePrice)}</Text>
                    </View>
                  </View>
                )}
                
                {/* Majoration passagers (≥5 passagers) */}
                {majorationPassagers > 0 && (
                  <View style={styles.priceRow}>
                    <Text style={styles.priceLabel}>Majoration passagers (≥5)</Text>
                    <Text style={styles.priceValue}>{formatPrice(majorationPassagers)}</Text>
                  </View>
                )}
                
                {/* Suppléments */}
                {supplementsTotal > 0 && (
                  <View style={styles.priceRow}>
                    <Text style={styles.priceLabel}>Suppléments</Text>
                    <Text style={styles.priceValue}>{formatPrice(supplementsTotal)}</Text>
                  </View>
                )}
                
                {/* Temps d'attente facturé (avant prise en charge) - seulement si course commencée */}
                {!isBooked && waitingFee > 0 && (
                  <View style={styles.priceRow}>
                    <View style={styles.priceLabelContainer}>
                      <Ionicons name="time-outline" size={16} color="#F59E0B" style={styles.waitingIcon} />
                      <View style={styles.priceLabelTextContainer}>
                        <Text style={styles.priceLabel}>
                          Temps d'attente ({waitingTime - 5} min)
                        </Text>
                        <Text style={styles.priceSubLabel}>
                          42 XPF/min après 5 min gratuites
                        </Text>
                      </View>
                    </View>
                    <View style={styles.priceValueContainer}>
                      <Text style={[styles.priceValue, styles.waitingFee]}>+{formatPrice(waitingFee)}</Text>
                    </View>
                  </View>
                )}
                
                {/* Arrêts payants pendant la course - seulement si course commencée */}
                {!isBooked && paidStopsFee > 0 && (
                  <View style={styles.priceRow}>
                    <View style={styles.priceLabelContainer}>
                      <Ionicons name="pause-circle" size={16} color="#EF4444" style={styles.waitingIcon} />
                      <View style={styles.priceLabelTextContainer}>
                        <Text style={styles.priceLabel}>
                          Arrêts payants
                        </Text>
                        <Text style={styles.priceSubLabel}>
                          42 XPF/min pendant la course
                        </Text>
                      </View>
                    </View>
                    <View style={styles.priceValueContainer}>
                      <Text style={[styles.priceValue, { color: '#EF4444' }]}>+{formatPrice(paidStopsFee)}</Text>
                    </View>
                  </View>
                )}
                
                <View style={styles.priceDivider} />
                
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>
                    {isBooked ? 'Prix estimé' : 'Total payé'}
                  </Text>
                  <Text style={styles.totalValue}>{formatPrice(order.totalPrice)}</Text>
                </View>
              </>
            );
          })()}
        </Card>

        {/* Informations supplémentaires */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Informations</Text>
          
          <View style={styles.infoRow}>
            <Ionicons name="receipt-outline" size={20} color="#6B7280" />
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Référence</Text>
              <Text style={styles.infoValue}>{order.id.substring(0, 8).toUpperCase()}</Text>
            </View>
          </View>
          
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={20} color="#6B7280" />
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Date de création</Text>
              <Text style={styles.infoValue}>{formatDate(order.createdAt)} à {formatTime(order.createdAt)}</Text>
            </View>
          </View>
          
          {order.completedAt && (
            <View style={styles.infoRow}>
              <Ionicons name="checkmark-done-outline" size={20} color="#6B7280" />
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Date de fin</Text>
                <Text style={styles.infoValue}>{formatDate(order.completedAt)} à {formatTime(order.completedAt)}</Text>
              </View>
            </View>
          )}

          {order.paymentMethod && (
            <View style={styles.infoRow}>
              <Ionicons name="card-outline" size={20} color="#6B7280" />
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Moyen de paiement</Text>
                <Text style={styles.infoValue}>
                  {order.paymentMethod === 'card' ? 'Carte bancaire' : 
                   order.paymentMethod === 'cash' ? 'Espèces' : order.paymentMethod}
                </Text>
              </View>
            </View>
          )}
        </Card>

        {/* Bouton Messages */}
        <TouchableOpacity 
          style={styles.messagesButton}
          onPress={() => router.push({
            pathname: '/(client)/ride/chat',
            params: {
              orderId: order.id,
              driverName: (order as any).driverName || 'Chauffeur',
            },
          })}
        >
          <Ionicons name="chatbubbles-outline" size={22} color="#1a1a1a" />
          <Text style={styles.messagesButtonText}>Voir les messages</Text>
        </TouchableOpacity>

        {/* Bouton Télécharger le reçu (si course terminée/payée) */}
        {(order.status === 'completed' || order.status === 'payment_confirmed') && (
          <TouchableOpacity 
            style={styles.downloadButton}
            onPress={() => downloadInvoicePDF(order.id)}
          >
            <Ionicons name="download-outline" size={22} color="#F5C400" />
            <Text style={styles.downloadButtonText}>Télécharger votre reçu</Text>
          </TouchableOpacity>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  errorText: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: '#F5C400',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  statusCard: {
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginBottom: 12,
  },
  statusText: {
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 8,
  },
  dateText: {
    fontSize: 15,
    color: '#374151',
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  timeText: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },
  section: {
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 16,
  },
  addressContainer: {
    marginBottom: 16,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  addressIconContainer: {
    width: 24,
    alignItems: 'center',
  },
  addressDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stopNumber: {
    fontSize: 8,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  connectionLine: {
    width: 2,
    height: 24,
    backgroundColor: '#E5E5E5',
    marginLeft: 11,
    marginVertical: 4,
  },
  addressContent: {
    flex: 1,
    marginLeft: 12,
  },
  addressLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 2,
  },
  addressValue: {
    fontSize: 15,
    color: '#1a1a1a',
    fontWeight: '500',
  },
  tripInfo: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  tripInfoItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tripInfoText: {
    fontSize: 14,
    color: '#374151',
    marginLeft: 8,
    fontWeight: '500',
  },
  tripInfoDivider: {
    width: 1,
    height: 20,
    backgroundColor: '#E5E5E5',
    marginHorizontal: 20,
  },
  driverInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  driverAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#F5C400',
    justifyContent: 'center',
    alignItems: 'center',
  },
  driverDetails: {
    marginLeft: 16,
  },
  driverName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  driverVehicle: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },
  serviceInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  serviceIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  serviceDetails: {
    marginLeft: 14,
    flex: 1,
  },
  serviceName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  serviceDescription: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },
  passengerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  passengerText: {
    fontSize: 14,
    color: '#374151',
    marginLeft: 10,
  },
  supplementRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  supplementInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  supplementName: {
    fontSize: 15,
    color: '#374151',
    marginLeft: 10,
  },
  supplementPrice: {
    fontSize: 15,
    color: '#374151',
    fontWeight: '500',
  },
  priceCard: {
    padding: 16,
    marginBottom: 16,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  priceLabel: {
    fontSize: 15,
    color: '#6B7280',
  },
  priceLabelContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginRight: 12,
  },
  priceLabelTextContainer: {
    flex: 1,
  },
  priceSubLabel: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 2,
    lineHeight: 14,
  },
  waitingIcon: {
    marginRight: 6,
    marginTop: 2,
  },
  waitingFee: {
    color: '#F59E0B',
    fontWeight: '600',
  },
  priceValueContainer: {
    alignItems: 'flex-end',
    minWidth: 80,
  },
  priceValue: {
    fontSize: 15,
    color: '#374151',
    fontWeight: '500',
    textAlign: 'right',
  },
  priceDivider: {
    height: 1,
    backgroundColor: '#E5E5E5',
    marginVertical: 12,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  totalValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F5C400',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  infoContent: {
    marginLeft: 14,
    flex: 1,
  },
  infoLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 15,
    color: '#1a1a1a',
  },
  messagesButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  messagesButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginLeft: 10,
  },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#F5C400',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  downloadButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F5C400',
    marginLeft: 10,
  },
  bottomSpacer: {
    height: 24,
  },
});
