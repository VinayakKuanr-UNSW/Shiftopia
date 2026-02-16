/**
 * Availability Validation Utilities
 *
 * RESPONSIBILITIES:
 * - All validation logic (time order, repeat rules, end date bounds, weekly day selection)
 * - Error message translation
 * - Business rule validation
 *
 * MUST NOT:
 * - UI messaging (returns validation results, doesn't show toasts)
 * - API calls
 * - State management
 */

import { RepeatType, AvailabilityFormPayload } from '../model/availability.types';

// ============================================================================
// ERROR MESSAGES
// ============================================================================

export const AVAILABILITY_ERRORS = {
  DATE_RANGE_INVALID: 'End date must be after or equal to start date',
  TIME_PAIR_MISSING: 'Start and end time must both be set',
  TIME_ZERO_LENGTH: 'Time window cannot be zero length',
  TIME_ORDER_INVALID: 'Start time must be before end time',
  RECURRENCE_RULE_MISSING: 'Recurring availability needs a recurrence rule',
  APPROVAL_INCOMPLETE: 'Approval information is incomplete',
  TIME_SPAN_INVALID: 'Time window must fit within a single day',
  DUPLICATE_RULE: 'This availability already exists for this period',
  REASON_REQUIRED: 'Please provide a reason for multi-day unavailability',
  PUBLISHED_ROSTERS_AFFECTED: 'Warning: This change may affect published rosters',
  OVERLAPPING_SLOTS: 'Time slots overlap! Please adjust the times.',
  WEEKLY_REPEAT_NO_DAYS: 'Weekly repeat requires at least one day to be selected',
  INVALID_TIME_FORMAT: 'Invalid time format. Use HH:MM',
  GENERIC_ERROR: 'Failed to save availability. Please try again.',
  START_DATE_PAST: 'Start date cannot be in the past',
  END_DATE_TOO_FAR: 'End date cannot be more than 180 days in the future',
} as const;

// ============================================================================
// DATABASE ERROR TRANSLATION
// ============================================================================

/**
 * Map database constraint errors to user-friendly messages
 */
export function translateDatabaseError(error: string | Error | unknown): string {
  const errorMsg = error instanceof Error ? error.message : String(error);

  // Constraint violations
  if (errorMsg.includes('chk_date_range_valid')) {
    return AVAILABILITY_ERRORS.DATE_RANGE_INVALID;
  }
  if (errorMsg.includes('chk_time_pair_consistency')) {
    return AVAILABILITY_ERRORS.TIME_PAIR_MISSING;
  }
  if (errorMsg.includes('chk_time_not_equal')) {
    return AVAILABILITY_ERRORS.TIME_ZERO_LENGTH;
  }
  if (errorMsg.includes('chk_recurrence_requires_rule')) {
    return AVAILABILITY_ERRORS.RECURRENCE_RULE_MISSING;
  }
  if (errorMsg.includes('chk_approval_fields')) {
    return AVAILABILITY_ERRORS.APPROVAL_INCOMPLETE;
  }

  // Trigger violations
  if (errorMsg.includes('time window must fit within a single day')) {
    return AVAILABILITY_ERRORS.TIME_SPAN_INVALID;
  }
  if (errorMsg.includes('Duplicate availability rule')) {
    return AVAILABILITY_ERRORS.DUPLICATE_RULE;
  }
  if (errorMsg.includes('Reason required for extended unavailability')) {
    return AVAILABILITY_ERRORS.REASON_REQUIRED;
  }
  if (errorMsg.includes('published rosters')) {
    return AVAILABILITY_ERRORS.PUBLISHED_ROSTERS_AFFECTED;
  }

  // Generic fallback
  return AVAILABILITY_ERRORS.GENERIC_ERROR;
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate date range
 */
export function validateDateRange(startDate: Date, endDate: Date): ValidationResult {
  const errors: string[] = [];

  if (startDate > endDate) {
    errors.push(AVAILABILITY_ERRORS.DATE_RANGE_INVALID);
  }

  // Prevent past dates (allow today)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startCheck = new Date(startDate);
  startCheck.setHours(0, 0, 0, 0);

  if (startCheck < today) {
    errors.push(AVAILABILITY_ERRORS.START_DATE_PAST);
  }

  // Cap end date at 180 days from start (or today)
  // Logic: The backend only generates slots for 180 days.
  // We should enforce this in UI to avoid confusion "Why are my slots missing in 2026?"
  const maxDate = new Date(startCheck);
  maxDate.setDate(maxDate.getDate() + 180);

  const endCheck = new Date(endDate);
  endCheck.setHours(0, 0, 0, 0);

  console.log('[Validation Debug]', {
    start: startCheck.toISOString(),
    end: endCheck.toISOString(),
    max: maxDate.toISOString(),
    isTooFar: endCheck > maxDate
  });

  if (endCheck > maxDate) {
    errors.push(AVAILABILITY_ERRORS.END_DATE_TOO_FAR);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate time range
 */
export function validateTimeRange(
  startTime: string | null,
  endTime: string | null
): ValidationResult {
  const errors: string[] = [];

  // Both must be set or both must be null
  if ((startTime === null) !== (endTime === null)) {
    errors.push(AVAILABILITY_ERRORS.TIME_PAIR_MISSING);
    return { valid: false, errors };
  }

  // If both are set, validate them
  if (startTime && endTime) {
    // Check format (HH:MM)
    const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
      errors.push(AVAILABILITY_ERRORS.INVALID_TIME_FORMAT);
      return { valid: false, errors };
    }

    // Check that they're not equal
    if (startTime === endTime) {
      errors.push(AVAILABILITY_ERRORS.TIME_ZERO_LENGTH);
    }

    // Check that start < end (same day constraint)
    if (startTime >= endTime) {
      errors.push(AVAILABILITY_ERRORS.TIME_ORDER_INVALID);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate repeat configuration
 */
export function validateRepeatConfiguration(
  repeatType: RepeatType,
  repeatDays?: number[]
): ValidationResult {
  const errors: string[] = [];

  if (repeatType === 'weekly') {
    if (!repeatDays || repeatDays.length === 0) {
      errors.push(AVAILABILITY_ERRORS.WEEKLY_REPEAT_NO_DAYS);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate complete form payload
 */
export function validateAvailabilityForm(
  payload: AvailabilityFormPayload
): ValidationResult {
  const allErrors: string[] = [];

  // Validate date range
  const dateValidation = validateDateRange(payload.start_date, payload.end_date);
  allErrors.push(...dateValidation.errors);

  // Validate time range
  const timeValidation = validateTimeRange(payload.start_time, payload.end_time);
  allErrors.push(...timeValidation.errors);

  // Validate repeat configuration
  const repeatValidation = validateRepeatConfiguration(
    payload.repeat_type,
    payload.repeat_days
  );
  allErrors.push(...repeatValidation.errors);

  // Unavailability reason validation removed as availability_type is deprecated
  // and system uses positive availability (whitelist).

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
  };
}

// ============================================================================
// RECURRENCE RULE GENERATION
// ============================================================================

/**
 * Generate RRULE string from repeat configuration
 * Used by service layer when creating recurring rules
 */
export function generateRecurrenceRule(
  repeatType: RepeatType,
  repeatDays?: number[]
): string | null {
  switch (repeatType) {
    case 'none':
      return null;

    case 'daily':
      return 'FREQ=DAILY';

    case 'weekly':
      if (!repeatDays || repeatDays.length === 0) {
        throw new Error(AVAILABILITY_ERRORS.WEEKLY_REPEAT_NO_DAYS);
      }
      // Convert 0=Sunday to RRULE format (SU,MO,TU,WE,TH,FR,SA)
      const dayMap = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
      const days = repeatDays.map((d) => dayMap[d]).join(',');
      return `FREQ=WEEKLY;BYDAY=${days}`;

    case 'fortnightly':
      return 'FREQ=WEEKLY;INTERVAL=2';

    default:
      return null;
  }
}

/**
 * Parse RRULE string to extract repeat configuration
 * Used when editing existing rules to pre-fill form
 */
export function parseRecurrenceRule(rrule: string | null): {
  repeatType: RepeatType;
  repeatDays?: number[];
} {
  if (!rrule) {
    return { repeatType: 'none' };
  }

  if (rrule.includes('FREQ=DAILY')) {
    return { repeatType: 'daily' };
  }

  if (rrule.includes('FREQ=WEEKLY')) {
    if (rrule.includes('INTERVAL=2')) {
      return { repeatType: 'fortnightly' };
    }

    const dayMatch = rrule.match(/BYDAY=([A-Z,]+)/);
    if (dayMatch) {
      const dayMap: Record<string, number> = {
        SU: 0,
        MO: 1,
        TU: 2,
        WE: 3,
        TH: 4,
        FR: 5,
        SA: 6,
      };
      const days = dayMatch[1].split(',').map((d) => dayMap[d]).filter((d) => d !== undefined);
      return { repeatType: 'weekly', repeatDays: days };
    }
    return { repeatType: 'weekly', repeatDays: [] };
  }

  return { repeatType: 'none' };
}

// ============================================================================
// TIME SLOT OVERLAP DETECTION
// ============================================================================

/**
 * Check if two time ranges overlap
 */
export function doTimeSlotsOverlap(
  slot1Start: string,
  slot1End: string,
  slot2Start: string,
  slot2End: string
): boolean {
  // Convert HH:MM to minutes for easier comparison
  const toMinutes = (time: string): number => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  };

  const start1 = toMinutes(slot1Start);
  const end1 = toMinutes(slot1End);
  const start2 = toMinutes(slot2Start);
  const end2 = toMinutes(slot2End);

  // Check overlap: slot1 starts before slot2 ends AND slot1 ends after slot2 starts
  return start1 < end2 && end1 > start2;
}

/**
 * Validate that multiple time slots don't overlap
 */
export function validateNoOverlappingSlots(
  slots: Array<{ startTime: string; endTime: string }>
): ValidationResult {
  const errors: string[] = [];

  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      if (
        doTimeSlotsOverlap(
          slots[i].startTime,
          slots[i].endTime,
          slots[j].startTime,
          slots[j].endTime
        )
      ) {
        errors.push(
          `${AVAILABILITY_ERRORS.OVERLAPPING_SLOTS} (${slots[i].startTime}-${slots[i].endTime} overlaps with ${slots[j].startTime}-${slots[j].endTime})`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
