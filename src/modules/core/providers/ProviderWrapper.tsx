
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { TooltipProvider } from '@/modules/core/ui/primitives/tooltip';
import { AuthProvider } from '@/platform/auth/AuthProvider';
import { SearchProvider } from '@/modules/core/contexts/SearchContext';
import { ThemeProvider } from '@/modules/core/contexts/ThemeContext';
import { OrgSelectionProvider } from '@/modules/core/contexts/OrgSelectionContext';
import { RosterUIProvider } from '@/modules/rosters/contexts/RosterUIContext';
import { SidebarProvider } from '@/modules/core/ui/primitives/sidebar';
import { Toaster } from '@/modules/core/ui/primitives/toaster';
import { Toaster as Sonner } from '@/modules/core/ui/primitives/sonner';

/**
 * Smart retry: skip immediately on 4xx client errors (auth failures, validation,
 * not-found) — retrying won't help. Allow up to 2 retries for network errors
 * and 5xx server errors with exponential back-off.
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  const status = (error as { status?: number })?.status;
  // 4xx = client error; no point retrying
  if (status && status >= 400 && status < 500) return false;
  return true;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry:     shouldRetry,
      retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 10_000), // 1s → 2s → cap 10s

      // 30 s default staleTime — short enough for operational shift data to stay
      // fresh, long enough to avoid unnecessary refetches on every mount.
      // Per-hook staleTime overrides this (lookup hooks use 5 min, list hooks 0).
      staleTime: 30_000,

      // Keep query data in memory for 10 min after the last subscriber unmounts.
      // Navigating away and back renders instantly from cache + background refetch.
      gcTime: 10 * 60_000,

      // Refetch when the user returns to the tab — critical for roster managers
      // who work across multiple browser tabs simultaneously.
      refetchOnWindowFocus: true,

      // Refetch automatically when the network comes back online.
      refetchOnReconnect: true,
    },
    mutations: {
      // Never retry mutations — they are not guaranteed to be idempotent.
      retry: false,
    },
  },
});

interface ProviderWrapperProps {
  children: React.ReactNode;
}

const ProviderWrapper: React.FC<ProviderWrapperProps> = ({ children }) => {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <AuthProvider>
            <OrgSelectionProvider>
              <SearchProvider>
                <SidebarProvider defaultOpen={false}>
                  <div className="h-full w-full overflow-hidden">
                    <Toaster />
                    <Sonner />
                    <RosterUIProvider>
                      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                        {children}
                      </BrowserRouter>
                    </RosterUIProvider>
                  </div>
                </SidebarProvider>
              </SearchProvider>
            </OrgSelectionProvider>
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default ProviderWrapper;

