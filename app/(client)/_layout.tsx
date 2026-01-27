import { Stack } from 'expo-router';

export default function ClientLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="commandes" />
      <Stack.Screen name="profil" />
      <Stack.Screen name="commande-options" />
      <Stack.Screen name="ride" />
      <Stack.Screen name="cartes-bancaires" />
      <Stack.Screen name="info-perso" />
      <Stack.Screen name="tarifs" />
      <Stack.Screen name="aide" />
      <Stack.Screen name="support" />
      <Stack.Screen name="messages" />
      <Stack.Screen name="course-details/[id]" />
    </Stack>
  );
}
