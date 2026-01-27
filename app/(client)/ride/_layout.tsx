import { Stack } from 'expo-router';

export default function ClientRideLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#FFFFFF' },
      }}
    >
      <Stack.Screen name="itinerary" />
      <Stack.Screen name="recherche-chauffeur" />
      <Stack.Screen name="course-en-cours" />
    </Stack>
  );
}
