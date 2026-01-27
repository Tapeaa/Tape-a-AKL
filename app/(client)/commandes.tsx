import { useState, useEffect, useRef, useCallback } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, RefreshControl, Animated, Alert, Modal } from 'react-native';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { apiFetch, getClientSessionId } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import { downloadInvoicePDF } from '@/lib/pdf-download';
import type { Order } from '@/lib/types';

const statusLabels: Record<string, { label: string; color: string }> = {
  pending: { label: 'En attente', color: '#F59E0B' },
  accepted: { label: 'Acceptée', color: '#3B82F6' },
  booked: { label: 'Réservée', color: '#8B5CF6' },  // ═══ RÉSERVATION À L'AVANCE ═══
  driver_enroute: { label: 'Chauffeur en route', color: '#3B82F6' },
  driver_arrived: { label: 'Chauffeur arrivé', color: '#8B5CF6' },
  in_progress: { label: 'En cours', color: '#10B981' },
  completed: { label: 'Terminée', color: '#22C55E' },
  cancelled: { label: 'Annulée', color: '#EF4444' },
  expired: { label: 'Expirée', color: '#6B7280' },
  payment_pending: { label: 'Paiement en attente', color: '#F59E0B' },
  payment_confirmed: { label: 'Payée', color: '#22C55E' },
  payment_failed: { label: 'Paiement échoué', color: '#EF4444' },
};

// Composant de bulle d'état animée avec effet de respiration
function AnimatedStatusBadge({ color, label }: { color: string; label: string }) {
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
        styles.statusBadge,
        { backgroundColor: color + '20', transform: [{ scale: scaleAnim }] },
      ]}
    >
      <Text variant="caption" style={[styles.statusText, { color }]}>
        {label}
      </Text>
    </Animated.View>
  );
}

export default function CommandesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ fromBooking?: string }>();
  const [refreshing, setRefreshing] = useState(false);
  const { client } = useAuth();
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<'booked' | 'history'>('history');
  const queryClient = useQueryClient();

  const { data: orders, refetch, isLoading } = useQuery({
    queryKey: ['client-orders'],
    queryFn: async () => {
      const sessionId = await getClientSessionId();
      console.log('[COMMANDES] Fetching orders, sessionId:', sessionId ? sessionId.substring(0, 10) + '...' : 'missing');
      console.log('[COMMANDES] Client:', client ? `${client.firstName} ${client.lastName} (${client.id})` : 'not authenticated');
      const result = await apiFetch<Order[]>('/api/client/orders', {
        headers: {
          'X-Client-Id': client?.id || '',
        },
      });
      console.log('[COMMANDES] Received orders:', result?.length || 0);
      return result;
    },
  });

  useEffect(() => {
    console.log('[COMMANDES] Orders data:', orders?.length || 0, 'orders');
    if (orders) {
      console.log('[COMMANDES] Order statuses:', orders.map(o => ({ id: o.id.substring(0, 8), status: o.status, clientId: o.clientId })));
    }
  }, [orders]);

  // ═══════════════════════════════════════════════════════════════════════════
  // RÉSERVATION À L'AVANCE: Nettoyer l'historique si on vient du modal de confirmation
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (params.fromBooking === 'true') {
      // Nettoyer l'historique en remplaçant la page actuelle par l'accueil
      // puis en naviguant vers commandes (cela garantit que le back retourne à l'accueil)
      console.log('[COMMANDES] Coming from booking modal, cleaning navigation history...');
      // Remplacer l'historique en allant à l'accueil puis à commandes
      router.replace('/(client)');
      // Utiliser requestAnimationFrame pour s'assurer que la navigation est complète
      requestAnimationFrame(() => {
        router.push('/(client)/commandes');
        // Supprimer le paramètre pour éviter de le refaire à chaque fois
        router.setParams({ fromBooking: undefined });
      });
    }
  }, [params.fromBooking, router]);

  // ═══════════════════════════════════════════════════════════════════════════
  // RÉSERVATION À L'AVANCE: Rafraîchir les données quand la page est focusée
  // ═══════════════════════════════════════════════════════════════════════════
  useFocusEffect(
    useCallback(() => {
      // Invalider et rafraîchir les données quand on arrive sur la page
      console.log('[COMMANDES] Page focused, invalidating and refetching orders...');
      queryClient.invalidateQueries({ queryKey: ['client-orders'] });
      refetch();
    }, [refetch, queryClient])
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Pacific/Tahiti',
    });
  };

  const formatPrice = (price: number) => {
    return `${price.toLocaleString('fr-FR')} XPF`;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RÉSERVATION À L'AVANCE: Filtrer les réservations
  // ═══════════════════════════════════════════════════════════════════════════
  const isScheduledOrder = (order: Order) => Boolean(order.scheduledTime) || order.status === 'booked';

  const bookedOrders = (orders || [])
    .filter((order) => isScheduledOrder(order))
    .sort((a, b) => {
      // Priorité: 1. booked (en cours), 2. payment_confirmed (payées), 3. autres
      const getPriority = (status: string) => {
        if (status === 'booked') return 0;
        if (status === 'payment_confirmed' || status === 'completed') return 1;
        return 2; // cancelled, expired, etc.
      };
      
      const priorityA = getPriority(a.status);
      const priorityB = getPriority(b.status);
      
      if (priorityA !== priorityB) return priorityA - priorityB;
      
      // Si même priorité, trier par date (plus proche/récent en premier)
      const timeA = a.scheduledTime ? new Date(a.scheduledTime).getTime() : 0;
      const timeB = b.scheduledTime ? new Date(b.scheduledTime).getTime() : 0;
      return timeA - timeB;
    });

  // Filtrer pour ne montrer que les courses terminées ou annulées (pas les en cours)
  const completedOrCancelledOrders = (orders || []).filter(
    (order) =>
      !isScheduledOrder(order) &&
      (
        order.status === 'completed' ||
        order.status === 'payment_confirmed' ||
        order.status === 'cancelled' ||
        order.status === 'expired' ||
        order.status === 'payment_failed'
      )
  );

  // Trier par date (plus récentes en premier)
  const sortedOrders = [...completedOrCancelledOrders].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RÉSERVATION À L'AVANCE: Fonction pour annuler une réservation
  // ═══════════════════════════════════════════════════════════════════════════
  const handleCancelBooking = async (orderId: string) => {
    Alert.alert(
      'Annuler la réservation',
      'Êtes-vous sûr de vouloir annuler cette réservation ?',
      [
        { text: 'Non', style: 'cancel' },
        {
          text: 'Oui, annuler',
          style: 'destructive',
          onPress: async () => {
            setCancellingOrderId(orderId);
            try {
              await apiFetch(`/api/orders/${orderId}/cancel`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ reason: 'Client cancellation', role: 'client' }),
              });
              await refetch();
              Alert.alert('Réservation annulée', 'Votre réservation a été annulée avec succès.');
            } catch (error) {
              console.error('[COMMANDES] Error cancelling booking:', error);
              Alert.alert('Erreur', 'Impossible d\'annuler la réservation. Veuillez réessayer.');
            } finally {
              setCancellingOrderId(null);
            }
          },
        },
      ]
    );
  };

  // Helper pour formater la date de réservation
  const formatScheduledDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'Pacific/Tahiti',
    });
  };

  const formatScheduledTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Pacific/Tahiti',
    });
  };

  const getTimeUntil = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffMins = Math.round(diffMs / 60000);
    
    if (diffMins < 0) return 'Maintenant';
    if (diffMins < 60) return `Dans ${diffMins} min`;
    if (diffMins < 1440) {
      const hours = Math.floor(diffMins / 60);
      return `Dans ${hours}h`;
    }
    const days = Math.floor(diffMins / 1440);
    return `Dans ${days} jour${days > 1 ? 's' : ''}`;
  };

  // ═══ Rendu d'une commande de l'historique ═══
  const renderHistoryOrder = ({ item: order }: { item: Order }) => {
    const status = statusLabels[order.status] || { label: order.status, color: '#6B7280' };
    const pickup = order.addresses.find((a) => a.type === 'pickup');
    const destination = order.addresses.find((a) => a.type === 'destination');
    
    // Afficher le bouton de téléchargement seulement pour les courses terminées/payées
    const canDownloadReceipt = order.status === 'completed' || order.status === 'payment_confirmed';

    const handleDownloadReceipt = async (e: any) => {
      e.stopPropagation(); // Empêcher la navigation vers les détails
      await downloadInvoicePDF(order.id);
    };

    return (
      <TouchableOpacity
        onPress={() => router.push(`/(client)/course-details/${order.id}`)}
        activeOpacity={0.8}
      >
        <Card style={styles.orderCard}>
          <View style={styles.orderHeader}>
            <Text variant="caption" style={styles.orderDate}>
              {formatDate(order.createdAt)}
            </Text>
            <AnimatedStatusBadge color={status.color} label={status.label} />
          </View>

          <View style={styles.addressContainer}>
            <View style={styles.addressRow}>
              <View style={[styles.dot, { backgroundColor: '#22C55E' }]} />
              <Text variant="body" numberOfLines={1} style={styles.addressText}>
                {pickup?.value || 'Adresse de départ'}
              </Text>
            </View>
            <View style={styles.addressLine} />
            <View style={styles.addressRow}>
              <View style={[styles.dot, { backgroundColor: '#EF4444' }]} />
              <Text variant="body" numberOfLines={1} style={styles.addressText}>
                {destination?.value || 'Adresse d\'arrivée'}
              </Text>
            </View>
          </View>

          <View style={styles.orderFooter}>
            <Text variant="label">{order.rideOption.title}</Text>
            <Text variant="h3" style={styles.price}>
              {formatPrice(order.totalPrice)}
            </Text>
          </View>

          {canDownloadReceipt && (
            <TouchableOpacity
              style={styles.downloadButton}
              onPress={handleDownloadReceipt}
              activeOpacity={0.7}
            >
              <Ionicons name="download-outline" size={16} color="#F5C400" />
              <Text variant="caption" style={styles.downloadButtonText}>
                Télécharger votre reçu
              </Text>
            </TouchableOpacity>
          )}
        </Card>
      </TouchableOpacity>
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RÉSERVATION À L'AVANCE: Rendu d'une réservation
  // ═══════════════════════════════════════════════════════════════════════════
  const renderBookedOrder = ({ item: order }: { item: Order }) => {
    const pickup = order.addresses.find((a) => a.type === 'pickup');
    const destination = order.addresses.find((a) => a.type === 'destination');
    const status = statusLabels[order.status] || { label: order.status, color: '#6B7280' };
    const isCancelling = cancellingOrderId === order.id;
    const isBooked = order.status === 'booked';

    return (
      <TouchableOpacity
        onPress={() => router.push(`/(client)/course-details/${order.id}`)}
        activeOpacity={0.8}
      >
        <Card style={styles.bookedCard}>
        {/* Header avec date de réservation */}
        <View style={styles.bookedHeader}>
          <View style={styles.bookedDateContainer}>
            <Ionicons name="calendar" size={20} color="#8B5CF6" />
            <View style={styles.bookedDateText}>
              <Text style={styles.bookedDateLabel}>
                {order.scheduledTime ? formatScheduledDate(order.scheduledTime) : 'Date non définie'}
              </Text>
              <Text style={styles.bookedTimeLabel}>
                à {order.scheduledTime ? formatScheduledTime(order.scheduledTime) : '--:--'}
              </Text>
            </View>
          </View>
          {isBooked ? (
            <View style={styles.bookedCountdown}>
              <Text style={styles.bookedCountdownText}>
                {order.scheduledTime ? getTimeUntil(order.scheduledTime) : ''}
              </Text>
            </View>
          ) : (
            <AnimatedStatusBadge color={status.color} label={status.label} />
          )}
        </View>

        {/* Adresses */}
        <View style={styles.bookedContent}>
          <View style={styles.bookedAddresses}>
            <View style={styles.addressRow}>
              <View style={[styles.dot, { backgroundColor: '#22C55E' }]} />
              <Text variant="body" numberOfLines={1} style={styles.addressText}>
                {pickup?.value || 'Adresse de départ'}
              </Text>
            </View>
            <View style={styles.addressLine} />
            <View style={styles.addressRow}>
              <View style={[styles.dot, { backgroundColor: '#EF4444' }]} />
              <Text variant="body" numberOfLines={1} style={styles.addressText}>
                {destination?.value || 'Adresse d\'arrivée'}
              </Text>
            </View>
          </View>
        </View>

        {/* Footer avec prix et bouton d'annulation */}
        <View style={styles.bookedFooter}>
          <View style={styles.bookedPriceTag}>
            <Text style={styles.bookedPriceText}>{formatPrice(order.totalPrice)}</Text>
          </View>
          
          {isBooked && (
            <TouchableOpacity
              style={[styles.cancelBookingButton, isCancelling && styles.cancelBookingButtonDisabled]}
              onPress={(e) => {
                e.stopPropagation(); // Empêcher la navigation vers les détails
                handleCancelBooking(order.id);
              }}
              disabled={isCancelling}
            >
              <Ionicons name="close-circle" size={18} color="#EF4444" />
              <Text style={styles.cancelBookingButtonText}>
                {isCancelling ? 'Annulation...' : 'Annuler'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </Card>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/(client)')} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
        </TouchableOpacity>
        <Text variant="h1" style={styles.headerTitle}>Mes courses</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* ═══ RÉSERVATION À L'AVANCE: Onglets ═══ */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity
          style={[styles.tab, selectedTab === 'booked' && styles.tabActive]}
          onPress={() => setSelectedTab('booked')}
        >
          <Ionicons 
            name="calendar" 
            size={18} 
            color={selectedTab === 'booked' ? '#8B5CF6' : '#6B7280'} 
          />
          <Text style={[styles.tabText, selectedTab === 'booked' && styles.tabTextActive]}>
            Réservées ({bookedOrders.length})
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.tab, selectedTab === 'history' && styles.tabActive]}
          onPress={() => setSelectedTab('history')}
        >
          <Ionicons 
            name="time" 
            size={18} 
            color={selectedTab === 'history' ? '#8B5CF6' : '#6B7280'} 
          />
          <Text style={[styles.tabText, selectedTab === 'history' && styles.tabTextActive]}>
            Historique ({sortedOrders.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* ═══ Contenu selon l'onglet sélectionné ═══ */}
      {selectedTab === 'booked' ? (
        bookedOrders.length > 0 ? (
          <FlatList
            data={bookedOrders}
            renderItem={renderBookedOrder}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={['#8B5CF6']} />
            }
          />
        ) : (
          <View style={styles.emptyContainer}>
            <Ionicons name="calendar-outline" size={64} color="#e5e7eb" />
            <Text variant="h3" style={styles.emptyTitle}>
              Aucune réservation
            </Text>
            <Text variant="body" style={styles.emptyText}>
              Vos courses réservées à l'avance apparaîtront ici
            </Text>
          </View>
        )
      ) : (
        sortedOrders.length > 0 ? (
          <FlatList
            data={sortedOrders}
            renderItem={renderHistoryOrder}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={['#F5C400']} />
            }
          />
        ) : (
          <View style={styles.emptyContainer}>
            <Ionicons name="car-outline" size={64} color="#e5e7eb" />
            <Text variant="h3" style={styles.emptyTitle}>
              Aucune course
            </Text>
            <Text variant="body" style={styles.emptyText}>
              Vos courses terminées et annulées apparaîtront ici
            </Text>
          </View>
        )
      )}
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
    borderBottomColor: '#f3f4f6',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f8f9fa',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
  },
  listContent: {
    padding: 20,
    gap: 16,
  },
  orderCard: {
    padding: 16,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  orderDate: {
    color: '#6b7280',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontWeight: '600',
    fontSize: 11,
  },
  addressContainer: {
    marginBottom: 16,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  addressLine: {
    width: 2,
    height: 20,
    backgroundColor: '#e5e7eb',
    marginLeft: 4,
    marginVertical: 2,
  },
  addressText: {
    flex: 1,
  },
  orderFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  price: {
    color: '#F5C400',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    color: '#6b7280',
    textAlign: 'center',
  },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 12,
    borderRadius: 8,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F5C400',
  },
  downloadButtonText: {
    marginLeft: 6,
    color: '#F5C400',
    fontWeight: '600',
    fontSize: 12,
  },
  // ═══════════════════════════════════════════════════════════════════════════
  // RÉSERVATION À L'AVANCE: Styles pour les onglets et les cartes de réservation
  // ═══════════════════════════════════════════════════════════════════════════
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    gap: 8,
  },
  tabActive: {
    backgroundColor: '#F5F3FF',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  tabTextActive: {
    color: '#8B5CF6',
  },
  bookedCard: {
    padding: 0,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#8B5CF6',
  },
  bookedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F5F3FF',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  bookedDateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bookedDateText: {
    
  },
  bookedDateLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
    textTransform: 'capitalize',
  },
  bookedTimeLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: '#8B5CF6',
  },
  bookedCountdown: {
    backgroundColor: '#22C55E',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  bookedCountdownText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  bookedContent: {
    padding: 16,
  },
  bookedAddresses: {
    marginBottom: 0,
  },
  bookedFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    backgroundColor: '#FAFAFA',
  },
  bookedPriceTag: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  bookedPriceText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  cancelBookingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 6,
  },
  cancelBookingButtonDisabled: {
    opacity: 0.6,
  },
  cancelBookingButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#EF4444',
  },
});
