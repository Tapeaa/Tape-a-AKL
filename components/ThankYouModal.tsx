import { View, StyleSheet, Modal, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { downloadInvoicePDF } from '@/lib/pdf-download';
import { useState } from 'react';

interface ThankYouModalProps {
  visible: boolean;
  onClose: () => void;
  orderId?: string; // ID de la commande pour télécharger le reçu
}

export function ThankYouModal({ visible, onClose, orderId }: ThankYouModalProps) {
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownloadReceipt = async () => {
    if (!orderId) return;
    
    setIsDownloading(true);
    try {
      await downloadInvoicePDF(orderId);
    } catch (error) {
      console.error('[ThankYouModal] Erreur téléchargement reçu:', error);
    } finally {
      setIsDownloading(false);
    }
  };

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
            <View style={styles.iconContainer}>
              <Ionicons name="checkmark-circle" size={64} color="#22C55E" />
            </View>
            <Text variant="h1" style={styles.title}>
              Merci !
            </Text>
            <Text variant="body" style={styles.subtitle}>
              Votre course s'est bien déroulée. À bientôt !
            </Text>
          </View>

          {orderId && (
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

          <Button title="Retour à l'accueil" onPress={onClose} fullWidth />
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
    padding: 32,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  iconContainer: {
    marginBottom: 16,
  },
  title: {
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    textAlign: 'center',
    color: '#6b7280',
  },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
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
