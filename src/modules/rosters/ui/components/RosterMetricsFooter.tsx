import React, { useState, useMemo, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { surface } from '@/modules/core/ui/layout/pageTokens';
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

interface RosterMetricsFooterProps {
  totalShifts: number;
  stateCounts?: Record<string, number>;
  selectedState?: string | null;
  onSelectState?: (stateId: string | null) => void;
  scheduledCost: number;
  actualCost: number;
  scheduledNetMinutes: number;
  actualNetMinutes: number;
  costedShifts: number;
  uncostedShifts: number;
  actualShifts: number;
  budget?: number;
  remainingBudget?: number;
  showBudget?: boolean;
  className?: string;
}

interface ShiftStateMetaItem {
  id: string;
  displayId?: string;
  label: string;
  fullLabel?: string;
  badgeClass: string;
  activeTextClass: string;
}

const ALL_FSM_STATES: ShiftStateMetaItem[] = [
  {
    id: 'S1',
    displayId: 'S1',
    label: 'Draft',
    badgeClass: 'bg-slate-500/10 border-slate-500/30 text-slate-700 dark:text-slate-300',
    activeTextClass: 'text-slate-900 dark:text-slate-100',
  },
  {
    id: 'S2',
    displayId: 'S2',
    label: 'Draft (Assigned)',
    badgeClass: 'bg-slate-500/10 border-slate-500/30 text-slate-700 dark:text-slate-300',
    activeTextClass: 'text-slate-900 dark:text-slate-100',
  },
  {
    id: 'S3',
    displayId: 'S3',
    label: 'Offered',
    badgeClass: 'bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-300',
    activeTextClass: 'text-blue-600 dark:text-blue-400',
  },
  {
    id: 'S4',
    displayId: 'S4',
    label: 'Confirmed',
    badgeClass: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300',
    activeTextClass: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    id: 'S5',
    displayId: 'S5',
    label: 'Bidding',
    badgeClass: 'bg-purple-500/10 border-purple-500/30 text-purple-700 dark:text-purple-300',
    activeTextClass: 'text-purple-600 dark:text-purple-400',
  },
  {
    id: 'S9',
    displayId: 'S6',
    label: 'Trade (Peer)',
    fullLabel: 'Trade Requested (Pending Peer)',
    badgeClass: 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300',
    activeTextClass: 'text-amber-600 dark:text-amber-400',
  },
  {
    id: 'S10',
    displayId: 'S7',
    label: 'Trade (Mgr)',
    fullLabel: 'Trade Requested (Pending Manager)',
    badgeClass: 'bg-orange-500/10 border-orange-500/30 text-orange-700 dark:text-orange-300',
    activeTextClass: 'text-orange-600 dark:text-orange-400',
  },
  {
    id: 'S11',
    displayId: 'S8',
    label: 'In Progress',
    badgeClass: 'bg-sky-500/10 border-sky-500/30 text-sky-700 dark:text-sky-300',
    activeTextClass: 'text-sky-600 dark:text-sky-400',
  },
  {
    id: 'S13',
    displayId: 'S9',
    label: 'Completed',
    badgeClass: 'bg-slate-500/10 border-slate-500/30 text-slate-600 dark:text-slate-400',
    activeTextClass: 'text-slate-700 dark:text-slate-300',
  },
  {
    id: 'S15',
    displayId: 'S10',
    label: 'Cancelled',
    badgeClass: 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300',
    activeTextClass: 'text-rose-600 dark:text-rose-400',
  },
];

function formatNetMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

/**
 * RosterMetricsFooter
 *
 * Bottom metrics bar matching the exact design language, font, typography,
 * spacing, and layout of the GlobalScopeFilter:
 * - Total Shifts dropdown with exact two-tier typography and floating glass popover
 * - Number card for the selected state/view
 * - Scheduled and Actual cards pinned at the far right
 */
export const RosterMetricsFooter: React.FC<RosterMetricsFooterProps> = ({
  totalShifts,
  stateCounts,
  selectedState,
  onSelectState,
  scheduledCost,
  actualCost,
  scheduledNetMinutes,
  actualNetMinutes,
  costedShifts,
  uncostedShifts,
  actualShifts,
  budget = 0,
  remainingBudget = 0,
  showBudget = false,
  className,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [internalState, setInternalState] = useState<string>('all');

  const currentSelectedState = selectedState !== undefined
    ? (selectedState || 'all')
    : internalState;

  const handleStateSelect = (stateId: string) => {
    if (selectedState === undefined) {
      setInternalState(stateId);
    }
    onSelectState?.(stateId === 'all' ? null : stateId);
    setIsOpen(false);
  };

  // Build state options including UNKNOWN and any dynamic states with count > 0
  const stateOptions = useMemo(() => {
    const list = [
      {
        id: 'all',
        name: 'All States',
        badge: null,
        badgeClass: '',
        count: totalShifts,
      },
      ...ALL_FSM_STATES.map((s) => ({
        id: s.id,
        name: `${s.id} — ${s.label}`,
        badge: s.id,
        badgeClass: s.badgeClass,
        count: stateCounts?.[s.id] ?? 0,
      })),
    ];

    if (stateCounts) {
      const unknownCount = (stateCounts['UNKNOWN'] || 0) + (stateCounts['Unknown'] || 0);
      if (unknownCount > 0) {
        list.push({
          id: 'UNKNOWN',
          name: 'UNKNOWN — Unknown',
          badge: 'UNKNOWN',
          badgeClass: 'bg-slate-500/10 border-slate-500/30 text-slate-500',
          count: unknownCount,
        });
      }
    }

    return list;
  }, [totalShifts, stateCounts]);

  // Selected option descriptor
  const selectedOption = useMemo(() => {
    return stateOptions.find((opt) => opt.id === currentSelectedState) || stateOptions[0];
  }, [stateOptions, currentSelectedState]);

  const selectedMeta = useMemo(() => {
    return ALL_FSM_STATES.find((s) => s.id === currentSelectedState);
  }, [currentSelectedState]);

  // Selected count for the number card
  const currentViewCount = useMemo(() => {
    if (currentSelectedState === 'all') return totalShifts;
    if (currentSelectedState === 'UNKNOWN') {
      return (stateCounts?.['UNKNOWN'] || 0) + (stateCounts?.['Unknown'] || 0);
    }
    return stateCounts?.[currentSelectedState] ?? 0;
  }, [currentSelectedState, totalShifts, stateCounts]);

  // Handle keyboard escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  return (
    <footer
      role="region"
      aria-label="Roster scheduled vs actual metrics"
      className={cn('w-full shrink-0', className)}
    >
      <div className={surface.footerBar}>
        {/* Left: Total Shifts Dropdown + Number for that view */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Total Shifts Dropdown Trigger */}
          <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`Total Shifts: ${selectedOption.name}`}
                aria-expanded={isOpen}
                className={cn(
                  "flex items-center gap-3 px-3 py-1.5 rounded-xl text-[13px] font-medium transition-all duration-300",
                  "border-0 min-w-[130px] sm:min-w-[175px] justify-between h-10 sm:h-10.5",
                  "hover:scale-[1.02] active:scale-[0.98] relative z-40",
                  isOpen ? "ring-2 ring-primary bg-primary/5 shadow-none" : "",
                  "bg-white dark:bg-[#1c2333] text-slate-700 dark:text-white/80 hover:bg-indigo-50/50 dark:hover:bg-[#252d40] cursor-pointer shadow-none"
                )}
              >
                <div className="flex flex-col items-start gap-0.5 text-left min-w-0 flex-1">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300 leading-none">
                    Total Shifts
                  </span>
                  <span className="truncate max-w-[130px] sm:max-w-[180px] text-[11px] font-semibold text-slate-900 dark:text-foreground leading-none">
                    {selectedOption.name}
                  </span>
                </div>
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "w-3.5 h-3.5 text-slate-400 dark:text-white/40 flex-shrink-0 transition-transform duration-300",
                    isOpen && "rotate-180"
                  )}
                />
              </button>
            </PopoverTrigger>

            <PopoverContent
              side="top"
              sideOffset={10}
              align="start"
              className="w-[var(--radix-popover-trigger-width)] min-w-[280px] border-none shadow-none p-0 bg-transparent overflow-visible z-50 pointer-events-auto outline-none"
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
                  {/* Search Bar Container */}
                  <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-slate-200 dark:border-white/10 overflow-hidden [&_[cmdk-input-wrapper]]:border-b-0">
                    <CommandInput
                      placeholder="Search shift states..."
                      className="h-12 text-[13px] border-none ring-0 focus:ring-0 focus-visible:ring-0 outline-none focus:outline-none focus-visible:outline-none shadow-none w-full bg-transparent"
                      autoFocus
                    />
                  </div>

                  {/* Results Container */}
                  <div className="bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3)] border border-slate-200 dark:border-white/10 overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-200">
                    <CommandList className="max-h-[50vh] p-1.5 scrollbar-none overflow-x-hidden">
                      <CommandEmpty className="py-6 text-center text-muted-foreground font-medium text-[11px]">
                        No shift states found.
                      </CommandEmpty>

                      <CommandGroup heading="Shift States" className="px-1">
                        {stateOptions.map((opt) => {
                          const isSelected = currentSelectedState === opt.id;
                          return (
                            <CommandItem
                              key={opt.id}
                              value={`${opt.id} ${opt.name}`}
                              aria-checked={isSelected}
                              onSelect={() => handleStateSelect(opt.id)}
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
                                {isSelected && <Check className="w-3.5 h-3.5" strokeWidth={3} aria-hidden="true" />}
                              </div>
                              <div className="flex items-center justify-between gap-2 min-w-0 flex-1">
                                <span className="font-semibold text-[11px] sm:text-[13px] truncate">
                                  {opt.name}
                                </span>
                                <span
                                  className={cn(
                                    "text-[11px] font-mono font-bold tabular-nums shrink-0",
                                    opt.count > 0 ? "text-slate-900 dark:text-foreground group-aria-selected:text-primary-foreground" : "text-slate-400 dark:text-muted-foreground/40"
                                  )}
                                >
                                  {opt.count}
                                </span>
                              </div>
                              <CommandShortcut className="group-aria-selected:text-white/60">↵</CommandShortcut>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>

                    <div className="p-2.5 bg-indigo-50/50 dark:bg-muted/20 border-t border-primary/5 dark:border-white/5 flex items-center justify-between text-[11px] font-black uppercase tracking-[0.2em] text-primary/50 dark:text-muted-foreground/50">
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

          {/* Number Card for that view */}
          <div className="flex items-center gap-3 px-3 py-1.5 rounded-xl h-10 sm:h-10.5 bg-white dark:bg-[#1c2333] min-w-[105px] sm:min-w-[135px] transition-all duration-300 hover:scale-[1.02] shadow-none">
            <div className="flex flex-col items-start gap-0.5 text-left">
              <span className="text-[11px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300 leading-none">
                {currentSelectedState === 'all' ? 'All In View' : `${selectedOption.badge || selectedOption.name} In View`}
              </span>
              <div className="flex items-baseline gap-1.5">
                <span
                  className={cn(
                    "text-[11px] sm:text-[13px] font-bold tabular-nums leading-none",
                    selectedMeta ? selectedMeta.activeTextClass : "text-slate-900 dark:text-foreground"
                  )}
                >
                  {currentViewCount}
                </span>
                <span className="text-[11px] font-mono text-slate-500 dark:text-muted-foreground leading-none">
                  shift{currentViewCount === 1 ? '' : 's'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Scheduled and Actual Cards at the far right */}
        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          {/* Scheduled Panel */}
          <div className="h-10 sm:h-10.5 rounded-xl border border-blue-400/35 bg-blue-500/10 px-3 py-1 min-w-[130px] sm:min-w-[155px] flex flex-col justify-between transition-all duration-300 hover:scale-[1.02]">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-widest text-blue-700 dark:text-blue-400 leading-none">
                Scheduled
              </span>
              <span className="text-[11px] font-mono text-slate-600 dark:text-muted-foreground tabular-nums leading-none">
                {formatNetMinutes(scheduledNetMinutes)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-semibold text-slate-900 dark:text-foreground tabular-nums leading-none">
                ${scheduledCost.toFixed(2)}
              </span>
              <span
                className={cn(
                  'text-[11px] font-mono truncate max-w-[85px] leading-none',
                  uncostedShifts > 0 ? 'text-amber-700 dark:text-amber-400 font-medium' : 'text-slate-500 dark:text-muted-foreground'
                )}
                title={uncostedShifts > 0 ? 'Some shifts have no resolvable pay rate' : undefined}
              >
                {uncostedShifts > 0 ? `${costedShifts}/${totalShifts} priced` : `${totalShifts} shift${totalShifts === 1 ? '' : 's'}`}
              </span>
            </div>
          </div>

          {/* Actual Panel */}
          <div className="h-10 sm:h-10.5 rounded-xl border border-emerald-400/35 bg-emerald-500/10 px-3 py-1 min-w-[130px] sm:min-w-[155px] flex flex-col justify-between transition-all duration-300 hover:scale-[1.02]">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400 leading-none">
                Actual
              </span>
              <span className="text-[11px] font-mono text-slate-600 dark:text-muted-foreground tabular-nums leading-none">
                {formatNetMinutes(actualNetMinutes)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span
                className={cn(
                  'text-[11px] font-semibold tabular-nums leading-none',
                  actualShifts === 0 ? 'text-slate-500 dark:text-muted-foreground' : 'text-slate-900 dark:text-foreground'
                )}
              >
                ${actualCost.toFixed(2)}
              </span>
              <span className="text-[11px] font-mono text-slate-500 dark:text-muted-foreground leading-none">
                {actualShifts === 0 ? 'none worked' : `${actualShifts}/${totalShifts} worked`}
              </span>
            </div>
          </div>

          {showBudget && (
            <div className="h-10 sm:h-10.5 rounded-xl bg-white dark:bg-[#1c2333] px-3 py-1 min-w-[110px] flex flex-col justify-between transition-all duration-300 hover:scale-[1.02] shadow-none">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300 leading-none">
                  Budget
                </span>
                <span className="text-[11px] font-mono text-slate-600 dark:text-muted-foreground tabular-nums leading-none">
                  ${budget.toFixed(2)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-muted-foreground leading-none">
                  Remaining
                </span>
                <span
                  className={cn(
                    'text-[11px] font-semibold tabular-nums leading-none',
                    remainingBudget >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-red-400'
                  )}
                >
                  ${remainingBudget.toFixed(2)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </footer>
  );
};


