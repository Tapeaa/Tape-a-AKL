import React from 'react';
import {
  StripeProvider as RNStripeProvider,
  CardField as RNCardField,
  useStripe as useRNStripe,
  useConfirmSetupIntent as useRNConfirmSetupIntent,
} from '@stripe/stripe-react-native';
import Constants from 'expo-constants';

export const isStripeAvailable = true;

const stripePublishableKey = Constants.expoConfig?.extra?.stripePublishableKey || '';

export const StripeProvider = ({ children }: { children: React.ReactNode }) => {
  return (
    <RNStripeProvider publishableKey={stripePublishableKey}>
      <>{children}</>
    </RNStripeProvider>
  );
};

export const CardField = RNCardField;

export const useStripe = useRNStripe;

export const useConfirmSetupIntent = useRNConfirmSetupIntent;
