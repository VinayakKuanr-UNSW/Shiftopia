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
  RefreshCw,
  Calendar,
  ClipboardList,
  Settings,
} from 'lucide-react';
import { useToast } from '@/modules/core/hooks/use-toast';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { CalendarDays } from 'lucide-react';

import { useAssignedShiftsForAvailability } from '../state/useAssignedShiftsForAvailability';
import { AvailabilityRule, AvailabilityFormPayload } from '../model/availability.types';

import { CalendarPane } from './panes/CalendarPane';
import { LogsPane } from './panes/LogsPane';
import { ConfigurePane } from './panes/ConfigurePane';

// ============================================================================
// TYPES
// ============================================================================

import { UseAvailabilityResult } from '../state/useAvailability';
import { UseAvailabilityEditingResult } from '../state/useAvailabilityEditing';

export interface AvailabilityScreenProps {
  /**
   * Layout mode for responsive design
   * - 'desktop': Three panes side-by-side
   * - 'tablet': Calendar top, Logs/Configure tabbed below
   * - 'mobile': Single pane with tab navigation
   */
  layout: 'desktop' | 'tablet' | 'mobile';
  currentMonth?: Date;
  availabilityData?: UseAvailabilityResult;
  editingData?: UseAvailabilityEditingResult;
}

type TabType = 'calendar' | 'logs' | 'configure';

// ============================================================================
// COMPONENT
// ============================================================================

export function AvailabilityScreen({ 
  layout, 
  currentMonth, 
  availabilityData, 
  editingData 
}: AvailabilityScreenProps) {
  // ========================================
  // STATE
  // ========================================

  const [activeTab, setActiveTab] = useState<TabType>('calendar');
  const [bottomTab, setBottomTab] = useState<'logs' | 'configure'>('logs');
  const { isDark } = useTheme();

  const { toast } = useToast();

  if (!currentMonth || !availabilityData || !editingData) return null;

  // ========================================
  // DATA DESTRUCTURING
  // ========================================

  const {
    rules,
    slots,
    isLoadingRules,
    isLoadingSlots,
    deleteRule,
    refreshRules,
    refreshSlots,
  } = availabilityData;

  const {
    editState,
    startEdit,
    cancelEdit,
    submitEdit,
  } = editingData;

  // Fetch assigned shifts for current month (locked intervals shown as purple overlay)
  const { assignedShifts } = useAssignedShiftsForAvailability('current-user', currentMonth);

  // ========================================
  // HANDLERS
  // ========================================

  // Handlers for internal state navigation
  
  // Auto-switch tabs when entering edit mode (create or edit)
  React.useEffect(() => {
    if (editState.mode) {
      if (layout === 'mobile') {
        setActiveTab('configure');
      } else if (layout === 'tablet') {
        setBottomTab('configure');
      }
    }
  }, [editState.mode, layout]);

  const handleEditRule = useCallback(
    (rule: AvailabilityRule) => {
      startEdit(rule);
    },
    [startEdit]
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
      const scopedPayload: AvailabilityFormPayload = {
        ...payload,
        sub_department_id: payload.sub_department_id ?? availabilityData.subDepartmentId ?? null,
      };
      const result = await submitEdit('current-user', scopedPayload);
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
    [submitEdit, editState.mode, refreshRules, refreshSlots, layout, toast, availabilityData.subDepartmentId]
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
  // RENDER: SUB-COMPONENTS
  // ========================================




  // ========================================
  // RENDER: DESKTOP LAYOUT
  // ========================================

  if (layout === 'desktop') {
    return (
      <motion.div
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
        className="h-full w-full overflow-hidden"
      >
        <div
          className={cn(
            "h-full flex overflow-hidden rounded-[24px] border transition-all",
            isDark
              ? "bg-[#1c2333]/40 border-white/10 shadow-2xl shadow-black/20"
              : "bg-white/80 backdrop-blur-md border-slate-200 shadow-xl shadow-slate-200/50"
          )}
        >
          {/* LEFT: Calendar */}
          <motion.div variants={itemVariants} className="flex-[2] min-w-[400px] border-r border-border/50 overflow-hidden">
            <CalendarPane
              slots={slots}
              assignedShifts={assignedShifts}
              currentMonth={currentMonth}
              isLoading={isLoadingSlots}
            />
          </motion.div>

          {/* MIDDLE: Logs */}
          <motion.div variants={itemVariants} className="flex-[1.5] min-w-[280px] border-r border-border/50 overflow-hidden">
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
        className="h-full w-full overflow-hidden"
      >
        <div
          className={cn(
            "h-full flex flex-col overflow-hidden rounded-[24px] border transition-all",
            isDark
              ? "bg-[#1c2333]/40 border-white/10 shadow-2xl shadow-black/20"
              : "bg-white/80 backdrop-blur-md border-slate-200 shadow-xl shadow-slate-200/50"
          )}
        >
          {/* TOP: Calendar */}
          <motion.div variants={itemVariants} className="h-[45%] border-b border-border/50 overflow-hidden">
            <CalendarPane
              slots={slots}
              assignedShifts={assignedShifts}
              currentMonth={currentMonth}
              isLoading={isLoadingSlots}
            />
          </motion.div>

          {/* BOTTOM: Tabs for Logs/Configure */}
          <motion.div variants={itemVariants} className="flex-1 flex flex-col overflow-hidden">
            {/* Tab Headers */}
            <div className="flex border-b border-border/50 bg-muted/30 flex-shrink-0">
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
        </div>
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
      className="h-full w-full overflow-hidden flex flex-col gap-3"
    >
      {/* Sub-navigation tabs — matching My Swaps tab pill height, width, style, font, and active states */}
      <motion.div
        variants={itemVariants}
        className={cn(
          "p-1 rounded-2xl bg-slate-100/85 dark:bg-[#1c2333]/85 border border-slate-200/50 dark:border-white/5 flex items-center justify-between gap-1 shadow-sm shrink-0"
        )}
      >
        {([
          { id: 'calendar'  as TabType, label: 'Calendar', mobileLabel: 'Calendar', icon: Calendar,      count: undefined },
          { id: 'logs'      as TabType, label: 'Rules',    mobileLabel: 'Rules',    icon: ClipboardList, count: rules.length },
          { id: 'configure' as TabType, label: 'Config',   mobileLabel: 'Config',   icon: Settings,      count: editState.mode ? '*' : undefined },
        ] as const).map(tab => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all active:scale-[0.98]',
                isActive
                  ? 'bg-[#7b61ff] text-white shadow-sm'
                  : (isDark ? 'text-white/40 hover:text-white hover:bg-white/5' : 'text-slate-900/40 hover:text-slate-900 hover:bg-slate-900/5')
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.mobileLabel}</span>
              {tab.count !== undefined && (
                <span className={cn(
                  "inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full text-[9px] font-black tabular-nums",
                  isActive
                    ? "bg-white/20 text-white"
                    : (isDark ? "bg-white/5 text-white/40" : "bg-slate-900/5 text-slate-900/40")
                )}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </motion.div>

      <div
        className={cn(
          "flex-1 min-h-0 flex flex-col overflow-hidden rounded-[32px] border transition-all relative",
          isDark
            ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20"
            : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
        )}
      >
        {/* Tab Content */}
        <AnimatePresence mode="wait">
          <motion.div key={activeTab} {...tabTransition} className="flex-1 overflow-hidden">
            {activeTab === 'calendar' && (
              <CalendarPane
                slots={slots}
                assignedShifts={assignedShifts}
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

        {/* The mobile "add" FAB lives on the PAGE, not here. Two reasons it
            could not stay: this one was ungated, so it offered to add a
            declaration for a job the person holds no contract in — a write the
            database refuses — and `bottom-24 right-6` is a guess at where the
            bottom navigation is, rather than the shared clearance variables
            every other floating action uses. */}
      </div>
    </motion.div>
  );
}

export default AvailabilityScreen;
