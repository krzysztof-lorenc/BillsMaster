import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import type { AuthUser, LoginRequest, SetupAdminRequest, SystemStatusResponse } from '@bills-master/shared-types';

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isConfigured: boolean | null;
  login: (creds: LoginRequest) => Promise<void>;
  setupAdmin: (data: SetupAdminRequest) => Promise<void>;
  logout: () => Promise<void>;
  checkStatus: () => Promise<void>;
  updateTheme: (theme: 'dark' | 'light') => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const status = await api.get<SystemStatusResponse>('/api/auth/status');
      setIsConfigured(status.isConfigured);

      if (status.isConfigured) {
        try {
          const res = await api.get<{ user: AuthUser }>('/api/auth/me');
          setUser(res.user);
        } catch {
          setUser(null);
        }
      }
    } catch (err) {
      console.error('Failed to initialize auth status:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const login = async (creds: LoginRequest) => {
    setIsLoading(true);
    try {
      const res = await api.post<{ user: AuthUser }>('/api/auth/login', creds);
      setUser(res.user);
    } finally {
      setIsLoading(false);
    }
  };

  const setupAdmin = async (data: SetupAdminRequest) => {
    setIsLoading(true);
    try {
      const res = await api.post<{ user: AuthUser }>('/api/auth/setup-admin', data);
      setUser(res.user);
      setIsConfigured(true);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      // Ignore logout errors
    }
    setUser(null);
  };

  const updateTheme = async (theme: 'dark' | 'light') => {
    setUser((prev) => (prev ? { ...prev, theme } : null));
    try {
      await api.patch('/api/auth/theme', { theme });
    } catch (err) {
      console.error('Failed to persist theme:', err);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isConfigured,
        login,
        setupAdmin,
        logout,
        checkStatus,
        updateTheme,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
