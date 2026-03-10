// Debug: Log des variables d'environnement au build time
console.log('=== APP.CONFIG.JS DEBUG (BUILD TIME) ===');
console.log('EXPO_PUBLIC_API_URL:', process.env.EXPO_PUBLIC_API_URL || 'NOT SET');
console.log('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY:', process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ? `PRESENT (length: ${process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY.length})` : 'MISSING');
console.log('GOOGLE_MAPS_API_KEY:', process.env.GOOGLE_MAPS_API_KEY ? `PRESENT (length: ${process.env.GOOGLE_MAPS_API_KEY.length})` : 'MISSING');
console.log('NODE_ENV:', process.env.NODE_ENV || 'NOT SET');
console.log('========================================');

export default {
  expo: {
    name: "TĀPE'A",
    slug: "tapea",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/logoappclienttapea.png",
    scheme: "tapea",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
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
        googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "",
      },
      runtimeVersion: {
        policy: "appVersion",
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/images/logoappclienttapea.png",
        backgroundColor: "#ffffff",
      },
      edgeToEdgeEnabled: true,
      package: "com.tapea.customer",
      config: {
        googleMaps: {
          apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "",
        },
      },
      runtimeVersion: "1.0.0",
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
      // Stripe désactivé temporairement pour le build (Apple Pay nécessite configuration Apple Developer)
      // [
      //   "@stripe/stripe-react-native",
      //   {
      //     merchantIdentifier: "merchant.com.tapea",
      //     enableGooglePay: true,
      //   },
      // ],
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
      googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "",
      oneSignalAppId: "e5e23506-2176-47ce-9861-cae3b49ed002",
    },
  },
};
