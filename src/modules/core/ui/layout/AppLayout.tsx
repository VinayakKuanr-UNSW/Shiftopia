import React from 'react';
import AppSidebar from './sidebar/AppSidebar';
import BottomNavbar from './BottomNavbar';
import MobileSafeAreaShell from './MobileSafeAreaShell';
import { cn } from '@/modules/core/lib/utils';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/modules/core/ui/primitives/sheet';
import { useSidebar } from '@/modules/core/ui/primitives/sidebar';
import { useTranslation } from 'react-i18next';

/**
 * How far page content starts from the left on desktop: the floating sidebar
 * card (240px / 76px collapsed) plus its 16px gutter. Full-screen views that
 * position themselves (fixed) must use this rather than a pixel guess.
 */
export const contentOffsetClass = (isCollapsed: boolean) =>
  isCollapsed ? "md:left-[92px]" : "md:left-[256px]";

interface AppLayoutProps {
  children: React.ReactNode;
  noPadding?: boolean;
}

const AppLayout: React.FC<AppLayoutProps> = ({ children, noPadding = false }) => {
  useTranslation();
  const { state, openMobile, setOpenMobile } = useSidebar();
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

      {/* Sidebar - Desktop floating card with smooth width transition */}
      <div
        className={cn(
          "hidden md:block fixed left-4 top-4 bottom-4 lg:left-6 lg:top-6 lg:bottom-6 z-50 isolate transition-all duration-300 ease-in-out",
          isCollapsed ? "w-[76px]" : "w-[240px]"
        )}
      >
        <AppSidebar />
      </div>

      {/* Main Area */}
      <main
        id="main-content"
        tabIndex={-1}
        className={cn(
          "flex-1 min-h-0 min-w-0 transition-all duration-300 ease-in-out safe-area-x relative isolate",
          isCollapsed ? "md:ml-[92px]" : "md:ml-[256px]",
          // Roster pages must not scroll at top level
          noPadding
            ? "p-0 overflow-hidden bg-background"
            // Normal pages scroll vertically. Bottom padding only needs to clear
            // the floating mobile nav — a hair above its top edge keeps info
            // density high instead of leaving a large dead gap.
            // overflow-x-hidden ensures the entire page never scrolls horizontally under the fixed sidebar.
            : "p-4 sm:p-6 md:p-8 pb-[calc(var(--mobile-bottom-nav-clearance,90px)+0.75rem)] md:pb-8 overflow-y-auto overflow-x-hidden bg-background"
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
