import React from 'react';
import { Modal, View, StyleSheet, TouchableOpacity, Linking, Platform, Image } from 'react-native';
import { Text } from '@/components/ui/Text';
import { Ionicons } from '@expo/vector-icons';

interface UpdateRequiredModalProps {
  visible: boolean;
  message: string;
  storeUrl: string;
}

export function UpdateRequiredModal({ visible, message, storeUrl }: UpdateRequiredModalProps) {
  const handleUpdate = () => {
    Linking.openURL(storeUrl).catch((err) => {
      console.error('Erreur ouverture store:', err);
    });
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      statusBarTranslucent={true}
    >
      <View style={styles.overlay}>
        <View style={styles.modal}>
          {/* Icône */}
          <View style={styles.iconContainer}>
            <Ionicons name="cloud-download-outline" size={48} color="#F5C400" />
          </View>

          {/* Titre */}
          <Text style={styles.title}>Mise à jour requise</Text>

          {/* Message */}
          <Text style={styles.message}>{message}</Text>

          {/* Badge de version */}
          <View style={styles.versionBadge}>
            <Ionicons name="sparkles" size={16} color="#F5C400" />
            <Text style={styles.versionText}>Nouvelle version disponible</Text>
          </View>

          {/* Bouton de mise à jour */}
          <TouchableOpacity style={styles.updateButton} onPress={handleUpdate}>
            <Ionicons name="download-outline" size={20} color="#1a1a1a" />
            <Text style={styles.updateButtonText}>
              Mettre à jour sur l'App Store
            </Text>
          </TouchableOpacity>

          {/* Note */}
          <Text style={styles.note}>
            Cette mise à jour est obligatoire pour continuer à utiliser l'application.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modal: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 32,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  iconContainer: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#FFF9E6',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  versionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF9E6',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginBottom: 24,
    gap: 8,
  },
  versionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#B8860B',
  },
  updateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5C400',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 14,
    width: '100%',
    gap: 10,
    shadowColor: '#F5C400',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  updateButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  note: {
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 18,
  },
});
