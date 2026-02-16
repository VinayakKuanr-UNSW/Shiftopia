import React, { useState } from 'react';
import AppSidebar from './sidebar/AppSidebar';
import { cn } from '@/modules/core/lib/utils';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';

interface AppLayoutProps {
  children: React.ReactNode;
  noPadding?: boolean;
}

const AppLayout: React.FC<AppLayoutProps> = ({ children, noPadding = false }) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">

      {/* Sidebar - Fixed position, slides in/out */}
      <div
        className={cn(
          "hidden md:block fixed left-0 top-0 h-screen z-40 transition-transform duration-300 ease-in-out",
          sidebarCollapsed ? "-translate-x-full" : "translate-x-0"
        )}
      >
        <AppSidebar />
      </div>

      {/* Collapse Toggle Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        className={cn(
          "hidden md:flex fixed top-4 z-50 h-8 w-8 rounded-full bg-card border border-border/50 shadow-md hover:bg-muted transition-all duration-300",
          sidebarCollapsed ? "left-4" : "left-[268px]"
        )}
      >
        {sidebarCollapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronLeft className="h-4 w-4" />
        )}
      </Button>

      {/* Main Area */}
      <main
        className={cn(
          "flex-1 min-h-0 transition-all duration-300 ease-in-out",
          sidebarCollapsed ? "md:ml-0" : "md:ml-[280px]",
          // Roster pages must not scroll at top level
          noPadding
            ? "p-0 overflow-hidden bg-background"
            // Normal pages scroll normally
            : "p-8 overflow-auto bg-background bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background"
        )}
      >
        {/* Critical Fix: use min-h-0 instead of h-full */}
        <div className="min-h-0 w-full h-full">
          {children}
        </div>
      </main>
    </div>
  );
};

export default AppLayout;
