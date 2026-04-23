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
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { PersonalPageHeader } from '@/modules/core/ui/components/PersonalPageHeader';
import { CalendarDays } from 'lucide-react';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';

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
  const { isDark } = useTheme();
  const { scope, setScope, isGammaLocked } = useScopeFilter('personal');

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
  // RENDER: SUB-COMPONENTS
  // ========================================

  const renderFunctionBar = () => (
    <div className={cn(
      "flex flex-row items-center gap-2 w-full transition-all p-1.5 rounded-2xl border overflow-hidden",
      isDark 
          ? "bg-[#111827]/60 backdrop-blur-md border-white/5 shadow-inner shadow-black/20" 
          : "bg-slate-100/50 border-slate-200/50"
    )}>
      <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto scrollbar-none py-0.5">
        {/* Month Navigation */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={handlePrevMonth}
            className={cn(
              "h-9 w-9 lg:h-11 lg:w-11 rounded-xl transition-all",
              isDark ? "bg-[#111827]/60 text-muted-foreground hover:text-white" : "bg-white shadow-sm"
            )}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <div className={cn(
            "h-9 lg:h-11 px-4 lg:px-6 rounded-xl flex items-center justify-center min-w-[120px] md:min-w-[180px]",
            isDark ? "bg-[#111827]/60" : "bg-white shadow-sm"
          )}>
            <span className="text-[10px] lg:text-[11px] font-black uppercase tracking-[0.2em] text-foreground">
              {format(currentMonth, 'MMMM yyyy')}
            </span>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={handleNextMonth}
            className={cn(
              "h-9 w-9 lg:h-11 lg:w-11 rounded-xl transition-all",
              isDark ? "bg-[#111827]/60 text-muted-foreground hover:text-white" : "bg-white shadow-sm"
            )}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="h-6 w-px bg-border/20 flex-shrink-0 mx-1" />

        {/* Add Availability Button */}
        <Button
          onClick={handleAddAvailability}
          className={cn(
            "flex-shrink-0 gap-2 h-9 lg:h-11 px-3 lg:px-6 rounded-xl font-black uppercase text-[9px] lg:text-[10px] tracking-wider transition-all shadow-sm",
            isDark 
              ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20" 
              : "bg-indigo-50 text-indigo-700 border border-indigo-100 hover:bg-indigo-100"
          )}
        >
          <Plus className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
          <span className="hidden sm:inline">Add Availability</span>
          <span className="sm:hidden text-[8px]">Add</span>
        </Button>

        <div className="h-6 w-px bg-border/20 flex-shrink-0 mx-1" />

        {/* Refresh Button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={handleRefresh}
          className={cn(
              "h-9 w-9 lg:h-11 lg:w-11 rounded-xl flex-shrink-0 transition-all",
              isDark 
                  ? "bg-[#111827]/60 text-muted-foreground hover:text-white" 
                  : "bg-slate-200/50 text-slate-500 hover:text-slate-900 hover:bg-slate-200"
          )}
        >
          <RefreshCw className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
        </Button>
      </div>
    </div>
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
        className="flex flex-col h-full w-full overflow-hidden"
      >
        {/* ── Unified Header ── */}
        <div className="sticky top-0 z-30 -mx-4 px-4 md:-mx-8 md:px-8 pt-4 pb-4 lg:pb-6">
          <div className={cn(
              "rounded-[32px] p-4 lg:p-6 transition-all border",
              isDark 
                  ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
                  : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
          )}>
            <PersonalPageHeader
              title="Availabilities"
              Icon={CalendarDays}
              scope={scope}
              setScope={setScope}
              isGammaLocked={isGammaLocked}
              className="mb-4 lg:mb-6"
            />
            {renderFunctionBar()}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden pt-2 lg:pt-4">
          <div className={cn(
              "h-full flex overflow-hidden rounded-[32px] border transition-all",
              isDark 
                  ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
                  : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
          )}>
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
        {/* ── Unified Header ── */}
        <div className="sticky top-0 z-30 px-4 pt-4 pb-2">
          <div className={cn(
            "rounded-[32px] p-4 transition-all border",
            isDark 
              ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
              : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
          )}>
            <PersonalPageHeader
              title="Availabilities"
              Icon={CalendarDays}
              scope={scope}
              setScope={setScope}
              isGammaLocked={isGammaLocked}
              className="mb-4"
            />
            {renderFunctionBar()}
          </div>
        </div>

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
      {/* ── Unified Header ── */}
      <div className="sticky top-0 z-30 px-4 pt-4 pb-2">
        <div className={cn(
          "rounded-[32px] p-4 transition-all border",
          isDark 
            ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
            : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
        )}>
          <PersonalPageHeader
            title="Availabilities"
            Icon={CalendarDays}
            scope={scope}
            setScope={setScope}
            isGammaLocked={isGammaLocked}
            className="mb-3"
          />
          {/* Simplified Month Nav for Mobile */}
          <div className="flex items-center justify-between gap-2 px-1">
             <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={handlePrevMonth} className="h-8 w-8 rounded-lg">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-[10px] font-black uppercase tracking-wider">
                  {format(currentMonth, 'MMM yy')}
                </span>
                <Button variant="ghost" size="icon" onClick={handleNextMonth} className="h-8 w-8 rounded-lg">
                  <ChevronRight className="h-4 w-4" />
                </Button>
             </div>
             <Button variant="ghost" size="icon" onClick={handleRefresh} className="h-8 w-8 rounded-lg">
                <RefreshCw className="h-3.5 w-3.5" />
             </Button>
          </div>
        </div>
      </div>

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
