import React from 'react';
import { View, Text } from 'react-native';

export const isMapsAvailable = false;

export const MapView = React.forwardRef<View, { style?: any; children?: React.ReactNode }>(
  ({ style, children }, ref) => (
    <View ref={ref} style={[style, { backgroundColor: '#e5e7eb', justifyContent: 'center', alignItems: 'center', minHeight: 200 }]}>
      <Text style={{ color: '#6b7280', fontSize: 14 }}>Carte disponible sur mobile uniquement</Text>
      {children}
    </View>
  )
);

export const Marker = () => null;

export const Polyline = () => null;
