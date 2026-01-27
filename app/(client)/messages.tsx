import { useState, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Swipeable } from 'react-native-gesture-handler';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { apiFetch, getDeletedConversationsMap, setDeletedConversationsMap } from '@/lib/api';

interface Conversation {
  orderId: string;
  otherPartyName: string;
  otherPartyType: 'client' | 'driver';
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  orderStatus: string;
  pickup: string;
  destination: string;
}

interface SupportMessage {
  id: string;
  content: string;
  isRead: boolean;
  createdAt: string;
  senderType: 'admin' | 'client' | 'driver';
  senderId?: string | null;
}

// Conversation groupée par chauffeur
interface GroupedConversation {
  driverName: string;
  lastMessage: string;
  lastMessageAt: string;
  totalUnreadCount: number;
  conversationCount: number;
  latestOrderId: string; // Pour ouvrir le chat le plus récent
  allOrderIds: string[]; // Tous les orderId avec ce chauffeur
}

export default function MessagesScreen() {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [groupedConversations, setGroupedConversations] = useState<GroupedConversation[]>([]);
  const [supportMessages, setSupportMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Grouper les conversations par chauffeur
  const groupByDriver = (convos: Conversation[]): GroupedConversation[] => {
    const grouped = new Map<string, GroupedConversation>();
    
    // Trier par date décroissante d'abord
    const sortedConvos = [...convos].sort((a, b) => 
      new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
    );
    
    for (const conv of sortedConvos) {
      const driverName = conv.otherPartyName;
      
      if (grouped.has(driverName)) {
        const existing = grouped.get(driverName)!;
        existing.totalUnreadCount += conv.unreadCount;
        existing.conversationCount += 1;
        existing.allOrderIds.push(conv.orderId);
        // Garder le message le plus récent
        if (new Date(conv.lastMessageAt) > new Date(existing.lastMessageAt)) {
          existing.lastMessage = conv.lastMessage;
          existing.lastMessageAt = conv.lastMessageAt;
          existing.latestOrderId = conv.orderId;
        }
      } else {
        grouped.set(driverName, {
          driverName,
          lastMessage: conv.lastMessage,
          lastMessageAt: conv.lastMessageAt,
          totalUnreadCount: conv.unreadCount,
          conversationCount: 1,
          latestOrderId: conv.orderId,
          allOrderIds: [conv.orderId],
        });
      }
    }
    
    // Convertir en array et trier par date du dernier message
    return Array.from(grouped.values()).sort((a, b) => 
      new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
    );
  };

  const loadConversations = useCallback(async () => {
    try {
      const data = await apiFetch<Conversation[]>('/api/messages/conversations/client');
      // Gérer le cas où l'API retourne null
      const convos = data || [];
      const deletedMap = await getDeletedConversationsMap();
      const cleanedMap = { ...deletedMap };

      const filteredConvos = convos.filter((conv) => {
        const deletedAt = cleanedMap[conv.orderId];
        if (!deletedAt) return true;
        const lastAt = new Date(conv.lastMessageAt).getTime();
        if (Number.isNaN(lastAt)) return false;
        if (lastAt > deletedAt) {
          delete cleanedMap[conv.orderId];
          return true;
        }
        return false;
      });

      if (JSON.stringify(cleanedMap) !== JSON.stringify(deletedMap)) {
        await setDeletedConversationsMap(cleanedMap);
      }

      setConversations(filteredConvos);
      setGroupedConversations(groupByDriver(filteredConvos));
    } catch (error) {
      console.error('[Messages] Error loading conversations:', error);
      setConversations([]);
      setGroupedConversations([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadSupportMessages = useCallback(async () => {
    try {
      const data = await apiFetch<{ messages: SupportMessage[] }>('/api/messages/direct');
      setSupportMessages(data?.messages || []);
    } catch (error) {
      console.error('[Messages] Error loading support messages:', error);
      setSupportMessages([]);
    }
  }, []);

  // Recharger à chaque visite de la page
  useFocusEffect(
    useCallback(() => {
      loadConversations();
      loadSupportMessages();
    }, [loadConversations, loadSupportMessages])
  );


  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadConversations();
    loadSupportMessages();
  }, [loadConversations, loadSupportMessages]);

  // Formater la date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Hier';
    } else if (diffDays < 7) {
      return date.toLocaleDateString('fr-FR', { weekday: 'short' });
    } else {
      return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    }
  };

  // Ouvrir une conversation groupée (ouvre l'historique complet avec ce chauffeur)
  const openGroupedConversation = (grouped: GroupedConversation) => {
    router.push({
      pathname: '/(client)/ride/chat',
      params: {
        orderId: grouped.latestOrderId,
        driverName: grouped.driverName,
        allOrderIds: JSON.stringify(grouped.allOrderIds),
      },
    });
  };

  const handleDeleteGroupedConversation = (grouped: GroupedConversation) => {
    Alert.alert(
      'Supprimer la conversation',
      'Voulez-vous supprimer toute cette conversation ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            try {
              await Promise.all(
                grouped.allOrderIds.map((orderId) =>
                  apiFetch(`/api/messages/conversations/client/${orderId}`, { method: 'DELETE' })
                )
              );
              const deletedMap = await getDeletedConversationsMap();
              const now = Date.now();
              grouped.allOrderIds.forEach((orderId) => {
                deletedMap[orderId] = now;
              });
              await setDeletedConversationsMap(deletedMap);
              setConversations((prev) => prev.filter((conv) => !grouped.allOrderIds.includes(conv.orderId)));
              setGroupedConversations((prev) =>
                prev.filter((item) => item.driverName !== grouped.driverName)
              );
            } catch (error) {
              console.error('[Messages] Error deleting conversation:', error);
            }
          },
        },
      ]
    );
  };

  const unreadSupportCount = useMemo(
    () => supportMessages.filter((msg) => !msg.isRead && msg.senderType === 'admin').length,
    [supportMessages]
  );

  const latestSupportMessage = useMemo(
    () => supportMessages.find((msg) => msg.senderType === 'admin') || supportMessages[0],
    [supportMessages]
  );

  const openSupportConversation = async () => {
    try {
      await apiFetch('/api/messages/direct/read', { method: 'POST' });
      setSupportMessages((prev) =>
        prev.map((msg) =>
          msg.senderType === 'admin' ? { ...msg, isRead: true } : msg
        )
      );
    } catch (error) {
      console.error('[Messages] Error marking support messages read:', error);
    } finally {
      router.push('/(client)/support-chat');
    }
  };

  // Rendu d'une conversation groupée par chauffeur
  const renderGroupedConversation = ({ item }: { item: GroupedConversation }) => {
    return (
      <Swipeable
        renderRightActions={() => (
          <TouchableOpacity
            style={styles.deleteAction}
            onPress={() => handleDeleteGroupedConversation(item)}
          >
            <Ionicons name="trash" size={18} color="#FFFFFF" />
            <Text style={styles.deleteActionText}>Supprimer</Text>
          </TouchableOpacity>
        )}
      >
        <TouchableOpacity onPress={() => openGroupedConversation(item)} activeOpacity={0.7}>
          <Card style={styles.conversationCard}>
            <View style={styles.conversationRow}>
            {/* Avatar */}
            <View style={styles.avatar}>
              <Ionicons name="person" size={24} color="#FFFFFF" />
            </View>

            {/* Contenu */}
            <View style={styles.conversationContent}>
              <View style={styles.conversationHeader}>
                <Text style={styles.driverName} numberOfLines={1}>
                  {item.driverName}
                </Text>
                <Text style={styles.messageDate}>{formatDate(item.lastMessageAt)}</Text>
              </View>

              <Text style={styles.lastMessage} numberOfLines={2}>
                {item.lastMessage}
              </Text>

              <View style={styles.conversationFooter}>
                <View style={styles.courseCountBadge}>
                  <Ionicons name="car" size={12} color="#6B7280" />
                  <Text style={styles.courseCountText}>
                    {item.conversationCount} course{item.conversationCount > 1 ? 's' : ''}
                  </Text>
                </View>
              </View>
            </View>

            {/* Badge non lu */}
            {item.totalUnreadCount > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadText}>
                  {item.totalUnreadCount > 99 ? '99+' : item.totalUnreadCount}
                </Text>
              </View>
            )}
            </View>
          </Card>
        </TouchableOpacity>
      </Swipeable>
    );
  };

  if (loading) {
    return (
      <LoadingOverlay
        title="Chargement des messages..."
        subtitle="Récupération des conversations"
      />
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
        </TouchableOpacity>
        <Text variant="h2">Messages</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.supportSection}>
        <TouchableOpacity onPress={openSupportConversation} activeOpacity={0.7}>
          <Card style={styles.supportCard}>
            <View style={styles.conversationRow}>
              <View style={styles.supportAvatar}>
                <Ionicons name="chatbubbles" size={22} color="#1a1a1a" />
              </View>
              <View style={styles.conversationContent}>
                <View style={styles.conversationHeader}>
                  <Text style={styles.driverName} numberOfLines={1}>
                    Support TĀPE'A
                  </Text>
                  {latestSupportMessage ? (
                    <Text style={styles.messageDate}>
                      {formatDate(latestSupportMessage.createdAt)}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.supportCaption}>
                  Service de contact en ligne
                </Text>
                <Text style={styles.lastMessage} numberOfLines={2}>
                  {latestSupportMessage
                    ? latestSupportMessage.content
                    : "Aucun message du support pour le moment"}
                </Text>
              </View>
              {unreadSupportCount > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadText}>
                    {unreadSupportCount > 99 ? '99+' : unreadSupportCount}
                  </Text>
                </View>
              )}
            </View>
          </Card>
        </TouchableOpacity>
      </View>

      {groupedConversations.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIcon}>
            <Ionicons name="chatbubbles-outline" size={64} color="#D1D5DB" />
          </View>
          <Text style={styles.emptyTitle}>Aucune conversation</Text>
          <Text style={styles.emptySubtitle}>
            Vos conversations avec les chauffeurs apparaîtront ici
          </Text>
        </View>
      ) : (
        <FlatList
          data={groupedConversations}
          renderItem={renderGroupedConversation}
          keyExtractor={(item) => item.driverName}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={['#F5C400']}
              tintColor="#F5C400"
            />
          }
        />
      )}
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
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  supportSection: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  supportCard: {
    marginBottom: 6,
    padding: 14,
    borderWidth: 1,
    borderColor: '#FCE588',
    backgroundColor: '#FFFDF4',
  },
  supportAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#F5C400',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  emptyIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
  },
  listContent: {
    padding: 16,
  },
  conversationCard: {
    marginBottom: 12,
    padding: 14,
  },
  conversationRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#F5C400',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  conversationContent: {
    flex: 1,
  },
  conversationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  driverName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    flex: 1,
    marginRight: 8,
  },
  messageDate: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  supportCaption: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 6,
  },
  lastMessage: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 8,
  },
  conversationFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  courseCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  courseCountText: {
    fontSize: 12,
    color: '#6B7280',
    marginLeft: 5,
    fontWeight: '500',
  },
  unreadBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#F5C400',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  unreadText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  deleteAction: {
    width: 96,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginVertical: 6,
    borderRadius: 12,
  },
  deleteActionText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
