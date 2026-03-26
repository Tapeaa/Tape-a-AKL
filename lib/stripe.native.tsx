import React from 'react';
import { View, Text } from 'react-native';

// Stripe désactivé temporairement (plugin commenté dans app.config.js)
// Réactiver quand la configuration Apple Pay sera prête

export const isStripeAvailable = false;

export const StripeProvider = ({ children }: { children: React.ReactNode }) => {
  return <View style={{ flex: 1 }}>{children}</View>;
};

export const CardField = (props: any) => {
  return (
    <View style={[props.style, { backgroundColor: '#f3f4f6', padding: 16, borderRadius: 8 }]}>
      <Text style={{ color: '#6b7280' }}>Paiement par carte bientôt disponible</Text>
    </View>
  );
};

export const useStripe = () => {
  return {
    confirmPayment: async () => ({ error: { message: 'Non disponible' } }),
    createPaymentMethod: async () => ({ error: { message: 'Non disponible' } }),
  };
};

export const useConfirmSetupIntent = () => {
  return {
    confirmSetupIntent: async () => ({ error: { message: 'Non disponible' } }),
  };
};
