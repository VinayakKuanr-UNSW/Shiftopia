import React from 'react';
import {
  RefreshCw,
  List,
  LayoutGrid,
  Shield,
  Clock,
  Bot,
  CheckCircle,
  XCircle,
  UserX,
} from 'lucide-react';
import { TooltipProvider } from '@/modules/core/ui/primitives/tooltip';
import { cn } from '@/modules/core/lib/utils';
import {
  UnifiedRosterNavigator,
  type ViewType,
  type DateRange,
} from '@/modules/rosters/ui/components/UnifiedRosterNavigator';
import {
  ToolbarRow,
  ToolbarSegmented,
  ToolbarIconButton,
  toolbar,
  type ToolbarSegmentedOption,
} from '@/modules/core/ui/components/Toolbar';
import {
  TimesheetFilterDrawer,
  type ActiveFilters,
} from './TimesheetFilterDrawer';
import { GroupBySelector } from '@/modules/core/ui/components/GroupBySelector';
import type { RowGroupBy } from '@/modules/core/lib/row-grouping';
import { TIMESHEET_GROUP_BY_OPTIONS } from '../../domain/timesheet-grouping';
import type { TimesheetRow } from '../../model/timesheet.types';

/* ============================================================
   STATUS TABS CONFIGURATION
   ============================================================ */

const TIMESHEET_STATUS_TABS = [
  { id: 'all', label: 'All', icon: Shield, accent: 'slate' },
  { id: 'pending', label: 'Pending', icon: Clock, accent: 'amber' },
  { id: 'auto_approved', label: 'Auto-Approved', icon: Bot, accent: 'emerald' },
  { id: 'approved', label: 'Approved', icon: CheckCircle, accent: 'emerald' },
  { id: 'denied', label: 'Denied', icon: XCircle, accent: 'red' },
  { id: 'no_show', label: 'No-Show', icon: UserX, accent: 'slate' },
] as const;


const TIMESHEET_VIEWS: ReadonlyArray<ToolbarSegmentedOption<'table' | 'timecard'>> = [
  { id: 'table', icon: <List className="h-3.5 w-3.5" />, label: 'List' },
  { id: 'timecard', icon: <LayoutGrid className="h-3.5 w-3.5" />, label: 'Card' },
];

/* ============================================================
   TYPES
   ============================================================ */

interface TimesheetFunctionBarProps {
  // Views toggle (List / Card)
  viewMode: 'table' | 'timecard';
  onViewModeChange: (mode: 'table' | 'timecard') => void;

  // Date Navigation
  selectedDate: Date;
  viewType: ViewType;
  onDateChange: (date: Date) => void;
  onViewTypeChange: (viewType: ViewType) => void;
  onRangeChange?: (range: DateRange) => void;

  // Data Reload
  onRefresh: () => void;
  isLoading?: boolean;

  // Filters
  entries: TimesheetRow[];
  appliedFilters: ActiveFilters;
  onApplyFilters: (filters: ActiveFilters) => void;
  activeFilterCount: number;

  // Group By
  groupBy: RowGroupBy;
  onGroupByChange: (groupBy: RowGroupBy) => void;

  // Status Filter Tabs
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  statusCounts: Record<string, number>;

  // Optional presentation flags
  transparent?: boolean;
  compactOnMobile?: boolean;
  className?: string;
}

/* ============================================================
   MAIN COMPONENT
   ============================================================ */

export const TimesheetFunctionBar: React.FC<TimesheetFunctionBarProps> = ({
  viewMode,
  onViewModeChange,
  selectedDate,
  viewType,
  onDateChange,
  onViewTypeChange,
  onRangeChange,
  onRefresh,
  isLoading = false,
  entries,
  appliedFilters,
  onApplyFilters,
  activeFilterCount,
  groupBy,
  onGroupByChange,
  statusFilter,
  onStatusFilterChange,
  statusCounts,
  transparent = true,
  compactOnMobile = true,
  className,
}) => {
  return (
    <TooltipProvider delayDuration={200}>
      <ToolbarRow
        compactOnMobile={compactOnMobile}
        className={cn(!transparent && toolbar.standalone, className)}
        views={
          <ToolbarSegmented
            value={viewMode}
            onValueChange={onViewModeChange}
            options={TIMESHEET_VIEWS}
          />
        }
        modes={
          <UnifiedRosterNavigator
            variant="full"
            date={selectedDate}
            viewType={viewType}
            onChange={(date, newRange) => {
              onDateChange(date);
              if (newRange && onRangeChange) onRangeChange(newRange);
            }}
            onViewTypeChange={onViewTypeChange}
            showToday
          />
        }
        actions={<>
              {/* Reload / Refresh icon button (matches Roster blue variant) */}
              <ToolbarIconButton
                icon={<RefreshCw className="h-5 w-5" />}
                tooltip="Reload data"
                onClick={onRefresh}
                isLoading={isLoading}
                variant="blue"
              />

              {/* Filters icon button with tap point & Global Scope style dropdown */}
              <TimesheetFilterDrawer
                entries={entries}
                appliedFilters={appliedFilters}
                onApply={onApplyFilters}
                activeCount={activeFilterCount}
                statusFilter={statusFilter}
                onStatusFilterChange={onStatusFilterChange}
                statusCounts={statusCounts}
                statusOptions={TIMESHEET_STATUS_TABS.map((t) => ({ id: t.id, label: t.label }))}
                statusSectionLabel="Timesheet Status"
                triggerVariant="icon"
              />

              {/* Group By icon button with tap point & Global Scope style dropdown */}
              <GroupBySelector
                value={groupBy}
                onChange={onGroupByChange}
                options={TIMESHEET_GROUP_BY_OPTIONS}
                triggerVariant="icon"
              />
        </>}
      />
    </TooltipProvider>
  );
};

