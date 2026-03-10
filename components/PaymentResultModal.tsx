import { View, StyleSheet, Modal, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { downloadInvoicePDF } from '@/lib/pdf-download';
import { useState } from 'react';

interface PaymentResultModalProps {
  visible: boolean;
  status: 'success' | 'failed';
  amount: number;
  paymentMethod?: 'card' | 'cash';
  cardBrand?: string | null;
  cardLast4?: string | null;
  errorMessage?: string;
  waitingTimeMinutes?: number | null; // Minutes d'attente après les 5 premières gratuites
  paidStopsCost?: number; // Coût des arrêts payants
  supplements?: Array<{ nom?: string; name?: string; prixXpf?: number; price?: number; quantity?: number }>; // Suppléments
  passengers?: number; // Nombre de passagers pour la majoration +5 passagers
  orderId?: string; // ID de la commande pour télécharger le reçu
  fraisServiceOfferts?: boolean; // Si les frais de service sont offerts (salarié TAPEA)
  initialTotalPrice?: number; // Prix initial avant déduction des frais (pour calculer l'économie)
  fraisServicePercent?: number; // % de frais de service (pour affichage dynamique)
  onRetry?: () => void;
  onSwitchToCash?: () => void;
  onClose: () => void;
}

export function PaymentResultModal({
  visible,
  status,
  amount,
  paymentMethod,
  cardBrand,
  cardLast4,
  errorMessage,
  waitingTimeMinutes,
  paidStopsCost,
  supplements,
  passengers,
  orderId,
  fraisServiceOfferts,
  initialTotalPrice,
  fraisServicePercent = 15,
  onRetry,
  onSwitchToCash,
  onClose,
}: PaymentResultModalProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  
  const formatPrice = (price: number) => {
    return `${price.toLocaleString('fr-FR')} XPF`;
  };

  const handleDownloadReceipt = async () => {
    if (!orderId) return;
    
    setIsDownloading(true);
    try {
      await downloadInvoicePDF(orderId);
    } catch (error) {
      console.error('[PaymentResultModal] Erreur téléchargement reçu:', error);
    } finally {
      setIsDownloading(false);
    }
  };

  // Calculer les frais d'attente si applicable
  const calculateWaitingFee = (minutes: number | null | undefined): number => {
    if (!minutes || minutes <= 5) return 0;
    const billableMinutes = minutes - 5; // 5 premières minutes gratuites
    return billableMinutes * 42; // 42 XPF par minute après les 5 premières
  };

  const waitingMinutesValue = waitingTimeMinutes ? Number(waitingTimeMinutes) : 0;
  const waitingFee = calculateWaitingFee(waitingMinutesValue);
  const paidStopsValue = Number(paidStopsCost || 0);
  
  // Calculer le total des suppléments
  const supplementsTotal = (supplements || []).reduce((sum: number, supp: any) => {
    return sum + Number(supp.prixXpf || supp.price || 0) * Number(supp.quantity || 1);
  }, 0);
  
  // Majoration passagers (500 XPF si >= 5 passagers)
  const majorationPassagers = (passengers && passengers >= 5) ? 500 : 0;
  
  // Calculer les frais de service (% configurable)
  let fraisService = 0;
  if (fraisServiceOfferts && initialTotalPrice && initialTotalPrice > amount) {
    // Frais offerts : calculer à partir du prix initial
    fraisService = initialTotalPrice - amount;
  } else if (!fraisServiceOfferts) {
    // Frais normaux : le montant inclut les frais, donc on les estime
    // subtotal = amount / (1 + X/100), frais = amount - subtotal
    const subtotalEstime = Math.round(amount / (1 + fraisServicePercent / 100));
    fraisService = amount - subtotalEstime;
  }
  
  // Prix de base = montant total - frais d'attente - arrêts payants - suppléments - majoration passagers - frais service
  const rawBasePrice = amount - waitingFee - paidStopsValue - supplementsTotal - majorationPassagers - (fraisServiceOfferts ? 0 : fraisService);
  const basePrice = isNaN(rawBasePrice) || rawBasePrice < 0 ? amount : rawBasePrice;
  
  // Vérifier s'il y a des détails à afficher (suppléments, attente, arrêts payants, majoration passagers, ou frais service)
  const hasDetails = supplementsTotal > 0 || waitingFee > 0 || paidStopsValue > 0 || majorationPassagers > 0 || fraisService > 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Card style={styles.modal}>
          <View style={styles.header}>
            <View
              style={[
                styles.iconContainer,
                { backgroundColor: status === 'success' ? '#D1FAE5' : '#FEE2E2' },
              ]}
            >
              <Ionicons
                name={status === 'success' ? 'checkmark-circle' : 'close-circle'}
                size={48}
                color={status === 'success' ? '#22C55E' : '#EF4444'}
              />
            </View>
            <Text variant="h2" style={styles.title}>
              {status === 'success' ? 'Paiement réussi' : 'Paiement échoué'}
            </Text>
          </View>

          <View style={styles.content}>
            {status === 'success' ? (
              <>
                {/* Détail du prix avec suppléments, attente, arrêts payants */}
                {hasDetails ? (
                  <View style={styles.priceBreakdown}>
                    {/* Prix de base */}
                    <View style={styles.priceRow}>
                      <Text variant="caption" style={styles.priceLabel}>Prix de base</Text>
                      <Text variant="caption" style={styles.priceValue}>
                        {formatPrice(basePrice)}
                      </Text>
                    </View>
                    
                    {/* Suppléments individuels */}
                    {(supplements || []).map((supp: any, index: number) => {
                      const suppPrice = Number(supp.prixXpf || supp.price || 0) * Number(supp.quantity || 1);
                      const suppName = String(supp.nom || supp.name || 'Supplément');
                      return (
                        <View key={index} style={styles.priceRow}>
                          <View style={styles.waitingRow}>
                            <Ionicons name="add-circle-outline" size={16} color="#F59E0B" />
                            <Text variant="caption" style={[styles.waitingLabel, { color: '#92400E' }]}>
                              {suppName}
                            </Text>
                          </View>
                          <Text variant="caption" style={[styles.waitingFee, { color: '#F59E0B' }]}>
                            {`+${formatPrice(suppPrice)}`}
                          </Text>
                        </View>
                      );
                    })}
                    
                    {/* Majoration passagers (≥5 passagers) */}
                    {majorationPassagers > 0 && (
                      <View style={styles.priceRow}>
                        <View style={styles.waitingRow}>
                          <Ionicons name="people-outline" size={16} color="#F59E0B" />
                          <Text variant="caption" style={[styles.waitingLabel, { color: '#92400E' }]}>
                            {`+5 passagers (${passengers || 5})`}
                          </Text>
                        </View>
                        <Text variant="caption" style={[styles.waitingFee, { color: '#F59E0B' }]}>
                          {`+${formatPrice(majorationPassagers)}`}
                        </Text>
                      </View>
                    )}
                    
                    {/* Majoration d'attente */}
                    {waitingFee > 0 && waitingMinutesValue > 0 && (
                      <View style={styles.priceRow}>
                        <View style={styles.waitingRow}>
                          <Ionicons name="time-outline" size={16} color="#F59E0B" />
                          <Text variant="caption" style={styles.waitingLabel}>
                            {`Majoration d'attente (${Math.max(0, waitingMinutesValue - 5)} min)`}
                          </Text>
                        </View>
                        <Text variant="caption" style={styles.waitingFee}>
                          {`+${formatPrice(waitingFee)}`}
                        </Text>
                      </View>
                    )}
                    
                    {/* Arrêts payants */}
                    {paidStopsValue > 0 && (
                      <View style={styles.priceRow}>
                        <View style={styles.waitingRow}>
                          <Ionicons name="pause-circle-outline" size={16} color="#EF4444" />
                          <Text variant="caption" style={[styles.waitingLabel, { color: '#EF4444' }]}>
                            {"Arrêts payants"}
                          </Text>
                        </View>
                        <Text variant="caption" style={[styles.waitingFee, { color: '#EF4444' }]}>
                          {`+${formatPrice(paidStopsValue)}`}
                        </Text>
                      </View>
                    )}
                    
                    {/* Frais de service (% configurable) */}
                    {fraisService > 0 && (
                      <View style={styles.priceRow}>
                        <View style={styles.waitingRow}>
                          <Ionicons 
                            name={fraisServiceOfferts ? "gift-outline" : "pricetag-outline"} 
                            size={16} 
                            color={fraisServiceOfferts ? "#22C55E" : "#3B82F6"} 
                          />
                          <View>
                            <Text variant="caption" style={[styles.waitingLabel, { color: fraisServiceOfferts ? '#22C55E' : '#3B82F6' }]}>
                              {`Frais de service (${fraisServicePercent}%)`}
                            </Text>
                            {fraisServiceOfferts && (
                              <Text variant="caption" style={{ color: '#22C55E', fontSize: 11, fontWeight: '600' }}>
                                Offerts par Tāpe'a
                              </Text>
                            )}
                          </View>
                        </View>
                        {fraisServiceOfferts ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text variant="caption" style={[styles.waitingFee, { 
                              textDecorationLine: 'line-through', 
                              color: '#9CA3AF',
                              marginRight: 6
                            }]}>
                              {formatPrice(fraisService)}
                            </Text>
                            <Text variant="caption" style={[styles.waitingFee, { color: '#22C55E', fontWeight: '700' }]}>
                              Offert
                            </Text>
                          </View>
                        ) : (
                          <Text variant="caption" style={[styles.waitingFee, { color: '#3B82F6' }]}>
                            {`+${formatPrice(fraisService)}`}
                          </Text>
                        )}
                      </View>
                    )}
                    
                    <View style={styles.totalDivider} />
                    <View style={styles.priceRow}>
                      <Text variant="body" style={styles.totalLabel}>Montant total</Text>
                      <Text variant="body" style={styles.totalAmount}>
                        {formatPrice(amount)}
                      </Text>
                    </View>
                  </View>
                ) : (
                  /* Montant simple si pas de détails */
                  <Text variant="body" style={styles.amount}>
                    {formatPrice(amount)}
                  </Text>
                )}
                
                {paymentMethod === 'card' && (
                  <Text variant="caption" style={styles.cardInfo}>
                    {cardBrand && cardLast4 
                      ? `Carte ${cardBrand} •••• ${cardLast4}`
                      : 'Paiement par carte (TPE)'
                    }
                  </Text>
                )}
                {paymentMethod === 'cash' && (
                  <Text variant="caption" style={styles.cardInfo}>
                    Paiement en espèces
                  </Text>
                )}
              </>
            ) : (
              <>
                <Text variant="body" style={styles.errorText}>
                  {errorMessage || 'Le paiement n\'a pas pu être effectué'}
                </Text>
                {paymentMethod === 'card' && (
                  <Text variant="caption" style={styles.hint}>
                    Vous pouvez réessayer avec une autre carte ou payer en espèces
                  </Text>
                )}
              </>
            )}
          </View>

          <View style={styles.actions}>
            {status === 'failed' && (
              <>
                {onRetry && (
                  <Button
                    title="Réessayer"
                    onPress={onRetry}
                    fullWidth
                    style={styles.button}
                  />
                )}
                {onSwitchToCash && (
                  <Button
                    title="Payer en espèces"
                    variant="outline"
                    onPress={onSwitchToCash}
                    fullWidth
                    style={styles.button}
                  />
                )}
              </>
            )}
            {status === 'success' && orderId && (
              <TouchableOpacity
                style={styles.downloadButton}
                onPress={handleDownloadReceipt}
                disabled={isDownloading}
              >
                {isDownloading ? (
                  <ActivityIndicator size="small" color="#F5C400" />
                ) : (
                  <Ionicons name="download-outline" size={20} color="#F5C400" />
                )}
                <Text variant="body" style={styles.downloadButtonText}>
                  {isDownloading ? 'Téléchargement...' : 'Télécharger votre reçu'}
                </Text>
              </TouchableOpacity>
            )}
            <Button
              title={status === 'success' ? 'Continuer' : 'Fermer'}
              onPress={onClose}
              fullWidth
              variant={status === 'success' ? 'default' : 'secondary'}
            />
          </View>
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modal: {
    width: '100%',
    maxWidth: 400,
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    textAlign: 'center',
  },
  content: {
    alignItems: 'center',
    marginBottom: 24,
  },
  amount: {
    fontSize: 24,
    fontWeight: '600',
    color: '#F5C400',
    marginBottom: 8,
  },
  cardInfo: {
    color: '#6b7280',
  },
  waitingInfo: {
    color: '#6b7280',
    marginTop: 4,
    marginBottom: 8,
  },
  priceBreakdown: {
    width: '100%',
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FCD34D',
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  priceLabel: {
    color: '#6b7280',
    fontSize: 13,
  },
  priceValue: {
    color: '#1f2937',
    fontSize: 13,
    fontWeight: '500',
  },
  waitingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  waitingLabel: {
    color: '#92400E',
    fontSize: 13,
    fontWeight: '500',
  },
  waitingFee: {
    color: '#F59E0B',
    fontSize: 13,
    fontWeight: '600',
  },
  totalDivider: {
    height: 1,
    backgroundColor: '#FCD34D',
    marginVertical: 8,
  },
  totalLabel: {
    color: '#1f2937',
    fontSize: 16,
    fontWeight: '600',
  },
  totalAmount: {
    color: '#F5C400',
    fontSize: 18,
    fontWeight: '700',
  },
  errorText: {
    color: '#EF4444',
    textAlign: 'center',
    marginBottom: 8,
  },
  hint: {
    color: '#6b7280',
    textAlign: 'center',
  },
  actions: {
    gap: 12,
  },
  button: {
    marginBottom: 0,
  },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F5C400',
  },
  downloadButtonText: {
    marginLeft: 8,
    color: '#F5C400',
    fontWeight: '600',
  },
});
