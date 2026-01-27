export interface Client {
  id: string;
  phone: string;
  firstName: string;
  lastName: string;
  email: string | null;
  photoUrl: string | null;
  isVerified: boolean;
  walletBalance: number;
  averageRating: number | null;
  totalRides: number;
  createdAt: string;
  // Champs légaux
  cguAccepted?: boolean;
  cguAcceptedAt?: string;
  cguVersion?: string;
  privacyPolicyRead?: boolean;
  privacyPolicyReadAt?: string;
  privacyPolicyVersion?: string;
}

export interface Driver {
  id: string;
  phone: string;
  code: string;
  firstName: string;
  lastName: string;
  vehicleModel: string | null;
  vehicleColor: string | null;
  vehiclePlate: string | null;
  isActive: boolean;
  averageRating: number | null;
  totalRides: number;
  createdAt: string;
}

export interface DriverSession {
  id: string;
  driverId: string;
  driverName: string;
  isOnline: boolean;
  expiresAt: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface ClientSession {
  id: string;
  clientId: string;
  expiresAt: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface AddressField {
  id: string;
  value: string;
  placeId: string | null;
  type: 'pickup' | 'stop' | 'destination';
  lat?: number;
  lng?: number;
}

export interface RideOption {
  id: string;
  title: string;
  duration: string;
  capacity: string;
  basePrice: number;
  pricePerKm: number;
}

export interface Supplement {
  id: string;
  name: string;
  icon: string;
  price: number;
  quantity: number;
}

export interface RouteInfo {
  distance: number;
  duration: string;
}

export type OrderStatus =
  | 'pending'
  | 'accepted'
  | 'booked'        // ═══ RÉSERVATION À L'AVANCE: Course réservée, en attente du démarrage ═══
  | 'declined'
  | 'expired'
  | 'cancelled'
  | 'driver_enroute'
  | 'driver_arrived'
  | 'in_progress'
  | 'completed'
  | 'payment_pending'
  | 'payment_confirmed'
  | 'payment_failed';

export interface Order {
  id: string;
  clientId: string | null;
  clientName: string;
  clientPhone: string;
  addresses: AddressField[];
  rideOption: {
    id: string;
    title: string;
    price: number;
    pricePerKm: number;
    basePrice: number;
    description?: string;
  };
  routeInfo?: RouteInfo;
  passengers: number;
  supplements: Supplement[];
  paymentMethod: 'cash' | 'card';
  totalPrice: number;
  driverEarnings: number;
  waitingTimeMinutes?: number | null;
  driverArrivedAt?: string | null;
  scheduledTime: string | null;
  isAdvanceBooking: boolean;
  status: OrderStatus;
  assignedDriverId: string | null;
  clientRatingId: string | null;
  driverRatingId: string | null;
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
  estimatedDuration?: number;  // en minutes
  estimatedDistance?: number;  // en mètres
  driverName?: string;
}

export interface PaymentMethod {
  id: string;
  clientId: string;
  stripePaymentMethodId: string;
  last4: string;
  brand: string;
  expiryMonth: number;
  expiryYear: number;
  isDefault: boolean;
  createdAt: string;
}

export interface Invoice {
  id: string;
  clientId: string;
  orderId: string;
  stripePaymentIntentId: string | null;
  stripeInvoiceId: string | null;
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'failed';
  pdfUrl: string | null;
  createdAt: string;
  paidAt: string | null;
}

export interface WalletTransaction {
  id: string;
  clientId: string;
  type: 'credit' | 'debit';
  amount: number;
  balanceAfter: number;
  description: string;
  orderId: string | null;
  createdAt: string;
}

export interface LocationUpdate {
  orderId: string;
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  timestamp: number;
}

// ============================================
// TARIFS RÉGLEMENTAIRES TAXIS TAHITI
// ============================================
// Ces valeurs sont des valeurs par défaut.
// Les tarifs réels sont chargés depuis le back-office via l'API.
// Utiliser le hook useTarifs() ou les fonctions de lib/tarifs.ts
// pour obtenir les tarifs à jour.
// ============================================

// Valeurs par défaut (fallback si API non disponible)
export const TAXI_RATES = {
  PRISE_EN_CHARGE: 1000,      // Prise en charge fixe
  TARIF_JOUR_KM: 130,         // 6h - 20h : 130 XPF/km
  TARIF_NUIT_KM: 260,         // 20h - 6h : 260 XPF/km (double)
  HEURE_DEBUT_JOUR: 6,        // 6h00
  HEURE_FIN_JOUR: 20,         // 20h00
};

// Interface pour les tarifs dynamiques
export interface TarifsConfig {
  priseEnCharge: number;
  tarifJourKm: number;
  tarifNuitKm: number;
  minuteArret: number;
  heureDebutJour: number;
  heureFinJour: number;
  lastUpdated: number;
}

// Vérifie si on est en tarif de nuit (20h - 6h)
export function isNightRate(date: Date = new Date(), config?: TarifsConfig): boolean {
  const hour = date.getHours();
  const heureFin = config?.heureFinJour ?? TAXI_RATES.HEURE_FIN_JOUR;
  const heureDebut = config?.heureDebutJour ?? TAXI_RATES.HEURE_DEBUT_JOUR;
  return hour >= heureFin || hour < heureDebut;
}

// Retourne le tarif au km actuel
export function getCurrentRatePerKm(date: Date = new Date(), config?: TarifsConfig): number {
  const isNight = isNightRate(date, config);
  return isNight 
    ? (config?.tarifNuitKm ?? TAXI_RATES.TARIF_NUIT_KM) 
    : (config?.tarifJourKm ?? TAXI_RATES.TARIF_JOUR_KM);
}

// Retourne le libellé du tarif actuel
export function getCurrentRateLabel(date: Date = new Date(), config?: TarifsConfig): string {
  const heureDebut = config?.heureDebutJour ?? TAXI_RATES.HEURE_DEBUT_JOUR;
  const heureFin = config?.heureFinJour ?? TAXI_RATES.HEURE_FIN_JOUR;
  return isNightRate(date, config) 
    ? `Tarif nuit (${heureFin}h-${heureDebut}h)` 
    : `Tarif jour (${heureDebut}h-${heureFin}h)`;
}

// Fonction pour créer les options de course avec les tarifs dynamiques
export function createRideOptions(config?: TarifsConfig): RideOption[] {
  const priseEnCharge = config?.priseEnCharge ?? TAXI_RATES.PRISE_EN_CHARGE;
  const tarifJour = config?.tarifJourKm ?? TAXI_RATES.TARIF_JOUR_KM;
  
  return [
    {
      id: 'immediate',
      title: 'Chauffeur Immédiat',
      duration: '10 - 20 min',
      capacity: '1 - 8 passagers',
      basePrice: priseEnCharge,
      pricePerKm: tarifJour,
    },
    {
      id: 'reservation',
      title: 'Réserver à l\'avance',
      duration: '45 - 1h',
      capacity: '1 - 8 passagers',
      basePrice: priseEnCharge,
      pricePerKm: tarifJour,
    },
    {
      id: 'tour',
      title: 'Tour de l\'Île',
      duration: '4 - 5h',
      capacity: '4 - 8 passagers',
      basePrice: 30000,
      pricePerKm: 0,
    },
  ];
}

// Options par défaut (pour compatibilité)
export const RIDE_OPTIONS: RideOption[] = createRideOptions();

export const SUPPLEMENTS = [
  { id: 'bagages', name: 'Bagages', icon: 'bagages' as const, price: 200 },
  { id: 'encombrants', name: 'Encombrants', icon: 'encombrants' as const, price: 500 },
];

export function calculatePrice(
  rideOption: RideOption,
  distanceKm: number,
  supplements: Supplement[],
  scheduledDate: Date = new Date(),
  config?: TarifsConfig
): { totalPrice: number; driverEarnings: number; rateLabel: string; ratePerKm: number } {
  // Tour de l'île = forfait fixe
  if (rideOption.id === 'tour') {
    const totalPrice = rideOption.basePrice;
    const driverEarnings = Math.round(totalPrice * 0.85);
    return { totalPrice, driverEarnings, rateLabel: 'Forfait', ratePerKm: 0 };
  }

  // Déterminer si tarif jour ou nuit
  const isNight = isNightRate(scheduledDate, config);
  const ratePerKm = isNight 
    ? (config?.tarifNuitKm ?? TAXI_RATES.TARIF_NUIT_KM) 
    : (config?.tarifJourKm ?? TAXI_RATES.TARIF_JOUR_KM);
  const rateLabel = getCurrentRateLabel(scheduledDate, config);

  // Calcul du prix : Prise en charge + (distance × tarif/km) + suppléments
  const priseEnCharge = config?.priseEnCharge ?? TAXI_RATES.PRISE_EN_CHARGE;
  const distancePrice = Math.round(distanceKm * ratePerKm);
  const supplementsTotal = supplements.reduce(
    (sum, s) => sum + s.price * s.quantity,
    0
  );

  const totalPrice = priseEnCharge + distancePrice + supplementsTotal;
  const driverEarnings = Math.round(totalPrice * 0.85);

  return { totalPrice, driverEarnings, rateLabel, ratePerKm };
}
