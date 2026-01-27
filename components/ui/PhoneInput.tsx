import { View, TextInput, Text, StyleSheet, ViewStyle } from 'react-native';
import { useState } from 'react';

interface PhoneInputProps {
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
  style?: ViewStyle;
}

export function PhoneInput({ value, onChangeText, error, style }: PhoneInputProps) {
  const [isFocused, setIsFocused] = useState(false);

  const handleChangeText = (text: string) => {
    const cleaned = text.replace(/\D/g, '');
    onChangeText(cleaned);
  };

  return (
    <View style={[styles.container, style]}>
      <Text style={styles.label}>Numéro de téléphone</Text>
      <View
        style={[
          styles.inputContainer,
          isFocused && styles.inputFocused,
          error && styles.inputError,
        ]}
      >
        <View style={styles.prefixContainer}>
          <Text style={styles.prefix}>+689</Text>
        </View>
        <TextInput
          style={styles.input}
          placeholder="XX XX XX"
          placeholderTextColor="#9ca3af"
          value={value}
          onChangeText={handleChangeText}
          keyboardType="phone-pad"
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          maxLength={8}
        />
      </View>
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    borderWidth: 2,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    overflow: 'hidden',
  },
  inputFocused: {
    borderColor: '#F5C400',
    backgroundColor: '#FFFFFF',
  },
  inputError: {
    borderColor: '#ef4444',
  },
  prefixContainer: {
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRightWidth: 1,
    borderRightColor: '#e5e7eb',
  },
  prefix: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  input: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1a1a1a',
  },
  errorText: {
    fontSize: 12,
    color: '#ef4444',
    marginTop: 4,
  },
});
