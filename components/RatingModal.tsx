import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import { Text } from '@/components/ui/Text';
import { Ionicons } from '@expo/vector-icons';

interface RatingModalProps {
  visible: boolean;
  driverName: string;
  onSubmit: (score: number, comment?: string) => Promise<void>;
  onComplete: () => void; // Appelé uniquement après avoir noté
  onSkip?: () => void; // Appelé si l'utilisateur passe cette étape
}

export function RatingModal({ visible, driverName, onSubmit, onComplete, onSkip }: RatingModalProps) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (rating === 0) return;
    
    Keyboard.dismiss();
    setIsSubmitting(true);
    try {
      await onSubmit(rating, comment.trim() || undefined);
      setSubmitted(true);
      setTimeout(() => {
        onComplete();
      }, 1500);
    } catch (error: any) {
      console.error('Error submitting rating:', error);
      // Afficher l'erreur à l'utilisateur
      const errorMessage = error?.message || error?.error || 'Une erreur est survenue lors de l\'envoi de votre notation.';
      alert(errorMessage);
      setIsSubmitting(false);
    }
  };

  const renderStars = () => {
    return (
      <View style={styles.starsContainer}>
        {[1, 2, 3, 4, 5].map((star) => (
          <TouchableOpacity
            key={star}
            onPress={() => setRating(star)}
            style={styles.starButton}
            disabled={isSubmitting || submitted}
          >
            <Ionicons
              name={star <= rating ? 'star' : 'star-outline'}
              size={42}
              color={star <= rating ? '#F5C400' : '#D1D5DB'}
            />
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  const getRatingText = () => {
    switch (rating) {
      case 1: return 'Très insatisfait 😞';
      case 2: return 'Insatisfait 😕';
      case 3: return 'Correct 😐';
      case 4: return 'Satisfait 😊';
      case 5: return 'Excellent ! 🌟';
      default: return 'Touchez les étoiles pour noter';
    }
  };

  if (submitted) {
    return (
      <Modal visible={visible} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.successContainer}>
            <View style={styles.successIcon}>
              <Ionicons name="checkmark-circle" size={80} color="#22C55E" />
            </View>
            <Text variant="h2" style={styles.successTitle}>Merci !</Text>
            <Text style={styles.successText}>Votre avis a été enregistré</Text>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade">
      <KeyboardAvoidingView 
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.overlay}>
            <ScrollView 
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.container}>
                {/* Header */}
                <View style={styles.header}>
                  <View style={styles.thankYouContainer}>
                    <Ionicons name="checkmark-circle" size={32} color="#22C55E" />
                    <Text variant="h1" style={styles.thankYouTitle}>Merci !</Text>
                    <Text style={styles.thankYouSubtitle}>Votre course s'est bien déroulée</Text>
                  </View>
                  <View style={styles.iconContainer}>
                    <Ionicons name="car" size={32} color="#F5C400" />
                  </View>
                  <Text variant="h2" style={styles.title}>Comment était votre course ?</Text>
                  <Text style={styles.subtitle}>Notez {driverName}</Text>
                </View>

                {/* Stars */}
                {renderStars()}
                <Text style={styles.ratingText}>{getRatingText()}</Text>

                {/* Comment */}
                {rating > 0 && (
                  <View style={styles.commentContainer}>
                    <TextInput
                      style={styles.commentInput}
                      placeholder="Ajoutez un commentaire (optionnel)"
                      placeholderTextColor="#9CA3AF"
                      multiline
                      numberOfLines={3}
                      value={comment}
                      onChangeText={setComment}
                      editable={!isSubmitting}
                      returnKeyType="done"
                      blurOnSubmit={true}
                      onSubmitEditing={Keyboard.dismiss}
                    />
                  </View>
                )}

                {/* Bouton d'envoi */}
                <View style={styles.buttons}>
                  <TouchableOpacity
                    style={[styles.submitButton, rating === 0 && styles.submitButtonDisabled]}
                    onPress={handleSubmit}
                    disabled={rating === 0 || isSubmitting}
                  >
                    {isSubmitting ? (
                      <ActivityIndicator color="#1A1A1A" />
                    ) : (
                      <Text style={styles.submitButtonText}>Envoyer mon avis</Text>
                    )}
                  </TouchableOpacity>
                  
                  {/* Lien pour passer cette étape */}
                  <TouchableOpacity
                    style={styles.skipButton}
                    onPress={() => {
                      if (onSkip) {
                        onSkip();
                      } else {
                        onComplete();
                      }
                    }}
                    disabled={isSubmitting}
                  >
                    <Text style={styles.skipButtonText}>Passer cette étape</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  keyboardAvoid: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  thankYouContainer: {
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    width: '100%',
  },
  thankYouTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1A1A1A',
    marginTop: 8,
    marginBottom: 4,
  },
  thankYouSubtitle: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1A1A1A',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
  },
  starsContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  starButton: {
    padding: 4,
  },
  ratingText: {
    fontSize: 16,
    color: '#4B5563',
    marginBottom: 20,
    height: 24,
  },
  commentContainer: {
    width: '100%',
    marginBottom: 20,
  },
  commentInput: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#1A1A1A',
    minHeight: 80,
    textAlignVertical: 'top',
  },
  buttons: {
    width: '100%',
    gap: 12,
  },
  submitButton: {
    backgroundColor: '#F5C400',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: '#E5E7EB',
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  requiredText: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 8,
  },
  skipButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  skipButtonText: {
    fontSize: 14,
    color: '#6B7280',
    textDecorationLine: 'underline',
  },
  successContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 40,
    alignItems: 'center',
  },
  successIcon: {
    marginBottom: 16,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 8,
  },
  successText: {
    fontSize: 16,
    color: '#6B7280',
  },
});
