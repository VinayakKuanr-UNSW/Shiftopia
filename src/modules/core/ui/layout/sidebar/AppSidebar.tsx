import { memo } from 'react';
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
import { ProfileIdentityCard } from './ProfileIdentityCard';

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
  | 'configurations'
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
  configurations: 'text-gray-400',
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
   SECTION HEADER COMPONENT
   ============================================================ */
interface SectionHeaderProps {
  icon: LucideIcon;
  title: string;
  color?: string;
}

const SectionHeader = memo<SectionHeaderProps>(
  ({ icon: Icon, title, color = 'text-primary' }) => (
    <div className="flex items-center gap-3 mb-2 py-0 my-0 bg-inherit px-[40px] mx-0 rounded-full">
      <Icon className={cn('h-6 w-6', color)} />
      <span className="uppercase tracking-wider text-muted-foreground font-semibold text-base text-justify px-0 mx-0">
        {title}
      </span>
    </div>
  )
);

SectionHeader.displayName = 'SectionHeader';

/* ============================================================
   APP SIDEBAR COMPONENT
   ============================================================ */
const AppSidebar: React.FC = () => {
  const location = useLocation();
  const { user, activeContract, setActiveContractId, activeCertificateId, setActiveCertificateId, hasPermission, logout, activeCertificate } = useAuth();
  const queryClient = useQueryClient();

  const displayedLevel = activeCertificate?.accessLevel || user?.highestAccessLevel || 'alpha';
  const accessConfig = ACCESS_LEVEL_CONFIG[displayedLevel];
  const AccessIcon = accessConfig.icon;

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
              ShiftoPia <span className="text-[8px] text-white/30 tracking-tight ml-2">v8.3 Debugging</span>
            </h1>
            <p className="text-[8px] text-white/20 font-mono">
              PERM: rosters={String(hasPermission('rosters'))} | management={String(hasPermission('management'))}
            </p>
            <p className="text-xs text-muted-foreground">
              Workforce Management
            </p>
          </div>
        </div>
      </div>

      {/* ==================== NAVIGATION ==================== */}
      <div className="flex-1 overflow-y-auto space-y-6 py-4 px-[15px]">
        {/* ---------- Main Navigation ---------- */}
        <div className="space-y-2">
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
        <div className="space-y-2">
          <SectionHeader
            icon={UserCircle2}
            title="My Workspace"
            color={iconColorMap.sectionMyWorkspace}
          />

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
            label="Availabilities"
            isActive={isRouteActive('/availabilities')}
            description="Set your availability"
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

          {/* My Swaps */}
          <NavigationItem
            to="/my-swaps"
            icon={RefreshCw}
            iconColor={iconColorMap.mySwaps}
            label="My Swaps"
            isActive={isRouteActive('/my-swaps')}
            description="Manage shift swaps"
            onMouseEnter={() => handlePrefetch('/my-swaps')}
          />

          {/* My Broadcasts - NEW */}
          <NavigationItem
            to="/my-broadcasts"
            icon={Radio}
            iconColor={iconColorMap.myBroadcasts}
            label="My Broadcasts"
            isActive={isRouteActive('/my-broadcasts')}
            description="View announcements"
          />
        </div>

        {/* ---------- Rostering Section ---------- */}
        {(hasPermission('templates') ||
          hasPermission('rosters') ||
          hasPermission('timesheet-view')) && (
            <div className="space-y-2">
              <SectionHeader
                icon={FolderKanban}
                title="Rostering"
                color={iconColorMap.sectionRostering}
              />

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
            </div>
          )}

        {/* ---------- Management Section ---------- */}
        {hasPermission('management') && (
          <div className="space-y-2">
            <SectionHeader
              icon={Shield}
              title="Management"
              color={iconColorMap.sectionManagement}
            />

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

            <NavigationItem
              to="/audit"
              icon={ClipboardList}
              iconColor={iconColorMap.audit}
              label="Audit Trail"
              isActive={isRouteActive('/audit')}
              description="Shift change history"
            />

            <NavigationItem
              to="/users"
              icon={Users}
              iconColor={iconColorMap.contracts}
              label="Users"
              isActive={isRouteActive('/users')}
              description="User skills & performance"
            />
          </div>
        )}

        {/* ---------- Additional Features Section ---------- */}
        {(hasPermission('broadcast') ||
          hasPermission('insights') ||
          hasPermission('configurations')) && (
            <div className="space-y-2">
              <SectionHeader
                icon={Sparkles}
                title="Features"
                color={iconColorMap.sectionFeatures}
              />

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

              {hasPermission('configurations') && (
                <NavigationItem
                  to="/configurations"
                  icon={Settings}
                  iconColor={iconColorMap.configurations}
                  label="Configurations"
                  isActive={isRouteActive('/configurations')}
                  description="System settings"
                />
              )}
            </div>
          )}
      </div>

      {/* ==================== FOOTER ==================== */}
      <div className="p-4 border-t border-border/50 space-y-4">
        {/* Quick Actions */}
        <div className="flex items-center justify-between">
          <ThemeSelector />
          <BroadcastNotifications isCollapsed={false} />
        </div>

        <Separator />

        {/* User Profile & Contract Switcher */}
        <div className="mb-2">
          <ProfileIdentityCard />
        </div>

        {/* Help Button */}
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2 h-10"
        >
          <HelpCircle className={cn('h-5 w-5', iconColorMap.help)} />
          <span>Help & Support</span>
        </Button>

        {/* Logout Button */}
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 h-10 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          onClick={() => {
            logout();
            // Optional: navigate to login handled by Auth provider usually, 
            // but we can enforce it if needed, though useAuth usually handles state change.
          }}
        >
          <LogOut className="h-5 w-5" />
          <span>Log Out</span>
        </Button>
      </div>
    </div>
  );
};

export default AppSidebar;
