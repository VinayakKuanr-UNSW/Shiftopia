
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5, // 5 minutes
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

