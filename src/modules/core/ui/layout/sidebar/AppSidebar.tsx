import { memo, useState } from 'react';
import { useLocation, NavLink } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { biddingApi, swapsApi } from '@/modules/planning';
import {
  Calendar,
  LayoutDashboard,
  Clock,
  Users,
  Workflow,
  CalendarDays,
  FileSpreadsheet,
  BellRing,
  BadgeCheck,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  HelpCircle,
  Settings,
  TrendingUp,
  UserCircle2,
  Shield,
  FolderKanban,
  Sparkles,
  Radio,
  LucideIcon,
  ClipboardList,
  FileText,
  LogOut,
} from 'lucide-react';
import { useAuth } from '@/platform/auth/useAuth';
import { cn } from '@/modules/core/lib/utils';
import { Button } from '@/modules/core/ui/primitives/button';
import { Separator } from '@/modules/core/ui/primitives/separator';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { ThemeSelector } from '@/modules/core/ui/components/ThemeSelector';
import { BroadcastNotifications } from '@/modules/core/ui/components/broadcast/BroadcastNotifications';
import { ACCESS_LEVEL_CONFIG } from '@/platform/auth/constants';
import { SidebarUser } from './SidebarUser';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/modules/core/ui/primitives/collapsible';

/* ============================================================
   ICON COLOR MAP
   ============================================================ */
type IconColorKey =
  | 'dashboard'
  | 'workspace'
  | 'myRoster'
  | 'availabilities'
  | 'myBids'
  | 'mySwaps'
  | 'myBroadcasts'
  | 'templates'
  | 'rosters'
  | 'timesheet'
  | 'openBids'
  | 'swapRequests'
  | 'broadcast'
  | 'insights'

  | 'management'
  | 'sectionMyWorkspace'
  | 'sectionRostering'
  | 'sectionManagement'
  | 'sectionFeatures'
  | 'logo'
  | 'help'
  | 'audit'
  | 'contracts';

const iconColorMap: Record<IconColorKey, string> = {
  dashboard: 'text-blue-400',
  workspace: 'text-purple-400',
  myRoster: 'text-cyan-400',
  availabilities: 'text-teal-400',
  myBids: 'text-pink-400',
  mySwaps: 'text-orange-400',
  myBroadcasts: 'text-rose-400',
  templates: 'text-sky-400',
  rosters: 'text-indigo-400',
  timesheet: 'text-amber-400',
  openBids: 'text-green-400',
  swapRequests: 'text-rose-400',
  broadcast: 'text-red-400',
  insights: 'text-yellow-400',

  management: 'text-lime-400',
  sectionMyWorkspace: 'text-purple-400',
  sectionRostering: 'text-blue-400',
  sectionManagement: 'text-green-400',
  sectionFeatures: 'text-amber-400',
  logo: 'text-white',
  help: 'text-blue-400',
  audit: 'text-emerald-400',
  contracts: 'text-violet-400',
};

/* ============================================================
   NAVIGATION ITEM COMPONENT
   ============================================================ */
interface NavigationItemProps {
  to: string;
  icon: LucideIcon;
  iconColor: string;
  label: string;
  isActive: boolean;
  badge?: string;
  description?: string;
  onMouseEnter?: () => void;
}

const NavigationItem = memo<NavigationItemProps>(
  ({ to, icon: Icon, iconColor, label, isActive, badge, description, onMouseEnter }) => (
    <NavLink
      to={to}
      onMouseEnter={onMouseEnter}
      className={cn(
        'group flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-200 relative overflow-hidden',
        isActive
          ? 'bg-gradient-to-r from-primary/20 to-primary/10 text-primary border border-primary/20 shadow-sm'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
      )}
    >
      {/* Active indicator */}
      {isActive && (
        <div className="absolute left-0 top-0 h-full w-1 bg-primary rounded-r-full" />
      )}

      {/* Icon */}
      <Icon
        className={cn(
          'h-6 w-6 transition-transform duration-200 group-hover:scale-110',
          iconColor,
          isActive ? 'drop-shadow' : ''
        )}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-center text-base">{label}</span>
          {badge && (
            <Badge variant="secondary" className="ml-2 text-xs">
              {badge}
            </Badge>
          )}
        </div>
        {description && (
          <p className="text-muted-foreground mt-0.5 truncate text-sm">
            {description}
          </p>
        )}
      </div>

      {isActive && <ChevronRight className="h-4 w-4 text-primary" />}
    </NavLink>
  )
);

NavigationItem.displayName = 'NavigationItem';

/* ============================================================
   COLLAPSIBLE SECTION COMPONENT
   ============================================================ */
interface CollapsibleSectionProps {
  icon: LucideIcon;
  title: string;
  color?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  icon: Icon,
  title,
  color = 'text-primary',
  children,
  defaultOpen = true,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="space-y-1">
      <CollapsibleTrigger className="flex items-center w-full group py-1 px-2 rounded-lg hover:bg-muted/30 transition-colors">
        <div className="flex items-center gap-3 flex-1 px-[25px]">
          <Icon className={cn('h-5 w-5', color)} />
          <span className="uppercase tracking-wider text-muted-foreground font-semibold text-sm">
            {title}
          </span>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground/50 transition-transform duration-200",
            isOpen ? "rotate-0" : "-rotate-90"
          )}
        />
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-1 data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down overflow-hidden">
        <div className="pt-1 pb-2">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};


/* ============================================================
   APP SIDEBAR COMPONENT
   ============================================================ */
const AppSidebar: React.FC = () => {
  const location = useLocation();
  const { user, hasPermission, logout } = useAuth();
  const queryClient = useQueryClient();

  // Helper function to check if a route is active
  const isRouteActive = (path: string): boolean => {
    if (path === location.pathname) return true;
    if (path !== '/dashboard' && location.pathname.startsWith(path))
      return true;
    return false;
  };

  // Prefetching logic for predictive loading
  const handlePrefetch = (route: string) => {
    switch (route) {
      case '/bids':
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

  return (
    <div className="h-screen w-[280px] flex flex-col bg-card/95 backdrop-blur-sm border-r border-border/50 shadow-lg">
      {/* ==================== HEADER ==================== */}
      <div className="p-6 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center shadow-md">
            <Sparkles className={cn('h-6 w-6', iconColorMap.logo)} />
          </div>
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">
              ShiftoPia <span className="text-[8px] text-primary/40 tracking-tight ml-2 font-light">v9.0</span>
            </h1>
            <p className="text-xs text-muted-foreground">
              Workforce Management
            </p>
          </div>
        </div>
      </div>

      {/* ==================== NAVIGATION ==================== */}
      <div className="flex-1 overflow-y-auto space-y-4 py-4 px-[15px]">
        {/* ---------- Main Navigation ---------- */}
        <div className="space-y-1">
          <NavigationItem
            to="/dashboard"
            icon={LayoutDashboard}
            iconColor={iconColorMap.dashboard}
            label="Dashboard"
            isActive={isRouteActive('/dashboard')}
            description="Overview & analytics"
          />
        </div>

        {/* ---------- My Workspace Section ---------- */}
        <CollapsibleSection
          icon={UserCircle2}
          title="Overview"
          color={iconColorMap.sectionMyWorkspace}
          defaultOpen={true}
        >
          <NavigationItem
            to="/my-roster"
            icon={Calendar}
            iconColor={iconColorMap.myRoster}
            label="My Roster"
            isActive={isRouteActive('/my-roster')}
            description="Your assigned shifts"
          />

          <NavigationItem
            to="/availabilities"
            icon={CalendarDays}
            iconColor={iconColorMap.availabilities}
            label="My Availabilities"
            isActive={isRouteActive('/availabilities')}
            description="Manage your schedule"
          />

          <NavigationItem
            to="/bids"
            icon={BadgeCheck}
            iconColor={iconColorMap.myBids}
            label="My Bids"
            isActive={isRouteActive('/bids')}
            description="Shift bid requests"
            onMouseEnter={() => handlePrefetch('/bids')}
          />

          <NavigationItem
            to="/my-swaps"
            icon={RefreshCw}
            iconColor={iconColorMap.mySwaps}
            label="My Swaps"
            isActive={isRouteActive('/my-swaps')}
            description="Manage shift swaps"
            onMouseEnter={() => handlePrefetch('/my-swaps')}
          />

          <NavigationItem
            to="/my-broadcasts"
            icon={Radio}
            iconColor={iconColorMap.myBroadcasts}
            label="My Broadcasts"
            isActive={isRouteActive('/my-broadcasts')}
            description="View announcements"
          />
        </CollapsibleSection>

        {/* ---------- Rostering Section ---------- */}
        {(hasPermission('templates') ||
          hasPermission('rosters') ||
          hasPermission('timesheet-view')) && (
            <CollapsibleSection
              icon={FolderKanban}
              title="Rostering"
              color={iconColorMap.sectionRostering}
              defaultOpen={true}
            >
              {hasPermission('templates') && (
                <NavigationItem
                  to="/templates"
                  icon={Workflow}
                  iconColor={iconColorMap.templates}
                  label="Templates"
                  isActive={isRouteActive('/templates')}
                  description="Shift templates"
                />
              )}

              {hasPermission('rosters') && (
                <NavigationItem
                  to="/rosters"
                  icon={FileSpreadsheet}
                  iconColor={iconColorMap.rosters}
                  label="Rosters"
                  isActive={isRouteActive('/rosters')}
                  description="Manage schedules"
                />
              )}

              {hasPermission('timesheet-view') && (
                <NavigationItem
                  to="/timesheet"
                  icon={Clock}
                  iconColor={iconColorMap.timesheet}
                  label="Timesheet"
                  isActive={isRouteActive('/timesheet')}
                  description="Time tracking"
                />
              )}
            </CollapsibleSection>
          )}

        {/* ---------- Management Section ---------- */}
        {hasPermission('management') && (
          <CollapsibleSection
            icon={Shield}
            title="Management"
            color={iconColorMap.sectionManagement}
            defaultOpen={true}
          >
            <NavigationItem
              to="/management/bids"
              icon={BadgeCheck}
              iconColor={iconColorMap.openBids}
              label="Open Bids"
              isActive={isRouteActive('/management/bids')}
              description="Review bid requests"
              onMouseEnter={() => handlePrefetch('/management/bids')}
            />

            <NavigationItem
              to="/management/swaps"
              icon={RefreshCw}
              iconColor={iconColorMap.swapRequests}
              label="Swap Requests"
              isActive={isRouteActive('/management/swaps')}
              description="Approve shift swaps"
            />
          </CollapsibleSection>
        )}

        {/* ---------- Features Section ---------- */}
        {(hasPermission('broadcast') ||
          hasPermission('insights') ||
          hasPermission('audit') ||
          hasPermission('management')) && (
            <CollapsibleSection
              icon={Sparkles}
              title="Features"
              color={iconColorMap.sectionFeatures}
              defaultOpen={true}
            >
              {hasPermission('broadcast') && (
                <NavigationItem
                  to="/broadcast"
                  icon={BellRing}
                  iconColor={iconColorMap.broadcast}
                  label="Broadcast"
                  isActive={isRouteActive('/broadcast')}
                  description="Send notifications"
                />
              )}

              {hasPermission('insights') && (
                <NavigationItem
                  to="/insights"
                  icon={TrendingUp}
                  iconColor={iconColorMap.insights}
                  label="Insights"
                  isActive={isRouteActive('/insights')}
                  description="Analytics & reports"
                />
              )}

              {/* Moved Audit & Users Here */}
              {hasPermission('audit') && (
                <NavigationItem
                  to="/audit"
                  icon={ClipboardList}
                  iconColor={iconColorMap.audit}
                  label="Audit Trail"
                  isActive={isRouteActive('/audit')}
                  description="System logs"
                />
              )}

              {hasPermission('management') && (
                <NavigationItem
                  to="/users"
                  icon={Users}
                  iconColor={iconColorMap.contracts}
                  label="Users"
                  isActive={isRouteActive('/users')}
                  description="Manage users"
                />
              )}
            </CollapsibleSection>
          )}
      </div>

      {/* ==================== FOOTER ==================== */}
      <div className="p-4 border-t border-border/50 space-y-4">
        {/* Quick Actions */}
        <div className="flex items-center justify-between">
          <ThemeSelector />
          <BroadcastNotifications isCollapsed={false} />
        </div>

        <Separator className="bg-border/30" />

        {/* User Profile */}
        <SidebarUser />
      </div>
    </div>
  );
};

export default AppSidebar;
