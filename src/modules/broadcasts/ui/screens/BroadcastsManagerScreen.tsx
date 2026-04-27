/**
 * Broadcasts Manager Screen - Main Orchestrator Component
 *
 * This is the ROOT component for the Manager Broadcasts UI.
 * It orchestrates the layout and manages all state.
 *
 * RESPONSIBILITIES:
 * - Coordinate data fetching via useBroadcastGroups
 * - Manage hierarchy filter state
 * - Manage selected group state
 * - Pass data down to views
 * - Handle responsive layout switching
 *
 * MUST NOT:
 * - Render form fields directly
 * - Make API calls directly
 */

import React, { useState } from 'react';
import {
  Megaphone,
  Plus,
  RefreshCw,
  BarChart3,
  Bell,
  LayoutGrid,
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { useToast } from '@/modules/core/hooks/use-toast';
import { cn } from '@/modules/core/lib/utils';

import { useBroadcastGroups } from '../../state/useBroadcasts';
import { BroadcastGroupsView } from '../views/BroadcastGroups.view';
import { BroadcastNotificationsList } from '../views/BroadcastNotificationsList.view';
import { BroadcastAnalytics } from '../views/BroadcastAnalytics.view';
import { ControlRoom } from './ControlRoom';
import { CreateGroupDialog } from '../dialogs/CreateGroupDialog';
import { EditGroupDialog } from '../dialogs/EditGroupDialog';
import { BroadcastGroupWithStats, CreateBroadcastGroupRequest } from '../../model/broadcast.types';


// ============================================================================
// TYPES
// ============================================================================

export interface BroadcastsManagerScreenProps {
  /**
   * Layout mode for responsive design
   * - 'desktop': Three-column layout with sidebar
   * - 'tablet': Two-column layout with stacked elements
   * - 'mobile': Single column with bottom navigation
   */
  layout: 'desktop' | 'tablet' | 'mobile';
  scope?: import('@/platform/auth/types').ScopeSelection;
  /** Notifies the parent when the ControlRoom opens/closes so it can hide the scope banner */
  onControlRoomChange?: (open: boolean) => void;
  // Hoisted standard props
  searchQuery?: string;
  refreshTrigger?: number;
  showCreateDialogOverride?: boolean;
  onCloseCreateDialog?: () => void;
}

type MobileTab = 'groups' | 'analytics' | 'activity';

// ============================================================================
// COMPONENT
// ============================================================================

export function BroadcastsManagerScreen({ 
  layout, 
  scope, 
  onControlRoomChange,
  searchQuery = '',
  refreshTrigger = 0,
  showCreateDialogOverride = false,
  onCloseCreateDialog,
}: BroadcastsManagerScreenProps) {
  const { toast } = useToast();

  // ========================================
  // HIERARCHY STATE
  // ========================================
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);
  const [selectedSubDeptId, setSelectedSubDeptId] = useState<string | null>(null);

  // Sync with global scope filter
  React.useEffect(() => {
    if (scope) {
      if (scope.org_ids.length > 0) setSelectedOrgId(scope.org_ids[0]);
      if (scope.dept_ids.length > 0) setSelectedDeptId(scope.dept_ids[0]);
      if (scope.subdept_ids.length > 0) setSelectedSubDeptId(scope.subdept_ids[0]);

      // Handle "clear" cases if needed, though usually scope has defaults
      if (scope.dept_ids.length === 0) setSelectedDeptId(null);
      if (scope.subdept_ids.length === 0) setSelectedSubDeptId(null);
    }
  }, [scope]);

  // ========================================
  // DATA HOOKS
  // ========================================
  // Groups are org-level entities — a manager sees all groups they admin in
  // the org regardless of the current dept/subdept scope.  Dept/subdept scope
  // applies to employee lookup (AddMemberDialog), not to group visibility.
  const {
    groups,
    isLoading,
    createGroup,
    deleteGroup,
    updateGroup,
    refetch,
  } = useBroadcastGroups({
    organizationId: selectedOrgId || undefined,
  });

  // ========================================
  // UI STATE
  // ========================================
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  React.useEffect(() => {
    onControlRoomChange?.(!!selectedGroupId);
  }, [selectedGroupId, onControlRoomChange]);

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  
  // Sync internal create dialog state with hoisted override
  React.useEffect(() => {
    if (showCreateDialogOverride) setShowCreateDialog(true);
  }, [showCreateDialogOverride]);

  // Handle closing by notifying parent
  const handleCloseCreateDialog = () => {
    setShowCreateDialog(false);
    onCloseCreateDialog?.();
  };

  const [editingGroup, setEditingGroup] = useState<BroadcastGroupWithStats | null>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>('groups');
  const [showAnalytics, setShowAnalytics] = useState(true);

  // Sync refresh trigger
  React.useEffect(() => {
    if (refreshTrigger > 0) {
      refetch();
    }
  }, [refreshTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  // ========================================
  // HANDLERS
  // ========================================

  const handleRefresh = async () => {
    await refetch();
    toast({
      title: 'Refreshed',
      description: 'Broadcast groups have been refreshed.',
    });
  };

  const handleCreateGroup = async (data: {
    name: string;
    description?: string;
    icon?: string;
    organizationId?: string | null;
    departmentId?: string | null;
    subDepartmentId?: string | null;
  }) => {
    const newGroup = await createGroup({
      ...data,
      organizationId: data.organizationId || selectedOrgId || undefined,
      departmentId: data.departmentId || undefined,
      subDepartmentId: data.subDepartmentId || undefined,
    });
    if (newGroup && newGroup.id) {
      setSelectedGroupId(newGroup.id);
    }
  };

  const filteredGroups = React.useMemo(() => {
    return groups
      .filter(g => g.name.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [groups, searchQuery]);

  // ========================================
  // CONTROL ROOM VIEW (Group Selected)
  // ========================================

  if (selectedGroupId) {
    return (
      <div className="fixed inset-0 md:left-[280px] z-30 bg-background">
        <ControlRoom
          groupId={selectedGroupId}
          onBack={() => setSelectedGroupId(null)}
        />
      </div>
    );
  }

  // ========================================
  // RENDER: GROUPS SECTION
  // ========================================

  const renderGroupsSection = () => (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl md:text-2xl font-bold text-foreground">My Groups</h2>
        <Badge variant="secondary" className="text-xs md:text-sm">
          {filteredGroups.length} active groups
        </Badge>
      </div>

      <BroadcastGroupsView
        groups={filteredGroups}
        isLoading={isLoading}
        onGroupClick={(id) => setSelectedGroupId(id)}
        onDeleteGroup={deleteGroup}
        onEditGroup={(group) => setEditingGroup(group)}
      />
    </div>
  );

  // ========================================
  // RENDER: ANALYTICS SECTION
  // ========================================

  const renderAnalyticsSection = () => (
    <div className="space-y-4 md:space-y-6">
      <h2 className="text-xl md:text-2xl font-bold text-foreground">Analytics</h2>
      <BroadcastAnalytics />
    </div>
  );

  // ========================================
  // RENDER: ACTIVITY SECTION
  // ========================================

  const renderActivitySection = () => (
    <div className="space-y-4 md:space-y-6">
      <h2 className="text-xl md:text-2xl font-bold text-foreground">Recent Activity</h2>
      <BroadcastNotificationsList />
    </div>
  );

  // ========================================
  // RENDER: DIALOGS
  // ========================================

  const renderDialogs = () => (
    <>
      <CreateGroupDialog
        isOpen={showCreateDialog}
        onClose={handleCloseCreateDialog}
        initialOrganizationId={selectedOrgId}
        initialDepartmentId={selectedDeptId}
        initialSubDepartmentId={selectedSubDeptId}
        onCreate={handleCreateGroup}
      />

      <EditGroupDialog
        group={editingGroup}
        isOpen={!!editingGroup}
        onClose={() => setEditingGroup(null)}
        onUpdate={updateGroup}
      />
    </>
  );

  // ========================================
  // RENDER: DESKTOP LAYOUT
  // ========================================

  if (layout === 'desktop') {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <ScrollArea className="flex-1">
          <div className="space-y-6 pb-8">
            {/* Analytics Section */}
            <div className="px-4 lg:px-6 pt-4">
              {renderAnalyticsSection()}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 px-4 lg:px-6 py-4 w-full">
              {/* Main Area - Groups */}
              <div className="lg:col-span-2">
                {renderGroupsSection()}
              </div>

              {/* Sidebar - Activity */}
              <div className="border-l border-border/50 pl-6">
                {renderActivitySection()}
              </div>
            </div>
          </div>
        </ScrollArea>

        {renderDialogs()}
      </div>
    );
  }

  // ========================================
  // RENDER: TABLET LAYOUT
  // ========================================

  if (layout === 'tablet') {
    return (
      <div className="h-full flex flex-col overflow-hidden">

        <ScrollArea className="flex-1">
          <div className="p-6 space-y-6">
            {/* Analytics - Collapsible */}
            <div className="rounded-xl border bg-card">
              <button
                onClick={() => setShowAnalytics(!showAnalytics)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-muted-foreground" />
                  <span className="font-semibold">Analytics Overview</span>
                </div>
                <span className="text-muted-foreground text-sm">
                  {showAnalytics ? 'Hide' : 'Show'}
                </span>
              </button>
              {showAnalytics && (
                <div className="px-4 pb-4">
                  <BroadcastAnalytics />
                </div>
              )}
            </div>

            {/* Groups Grid */}
            {renderGroupsSection()}

            {/* Activity */}
            <div className="rounded-xl border bg-card p-4">
              {renderActivitySection()}
            </div>
          </div>
        </ScrollArea>

        {renderDialogs()}
      </div>
    );
  }

  // ========================================
  // RENDER: MOBILE LAYOUT
  // ========================================

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-4">
            {mobileTab === 'groups' && renderGroupsSection()}
            {mobileTab === 'analytics' && renderAnalyticsSection()}
            {mobileTab === 'activity' && renderActivitySection()}
          </div>
        </ScrollArea>
      </div>

      {/* Bottom Tab Bar */}
      <div className="flex-shrink-0 border-t bg-background safe-area-bottom">
        <div className="flex">
          <button
            onClick={() => setMobileTab('groups')}
            className={cn(
              'flex-1 py-3 flex flex-col items-center gap-1 text-xs transition-colors',
              mobileTab === 'groups' ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            <LayoutGrid className="h-5 w-5" />
            <span>Groups</span>
          </button>
          <button
            onClick={() => setMobileTab('analytics')}
            className={cn(
              'flex-1 py-3 flex flex-col items-center gap-1 text-xs transition-colors',
              mobileTab === 'analytics' ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            <BarChart3 className="h-5 w-5" />
            <span>Analytics</span>
          </button>
          <button
            onClick={() => setMobileTab('activity')}
            className={cn(
              'flex-1 py-3 flex flex-col items-center gap-1 text-xs transition-colors',
              mobileTab === 'activity' ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            <Bell className="h-5 w-5" />
            <span>Activity</span>
          </button>
        </div>
      </div>

      {renderDialogs()}
    </div>
  );
}

export default BroadcastsManagerScreen;
