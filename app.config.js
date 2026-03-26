// Une seule clé : la même que android/app/src/main/AndroidManifest.xml (com.google.android.geo.API_KEY).
// Ne pas utiliser une autre valeur dans .env / EAS : le SDK natif lit le manifest, le JS lit extra → deux clés = carte ou tracés cassés.
const GOOGLE_MAPS_API_KEY_CANONICAL = "AIzaSyDQ_28lDOBlz9rxYoAX6djaniQ-q9hQHkI";

const mapsKeyFromEnv =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "";

if (mapsKeyFromEnv && mapsKeyFromEnv !== GOOGLE_MAPS_API_KEY_CANONICAL) {
  console.warn(
    "[app.config] EXPO_PUBLIC_GOOGLE_MAPS_API_KEY (ou GOOGLE_MAPS_API_KEY) est différente du manifest Android. On force la clé CANONICAL pour aligner SDK Maps et appels Directions/Geocode. Retire ou aligne la variable d’env."
  );
}

const GOOGLE_MAPS_API_KEY_RESOLVED = GOOGLE_MAPS_API_KEY_CANONICAL;

// Debug: Log des variables d'environnement au build time
console.log("=== APP.CONFIG.JS DEBUG (BUILD TIME) ===");
console.log("EXPO_PUBLIC_API_URL:", process.env.EXPO_PUBLIC_API_URL || "NOT SET");
console.log(
  "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY:",
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ? `PRESENT (ignored if ≠ canonical)` : "MISSING"
);
console.log("NODE_ENV:", process.env.NODE_ENV || "NOT SET");
console.log("googleMapsApiKey (canonical) length:", GOOGLE_MAPS_API_KEY_RESOLVED.length);
console.log("========================================");

export default {
  expo: {
    name: "TĀPE'A",
    slug: "tapea",
    version: "1.0.1",
    orientation: "portrait",
    icon: "./assets/images/logoappclienttapea.png",
    scheme: "tapea",
    userInterfaceStyle: "automatic",
    newArchEnabled: false,
    ios: {
      supportsTablet: false,
      bundleIdentifier: "com.tapea.customer",
      entitlements: {
        "com.apple.security.application-groups": [
          "group.com.tapea.customer.onesignal"
        ]
      },
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        // Permissions de localisation
        NSLocationWhenInUseUsageDescription: "TĀPE'A utilise votre position pour trouver des taxis à proximité et suivre votre course en temps réel.",
        NSLocationAlwaysAndWhenInUseUsageDescription: "TĀPE'A utilise votre position pour trouver des taxis à proximité et suivre votre course en temps réel.",
        // Permissions caméra et galerie (photo de profil)
        NSCameraUsageDescription: "TĀPE'A utilise la caméra pour vous permettre de prendre une photo de profil.",
        NSPhotoLibraryUsageDescription: "TĀPE'A accède à votre galerie pour vous permettre de choisir une photo de profil.",
        NSPhotoLibraryAddUsageDescription: "TĀPE'A peut enregistrer des photos dans votre galerie.",
        // Permissions microphone (appels)
        NSMicrophoneUsageDescription: "TĀPE'A peut utiliser le microphone pour les appels avec votre chauffeur.",
        // Permissions contacts (partage de course)
        NSContactsUsageDescription: "TĀPE'A peut accéder à vos contacts pour faciliter le partage de votre course.",
      },
      config: {
        googleMapsApiKey: GOOGLE_MAPS_API_KEY_RESOLVED,
      },
      runtimeVersion: {
        policy: "appVersion",
      },
    },
    android: {
      googleServicesFile: "./google-services.json",
      adaptiveIcon: {
        foregroundImage: "./assets/images/logoappclienttapea.png",
        backgroundColor: "#ffffff",
      },
      edgeToEdgeEnabled: false,
      package: "com.tapea.customer",
      permissions: [
        "ACCESS_FINE_LOCATION",
        "ACCESS_COARSE_LOCATION",
        "CAMERA",
        "READ_MEDIA_IMAGES",
        "INTERNET",
        "VIBRATE",
        "RECEIVE_BOOT_COMPLETED",
        "POST_NOTIFICATIONS",
      ],
      config: {
        googleMaps: {
          apiKey: GOOGLE_MAPS_API_KEY_RESOLVED,
        },
      },
      runtimeVersion: "1.0.1",
    },
    web: {
      bundler: "metro",
      output: "static",
      favicon: "./assets/images/favicon.png",
    },
    plugins: [
      "expo-router",
      "expo-dev-client",
      [
        "expo-splash-screen",
        {
          image: "./assets/images/logoappclienttapea.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: "#1a1a1a",
        },
      ],
      [
        "expo-location",
        {
          locationAlwaysAndWhenInUsePermission: "Autoriser $(PRODUCT_NAME) à utiliser votre position pour trouver des taxis à proximité.",
        },
      ],
      // Stripe désactivé temporairement (configuration Apple Pay en attente)
      [
        "onesignal-expo-plugin",
        {
          mode: process.env.NODE_ENV === "production" ? "production" : "development",
          devTeam: "UG53K2J3SU",
        }
      ]
    ],
    experiments: {
      typedRoutes: true,
    },
    updates: {
      url: "https://u.expo.dev/b68a1d5a-a4cb-4b7a-8020-50a55355f5b4",
    },
    extra: {
      eas: {
        projectId: "b68a1d5a-a4cb-4b7a-8020-50a55355f5b4",
      },
      // Configuration de l'URL API :
      // - Par défaut : utilise le backend Render (https://back-end-tapea.onrender.com/api)
      // - Pour utiliser le mock local : définir EXPO_PUBLIC_API_URL=http://192.168.99.38:5000/api dans .env
      apiUrl: process.env.EXPO_PUBLIC_API_URL || "https://back-end-tapea.onrender.com/api",
      stripePublishableKey: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || process.env.STRIPE_PUBLISHABLE_KEY || "",
      googleMapsApiKey: GOOGLE_MAPS_API_KEY_RESOLVED,
      oneSignalAppId: "e5e23506-2176-47ce-9861-cae3b49ed002",
    },
  },
};
