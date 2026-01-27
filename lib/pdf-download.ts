import { Platform, Linking, Alert } from 'react-native';
import { API_URL } from './api';

// Imports conditionnels pour expo-file-system (legacy API) et expo-sharing
let FileSystem: any = null;
let Sharing: any = null;

try {
  // Utiliser l'API legacy pour expo-file-system (compatible avec la nouvelle version)
  FileSystem = require('expo-file-system/legacy');
  Sharing = require('expo-sharing');
} catch (e) {
  // Fallback sur l'ancien import si legacy n'existe pas
  try {
    FileSystem = require('expo-file-system');
    Sharing = require('expo-sharing');
  } catch (e2) {
    console.warn('[PDF] expo-file-system ou expo-sharing non installés, mode web uniquement');
  }
}

/**
 * Télécharge le PDF de facture/reçu pour une commande
 * @param orderId ID de la commande
 * @returns Promise<boolean> true si le téléchargement a réussi
 */
export async function downloadInvoicePDF(orderId: string): Promise<boolean> {
  try {
    // Construire l'URL en évitant la duplication du préfixe /api (même logique que apiFetch)
    const endpoint = `/api/invoices/${orderId}/pdf`;
    const url = endpoint.startsWith('/api') && API_URL.endsWith('/api')
      ? `${API_URL}${endpoint.replace(/^\/api/, '')}`
      : `${API_URL}${endpoint}`;
    
    console.log('[PDF] Téléchargement du reçu pour la commande:', orderId);
    console.log('[PDF] URL construite:', url);
    
    if (Platform.OS === 'web') {
      // Sur le web, ouvrir le PDF dans un nouvel onglet
      if (typeof window !== 'undefined') {
        window.open(url, '_blank');
      }
      return true;
    }

    // Sur mobile, vérifier si expo-file-system est disponible
    if (!FileSystem || !Sharing) {
      // Fallback : ouvrir directement l'URL (le navigateur gérera le téléchargement)
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
        return true;
      } else {
        throw new Error('Impossible d\'ouvrir le PDF. Installez expo-file-system et expo-sharing.');
      }
    }

    // Sur mobile, télécharger le PDF et le partager
    const fileUri = `${FileSystem.documentDirectory}facture-${orderId}.pdf`;
    
    // Télécharger le fichier
    const downloadResult = await FileSystem.downloadAsync(url, fileUri);
    
    if (downloadResult.status !== 200) {
      throw new Error(`Erreur HTTP: ${downloadResult.status}`);
    }

    // Vérifier si le partage est disponible
    const isAvailable = await Sharing.isAvailableAsync();
    
    if (isAvailable) {
      // Partager/ouvrir le PDF
      await Sharing.shareAsync(downloadResult.uri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Télécharger votre reçu',
      });
    } else {
      // Si le partage n'est pas disponible, essayer d'ouvrir avec Linking
      const canOpen = await Linking.canOpenURL(downloadResult.uri);
      if (canOpen) {
        await Linking.openURL(downloadResult.uri);
      } else {
        Alert.alert(
          'Reçu téléchargé',
          `Votre reçu a été téléchargé dans: ${downloadResult.uri}`,
          [{ text: 'OK' }]
        );
      }
    }

    return true;
  } catch (error: any) {
    console.error('[PDF] Erreur lors du téléchargement:', error);
    Alert.alert(
      'Erreur',
      'Impossible de télécharger le reçu. Veuillez réessayer plus tard.',
      [{ text: 'OK' }]
    );
    return false;
  }
}
