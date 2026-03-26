import React from 'react';
// Ce fichier ne devrait être chargé que sur les plateformes natives
// Si vous voyez cette erreur sur le web, c'est que le bundler charge ce fichier par erreur
// Utilisez maps.web.tsx ou maps.tsx à la place
import RNMapView, {
  Marker as RNMarker,
  Polyline as RNPolyline,
  PROVIDER_GOOGLE,
  MapViewProps,
  MapMarkerProps,
  PolylineProps,
} from 'react-native-maps';

export const isMapsAvailable = true;

export const MapView = React.forwardRef<RNMapView, MapViewProps>(
  (props, ref) => {
    return <RNMapView ref={ref} provider={PROVIDER_GOOGLE} {...props} />;
  }
);

export const Marker = (props: MapMarkerProps) => {
  return <RNMarker {...props} />;
};

export const Polyline = (props: PolylineProps) => {
  return <RNPolyline {...props} />;
};
