import { View, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { useTarifs, type TarifsConfig } from '@/lib/tarifs';
import { useState, useCallback } from 'react';

// Majorations réglementaires (fixes)
const MAJORATIONS = [
  {
    id: 'hauteurs',
    titre: 'Majoration "Hauteurs"',
    description: 'Pour les courses sur les hauteurs (lotissement ou quartier...)',
    prix: 500,
    icon: 'trending-up' as const,
  },
  {
    id: 'passagers',
    titre: 'Plus de 4 passagers',
    description: 'À partir du cinquième passager',
    prix: 500,
    icon: 'people' as const,
  },
  {
    id: 'reservation',
    titre: 'Véhicule +5 places',
    description: 'Pour réservation préalable d\'un véhicule de plus de 5 places',
    prix: 500,
    icon: 'car-sport' as const,
  },
];

// Suppléments par défaut (si non chargés depuis l'API)
const DEFAULT_SUPPLEMENTS = [
  {
    id: 'bagages',
    nom: 'Bagages +5 kg',
    description: 'Par unité chargée à bord du véhicule',
    prix: 100,
    icon: 'briefcase' as const,
  },
  {
    id: 'animaux',
    nom: 'Animaux',
    description: 'Par animal transporté',
    prix: 100,
    icon: 'paw' as const,
  },
  {
    id: 'encombrant',
    nom: 'Encombrant',
    description: 'Glacière, surf, vélo, sac de golf, poussette, fauteuil roulant...',
    prix: 500,
    icon: 'cube' as const,
  },
];

export default function TarifsScreen() {
  const router = useRouter();
  const { tarifs, loading, error, refresh, isNightRate } = useTarifs();
  const [refreshing, setRefreshing] = useState(false);

  // Refresh automatique à chaque visite de la page
  useFocusEffect(
    useCallback(() => {
      console.log('[Tarifs] Page visible - refresh automatique');
      refresh(); // Refresh à chaque fois qu'on arrive sur la page
    }, [refresh])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const formatPrice = (price: number) => `${price.toLocaleString('fr-FR')} F`;

  // Calculer le tarif heure d'attente (60 min)
  const heureAttente = tarifs ? tarifs.minuteArret * 60 : 2500;

  // Déterminer si on est en tarif nuit actuellement
  const currentlyNight = isNightRate();

  // Utiliser les suppléments de l'API ou les valeurs par défaut
  const supplements = tarifs?.supplements && tarifs.supplements.length > 0
    ? tarifs.supplements.map(s => ({
        id: s.id,
        nom: s.nom,
        description: s.description || '',
        prix: s.prixXpf,
        icon: getSupplementIcon(s.nom),
      }))
    : DEFAULT_SUPPLEMENTS;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
        </TouchableOpacity>
        <Text variant="h2">Grille tarifaire</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading && !tarifs ? (
        <LoadingOverlay
          title="Chargement des tarifs..."
          subtitle="Mise à jour en cours"
        />
      ) : (
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={['#F5C400']}
              tintColor="#F5C400"
            />
          }
        >
          {/* En-tête officiel amélioré */}
          <View style={styles.officialBanner}>
            <View style={styles.officialIconContainer}>
              <Ionicons name="document-text" size={24} color="#FFFFFF" />
            </View>
            <Text style={styles.officialTitle}>Tarifs réglementaires en vigueur</Text>
            <View style={styles.officialDivider} />
            <Text style={styles.officialSubtitle}>Arrêté n° 1540 CM du 6 septembre 2023</Text>
            {tarifs?.lastUpdated && (
              <Text style={styles.lastUpdated}>
                Mis à jour : {new Date(tarifs.lastUpdated).toLocaleDateString('fr-FR')}
        </Text>
            )}
          </View>

          {/* Indicateur tarif actuel */}
          <View style={[styles.currentRateBadge, currentlyNight ? styles.currentRateNight : styles.currentRateDay]}>
            <Ionicons 
              name={currentlyNight ? "moon" : "sunny"} 
              size={18} 
              color={currentlyNight ? "#6366F1" : "#F59E0B"} 
            />
            <Text style={[styles.currentRateText, currentlyNight ? styles.currentRateTextNight : styles.currentRateTextDay]}>
              Tarif {currentlyNight ? 'nuit' : 'jour'} en cours
              </Text>
            </View>

          {/* Prise en charge */}
          <Card style={styles.mainCard}>
            <View style={styles.mainRow}>
              <View style={styles.mainLabel}>
                <View style={styles.mainIconContainer}>
                  <Ionicons name="flag" size={22} color="#FFFFFF" />
                </View>
                <Text style={styles.mainText}>Prise en charge</Text>
              </View>
              <Text style={styles.mainPrice}>{formatPrice(tarifs?.priseEnCharge ?? 1000)}</Text>
            </View>
          </Card>

          {/* Tarifs au kilomètre */}
          <Text style={styles.sectionTitle}>Tarif au kilomètre</Text>
          
          <View style={styles.tarifRow}>
            <Card style={[styles.tarifCardJour, !currentlyNight ? styles.tarifCardActive : undefined]}>
              <View style={styles.tarifIconBadge}>
                <Ionicons name="sunny" size={22} color="#F59E0B" />
              </View>
              <Text style={styles.tarifPeriode}>JOUR</Text>
              <Text style={styles.tarifHoraire}>
                {tarifs?.heureDebutJour ?? 6}h - {tarifs?.heureFinJour ?? 20}h
              </Text>
              <View style={styles.tarifPriceContainer}>
                <Text style={styles.tarifPrix}>{tarifs?.tarifJourKm ?? 130}</Text>
                <Text style={styles.tarifDevise}>F</Text>
              </View>
              <Text style={styles.tarifUnite}>par kilomètre</Text>
              {!currentlyNight && (
                <View style={styles.activeIndicator}>
                  <Text style={styles.activeIndicatorText}>En cours</Text>
              </View>
              )}
            </Card>

            <Card style={[styles.tarifCardNuit, currentlyNight ? styles.tarifCardActiveNight : undefined]}>
              <View style={styles.tarifIconBadgeNuit}>
                <Ionicons name="moon" size={22} color="#6366F1" />
              </View>
              <Text style={styles.tarifPeriode}>NUIT</Text>
              <Text style={styles.tarifHoraire}>
                {tarifs?.heureFinJour ?? 20}h - {tarifs?.heureDebutJour ?? 6}h
                </Text>
              <View style={styles.tarifPriceContainer}>
                <Text style={styles.tarifPrix}>{tarifs?.tarifNuitKm ?? 260}</Text>
                <Text style={styles.tarifDevise}>F</Text>
              </View>
              <Text style={styles.tarifUnite}>par kilomètre</Text>
              {currentlyNight && (
                <View style={styles.activeIndicatorNight}>
                  <Text style={styles.activeIndicatorTextNight}>En cours</Text>
                </View>
              )}
            </Card>
          </View>

          {/* Heure d'attente */}
          <Card style={styles.attenteCard}>
            <View style={styles.attenteRow}>
              <View style={styles.attenteInfo}>
                <View style={styles.attenteIconContainer}>
                  <Ionicons name="time" size={20} color="#6b7280" />
                </View>
                <View style={styles.attenteTextContainer}>
                  <Text style={styles.attenteTitle}>Heure d'attente</Text>
                  <Text style={styles.attenteDesc}>Arrêt du véhicule à la demande du client{'\n'}ou circulation en marche lente</Text>
                </View>
              </View>
              <View style={styles.attentePriceContainer}>
                <Text style={styles.attentePrix}>{formatPrice(heureAttente)}</Text>
                <Text style={styles.attenteUnite}>/ 60 min</Text>
              </View>
            </View>
          </Card>

          {/* Note importante */}
          <View style={styles.noteCard}>
            <Ionicons name="information-circle" size={18} color="#3B82F6" />
            <Text style={styles.noteText}>
              Le prix de la course couvre le trajet aller et le trajet retour.
            </Text>
          </View>

          {/* Majorations */}
          <Text style={styles.sectionTitle}>Majorations</Text>
          {MAJORATIONS.map((maj) => (
            <Card key={maj.id} style={styles.itemCard}>
              <View style={styles.itemRow}>
                <View style={styles.itemInfo}>
                  <View style={styles.itemIconYellow}>
                    <Ionicons name={maj.icon} size={18} color="#F5C400" />
                  </View>
                  <View style={styles.itemTextContainer}>
                    <Text style={styles.itemTitle}>{maj.titre}</Text>
                    <Text style={styles.itemDesc}>{maj.description}</Text>
                  </View>
                </View>
                <View style={styles.itemPriceContainer}>
                  <Text style={styles.itemPrice}>{formatPrice(maj.prix)}</Text>
              </View>
            </View>
          </Card>
        ))}

          {/* Suppléments */}
          <Text style={styles.sectionTitle}>Suppléments</Text>
          {supplements.map((supp) => (
            <Card key={supp.id} style={styles.itemCard}>
              <View style={styles.itemRow}>
                <View style={styles.itemInfo}>
                  <View style={styles.itemIconGray}>
                    <Ionicons name={supp.icon} size={18} color="#6b7280" />
                  </View>
                  <View style={styles.itemTextContainer}>
                    <Text style={styles.itemTitle}>{supp.nom}</Text>
                    <Text style={styles.itemDesc}>{supp.description}</Text>
                  </View>
                </View>
                <View style={styles.itemPriceContainer}>
                  <Text style={styles.itemPrice}>{formatPrice(supp.prix)}</Text>
              </View>
            </View>
          </Card>
        ))}

          {/* Footer */}
          <View style={styles.footer}>
            <View style={styles.footerDivider} />
            <Text style={styles.footerText}>
              Direction des Transports Terrestres{'\n'}
              Gouvernement de la Polynésie française
            </Text>
            {error && (
              <Text style={styles.errorText}>
                ⚠️ Certaines données peuvent être en cache
            </Text>
            )}
          </View>
      </ScrollView>
      )}
    </SafeAreaView>
  );
}

// Helper pour mapper les noms de suppléments aux icônes
function getSupplementIcon(nom: string): keyof typeof Ionicons.glyphMap {
  const nomLower = nom.toLowerCase();
  if (nomLower.includes('bagage')) return 'briefcase';
  if (nomLower.includes('animal') || nomLower.includes('animaux')) return 'paw';
  if (nomLower.includes('encombrant') || nomLower.includes('surf') || nomLower.includes('vélo')) return 'cube';
  if (nomLower.includes('passager')) return 'people';
  return 'add-circle';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5e5',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  refreshButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  // En-tête officiel amélioré
  officialBanner: {
    backgroundColor: '#F5C400',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#F5C400',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  officialIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  officialTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1a1a1a',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  officialDivider: {
    width: 60,
    height: 3,
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 2,
    marginVertical: 12,
  },
  officialSubtitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4a4a4a',
    textAlign: 'center',
  },
  lastUpdated: {
    fontSize: 11,
    color: '#6b6b6b',
    marginTop: 8,
  },
  // Badge tarif actuel
  currentRateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  currentRateDay: {
    backgroundColor: '#FEF3C7',
  },
  currentRateNight: {
    backgroundColor: '#E0E7FF',
  },
  currentRateText: {
    fontSize: 14,
    fontWeight: '600',
  },
  currentRateTextDay: {
    color: '#92400E',
  },
  currentRateTextNight: {
    color: '#3730A3',
  },
  // Prise en charge
  mainCard: {
    padding: 18,
    backgroundColor: '#FFFFFF',
    marginBottom: 20,
  },
  mainRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  mainLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  mainIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F5C400',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mainText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  mainPrice: {
    fontSize: 26,
    fontWeight: '800',
    color: '#F5C400',
    lineHeight: 34,
  },
  // Section title
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#374151',
    marginTop: 8,
    marginBottom: 12,
    marginLeft: 4,
  },
  // Tarifs jour/nuit
  tarifRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  tarifCardJour: {
    flex: 1,
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderWidth: 2,
    borderColor: '#F59E0B',
    borderRadius: 16,
  },
  tarifCardNuit: {
    flex: 1,
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    borderWidth: 2,
    borderColor: '#6366F1',
    borderRadius: 16,
  },
  tarifCardActive: {
    borderWidth: 3,
    shadowColor: '#F59E0B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  tarifCardActiveNight: {
    borderWidth: 3,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  tarifIconBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  tarifIconBadgeNuit: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#E0E7FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  tarifPeriode: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1a1a1a',
    letterSpacing: 1,
  },
  tarifHoraire: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
    marginBottom: 12,
  },
  tarifPriceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  tarifPrix: {
    fontSize: 36,
    fontWeight: '800',
    color: '#1a1a1a',
    lineHeight: 40,
  },
  tarifDevise: {
    fontSize: 18,
    fontWeight: '700',
    color: '#6b7280',
  },
  tarifUnite: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 4,
  },
  activeIndicator: {
    backgroundColor: '#F59E0B',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    marginTop: 10,
  },
  activeIndicatorText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  activeIndicatorNight: {
    backgroundColor: '#6366F1',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    marginTop: 10,
  },
  activeIndicatorTextNight: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  // Heure d'attente
  attenteCard: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    marginBottom: 12,
  },
  attenteRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  attenteInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  attenteIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  attenteTextContainer: {
    flex: 1,
  },
  attenteTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  attenteDesc: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 3,
    lineHeight: 15,
  },
  attentePriceContainer: {
    alignItems: 'flex-end',
    marginLeft: 12,
  },
  attentePrix: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F5C400',
  },
  attenteUnite: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 2,
  },
  // Note
  noteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    marginBottom: 20,
  },
  noteText: {
    flex: 1,
    fontSize: 13,
    color: '#1E40AF',
    fontWeight: '500',
    lineHeight: 18,
  },
  // Items (majorations, suppléments)
  itemCard: {
    padding: 14,
    backgroundColor: '#FFFFFF',
    marginBottom: 10,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  itemIconYellow: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemIconGray: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#f3f4f6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemTextContainer: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  itemDesc: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 3,
    lineHeight: 15,
  },
  itemPriceContainer: {
    marginLeft: 12,
  },
  itemPrice: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F5C400',
  },
  // Footer
  footer: {
    marginTop: 24,
    alignItems: 'center',
    paddingVertical: 16,
  },
  footerDivider: {
    width: 40,
    height: 3,
    backgroundColor: '#e5e5e5',
    borderRadius: 2,
    marginBottom: 16,
  },
  footerText: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 18,
  },
  errorText: {
    fontSize: 11,
    color: '#F59E0B',
    marginTop: 8,
  },
});
