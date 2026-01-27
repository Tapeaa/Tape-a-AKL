import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';

const faqs = [
  {
    question: 'Comment réserver une course ?',
    answer: 'Depuis l\'écran d\'accueil, sélectionnez le type de course souhaité, entrez vos adresses de départ et d\'arrivée, puis confirmez votre commande.',
  },
  {
    question: 'Quels modes de paiement sont acceptés ?',
    answer: 'Nous acceptons le paiement en espèces et par carte bancaire (Visa, Mastercard).',
  },
  {
    question: 'Comment annuler une course ?',
    answer: 'Vous pouvez annuler une course depuis l\'écran de suivi tant que le chauffeur n\'est pas arrivé.',
  },
  {
    question: 'Comment contacter le support ?',
    answer: 'Rendez-vous dans la section Support de l\'application ou appelez notre service client.',
  },
];

export default function AideScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
        </TouchableOpacity>
        <Text variant="h2">Aide</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="h3" style={styles.sectionTitle}>
          Questions fréquentes
        </Text>

        {faqs.map((faq, index) => (
          <Card key={index} style={styles.faqCard}>
            <Text variant="label" style={styles.question}>
              {faq.question}
            </Text>
            <Text variant="body" style={styles.answer}>
              {faq.answer}
            </Text>
          </Card>
        ))}

        <TouchableOpacity
          style={styles.supportButton}
          onPress={() => router.push('/(client)/support')}
        >
          <Ionicons name="chatbubble" size={24} color="#F5C400" />
          <Text variant="label" style={styles.supportText}>
            Contacter le support
          </Text>
          <Ionicons name="chevron-forward" size={20} color="#6b7280" />
        </TouchableOpacity>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    gap: 12,
    paddingBottom: 32,
  },
  sectionTitle: {
    marginBottom: 4,
  },
  faqCard: {
    padding: 16,
  },
  question: {
    marginBottom: 8,
  },
  answer: {
    color: '#6b7280',
  },
  supportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    marginTop: 16,
    gap: 12,
  },
  supportText: {
    flex: 1,
  },
});
