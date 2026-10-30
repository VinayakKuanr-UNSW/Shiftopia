import React, { useState } from 'react';
import {
  Grid3x3,
  Thermometer,
  PhoneCall,
  BarChart3,
  Download,
  RefreshCcw,
  Filter,
  ArrowUpDown,
  SlidersHorizontal,
  CalendarDays,
  Clock,
  ShieldCheck,
  BatteryLow,
  Gauge,
  Scale,
  Check,
  X,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { TooltipProvider } from '@/modules/core/ui/primitives/tooltip';
import {
  UnifiedRosterNavigator,
  type ViewType,
  type DateRange,
} from '@/modules/rosters/ui/components/UnifiedRosterNavigator';
import {
  ToolbarRow,
  ToolbarSegmented,
  ToolbarIconButton,
  type ToolbarSegmentedOption,
} from '@/modules/core/ui/components/Toolbar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/modules/core/ui/primitives/popover';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from '@/modules/core/ui/primitives/command';
import type { CellMode } from './TeamAvailabilityGrid';
import { GridBadgeLegendPopover } from './GridBadgeLegendPopover';

export type ViewKey = 'grid' | 'coverage' | 'nearmiss';
export type SortOptionKey = 'name' | 'fewest-days' | 'most-days';

const VIEWS: Array<{ key: ViewKey; label: string; Icon: typeof Grid3x3 }> = [
  { key: 'grid', label: 'Team', Icon: Grid3x3 },
  { key: 'coverage', label: 'Coverage', Icon: Thermometer },
  { key: 'nearmiss', label: 'Near misses', Icon: PhoneCall },
];

const GRID_VIEW_OPTIONS: ReadonlyArray<ToolbarSegmentedOption<ViewKey>> = VIEWS.map((v) => ({
  id: v.key,
  label: v.label,
  icon: <v.Icon className="h-3.5 w-3.5 shrink-0" />,
}));

export const CELL_MODES: Array<{
  key: CellMode;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  note?: string;
}> = [
  { key: 'availability', label: 'Availability', Icon: CalendarDays },
  { key: 'hours', label: 'Hours', Icon: Clock },
  { key: 'compliance', label: 'Compliance', Icon: ShieldCheck },
  { key: 'fatigue', label: 'Fatigue', Icon: BatteryLow },
  {
    key: 'utilization',
    label: 'Utilization',
    Icon: Gauge,
    note: 'Utilization is measured against a WEEKLY contract, so the percentage is reported in the week columns. Cells show the daily hours that build it.',
  },
  {
    key: 'fairness',
    label: 'Fairness',
    Icon: Scale,
    note: 'Fairness is a 91-day comparison against the team, so the standing is reported per person in the right-hand column. Cells show what each day contributed — Saturday, Sunday, night or public holiday.',
  },
];

const SORT_OPTIONS: Array<{
  key: SortOptionKey;
  label: string;
}> = [
  { key: 'name', label: 'Name (A–Z)' },
  { key: 'fewest-days', label: 'Fewest Days' },
  { key: 'most-days', label: 'Most Days' },
];

const EMPLOYMENT_OPTIONS = [
  { id: 'Casual', label: 'Casual' },
  { id: 'Part-Time', label: 'Part-Time' },
  { id: 'Full-Time', label: 'Full-Time' },
];

/* ─── Global Scope Command Footer ─── */
const CommandFooter: React.FC = () => (
  <div className="p-2.5 bg-indigo-50/50 dark:bg-muted/20 border-t border-primary/5 dark:border-white/5 flex items-center justify-between text-[11px] font-black uppercase tracking-[0.18em] text-primary/60 dark:text-muted-foreground/60">
    <div className="flex items-center gap-2.5">
      <span className="flex items-center gap-1">
        <span className="px-1 py-0.5 rounded bg-background/60 border border-border/40 text-[11px]">
          ↑↓
        </span>{' '}
        NAV
      </span>
      <span className="flex items-center gap-1">
        <span className="px-1 py-0.5 rounded bg-background/60 border border-border/40 text-[11px]">
          ↵
        </span>{' '}
        SELECT
      </span>
    </div>
    <span className="flex items-center gap-1">
      <span className="px-1 py-0.5 rounded bg-background/60 border border-border/40 text-[11px]">
        ESC
      </span>{' '}
      CLOSE
    </span>
  </div>
);

/* ─── Filters Popover ─── */
interface GridFilterPopoverProps {
  employmentStatuses: string[];
  onEmploymentStatusesChange: (statuses: string[]) => void;
  search: string;
  onSearchChange: (search: string) => void;
  className?: string;
}

const GridFilterPopover: React.FC<GridFilterPopoverProps> = ({
  employmentStatuses,
  onEmploymentStatusesChange,
  search,
  onSearchChange,
  className,
}) => {
  const [open, setOpen] = useState(false);
  const activeCount = employmentStatuses.length + (search.trim().length > 0 ? 1 : 0);

  const toggleEmployment = (status: string) => {
    if (employmentStatuses.includes(status)) {
      onEmploymentStatusesChange(employmentStatuses.filter((s) => s !== status));
    } else {
      onEmploymentStatusesChange([...employmentStatuses, status]);
    }
  };

  const handleClearAll = () => {
    onEmploymentStatusesChange([]);
    onSearchChange('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ToolbarIconButton
          icon={<Filter />}
          tooltip={activeCount > 0 ? `Filters (${activeCount} active)` : 'Filters'}
          aria-label={`Filter members (${activeCount} active)`}
          // A popup trigger reports aria-expanded; a pressed state would be a second, wrong one.
          aria-pressed={undefined}
          variant="primary"
          isActive={open || activeCount > 0}
          badge={activeCount}
          className={className}
        />
      </PopoverTrigger>

      <PopoverContent
        className="w-[280px] sm:w-[320px] border-none shadow-none p-0 bg-transparent overflow-visible z-50 pointer-events-auto outline-none"
        sideOffset={10}
        align="end"
      >
        <Command
          className="bg-transparent overflow-visible w-full outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              e.preventDefault();
            }
          }}
        >
          <div className="flex flex-col gap-1.5 w-full">
            <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-slate-200 dark:border-white/10 overflow-hidden [&_[cmdk-input-wrapper]]:border-b-0">
              <CommandInput
                placeholder="Search team member or status..."
                value={search}
                onValueChange={onSearchChange}
                className="h-14 text-[14px] border-none ring-0 focus:ring-0 focus-visible:ring-0 outline-none focus:outline-none focus-visible:outline-none shadow-none w-full bg-transparent"
                autoFocus
              />
            </div>

            <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3)] border border-slate-200 dark:border-white/10 overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-300">
              <CommandList className="max-h-[50vh] p-1.5 scrollbar-none overflow-x-hidden">
                <CommandEmpty className="py-6 text-center text-muted-foreground font-medium text-[11px]">
                  No filter options found.
                </CommandEmpty>

                <CommandGroup
                  heading="Employment Status"
                  className="px-1 text-[11px] font-black uppercase tracking-widest text-muted-foreground/60"
                >
                  {EMPLOYMENT_OPTIONS.map((opt) => {
                    const isSelected = employmentStatuses.includes(opt.id);
                    return (
                      <CommandItem
                        key={opt.id}
                        value={opt.label}
                        onSelect={() => toggleEmployment(opt.id)}
                        className="flex items-center justify-between px-3 py-2.5 rounded-xl mb-1 cursor-pointer transition-all aria-selected:bg-primary aria-selected:text-primary-foreground group"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              'w-4 h-4 rounded-full border flex items-center justify-center transition-all shrink-0',
                              isSelected
                                ? 'bg-primary border-primary text-primary-foreground group-aria-selected:bg-white group-aria-selected:text-primary'
                                : 'border-muted-foreground/40 group-aria-selected:border-white/40',
                            )}
                          >
                            {isSelected && <Check className="w-3 h-3" strokeWidth={3} />}
                          </div>
                          <span className="font-semibold text-[11px] text-foreground group-aria-selected:text-primary-foreground">
                            {opt.label}
                          </span>
                        </div>
                        <CommandShortcut className="group-aria-selected:text-white/60">
                          ↵
                        </CommandShortcut>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>

                {activeCount > 0 && (
                  <CommandGroup className="px-1 pt-1 border-t border-border/20">
                    <CommandItem
                      value="Clear all active filters"
                      onSelect={handleClearAll}
                      className="flex items-center justify-between px-3 py-2 rounded-xl text-[11px] font-semibold text-rose-600 dark:text-rose-400 cursor-pointer hover:bg-rose-50 dark:hover:bg-rose-500/20"
                    >
                      <span className="flex items-center gap-2">
                        <X className="w-3.5 h-3.5" />
                        Clear All Filters
                      </span>
                    </CommandItem>
                  </CommandGroup>
                )}
              </CommandList>

              <CommandFooter />
            </div>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

/* ─── Cell Mode Popover ─── */
interface GridCellModePopoverProps {
  cellMode: CellMode;
  onCellModeChange: (mode: CellMode) => void;
  className?: string;
}

const GridCellModePopover: React.FC<GridCellModePopoverProps> = ({
  cellMode,
  onCellModeChange,
  className,
}) => {
  const [open, setOpen] = useState(false);
  const activeMode = CELL_MODES.find((m) => m.key === cellMode) || CELL_MODES[0];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ToolbarIconButton
          icon={<SlidersHorizontal />}
          tooltip={`Cells: ${activeMode.label}`}
          aria-label={`Cells Show: ${activeMode.label}`}
          aria-pressed={undefined}
          variant="indigo"
          isActive={open}
          className={className}
        />
      </PopoverTrigger>

      <PopoverContent
        className="w-[280px] sm:w-[320px] border-none shadow-none p-0 bg-transparent overflow-visible z-50 pointer-events-auto outline-none"
        sideOffset={10}
        align="end"
      >
        <Command
          className="bg-transparent overflow-visible w-full outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              e.preventDefault();
            }
          }}
        >
          <div className="flex flex-col gap-1.5 w-full">
            <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-slate-200 dark:border-white/10 overflow-hidden [&_[cmdk-input-wrapper]]:border-b-0">
              <CommandInput
                placeholder="Search cell mode..."
                className="h-14 text-[14px] border-none ring-0 focus:ring-0 focus-visible:ring-0 outline-none focus:outline-none focus-visible:outline-none shadow-none w-full bg-transparent"
                autoFocus
              />
            </div>

            <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3)] border border-slate-200 dark:border-white/10 overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-300">
              <CommandList className="max-h-[50vh] p-1.5 scrollbar-none overflow-x-hidden">
                <CommandEmpty className="py-6 text-center text-muted-foreground font-medium text-[11px]">
                  No cell modes found.
                </CommandEmpty>

                <CommandGroup
                  heading="Cells Show"
                  className="px-1 text-[11px] font-black uppercase tracking-widest text-muted-foreground/60"
                >
                  {CELL_MODES.map((mode) => {
                    const isSelected = cellMode === mode.key;
                    const ModeIcon = mode.Icon;
                    return (
                      <CommandItem
                        key={mode.key}
                        value={mode.label}
                        onSelect={() => {
                          onCellModeChange(mode.key);
                          setOpen(false);
                        }}
                        className="flex items-center justify-between px-3 py-2.5 rounded-xl mb-1 cursor-pointer transition-all aria-selected:bg-primary aria-selected:text-primary-foreground group"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              'w-4 h-4 rounded-full border flex items-center justify-center transition-all shrink-0',
                              isSelected
                                ? 'bg-primary border-primary text-primary-foreground group-aria-selected:bg-white group-aria-selected:text-primary'
                                : 'border-muted-foreground/40 group-aria-selected:border-white/40',
                            )}
                          >
                            {isSelected && <Check className="w-3 h-3" strokeWidth={3} />}
                          </div>
                          <ModeIcon className="w-3.5 h-3.5 shrink-0 opacity-70 group-aria-selected:opacity-100" />
                          <span className="font-semibold text-[11px] text-foreground group-aria-selected:text-primary-foreground">
                            {mode.label}
                          </span>
                        </div>
                        <CommandShortcut className="group-aria-selected:text-white/60">
                          ↵
                        </CommandShortcut>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>

              <CommandFooter />
            </div>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

/* ─── Sort Popover ─── */
interface GridSortPopoverProps {
  sortKey: SortOptionKey;
  onSortChange: (sort: SortOptionKey) => void;
  className?: string;
}

const GridSortPopover: React.FC<GridSortPopoverProps> = ({
  sortKey,
  onSortChange,
  className,
}) => {
  const [open, setOpen] = useState(false);
  const activeSort = SORT_OPTIONS.find((s) => s.key === sortKey) || SORT_OPTIONS[0];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ToolbarIconButton
          icon={<ArrowUpDown />}
          tooltip={`Sort: ${activeSort.label}`}
          aria-label={`Sort by: ${activeSort.label}`}
          aria-pressed={undefined}
          variant="purple"
          isActive={open}
          className={className}
        />
      </PopoverTrigger>

      <PopoverContent
        className="w-[280px] sm:w-[320px] border-none shadow-none p-0 bg-transparent overflow-visible z-50 pointer-events-auto outline-none"
        sideOffset={10}
        align="end"
      >
        <Command
          className="bg-transparent overflow-visible w-full outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              e.preventDefault();
            }
          }}
        >
          <div className="flex flex-col gap-1.5 w-full">
            <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-slate-200 dark:border-white/10 overflow-hidden [&_[cmdk-input-wrapper]]:border-b-0">
              <CommandInput
                placeholder="Search sort order..."
                className="h-14 text-[14px] border-none ring-0 focus:ring-0 focus-visible:ring-0 outline-none focus:outline-none focus-visible:outline-none shadow-none w-full bg-transparent"
                autoFocus
              />
            </div>

            <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3)] border border-slate-200 dark:border-white/10 overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-300">
              <CommandList className="max-h-[50vh] p-1.5 scrollbar-none overflow-x-hidden">
                <CommandEmpty className="py-6 text-center text-muted-foreground font-medium text-[11px]">
                  No sort options found.
                </CommandEmpty>

                <CommandGroup
                  heading="Sort By"
                  className="px-1 text-[11px] font-black uppercase tracking-widest text-muted-foreground/60"
                >
                  {SORT_OPTIONS.map((opt) => {
                    const isSelected = sortKey === opt.key;
                    return (
                      <CommandItem
                        key={opt.key}
                        value={opt.label}
                        onSelect={() => {
                          onSortChange(opt.key);
                          setOpen(false);
                        }}
                        className="flex items-center justify-between px-3 py-2.5 rounded-xl mb-1 cursor-pointer transition-all aria-selected:bg-primary aria-selected:text-primary-foreground group"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              'w-4 h-4 rounded-full border flex items-center justify-center transition-all shrink-0',
                              isSelected
                                ? 'bg-primary border-primary text-primary-foreground group-aria-selected:bg-white group-aria-selected:text-primary'
                                : 'border-muted-foreground/40 group-aria-selected:border-white/40',
                            )}
                          >
                            {isSelected && <Check className="w-3 h-3" strokeWidth={3} />}
                          </div>
                          <span className="font-semibold text-[11px] text-foreground group-aria-selected:text-primary-foreground">
                            {opt.label}
                          </span>
                        </div>
                        <CommandShortcut className="group-aria-selected:text-white/60">
                          ↵
                        </CommandShortcut>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>

              <CommandFooter />
            </div>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

/* ─── Grid Function Bar Props ─── */
interface GridFunctionBarProps {
  view: ViewKey;
  onViewChange: (view: ViewKey) => void;
  selectedDate: Date;
  viewType: ViewType;
  onDateChange: (date: Date, range?: DateRange) => void;
  onViewTypeChange: (viewType: ViewType) => void;
  onRangeChange?: (range: DateRange) => void;
  cellMode: CellMode;
  onCellModeChange: (mode: CellMode) => void;
  sortKey: SortOptionKey;
  onSortChange: (sort: SortOptionKey) => void;
  search: string;
  onSearchChange: (search: string) => void;
  employmentStatuses: string[];
  onEmploymentStatusesChange: (statuses: string[]) => void;
  onOpenStats?: () => void;
  onExport?: () => void;
  canExport?: boolean;
  onRefresh?: () => void;
  isLoading?: boolean;
  compactOnMobile?: boolean;
}

export const GridFunctionBar: React.FC<GridFunctionBarProps> = ({
  view,
  onViewChange,
  selectedDate,
  viewType,
  onDateChange,
  onViewTypeChange,
  onRangeChange,
  cellMode,
  onCellModeChange,
  sortKey,
  onSortChange,
  search,
  onSearchChange,
  employmentStatuses,
  onEmploymentStatusesChange,
  onOpenStats,
  onExport,
  canExport = true,
  onRefresh,
  isLoading,
  compactOnMobile,
}) => {
  return (
    <TooltipProvider delayDuration={200}>
      <ToolbarRow
        compactOnMobile={compactOnMobile}
        ariaLabel="Grid navigation and functions"
        className="text-foreground"
        views={
          <ToolbarSegmented
            value={view}
            onValueChange={onViewChange}
            options={GRID_VIEW_OPTIONS}
          />
        }
        modes={
          <UnifiedRosterNavigator
            variant="full"
            date={selectedDate}
            viewType={viewType}
            onChange={(date, newRange) => {
              onDateChange(date, newRange);
              if (newRange && onRangeChange) onRangeChange(newRange);
            }}
            onViewTypeChange={onViewTypeChange}
            showToday
            showPicker
          />
        }
        actions={<>
          {/* Cell Mode Popover (only on Team grid view) */}
          {view === 'grid' && (
            <GridCellModePopover
              cellMode={cellMode}
              onCellModeChange={onCellModeChange}
            />
          )}

          <GridSortPopover
            sortKey={sortKey}
            onSortChange={onSortChange}
          />

          {/* Filters Popover (Employment Statuses + Search) */}
          <GridFilterPopover
            employmentStatuses={employmentStatuses}
            onEmploymentStatusesChange={onEmploymentStatusesChange}
            search={search}
            onSearchChange={onSearchChange}
          />

          {/* Badge Legend & Indicator Popover ("i" icon) */}
          <GridBadgeLegendPopover />

          {onOpenStats && (
            <ToolbarIconButton
              icon={<BarChart3 />}
              tooltip="Availability Stats"
              onClick={onOpenStats}
              variant="purple"
            />
          )}

          {onExport && (
            <ToolbarIconButton
              icon={<Download />}
              tooltip="Export CSV"
              onClick={onExport}
              disabled={!canExport}
              variant="default"
            />
          )}

          {onRefresh && (
            <ToolbarIconButton
              icon={<RefreshCcw />}
              tooltip="Reload grid"
              onClick={onRefresh}
              isLoading={isLoading}
              variant="blue"
            />
          )}
        </>}
      />
    </TooltipProvider>
  );
};
