/**
 * Availability Screen - Main Orchestrator Component
 *
 * This is the ROOT component for the Availability Management UI.
 * It orchestrates the three-pane layout and manages all state.
 *
 * RESPONSIBILITIES:
 * - Coordinate data fetching via useAvailability
 * - Coordinate edit state via useAvailabilityEditing
 * - Manage month navigation
 * - Manage lock state
 * - Pass data down to panes
 * - Handle responsive layout switching
 *
 * MUST NOT:
 * - Render form fields directly
 * - Make API calls directly
 * - Perform slot expansion
 */

import React, { useState, useCallback } from 'react';
import { addMonths, subMonths, format } from 'date-fns';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Lock,
  Unlock,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { useToast } from '@/modules/core/hooks/use-toast';
import { cn } from '@/modules/core/lib/utils';

import { useAvailability } from '../state/useAvailability';
import { useAvailabilityEditing } from '../state/useAvailabilityEditing';
import { AvailabilityRule, AvailabilityFormPayload } from '../model/availability.types';

import { CalendarPane } from './panes/CalendarPane';
import { LogsPane } from './panes/LogsPane';
import { ConfigurePane } from './panes/ConfigurePane';

// ============================================================================
// TYPES
// ============================================================================

export interface AvailabilityScreenProps {
  /**
   * Layout mode for responsive design
   * - 'desktop': Three panes side-by-side
   * - 'tablet': Calendar top, Logs/Configure tabbed below
   * - 'mobile': Single pane with tab navigation
   */
  layout: 'desktop' | 'tablet' | 'mobile';
}

type TabType = 'calendar' | 'logs' | 'configure';

// ============================================================================
// COMPONENT
// ============================================================================

export function AvailabilityScreen({ layout }: AvailabilityScreenProps) {
  // ========================================
  // STATE
  // ========================================

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [isLocked, setIsLocked] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('calendar');
  const [bottomTab, setBottomTab] = useState<'logs' | 'configure'>('logs');

  const { toast } = useToast();

  // ========================================
  // DATA HOOKS
  // ========================================

  const {
    rules,
    slots,
    isLoadingRules,
    isLoadingSlots,
    deleteRule,
    refreshRules,
    refreshSlots,
  } = useAvailability({ month: currentMonth });

  const {
    editState,
    startCreate,
    startEdit,
    cancelEdit,
    submitEdit,
  } = useAvailabilityEditing();

  // ========================================
  // HANDLERS
  // ========================================

  const handlePrevMonth = useCallback(() => {
    setCurrentMonth((prev) => subMonths(prev, 1));
  }, []);

  const handleNextMonth = useCallback(() => {
    setCurrentMonth((prev) => addMonths(prev, 1));
  }, []);

  const handleRefresh = useCallback(async () => {
    await Promise.all([refreshRules(), refreshSlots()]);
    toast({
      title: 'Refreshed',
      description: 'Availability data has been refreshed.',
    });
  }, [refreshRules, refreshSlots, toast]);

  const handleToggleLock = useCallback(() => {
    setIsLocked((prev) => {
      const newState = !prev;
      toast({
        title: newState ? 'Calendar Locked' : 'Calendar Unlocked',
        description: newState
          ? 'All editing actions are now disabled.'
          : 'You can now edit availability.',
      });
      return newState;
    });
  }, [toast]);

  const handleAddAvailability = useCallback(() => {
    if (isLocked) {
      toast({
        title: 'Editing Disabled',
        description: 'Unlock the calendar to add availability.',
        variant: 'destructive',
      });
      return;
    }
    startCreate();
    // Switch to configure tab/pane
    if (layout === 'mobile') {
      setActiveTab('configure');
    } else if (layout === 'tablet') {
      setBottomTab('configure');
    }
  }, [isLocked, startCreate, layout, toast]);

  const handleEditRule = useCallback(
    (rule: AvailabilityRule) => {
      if (isLocked) {
        toast({
          title: 'Editing Disabled',
          description: 'Unlock the calendar to edit rules.',
          variant: 'destructive',
        });
        return;
      }
      startEdit(rule);
      // Switch to configure tab/pane
      if (layout === 'mobile') {
        setActiveTab('configure');
      } else if (layout === 'tablet') {
        setBottomTab('configure');
      }
    },
    [isLocked, startEdit, layout, toast]
  );

  const handleDeleteRule = useCallback(
    async (ruleId: string) => {
      if (isLocked) {
        toast({
          title: 'Deletion Disabled',
          description: 'Unlock the calendar to delete rules.',
          variant: 'destructive',
        });
        return;
      }
      try {
        await deleteRule(ruleId);
      } catch (error) {
        // Error toast handled by the hook
      }
    },
    [isLocked, deleteRule, toast]
  );

  const handleSubmit = useCallback(
    async (payload: AvailabilityFormPayload) => {
      const result = await submitEdit('current-user', payload);
      if (result.success) {
        toast({
          title: 'Saved',
          description:
            editState.mode === 'edit'
              ? 'Availability rule updated.'
              : 'Availability rule created.',
        });
        // Refresh data
        await Promise.all([refreshRules(), refreshSlots()]);
        // Return to logs view on tablet/mobile
        if (layout === 'mobile') {
          setActiveTab('logs');
        } else if (layout === 'tablet') {
          setBottomTab('logs');
        }
      } else if (result.errors) {
        toast({
          title: 'Error',
          description: result.errors.join(', '),
          variant: 'destructive',
        });
      }
    },
    [submitEdit, editState.mode, refreshRules, refreshSlots, layout, toast]
  );

  const handleCancel = useCallback(() => {
    cancelEdit();
    // Return to logs view on tablet/mobile
    if (layout === 'mobile') {
      setActiveTab('logs');
    } else if (layout === 'tablet') {
      setBottomTab('logs');
    }
  }, [cancelEdit, layout]);

  // ========================================
  // RENDER: HEADER
  // ========================================

  const renderHeader = () => (
    <div className="flex-shrink-0 border-b bg-background">
      <div className="flex items-center justify-between p-4">
        {/* Month Navigation */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={handlePrevMonth}
            title="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold min-w-[160px] text-center">
            {format(currentMonth, 'MMMM yyyy')}
          </h1>
          <Button
            variant="outline"
            size="icon"
            onClick={handleNextMonth}
            title="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={handleRefresh}
            title="Refresh data"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            variant={isLocked ? 'destructive' : 'outline'}
            size="icon"
            onClick={handleToggleLock}
            title={isLocked ? 'Unlock editing' : 'Lock editing'}
          >
            {isLocked ? (
              <Lock className="h-4 w-4" />
            ) : (
              <Unlock className="h-4 w-4" />
            )}
          </Button>
          <Button
            onClick={handleAddAvailability}
            disabled={isLocked}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Add Availability</span>
          </Button>
        </div>
      </div>
    </div>
  );

  // ========================================
  // RENDER: DESKTOP LAYOUT
  // ========================================

  if (layout === 'desktop') {
    return (
      <div className="flex flex-col h-full w-full overflow-hidden">
        {renderHeader()}
        <div className="flex-1 flex overflow-hidden">
          {/* LEFT: Calendar */}
          <div className="flex-[2] min-w-[400px] border-r overflow-hidden">
            <CalendarPane
              slots={slots}
              currentMonth={currentMonth}
              isLoading={isLoadingSlots}
            />
          </div>

          {/* MIDDLE: Logs */}
          <div className="flex-[1.5] min-w-[280px] border-r overflow-hidden">
            <LogsPane
              rules={rules}
              isLoading={isLoadingRules}
              isLocked={isLocked}
              onEditRule={handleEditRule}
              onDeleteRule={handleDeleteRule}
            />
          </div>

          {/* RIGHT: Configure */}
          <div className="flex-[1.5] min-w-[320px] overflow-hidden">
            <ConfigurePane
              mode={editState.mode}
              ruleBeingEdited={editState.ruleBeingEdited}
              isLocked={isLocked}
              isSubmitting={editState.isSubmitting}
              onSubmit={handleSubmit}
              onCancel={handleCancel}
            />
          </div>
        </div>
      </div>
    );
  }

  // ========================================
  // RENDER: TABLET LAYOUT
  // ========================================

  if (layout === 'tablet') {
    return (
      <div className="flex flex-col h-full w-full overflow-hidden">
        {renderHeader()}

        {/* TOP: Calendar */}
        <div className="h-[45%] border-b overflow-hidden">
          <CalendarPane
            slots={slots}
            currentMonth={currentMonth}
            isLoading={isLoadingSlots}
          />
        </div>

        {/* BOTTOM: Tabs for Logs/Configure */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tab Headers */}
          <div className="flex border-b flex-shrink-0">
            <button
              onClick={() => setBottomTab('logs')}
              className={cn(
                'flex-1 py-3 px-4 text-sm font-medium transition-colors',
                bottomTab === 'logs'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Rules ({rules.length})
            </button>
            <button
              onClick={() => setBottomTab('configure')}
              className={cn(
                'flex-1 py-3 px-4 text-sm font-medium transition-colors',
                bottomTab === 'configure'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground',
                editState.mode && 'animate-pulse'
              )}
            >
              Configure
              {editState.mode && ' *'}
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-hidden">
            {bottomTab === 'logs' ? (
              <LogsPane
                rules={rules}
                isLoading={isLoadingRules}
                isLocked={isLocked}
                onEditRule={handleEditRule}
                onDeleteRule={handleDeleteRule}
              />
            ) : (
              <ConfigurePane
                mode={editState.mode}
                ruleBeingEdited={editState.ruleBeingEdited}
                isLocked={isLocked}
                isSubmitting={editState.isSubmitting}
                onSubmit={handleSubmit}
                onCancel={handleCancel}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  // ========================================
  // RENDER: MOBILE LAYOUT
  // ========================================

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {renderHeader()}

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'calendar' && (
          <CalendarPane
            slots={slots}
            currentMonth={currentMonth}
            isLoading={isLoadingSlots}
          />
        )}
        {activeTab === 'logs' && (
          <LogsPane
            rules={rules}
            isLoading={isLoadingRules}
            isLocked={isLocked}
            onEditRule={handleEditRule}
            onDeleteRule={handleDeleteRule}
          />
        )}
        {activeTab === 'configure' && (
          <ConfigurePane
            mode={editState.mode}
            ruleBeingEdited={editState.ruleBeingEdited}
            isLocked={isLocked}
            isSubmitting={editState.isSubmitting}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
          />
        )}
      </div>

      {/* Bottom Tab Bar */}
      <div className="flex-shrink-0 border-t bg-background">
        <div className="flex">
          <button
            onClick={() => setActiveTab('calendar')}
            className={cn(
              'flex-1 py-3 flex flex-col items-center gap-1 text-xs transition-colors',
              activeTab === 'calendar'
                ? 'text-primary'
                : 'text-muted-foreground'
            )}
          >
            <span className="text-lg">📅</span>
            <span>Calendar</span>
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={cn(
              'flex-1 py-3 flex flex-col items-center gap-1 text-xs transition-colors',
              activeTab === 'logs' ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            <span className="text-lg">📋</span>
            <span>Rules</span>
          </button>
          <button
            onClick={() => setActiveTab('configure')}
            className={cn(
              'flex-1 py-3 flex flex-col items-center gap-1 text-xs transition-colors',
              activeTab === 'configure'
                ? 'text-primary'
                : 'text-muted-foreground',
              editState.mode && 'animate-pulse'
            )}
          >
            <span className="text-lg">⚙️</span>
            <span>Configure{editState.mode && ' *'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default AvailabilityScreen;
