import React, { useState, useEffect, useMemo } from 'react';
import { ChevronDown, Check, Brush } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { surface } from '@/modules/core/ui/layout/pageTokens';
import { ToolbarIconButton } from '@/modules/core/ui/components/Toolbar';
import { Popover, PopoverTrigger, PopoverContent } from '@/modules/core/ui/primitives/popover';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from '@/modules/core/ui/primitives/command';
import { useRosterUI, type AdvancedFilters } from '@/modules/rosters/contexts/RosterUIContext';

interface RosterHorizontalFilterBarProps {
  onClose: () => void;
  className?: string;
}

interface FilterOption {
  id: string;
  name: string;
}

interface HorizontalFilterDropdownProps {
  label: string;
  displayText: string;
  selectedValue: string;
  options: FilterOption[];
  onSelect: (value: string) => void;
}

const HorizontalFilterDropdown: React.FC<HorizontalFilterDropdownProps> = ({
  label,
  displayText,
  selectedValue,
  options,
  onSelect,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${displayText}`}
          aria-expanded={isOpen}
          className={cn(
            "flex items-center gap-2 sm:gap-3 px-3 py-1.5 rounded-xl text-[13px] font-medium transition-all duration-200",
            "border-0 min-w-[100px] sm:min-w-[125px] flex-1 justify-between h-10 sm:h-10.5",
            "hover:scale-[1.01] active:scale-[0.99] relative",
            isOpen ? "ring-2 ring-primary bg-primary/5 shadow-none" : "",
            "bg-white dark:bg-[#1c2333] text-slate-700 dark:text-white/80 hover:bg-indigo-50/50 dark:hover:bg-[#252d40] cursor-pointer shadow-none"
          )}
        >
          <div className="flex flex-col items-start gap-0.5 text-left min-w-0 flex-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300 leading-none">
              {label}
            </span>
            <span className="truncate max-w-[90px] sm:max-w-[130px] text-[11px] font-semibold text-slate-900 dark:text-foreground leading-none">
              {displayText}
            </span>
          </div>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "w-3.5 h-3.5 text-slate-400 dark:text-white/40 flex-shrink-0 transition-transform duration-200",
              isOpen && "rotate-180"
            )}
          />
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="top"
        sideOffset={8}
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[200px] border-none shadow-none p-0 bg-transparent overflow-visible z-50 pointer-events-auto outline-none"
      >
        <Command
          className="bg-transparent overflow-visible w-full outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setIsOpen(false);
              e.preventDefault();
            }
          }}
        >
          <div className="flex flex-col gap-1.5 w-full">
            {options.length > 5 && (
              <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-slate-200 dark:border-white/10 overflow-hidden [&_[cmdk-input-wrapper]]:border-b-0">
                <CommandInput
                  placeholder={`Search ${label.toLowerCase()}...`}
                  className="h-12 text-[13px] border-none ring-0 focus:ring-0 focus-visible:ring-0 outline-none focus:outline-none focus-visible:outline-none shadow-none w-full bg-transparent"
                  autoFocus
                />
              </div>
            )}

            <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3)] border border-slate-200 dark:border-white/10 overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-200">
              <CommandList className="max-h-[45vh] p-1.5 scrollbar-none overflow-x-hidden">
                <CommandEmpty className="py-6 text-center text-muted-foreground font-medium text-[11px]">
                  No results found.
                </CommandEmpty>

                <CommandGroup heading={label} className="px-1">
                  {options.map((opt) => {
                    const isSelected = selectedValue === opt.id;
                    return (
                      <CommandItem
                        key={opt.id}
                        value={opt.name}
                        aria-checked={isSelected}
                        onSelect={() => {
                          onSelect(opt.id);
                          setIsOpen(false);
                        }}
                        className={cn(
                          "flex items-center gap-3 px-4 py-3 rounded-xl mb-1 cursor-pointer transition-all",
                          "aria-selected:bg-primary aria-selected:text-primary-foreground group"
                        )}
                      >
                        <div
                          className={cn(
                            "w-5 h-5 rounded-md border flex items-center justify-center transition-all flex-shrink-0",
                            isSelected
                              ? "bg-white border-white text-primary"
                              : "border-muted-foreground/30 group-aria-selected:border-white/40"
                          )}
                        >
                          {isSelected && (
                            <Check className="w-3.5 h-3.5" strokeWidth={3} aria-hidden="true" />
                          )}
                        </div>
                        <span className="font-semibold text-[11px] sm:text-[13px] flex-1 truncate">
                          {opt.name}
                        </span>
                        <CommandShortcut className="group-aria-selected:text-white/60">
                          ↵
                        </CommandShortcut>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>

              <div
                aria-hidden="true"
                className="p-2.5 bg-indigo-50/50 dark:bg-muted/20 border-t border-primary/5 dark:border-white/5 flex items-center justify-between text-[11px] font-black uppercase tracking-[0.2em] text-primary/50 dark:text-muted-foreground/50"
              >
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <kbd className="px-1 py-0.5 rounded border border-primary/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-primary/70 dark:text-inherit">↑↓</kbd> Nav
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="px-1 py-0.5 rounded border border-primary/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-primary/70 dark:text-inherit">↵</kbd> Select
                  </span>
                </div>
                <span className="flex items-center gap-1">
                  <kbd className="px-1 py-0.5 rounded border border-primary/10 dark:border-border/40 bg-white/80 dark:bg-background/50 text-primary/70 dark:text-inherit">esc</kbd> Close
                </span>
              </div>
            </div>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export const RosterHorizontalFilterBar: React.FC<RosterHorizontalFilterBarProps> = ({
  onClose,
  className,
}) => {
  const { advancedFilters, setAdvancedFilters } = useRosterUI();

  // Local draft state for filters
  const [draftFilters, setDraftFilters] = useState<AdvancedFilters>(advancedFilters);

  // Re-sync draft when applied filters change externally
  useEffect(() => {
    setDraftFilters(advancedFilters);
  }, [advancedFilters]);

  // Options configuration
  const stateIdOptions = useMemo<FilterOption[]>(() => [
    { id: 'all', name: 'All States' },
    { id: 'S1', name: 'S1 — Draft' },
    { id: 'S2', name: 'S2 — Draft (Assigned)' },
    { id: 'S3', name: 'S3 — Offered' },
    { id: 'S4', name: 'S4 — Confirmed' },
    { id: 'S5', name: 'S5 — Bidding' },
    { id: 'S9', name: 'S9 — Trade (Peer)' },
    { id: 'S10', name: 'S10 — Trade (Mgr)' },
    { id: 'S11', name: 'S11 — In Progress' },
    { id: 'S13', name: 'S13 — Completed' },
    { id: 'S15', name: 'S15 — Cancelled' },
  ], []);

  const lifecycleOptions = useMemo<FilterOption[]>(() => [
    { id: 'all', name: 'All' },
    { id: 'draft', name: 'Draft' },
    { id: 'published', name: 'Published' },
    { id: 'cancelled', name: 'Cancelled' },
  ], []);

  const assignmentOptions = useMemo<FilterOption[]>(() => [
    { id: 'all', name: 'All' },
    { id: 'unassigned', name: 'Unassigned' },
    { id: 'assigned', name: 'Assigned' },
  ], []);

  const outcomeOptions = useMemo<FilterOption[]>(() => [
    { id: 'all', name: 'All' },
    { id: 'none', name: 'None' },
    { id: 'pending', name: 'Pending' },
    { id: 'offered', name: 'Offered' },
    { id: 'confirmed', name: 'Confirmed' },
  ], []);

  const biddingOptions = useMemo<FilterOption[]>(() => [
    { id: 'all', name: 'All' },
    { id: 'not_on_bidding', name: 'Not on Bidding' },
    { id: 'on_bidding', name: 'On Bidding' },
  ], []);

  const tradingOptions = useMemo<FilterOption[]>(() => [
    { id: 'all', name: 'All' },
    { id: 'none', name: 'No Trade' },
    { id: 'requested', name: 'Trade Requested' },
  ], []);

  // Determine current display values
  const currentStateIdDisplay =
    stateIdOptions.find((opt) => opt.id === (draftFilters.stateId || 'all'))?.name || 'All States';
  const currentLifecycleDisplay = {
    all: 'All',
    draft: 'Draft',
    published: 'Published',
    cancelled: 'Cancelled',
  }[draftFilters.lifecycleStatus] || 'All';
  const currentAssignmentDisplay = {
    all: 'All',
    unassigned: 'Unassigned',
    assigned: 'Assigned',
    on_bidding: 'On Bidding',
  }[draftFilters.assignmentStatus] || 'All';
  const currentOutcomeDisplay = {
    all: 'All',
    none: 'None',
    pending: 'Pending',
    offered: 'Offered',
    confirmed: 'Confirmed',
    emergency_assigned: 'Emergency Assigned',
  }[draftFilters.assignmentOutcome] || 'All';
  const currentBiddingDisplay = {
    all: 'All',
    not_on_bidding: 'Not on Bidding',
    on_bidding: 'On Bidding',
    on_bidding_normal: 'On Bidding',
    on_bidding_urgent: 'On Bidding (Urgent)',
    bidding_closed_no_winner: 'Closed',
  }[draftFilters.biddingStatus] || 'All';
  const currentTradingDisplay = {
    all: 'All',
    none: 'No Trade',
    requested: 'Trade Requested',
  }[draftFilters.tradingStatus] || 'All';

  // Check if draft has active filters
  const hasDraftActiveFilters = Boolean(
    draftFilters.stateId !== null ||
    draftFilters.lifecycleStatus !== 'all' ||
    draftFilters.assignmentStatus !== 'all' ||
    draftFilters.assignmentOutcome !== 'all' ||
    draftFilters.biddingStatus !== 'all' ||
    draftFilters.tradingStatus !== 'all'
  );

  const hasAppliedActiveFilters = Boolean(
    advancedFilters.stateId !== null ||
    advancedFilters.lifecycleStatus !== 'all' ||
    advancedFilters.assignmentStatus !== 'all' ||
    advancedFilters.assignmentOutcome !== 'all' ||
    advancedFilters.biddingStatus !== 'all' ||
    advancedFilters.tradingStatus !== 'all'
  );

  const isClearDisabled = !hasDraftActiveFilters && !hasAppliedActiveFilters;

  const handleClear = () => {
    setDraftFilters((prev) => ({
      ...prev,
      stateId: null,
      lifecycleStatus: 'all',
      assignmentStatus: 'all',
      assignmentOutcome: 'all',
      biddingStatus: 'all',
      tradingStatus: 'all',
    }));
  };

  const handleApply = () => {
    setAdvancedFilters(draftFilters);
    onClose();
  };

  return (
    <footer
      role="region"
      aria-label="Roster filters"
      className={cn('w-full shrink-0', className)}
    >
      <div className={surface.footerBar}>
        {/* 6 Filters in a single horizontal row */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto scrollbar-none py-0.5">
          {/* 1. State ID */}
          <HorizontalFilterDropdown
            label="State ID"
            displayText={currentStateIdDisplay}
            selectedValue={draftFilters.stateId || 'all'}
            options={stateIdOptions}
            onSelect={(val) =>
              setDraftFilters((prev) => ({
                ...prev,
                stateId: val === 'all' ? null : val,
              }))
            }
          />

          {/* 2. Lifecycle */}
          <HorizontalFilterDropdown
            label="Lifecycle"
            displayText={currentLifecycleDisplay}
            selectedValue={draftFilters.lifecycleStatus}
            options={lifecycleOptions}
            onSelect={(val) =>
              setDraftFilters((prev) => ({
                ...prev,
                lifecycleStatus: val as AdvancedFilters['lifecycleStatus'],
              }))
            }
          />

          {/* 3. Assignment */}
          <HorizontalFilterDropdown
            label="Assignment"
            displayText={currentAssignmentDisplay}
            selectedValue={draftFilters.assignmentStatus}
            options={assignmentOptions}
            onSelect={(val) =>
              setDraftFilters((prev) => ({
                ...prev,
                assignmentStatus: val as AdvancedFilters['assignmentStatus'],
              }))
            }
          />

          {/* 4. Outcome */}
          <HorizontalFilterDropdown
            label="Outcome"
            displayText={currentOutcomeDisplay}
            selectedValue={draftFilters.assignmentOutcome}
            options={outcomeOptions}
            onSelect={(val) =>
              setDraftFilters((prev) => ({
                ...prev,
                assignmentOutcome: val as AdvancedFilters['assignmentOutcome'],
              }))
            }
          />

          {/* 5. Bidding */}
          <HorizontalFilterDropdown
            label="Bidding"
            displayText={currentBiddingDisplay}
            selectedValue={draftFilters.biddingStatus}
            options={biddingOptions}
            onSelect={(val) =>
              setDraftFilters((prev) => ({
                ...prev,
                biddingStatus: val as AdvancedFilters['biddingStatus'],
              }))
            }
          />

          {/* 6. Trading */}
          <HorizontalFilterDropdown
            label="Trading"
            displayText={currentTradingDisplay}
            selectedValue={draftFilters.tradingStatus}
            options={tradingOptions}
            onSelect={(val) =>
              setDraftFilters((prev) => ({
                ...prev,
                tradingStatus: val as AdvancedFilters['tradingStatus'],
              }))
            }
          />
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-slate-300 dark:bg-white/10 mx-1 shrink-0 hidden sm:block" />

        {/* Right actions: Red Brush for Clear, Green Tick for Apply (these two only) */}
        <div className="flex items-center gap-1 shrink-0">
          <ToolbarIconButton
            icon={<Brush className="h-4 w-4" />}
            tooltip="Clear filters"
            onClick={handleClear}
            disabled={isClearDisabled}
            variant="rose"
            tooltipSide="top"
          />

          <ToolbarIconButton
            icon={<Check className="h-4 w-4" />}
            tooltip="Apply filters"
            onClick={handleApply}
            variant="emerald"
            tooltipSide="top"
          />
        </div>
      </div>
    </footer>
  );
};

