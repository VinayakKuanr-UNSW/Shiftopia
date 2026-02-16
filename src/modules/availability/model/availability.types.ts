/**
 * Availability Types
 *
 * Mirrors the database schema for availability_rules table (called 'availabilities' in DB)
 *
 * Key Invariants:
 * 1. Slots are derived from rules, never edited directly
 * 2. Edit = delete + recreate (never partial updates)
 * 3. Calendar reads only slots
 * 4. Validation lives in utils
 */

// ============================================================================
// AVAILABILITY RULES (DB: availability_rules table)
// ============================================================================

export type RepeatType = 'none' | 'daily' | 'weekly' | 'fortnightly';

/**
 * AvailabilityRule represents a row in the 'availability_rules' table
 * This is the SOURCE OF TRUTH that defines when someone is available
 * Rules are created/deleted but never partially updated (edit = delete + create)
 */
export interface AvailabilityRule {
  id: string;
  profile_id: string;

  // Date/Time Constraints
  start_date: string;       // yyyy-MM-dd
  start_time: string;       // HH:mm:ss
  end_time: string;         // HH:mm:ss

  // Recurrence
  repeat_type: RepeatType;  // 'none' | 'daily' | 'weekly' | 'fortnightly'
  repeat_days?: number[] | null; // e.g. [1, 2] (1=Mon)
  repeat_end_date?: string | null; // yyyy-MM-dd

  // Metadata
  created_at: string;
  updated_at: string;
}

// ============================================================================
// AVAILABILITY SLOTS (DB: availability_slots table)
// ============================================================================

/**
 * AvailabilitySlot represents a MATERIALIZED slot in 'availability_slots' table
 * Calendar components should ONLY read slots, never rules
 */
export interface AvailabilitySlot {
  id: string;
  rule_id: string;      // Reference to source rule
  profile_id: string;

  slot_date: string;    // yyyy-MM-dd
  start_time: string;   // HH:mm:ss
  end_time: string;     // HH:mm:ss

  created_at: string;
}

// ============================================================================
// FORM PAYLOADS
// ============================================================================

/**
 * Payload for creating a new availability rule
 * Used by forms to submit data to the service layer
 */
export interface AvailabilityFormPayload {
  start_date: Date;
  end_date: Date;
  start_time: string | null; // HH:mm format, null = full day
  end_time: string | null; // HH:mm format, null = full day
  // availability_type removed as it is not in DB
  repeat_type: RepeatType;
  repeat_days?: number[]; // Days of week for weekly repeat (0=Sun, 6=Sat)
  repeat_end_date?: Date; // yyyy-MM-dd
  reason?: string;
}

// ============================================================================
// LEGACY COMPATIBILITY TYPES (to be phased out)
// ============================================================================

/**
 * @deprecated Use AvailabilityType instead
 * Keeping for backwards compatibility during migration
 */
export type AvailabilityStatus =
  | 'Available'
  | 'Unavailable'
  | 'Partial'
  | 'Limited'
  | 'Tentative'
  | 'On Leave'
  | 'Not Specified';

/**
 * @deprecated Legacy time slot type, use AvailabilitySlot instead
 */
export interface TimeSlot {
  id?: string;
  startTime: string;
  endTime: string;
  status?: AvailabilityStatus;
  daysOfWeek?: number[];
}

/**
 * @deprecated Legacy day availability type
 * Being phased out in favor of AvailabilitySlot
 */
export interface DayAvailability {
  id: string;
  employeeId: string;
  date: string;
  status: AvailabilityStatus;
  notes?: string;
  timeSlots: TimeSlot[];
}

/**
 * @deprecated Presets should be handled differently
 * Consider moving to a separate presets module
 */
export interface AvailabilityPreset {
  id: string;
  name: string;
  type: string;
  pattern?: any;
  timeSlots: Array<{
    id?: string;
    startTime: string;
    endTime: string;
    status: string;
    daysOfWeek?: number[];
  }>;
}

// ============================================================================
// UTILITY TYPE GUARDS
// ============================================================================

// ============================================================================
// UTILITY TYPE GUARDS
// ============================================================================

export function isFullDayRule(rule: AvailabilityRule): boolean {
  // Can consider full day if times are 00:00:00 and 23:59:59 or similar convention, 
  // but DB schema requires times. For now, we check the strings.
  // Assuming '00:00:00' and '23:59:59' or similar. 
  // Actually, UI often sets null for full day, but DB requires NOT NULL time.
  // We will assume the SERVICE layer handles the conversion, but the MODEL layer 
  // now enforces string.
  return rule.start_time === '00:00:00' && rule.end_time === '23:59:59';
}

export function isRecurringRule(rule: AvailabilityRule): boolean {
  return rule.repeat_type !== 'none';
}
