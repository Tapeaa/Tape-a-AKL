import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { useRouter, useSegments } from 'expo-router';
import { apiFetch, apiPost, setClientSessionId, removeClientSessionId, getClientSessionId, getActiveOrder, setCurrentOrderId, ApiError } from './api';
import { setClientExternalId, removeExternalId } from './onesignal';
import type { Client } from './types';

interface AuthResult {
  success: boolean;
  needsVerification?: boolean;
  phone?: string;
  error?: string;
  client?: Client;
  devCode?: string;
}

interface AuthContextType {
  client: Client | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (phone: string, password: string) => Promise<AuthResult>;
  register: (phone: string, firstName: string, lastName: string, password: string) => Promise<AuthResult>;
  verify: (phone: string, code: string, type: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
  refreshClient: () => Promise<void>;
  setClientDirectly: (client: Client) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [client, setClient] = useState<Client | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const segments = useSegments();
  const hasCheckedActiveOrderRef = useRef(false);
  const hasRedirectedRef = useRef<string | null>(null);

  const refreshClient = async () => {
    try {
      
      const sessionId = await getClientSessionId();
      
      
      if (!sessionId) {
        setClient(null);
        return;
      }

      // Vérifier que la session n'est pas expirée (vérification déjà faite dans getClientSessionId)
      // Si on arrive ici, la session est valide
      const data = await apiFetch<Client>('/api/auth/me');
      if (__DEV__) {
        console.log('[AUTH] /api/auth/me response:', JSON.stringify(data));
      }
      if (data && data.id) {
        setClient(data);
        // Enregistrer l'ID client dans OneSignal pour les notifications push
        setClientExternalId(data.id);
      } else {
        setClient(null);
        await removeClientSessionId();
      }
    } catch (error) {
      
      // Si l'erreur est une 401 (session expirée ou invalide), supprimer la session
      // pour permettre une nouvelle connexion
      if (error instanceof ApiError && error.status === 401) {
        if (__DEV__) {
          console.log('[AUTH] Session expirée ou invalide (401), suppression de la session');
        }
        await removeClientSessionId();
        setClient(null);
        return;
      }
      
      // Pour les erreurs réseau ou autres erreurs, ne pas supprimer la session
      // On laisse la chance à la session d'être réutilisée au prochain refresh
      if (__DEV__) {
        console.log('[AUTH] Erreur réseau ou autre erreur, conservation de la session:', error instanceof Error ? error.message : String(error));
      }
      setClient(null);
    }
  };

  const setClientDirectly = (newClient: Client) => {
    setClient(newClient);
  };

  useEffect(() => {
    const checkAuth = async () => {
      setIsLoading(true);
      await refreshClient();
      setIsLoading(false);
    };
    checkAuth();
  }, []);

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const isLegalPage = segments[1] === 'legal';
    const isCGUPage = segments[1] === 'cgu';
    const currentPath = segments.join('/');

    // Ne pas rediriger si on est sur la page légale ou CGU (nécessaire pour l'inscription)
    if (isLegalPage || isCGUPage) {
      hasRedirectedRef.current = null; // Réinitialiser pour permettre la redirection après acceptation
      return;
    }

    // Éviter les redirections multiples vers la même destination
    if (!client && !inAuthGroup) {
      if (hasRedirectedRef.current !== 'welcome') {
        hasRedirectedRef.current = 'welcome';
        router.replace('/(auth)/welcome');
      }
    } else if (client && inAuthGroup) {
      // Vérifier si les CGU sont acceptées avant de rediriger vers l'accueil
      // Si les CGU ne sont pas acceptées, rediriger vers la page legal
      if (client.cguAccepted !== true) {
        if (hasRedirectedRef.current !== 'legal') {
          hasRedirectedRef.current = 'legal';
          router.replace('/(auth)/legal');
        }
      } else {
        // CGU acceptées, rediriger vers l'accueil
        if (hasRedirectedRef.current !== 'client') {
          hasRedirectedRef.current = 'client';
          router.replace('/(client)/');
        }
      }
    } else {
      // Réinitialiser si on n'est plus dans une situation de redirection
      hasRedirectedRef.current = null;
    }
  }, [client, segments, isLoading, router]);

  // Au premier chargement avec un client valide, vérifier s'il existe une course active
  // et rediriger vers course-en-cours si oui.
  useEffect(() => {
    if (isLoading || !client || hasCheckedActiveOrderRef.current) return;

    hasCheckedActiveOrderRef.current = true;

    (async () => {
      try {
        const active = await getActiveOrder();
        if (active.hasActiveOrder && active.order) {
          await setCurrentOrderId(active.order.id);

        router.replace({
          pathname: '/(client)/ride/course-en-cours',
          params: { orderId: active.order.id },
        } as any);
        }
      } catch (e) {
        console.log('[Auth] getActiveOrder failed:', e);
      }
    })();
  }, [client, isLoading, segments]);

  const login = async (phone: string, password: string): Promise<AuthResult> => {
    // Normaliser le numéro de téléphone pour la vérification du compte de test
    const cleanPhone = phone.replace(/\+689/g, '').replace(/\s/g, '').trim();
    
    // Vérification du compte de test
    if (cleanPhone === '87000000' && password === '12345') {
      const testClient: Client = {
        id: 'test-client-1',
        phone: '+68987000000',
        firstName: 'Test',
        lastName: 'Utilisateur',
        email: 'test@tapea.pf',
        isVerified: true,
        walletBalance: 5000,
        averageRating: 4.8,
        totalRides: 12,
        createdAt: new Date().toISOString(),
      };
      await setClientSessionId('test-session-id');
      setClient(testClient);
      // Enregistrer l'ID client dans OneSignal pour les notifications push
      setClientExternalId(testClient.id);
      return { success: true, client: testClient };
    }

    try {
      const data = await apiPost<{
        success: boolean;
        client?: Client;
        session?: { id: string };
        needsVerification?: boolean;
        phone?: string;
        error?: string;
      }>('/api/auth/login', { phone, password }, { skipAuth: true });

      if (data.success && data.client) {
        // L'API peut retourner session.id ou utiliser des cookies, donc on vérifie les deux
        if (data.session?.id) {
          await setClientSessionId(data.session.id);
        }
        setClient(data.client);
        // Enregistrer l'ID client dans OneSignal pour les notifications push
        setClientExternalId(data.client.id);
        return { success: true, client: data.client };
      }

      if (data.needsVerification) {
        return { success: false, needsVerification: true, phone: data.phone };
      }

      return { success: false, error: data.error || 'Erreur de connexion' };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  };

  const register = async (
    phone: string,
    firstName: string,
    lastName: string,
    password: string
  ): Promise<AuthResult> => {
    try {
      
      const data = await apiPost<{
        success: boolean;
        client?: Client;
        session?: { id: string };
        error?: string;
        devCode?: string;
        needsVerification?: boolean;
        phone?: string;
        message?: string;
      }>('/api/auth/register', { phone, firstName, lastName, password }, { skipAuth: true });

      console.log('[REGISTER] Response data:', JSON.stringify(data, null, 2));

      // Si le backend demande une vérification SMS, retourner needsVerification
      if (data.success && data.needsVerification) {
        console.log('[REGISTER] Needs verification - redirecting to verify screen');
        return { 
          success: false, 
          needsVerification: true, 
          phone: data.phone || phone,
          devCode: data.devCode 
        };
      }

      // Le backend retourne la session via cookie (déjà extraite dans api.ts)
      // Vérifier si on a une session stockée (extraite du cookie)
      const sessionId = await getClientSessionId();
      
      console.log('[REGISTER] Session ID from storage:', sessionId ? 'Found' : 'Not found');
      console.log('[REGISTER] Session in response:', data.session ? 'Yes' : 'No');

      // Le backend peut retourner session dans le JSON OU via cookie
      // Si session dans JSON, l'utiliser, sinon utiliser celle du cookie
      if (data.session?.id) {
        await setClientSessionId(data.session.id);
        console.log('[REGISTER] Session ID from JSON response:', data.session.id);
      } else if (sessionId) {
        console.log('[REGISTER] Using session ID from cookie:', sessionId);
      }

      if (data.success && data.client) {
        // Vérifier qu'on a bien une session (soit du JSON, soit du cookie)
        const finalSessionId = data.session?.id || await getClientSessionId();
        
        if (!finalSessionId) {
          console.error('[REGISTER] No session ID found after registration!');
          return { success: false, error: "Erreur: session non créée. Réessayez." };
        }

        setClient(data.client);
        // Enregistrer l'ID client dans OneSignal pour les notifications push
        setClientExternalId(data.client.id);
        console.log('[REGISTER] ✅ Registration successful! Client:', data.client.firstName, 'Session:', finalSessionId);
        return { success: true, client: data.client, devCode: data.devCode };
      }

      console.error('[REGISTER] ❌ Registration failed:', data.error || 'Unknown error');
      return { success: false, error: data.error || "Erreur d'inscription", devCode: data.devCode };
    } catch (error) {
      
      return { success: false, error: (error as Error).message };
    }
  };

  const verify = async (phone: string, code: string, type: string): Promise<AuthResult> => {
    try {
      const data = await apiPost<{
        success: boolean;
        client?: Client;
        session?: { id: string };
        error?: string;
      }>('/api/auth/verify', { phone, code, type }, { skipAuth: true });

      if (data.success && data.client && data.session) {
        await setClientSessionId(data.session.id);
        setClient(data.client);
        // Enregistrer l'ID client dans OneSignal pour les notifications push
        setClientExternalId(data.client.id);
        return { success: true, client: data.client };
      }

      // Code incorrect - pas de console.error, juste retourner l'erreur
      return { success: false, error: data.error || 'Code invalide ou expiré' };
    } catch (error) {
      // Erreur réseau ou autre - gérer silencieusement pour éviter les logs Apple
      if (error instanceof ApiError) {
        // Erreur API déjà gérée par apiPost (code invalide, etc.)
        return { success: false, error: error.message || 'Code invalide ou expiré' };
      }
      // Erreur réseau ou autre - message générique
      return { success: false, error: 'Une erreur est survenue. Veuillez réessayer.' };
    }
  };

  const logout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
    } finally {
      await removeClientSessionId();
      // Retirer l'ID client de OneSignal
      removeExternalId();
      setClient(null);
      router.replace('/(auth)/welcome');
    }
  };

  return (
    <AuthContext.Provider
      value={{
        client,
        isLoading,
        isAuthenticated: !!client,
        login,
        register,
        verify,
        logout,
        refreshClient,
        setClientDirectly,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
