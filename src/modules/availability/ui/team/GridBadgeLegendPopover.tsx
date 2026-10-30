import React from 'react';
import { Info, HelpCircle } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';
import { ToolbarIconButton } from '@/modules/core/ui/components/Toolbar';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import {
  TEAM_DAY_STATE_ORDER,
  TEAM_DAY_STATE_LABELS,
  type TeamDayState,
} from '../../model/team-availability.types';
import { stateSoft } from './coverage-palette';

const TEAM_DAY_STATE_DESCRIPTIONS: Record<TeamDayState, string> = {
  assigned: 'Rostered onto at least one shift that day',
  leave: 'Approved leave covers the day',
  available: 'Declared one or more available working windows',
  contract: 'Available by employment contract (Full-Time)',
  unavailable: 'Declared rules, but no working window this day',
  unset: 'No availability rules on file (actionable chase-list)',
};

function useSafeIsDark(): boolean {
  try {
    return useTheme().isDark;
  } catch {
    return false;
  }
}

interface GridBadgeLegendPopoverProps {
  className?: string;
}

export const GridBadgeLegendPopover: React.FC<GridBadgeLegendPopoverProps> = ({ className }) => {
  const isDark = useSafeIsDark();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <ToolbarIconButton
          icon={<Info />}
          tooltip="Badge legend & status reference"
          aria-pressed={undefined}
          variant="sky"
          className={className}
        />
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={10}
        className="w-[440px] max-w-[95vw] p-4 bg-white/95 dark:bg-[#1a2333]/95 backdrop-blur-xl border border-slate-200 dark:border-white/10 shadow-2xl rounded-2xl z-50 animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="flex items-center gap-2.5 pb-3 mb-3 border-b border-border/30">
          <div className="p-1.5 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
            <HelpCircle className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-[11px] font-black uppercase tracking-wider text-foreground">
              Badge Legend
            </h4>
            <p className="text-[11px] text-muted-foreground font-medium">
              Indicator & Status Reference
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground/70">
            Daily Availability States
          </p>

          <div className="divide-y divide-border/20 rounded-xl border border-border/30 bg-muted/20 overflow-hidden">
            {TEAM_DAY_STATE_ORDER.map((state) => {
              const soft = stateSoft(state, isDark);
              return (
                <div
                  key={state}
                  className="flex items-center justify-between px-3 py-2 hover:bg-muted/30 transition-colors"
                >
                  <span
                    className={cn(
                      'inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider border shadow-2xs text-foreground shrink-0',
                      soft.dashed && 'border-dashed',
                    )}
                    style={{
                      backgroundColor: soft.bg,
                      borderColor: soft.border ?? '#89878152',
                    }}
                  >
                    {TEAM_DAY_STATE_LABELS[state]}
                  </span>
                  <span className="text-[11px] font-medium text-muted-foreground text-right ml-3">
                    {TEAM_DAY_STATE_DESCRIPTIONS[state]}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="pt-2 flex items-center justify-between text-[11px] font-mono text-muted-foreground/60 border-t border-border/20">
            <span>UNSET = Absence of declaration</span>
            <span>CONTRACT = Permanent roster basis</span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default GridBadgeLegendPopover;
