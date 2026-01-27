import { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Linking, Alert } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
// Composant Checkbox simple
const Checkbox = ({ checked, onValueChange }: { checked: boolean; onValueChange: (value: boolean) => void }) => (
  <TouchableOpacity
    onPress={() => onValueChange(!checked)}
    style={{
      width: 24,
      height: 24,
      borderWidth: 2,
      borderColor: checked ? '#F5C400' : '#D1D5DB',
      borderRadius: 4,
      backgroundColor: checked ? '#F5C400' : 'transparent',
      justifyContent: 'center',
      alignItems: 'center',
    }}
  >
    {checked && <Ionicons name="checkmark" size={16} color="#FFFFFF" />}
  </TouchableOpacity>
);
import { useAuth } from '@/lib/AuthContext';
import type { Client } from '@/lib/types';

// Versions des documents légaux
const LEGAL_VERSIONS = {
  CGU: '2026-01-21',
  PRIVACY_POLICY: '2026-01-21'
} as const;

export default function LegalScreen() {
  const router = useRouter();
  const { phone, type } = useLocalSearchParams<{
    phone: string;
    type: string;
  }>();
  const { client, setClientDirectly } = useAuth();
  const hasRedirectedRef = useRef(false);

  // Si l'utilisateur a déjà accepté les CGU, rediriger vers l'accueil
  useEffect(() => {
    if (hasRedirectedRef.current) return;
    
    if (client && client.cguAccepted === true) {
      console.log('[LEGAL] User has already accepted CGU, redirecting to home');
      hasRedirectedRef.current = true;
      router.replace('/(client)/' as any);
    }
  }, [client, router]);

  const [acceptCGU, setAcceptCGU] = useState(false);
  const [readPrivacyPolicy, setReadPrivacyPolicy] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleAcceptCGU = async () => {
    if (!acceptCGU) {
      Alert.alert('Erreur', 'Vous devez accepter les Conditions d\'utilisation pour continuer');
      return;
    }

    if (!readPrivacyPolicy) {
      Alert.alert('Erreur', 'Vous devez confirmer avoir pris connaissance de la Politique de confidentialité');
      return;
    }

    setIsLoading(true);

    try {
      // Sauvegarder les acceptations légales
      const legalData = {
        cguAccepted: true,
        cguAcceptedAt: new Date().toISOString(),
        cguVersion: LEGAL_VERSIONS.CGU,
        privacyPolicyRead: true,
        privacyPolicyReadAt: new Date().toISOString(),
        privacyPolicyVersion: LEGAL_VERSIONS.PRIVACY_POLICY
      };

      // Sauvegarder dans l'API backend
      try {
        const sessionId = await import('@/lib/api').then(api => api.getClientSessionId());
        if (sessionId) {
          await import('@/lib/api').then(api => api.apiPatch(`/api/clients/${client?.id}/legal`, legalData, {
            headers: { 'X-Client-Session': sessionId }
          }));
        }
        console.log('[LEGAL] Legal acceptances saved to API successfully');

        // Mettre à jour les données locales du client
        if (client) {
          const updatedClient: Client = {
            ...client,
            ...legalData
          };
          setClientDirectly(updatedClient);
          console.log('[LEGAL] Local client data updated');
        }
      } catch (apiError) {
        console.warn('[LEGAL] Could not save to API, but proceeding with local update:', apiError);

        // Même en cas d'erreur API, mettre à jour localement pour éviter la boucle
        if (client) {
          const updatedClient: Client = {
            ...client,
            ...legalData
          };
          setClientDirectly(updatedClient);
          console.log('[LEGAL] Local client data updated despite API error');
        }
      }

      // Rediriger vers l'accueil de l'app client
      router.replace('/(client)/' as any);
    } catch (error) {
      console.error('[LEGAL] Error saving legal acceptances:', error);
      Alert.alert('Erreur', 'Une erreur est survenue lors de la sauvegarde');
    } finally {
      setIsLoading(false);
    }
  };

  const openCGU = () => {
    router.push('/(auth)/cgu');
  };

  const openPrivacyPolicy = () => {
    const url = 'https://tape-a.com/politique-de-confidentialite-tapea/';
    Linking.openURL(url).catch(() => {
      Alert.alert('Erreur', 'Impossible d\'ouvrir la page web');
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
        </TouchableOpacity>

        <View style={styles.header}>
          <View style={styles.iconContainer}>
            <Ionicons name="shield-checkmark" size={48} color="#F5C400" />
          </View>
          <Text variant="h1" style={styles.title}>Conditions légales</Text>
          <Text variant="body" style={styles.subtitle}>
            Avant de continuer, veuillez prendre connaissance de nos documents légaux
          </Text>
        </View>

        <View style={styles.content}>
          {/* Case CGU obligatoire */}
          <View style={styles.legalSection}>
            <View style={styles.checkboxContainer}>
              <Checkbox
                checked={acceptCGU}
                onValueChange={setAcceptCGU}
              />
              <View style={styles.checkboxText}>
                <Text variant="body" style={styles.checkboxLabel}>
                  J'accepte les Conditions d'utilisation (CGU)
                </Text>
                <TouchableOpacity onPress={openCGU}>
                  <Text variant="caption" style={styles.link}>
                    Lire les CGU
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Case Politique de confidentialité */}
          <View style={styles.legalSection}>
            <View style={styles.checkboxContainer}>
              <Checkbox
                checked={readPrivacyPolicy}
                onValueChange={setReadPrivacyPolicy}
              />
              <View style={styles.checkboxText}>
                <Text variant="body" style={styles.checkboxLabel}>
                  J'ai pris connaissance de la Politique de confidentialité
                </Text>
                <TouchableOpacity onPress={openPrivacyPolicy}>
                  <Text variant="caption" style={styles.link}>
                    Lire la Politique de confidentialité
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <View style={styles.infoContainer}>
            <Ionicons name="information-circle" size={20} color="#6b7280" />
            <Text variant="caption" style={styles.infoText}>
              Ces informations sont nécessaires pour finaliser votre inscription et utiliser l'application.
            </Text>
          </View>

          <Button
            title="Finaliser mon inscription"
            onPress={handleAcceptCGU}
            loading={isLoading}
            disabled={!acceptCGU || !readPrivacyPolicy}
            fullWidth
            style={styles.button}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  backButton: {
    marginTop: 8,
    marginBottom: 24,
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#F5C40020',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    textAlign: 'center',
    color: '#6b7280',
    lineHeight: 20,
  },
  content: {
    gap: 24,
  },
  legalSection: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  checkboxText: {
    flex: 1,
  },
  checkboxLabel: {
    marginBottom: 4,
    lineHeight: 20,
  },
  link: {
    color: '#F5C400',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  infoContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    padding: 12,
  },
  infoText: {
    flex: 1,
    color: '#6b7280',
    lineHeight: 16,
  },
  button: {
    marginTop: 8,
  },
});