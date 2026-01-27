import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { apiFetch, apiPost, setSupportLastSeenId } from '@/lib/api';

type SupportMessage = {
  id: string;
  content: string;
  isRead: boolean;
  createdAt: string;
  senderType: 'admin' | 'client' | 'driver';
  senderId?: string | null;
};

export default function SupportChatScreen() {
  const router = useRouter();
  const [supportMessages, setSupportMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<SupportMessage> | null>(null);

  const loadSupportMessages = useCallback(async () => {
    try {
      const data = await apiFetch<{ messages: SupportMessage[] }>('/api/messages/direct');
      const messages = data?.messages || [];
      setSupportMessages(messages);

      if (messages.some((msg) => !msg.isRead && msg.senderType === 'admin')) {
        await apiFetch('/api/messages/direct/read', { method: 'POST' });
        setSupportMessages((prev) =>
          prev.map((msg) =>
            msg.senderType === 'admin' ? { ...msg, isRead: true } : msg
          )
        );
      }
    } catch (error) {
      console.error('[SupportChat] Error loading messages:', error);
      setSupportMessages([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadSupportMessages();
      const interval = setInterval(loadSupportMessages, 10000);
      return () => clearInterval(interval);
    }, [loadSupportMessages])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadSupportMessages();
  }, [loadSupportMessages]);

  const sortedMessages = useMemo(
    () =>
      [...supportMessages].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      ),
    [supportMessages]
  );

  useEffect(() => {
    const latestAdminId = [...supportMessages].find((msg) => msg.senderType === 'admin')?.id;
    if (latestAdminId) {
      setSupportLastSeenId(latestAdminId).catch(() => {});
    }
  }, [supportMessages]);

  const scrollToBottom = useCallback((animated: boolean = true) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated });
    });
  }, []);

  useEffect(() => {
    if (sortedMessages.length > 0) {
      scrollToBottom(false);
    }
  }, [sortedMessages.length, scrollToBottom]);

  const handleSendMessage = async () => {
    const trimmed = messageInput.trim();
    if (!trimmed || sending) return;

    setSending(true);
    try {
      const response = await apiPost<{ message: SupportMessage }>(
        '/api/messages/direct/send',
        { content: trimmed }
      );
      if (response?.message) {
        setSupportMessages((prev) => [...prev, response.message]);
        scrollToBottom();
      } else {
        await loadSupportMessages();
      }
      setMessageInput('');
    } catch (error) {
      console.error('[SupportChat] Error sending message:', error);
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
        </TouchableOpacity>
        <Text variant="h2">Support</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {loading ? (
          <LoadingOverlay
            absolute
            title="Chargement du support..."
            subtitle="Récupération des messages"
          />
        ) : (
          <FlatList
            ref={listRef}
            data={sortedMessages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messagesContainer}
            onContentSizeChange={() => scrollToBottom(false)}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                colors={['#F5C400']}
                tintColor="#F5C400"
              />
            }
            ListEmptyComponent={
              <View style={styles.emptyMessages}>
                <Text style={styles.emptyTitle}>Aucun message</Text>
                <Text style={styles.emptySubtitle}>
                  Les messages du support apparaîtront ici.
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <View
                style={[
                  styles.messageRow,
                  item.senderType === 'admin' ? styles.messageLeft : styles.messageRight,
                ]}
              >
                <View
                  style={[
                    styles.messageBubble,
                    item.senderType === 'admin' ? styles.bubbleAdmin : styles.bubbleClient,
                  ]}
                >
                  <Text
                    style={
                      item.senderType === 'admin'
                        ? styles.messageTextAdmin
                        : styles.messageTextClient
                    }
                  >
                    {item.content}
                  </Text>
                  <Text
                    style={
                      item.senderType === 'admin'
                        ? styles.messageTimeAdmin
                        : styles.messageTimeClient
                    }
                  >
                    {new Date(item.createdAt).toLocaleTimeString('fr-FR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                </View>
              </View>
            )}
          />
        )}

        <View style={styles.inputContainer}>
          <TextInput
            value={messageInput}
            onChangeText={setMessageInput}
            placeholder="Écrivez votre message..."
            style={styles.input}
            multiline
          />
          <TouchableOpacity
            style={[styles.sendButton, sending && styles.sendButtonDisabled]}
            onPress={handleSendMessage}
            disabled={sending}
          >
            <Ionicons name="send" size={18} color="#1a1a1a" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F4F7',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  messagesContainer: {
    paddingBottom: 20,
    paddingTop: 6,
  },
  messageRow: {
    marginBottom: 10,
  },
  messageLeft: {
    alignItems: 'flex-start',
  },
  messageRight: {
    alignItems: 'flex-end',
  },
  messageBubble: {
    maxWidth: '80%',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 18,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  bubbleAdmin: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 6,
    borderWidth: 1,
    borderColor: '#F1E3A0',
  },
  bubbleClient: {
    backgroundColor: '#111827',
    borderTopRightRadius: 6,
  },
  messageTextAdmin: {
    fontSize: 14,
    color: '#1F2937',
  },
  messageTextClient: {
    fontSize: 14,
    color: '#FFFFFF',
  },
  messageTimeAdmin: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 6,
    textAlign: 'right',
  },
  messageTimeClient: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 6,
    textAlign: 'right',
  },
  emptyMessages: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    paddingTop: 8,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    color: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F5C400',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.6,
  },
});
