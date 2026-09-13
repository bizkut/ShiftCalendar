import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { cloudRequest, isCloudConfigured, sessionExpiredEvent } from '../utils/cloudClient.web';

interface AuthUser { sub: string; username: string; applicationAdmin?: boolean }
interface AuthContextValue {
  configured: boolean; loading: boolean; cloudMode: boolean; user: AuthUser | null; error: string | null;
  signIn: () => Promise<void>; signOutUser: () => Promise<void>;
  useLocalOnly: () => Promise<void>; retrySession: () => Promise<void>;
}
const AuthContext = createContext<AuthContextValue | null>(null);
const configured = isCloudConfigured();

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const retrySession = useCallback(async () => {
    if (!configured) return;
    const attempt = ++generation.current;
    setLoading(true); setError(null);
    try {
      const identity = await cloudRequest<AuthUser>('/session');
      if (attempt === generation.current) setUser(identity);
    } catch (cause) {
      if (attempt === generation.current) {
        setUser(null); setError(cause instanceof Error ? cause.message : 'Could not check your session.');
      }
    } finally { if (attempt === generation.current) setLoading(false); }
  }, []);
  useEffect(() => {
    const expired = () => { generation.current++; setUser(null); setLoading(false); setError('Please sign in again.'); };
    window.addEventListener(sessionExpiredEvent, expired);
    void retrySession();
    return () => { generation.current++; window.removeEventListener(sessionExpiredEvent, expired); };
  }, [retrySession]);
  const signIn = useCallback(async () => {
    if (!configured) { setError('Cloud login is not configured for this build.'); return; }
    // Full navigation lets Access own the email PIN exchange and HttpOnly cookie.
    window.location.assign('/');
  }, []);
  const signOutUser = useCallback(async () => {
    generation.current++; setUser(null); setError(null);
    window.location.assign('/cdn-cgi/access/logout');
  }, []);
  const useLocalOnly = useCallback(async () => { if (!configured) setUser(null); }, []);
  const value = useMemo(() => ({ configured, loading, cloudMode: configured, user, error,
    signIn, signOutUser, useLocalOnly, retrySession }), [loading, user, error, signIn, signOutUser, useLocalOnly, retrySession]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
