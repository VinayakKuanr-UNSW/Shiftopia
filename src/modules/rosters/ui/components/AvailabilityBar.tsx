import React, { useMemo } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import { cn } from '@/modules/core/lib/utils';
import {
  AvailabilityWindow,
  EmployeeAvailability,
} from '@/modules/rosters/domain/availabilityResolution.types';

/* ============================================================
   INTERFACES
   ============================================================ */
interface AvailabilityBarProps {
  availability: EmployeeAvailability | null;
  className?: string;
}

interface TimeBarSegmentProps {
  windows: AvailabilityWindow[];
  color: 'green' | 'red' | 'gray';
  tooltipText: string;
}

/* ============================================================
   CONSTANTS
   ============================================================ */
const TOTAL_MINUTES = 24 * 60; // 1440 minutes in a day
const BAR_HEIGHT = 6; // Height in pixels

/* ============================================================
   HELPER FUNCTIONS
   ============================================================ */

/**
 * Convert time string to minutes since midnight
 */
function timeToMinutes(time: string): number {
  const parts = time.split(':');
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1] || '0', 10);
  return hours * 60 + minutes;
}

/**
 * Convert minutes to time string
 */
function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/**
 * Calculate unavailable windows from available windows
 */
function calculateUnavailableWindows(
  availableWindows: AvailabilityWindow[]
): AvailabilityWindow[] {
  if (availableWindows.length === 0) {
    return [{ start: '00:00', end: '24:00' }];
  }

  const sorted = [...availableWindows].sort(
    (a, b) => timeToMinutes(a.start) - timeToMinutes(b.start)
  );

  const unavailable: AvailabilityWindow[] = [];
  let currentEnd = 0;

  for (const window of sorted) {
    const windowStart = timeToMinutes(window.start);
    const windowEnd = window.end === '24:00' ? TOTAL_MINUTES : timeToMinutes(window.end);

    if (windowStart > currentEnd) {
      unavailable.push({
        start: minutesToTime(currentEnd),
        end: minutesToTime(windowStart),
      });
    }

    currentEnd = Math.max(currentEnd, windowEnd);
  }

  if (currentEnd < TOTAL_MINUTES) {
    unavailable.push({
      start: minutesToTime(currentEnd),
      end: '24:00',
    });
  }

  return unavailable;
}

/**
 * Format availability windows for tooltip display
 */
function formatAvailabilityTooltip(
  windows: AvailabilityWindow[],
  type: 'available' | 'unavailable'
): string {
  if (windows.length === 0) {
    return type === 'available' ? 'Not available' : 'Fully available';
  }

  const label = type === 'available' ? 'Available' : 'Unavailable';
  const times = windows
    .map((w) => `${w.start}–${w.end === '24:00' ? '00:00' : w.end}`)
    .join(', ');

  return `${label}: ${times}`;
}

/* ============================================================
   TIME BAR SEGMENT COMPONENT
   ============================================================ */
const TimeBarSegment: React.FC<TimeBarSegmentProps> = ({
  windows,
  color,
  tooltipText,
}) => {
  const colorClasses = {
    green: 'bg-green-500',
    red: 'bg-red-500',
    gray: 'bg-gray-500/50',
  };

  const segments = useMemo(() => {
    return windows.map((window, idx) => {
      const startMinutes = timeToMinutes(window.start);
      const endMinutes =
        window.end === '24:00' ? TOTAL_MINUTES : timeToMinutes(window.end);

      const leftPercent = (startMinutes / TOTAL_MINUTES) * 100;
      const widthPercent = ((endMinutes - startMinutes) / TOTAL_MINUTES) * 100;

      return {
        id: `${window.start}-${window.end}-${idx}`,
        left: `${leftPercent}%`,
        width: `${widthPercent}%`,
      };
    });
  }, [windows]);

  if (segments.length === 0) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className="relative w-full rounded-sm overflow-hidden cursor-default"
            style={{ height: `${BAR_HEIGHT}px` }}
          >
            {/* Background (empty/transparent) */}
            <div className="absolute inset-0 bg-white/5 rounded-sm" />

            {/* Colored segments */}
            {segments.map((segment) => (
              <div
                key={segment.id}
                className={cn(
                  'absolute top-0 bottom-0 rounded-sm',
                  colorClasses[color]
                )}
                style={{
                  left: segment.left,
                  width: segment.width,
                }}
              />
            ))}
          </div>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          className="bg-gray-900 border-gray-700 text-white text-xs"
        >
          {tooltipText}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

/* ============================================================
   MAIN AVAILABILITY BAR COMPONENT
   ============================================================ */
export const AvailabilityBar: React.FC<AvailabilityBarProps> = ({
  availability,
  className,
}) => {
  // No availability data or no data set
  if (!availability || !availability.hasData) {
    return (
      <div className={cn('space-y-1 mt-2', className)}>
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className="w-full bg-gray-500/30 rounded-sm cursor-default"
                style={{ height: `${BAR_HEIGHT}px` }}
              >
                <div className="w-full h-full bg-gradient-to-r from-gray-500/20 via-gray-500/40 to-gray-500/20" />
              </div>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="bg-gray-900 border-gray-700 text-white text-xs"
            >
              No availability set
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    );
  }

  // Fully unavailable
  if (availability.isFullyUnavailable) {
    return (
      <div className={cn('space-y-1 mt-2', className)}>
        <TimeBarSegment
          windows={[]}
          color="green"
          tooltipText="Not available"
        />
        <TimeBarSegment
          windows={[{ start: '00:00', end: '24:00' }]}
          color="red"
          tooltipText="Unavailable: 00:00–00:00 (all day)"
        />
      </div>
    );
  }

  // Fully available
  if (availability.isFullyAvailable) {
    return (
      <div className={cn('space-y-1 mt-2', className)}>
        <TimeBarSegment
          windows={[{ start: '00:00', end: '24:00' }]}
          color="green"
          tooltipText="Available: 00:00–00:00 (all day)"
        />
        <TimeBarSegment
          windows={[]}
          color="red"
          tooltipText="Fully available"
        />
      </div>
    );
  }

  // Calculate unavailable windows from available windows
  const unavailableWindows = calculateUnavailableWindows(
    availability.availableWindows
  );

  // Format tooltips
  const availableTooltip = formatAvailabilityTooltip(
    availability.availableWindows,
    'available'
  );
  const unavailableTooltip = formatAvailabilityTooltip(
    unavailableWindows,
    'unavailable'
  );

  return (
    <div className={cn('space-y-1 mt-2', className)}>
      {/* Available bar (green) - on top */}
      <TimeBarSegment
        windows={availability.availableWindows}
        color="green"
        tooltipText={availableTooltip}
      />

      {/* Unavailable bar (red) - on bottom */}
      <TimeBarSegment
        windows={unavailableWindows}
        color="red"
        tooltipText={unavailableTooltip}
      />
    </div>
  );
};

export default AvailabilityBar;
