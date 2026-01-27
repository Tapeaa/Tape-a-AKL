import { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { Text } from '@/components/ui/Text';

type LoadingOverlayProps = {
  title?: string;
  subtitle?: string;
  absolute?: boolean;
};

export function LoadingOverlay({
  title = 'Chargement...',
  subtitle = 'Merci de patienter',
  absolute = false,
}: LoadingOverlayProps) {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1100,
        easing: Easing.inOut(Easing.linear),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);

  const rotation = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={[styles.overlay, absolute && styles.absolute]}>
      <View style={styles.card}>
        <View style={styles.ringWrap}>
          <Animated.View style={[styles.ring, { transform: [{ rotate: rotation }] }]} />
        </View>
        <Text variant="h3" style={styles.title}>
          {title}
        </Text>
        {!!subtitle && (
          <Text variant="caption" style={styles.subtitle}>
            {subtitle}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  absolute: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 8,
    width: '100%',
    maxWidth: 320,
  },
  ringWrap: {
    width: 72,
    height: 72,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  ring: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#F5C400',
    borderTopColor: '#E5E7EB',
  },
  title: {
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 6,
    textAlign: 'center',
    color: '#6B7280',
  },
});
