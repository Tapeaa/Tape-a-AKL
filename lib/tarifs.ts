/**
 * Service de gestion des tarifs dynamiques
 * Les tarifs sont récupérés depuis le back-office et mis en cache localement
 */

import { apiFetch } from './api';

// ============================================
// TYPES
// ============================================

export interface Tarif {
  id: string;
  nom: string;
  typeTarif: 'prise_en_charge' | 'kilometre_jour' | 'kilometre_nuit' | 'minute_arret' | 'supplement';
  prixXpf: number;
  heureDebut?: string; // Format HH:MM
  heureFin?: string;   // Format HH:MM
  actif: boolean;
}

export interface Supplement {
  id: string;
  nom: string;
  description?: string;
  prixXpf: number;
  typeSupplement: 'fixe' | 'pourcentage';
  actif: boolean;
}

export interface TarifsConfig {
  priseEnCharge: number;
  tarifJourKm: number;
  tarifNuitKm: number;
  minuteArret: number;
  heureDebutJour: number;
  heureFinJour: number;
  supplements: Supplement[];
  lastUpdated: number;
}

// ============================================
// CONSTANTES
// ============================================

const CACHE_DURATION = 1 * 60 * 1000; // 1 minute - refresh rapide pour voir les changements du back-office

// Valeurs par défaut (utilisées si l'API n'est pas disponible)
const DEFAULT_TARIFS: TarifsConfig = {
  priseEnCharge: 1000,
  tarifJourKm: 130,
  tarifNuitKm: 260,
  minuteArret: 42, // 2500 / 60 = ~42 XPF/min
  heureDebutJour: 6,
  heureFinJour: 20,
  supplements: [],
  lastUpdated: 0,
};

// ============================================
// CACHE EN MÉMOIRE (simple et compatible partout)
// ============================================

let cachedTarifs: TarifsConfig | null = null;

// ============================================
// API
// ============================================

/**
 * Récupère les tarifs depuis l'API du back-office
 */
export async function fetchTarifsFromAPI(): Promise<TarifsConfig> {
  try {
    const tarifs = await apiFetch<Tarif[]>('/api/tarifs', { skipAuth: true });
    
    // Transformer les tarifs en configuration
    const config: TarifsConfig = {
      ...DEFAULT_TARIFS,
      lastUpdated: Date.now(),
    };

    for (const tarif of tarifs) {
      if (!tarif.actif) continue;

      switch (tarif.typeTarif) {
        case 'prise_en_charge':
          config.priseEnCharge = tarif.prixXpf;
          break;
        case 'kilometre_jour':
          config.tarifJourKm = tarif.prixXpf;
          // Extraire les heures si disponibles
          if (tarif.heureDebut) {
            const [h] = tarif.heureDebut.split(':');
            config.heureDebutJour = parseInt(h, 10);
          }
          if (tarif.heureFin) {
            const [h] = tarif.heureFin.split(':');
            config.heureFinJour = parseInt(h, 10);
          }
          break;
        case 'kilometre_nuit':
          config.tarifNuitKm = tarif.prixXpf;
          break;
        case 'minute_arret':
          config.minuteArret = tarif.prixXpf;
          break;
      }
    }

    // Récupérer les suppléments
    try {
      const supplements = await apiFetch<Supplement[]>('/api/supplements', { skipAuth: true });
      config.supplements = supplements.filter(s => s.actif);
    } catch {
      // Ignorer si les suppléments ne sont pas disponibles
    }

    // Sauvegarder dans le cache
    cachedTarifs = config;

    console.log('[Tarifs] Configuration récupérée depuis l\'API:', config);
    return config;
  } catch (error) {
    console.warn('[Tarifs] Erreur lors de la récupération des tarifs:', error);
    
    // Essayer de récupérer depuis le cache
    if (cachedTarifs) {
      console.log('[Tarifs] Utilisation du cache (fallback)');
      return cachedTarifs;
    }

    // Utiliser les valeurs par défaut
    console.log('[Tarifs] Utilisation des valeurs par défaut');
    return DEFAULT_TARIFS;
  }
}

/**
 * Récupère les tarifs (depuis le cache ou l'API)
 */
export async function getTarifs(): Promise<TarifsConfig> {
  // Vérifier le cache d'abord
  if (cachedTarifs && Date.now() - cachedTarifs.lastUpdated < CACHE_DURATION) {
    // Rafraîchir en arrière-plan si le cache est vieux de plus de 5 minutes
    if (Date.now() - cachedTarifs.lastUpdated > 5 * 60 * 1000) {
      fetchTarifsFromAPI().catch(() => {}); // Rafraîchir silencieusement
    }
    return cachedTarifs;
  }

  // Sinon, récupérer depuis l'API
  return fetchTarifsFromAPI();
}

/**
 * Force le rafraîchissement des tarifs depuis l'API
 */
export async function refreshTarifs(): Promise<TarifsConfig> {
  cachedTarifs = null;
  return fetchTarifsFromAPI();
}

// ============================================
// FONCTIONS UTILITAIRES
// ============================================

/**
 * Vérifie si on est en tarif de nuit
 */
export function isNightRate(date: Date = new Date(), config?: TarifsConfig): boolean {
  const hour = date.getHours();
  const heureDebut = config?.heureDebutJour ?? DEFAULT_TARIFS.heureDebutJour;
  const heureFin = config?.heureFinJour ?? DEFAULT_TARIFS.heureFinJour;
  return hour >= heureFin || hour < heureDebut;
}

/**
 * Retourne le tarif au km actuel
 */
export function getCurrentRatePerKm(date: Date = new Date(), config?: TarifsConfig): number {
  const isNight = isNightRate(date, config);
  return isNight 
    ? (config?.tarifNuitKm ?? DEFAULT_TARIFS.tarifNuitKm)
    : (config?.tarifJourKm ?? DEFAULT_TARIFS.tarifJourKm);
}

/**
 * Retourne le libellé du tarif actuel
 */
export function getCurrentRateLabel(date: Date = new Date(), config?: TarifsConfig): string {
  const heureDebut = config?.heureDebutJour ?? DEFAULT_TARIFS.heureDebutJour;
  const heureFin = config?.heureFinJour ?? DEFAULT_TARIFS.heureFinJour;
  return isNightRate(date, config) 
    ? `Tarif nuit (${heureFin}h-${heureDebut}h)` 
    : `Tarif jour (${heureDebut}h-${heureFin}h)`;
}

/**
 * Calcule le prix d'une course
 */
export interface PriceCalculation {
  totalPrice: number;
  driverEarnings: number;
  rateLabel: string;
  ratePerKm: number;
  priseEnCharge: number;
  distancePrice: number;
  supplementsTotal: number;
}

export interface SupplementItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

export function calculatePrice(
  distanceKm: number,
  supplements: SupplementItem[],
  scheduledDate: Date = new Date(),
  config?: TarifsConfig,
  isTourOption: boolean = false,
  tourPrice: number = 30000
): PriceCalculation {
  // Tour de l'île = forfait fixe
  if (isTourOption) {
    const totalPrice = tourPrice;
    const driverEarnings = Math.round(totalPrice * 0.85);
    return {
      totalPrice,
      driverEarnings,
      rateLabel: 'Forfait',
      ratePerKm: 0,
      priseEnCharge: tourPrice,
      distancePrice: 0,
      supplementsTotal: 0,
    };
  }

  // Récupérer les tarifs
  const priseEnCharge = config?.priseEnCharge ?? DEFAULT_TARIFS.priseEnCharge;
  const isNight = isNightRate(scheduledDate, config);
  const ratePerKm = isNight 
    ? (config?.tarifNuitKm ?? DEFAULT_TARIFS.tarifNuitKm)
    : (config?.tarifJourKm ?? DEFAULT_TARIFS.tarifJourKm);
  const rateLabel = getCurrentRateLabel(scheduledDate, config);

  // Calcul du prix
  const distancePrice = Math.round(distanceKm * ratePerKm);
  const supplementsTotal = supplements.reduce(
    (sum, s) => sum + s.price * s.quantity,
    0
  );

  const totalPrice = priseEnCharge + distancePrice + supplementsTotal;
  const driverEarnings = Math.round(totalPrice * 0.85);

  return {
    totalPrice,
    driverEarnings,
    rateLabel,
    ratePerKm,
    priseEnCharge,
    distancePrice,
    supplementsTotal,
  };
}

// ============================================
// HOOK REACT
// ============================================

import { useState, useEffect, useCallback } from 'react';

export function useTarifs() {
  const [tarifs, setTarifs] = useState<TarifsConfig | null>(cachedTarifs);
  const [loading, setLoading] = useState(!cachedTarifs);
  const [error, setError] = useState<string | null>(null);

  const loadTarifs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const config = await getTarifs();
      setTarifs(config);
    } catch (err) {
      setError('Impossible de charger les tarifs');
      setTarifs(DEFAULT_TARIFS);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const config = await refreshTarifs();
      setTarifs(config);
    } catch (err) {
      setError('Impossible de rafraîchir les tarifs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTarifs();
  }, [loadTarifs]);

  return {
    tarifs,
    loading,
    error,
    refresh,
    isNightRate: (date?: Date) => isNightRate(date, tarifs ?? undefined),
    getCurrentRatePerKm: (date?: Date) => getCurrentRatePerKm(date, tarifs ?? undefined),
    getCurrentRateLabel: (date?: Date) => getCurrentRateLabel(date, tarifs ?? undefined),
  };
}

// Export des valeurs par défaut pour compatibilité
export const DEFAULT_TAXI_RATES = DEFAULT_TARIFS;
