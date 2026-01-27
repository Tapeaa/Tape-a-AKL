import React from 'react';
import { View, Text, ViewProps } from 'react-native';

export const isMapsAvailable = false;

// Types pour les fallbacks web - acceptent toutes les props de react-native-maps
interface MapViewProps extends ViewProps {
  initialRegion?: {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  };
  region?: any;
  showsUserLocation?: boolean;
  showsMyLocationButton?: boolean;
  toolbarEnabled?: boolean;
  onRegionChange?: any;
  onRegionChangeComplete?: any;
  onPanDrag?: any;
  onTouchStart?: any;
  onTouchEnd?: any;
  children?: React.ReactNode;
  [key: string]: any; // Allow any additional props
}

interface MarkerProps {
  coordinate: { latitude: number; longitude: number };
  anchor?: { x: number; y: number };
  centerOffset?: { x: number; y: number };
  children?: React.ReactNode;
  title?: string;
  description?: string;
  onPress?: () => void;
  tracksViewChanges?: boolean;
  zIndex?: number;
  [key: string]: any; // Allow any additional props
}

interface PolylineProps {
  coordinates: Array<{ latitude: number; longitude: number }>;
  strokeColor?: string;
  strokeWidth?: number;
  lineCap?: 'butt' | 'round' | 'square' | string;
  lineJoin?: 'miter' | 'round' | 'bevel' | string;
  geodesic?: boolean;
  lineDashPattern?: number[];
  tracksViewChanges?: boolean;
  [key: string]: any; // Allow any additional props
}

export const MapView = React.forwardRef<any, MapViewProps>(
  ({ style, children, ...rest }, ref) => (
    <View ref={ref} style={[style, { backgroundColor: '#e5e7eb', justifyContent: 'center', alignItems: 'center' }]}>
      <Text style={{ color: '#6b7280', fontSize: 14 }}>Carte disponible sur mobile uniquement</Text>
      {children}
    </View>
  )
);

export const Marker: React.FC<MarkerProps> = ({ children }) => null;

export const Polyline: React.FC<PolylineProps> = () => null;
