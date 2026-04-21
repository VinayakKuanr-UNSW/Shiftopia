
import React from 'react';
import {
  LayoutDashboard,
  Calendar,
  CalendarDays,
  BadgeCheck,
  Clock,
  FileSpreadsheet,
  PanelLeft,
  Workflow,
  Users,
  BellRing,
  Settings,
  TrendingUp,
  RefreshCw,
  ScrollText,
  BarChart3,
  ClipboardList,
} from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/platform/auth/useAuth';
import NavItem from './NavItem';
import NavSection from './NavSection';
import { useSidebar } from '@/modules/core/ui/primitives/sidebar';

interface NavigationLinksProps {
  openMenus: { [key: string]: boolean };
  toggleMenu: (menu: string) => void;
}

const NavigationLinks: React.FC<NavigationLinksProps> = ({ openMenus, toggleMenu }) => {
  const location = useLocation();
  const { hasPermission } = useAuth();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  const isRouteActive = (path: string) => {
    if (path === location.pathname) return true;
    if (path !== '/dashboard' && location.pathname.startsWith(path)) return true;
    return false;
  };

  return (
    <div className="flex-1 overflow-y-auto py-4 px-3">
      <NavItem
        icon={<LayoutDashboard className="h-5 w-5" />}
        label="Dashboard"
        path="/dashboard"
        active={isRouteActive('/dashboard')}
        sectionColor="primary"
      />

      <NavSection
        title="My Workspace"
        isOpen={openMenus['workspace']}
        onToggle={() => toggleMenu('workspace')}
        collapsed={isCollapsed}
        sectionColor="purple"
      >
        <NavItem
          icon={<Calendar className="h-5 w-5" />}
          label="My Roster"
          path="/my-roster"
          active={isRouteActive('/my-roster')}
          indent
          sectionColor="purple"
        />
        <NavItem
          icon={<CalendarDays className="h-5 w-5" />}
          label="Availabilities"
          path="/availabilities"
          active={isRouteActive('/availabilities')}
          indent
          sectionColor="purple"
        />
        <NavItem
          icon={<BadgeCheck className="h-5 w-5" />}
          label="My Bids"
          path="/bids"
          active={isRouteActive('/bids')}
          indent
          sectionColor="purple"
        />
      </NavSection>

      {(hasPermission('templates') || hasPermission('rosters') || hasPermission('timesheet-view')) && (
        <NavSection
          title="Rostering"
          isOpen={openMenus['rostering']}
          onToggle={() => toggleMenu('rostering')}
          collapsed={isCollapsed}
          sectionColor="blue"
        >
          {hasPermission('templates') && (
            <NavItem
              icon={<Workflow className="h-5 w-5" />}
              label="Templates"
              path="/templates"
              active={isRouteActive('/templates')}
              indent
              sectionColor="blue"
            />
          )}
          {hasPermission('rosters') && (
            <NavItem
              icon={<FileSpreadsheet className="h-5 w-5" />}
              label="Rosters"
              path="/rosters"
              active={isRouteActive('/rosters')}
              indent
              sectionColor="blue"
            />
          )}
          {hasPermission('timesheet-view') && (
            <NavItem
              icon={<Clock className="h-5 w-5" />}
              label="Timesheet"
              path="/timesheet"
              active={isRouteActive('/timesheet')}
              indent
              sectionColor="blue"
            />
          )}
        </NavSection>
      )}

      {hasPermission('management') && (
        <NavSection
          title="Management"
          isOpen={openMenus['management']}
          onToggle={() => toggleMenu('management')}
          collapsed={isCollapsed}
          sectionColor="green"
        >
          <NavItem
            icon={<BadgeCheck className="h-5 w-5" />}
            label="Open Bids"
            path="/management/bids"
            active={isRouteActive('/management/bids')}
            indent
            sectionColor="green"
          />
          <NavItem
            icon={<RefreshCw className="h-5 w-5" />}
            label="My Swaps"
            path="/my-swaps"
            active={isRouteActive('/my-swaps')}
            indent
            sectionColor="purple"
          />
          <NavItem
            icon={<RefreshCw className="h-5 w-5" />}
            label="Swap Requests"
            path="/management/swaps"
            active={isRouteActive('/management/swaps')}
            indent
            sectionColor="green"
          />
        </NavSection>
      )}

      {hasPermission('broadcast') && (
        <NavItem
          icon={<BellRing className="h-5 w-5" />}
          label="Broadcast"
          path="/broadcast"
          active={isRouteActive('/broadcast')}
          sectionColor="amber"
        />
      )}

      {hasPermission('insights') && (
        <NavItem
          icon={<TrendingUp className="h-5 w-5" />}
          label="Insights"
          path="/insights"
          active={isRouteActive('/insights')}
          sectionColor="amber"
        />
      )}


      {hasPermission('management') && (
        <NavItem
          icon={<BarChart3 className="h-5 w-5" />}
          label="Performance"
          path="/performance"
          active={isRouteActive('/performance')}
          sectionColor="green"
        />
      )}



    </div>
  );
};

export default NavigationLinks;
