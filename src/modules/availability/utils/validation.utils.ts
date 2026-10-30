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
import { SYDNEY_TZ, isPastInTimezone } from '@/modules/core/lib/date.utils';

// ============================================================================
// ERROR MESSAGES
// ============================================================================

const AVAILABILITY_ERRORS = {
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

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate date range
 */
function validateDateRange(startDate: Date, endDate: Date, timezone: string = SYDNEY_TZ): ValidationResult {
  const errors: string[] = [];

  if (startDate > endDate) {
    errors.push(AVAILABILITY_ERRORS.DATE_RANGE_INVALID);
  }

  // Prevent past dates (allow today) using timezone-aware check
  const startCheck = new Date(startDate);
  startCheck.setHours(0, 0, 0, 0);

  if (isPastInTimezone(startCheck, timezone)) {
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
function validateTimeRange(
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
function validateRepeatConfiguration(
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
  const dateValidation = validateDateRange(payload.start_date, payload.end_date, SYDNEY_TZ);
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



// ============================================================================
// TIME SLOT OVERLAP DETECTION
// ============================================================================


