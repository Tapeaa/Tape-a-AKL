import React, { useRef, useEffect } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { Image } from 'expo-image';

interface DriverCarIconProps {
  size?: number;
  rotation?: number;
}

// Calcule le chemin le plus court entre deux angles (évite de tourner de 350° quand on peut tourner de 10°)
function getShortestRotation(from: number, to: number): number {
  const diff = ((to - from + 180) % 360) - 180;
  return from + diff;
}

export function DriverCarIcon({ size = 48, rotation = 0 }: DriverCarIconProps) {
  // L'image pointe vers le HAUT par défaut (l'avant du véhicule est en haut)
  const targetRotation = rotation;
  
  // Animated value pour la rotation fluide
  const animatedRotation = useRef(new Animated.Value(targetRotation)).current;
  const lastRotation = useRef(targetRotation);
  
  useEffect(() => {
    // Calcule le chemin le plus court pour éviter les rotations de 270° quand 90° suffit
    const shortestTarget = getShortestRotation(lastRotation.current, targetRotation);
    
    // Animation fluide vers la nouvelle rotation
    Animated.timing(animatedRotation, {
      toValue: shortestTarget,
      duration: 500, // 500ms pour une transition douce
      easing: Easing.out(Easing.cubic), // Easing naturel
      useNativeDriver: true,
    }).start(() => {
      // Normalise l'angle après l'animation (garde entre 0 et 360)
      const normalized = ((shortestTarget % 360) + 360) % 360;
      animatedRotation.setValue(normalized);
      lastRotation.current = normalized;
    });
  }, [targetRotation]);
  
  // Interpolation pour convertir le nombre en string "Xdeg"
  const rotateInterpolation = animatedRotation.interpolate({
    inputRange: [-360, 0, 360, 720],
    outputRange: ['-360deg', '0deg', '360deg', '720deg'],
  });
  
  return (
    <Animated.View
      style={[
        styles.container,
        { width: size, height: size },
        { transform: [{ rotate: rotateInterpolation }] },
      ]}
    >
      <Image
        source={require('@/assets/images/voiture.png')}
        style={{ width: size, height: size }}
        contentFit="contain"
        cachePolicy="memory"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
