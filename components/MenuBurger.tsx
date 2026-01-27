import { useState, useRef, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Modal, Animated, Dimensions, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/lib/AuthContext';

const { width } = Dimensions.get('window');

interface MenuItem {
  id: string;
  title: string;
  icon: string;
  route?: string;
  action?: () => void;
}

const menuItems: MenuItem[] = [
  { id: 'profil', title: 'Profil', icon: 'person-outline', route: '/(client)/profil' },
  { id: 'commandes', title: 'Commandes', icon: 'list-outline', route: '/(client)/commandes' },
  { id: 'tarifs', title: 'Tarifs', icon: 'pricetag-outline', route: '/(client)/tarifs' },
  { id: 'contact', title: 'Contactez-nous', icon: 'mail-outline', route: '/(client)/support' },
];

export default function MenuBurger() {
  const [isOpen, setIsOpen] = useState(false);
  const [menuKey, setMenuKey] = useState(0);
  const router = useRouter();
  const { logout, client } = useAuth();
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(-width)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;

  const getLastName = () => {
    return client?.lastName || '';
  };

  // Réinitialiser les animations quand le menu se ferme
  useEffect(() => {
    if (!isOpen) {
      slideAnim.setValue(-width);
      overlayAnim.setValue(0);
    }
  }, [isOpen]);

  const openMenu = () => {
    // Forcer le remontage du Modal en changeant la clé
    setMenuKey(prev => prev + 1);
    // Réinitialiser les animations avant d'ouvrir
    slideAnim.setValue(-width);
    overlayAnim.setValue(0);
    setIsOpen(true);
    // Petit délai pour s'assurer que le Modal est monté
    requestAnimationFrame(() => {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(overlayAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    });
  };

  const closeMenu = () => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: -width,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(overlayAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setIsOpen(false);
      // Réinitialiser complètement les animations après fermeture
      slideAnim.setValue(-width);
      overlayAnim.setValue(0);
    });
  };

  const handleMenuItemPress = (item: MenuItem) => {
    // Fermer le menu immédiatement
    setIsOpen(false);
    slideAnim.setValue(-width);
    overlayAnim.setValue(0);
    
    // Naviguer après un petit délai pour éviter les conflits
    setTimeout(() => {
      if (item.route) {
        router.push(item.route as any);
      } else if (item.action) {
        item.action();
      }
    }, 100);
  };

  const handleLogout = () => {
    closeMenu();
    logout();
  };

  return (
    <>
      <TouchableOpacity 
        onPress={openMenu} 
        style={styles.burgerButton}
        accessibilityLabel="Ouvrir le menu de navigation"
        accessibilityRole="button"
        accessibilityHint="Affiche le menu avec les options de navigation"
      >
        <Ionicons name="menu" size={24} color="#1a1a1a" />
      </TouchableOpacity>

      <Modal
        key={`menu-modal-${menuKey}`}
        visible={isOpen}
        transparent={true}
        animationType="none"
        onRequestClose={closeMenu}
        statusBarTranslucent={true}
      >
        <View style={styles.modalContainer}>
          <Animated.View
            style={[
              styles.overlay,
              {
                opacity: overlayAnim,
              },
            ]}
          >
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={closeMenu}
              accessibilityLabel="Fermer le menu"
              accessibilityRole="button"
            />
          </Animated.View>
          <Animated.View
            style={[
              styles.menuContainer,
              {
                transform: [{ translateX: slideAnim }],
              },
            ]}
          >
            <View style={[styles.menuContent, { paddingTop: insets.top, paddingLeft: insets.left, paddingBottom: insets.bottom }]}>
              <View style={styles.menuHeader}>
                <View style={styles.headerLeft}>
                  <View style={styles.profileContainer}>
                    <View style={styles.avatarContainer}>
                      <Image 
                        source={client?.photoUrl ? { uri: client.photoUrl } : require('@/assets/images/pdpclient.png')} 
                        style={styles.avatarImage}
                      />
                    </View>
                    <View style={styles.nameContainer}>
                      <Text style={styles.userName} numberOfLines={1}>
                        {client?.firstName || 'Utilisateur'}
                      </Text>
                      {getLastName() ? (
                        <Text style={styles.lastName} numberOfLines={1}>
                          {getLastName()}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </View>
                <TouchableOpacity 
                  onPress={closeMenu} 
                  style={styles.closeButton}
                  accessibilityLabel="Fermer le menu"
                  accessibilityRole="button"
                >
                  <Ionicons name="close" size={20} color="#6b7280" />
                </TouchableOpacity>
              </View>

              <View style={styles.menuItems}>
                {menuItems.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.menuItem}
                    onPress={() => handleMenuItemPress(item)}
                    activeOpacity={0.7}
                    accessibilityLabel={item.title}
                    accessibilityRole="button"
                    accessibilityHint={`Navigue vers la page ${item.title}`}
                  >
                    <View style={styles.menuItemIconContainer}>
                      <Ionicons name={item.icon as any} size={20} color="#1a1a1a" />
                    </View>
                    <Text variant="body" style={styles.menuItemText}>
                      {item.title}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.menuFooter}>
                <TouchableOpacity
                  style={styles.logoutButton}
                  onPress={handleLogout}
                  activeOpacity={0.7}
                  accessibilityLabel="Se déconnecter"
                  accessibilityRole="button"
                  accessibilityHint="Déconnecte l'utilisateur et retourne à l'écran de connexion"
                >
                  <Ionicons name="log-out-outline" size={20} color="#EF4444" />
                  <Text variant="body" style={styles.logoutText}>
                    Déconnexion
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  burgerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  modalContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
  },
  menuContainer: {
    width: width * 0.6,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 8,
  },
  menuContent: {
    flex: 1,
  },
  menuHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 16,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    minHeight: 90,
  },
  headerLeft: {
    flex: 1,
  },
  profileContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  avatarContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
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
    width: 57,
    height: 57,
    borderRadius: 28,
    flexShrink: 0,
  },
  nameContainer: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  userName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
    letterSpacing: -0.3,
  },
  lastName: {
    fontSize: 15,
    fontWeight: '500',
    color: '#6b7280',
    letterSpacing: -0.2,
  },
  closeButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 16,
    backgroundColor: '#f8f9fa',
  },
  menuItems: {
    flex: 1,
    paddingTop: 12,
    paddingBottom: 12,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingHorizontal: 20,
    gap: 16,
    marginHorizontal: 12,
    marginVertical: 2,
    borderRadius: 12,
  },
  menuItemIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#f8f9fa',
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuItemText: {
    flex: 1,
    fontSize: 16,
    color: '#1a1a1a',
    fontWeight: '500',
    letterSpacing: -0.2,
  },
  menuFooter: {
    padding: 20,
    paddingTop: 16,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#FEF2F2',
    marginHorizontal: 12,
  },
  logoutText: {
    fontSize: 15,
    color: '#EF4444',
    fontWeight: '600',
    letterSpacing: -0.2,
  },
});
