import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';

export default function CGUScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
        </TouchableOpacity>
        <Text variant="h2" style={styles.title}>Conditions d'utilisation</Text>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
        <Text variant="h1" style={styles.mainTitle}>Conditions Générales d'Utilisation</Text>
        <Text variant="caption" style={styles.version}>Version 2026-01-21</Text>

        <View style={styles.section}>
          <Text variant="h2" style={styles.sectionTitle}>1. Objet</Text>
          <Text variant="body" style={styles.text}>
            Les présentes Conditions Générales d'Utilisation (CGU) régissent l'utilisation de l'application TĀPE'A,
            plateforme de mise en relation entre passagers et conducteurs de taxi.
          </Text>
        </View>

        <View style={styles.section}>
          <Text variant="h2" style={styles.sectionTitle}>2. Description du service</Text>
          <Text variant="body" style={styles.text}>
            TĀPE'A permet aux utilisateurs de :
          </Text>
          <Text variant="body" style={styles.listItem}>• Réserver des courses de taxi</Text>
          <Text variant="body" style={styles.listItem}>• Effectuer des réservations à l'avance</Text>
          <Text variant="body" style={styles.listItem}>• Suivre leurs courses en temps réel</Text>
          <Text variant="body" style={styles.listItem}>• Payer leurs courses de manière sécurisée</Text>
        </View>

        <View style={styles.section}>
          <Text variant="h2" style={styles.sectionTitle}>3. Conditions d'utilisation</Text>
          <Text variant="body" style={styles.subTitle}>3.1 Pour les passagers</Text>
          <Text variant="body" style={styles.text}>
            Les passagers s'engagent à :
          </Text>
          <Text variant="body" style={styles.listItem}>• Fournir des informations exactes</Text>
          <Text variant="body" style={styles.listItem}>• Respecter les conducteurs et autres passagers</Text>
          <Text variant="body" style={styles.listItem}>• Ne pas utiliser le service à des fins illégales</Text>

          <Text variant="body" style={styles.subTitle}>3.2 Pour les conducteurs</Text>
          <Text variant="body" style={styles.text}>
            Les conducteurs s'engagent à :
          </Text>
          <Text variant="body" style={styles.listItem}>• Posséder un permis de conduire valide</Text>
          <Text variant="body" style={styles.listItem}>• Maintenir leur véhicule en bon état</Text>
          <Text variant="body" style={styles.listItem}>• Respecter le code de la route</Text>
          <Text variant="body" style={styles.listItem}>• Traiter les passagers avec respect</Text>
        </View>

        <View style={styles.section}>
          <Text variant="h2" style={styles.sectionTitle}>4. Tarifs et paiements</Text>
          <Text variant="body" style={styles.text}>
            Les tarifs sont calculés selon :
          </Text>
          <Text variant="body" style={styles.listItem}>• Une prise en charge fixe</Text>
          <Text variant="body" style={styles.listItem}>• Un tarif au kilomètre (jour/nuit)</Text>
          <Text variant="body" style={styles.listItem}>• Des suppléments pour services particuliers</Text>
          <Text variant="body" style={styles.text}>
            Le paiement s'effectue à la fin de la course via l'application.
          </Text>
        </View>

        <View style={styles.section}>
          <Text variant="h2" style={styles.sectionTitle}>5. Annulations et remboursements</Text>
          <Text variant="body" style={styles.text}>
            • Annulation gratuite dans les 2 minutes suivant l'acceptation
          </Text>
          <Text variant="body" style={styles.text}>
            • Frais d'annulation tardive : 50% du tarif estimé
          </Text>
          <Text variant="body" style={styles.text}>
            • Remboursement selon conditions spécifiques
          </Text>
        </View>

        <View style={styles.section}>
          <Text variant="h2" style={styles.sectionTitle}>6. Responsabilités</Text>
          <Text variant="body" style={styles.text}>
            TĀPE'A n'est pas responsable :
          </Text>
          <Text variant="body" style={styles.listItem}>• Des retards dus aux conditions de circulation</Text>
          <Text variant="body" style={styles.listItem}>• Des objets oubliés dans les véhicules</Text>
          <Text variant="body" style={styles.listItem}>• Du comportement des conducteurs ou passagers</Text>
          <Text variant="body" style={styles.listItem}>• Des problèmes techniques indépendants de notre volonté</Text>
        </View>

        <View style={styles.section}>
          <Text variant="h2" style={styles.sectionTitle}>7. Sécurité et assurance</Text>
          <Text variant="body" style={styles.text}>
            • Les conducteurs sont vérifiés
          </Text>
          <Text variant="body" style={styles.text}>
            • Couverture assurance pendant les courses
          </Text>
          <Text variant="body" style={styles.text}>
            • Signalement possible des incidents
          </Text>
        </View>

        <View style={styles.section}>
          <Text variant="h2" style={styles.sectionTitle}>8. Résiliation</Text>
          <Text variant="body" style={styles.text}>
            Les utilisateurs peuvent résilier leur compte à tout moment.
            TĀPE'A se réserve le droit de suspendre ou résilier un compte en cas de violation des CGU.
          </Text>
        </View>

        <View style={styles.section}>
          <Text variant="h2" style={styles.sectionTitle}>9. Droit applicable</Text>
          <Text variant="body" style={styles.text}>
            Les présentes CGU sont soumises au droit français.
            Tout litige sera porté devant les tribunaux compétents.
          </Text>
        </View>

        <View style={styles.section}>
          <Text variant="h2" style={styles.sectionTitle}>10. Modification des CGU</Text>
          <Text variant="body" style={styles.text}>
            TĀPE'A se réserve le droit de modifier les CGU.
            Les utilisateurs seront informés des modifications importantes.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backButton: {
    marginRight: 16,
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  title: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingVertical: 20,
    paddingBottom: 40,
  },
  mainTitle: {
    textAlign: 'center',
    marginBottom: 4,
  },
  version: {
    textAlign: 'center',
    color: '#6b7280',
    marginBottom: 32,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    color: '#1a1a1a',
  },
  subTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 8,
    color: '#374151',
  },
  text: {
    lineHeight: 20,
    marginBottom: 8,
    color: '#4b5563',
  },
  listItem: {
    marginLeft: 16,
    marginBottom: 4,
    color: '#4b5563',
  },
});