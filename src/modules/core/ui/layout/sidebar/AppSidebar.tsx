import React, { memo, useState, useRef, useEffect, useMemo } from 'react';
import { useLocation, NavLink } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { biddingApi, swapsApi } from '@/modules/planning';
import { prefetchRouteChunk } from '@/router/routePrefetch';
import {
  Calendar,
  Clock,
  Users,
  Workflow,
  CalendarDays,
  FileSpreadsheet,
  BellRing,
  BadgeCheck,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  TrendingUp,
  UserCircle2,
  Shield,
  ShieldX,
  FolderKanban,
  Sparkles,
  Radio,
  LucideIcon,
  Activity,
  Palmtree,
  Wallet,
  Grid3x3,
  Search,
  Fingerprint,
} from 'lucide-react';
import { useAuth } from '@/platform/auth/useAuth';
import { cn } from '@/modules/core/lib/utils';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { useNotifications } from '@/modules/core/hooks/useNotifications';
import { usePersona } from '@/platform/auth/PersonaProvider';
import { useSidebar } from '@/modules/core/ui/primitives/sidebar';
import { SidebarUser } from './SidebarUser';
import { QuickSearchDialog } from './QuickSearchDialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from '@/modules/core/ui/primitives/hover-card';
import { useTranslation } from 'react-i18next';

/* ============================================================
   SWISS CROSS LOGO COMPONENT (Matches Reference Design)
   ============================================================ */
const AppCrossLogo: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={cn("w-6 h-6 text-foreground", className)}
    aria-hidden="true"
  >
    <rect x="8.5" y="2" width="7" height="20" rx="3.5" />
    <rect x="2" y="8.5" width="20" height="7" rx="3.5" />
  </svg>
);

/* ============================================================
   TYPES FOR NAVIGATION TREE
   ============================================================ */
export interface NavLeafItem {
  to: string;
  label: string;
  description?: string;
  badge?: string;
  permission?: string;
  onMouseEnter?: () => void;
}

export interface NavGroupSection {
  id: string;
  title: string;
  icon: LucideIcon;
  items: NavLeafItem[];
  defaultOpen?: boolean;
}

/* ============================================================
   EXPANDED TREE GROUP COMPONENT
   ============================================================ */
interface ExpandedNavGroupProps {
  section: NavGroupSection;
  isRouteActive: (path: string) => boolean;
  isOpen: boolean;
  onToggle: () => void;
}

const ExpandedNavGroup: React.FC<ExpandedNavGroupProps> = ({
  section,
  isRouteActive,
  isOpen,
  onToggle,
}) => {
  const Icon = section.icon;
  const isAnyChildActive = section.items.some(item => isRouteActive(item.to));

  return (
    <div className="space-y-1">
      {/* Group Header Button */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={`nav-section-${section.id}`}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 rounded-2xl text-[13px] font-medium transition-all group",
          isAnyChildActive
            ? "bg-muted/70 text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
        )}
      >
        <div className="flex items-center gap-3">
          <div className={cn(
            "h-8 w-8 rounded-xl flex items-center justify-center transition-colors",
            isAnyChildActive
              ? "bg-foreground/10 text-foreground"
              : "text-muted-foreground group-hover:text-foreground"
          )}>
            <Icon className="h-[18px] w-[18px]" />
          </div>
          <span className="font-semibold text-[13px]">{section.title}</span>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
            isOpen ? "rotate-0" : "-rotate-90"
          )}
        />
      </button>

      {/* Tree Connector & Indented Leaves */}
      {isOpen && (
        <div id={`nav-section-${section.id}`} className="relative pl-7 pt-0.5 pb-1 space-y-0.5">
          {section.items.map((item, index) => {
            const active = isRouteActive(item.to);
            const isLast = index === section.items.length - 1;

            return (
              <div key={item.to} className="relative flex items-center min-h-[34px]">
                {/* Curved Elbow Tree Line */}
                <div className="absolute -left-3.5 top-0 bottom-0 w-3 pointer-events-none" aria-hidden="true">
                  {/* Stem */}
                  <div
                    className={cn(
                      "absolute left-0 top-0 w-px bg-border/70",
                      isLast ? "h-[17px]" : "h-full"
                    )}
                  />
                  {/* Elbow Branch */}
                  <div className="absolute left-0 top-[17px] w-2.5 h-2 border-b border-l border-border/70 rounded-bl-sm" />
                </div>

                {/* Leaf Item Link */}
                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <NavLink
                      to={item.to}
                      onMouseEnter={() => {
                        prefetchRouteChunk(item.to);
                        item.onMouseEnter?.();
                      }}
                      onFocus={() => {
                        prefetchRouteChunk(item.to);
                        item.onMouseEnter?.();
                      }}
                      className={cn(
                        "flex-1 flex items-center justify-between px-3 py-1.5 rounded-xl text-[13px] font-medium transition-all",
                        active
                          ? "bg-muted text-foreground font-semibold shadow-sm"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                      )}
                    >
                      <span className="truncate">{item.label}</span>
                      {item.badge && (
                        <Badge variant="secondary" className="ml-2 text-[11px] px-1.5 py-0 h-4 font-bold">
                          {item.badge}
                        </Badge>
                      )}
                    </NavLink>
                  </TooltipTrigger>
                  {item.description && (
                    <TooltipContent side="right" sideOffset={8} className="text-[12px]">
                      {item.description}
                    </TooltipContent>
                  )}
                </Tooltip>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/* ============================================================
   COLLAPSED RAIL GROUP WITH HOVER FLYOUT (Radix Portal)
   ============================================================ */
interface CollapsedNavRailGroupProps {
  section: NavGroupSection;
  isRouteActive: (path: string) => boolean;
}

const CollapsedNavRailGroup: React.FC<CollapsedNavRailGroupProps> = ({
  section,
  isRouteActive,
}) => {
  const Icon = section.icon;
  const isAnyChildActive = section.items.some(item => isRouteActive(item.to));

  return (
    <HoverCard openDelay={80} closeDelay={150}>
      <div className="relative flex justify-center py-0.5">
        <HoverCardTrigger asChild>
          <button
            type="button"
            aria-label={section.title}
            className={cn(
              "h-10 w-10 rounded-2xl flex items-center justify-center transition-all outline-none cursor-pointer",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background",
              isAnyChildActive
                ? "bg-muted/80 text-foreground shadow-sm border border-border/40"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
            )}
          >
            <Icon className="h-5 w-5" />
          </button>
        </HoverCardTrigger>

        {/* Flyout Popover Menu via Radix Portal */}
        <HoverCardContent
          side="right"
          align="start"
          sideOffset={14}
          className={cn(
            "z-50 min-w-[180px] w-auto p-3 rounded-2xl",
            "bg-popover/98 backdrop-blur-xl border border-border shadow-2xl",
            "animate-in fade-in-0 zoom-in-95 duration-150 motion-reduce:transition-none"
          )}
        >
          <div className="px-2 py-1 mb-1 border-b border-border/40 pb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              {section.title}
            </span>
          </div>

          <div className="relative pl-5 pt-1 space-y-0.5">
            {section.items.map((item, index) => {
              const active = isRouteActive(item.to);
              const isLast = index === section.items.length - 1;

              return (
                <div key={item.to} className="relative flex items-center min-h-[32px]">
                  {/* Curved Elbow Tree Line */}
                  <div className="absolute -left-3.5 top-0 bottom-0 w-3 pointer-events-none" aria-hidden="true">
                    <div
                      className={cn(
                        "absolute left-0 top-0 w-px bg-border/80",
                        isLast ? "h-[16px]" : "h-full"
                      )}
                    />
                    <div className="absolute left-0 top-[16px] w-2.5 h-2 border-b border-l border-border/80 rounded-bl-sm" />
                  </div>

                  {/* Leaf NavLink */}
                  <NavLink
                    to={item.to}
                    onMouseEnter={() => {
                      prefetchRouteChunk(item.to);
                      item.onMouseEnter?.();
                    }}
                    className={cn(
                      "flex-1 flex items-center justify-between px-2.5 py-1.5 rounded-xl text-[13px] font-medium transition-all",
                      active
                        ? "bg-muted text-foreground font-semibold shadow-sm"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                    )}
                  >
                    <span className="truncate">{item.label}</span>
                    {item.badge && (
                      <Badge variant="secondary" className="ml-2 text-[11px] px-1.5 py-0 h-4 font-bold">
                        {item.badge}
                      </Badge>
                    )}
                  </NavLink>
                </div>
              );
            })}
          </div>
        </HoverCardContent>
      </div>
    </HoverCard>
  );
};

/* ============================================================
   SINGLE STANDALONE NAV ITEM (e.g. Notifications)
   ============================================================ */
interface StandaloneNavItemProps {
  to: string;
  icon: LucideIcon;
  label: string;
  isActive: boolean;
  isCollapsed: boolean;
  badge?: string;
  description?: string;
  onMouseEnter?: () => void;
}

const StandaloneNavItem: React.FC<StandaloneNavItemProps> = ({
  to,
  icon: Icon,
  label,
  isActive,
  isCollapsed,
  badge,
  description,
  onMouseEnter,
}) => {
  const content = (
    <NavLink
      to={to}
      onMouseEnter={() => {
        prefetchRouteChunk(to);
        onMouseEnter?.();
      }}
      onFocus={() => {
        prefetchRouteChunk(to);
        onMouseEnter?.();
      }}
      className={cn(
        "transition-all duration-200 flex items-center outline-none",
        isCollapsed
          ? "h-10 w-10 mx-auto rounded-2xl justify-center relative"
          : "h-11 px-3.5 rounded-2xl gap-3 text-[13px] font-medium w-full",
        isActive
          ? "bg-muted/80 text-foreground font-semibold shadow-sm border border-border/40"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
      )}
    >
      <Icon className="h-5 w-5 shrink-0" />
      {!isCollapsed && (
        <span className="flex-1 truncate text-[13px]">{label}</span>
      )}
      {badge && (
        <Badge
          variant="secondary"
          className={cn(
            isCollapsed
              ? "absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full text-[11px] font-bold flex items-center justify-center p-0"
              : "ml-auto text-[11px] font-bold px-1.5 py-0 h-4"
          )}
        >
          {badge}
        </Badge>
      )}
    </NavLink>
  );

  if (isCollapsed) {
    return (
      <Tooltip delayDuration={150}>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={12} className="text-[12px] font-medium">
          {label} {badge ? `(${badge})` : ''}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip delayDuration={350}>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      {description && (
        <TooltipContent side="right" sideOffset={12} className="text-[12px]">
          {description}
        </TooltipContent>
      )}
    </Tooltip>
  );
};

/* ============================================================
   MAIN APP SIDEBAR COMPONENT
   ============================================================ */
const AppSidebar: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const { user, hasPermission } = useAuth();
  const { persona } = usePersona();
  const isEmployee = persona === 'employee';
  const isEmployer = persona === 'employer';
  const isAdmin = persona === 'admin';
  const { unreadCount } = useNotifications();
  const queryClient = useQueryClient();
  const { state, toggleSidebar, isMobile } = useSidebar();
  const isCollapsed = !isMobile && state === 'collapsed';

  // State for search dialog
  const [searchOpen, setSearchOpen] = useState(false);

  // Expanded sections open/close state
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    work: true,
    requests: true,
    communication: true,
    rostering: true,
    management: true,
    features: true,
    admin: true,
  });

  const toggleSection = (sectionId: string) => {
    setOpenSections(prev => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  // Helper function to check if a route is active
  const isRouteActive = (path: string): boolean => {
    if (path === location.pathname) return true;
    if (path !== '/' && location.pathname.startsWith(path)) {
      return true;
    }
    return false;
  };

  // Prefetching logic for predictive loading
  const handlePrefetch = (route: string) => {
    switch (route) {
      case '/my-bids':
        if (user?.id) {
          queryClient.prefetchQuery({
            queryKey: ['bids', 'employee', user.id],
            queryFn: () => biddingApi.getMyBids(user.id),
          });
        }
        break;
      case '/management/bids':
        queryClient.prefetchQuery({
          queryKey: ['bids'],
          queryFn: biddingApi.getAllBids,
        });
        break;
      case '/my-swaps':
        if (user?.id) {
          queryClient.prefetchQuery({
            queryKey: ['swapRequests', 'my', user.id],
            queryFn: () => swapsApi.getMySwaps(user.id),
          });
        }
        break;
      default:
        break;
    }
  };

  // Build nav sections based on persona and permissions
  const navSections: NavGroupSection[] = useMemo(() => {
    const sections: NavGroupSection[] = [];

    if (isEmployee) {
      sections.push({
        id: 'work',
        title: t('nav.work', 'Work'),
        icon: UserCircle2,
        items: [
          {
            to: '/my-roster',
            label: t('nav.my_roster', 'My Roster'),
            description: 'Your assigned shifts',
          },
          {
            to: '/my-attendance',
            label: t('nav.my_attendance', 'Clock In / Out'),
            description: 'Digital time clock',
          },
          {
            to: '/my-availabilities',
            label: t('nav.my_availabilities', 'Availabilities'),
            description: 'Manage schedule availability',
          },
        ],
      });

      sections.push({
        id: 'requests',
        title: t('nav.requests', 'Requests'),
        icon: BadgeCheck,
        items: [
          {
            to: '/my-bids',
            label: t('nav.my_bids', 'My Bids'),
            description: 'Shift bid requests',
            onMouseEnter: () => handlePrefetch('/my-bids'),
          },
          {
            to: '/my-swaps',
            label: t('nav.my_swaps', 'My Swaps'),
            description: 'Manage shift trades',
            onMouseEnter: () => handlePrefetch('/my-swaps'),
          },
          {
            to: '/my-leave',
            label: t('nav.my_leave', 'My Leave'),
            description: 'Balances & time off',
            onMouseEnter: () => handlePrefetch('/my-leave'),
          },
        ],
      });

      sections.push({
        id: 'communication',
        title: t('nav.communication', 'Communication'),
        icon: Radio,
        items: [
          {
            to: '/my-broadcasts',
            label: t('nav.my_broadcasts', 'Broadcasts'),
            description: 'View announcements',
          },
          {
            to: '/performance',
            label: t('nav.performance', 'Performance'),
            description: 'Attendance & metrics',
          },
        ],
      });
    }

    if (isEmployer) {
      const rosteringItems: NavLeafItem[] = [];
      if (hasPermission('rosters')) {
        rosteringItems.push({
          to: '/rosters',
          label: t('nav.rosters', 'Rosters'),
          description: 'Manage schedule grid',
        });
      }
      if (hasPermission('templates')) {
        rosteringItems.push({
          to: '/templates',
          label: t('nav.templates', 'Templates'),
          description: 'Shift templates',
        });
      }
      if (hasPermission('timesheet-view')) {
        rosteringItems.push({
          to: '/timesheet',
          label: t('nav.timesheet', 'Timesheet'),
          description: 'Time tracking',
        });
      }
      if (rosteringItems.length > 0) {
        sections.push({
          id: 'rostering',
          title: t('nav.rostering', 'Rostering'),
          icon: FolderKanban,
          items: rosteringItems,
        });
      }

      if (hasPermission('management')) {
        sections.push({
          id: 'management',
          title: t('nav.management', 'Management'),
          icon: Shield,
          items: [
            {
              to: '/management/bids',
              label: t('nav.open_bids', 'Open Bids'),
              description: 'Review bid requests',
              onMouseEnter: () => handlePrefetch('/management/bids'),
            },
            {
              to: '/management/swaps',
              label: t('nav.swap_requests', 'Swap Requests'),
              description: 'Approve shift swaps',
            },
            {
              to: '/team-availability',
              label: t('nav.grid', 'Grid'),
              description: 'Hours, compliance & grid',
            },
            {
              to: '/management/leave',
              label: t('nav.leave_approvals', 'Leave Approvals'),
              description: 'Approve staff leave',
            },
            {
              to: '/management/payroll',
              label: t('nav.gross_pay', 'Gross Pay'),
              description: 'Earnings report',
            },
          ],
        });
      }

      const featureItems: NavLeafItem[] = [];
      if (hasPermission('broadcast')) {
        featureItems.push({
          to: '/broadcast',
          label: t('nav.broadcast', 'Broadcast'),
          description: 'Send notifications',
        });
      }
      if (hasPermission('insights')) {
        featureItems.push({
          to: '/insights',
          label: t('nav.insights', 'Insights'),
          description: 'Attendance & analytics',
        });
      }
      if (featureItems.length > 0) {
        sections.push({
          id: 'features',
          title: t('nav.features', 'Features'),
          icon: Sparkles,
          items: featureItems,
        });
      }
    }

    if (isAdmin) {
      const adminItems: NavLeafItem[] = [];
      if (hasPermission('labor-demand')) {
        adminItems.push({
          to: '/labor-demand',
          label: t('nav.labor_demand', 'Labor Demand'),
          description: 'Demand forecasting',
        });
      }
      if (hasPermission('users')) {
        adminItems.push({
          to: '/users',
          label: t('nav.users', 'Users'),
          description: 'Manage users',
        });
      }
      if (hasPermission('compliance')) {
        adminItems.push({
          to: '/compliance/rejections',
          label: t('nav.compliance_rejections', 'Compliance Rejections'),
          description: 'Audit blocked operations',
          onMouseEnter: () => handlePrefetch('/compliance/rejections'),
        });
      }
      if (adminItems.length > 0) {
        sections.push({
          id: 'admin',
          title: t('common.admin', 'Admin'),
          icon: Shield,
          items: adminItems,
        });
      }
    }

    return sections;
  }, [isEmployee, isEmployer, isAdmin, hasPermission, t]);

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        aria-label="Sidebar navigation"
        className={cn(
          "h-full w-full flex flex-col relative transition-all duration-300 ease-in-out select-none motion-reduce:transition-none",
          isMobile
            ? "bg-card border-r border-border"
            : "rounded-[26px] bg-card/95 dark:bg-[#161f32]/95 backdrop-blur-md border border-border/50 shadow-lg"
        )}
      >
        {/* ==================== COLLAPSE TOGGLE ARROW BUTTON ==================== */}
        {!isMobile && (
          <button
            type="button"
            onClick={() => toggleSidebar()}
            aria-label={isCollapsed ? "Expand navigation sidebar" : "Collapse navigation sidebar"}
            aria-expanded={!isCollapsed}
            className={cn(
              "absolute -right-3 top-5 z-40 h-6 w-6 rounded-full bg-card border border-border shadow-md",
              "flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all cursor-pointer",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "before:absolute before:inset-[-10px] before:content-['']"
            )}
          >
            {isCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronLeft className="h-3.5 w-3.5" />
            )}
          </button>
        )}

        {/* ==================== HEADER (LOGO) ==================== */}
        <div className={cn("pt-4 pb-2.5 px-3.5", isCollapsed ? "flex justify-center" : "")}>
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl flex items-center justify-center shrink-0">
              <AppCrossLogo className="h-6 w-6" />
            </div>
            {!isCollapsed && (
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-[17px] text-foreground tracking-tight">
                    ShiftoPia
                  </span>
                  <span className="text-[11px] text-muted-foreground font-mono tracking-tighter">
                    v9.0
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ==================== SEARCH BAR ==================== */}
        <div className={cn("px-3 pb-3", isCollapsed ? "flex justify-center" : "")}>
          {isCollapsed ? (
            <Tooltip delayDuration={150}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setSearchOpen(true)}
                  aria-label="Search navigation (⌘S / ⌘K)"
                  aria-keyshortcuts="Control+S Meta+S"
                  className={cn(
                    "h-10 w-10 rounded-2xl border border-border/70 bg-muted/50",
                    "hover:bg-muted/70 hover:text-foreground flex items-center justify-center text-muted-foreground transition-all outline-none",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
                  )}
                >
                  <Search className="h-[18px] w-[18px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={12} className="text-[12px] font-medium">
                Search (⌘S)
              </TooltipContent>
            </Tooltip>
          ) : (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Search navigation (⌘S / ⌘K)"
              aria-keyshortcuts="Control+S Meta+S"
              className={cn(
                "w-full flex items-center justify-between px-3 py-2 rounded-2xl border border-border/70",
                "bg-muted/50 hover:bg-muted/70 hover:border-border transition-all text-[13px] text-muted-foreground group outline-none",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
              )}
            >
              <div className="flex items-center gap-2.5">
                <Search className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                <span className="text-[13px] font-normal">Search</span>
              </div>
              <div className="flex items-center gap-1">
                <kbd className="h-5 min-w-[20px] px-1 rounded-md border border-border/80 bg-background/70 text-[11px] font-mono text-muted-foreground flex items-center justify-center shadow-sm">
                  ⌘
                </kbd>
                <kbd className="h-5 min-w-[20px] px-1 rounded-md border border-border/80 bg-background/70 text-[11px] font-mono text-muted-foreground flex items-center justify-center shadow-sm">
                  S
                </kbd>
              </div>
            </button>
          )}
        </div>

        {/* ==================== NAVIGATION AREA ==================== */}
        <nav
          aria-label="Main Navigation"
          className="flex-1 overflow-y-auto no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden px-2 space-y-2 py-1"
        >
          {/* Navigation Groups (Tree when expanded, Icon + Flyout when collapsed) */}
          <div className="space-y-1">
            {navSections.map(section => {
              if (isCollapsed) {
                return (
                  <CollapsedNavRailGroup
                    key={section.id}
                    section={section}
                    isRouteActive={isRouteActive}
                  />
                );
              }

              return (
                <ExpandedNavGroup
                  key={section.id}
                  section={section}
                  isRouteActive={isRouteActive}
                  isOpen={openSections[section.id] ?? true}
                  onToggle={() => toggleSection(section.id)}
                />
              );
            })}

            {/* Standalone Item: Notifications */}
            <StandaloneNavItem
              to="/my-notifications"
              icon={BellRing}
              label={t('nav.my_notifications', 'Notification')}
              isActive={isRouteActive('/my-notifications')}
              isCollapsed={isCollapsed}
              badge={unreadCount > 0 ? (unreadCount > 9 ? '9+' : String(unreadCount)) : undefined}
              description="View workspace updates"
            />
          </div>
        </nav>

        {/* ==================== FOOTER / USER CARD ==================== */}
        <div className="p-2">
          <SidebarUser isCollapsed={isCollapsed} />
        </div>

        {/* Quick Search Dialog (⌘S / ⌘K) */}
        <QuickSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      </aside>
    </TooltipProvider>
  );
};

export default AppSidebar;
