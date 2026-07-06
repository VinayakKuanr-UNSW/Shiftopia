/**
 * EditingPresenceBadge — ADVISORY "another manager is editing this shift" pill.
 *
 * Renders a small amber pill (the_cutaway amber language) when OTHER managers
 * are present on a shift. Purely advisory — it surfaces who is poking at the
 * card so two managers don't silently clobber each other. The server-side
 * version CAS remains the real write guarantee; this badge gates nothing.
 *
 * Empty → renders nothing.
 *   1 editor   → "Sarah editing"
 *   2+ editors → "Sarah +N editing"
 */

import React from 'react';
import { Pencil } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import type { ShiftEditor } from '../hooks/useShiftEditingPresence';

export interface EditingPresenceBadgeProps {
  editors: ShiftEditor[];
  className?: string;
}

const firstName = (name: string): string => (name || '').trim().split(/\s+/)[0] || 'Someone';

export function EditingPresenceBadge({
  editors,
  className,
}: EditingPresenceBadgeProps): JSX.Element | null {
  if (!editors || editors.length === 0) return null;

  const lead = firstName(editors[0].name);
  const extra = editors.length - 1;
  const label = extra > 0 ? `${lead} +${extra} editing` : `${lead} editing`;

  // Full roster of who is editing + their intent, for the tooltip.
  const tooltipLines = editors.map((e) => {
    const intent = e.opIntent ? ` · ${e.opIntent}` : '';
    return `${e.name || 'Someone'}${intent}`;
  });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5',
            'text-[9px] font-bold uppercase tracking-wide leading-none',
            // the_cutaway amber language — light + dark pairing.
            'bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300',
            className,
          )}
        >
          <Pencil className="h-2.5 w-2.5 shrink-0 animate-pulse" />
          <span className="truncate max-w-[120px]">{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="text-[10px] py-1 px-2">
        <div className="font-semibold mb-0.5">Editing now</div>
        {tooltipLines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}
