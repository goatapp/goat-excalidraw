import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';

type ThemePreference = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextType {
  themePreference: ThemePreference;
  theme: ResolvedTheme;
  setThemePreference: (preference: ThemePreference) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    return 'system';
  });

  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const theme: ResolvedTheme = themePreference === 'system' ? systemTheme : themePreference;

  useEffect(() => {
    localStorage.setItem('theme', themePreference);

    const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
    if (link) {
      link.href = theme === 'dark' ? '/favicon-dark.svg' : '/favicon-light.svg';
    }

    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme, themePreference]);

  const toggleTheme = () => {
    setThemePreference((prev) => {
      if (prev === 'light') return 'dark';
      if (prev === 'dark') return 'light';
      return systemTheme === 'dark' ? 'light' : 'dark';
    });
  };

  const value = useMemo(
    () => ({ themePreference, theme, setThemePreference, toggleTheme }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [themePreference, theme],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
