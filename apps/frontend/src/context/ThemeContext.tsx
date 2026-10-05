import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from './AuthContext.js';
import type { ThemeMode } from '@bills-master/shared-types';

interface ThemeContextType {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  isLight: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = 'bm_theme';

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, updateTheme: updateAuthTheme } = useAuth();

  const [theme, setThemeState] = useState<ThemeMode>(() => {
    // 1. Check localStorage first
    const saved = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
    return 'dark'; // default theme is dark
  });

  // Sync with user's persisted theme when user logs in or profile changes
  useEffect(() => {
    if (user?.theme && (user.theme === 'light' || user.theme === 'dark')) {
      if (user.theme !== theme) {
        setThemeState(user.theme);
        localStorage.setItem(THEME_STORAGE_KEY, user.theme);
      }
    }
  }, [user?.theme]);

  // Apply theme class to documentElement and meta theme-color
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light');
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
      root.classList.remove('light');
    }
    localStorage.setItem(THEME_STORAGE_KEY, theme);

    // Update meta theme-color for mobile / PWA status bars
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', theme === 'light' ? '#f8fafc' : '#0f172a');
    }
  }, [theme]);

  const setTheme = useCallback(
    (newTheme: ThemeMode) => {
      setThemeState(newTheme);
      localStorage.setItem(THEME_STORAGE_KEY, newTheme);
      if (updateAuthTheme) {
        updateAuthTheme(newTheme);
      }
    },
    [updateAuthTheme]
  );

  const toggleTheme = useCallback(() => {
    const nextTheme: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        toggleTheme,
        isLight: theme === 'light',
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
