import { View, StyleSheet, ScrollView, TouchableOpacity, Image, Modal } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/lib/AuthContext';
import { apiFetch, getClientSessionId } from '@/lib/api';
import type { Order } from '@/lib/types';

interface MenuItem {
  id: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  route?: string;
  action?: () => void;
  variant?: 'default' | 'danger';
}

interface MenuSection {
  title: string;
  items: MenuItem[];
}

function PageHeader({ title }: { title: string }) {
  const router = useRouter();
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
        <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

function UserProfileHeader({ name, lastName, ridesCount, photoUrl }: { name: string; lastName: string; ridesCount: number; photoUrl?: string | null }) {
  return (
    <View style={styles.profileHeader}>
      <View style={styles.profileLeft}>
        <View style={styles.avatarContainer}>
          <Image 
            source={photoUrl ? { uri: photoUrl } : require('@/assets/images/pdpclient.png')} 
            style={styles.avatarImage}
          />
        </View>
        <View>
          <Text style={styles.profileName}>{name}</Text>
          <Text style={styles.profileLastName}>{lastName}</Text>
        </View>
      </View>
      <View style={styles.ridesCountContainer}>
        <Text style={styles.ridesCountNumber}>{ridesCount}</Text>
        <Text style={styles.ridesCountLabel}>course{ridesCount !== 1 ? 's' : ''}</Text>
      </View>
    </View>
  );
}

function ProfileMenuItem({ item, onPress }: { item: MenuItem; onPress: () => void }) {
  const isDanger = item.variant === 'danger';
  
  return (
    <TouchableOpacity
      style={styles.menuItem}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.menuItemContent}>
        <View style={styles.menuItemLeft}>
          <View style={[styles.menuIcon, isDanger && styles.menuIconDanger]}>
            <Ionicons 
              name={item.icon} 
              size={20} 
              color={isDanger ? '#DC2626' : '#5c5c5c'} 
            />
          </View>
          <Text style={isDanger ? [styles.menuItemLabel, styles.menuItemLabelDanger] : styles.menuItemLabel}>
            {item.title}
          </Text>
        </View>
        <Ionicons 
          name="chevron-forward" 
          size={20} 
          color={isDanger ? '#DC2626' : '#5c5c5c'} 
        />
      </View>
    </TouchableOpacity>
  );
}

export default function ProfilScreen() {
  const router = useRouter();
  const { client, logout } = useAuth();
  const [showComingSoonModal, setShowComingSoonModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Récupérer les commandes pour compter les courses terminées
  const { data: orders } = useQuery({
    queryKey: ['client-orders-count'],
    queryFn: async () => {
      const sessionId = await getClientSessionId();
      if (!sessionId) return [];
      const result = await apiFetch<Order[]>('/api/client/orders', {
        headers: {
          'X-Client-Id': client?.id || '',
        },
      });
      return result || [];
    },
  });

  // Compter uniquement les courses terminées (completed ou payment_confirmed)
  const completedRidesCount = (orders || []).filter(
    (order) => order.status === 'completed' || order.status === 'payment_confirmed'
  ).length;

  const menuSections: MenuSection[] = [
    {
      title: 'Mon compte',
      items: [
        { id: 'info', title: 'Informations personnelles', icon: 'person-outline', route: '/(client)/info-perso' },
        { id: 'cartes', title: 'Moyens de paiement', icon: 'card-outline', action: () => setShowComingSoonModal(true) },
      ],
    },
    {
      title: 'Légal',
      items: [
        {
          id: 'privacy-policy',
          title: 'Politique de confidentialité',
          icon: 'shield-checkmark-outline',
          action: () => {
            const url = 'https://tape-a.com/politique-de-confidentialite-tapea/';
            import('expo-linking').then(({ openURL }) => {
              openURL(url).catch(() => {
                // Fallback si Linking n'est pas disponible
                console.log('Ouverture de la politique de confidentialité:', url);
              });
            });
          }
        },
        {
          id: 'cgu',
          title: 'Conditions d\'utilisation',
          icon: 'document-text-outline',
          action: () => {
            router.push('/(auth)/cgu');
          }
        },
      ],
    },
    {
      title: 'Aide',
      items: [
        { id: 'help', title: "Centre d'aide", icon: 'help-circle-outline', route: '/(client)/aide' },
      ],
    },
  ];

  const logoutItem: MenuItem = {
    id: 'logout',
    title: 'Déconnexion',
    icon: 'log-out-outline',
    variant: 'danger',
    action: logout,
  };

  const deleteAccountItem: MenuItem = {
    id: 'delete-account',
    title: 'Supprimer votre compte',
    icon: 'trash-outline',
    variant: 'danger',
    action: () => setShowDeleteModal(true),
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    try {
      const sessionId = await getClientSessionId();
      const response = await apiFetch('/api/client/account', {
        method: 'DELETE',
        headers: {
          'X-Client-Id': client?.id || '',
          'X-Client-Session-Id': sessionId || '',
        },
      });
      
      if (response) {
        await logout();
      }
    } catch (error) {
      console.error('Erreur lors de la suppression:', error);
      // On déconnecte quand même en cas d'erreur
      await logout();
    } finally {
      setIsDeleting(false);
      setShowDeleteModal(false);
    }
  };

  const handleMenuPress = (item: MenuItem) => {
    if (item.route) {
      router.push(item.route as any);
    } else if (item.action) {
      item.action();
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <PageHeader title="Mon profil" />
      
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <UserProfileHeader 
          name={client?.firstName || 'Client'}
          lastName={client?.lastName || ''}
          ridesCount={completedRidesCount}
          photoUrl={client?.photoUrl}
        />

        <View style={styles.menuContainer}>
          {menuSections.map((section) => (
            <View key={section.title} style={styles.section}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              {section.items.map((item) => (
                <ProfileMenuItem
                  key={item.id}
                  item={item}
                  onPress={() => handleMenuPress(item)}
                />
              ))}
            </View>
          ))}

          <ProfileMenuItem
            item={logoutItem}
            onPress={() => handleMenuPress(logoutItem)}
          />

          <ProfileMenuItem
            item={deleteAccountItem}
            onPress={() => handleMenuPress(deleteAccountItem)}
          />
        </View>

        <Text style={styles.version}>Version 2.0.0</Text>
      </ScrollView>

      {/* Modal Bientôt disponible */}
      <Modal
        visible={showComingSoonModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowComingSoonModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.comingSoonModal}>
            <View style={styles.comingSoonIconContainer}>
              <Ionicons name="time-outline" size={48} color="#F5C400" />
            </View>
            <Text style={styles.comingSoonTitle}>Bientôt disponible</Text>
            <Text style={styles.comingSoonSubtitle}>
              La gestion des moyens de paiement sera disponible dans une prochaine mise à jour.
            </Text>
            <TouchableOpacity
              style={styles.comingSoonButton}
              onPress={() => setShowComingSoonModal(false)}
            >
              <Text style={styles.comingSoonButtonText}>J'ai compris</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal Confirmation suppression compte */}
      <Modal
        visible={showDeleteModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowDeleteModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.deleteModal}>
            <View style={styles.deleteIconContainer}>
              <Ionicons name="warning-outline" size={48} color="#DC2626" />
            </View>
            <Text style={styles.deleteTitle}>Supprimer votre compte ?</Text>
            <Text style={styles.deleteSubtitle}>
              Cette action est irréversible. Toutes vos données, courses et informations seront définitivement supprimées.
            </Text>
            <View style={styles.deleteButtonsContainer}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setShowDeleteModal(false)}
                disabled={isDeleting}
              >
                <Text style={styles.cancelButtonText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.deleteButton, isDeleting && styles.deleteButtonDisabled]}
                onPress={handleDeleteAccount}
                disabled={isDeleting}
              >
                <Text style={styles.deleteButtonText}>
                  {isDeleting ? 'Suppression...' : 'Supprimer'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    paddingHorizontal: 16,
    paddingVertical: 16,
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
    fontSize: 24,
    fontWeight: '700',
    color: '#393939',
    textAlign: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 32,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  profileLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatarContainer: {
    position: 'relative',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(245, 196, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#F5C400',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  avatarImage: {
    width: 77,
    height: 77,
    borderRadius: 38,
  },
  profileName: {
    fontSize: 26,
    fontWeight: '800',
    color: '#393939',
    lineHeight: 28,
  },
  profileLastName: {
    fontSize: 26,
    fontWeight: '400',
    color: '#393939',
    lineHeight: 28,
  },
  ridesCountContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5C400',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingTop: 19,
    paddingBottom: 12,
    minWidth: 70,
  },
  ridesCountNumber: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 28,
  },
  ridesCountLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
    textTransform: 'uppercase',
    marginTop: 4,
    letterSpacing: 0.5,
  },
  menuContainer: {
    paddingHorizontal: 16,
    marginTop: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#343434',
    marginBottom: 12,
  },
  menuItem: {
    backgroundColor: '#f6f6f6',
    borderRadius: 10,
    marginBottom: 8,
  },
  menuItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  menuIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ffdf6d',
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuIconDanger: {
    backgroundColor: '#FEE2E2',
  },
  menuItemLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#5c5c5c',
  },
  menuItemLabelDanger: {
    color: '#DC2626',
  },
  version: {
    textAlign: 'center',
    fontSize: 14,
    color: '#8c8c8c',
    marginTop: 24,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  comingSoonModal: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    width: '100%',
    maxWidth: 320,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  comingSoonIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FFF9E6',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  comingSoonTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 12,
    textAlign: 'center',
  },
  comingSoonSubtitle: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  comingSoonButton: {
    backgroundColor: '#F5C400',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
  },
  comingSoonButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    textAlign: 'center',
  },
  deleteModal: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    width: '100%',
    maxWidth: 320,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  deleteIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FEE2E2',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  deleteTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 12,
    textAlign: 'center',
  },
  deleteSubtitle: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  deleteButtonsContainer: {
    flexDirection: 'column',
    gap: 12,
    width: '100%',
  },
  cancelButton: {
    backgroundColor: '#F3F4F6',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    textAlign: 'center',
  },
  deleteButton: {
    backgroundColor: '#DC2626',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
  },
  deleteButtonDisabled: {
    backgroundColor: '#F87171',
  },
  deleteButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
  },
});
