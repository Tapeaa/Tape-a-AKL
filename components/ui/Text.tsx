import { Text as RNText, StyleSheet, TextStyle } from 'react-native';
import { ReactNode } from 'react';

interface TextProps {
  children: ReactNode;
  variant?: 'h1' | 'h2' | 'h3' | 'body' | 'caption' | 'label';
  style?: TextStyle | TextStyle[];
  color?: string;
  numberOfLines?: number;
}

export function Text({
  children,
  variant = 'body',
  style,
  color,
  numberOfLines,
}: TextProps) {
  return (
    <RNText
      style={[styles[variant], color && { color }, style]}
      numberOfLines={numberOfLines}
    >
      {children}
    </RNText>
  );
}

const styles = StyleSheet.create({
  h1: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1a1a1a',
    lineHeight: 34,
  },
  h2: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1a1a1a',
    lineHeight: 30,
  },
  h3: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    lineHeight: 24,
  },
  body: {
    fontSize: 16,
    fontWeight: '400',
    color: '#1a1a1a',
    lineHeight: 24,
  },
  caption: {
    fontSize: 13,
    fontWeight: '400',
    color: '#6b7280',
    lineHeight: 18,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
    lineHeight: 20,
  },
});
