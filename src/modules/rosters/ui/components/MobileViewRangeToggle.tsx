import React from 'react';
import { cn } from '@/modules/core/lib/utils';

/**
 * Day / 3-Day / Week / Month, for the mobile function bar.
 *
 * This lived inside the filter drawer, two taps behind a funnel icon, on the
 * theory that a phone had no room for it beside the date navigator. But the
 * view range is not a filter — it is what the page is showing, and it changes
 * far more often than any filter does. Burying it also meant the drawer had to
 * be opened, changed and applied to do the single most common thing on the
 * screen. Short labels (D / 3D / W / M) buy back the width the long ones cost.
 *
 * Desktop keeps `UnifiedRosterNavigator`, which has room for the full words.
 */

export interface MobileViewRangeToggleProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

const OPTIONS: { id: string; short: string; label: string }[] = [
  { id: 'day', short: 'D', label: 'Day' },
  { id: '3day', short: '3D', label: '3-Day' },
  { id: 'week', short: 'W', label: 'Week' },
  { id: 'month', short: 'M', label: 'Month' },
];

export const MobileViewRangeToggle: React.FC<MobileViewRangeToggleProps> = ({
  value,
  onChange,
  className,
}) => (
  <div
    role="radiogroup"
    aria-label="View range"
    className={cn('flex items-center gap-0.5 rounded-xl bg-muted/40 p-1', className)}
  >
    {OPTIONS.map((opt) => {
      const isActive = value === opt.id;
      return (
        <button
          key={opt.id}
          type="button"
          role="radio"
          aria-checked={isActive}
          // The visible text is an abbreviation, so the accessible name spells
          // it out — "D" tells a screen-reader user nothing.
          aria-label={`${opt.label} view`}
          onClick={() => onChange(opt.id)}
          className={cn(
            'min-h-10 min-w-10 px-2 rounded-lg text-xs font-bold uppercase tracking-wide transition-colors active:scale-95 touch-manipulation',
            isActive
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
          )}
        >
          <span aria-hidden="true">{opt.short}</span>
        </button>
      );
    })}
  </div>
);

export default MobileViewRangeToggle;
