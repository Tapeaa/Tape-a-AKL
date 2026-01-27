import { View, StyleSheet, FlatList, TouchableOpacity, RefreshControl, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import type { PaymentMethod } from '@/lib/types';
import { CardField, useConfirmSetupIntent, useStripe as useStripeHook, isStripeAvailable } from '@/lib/stripe';

export default function CartesBancairesScreen() {
  const router = useRouter();
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [showAddCard, setShowAddCard] = useState(false);
  const [cardComplete, setCardComplete] = useState(false);
  
  const confirmSetupIntentResult = useConfirmSetupIntent();
  useStripeHook();

  const { data: paymentMethods, refetch } = useQuery({
    queryKey: ['payment-methods', client?.id],
    queryFn: () => apiFetch<PaymentMethod[]>(`/api/stripe/payment-methods/${client?.id}`),
    enabled: !!client?.id,
  });

  const addCardMutation = useMutation({
    mutationFn: async () => {
      if (!confirmSetupIntentResult) {
        throw new Error('Stripe non disponible. Créez un Development Build pour utiliser les paiements.');
      }

      const setupIntentResponse = await apiFetch<{ clientSecret: string }>(
        `/api/stripe/setup-intent/${client?.id}`,
        { method: 'POST' }
      );

      const { error, setupIntent } = await confirmSetupIntentResult.confirmSetupIntent(
        setupIntentResponse.clientSecret,
        { paymentMethodType: 'Card' }
      );

      if (error) {
        throw new Error(error.message);
      }

      return setupIntent;
    },
    onSuccess: () => {
      setShowAddCard(false);
      queryClient.invalidateQueries({ queryKey: ['payment-methods', client?.id] });
      Alert.alert('Succès', 'Votre carte a été ajoutée avec succès');
    },
    onError: (error: Error) => {
      Alert.alert('Erreur', error.message || 'Impossible d\'ajouter la carte');
    },
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleAddCard = () => {
    if (!isStripeAvailable) {
      Alert.alert(
        'Fonctionnalité non disponible',
        'Pour ajouter une carte bancaire, vous devez utiliser un Development Build de l\'application. Expo Go ne supporte pas cette fonctionnalité.'
      );
      return;
    }
    setShowAddCard(true);
  };

  const handleConfirmCard = () => {
    if (cardComplete) {
      addCardMutation.mutate();
    }
  };

  const renderCard = ({ item: card }: { item: PaymentMethod }) => (
    <Card style={styles.cardItem}>
      <View style={styles.cardContent}>
        <View style={styles.cardIcon}>
          <Ionicons name="card" size={24} color="#1a1a1a" />
        </View>
        <View style={styles.cardInfo}>
          <Text variant="label">
            {card.brand.charAt(0).toUpperCase() + card.brand.slice(1)} •••• {card.last4}
          </Text>
          <Text variant="caption" style={styles.cardExpiry}>
            Expire {card.expiryMonth}/{card.expiryYear}
          </Text>
        </View>
        {card.isDefault && (
          <View style={styles.defaultBadge}>
            <Text variant="caption" style={styles.defaultText}>
              Par défaut
            </Text>
          </View>
        )}
      </View>
    </Card>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
        </TouchableOpacity>
        <Text variant="h2">Cartes bancaires</Text>
        <View style={{ width: 40 }} />
      </View>

      {showAddCard && isStripeAvailable && CardField ? (
        <View style={styles.addCardContainer}>
          <Text variant="h3" style={styles.addCardTitle}>Ajouter une carte</Text>
          <CardField
            postalCodeEnabled={false}
            placeholders={{
              number: '4242 4242 4242 4242',
            }}
            cardStyle={{
              backgroundColor: '#FFFFFF',
              textColor: '#1a1a1a',
              borderRadius: 12,
              borderWidth: 1,
              borderColor: '#e5e7eb',
            }}
            style={styles.cardField}
            onCardChange={(cardDetails: any) => {
              setCardComplete(cardDetails.complete);
            }}
          />
          <View style={styles.addCardButtons}>
            <Button
              title="Annuler"
              variant="secondary"
              onPress={() => setShowAddCard(false)}
              style={{ flex: 1 }}
            />
            <Button
              title="Confirmer"
              onPress={handleConfirmCard}
              disabled={!cardComplete || addCardMutation.isPending}
              loading={addCardMutation.isPending}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      ) : (
        <>
          {paymentMethods && paymentMethods.length > 0 ? (
            <FlatList
              data={paymentMethods}
              renderItem={renderCard}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={['#F5C400']} />
              }
            />
          ) : (
            <View style={styles.emptyContainer}>
              <Ionicons name="card-outline" size={64} color="#e5e7eb" />
              <Text variant="h3" style={styles.emptyTitle}>
                Aucune carte
              </Text>
              <Text variant="body" style={styles.emptyText}>
                Ajoutez une carte pour payer vos courses
              </Text>
              {!isStripeAvailable && (
                <Text variant="caption" style={styles.devBuildNote}>
                  Note: Les paiements nécessitent un Development Build
                </Text>
              )}
            </View>
          )}
        </>
      )}

      {!showAddCard && (
        <View style={styles.footer}>
          <Button
            title="Ajouter une carte"
            onPress={handleAddCard}
            fullWidth
          />
        </View>
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
    justifyContent: 'center',
  },
  listContent: {
    padding: 20,
    gap: 16,
    paddingBottom: 100,
  },
  cardItem: {
    padding: 16,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#f3f4f6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  cardInfo: {
    flex: 1,
  },
  cardExpiry: {
    color: '#6b7280',
    marginTop: 2,
  },
  defaultBadge: {
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  defaultText: {
    color: '#059669',
    fontWeight: '600',
    fontSize: 10,
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
  devBuildNote: {
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 16,
    fontStyle: 'italic',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    paddingBottom: 32,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  addCardContainer: {
    padding: 20,
  },
  addCardTitle: {
    marginBottom: 20,
  },
  cardField: {
    width: '100%',
    height: 50,
    marginVertical: 20,
  },
  addCardButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
});
