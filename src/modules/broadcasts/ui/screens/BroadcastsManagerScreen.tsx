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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/modules/core/ui/primitives/tabs';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { useToast } from '@/modules/core/hooks/use-toast';
import { cn } from '@/modules/core/lib/utils';

import { useBroadcastGroups } from '../../state/useBroadcasts';
import { BroadcastGroupsView } from '../views/BroadcastGroups.view';
import { BroadcastNotificationsList } from '../views/BroadcastNotificationsList.view';
import { BroadcastAnalytics } from '../views/BroadcastAnalytics.view';
import { ControlRoom } from '../views/ControlRoom.view';
import { CreateGroupDialog } from '../dialogs/CreateGroupDialog';
import { EditGroupDialog } from '../dialogs/EditGroupDialog';


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
}

type MobileTab = 'groups' | 'analytics' | 'activity';

// ============================================================================
// COMPONENT
// ============================================================================

export function BroadcastsManagerScreen({ layout, scope }: BroadcastsManagerScreenProps) {
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
  const {
    groups,
    isLoading,
    createGroup,
    deleteGroup,
    updateGroup,
    refetch,
  } = useBroadcastGroups({
    organizationId: selectedOrgId || undefined,
    departmentId: selectedDeptId || undefined,
    subDepartmentId: selectedSubDeptId || undefined,
  });

  // ========================================
  // UI STATE
  // ========================================
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingGroup, setEditingGroup] = useState<any>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>('groups');
  const [showAnalytics, setShowAnalytics] = useState(true);

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

  const handleCreateGroup = async (data: any) => {
    const newGroup = await createGroup({
      ...data,
      departmentId: data.departmentId || undefined,
      subDepartmentId: data.subDepartmentId || undefined,
    });
    if (newGroup && newGroup.id) {
      setSelectedGroupId(newGroup.id);
    }
  };

  // ========================================
  // CONTROL ROOM VIEW (Group Selected)
  // ========================================

  if (selectedGroupId) {
    return (
      <ControlRoom
        groupId={selectedGroupId}
        onBack={() => setSelectedGroupId(null)}
      />
    );
  }

  // ========================================
  // RENDER: HEADER
  // ========================================

  const renderHeader = () => (
    <div className="flex-shrink-0 border-b bg-background">

      {/* Title & Actions */}
      <div className="p-4 md:p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-4xl font-bold text-foreground mb-1 md:mb-2 flex items-center gap-2 md:gap-3">
              <Megaphone className="h-6 w-6 md:h-10 md:w-10 text-primary" />
              Broadcast Center
            </h1>
            <p className="text-sm md:text-lg text-muted-foreground">
              Manage your communication channels and reach your team instantly.
            </p>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={handleRefresh}
              className="h-9 w-9 md:h-11 md:w-11"
              disabled={isLoading}
            >
              <RefreshCw className={cn('h-4 w-4 md:h-5 md:w-5', isLoading && 'animate-spin')} />
            </Button>
            <Button
              onClick={() => setShowCreateDialog(true)}
              className="h-9 md:h-11 px-4 md:px-6 gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-lg shadow-primary/20"
            >
              <Plus className="h-4 w-4 md:h-5 md:w-5" />
              <span className="hidden sm:inline">Create Group</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  // ========================================
  // RENDER: GROUPS SECTION
  // ========================================

  const renderGroupsSection = () => (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl md:text-2xl font-bold text-foreground">My Groups</h2>
        <Badge variant="secondary" className="text-xs md:text-sm">
          {groups.length} active groups
        </Badge>
      </div>

      <BroadcastGroupsView
        groups={groups}
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
        onClose={() => setShowCreateDialog(false)}
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
      <div className="min-h-screen bg-background">
        {renderHeader()}

        {/* Analytics Section */}
        <div className="px-8 pt-6">
          <BroadcastAnalytics />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 p-8 w-full">
          {/* Main Area - Groups */}
          <div className="lg:col-span-2">
            {renderGroupsSection()}
          </div>

          {/* Sidebar - Activity */}
          <div>
            {renderActivitySection()}
          </div>
        </div>

        {renderDialogs()}
      </div>
    );
  }

  // ========================================
  // RENDER: TABLET LAYOUT
  // ========================================

  if (layout === 'tablet') {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        {renderHeader()}

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
    <div className="min-h-screen bg-background flex flex-col">
      {renderHeader()}

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
