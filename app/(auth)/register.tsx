import { useState } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { Input } from '@/components/ui/Input';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { useAuth } from '@/lib/AuthContext';

export default function RegisterScreen() {
  const router = useRouter();
  const { register } = useAuth();
  const [phone, setPhone] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleRegister = async () => {
    if (!phone || !firstName || !lastName || !password || !confirmPassword) {
      setError('Veuillez remplir tous les champs');
      return;
    }

    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }

    if (password.length < 6) {
      setError('Le mot de passe doit contenir au moins 6 caractères');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const fullPhone = phone.startsWith('+689') ? phone : `+689${phone}`;
      console.log('[REGISTER SCREEN] Starting registration for:', fullPhone);
      
      const result = await register(fullPhone, firstName, lastName, password);
      
      console.log('[REGISTER SCREEN] Registration result:', {
        success: result.success,
        hasClient: !!result.client,
        error: result.error,
        devCode: result.devCode,
      });

      if (result.success) {
        console.log('[REGISTER SCREEN] ✅ Registration successful, redirecting to legal step');
        router.replace('/(auth)/legal');
      } else if (result.needsVerification) {
        // Redirection vers la page de vérification SMS
        console.log('[REGISTER SCREEN] ➡️ Needs verification, redirecting to verify screen');
        router.push({
          pathname: '/(auth)/verify',
          params: { 
            phone: result.phone || fullPhone, 
            type: 'registration', 
            ...(result.devCode && { devCode: result.devCode })
          },
        });
      } else {
        console.log('[REGISTER SCREEN] ❌ Registration failed:', result.error);
        setError(result.error || "Erreur d'inscription");
      }
    } catch (err) {
      console.error('[REGISTER SCREEN] Exception during registration:', err);
      const errorMessage = err instanceof Error ? err.message : 'Une erreur est survenue';
      setError(errorMessage);
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
            <Text variant="h1">Inscription</Text>
            <Text variant="body" style={styles.subtitle}>
              {"Créez votre compte TĀPE'A"}
            </Text>
          </View>

          <View style={styles.form}>
            <View style={styles.nameRow}>
              <View style={styles.nameInput}>
                <Input
                  label="Prénom"
                  placeholder="Prénom"
                  value={firstName}
                  onChangeText={setFirstName}
                />
              </View>
              <View style={styles.nameInput}>
                <Input
                  label="Nom"
                  placeholder="Nom"
                  value={lastName}
                  onChangeText={setLastName}
                />
              </View>
            </View>

            <PhoneInput
              value={phone}
              onChangeText={setPhone}
            />

            <Input
              label="Mot de passe"
              placeholder="Minimum 6 caractères"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            <Input
              label="Confirmer le mot de passe"
              placeholder="Confirmez votre mot de passe"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
            />

            {error ? (
              <Text variant="caption" style={styles.errorText}>
                {error}
              </Text>
            ) : null}

            <Button
              title={"S'inscrire"}
              onPress={handleRegister}
              loading={isLoading}
              disabled={isLoading}
              fullWidth
              style={styles.registerButton}
            />
          </View>

          <View style={styles.footer}>
            <Text variant="body" style={styles.footerText}>
              Déjà un compte ?{' '}
            </Text>
            <TouchableOpacity onPress={() => router.push('/(auth)/login')}>
              <Text variant="body" style={styles.linkText}>
                Se connecter
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
  nameRow: {
    flexDirection: 'row',
    gap: 12,
  },
  nameInput: {
    flex: 1,
  },
  errorText: {
    color: '#ef4444',
    textAlign: 'center',
  },
  registerButton: {
    marginTop: 8,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 'auto',
    paddingTop: 24,
  },
  footerText: {
    color: '#6b7280',
  },
  linkText: {
    color: '#F5C400',
    fontWeight: '600',
  },
});
