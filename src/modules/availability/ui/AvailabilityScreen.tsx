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
import { motion, AnimatePresence } from 'framer-motion';
import { itemVariants, tabTransition } from '@/modules/core/ui/motion/presets';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  Calendar,
  ClipboardList,
  Settings,
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { useToast } from '@/modules/core/hooks/use-toast';
import { cn } from '@/modules/core/lib/utils';

import { useAvailability } from '../state/useAvailability';
import { useAvailabilityEditing } from '../state/useAvailabilityEditing';
import { useAssignedShiftsForAvailability } from '../state/useAssignedShiftsForAvailability';
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

  // Fetch assigned shifts for current month (locked intervals shown as purple overlay)
  const { assignedShifts } = useAssignedShiftsForAvailability('current-user', currentMonth);

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


  const handleAddAvailability = useCallback(() => {
    startCreate();
    // Switch to configure tab/pane
    if (layout === 'mobile') {
      setActiveTab('configure');
    } else if (layout === 'tablet') {
      setBottomTab('configure');
    }
  }, [startCreate, layout, toast]);

  const handleEditRule = useCallback(
    (rule: AvailabilityRule) => {
      startEdit(rule);
      // Switch to configure tab/pane
      if (layout === 'mobile') {
        setActiveTab('configure');
      } else if (layout === 'tablet') {
        setBottomTab('configure');
      }
    },
    [startEdit, layout]
  );

  const handleDeleteRule = useCallback(
    async (ruleId: string) => {
      try {
        await deleteRule(ruleId);
      } catch (error) {
        // Error toast handled by the hook
      }
    },
    [deleteRule]
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
    <motion.div
      variants={itemVariants}
      className="flex-shrink-0 border-b border-border bg-background shadow-sm"
    >
      <div className="flex flex-col md:flex-row items-center justify-between p-4 gap-4 md:gap-0">
        {/* Month Navigation */}
        <div className="flex items-center gap-2 w-full md:w-auto justify-between md:justify-start">
          {/* Only show month navigation if it's desktop or we're on the calendar tab on mobile */}
          {(layout !== 'mobile' || activeTab === 'calendar') ? (
            <>
              <Button
                variant="outline"
                size="icon"
                onClick={handlePrevMonth}
                className="h-9 w-9"
                title="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <h1 className="text-lg font-black tracking-tight min-w-[120px] md:min-w-[160px] text-center text-foreground bg-muted/50 px-4 py-1.5 rounded-full border border-border">
                {format(currentMonth, 'MMMM yyyy')}
              </h1>
              <Button
                variant="outline"
                size="icon"
                onClick={handleNextMonth}
                className="h-9 w-9"
                title="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <div className="flex-1 flex justify-center py-1">
              <h1 className="text-lg font-black uppercase tracking-widest font-heading text-foreground">
                {activeTab === 'logs' ? 'Availability Rules' : 'Rule Configuration'}
              </h1>
            </div>
          )}
        </div>

        {/* Actions - Removed Refresh/Lock */}
        <div className="flex items-center gap-2 w-full md:w-auto justify-center md:justify-end">
          <div className="hidden md:block">
            <Button
              onClick={handleAddAvailability}
              className="gap-2 h-10 md:h-9 shadow-sm bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-500/20"
            >
              <Plus className="h-4 w-4" />
              <span>Add Availability</span>
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );

  // ========================================
  // RENDER: DESKTOP LAYOUT
  // ========================================

  if (layout === 'desktop') {
    return (
      <motion.div
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
        className="flex flex-col h-full w-full overflow-hidden bg-background"
      >
        {renderHeader()}
        <div className="flex-1 flex overflow-hidden">
          {/* LEFT: Calendar */}
          <motion.div variants={itemVariants} className="flex-[2] min-w-[400px] border-r border-border overflow-hidden">
            <CalendarPane
              slots={slots}
              assignedShifts={assignedShifts}
              currentMonth={currentMonth}
              isLoading={isLoadingSlots}
            />
          </motion.div>

          {/* MIDDLE: Logs */}
          <motion.div variants={itemVariants} className="flex-[1.5] min-w-[280px] border-r border-border overflow-hidden">
            <LogsPane
              rules={rules}
              isLoading={isLoadingRules}
              onEditRule={handleEditRule}
              onDeleteRule={handleDeleteRule}
            />
          </motion.div>

          {/* RIGHT: Configure */}
          <motion.div variants={itemVariants} className="flex-[1.5] min-w-[320px] overflow-hidden">
            <ConfigurePane
              mode={editState.mode}
              ruleBeingEdited={editState.ruleBeingEdited}
              isSubmitting={editState.isSubmitting}
              onSubmit={handleSubmit}
              onCancel={handleCancel}
            />
          </motion.div>
        </div>
      </motion.div>
    );
  }

  // ========================================
  // RENDER: TABLET LAYOUT
  // ========================================

  if (layout === 'tablet') {
    return (
      <motion.div
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
        className="flex flex-col h-full w-full overflow-hidden bg-background"
      >
        {renderHeader()}

        {/* TOP: Calendar */}
        <motion.div variants={itemVariants} className="h-[45%] border-b border-border overflow-hidden">
          <CalendarPane
            slots={slots}
            currentMonth={currentMonth}
            isLoading={isLoadingSlots}
          />
        </motion.div>

        {/* BOTTOM: Tabs for Logs/Configure */}
        <motion.div variants={itemVariants} className="flex-1 flex flex-col overflow-hidden">
          {/* Tab Headers */}
          <div className="flex border-b border-border bg-muted/30 flex-shrink-0">
            <button
              onClick={() => setBottomTab('logs')}
              className={cn(
                'flex-1 py-3 px-4 text-sm font-bold transition-colors',
                bottomTab === 'logs'
                  ? 'border-b-2 border-primary text-primary bg-background'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Rules ({rules.length})
            </button>
            <button
              onClick={() => setBottomTab('configure')}
              className={cn(
                'flex-1 py-3 px-4 text-sm font-bold transition-colors',
                bottomTab === 'configure'
                  ? 'border-b-2 border-primary text-primary bg-background'
                  : 'text-muted-foreground hover:text-foreground',
                editState.mode && 'animate-pulse'
              )}
            >
              Configure
              {editState.mode && ' *'}
            </button>
          </div>

          {/* Tab Content */}
          <AnimatePresence mode="wait">
            <motion.div key={bottomTab} {...tabTransition} className="flex-1 overflow-hidden">
              {bottomTab === 'logs' ? (
                <LogsPane
                  rules={rules}
                  isLoading={isLoadingRules}
                  onEditRule={handleEditRule}
                  onDeleteRule={handleDeleteRule}
                />
              ) : (
                <ConfigurePane
                  mode={editState.mode}
                  ruleBeingEdited={editState.ruleBeingEdited}
                  isSubmitting={editState.isSubmitting}
                  onSubmit={handleSubmit}
                  onCancel={handleCancel}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </motion.div>
    );
  }

  // ========================================
  // RENDER: MOBILE LAYOUT
  // ========================================

  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
      className="flex flex-col h-full w-full overflow-hidden bg-background"
    >
      {renderHeader()}

      {/* Sub-navigation Tabs at the Top - Text Only Toggle */}
      <motion.div 
        variants={itemVariants}
        className="flex-shrink-0 px-4 py-3 bg-background border-b border-border/50 z-10"
      >
        <div className="flex bg-muted/60 p-1.5 rounded-[16px] max-w-sm mx-auto">
          <button
            onClick={() => setActiveTab('calendar')}
            className={cn(
              'flex flex-1 items-center justify-center py-2.5 rounded-xl transition-all duration-300',
              activeTab === 'calendar'
                ? 'bg-background shadow-md text-foreground scale-[1.02]'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <span className="text-[12px] font-black uppercase tracking-widest font-heading">Calendar</span>
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={cn(
              'flex flex-1 items-center justify-center py-2.5 rounded-xl transition-all duration-300',
              activeTab === 'logs' 
                ? 'bg-background shadow-md text-foreground scale-[1.02]' 
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <span className="text-[12px] font-black uppercase tracking-widest font-heading">Rules</span>
          </button>
          <button
            onClick={() => setActiveTab('configure')}
            className={cn(
              'flex flex-1 items-center justify-center py-2.5 rounded-xl transition-all duration-300',
              activeTab === 'configure'
                ? 'bg-background shadow-md text-foreground scale-[1.02]'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <span className="text-[12px] font-black uppercase tracking-widest font-heading">
              Config{editState.mode && <span className="text-primary ml-1">*</span>}
            </span>
          </button>
        </div>
      </motion.div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div key={activeTab} {...tabTransition} className="flex-1 overflow-hidden">
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
              onEditRule={handleEditRule}
              onDeleteRule={handleDeleteRule}
            />
          )}
          {activeTab === 'configure' && (
            <ConfigurePane
              mode={editState.mode}
              ruleBeingEdited={editState.ruleBeingEdited}
              isSubmitting={editState.isSubmitting}
              onSubmit={handleSubmit}
              onCancel={handleCancel}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Floating Action Button (Mobile Only) */}
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.5, type: 'spring' }}
        className="fixed bottom-24 right-6 z-50 md:hidden"
      >
        <Button
          onClick={handleAddAvailability}
          size="icon"
          className="h-16 w-16 rounded-full shadow-2xl bg-primary text-primary-foreground hover:scale-110 active:scale-95 transition-all duration-300"
        >
          <Plus className="h-8 w-8 stroke-[3]" />
        </Button>
      </motion.div>
    </motion.div>
  );
}

export default AvailabilityScreen;
