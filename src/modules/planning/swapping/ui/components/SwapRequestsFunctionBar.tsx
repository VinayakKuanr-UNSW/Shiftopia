import React, { useState } from 'react';
import {
  List,
  LayoutGrid,
  Filter,
  RefreshCw,
  Check,
  Clock,
  ArrowLeftRight,
  CheckCircle,
  XCircle,
  Shield,
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
import { GroupBySelector } from '@/modules/core/ui/components/GroupBySelector';
import type { RowGroupBy } from '@/modules/core/lib/row-grouping';
import { SWAP_GROUP_BY_OPTIONS } from './swap-grouping';
import type { SwapStatus } from '../../model/swap.types';

const SWAP_STATUS_TABS: {
  id: SwapStatus | 'all';
  label: string;
  icon: typeof Clock;
  accent: string;
}[] = [
  { id: 'MANAGER_PENDING', label: 'Pending', icon: Clock, accent: 'amber' },
  { id: 'OPEN', label: 'Open', icon: ArrowLeftRight, accent: 'blue' },
  { id: 'APPROVED', label: 'Approved', icon: CheckCircle, accent: 'emerald' },
  { id: 'REJECTED', label: 'Rejected', icon: XCircle, accent: 'rose' },
  { id: 'all', label: 'All', icon: Shield, accent: 'slate' },
];

interface SwapRequestsFilterPopoverProps {
  statusFilter: SwapStatus | 'all';
  onStatusFilterChange: (status: SwapStatus | 'all') => void;
  statusCounts: Record<string, number>;
  className?: string;
}

const SwapRequestsFilterPopover: React.FC<SwapRequestsFilterPopoverProps> = ({
  statusFilter,
  onStatusFilterChange,
  statusCounts,
  className,
}) => {
  const [open, setOpen] = useState(false);
  const activeTabInfo =
    SWAP_STATUS_TABS.find((t) => t.id === statusFilter) || SWAP_STATUS_TABS[0];
  const count = statusCounts[statusFilter] ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ToolbarIconButton
          icon={<Filter />}
          tooltip={`Status: ${activeTabInfo.label} (${count})`}
          aria-label={`Filter by status: ${activeTabInfo.label}`}
          // A popup trigger reports aria-expanded; a pressed state would be a second, wrong one.
          aria-pressed={undefined}
          variant="amber"
          isActive={open || statusFilter !== 'all'}
          badge={count}
          badgeClassName="bg-amber-500 text-white"
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
            {/* Search Bar Container */}
            <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-slate-200 dark:border-white/10 overflow-hidden [&_[cmdk-input-wrapper]]:border-b-0">
              <CommandInput
                placeholder="Search status filters..."
                className="h-14 text-[14px] border-none ring-0 focus:ring-0 focus-visible:ring-0 outline-none focus:outline-none focus-visible:outline-none shadow-none w-full bg-transparent"
                autoFocus
              />
            </div>

            {/* Results Container */}
            <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3)] border border-slate-200 dark:border-white/10 overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-300">
              <CommandList className="max-h-[50vh] p-1.5 scrollbar-none overflow-x-hidden">
                <CommandEmpty className="py-8 text-center text-muted-foreground font-medium text-[13px]">
                  No status filters found.
                </CommandEmpty>

                <CommandGroup heading="Filter by Status" className="px-1">
                  {SWAP_STATUS_TABS.map((tab) => {
                    const isSelected = statusFilter === tab.id;
                    const TabIcon = tab.icon;
                    const tabCount = statusCounts[tab.id] ?? 0;
                    return (
                      <CommandItem
                        key={tab.id}
                        value={tab.label}
                        onSelect={() => {
                          onStatusFilterChange(tab.id);
                          setOpen(false);
                        }}
                        className={cn(
                          'flex items-center gap-3 px-4 py-3 rounded-xl mb-1 cursor-pointer transition-all',
                          'aria-selected:bg-primary aria-selected:text-primary-foreground group',
                        )}
                      >
                        <div
                          className={cn(
                            'w-5 h-5 rounded-md border flex items-center justify-center transition-all shrink-0',
                            isSelected
                              ? 'bg-primary border-primary text-primary-foreground group-aria-selected:bg-white group-aria-selected:text-primary group-aria-selected:border-white'
                              : 'border-muted-foreground/30 group-aria-selected:border-white/40',
                          )}
                        >
                          {isSelected && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                        </div>
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <TabIcon className="h-4 w-4 shrink-0 opacity-70" />
                          <span className="font-semibold text-[13px] capitalize truncate">{tab.label}</span>
                          <span
                            className={cn(
                              'text-[11px] font-bold px-1.5 py-0.5 rounded-full ml-auto shrink-0',
                              isSelected
                                ? 'bg-primary/20 group-aria-selected:bg-white/20 text-inherit'
                                : 'bg-muted text-muted-foreground',
                            )}
                          >
                            {tabCount}
                          </span>
                        </div>
                        <CommandShortcut className="group-aria-selected:text-white/60">↵</CommandShortcut>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>

              {/* Keyboard footer */}
              <div className="p-3 bg-indigo-50/50 dark:bg-muted/20 border-t border-primary/5 dark:border-white/5 flex items-center justify-between text-[11px] font-black uppercase tracking-[0.2em] text-primary/50 dark:text-muted-foreground/50">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1">
                    <kbd className="px-1 py-0.5 rounded border border-primary/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-primary/70 dark:text-inherit">
                      ↑↓
                    </kbd>{' '}
                    Nav
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="px-1 py-0.5 rounded border border-primary/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-primary/70 dark:text-inherit">
                      ↵
                    </kbd>{' '}
                    Select
                  </span>
                </div>
                <span className="flex items-center gap-1">
                  <kbd className="px-1 py-0.5 rounded border border-primary/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-primary/70 dark:text-inherit">
                    esc
                  </kbd>{' '}
                  Close
                </span>
              </div>
            </div>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

const SWAP_VIEWS: ReadonlyArray<ToolbarSegmentedOption<'card' | 'table'>> = [
  { id: 'table', icon: <List className="h-3.5 w-3.5" />, label: 'List' },
  { id: 'card', icon: <LayoutGrid className="h-3.5 w-3.5" />, label: 'Card' },
];

interface SwapRequestsFunctionBarProps {
  viewMode: 'card' | 'table';
  onViewModeChange: (mode: 'card' | 'table') => void;
  selectedDate: Date;
  viewType: ViewType;
  onDateChange: (date: Date, range?: DateRange) => void;
  onViewTypeChange: (viewType: ViewType) => void;
  onRangeChange?: (range: DateRange) => void;
  groupBy: RowGroupBy;
  onGroupByChange: (groupBy: RowGroupBy) => void;
  statusFilter: SwapStatus | 'all';
  onStatusFilterChange: (status: SwapStatus | 'all') => void;
  statusCounts: Record<string, number>;
  onRefresh?: () => void;
  isLoading?: boolean;
  compactOnMobile?: boolean;
  className?: string;
}

export const SwapRequestsFunctionBar: React.FC<SwapRequestsFunctionBarProps> = ({
  viewMode,
  onViewModeChange,
  selectedDate,
  viewType,
  onDateChange,
  onViewTypeChange,
  onRangeChange,
  groupBy,
  onGroupByChange,
  statusFilter,
  onStatusFilterChange,
  statusCounts,
  onRefresh,
  isLoading = false,
  compactOnMobile = false,
  className,
}) => {
  return (
    <TooltipProvider delayDuration={200}>
      <ToolbarRow
        compactOnMobile={compactOnMobile}
        className={className}
        views={
          <ToolbarSegmented
            value={viewMode}
            onValueChange={onViewModeChange}
            options={SWAP_VIEWS}
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
          />
        }
        actions={<>
          <SwapRequestsFilterPopover
            statusFilter={statusFilter}
            onStatusFilterChange={onStatusFilterChange}
            statusCounts={statusCounts}
          />

          <GroupBySelector
            value={groupBy}
            onChange={onGroupByChange}
            options={SWAP_GROUP_BY_OPTIONS}
            triggerVariant="icon"
          />

          {onRefresh && (
            <ToolbarIconButton
              icon={<RefreshCw />}
              tooltip="Reload swap requests"
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

