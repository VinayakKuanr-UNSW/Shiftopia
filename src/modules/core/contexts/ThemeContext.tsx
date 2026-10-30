import { applyBrandColor } from '@/modules/core/lib/brandColor';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/platform/supabase/client';
import { useAuth } from '@/platform/auth/useAuth';

/* ============================================================
   HELPERS
   ============================================================ */

/* ============================================================
   THEME TYPES - Only Light and Dark
   ============================================================ */
type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/* ============================================================
   THEME PROVIDER
   ============================================================ */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { accessScope } = useAuth();
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      const storedTheme = localStorage.getItem('theme') as Theme;
      if (storedTheme && ['light', 'dark'].includes(storedTheme)) {
        return storedTheme;
      }
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    }
    return 'dark';
  });

  // Apply Light/Dark Theme Class
  useEffect(() => {
    const root = window.document.documentElement;
    
    // Disable transitions during the switch to prevent "lag" from thousands of 
    // simultaneous property animations.
    root.setAttribute('data-theme-switching', 'true');
    
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    localStorage.setItem('theme', theme);

    const timer = setTimeout(() => {
      root.removeAttribute('data-theme-switching');
    }, 300);

    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', theme === 'dark' ? '#0f172a' : '#ffffff');
    }

    return () => clearTimeout(timer);
  }, [theme]);

  // Apply Organizational Branding (Brand Color)
  useEffect(() => {
    const applyColor = (color: string) => {
      if (color) applyBrandColor(color);
    };

    if (accessScope?.organizationId) {
      const fetchAndApplyBranding = async () => {
        try {
          const { data, error } = await supabase
            .from('organizations')
            .select('branding')
            .eq('id', accessScope.organizationId as string)
            .single();

          if (error) throw error;
          applyColor((data?.branding as any)?.brand_color);
        } catch (err) {
          console.error('[ThemeContext] Failed to apply branding:', err);
        }
      };
      fetchAndApplyBranding();
    }

    // Direct listener for instant updates from settings page
    const handleUpdate = (e: any) => {
      if (e.detail?.brand_color) {
        applyColor(e.detail.brand_color);
      }
    };

    window.addEventListener('branding-updated', handleUpdate);
    return () => window.removeEventListener('branding-updated', handleUpdate);
  }, [accessScope?.organizationId]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem('theme')) {
        setTheme(e.matches ? 'dark' : 'light');
      }
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const toggleTheme = () => {
    setTheme((prevTheme) => (prevTheme === 'dark' ? 'light' : 'dark'));
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, isDark: theme === 'dark' }}>
      {children}
    </ThemeContext.Provider>
  );
}

/* ============================================================
   USE THEME HOOK
   ============================================================ */
export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
