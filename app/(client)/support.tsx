import { View, StyleSheet, TouchableOpacity, Linking, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';

export default function SupportScreen() {
  const router = useRouter();

  const handleCall = () => {
    Linking.openURL('tel:+68987759897');
  };

  const handleEmail = () => {
    Linking.openURL('mailto:Tapea.pf@gmail.com');
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

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="h3" style={styles.title}>
          Comment pouvons-nous vous aider ?
        </Text>
        <Text variant="body" style={styles.subtitle}>
          Notre équipe vous répond du lundi au samedi de 6h à 22h.
        </Text>
        <Text style={styles.noticeText}>
          Service de contact en ligne pour toute aide ou information.
        </Text>

        <View style={styles.contactOptions}>
          <TouchableOpacity onPress={handleCall}>
            <Card style={styles.contactCard}>
              <View style={styles.contactIcon}>
                <Ionicons name="call" size={28} color="#F5C400" />
              </View>
              <Text variant="label">Nous appeler</Text>
              <Text variant="caption">+689 87 75 98 97</Text>
            </Card>
          </TouchableOpacity>

          <TouchableOpacity onPress={handleEmail}>
            <Card style={styles.contactCard}>
              <View style={styles.contactIcon}>
                <Ionicons name="mail" size={28} color="#F5C400" />
              </View>
              <Text variant="label">Email</Text>
              <Text variant="caption">Tapea.pf@gmail.com</Text>
            </Card>
          </TouchableOpacity>
        </View>

        <Card style={styles.chatCard}>
          <View style={styles.chatHeader}>
            <Ionicons name="chatbubbles" size={22} color="#1a1a1a" />
            <Text variant="label">Ou sinon contactez-nous depuis l'app !</Text>
          </View>
          <Text variant="caption" style={styles.chatSubtitle}>
            Ouvrez la discussion support pour échanger en direct.
          </Text>
          <TouchableOpacity
            onPress={() => router.push('/(client)/support-chat')}
            style={styles.chatButton}
          >
            <Text style={styles.chatButtonText}>Accéder au chat support</Text>
          </TouchableOpacity>
        </Card>

        <Card style={styles.infoCard}>
          <Ionicons name="information-circle" size={24} color="#3B82F6" />
          <View style={styles.infoContent}>
            <Text variant="label">Temps de réponse</Text>
            <Text variant="caption">
              Nous nous efforçons de répondre à toutes les demandes dans un délai de 24 heures.
            </Text>
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    alignItems: 'center',
    paddingBottom: 32,
  },
  title: {
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    color: '#6b7280',
    marginBottom: 32,
    textAlign: 'center',
  },
  noticeText: {
    color: '#6b7280',
    marginBottom: 24,
    textAlign: 'center',
  },
  contactOptions: {
    width: '100%',
    flexDirection: 'column',
    gap: 14,
    marginBottom: 24,
  },
  contactCard: {
    width: '100%',
    paddingVertical: 16,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  contactIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  infoCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    backgroundColor: '#EFF6FF',
  },
  chatCard: {
    width: '100%',
    padding: 16,
    marginBottom: 20,
    backgroundColor: '#FFF7DA',
    borderWidth: 1,
    borderColor: '#F5E3A0',
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  chatSubtitle: {
    color: '#6b7280',
    marginBottom: 12,
  },
  chatButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  chatButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  infoContent: {
    flex: 1,
  },
});
