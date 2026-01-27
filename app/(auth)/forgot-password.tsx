import { useState } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { apiPost } from '@/lib/api';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    if (!phone) {
      setError('Veuillez entrer votre numéro de téléphone');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const fullPhone = phone.startsWith('+689') ? phone : `+689${phone}`;
      await apiPost('/api/auth/forgot-password', { phone: fullPhone }, { skipAuth: true });
      setSuccess(true);
      
      setTimeout(() => {
        router.push({
          pathname: '/(auth)/reset-password',
          params: { phone: fullPhone },
        });
      }, 1500);
    } catch (err) {
      setError((err as Error).message || 'Une erreur est survenue');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
          </TouchableOpacity>

          <View style={styles.header}>
            <Text variant="h1">Mot de passe oublié</Text>
            <Text variant="body" style={styles.subtitle}>
              Entrez votre numéro de téléphone pour recevoir un code de réinitialisation
            </Text>
          </View>

          <View style={styles.form}>
            <PhoneInput
              value={phone}
              onChangeText={setPhone}
              error={error && !phone ? 'Numéro requis' : undefined}
            />

            {error ? (
              <Text variant="caption" style={styles.errorText}>
                {error}
              </Text>
            ) : null}

            {success ? (
              <Text variant="caption" style={styles.successText}>
                Code envoyé ! Redirection...
              </Text>
            ) : null}

            <Button
              title="Envoyer le code"
              onPress={handleSubmit}
              loading={isLoading}
              disabled={isLoading || success}
              fullWidth
              style={styles.submitButton}
            />
          </View>

          <View style={styles.footer}>
            <TouchableOpacity onPress={() => router.push('/(auth)/login')}>
              <Text variant="body" style={styles.linkText}>
                Retour à la connexion
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  keyboardView: {
    flex: 1,
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
    marginBottom: 32,
  },
  subtitle: {
    color: '#6b7280',
    marginTop: 8,
  },
  form: {
    gap: 16,
  },
  errorText: {
    color: '#ef4444',
    textAlign: 'center',
  },
  successText: {
    color: '#22c55e',
    textAlign: 'center',
  },
  submitButton: {
    marginTop: 8,
  },
  footer: {
    alignItems: 'center',
    marginTop: 'auto',
    paddingTop: 24,
  },
  linkText: {
    color: '#F5C400',
    fontWeight: '600',
  },
});
