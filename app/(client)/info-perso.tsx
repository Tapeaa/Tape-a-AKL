import { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert, Image, TextInput, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { useAuth } from '@/lib/AuthContext';
import { apiPatch, API_URL } from '@/lib/api';

// Import dynamique pour éviter les erreurs si le module natif n'est pas disponible
let ImagePicker: typeof import('expo-image-picker') | null = null;
try {
  ImagePicker = require('expo-image-picker');
} catch (e) {
  console.log('[ImagePicker] Module natif non disponible, fonctionnalité désactivée');
}

export default function InfoPersoScreen() {
  const router = useRouter();
  const { client, refreshClient, setClientDirectly } = useAuth();
  const [firstName, setFirstName] = useState(client?.firstName || '');
  const [lastName, setLastName] = useState(client?.lastName || '');
  const [email, setEmail] = useState(client?.email || '');
  const [photoUrl, setPhotoUrl] = useState<string | null>(client?.photoUrl || null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

  // Synchroniser l'état local avec le client quand celui-ci change
  useEffect(() => {
    if (client) {
      setFirstName(client.firstName || '');
      setLastName(client.lastName || '');
      setEmail(client.email || '');
      setPhotoUrl((current) => client.photoUrl ?? current ?? null);
    }
  }, [client]);

  const handleSave = async () => {
    setIsLoading(true);
    try {
      await apiPatch('/api/client/profile', { firstName, lastName, email, photoUrl });
      await refreshClient();
      Alert.alert('Succès', 'Vos informations ont été mises à jour');
      router.back();
    } catch (err) {
      Alert.alert('Erreur', (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const pickImage = async () => {
    try {
      // Demander la permission
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      
      if (!permissionResult.granted) {
        Alert.alert(
          'Permission requise',
          'Veuillez autoriser l\'accès à votre galerie photo pour changer votre photo de profil.'
        );
        return;
      }

      // Ouvrir la galerie
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        await uploadPhoto(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Erreur', 'Impossible de sélectionner l\'image');
    }
  };

  const takePhoto = async () => {
    try {
      // Demander la permission caméra
      const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
      
      if (!permissionResult.granted) {
        Alert.alert(
          'Permission requise',
          'Veuillez autoriser l\'accès à votre caméra pour prendre une photo.'
        );
        return;
      }

      // Ouvrir la caméra
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        await uploadPhoto(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error taking photo:', error);
      Alert.alert('Erreur', 'Impossible de prendre la photo');
    }
  };

  const uploadPhoto = async (uri: string) => {
    setIsUploadingPhoto(true);
    console.log('[PHOTO UPLOAD] Starting upload, URI:', uri);
    try {
      // Créer le FormData
      const formData = new FormData();
      const filename = uri.split('/').pop() || 'photo.jpg';
      const match = /\.(\w+)$/.exec(filename);
      const type = match ? `image/${match[1]}` : 'image/jpeg';

      formData.append('image', {
        uri,
        name: filename,
        type,
      } as any);

      console.log('[PHOTO UPLOAD] Uploading to:', `${API_URL}/upload/client-photo`);
      // Upload vers Cloudinary via le backend (API_URL contient déjà /api)
      const response = await fetch(`${API_URL}/upload/client-photo`, {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      const data = await response.json();
      console.log('[PHOTO UPLOAD] Response:', JSON.stringify(data));

      if (data.success && data.url) {
        console.log('[PHOTO UPLOAD] Upload success, URL:', data.url);
        setPhotoUrl(data.url);
        // Sauvegarder automatiquement la photo dans la base de données
        try {
          console.log('[PHOTO UPLOAD] Saving to DB...');
          const patchResponse = await apiPatch('/api/client/profile', { photoUrl: data.url });
          console.log('[PHOTO UPLOAD] DB save response:', JSON.stringify(patchResponse));
          if (patchResponse?.client) {
            setClientDirectly(patchResponse.client);
          } else if (client) {
            setClientDirectly({ ...client, photoUrl: data.url });
          }
          console.log('[PHOTO UPLOAD] DB save success, refreshing client...');
          await refreshClient();
          console.log('[PHOTO UPLOAD] Client refreshed, new photoUrl:', client?.photoUrl);
          Alert.alert('Succès', 'Photo de profil mise à jour !');
        } catch (saveError) {
          console.error('Error saving photo URL:', saveError);
          Alert.alert('Erreur', 'Photo uploadée mais non sauvegardée. Cliquez sur Enregistrer.');
        }
      } else {
        throw new Error(data.error || 'Erreur lors de l\'upload');
      }
    } catch (error) {
      console.error('Error uploading photo:', error);
      Alert.alert('Erreur', 'Impossible d\'uploader la photo');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const showPhotoOptions = () => {
    Alert.alert(
      'Photo de profil',
      'Comment souhaitez-vous ajouter votre photo ?',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Prendre une photo', onPress: takePhoto },
        { text: 'Choisir dans la galerie', onPress: pickImage },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Mon profil</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Avatar Section */}
        <View style={styles.avatarSection}>
          <TouchableOpacity onPress={showPhotoOptions} style={styles.avatarContainer} activeOpacity={0.8}>
            {isUploadingPhoto ? (
              <View style={styles.avatarPlaceholder}>
                <ActivityIndicator size="large" color="#F5C400" />
              </View>
            ) : photoUrl ? (
              <Image 
                source={{ uri: photoUrl }} 
                style={styles.avatarImage}
              />
            ) : (
              <Image 
                source={require('@/assets/images/pdpclient.png')} 
                style={styles.avatarImage}
              />
            )}
            <View style={styles.editBadge}>
              <Ionicons name="camera" size={14} color="#FFFFFF" />
            </View>
          </TouchableOpacity>
          <Text style={styles.avatarHint}>Appuyez pour modifier</Text>
          <Text style={styles.avatarName}>{firstName} {lastName}</Text>
          <Text style={styles.avatarPhone}>{client?.phone || ''}</Text>
        </View>

        {/* Form Section */}
        <View style={styles.formSection}>
          <Text style={styles.sectionTitle}>Informations personnelles</Text>
          
          {/* Prénom */}
          <View style={styles.inputGroup}>
            <View style={styles.inputIcon}>
              <Ionicons name="person-outline" size={20} color="#F5C400" />
            </View>
            <View style={styles.inputContent}>
              <Text style={styles.inputLabel}>Prénom</Text>
              <TextInput
                style={styles.textInput}
                value={firstName}
                onChangeText={setFirstName}
                placeholder="Votre prénom"
                placeholderTextColor="#A0A0A0"
              />
            </View>
          </View>

          {/* Nom */}
          <View style={styles.inputGroup}>
            <View style={styles.inputIcon}>
              <Ionicons name="person-outline" size={20} color="#F5C400" />
            </View>
            <View style={styles.inputContent}>
              <Text style={styles.inputLabel}>Nom</Text>
              <TextInput
                style={styles.textInput}
                value={lastName}
                onChangeText={setLastName}
                placeholder="Votre nom"
                placeholderTextColor="#A0A0A0"
              />
            </View>
          </View>

          {/* Email */}
          <View style={styles.inputGroup}>
            <View style={styles.inputIcon}>
              <Ionicons name="mail-outline" size={20} color="#F5C400" />
            </View>
            <View style={styles.inputContent}>
              <Text style={styles.inputLabel}>Email (optionnel)</Text>
              <TextInput
                style={styles.textInput}
                value={email}
                onChangeText={setEmail}
                placeholder="votre@email.com"
                placeholderTextColor="#A0A0A0"
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>
          </View>

          {/* Téléphone (non modifiable) */}
          <View style={[styles.inputGroup, styles.inputGroupDisabled]}>
            <View style={styles.inputIcon}>
              <Ionicons name="call-outline" size={20} color="#9CA3AF" />
            </View>
            <View style={styles.inputContent}>
              <Text style={styles.inputLabel}>Téléphone</Text>
              <View style={styles.phoneContainer}>
                <Text style={styles.phoneText}>{client?.phone || ''}</Text>
                <View style={styles.verifiedBadge}>
                  <Ionicons name="shield-checkmark" size={14} color="#22C55E" />
                  <Text style={styles.verifiedText}>Vérifié</Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* Save Button */}
        <TouchableOpacity
          style={[styles.saveButton, isLoading && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={isLoading || isUploadingPhoto}
          activeOpacity={0.8}
        >
          {isLoading ? (
            <Text style={styles.saveButtonText}>Enregistrement...</Text>
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={20} color="#1a1a1a" />
              <Text style={styles.saveButtonText}>Enregistrer les modifications</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Info Note */}
        <View style={styles.noteContainer}>
          <Ionicons name="information-circle-outline" size={18} color="#9CA3AF" />
          <Text style={styles.noteText}>
            Votre photo de profil sera visible par les chauffeurs pendant vos courses.
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  avatarSection: {
    alignItems: 'center',
    paddingVertical: 32,
    backgroundColor: '#FAFAFA',
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 8,
  },
  avatarImage: {
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 3,
    borderColor: '#F5C400',
  },
  avatarPlaceholder: {
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 3,
    borderColor: '#F5C400',
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  editBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F5C400',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  avatarHint: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 12,
  },
  avatarName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  avatarPhone: {
    fontSize: 14,
    color: '#6B7280',
  },
  formSection: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9CA3AF',
    marginBottom: 16,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    marginBottom: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  inputGroupDisabled: {
    backgroundColor: '#F3F4F6',
  },
  inputIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFF9E6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  inputContent: {
    flex: 1,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9CA3AF',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  textInput: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1a1a1a',
    padding: 0,
    margin: 0,
  },
  phoneContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  phoneText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#6B7280',
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  verifiedText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#22C55E',
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5C400',
    marginHorizontal: 20,
    marginTop: 8,
    paddingVertical: 16,
    borderRadius: 16,
    gap: 8,
    shadowColor: '#F5C400',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  saveButtonDisabled: {
    opacity: 0.7,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  noteContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: 20,
    marginTop: 20,
    padding: 16,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    gap: 10,
  },
  noteText: {
    flex: 1,
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 18,
  },
});
