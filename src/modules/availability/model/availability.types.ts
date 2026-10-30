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
  reason?: string | null;

  /**
   * WHICH JOB this declaration is for (migration 20260821090000).
   *
   * NULL means UNSCOPED — it covers every sub-department the profile holds an
   * Active contract in. That is what the 5 un-backfilled production rules carry
   * and what any writer that has not resolved a scope produces, so readers must
   * always admit NULL alongside the scope they asked for.
   */
  sub_department_id?: string | null;

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

  /** Copied from the source rule by the DB trigger. NULL = unscoped. */
  sub_department_id?: string | null;

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
  /** The job this declaration is for. Undefined/null writes an unscoped rule. */
  sub_department_id?: string | null;
}





// ============================================================================
// UTILITY TYPE GUARDS
// ============================================================================

// ============================================================================
// UTILITY TYPE GUARDS
// ============================================================================


