/**
 * AllowancesSection — card-based display for EBA allowances.
 *
 * Replaces the old inline chips with proper cards showing allowance name,
 * EBA clause reference, amount, unit, and effective date.
 */

import React from 'react';
import {
  UtensilsCrossed, ShieldPlus, Biohazard, SplitSquareVertical, HelpCircle,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from '@/modules/core/ui/primitives/tooltip';
import type { EbaAllowanceRow } from '../../../data/ebaRates.read.api';

const money = (n: number) => `$${n.toFixed(2)}`;

interface AllowanceConfig {
  icon: React.ElementType;
  label: string;
  clause: string;
  description: string;
}

const ALLOWANCE_CONFIG: Record<string, AllowanceConfig> = {
  meal: {
    icon: UtensilsCrossed,
    label: 'Meal Allowance',
    clause: 'cl 28.1',
    description: 'Paid when a shift extends beyond the rostered hours requiring an additional meal break.',
  },
  first_aid_per_hour: {
    icon: ShieldPlus,
    label: 'First Aid',
    clause: 'cl 28.2',
    description: 'Per-hour allowance for employees holding a current first aid certificate and designated as first aider.',
  },
  protein_spill: {
    icon: Biohazard,
    label: 'Protein Spill',
    clause: 'cl 28.3',
    description: 'Per-occasion allowance for cleaning up protein spills (bodily fluids).',
  },
  split_shift: {
    icon: SplitSquareVertical,
    label: 'Split Shift',
    clause: 'cl 28.4',
    description: 'Paid when an employee works a split shift with a break of more than one hour.',
  },
};

const UNIT_LABELS: Record<string, string> = {
  per_occasion: '/occasion',
  per_hour: '/hour',
  per_shift: '/shift',
};

interface AllowancesSectionProps {
  allowances: EbaAllowanceRow[];
  effectiveFrom: string;
}

const AllowancesSection: React.FC<AllowancesSectionProps> = ({ allowances, effectiveFrom }) => {
  const sorted = [...allowances].sort((a, b) => a.code.localeCompare(b.code));
  const effectiveLabel = new Date(effectiveFrom + 'T00:00:00').toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div>
          <h3 className="text-xl font-bold text-foreground">Allowances</h3>
          <p className="text-base text-muted-foreground mt-1">
            Per-shift and per-hour allowances under the ICC Sydney EA 2025
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6" role="region" aria-label="Available allowances">
          {sorted.map((a) => {
            const config = ALLOWANCE_CONFIG[a.code];
            const Icon = config?.icon ?? HelpCircle;
            const label = config?.label ?? a.code;
            const clause = config?.clause ?? '';
            const unitLabel = UNIT_LABELS[a.unit] ?? `/${a.unit}`;

            return (
              <div
                key={a.code}
                className={cn(
                  'rounded-xl border border-border/60 bg-card/40 backdrop-blur-sm p-6',
                  'transition-all hover:border-primary/30 hover:bg-card/60 shadow-sm',
                  'flex flex-col gap-4 justify-between',
                )}
                role="article"
                aria-label={`${label}, ${money(a.amount)} ${unitLabel}`}
              >
                <div className="space-y-4">
                  {/* Header row */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-primary/10 p-2">
                        <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
                      </div>
                      <span className="text-base font-bold text-foreground">{label}</span>
                    </div>
                    {config?.description && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button 
                            className="text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-full p-0.5"
                            aria-label={`More information about ${label}`}
                          >
                            <HelpCircle className="h-4 w-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs text-sm p-3">
                          <p className="font-bold mb-1">{label} ({clause})</p>
                          <p className="text-muted-foreground text-xs leading-relaxed">{config.description}</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>

                  {/* Amount */}
                  <div className="pt-2">
                    <span className="text-3xl font-extrabold text-foreground tabular-nums">
                      {money(a.amount)}
                    </span>
                    <span className="text-sm font-semibold text-muted-foreground ml-1.5">{unitLabel}</span>
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground pt-3 border-t border-border/40 mt-2">
                  <span>{clause}</span>
                  <span>Effective {effectiveLabel}</span>
                </div>
              </div>
            );
          })}
        </div>

        {sorted.length === 0 && (
          <p className="text-base text-muted-foreground italic py-8 text-center" role="status">
            No allowances found for the current rate set.
          </p>
        )}
      </div>
    </TooltipProvider>
  );
};

export default AllowancesSection;
