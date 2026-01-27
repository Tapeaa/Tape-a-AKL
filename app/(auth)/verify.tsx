import { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/lib/AuthContext';
import { apiPost } from '@/lib/api';

export default function VerifyScreen() {
  const router = useRouter();
  const { phone, type, devCode } = useLocalSearchParams<{
    phone: string;
    type: string;
    devCode?: string;
  }>();
  const { verify } = useAuth();
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(60);
  const inputRefs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleCodeChange = (value: string, index: number) => {
    if (value.length > 1) {
      const digits = value.split('').slice(0, 6);
      const newCode = [...code];
      digits.forEach((digit, i) => {
        if (index + i < 6) {
          newCode[index + i] = digit;
        }
      });
      setCode(newCode);
      const nextIndex = Math.min(index + digits.length, 5);
      inputRefs.current[nextIndex]?.focus();
    } else {
      const newCode = [...code];
      newCode[index] = value;
      setCode(newCode);

      if (value && index < 5) {
        inputRefs.current[index + 1]?.focus();
      }
    }
  };

  const handleKeyPress = (key: string, index: number) => {
    if (key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    const fullCode = code.join('');
    if (fullCode.length !== 6) {
      setError('Veuillez entrer le code à 6 chiffres');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const result = await verify(phone || '', fullCode, type || 'registration');

      if (result.success) {
        // Rediriger vers l'étape légale avant l'accueil
        router.replace({
          pathname: '/(auth)/legal',
          params: { phone, type }
        });
      } else {
        // Code incorrect - afficher l'erreur sans log console.error
        setError(result.error || 'Code invalide. Veuillez réessayer.');
        // Réinitialiser les champs pour permettre une nouvelle tentative
        setCode(['', '', '', '', '', '']);
        inputRefs.current[0]?.focus();
      }
    } catch (err) {
      // Erreur réseau ou autre - gérer silencieusement
      setError('Une erreur est survenue. Veuillez réessayer.');
      // Réinitialiser les champs pour permettre une nouvelle tentative
      setCode(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (countdown > 0) return;

    try {
      await apiPost('/api/auth/resend-code', { phone, type }, { skipAuth: true });
      setCountdown(60);
      setError('');
    } catch (err) {
      setError('Impossible de renvoyer le code');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => router.back()}
      >
        <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
      </TouchableOpacity>

      <View style={styles.content}>
        <View style={styles.header}>
          <Text variant="h1">Vérification</Text>
          <Text variant="body" style={styles.subtitle}>
            Entrez le code à 6 chiffres envoyé au {phone}
          </Text>
          {devCode ? (
            <View style={styles.devCodeContainer}>
              <Text variant="caption" style={styles.devCodeLabel}>
                Code de développement:
              </Text>
              <Text variant="h2" style={styles.devCode}>
                {devCode}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.codeContainer}>
          {code.map((digit, index) => (
            <TextInput
              key={index}
              ref={(ref) => (inputRefs.current[index] = ref)}
              style={[
                styles.codeInput,
                digit ? styles.codeInputFilled : null,
                error ? styles.codeInputError : null,
              ]}
              value={digit}
              onChangeText={(value) => handleCodeChange(value, index)}
              onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, index)}
              keyboardType="number-pad"
              maxLength={6}
              selectTextOnFocus
            />
          ))}
        </View>

        {error ? (
          <Text variant="caption" style={styles.errorText}>
            {error}
          </Text>
        ) : null}

        <Button
          title="Vérifier"
          onPress={handleVerify}
          loading={isLoading}
          disabled={isLoading || code.some((d) => !d)}
          fullWidth
          style={styles.verifyButton}
        />

        <TouchableOpacity
          onPress={handleResendCode}
          disabled={countdown > 0}
          style={styles.resendButton}
        >
          <Text
            variant="body"
            style={[
              styles.resendText,
              countdown > 0 ? styles.resendTextDisabled : null,
            ]}
          >
            {countdown > 0
              ? `Renvoyer le code dans ${countdown}s`
              : 'Renvoyer le code'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  backButton: {
    marginTop: 8,
    marginLeft: 24,
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
  },
  header: {
    marginBottom: 40,
  },
  subtitle: {
    color: '#6b7280',
    marginTop: 8,
  },
  devCodeContainer: {
    backgroundColor: '#FEF3C7',
    padding: 16,
    borderRadius: 12,
    marginTop: 16,
    alignItems: 'center',
  },
  devCodeLabel: {
    color: '#92400E',
  },
  devCode: {
    color: '#92400E',
    marginTop: 4,
    letterSpacing: 4,
  },
  codeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
    gap: 8,
  },
  codeInput: {
    flex: 1,
    height: 56,
    borderWidth: 2,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    color: '#1a1a1a',
  },
  codeInputFilled: {
    borderColor: '#F5C400',
  },
  codeInputError: {
    borderColor: '#ef4444',
  },
  errorText: {
    color: '#ef4444',
    textAlign: 'center',
    marginBottom: 16,
  },
  verifyButton: {
    marginTop: 8,
  },
  resendButton: {
    alignItems: 'center',
    marginTop: 24,
  },
  resendText: {
    color: '#F5C400',
  },
  resendTextDisabled: {
    color: '#6b7280',
  },
});
