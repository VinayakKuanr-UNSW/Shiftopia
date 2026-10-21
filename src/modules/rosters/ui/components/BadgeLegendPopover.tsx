import React from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';
import { BADGE_CODES } from './ShiftCardLegend';

export interface BadgeLegendPopoverProps {
  className?: string;
}

export const BadgeLegendPopover: React.FC<BadgeLegendPopoverProps> = ({ className }) => {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Badge legend and status reference"
          title="Badge legend & status reference"
          className={cn(
            'p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white',
            'hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer',
            'focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none shrink-0',
            className
          )}
        >
          <Info className="h-4 w-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={8}
        className="w-[500px] max-w-[95vw] p-3 bg-popover/95 backdrop-blur-xl border border-border shadow-2xl rounded-2xl z-50"
      >
        <div className="flex items-center gap-2.5 pb-2.5 mb-2 border-b border-border">
          <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
            <Info className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-foreground font-mono">
              Badge Legend
            </h4>
            <p className="text-[10px] text-muted-foreground font-medium">
              Indicator & Status Reference
            </p>
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto custom-scrollbar rounded-lg border border-border/40 bg-card/40">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-muted/40">
                <th className="px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/40">
                  Status
                </th>
                <th className="px-2 py-2 text-[9px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/40 text-center">
                  Dot
                </th>
                <th className="px-2 py-2 text-[9px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/40 text-center">
                  Code
                </th>
                <th className="px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/40">
                  Trigger / Context
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20 text-xs">
              {BADGE_CODES.map((item, idx) => (
                <tr key={idx} className="hover:bg-primary/5 transition-colors group">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="p-1 rounded bg-black/5 dark:bg-white/5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0">
                        {item.icon}
                      </div>
                      <span className="text-[11px] font-semibold text-foreground/90 whitespace-nowrap">
                        {item.label}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-center">
                    {item.dot ? (
                      <div
                        className="inline-block h-2 w-2 rounded-full shadow-sm ring-1 ring-black/10"
                        style={{ backgroundColor: item.dot }}
                      />
                    ) : (
                      <span className="text-[9px] text-muted-foreground/30">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-center font-mono">
                    <span
                      className={cn(
                        'text-[10px] font-bold px-1 py-0.5 rounded leading-none transition-all',
                        item.code !== '-'
                          ? 'bg-black/10 dark:bg-white/10 text-foreground/70 group-hover:bg-primary/20 group-hover:text-primary'
                          : 'text-muted-foreground/20'
                      )}
                    >
                      {item.code}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <p className="text-[10px] font-medium text-muted-foreground leading-tight">
                      {item.description}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default BadgeLegendPopover;
