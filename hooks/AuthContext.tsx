import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { Amplify } from 'aws-amplify';
import { getCurrentUser, signInWithRedirect, signOut } from 'aws-amplify/auth';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';
import { Hub, type KeyValueStorageInterface } from 'aws-amplify/utils';

const CLOUD_MODE_KEY = 'shiftcalendar:cloud-mode';
const SECURE_REGISTRY_KEY = 'shiftcalendar.secure.keys';

class MemoryStorage implements KeyValueStorageInterface {
  private values = new Map<string, string>();
  async setItem(key: string, value: string) { this.values.set(key, value); }
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async removeItem(key: string) { this.values.delete(key); }
  async clear() { this.values.clear(); }
}

function secureKey(key: string) {
  return `sc.${key.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

class NativeSecureStorage implements KeyValueStorageInterface {
  private registryUpdate: Promise<void> = Promise.resolve();

  async setItem(key: string, value: string) {
    const target = secureKey(key);
    await SecureStore.setItemAsync(target, value);
    this.registryUpdate = this.registryUpdate.then(async () => {
      const registry = JSON.parse((await SecureStore.getItemAsync(SECURE_REGISTRY_KEY)) ?? '[]') as string[];
      if (!registry.includes(target)) await SecureStore.setItemAsync(SECURE_REGISTRY_KEY, JSON.stringify([...registry, target]));
    });
    await this.registryUpdate;
  }
  async getItem(key: string) { return SecureStore.getItemAsync(secureKey(key)); }
  async removeItem(key: string) { await SecureStore.deleteItemAsync(secureKey(key)); }
  async clear() {
    const registry = JSON.parse((await SecureStore.getItemAsync(SECURE_REGISTRY_KEY)) ?? '[]') as string[];
    await Promise.all(registry.map((key) => SecureStore.deleteItemAsync(key)));
    await SecureStore.deleteItemAsync(SECURE_REGISTRY_KEY);
  }
}

const userPoolId = process.env.EXPO_PUBLIC_USER_POOL_ID;
const clientId = Platform.OS === 'web'
  ? process.env.EXPO_PUBLIC_WEB_CLIENT_ID
  : process.env.EXPO_PUBLIC_NATIVE_CLIENT_ID;
const cognitoDomain = process.env.EXPO_PUBLIC_COGNITO_DOMAIN?.replace(/^https?:\/\//, '').replace(/\/$/, '');
const webBase = process.env.EXPO_PUBLIC_WEB_URL?.replace(/\/$/, '') || (Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : '');
const redirectSignIn = Platform.OS === 'web' ? `${webBase}/callback` : 'shiftcalendar://callback';
const redirectSignOut = Platform.OS === 'web' ? `${webBase}/login` : 'shiftcalendar://login';
export const authConfigured = process.env.EXPO_PUBLIC_CLOUD_PROVIDER !== 'cloudflare' && Boolean(process.env.EXPO_PUBLIC_API_URL && userPoolId && clientId && cognitoDomain && redirectSignIn && redirectSignOut);

if (authConfigured) {
  cognitoUserPoolsTokenProvider.setKeyValueStorage(Platform.OS === 'web' ? new MemoryStorage() : new NativeSecureStorage());
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: userPoolId!,
        userPoolClientId: clientId!,
        loginWith: {
          oauth: {
            domain: cognitoDomain!,
            scopes: ['openid', 'email', 'profile', 'shiftcalendar/access'],
            redirectSignIn: [redirectSignIn],
            redirectSignOut: [redirectSignOut],
            responseType: 'code',
          },
        },
      },
    },
  });
}

if (Platform.OS !== 'web') WebBrowser.maybeCompleteAuthSession();

export interface AuthUser {
  sub: string;
  username: string;
  applicationAdmin?: boolean;
}

interface AuthContextValue {
  configured: boolean;
  loading: boolean;
  cloudMode: boolean;
  user: AuthUser | null;
  error: string | null;
  signIn: () => Promise<void>;
  signOutUser: () => Promise<void>;
  useLocalOnly: () => Promise<void>;
  retrySession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(authConfigured);
  const [cloudMode, setCloudMode] = useState(Platform.OS === 'web' && authConfigured);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const retrySession = useCallback(async () => {
    if (!authConfigured) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const current = await getCurrentUser();
      setUser({ sub: current.userId, username: current.username });
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      if (Platform.OS !== 'web') {
        const savedMode = await AsyncStorage.getItem(CLOUD_MODE_KEY);
        if (active) setCloudMode(authConfigured && savedMode === 'cloud');
      }
      if (active) await retrySession();
    })();
    const cancel = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signedIn' || payload.event === 'tokenRefresh') retrySession();
      if (payload.event === 'signedOut') setUser(null);
      if (payload.event === 'signInWithRedirect_failure') {
        setError('Sign-in did not complete. Please try again.');
        setLoading(false);
      }
    });
    return () => { active = false; cancel(); };
  }, [retrySession]);

  const beginSignIn = useCallback(async () => {
    if (!authConfigured) { setError('Cloud login is not configured for this build.'); return; }
    setError(null);
    setCloudMode(true);
    if (Platform.OS !== 'web') await AsyncStorage.setItem(CLOUD_MODE_KEY, 'cloud');
    try {
      await signInWithRedirect({
        options: Platform.OS === 'web' ? undefined : {
          authSessionOpener: async (url, callbackUrls) => {
            const result = await WebBrowser.openAuthSessionAsync(url, callbackUrls[0]);
            if (result.type === 'success') return { type: 'success', url: result.url };
            return { type: result.type === 'cancel' || result.type === 'dismiss' ? 'canceled' : 'error' };
          },
        },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in could not start.');
    }
  }, []);

  const signOutUser = useCallback(async () => {
    setError(null);
    try { await signOut(); } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-out did not complete.');
    } finally { setUser(null); }
  }, []);

  const useLocalOnly = useCallback(async () => {
    if (Platform.OS === 'web' && authConfigured) return;
    if (user) await signOut();
    await AsyncStorage.setItem(CLOUD_MODE_KEY, 'local');
    setUser(null);
    setCloudMode(false);
    setError(null);
  }, [user]);

  const value = useMemo(() => ({ configured: authConfigured, loading, cloudMode, user, error, signIn: beginSignIn, signOutUser, useLocalOnly, retrySession }), [loading, cloudMode, user, error, beginSignIn, signOutUser, useLocalOnly, retrySession]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
