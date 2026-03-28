import { Shift } from '../domain/shift.entity';

export interface ShiftLayout {
  top: number;
  height: number;
}

/**
 * Calculates the visual position (top) and height of a shift card in a time grid.
 * Handles overnight shifts by splitting the visualization across days.
 */
export function calculateShiftLayout(
  shift: Shift,
  currentDateStr: string,
  hourHeight: number,
  minHeight: number = 32
): ShiftLayout {
  const timeToPixels = (time: string): number => {
    if (!time) return 0;
    const [h, m] = time.split(':').map(Number);
    return (h + m / 60) * hourHeight;
  };

  const isStartDay = shift.shift_date === currentDateStr;
  
  // A shift is considered overnight if explicitly marked, 
  // or if end_time is numerically less than start_time (on a 24h clock).
  // We use string comparison for HH:mm format if numeric parse is not needed.
  const crossesMidnight = shift.is_overnight || shift.end_time < shift.start_time;

  let top = 0;
  let height = 0;

  if (isStartDay) {
    top = timeToPixels(shift.start_time);
    if (crossesMidnight) {
      // Span until the end of the current day (24:00)
      height = (24 * hourHeight) - top;
    } else {
      // Normal same-day shift
      height = timeToPixels(shift.end_time) - top;
    }
  } else {
    // This is the second day of an overnight shift
    top = 0;
    height = timeToPixels(shift.end_time);
  }

  return {
    top,
    height: Math.max(height, minHeight),
  };
}
