/**
 * Availability View API
 *
 * Provides the combined view endpoint described in the spec:
 *   GET /user/{id}/availability-view
 *
 * Returns:
 *   - declaredSlots  (AvailabilitySlot[]) — from availability_slots table
 *   - assignedShifts (AssignedShiftInterval[]) — from shifts table (locked intervals)
 *
 * The FRONTEND computes the final cell state:
 *   LOCKED   → overlaps an assigned shift
 *   AVAILABLE → covered by declared availability slot
 *   UNSET    → neither
 *
 * Source of truth for locks is ALWAYS the shifts table.
 * No separate lock table exists or should be created.
 */

import { supabase } from '@/platform/supabase/client';
import { getAvailabilitySlots } from './availability.api';
import { AvailabilitySlot } from '../model/availability.types';

// ============================================================================
// TYPES
// ============================================================================

/**
 * A shift interval derived from the shifts table that represents a LOCKED slot.
 * Locked = the employee is already assigned to a shift during this time.
 */
export interface AssignedShiftInterval {
  id: string;
  shift_date: string;          // yyyy-MM-dd
  start_time: string;          // HH:mm:ss
  end_time: string;            // HH:mm:ss
  role_name: string | null;
  department_name: string | null;
  lifecycle_status: string;
}

interface AvailabilityViewResult {
  declaredSlots: AvailabilitySlot[];
  assignedShifts: AssignedShiftInterval[];
}

// ============================================================================
// FETCH ASSIGNED SHIFTS (LOCKED INTERVALS)
// ============================================================================

/**
 * Fetch all assigned shifts for a user in a date range.
 * These represent locked intervals that block future assignments.
 *
 * Excludes Cancelled and deleted shifts.
 * Ordered by date + start_time for efficient interval merging on the frontend.
 */
export async function getAssignedShiftsForAvailability(
  profileId: string,
  startDate: string, // yyyy-MM-dd
  endDate: string    // yyyy-MM-dd
): Promise<AssignedShiftInterval[]> {
  const { data, error } = await supabase
    .from('shifts')
    .select(`
      id,
      shift_date,
      start_time,
      end_time,
      lifecycle_status,
      roles(name),
      departments(name)
    `)
    .eq('assigned_employee_id', profileId)
    .gte('shift_date', startDate)
    .lte('shift_date', endDate)
    .neq('lifecycle_status', 'Cancelled')
    .or('is_cancelled.is.null,is_cancelled.eq.false')
    .is('deleted_at', null)
    .order('shift_date')
    .order('start_time');

  if (error) throw error;

  return (data || []).map((row: any) => ({
    id: row.id,
    shift_date: row.shift_date,
    start_time: row.start_time,
    end_time: row.end_time,
    lifecycle_status: row.lifecycle_status,
    role_name: row.roles?.name ?? null,
    department_name: row.departments?.name ?? null,
  }));
}

// ============================================================================
// COMBINED VIEW (declared + locked)
// ============================================================================

/**
 * Fetch the combined availability view for a user.
 * Equivalent to GET /user/{id}/availability-view
 *
 * Frontend computes final state from the two arrays.
 */
export async function getAvailabilityView(
  profileId: string,
  startDate: string,
  endDate: string
): Promise<AvailabilityViewResult> {
  const [declaredSlots, assignedShifts] = await Promise.all([
    getAvailabilitySlots(profileId, startDate, endDate),
    getAssignedShiftsForAvailability(profileId, startDate, endDate),
  ]);

  return { declaredSlots, assignedShifts };
}

// ============================================================================
// INTERVAL OVERLAP UTILITIES (used by assignShift command)
// ============================================================================





