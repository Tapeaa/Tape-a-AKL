import React, { useEffect, useState, useRef } from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  StyleSheet, 
  Animated,
  Dimensions 
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { getSocket } from '@/lib/socket';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Helper pour récupérer le token de manière compatible
const getStoredToken = async (): Promise<string | null> => {
  try {
    if (Platform.OS === 'web') {
      return localStorage.getItem('activeOrderToken');
    }
    return await SecureStore.getItemAsync('activeOrderToken');
  } catch {
    return null;
  }
};

interface NotificationMessage {
  id: string;
  orderId: string;
  content: string;
  driverName: string;
  timestamp: number;
}

const { width } = Dimensions.get('window');

export default function MessageNotification() {
  const [notifications, setNotifications] = useState<NotificationMessage[]>([]);
  const router = useRouter();
  const slideAnims = useRef<Map<string, Animated.Value>>(new Map());

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    // Listen for chat notifications
    const handleNotification = (data: { 
      orderId: string; 
      message: { id: string; content: string; createdAt: string }; 
      driverName: string;
      fromDriver: boolean;
    }) => {
      if (!data.fromDriver) return; // Only show notifications from drivers
      
      const newNotif: NotificationMessage = {
        id: data.message.id,
        orderId: data.orderId,
        content: data.message.content,
        driverName: data.driverName,
        timestamp: Date.now(),
      };

      // Create animation for this notification
      const anim = new Animated.Value(-100);
      slideAnims.current.set(newNotif.id, anim);

      setNotifications(prev => {
        // Don't add duplicate notifications
        if (prev.some(n => n.id === newNotif.id)) return prev;
        return [...prev, newNotif];
      });

      // Animate in
      Animated.spring(anim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 50,
        friction: 8,
      }).start();

      // Auto-dismiss after 10 seconds
      setTimeout(() => {
        dismissNotification(newNotif.id);
      }, 10000);
    };

    // Use specific named handlers to avoid conflicts with chat.tsx listeners
    const handleChatMessage = (data: any) => {
      // Also listen for regular chat messages when not in chat screen
      if (data.message?.senderType === 'driver') {
        handleNotification({
          orderId: data.orderId,
          message: data.message,
          driverName: 'Chauffeur',
          fromDriver: true,
        });
      }
    };
    
    socket.on('chat:notification', handleNotification);
    socket.on('chat:message', handleChatMessage);

    return () => {
      // Only remove our specific handlers to not interfere with chat.tsx
      socket.off('chat:notification', handleNotification);
      socket.off('chat:message', handleChatMessage);
    };
  }, []);

  const dismissNotification = (id: string) => {
    const anim = slideAnims.current.get(id);
    if (anim) {
      Animated.timing(anim, {
        toValue: -100,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        setNotifications(prev => prev.filter(n => n.id !== id));
        slideAnims.current.delete(id);
      });
    } else {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }
  };

  const openChat = async (notification: NotificationMessage) => {
    dismissNotification(notification.id);
    
    // Get client token from storage
    const clientToken = await getStoredToken();
    
    router.push({
      pathname: '/(client)/ride/chat',
      params: {
        orderId: notification.orderId,
        driverName: notification.driverName,
        clientToken: clientToken || '',
      },
    });
  };

  if (notifications.length === 0) return null;

  return (
    <View style={styles.container} pointerEvents="box-none">
      {notifications.map((notif) => {
        const anim = slideAnims.current.get(notif.id) || new Animated.Value(0);
        
        return (
          <Animated.View 
            key={notif.id} 
            style={[
              styles.notification,
              { transform: [{ translateY: anim }] }
            ]}
          >
            <TouchableOpacity 
              style={styles.notificationContent}
              onPress={() => openChat(notif)}
              activeOpacity={0.9}
            >
              <View style={styles.iconContainer}>
                <Ionicons name="chatbubble-ellipses" size={24} color="#1a1a1a" />
              </View>
              <View style={styles.textContainer}>
                <Text style={styles.driverName} numberOfLines={1}>
                  {notif.driverName}
                </Text>
                <Text style={styles.messageText} numberOfLines={2}>
                  {notif.content}
                </Text>
              </View>
              <TouchableOpacity 
                style={styles.closeButton}
                onPress={() => dismissNotification(notif.id)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={18} color="#FFFFFF" />
              </TouchableOpacity>
            </TouchableOpacity>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    zIndex: 9999,
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  notification: {
    width: width - 24,
    marginBottom: 10,
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    shadowColor: '#F5C400',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#F5C400',
  },
  notificationContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 14,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F5C400',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#F5C400',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 6,
  },
  textContainer: {
    flex: 1,
  },
  driverName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F5C400',
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  messageText: {
    fontSize: 14,
    color: '#FFFFFF',
    lineHeight: 20,
    fontWeight: '500',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
