import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import AppSidebar from './sidebar/AppSidebar';
import BottomNavbar from './BottomNavbar';
import MobileSafeAreaShell from './MobileSafeAreaShell';
import { cn } from '@/modules/core/lib/utils';
import { ChevronLeft, ChevronRight, Settings } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/modules/core/ui/primitives/sheet';
import { useSidebar } from '@/modules/core/ui/primitives/sidebar';
import { useTranslation } from 'react-i18next';

interface AppLayoutProps {
  children: React.ReactNode;
  noPadding?: boolean;
}

const AppLayout: React.FC<AppLayoutProps> = ({ children, noPadding = false }) => {
  const { t } = useTranslation();
  const { state, openMobile, setOpenMobile, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";

  return (
    <div className="mobile-bottom-safe-vars flex h-screen w-screen overflow-hidden bg-background">
      <a
        href="#main-content"
        className="sr-only fixed left-4 top-4 z-[200] rounded-lg bg-background px-4 py-3 font-semibold text-foreground shadow-lg ring-2 ring-ring focus:not-sr-only"
      >
        Skip to main content
      </a>

      {/* Mobile Sidebar Drawer */}
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent side="left" className="p-0 w-[280px] border-r border-border" aria-describedby="app-sidebar-description">
          <div className="sr-only">
            <SheetTitle>Navigation Menu</SheetTitle>
            <SheetDescription id="app-sidebar-description">
              Main navigation links and modules
            </SheetDescription>
          </div>
          <AppSidebar />
        </SheetContent>
      </Sheet>

      {/* Sidebar - Fixed position, slides in/out (desktop only) */}
      <div
        className={cn(
          "hidden md:block fixed left-0 top-0 h-screen z-40 transition-transform duration-300 ease-in-out",
          isCollapsed ? "-translate-x-full" : "translate-x-0"
        )}
      >
        <AppSidebar />
      </div>

      {/* Collapse Toggle Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => toggleSidebar()}
        aria-label={isCollapsed ? "Expand navigation sidebar" : "Collapse navigation sidebar"}
        aria-expanded={!isCollapsed}
        className={cn(
          "hidden md:flex fixed top-4 z-40 h-8 w-8 rounded-full bg-card border border-border/50 shadow-md hover:bg-muted transition-all duration-300",
          isCollapsed ? "left-4" : "left-[268px]"
        )}
      >
        {isCollapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronLeft className="h-4 w-4" />
        )}
      </Button>

      {/* Main Area */}
      <main
        id="main-content"
        tabIndex={-1}
        className={cn(
        "flex-1 min-h-0 transition-all duration-300 ease-in-out safe-area-x",
          isCollapsed ? "md:ml-0" : "md:ml-[280px]",
          // Roster pages must not scroll at top level
          noPadding
            ? "p-0 overflow-hidden bg-background"
            // Normal pages scroll normally. Bottom padding only needs to clear
            // the floating mobile nav — a hair above its top edge keeps info
            // density high instead of leaving a large dead gap.
            : "p-4 sm:p-6 md:p-8 pb-[calc(var(--mobile-bottom-nav-clearance,90px)+0.75rem)] md:pb-8 overflow-auto bg-background"
        )}
      >
        <MobileSafeAreaShell>
          {children}
        </MobileSafeAreaShell>
      </main>

      {/* Mobile Bottom Navbar */}
      <BottomNavbar />
    </div>
  );
};

export default AppLayout;
