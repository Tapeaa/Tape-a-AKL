import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { apiFetch, apiPost, getClientSessionId } from '@/lib/api';
import { getSocket, isSocketConnected, joinRideRoom } from '@/lib/socket';

interface Message {
  id: string;
  orderId: string;
  senderId: string;
  senderType: 'client' | 'driver';
  content: string;
  isRead: boolean;
  createdAt: string;
}

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    orderId: string;
    driverName?: string;
    clientToken?: string;
    allOrderIds?: string; // JSON stringifié des orderIds pour l'historique complet
  }>();

  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const orderId = params.orderId;
  const driverName = params.driverName || 'Chauffeur';
  const clientToken = params.clientToken;
  
  // Parser les orderIds pour l'historique complet
  const allOrderIds = params.allOrderIds ? JSON.parse(params.allOrderIds) as string[] : [orderId];

  // Charger les messages de toutes les commandes avec ce chauffeur
  const loadMessages = useCallback(async () => {
    if (allOrderIds.length === 0) return;

    try {
      // Charger les messages de toutes les commandes en parallèle
      const allMessagesPromises = allOrderIds.map(async (oId) => {
        try {
          const data = await apiFetch<Message[]>(`/api/messages/order/${oId}/client`);
          return data || [];
        } catch (error) {
          console.error(`[Chat] Error loading messages for order ${oId}:`, error);
          return [];
        }
      });

      const allMessagesArrays = await Promise.all(allMessagesPromises);
      
      // Fusionner tous les messages et trier par date
      const mergedMessages = allMessagesArrays.flat();
      mergedMessages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      
      setMessages(mergedMessages);
    } catch (error) {
      console.error('[Chat] Error loading messages:', error);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(allOrderIds)]);

  // Rejoindre la room de la commande pour recevoir les messages
  useEffect(() => {
    if (!orderId || !clientToken) return;
    
    console.log('[Chat] Joining ride room for order:', orderId);
    joinRideRoom(orderId, 'client', { clientToken });
  }, [orderId, clientToken]);

  // Écouter les nouveaux messages via Socket.IO pour toutes les commandes
  useEffect(() => {
    if (allOrderIds.length === 0) return;

    const socket = getSocket();
    if (!socket) {
      console.log('[Chat] No socket available for listening to messages');
      return;
    }

    console.log('[Chat] Setting up chat:message and chat:error listeners for orders:', allOrderIds);

    const handleNewMessage = (data: { orderId: string; message: Message }) => {
      console.log('[Chat] Received chat:message event:', { orderId: data.orderId, messageId: data.message?.id });
      // Accepter les messages de toutes les commandes avec ce chauffeur
      if (allOrderIds.includes(data.orderId)) {
        setMessages(prev => {
          // Éviter les doublons
          if (prev.some(m => m.id === data.message.id)) return prev;
          console.log('[Chat] Adding new message to state');
          // Ajouter et re-trier par date
          const newMessages = [...prev, data.message];
          newMessages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
          return newMessages;
        });

        // Scroll vers le bas
        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        }, 100);
      }
    };

    const handleChatError = (data: { message: string }) => {
      console.log('[Chat] Received chat:error event:', data.message);
      Alert.alert('Erreur', data.message);
    };

    socket.on('chat:message', handleNewMessage);
    socket.on('chat:error', handleChatError);

    // Marquer les messages comme lus pour toutes les commandes
    if (clientToken && isSocketConnected()) {
      allOrderIds.forEach(oId => {
        socket.emit('chat:read', { orderId: oId, role: 'client', clientToken });
      });
    }

    return () => {
      socket.off('chat:message', handleNewMessage);
      socket.off('chat:error', handleChatError);
    };
  }, [JSON.stringify(allOrderIds), clientToken]);

  // Charger les messages au montage
  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // Scroll vers le bas quand les messages changent
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: false });
      }, 100);
    }
  }, [messages.length]);

  // Envoyer un message
  const sendMessage = async () => {
    console.log('[Chat] sendMessage called', { newMessage: newMessage.trim(), sending, orderId, clientToken: clientToken ? 'present' : 'missing' });
    
    if (!newMessage.trim() || sending || !orderId) {
      console.log('[Chat] sendMessage aborted - missing data');
      return;
    }

    const messageContent = newMessage.trim();
    setNewMessage('');
    setSending(true);

    try {
      const socket = getSocket();
      const socketConnected = isSocketConnected();
      const clientSessionId = await getClientSessionId();
      console.log('[Chat] Socket status:', { hasSocket: !!socket, socketConnected, hasClientToken: !!clientToken, hasSessionId: !!clientSessionId });
      
      // Envoyer via Socket.IO pour temps réel si connecté
      if (socket && socketConnected) {
        console.log('[Chat] Sending via Socket.IO...');
        socket.emit('chat:send:client', {
          orderId,
          clientToken: clientToken || '',
          clientSessionId: clientSessionId || undefined,
          content: messageContent,
        });
        console.log('[Chat] Message emitted via Socket.IO');
        // Attendre un peu et recharger les messages au cas où l'event ne revient pas
        setTimeout(() => loadMessages(), 1000);
      } else {
        // Fallback API HTTP
        console.log('[Chat] Sending via HTTP fallback...');
        await apiPost('/api/messages/send/client', {
          orderId,
          content: messageContent,
        });
        console.log('[Chat] Message sent via HTTP');
        // Recharger les messages
        await loadMessages();
      }
    } catch (error) {
      console.error('[Chat] Error sending message:', error);
      Alert.alert('Erreur', 'Impossible d\'envoyer le message');
      setNewMessage(messageContent); // Restaurer le message
    } finally {
      setSending(false);
    }
  };

  // Formater l'heure
  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };

  // Formater la date pour les séparateurs
  const formatDateSeparator = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return "Aujourd'hui";
    } else if (diffDays === 1) {
      return 'Hier';
    } else {
      return date.toLocaleDateString('fr-FR', { 
        weekday: 'long', 
        day: 'numeric', 
        month: 'long' 
      });
    }
  };

  // Obtenir la date (jour) d'un message
  const getMessageDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toDateString();
  };

  // Rendu d'un message avec séparateur de date si nécessaire
  const renderMessage = ({ item, index }: { item: Message; index: number }) => {
    const isMyMessage = item.senderType === 'client';
    const currentDate = getMessageDate(item.createdAt);
    const previousMessage = index > 0 ? messages[index - 1] : null;
    const previousDate = previousMessage ? getMessageDate(previousMessage.createdAt) : null;
    const showDateSeparator = currentDate !== previousDate;

    return (
      <View>
        {/* Séparateur de date */}
        {showDateSeparator && (
          <View style={styles.dateSeparator}>
            <View style={styles.dateLine} />
            <Text style={styles.dateText}>{formatDateSeparator(item.createdAt)}</Text>
            <View style={styles.dateLine} />
          </View>
        )}
        
        {/* Message */}
        <View style={[
          styles.messageContainer,
          isMyMessage ? styles.myMessageContainer : styles.otherMessageContainer
        ]}>
          <View style={[
            styles.messageBubble,
            isMyMessage ? styles.myMessageBubble : styles.otherMessageBubble
          ]}>
            <Text style={[
              styles.messageText,
              isMyMessage ? styles.myMessageText : styles.otherMessageText
            ]}>
              {item.content}
            </Text>
            <Text style={[
              styles.messageTime,
              isMyMessage ? styles.myMessageTime : styles.otherMessageTime
            ]}>
              {formatTime(item.createdAt)}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <LoadingOverlay
        title="Chargement de la conversation..."
        subtitle="Connexion en cours"
      />
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>{driverName}</Text>
          <Text style={styles.headerSubtitle}>
            {messages.length > 0 
              ? `${messages.length} message${messages.length > 1 ? 's' : ''}${allOrderIds.length > 1 ? ` • ${allOrderIds.length} courses` : ''}`
              : 'Commencer la discussion'}
          </Text>
        </View>
        <View style={styles.headerAvatar}>
          <Ionicons name="person" size={20} color="#FFFFFF" />
        </View>
      </View>

      {/* Messages */}
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {messages.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIcon}>
              <Ionicons name="chatbubbles-outline" size={48} color="#9CA3AF" />
            </View>
            <Text style={styles.emptyTitle}>Aucun message</Text>
            <Text style={styles.emptySubtitle}>
              Envoyez un message à votre chauffeur pour commencer la discussion
            </Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={renderMessage}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messagesList}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          />
        )}

        {/* Input */}
        <View style={styles.inputContainer}>
          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.input}
              placeholder="Écrire un message..."
              placeholderTextColor="#9CA3AF"
              value={newMessage}
              onChangeText={setNewMessage}
              multiline
              maxLength={1000}
              editable={!sending}
            />
          </View>
          <TouchableOpacity
            style={[
              styles.sendButton,
              (!newMessage.trim() || sending) && styles.sendButtonDisabled
            ]}
            onPress={sendMessage}
            disabled={!newMessage.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name="send" size={20} color="#FFFFFF" />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  headerInfo: {
    flex: 1,
    marginLeft: 8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F5C400',
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyboardAvoid: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
  },
  messagesList: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  dateSeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
    paddingHorizontal: 8,
  },
  dateLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E5E5',
  },
  dateText: {
    fontSize: 12,
    color: '#6B7280',
    marginHorizontal: 12,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  messageContainer: {
    marginBottom: 8,
  },
  myMessageContainer: {
    alignItems: 'flex-end',
  },
  otherMessageContainer: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
  },
  myMessageBubble: {
    backgroundColor: '#F5C400',
    borderBottomRightRadius: 4,
  },
  otherMessageBubble: {
    backgroundColor: '#FFFFFF',
    borderBottomLeftRadius: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20,
  },
  myMessageText: {
    color: '#1a1a1a',
  },
  otherMessageText: {
    color: '#1a1a1a',
  },
  messageTime: {
    fontSize: 11,
    marginTop: 4,
  },
  myMessageTime: {
    color: 'rgba(0, 0, 0, 0.5)',
    textAlign: 'right',
  },
  otherMessageTime: {
    color: '#9CA3AF',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
  },
  inputWrapper: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 10,
    maxHeight: 100,
  },
  input: {
    fontSize: 15,
    color: '#1a1a1a',
    maxHeight: 80,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F5C400',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#E5E5E5',
  },
});
