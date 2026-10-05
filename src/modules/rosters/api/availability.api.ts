/**
 * Availability API Service
 *
 * Fetches availability data from Supabase and provides resolved availability
 * for the People Mode grid and the assign-shift availability warnings.
 *
 * SOURCE OF TRUTH: `availability_slots` — the materialized per-day slots that a
 * DB trigger generates from `availability_rules` (what "My Availabilities" and
 * the seed write to). The older `availabilities` table is vestigial/empty; the
 * whole app (scheduler, bidding, swaps) reads slots, so we do too. Reading
 * `availabilities` here was the reason People Mode showed "No availability set"
 * for everyone even after availability was declared.
 */

import { supabase } from '@/platform/supabase/client';
import { format, eachDayOfInterval } from 'date-fns';
import { todayISO } from '@/modules/core/lib/date.utils';
import { isValidUuid } from '@/modules/rosters/domain/shift.entity';
import {
    AvailabilityWindow,
    EmployeeAvailability,
} from '@/modules/rosters/domain/availabilityResolution.types';

/* ============================================================
   TYPES
   ============================================================ */

/** A materialized daily slot row from `availability_slots`. */
interface RawAvailabilitySlot {
    profile_id: string;
    slot_date: string;  // "YYYY-MM-DD"
    start_time: string; // "HH:MM:SS"
    end_time: string;   // "HH:MM:SS"
}

/* ============================================================
   HELPERS
   ============================================================ */

/** "HH:MM:SS" | "HH:MM" -> "HH:MM" (the shape AvailabilityBar expects). */
function toHHMM(time: string): string {
    const [h = '00', m = '00'] = time.split(':');
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

/** Build the UI availability record for one (profile, day) from its slots. */
function toEmployeeAvailability(
    profileId: string,
    date: string,
    windows: AvailabilityWindow[],
): EmployeeAvailability {
    const sorted = [...windows].sort((a, b) => a.start.localeCompare(b.start));
    const isFullyUnavailable = sorted.length === 0;
    const isFullyAvailable =
        sorted.length === 1 &&
        sorted[0].start === '00:00' &&
        (sorted[0].end === '24:00' || sorted[0].end === '00:00');

    return {
        employeeId: profileId,
        date,
        availableWindows: sorted,
        unavailableWindows: [],
        isFullyAvailable,
        isFullyUnavailable,
        // Reached only for profiles that have declared availability, so a day
        // with no slot is a genuine "unavailable that day", not "unknown".
        hasData: true,
    };
}

/* ============================================================
   API FUNCTIONS
   ============================================================ */

/**
 * Get resolved availability for multiple profiles across a date range.
 * Returns a nested Map: profileId -> "YYYY-MM-DD" -> EmployeeAvailability.
 *
 * Profiles with NO declared availability rule are omitted from the map, so the
 * UI's `getAvailability()` returns null for them → "No availability set" (as
 * opposed to a profile who declared rules but happens to be off that day, which
 * renders as fully unavailable).
 */
export async function getResolvedAvailabilities(
    profileIds: string[],
    startDate: Date,
    endDate: Date,
    /**
     * WHICH JOB is being asked about (`availability_slots.sub_department_id`,
     * migration 20260821090000).
     *
     * Omit it and the answer is person-wide — every declaration the profile
     * holds, which is exactly today's behaviour and what every caller that has
     * not yet resolved a scope gets.
     *
     * Pass one and the read narrows to declarations for THAT sub-department
     * plus UNSCOPED ones, which cover every job by definition. That OR-NULL is
     * not optional: 85 of the 90 production rules are scoped but the remaining
     * five are not, and dropping them would silently un-declare those people.
     */
    subDepartmentId?: string | null,
): Promise<Map<string, Map<string, EmployeeAvailability>>> {
    const result = new Map<string, Map<string, EmployeeAvailability>>();

    // The People Mode employee list includes non-UUID pseudo-rows (e.g. the
    // 'unassigned-bucket' Open Shifts row). Passing one of those into
    // `.in('profile_id', …)` makes Postgres reject the WHOLE query with an
    // invalid-uuid cast error, which would blank out availability for everyone.
    const validIds = profileIds.filter(isValidUuid);
    if (validIds.length === 0) return result;

    const startStr = format(startDate, 'yyyy-MM-dd');
    const endStr = format(endDate, 'yyyy-MM-dd');

    // `sub_department_id.eq.X,sub_department_id.is.null` — the scoped
    // declarations for this job PLUS the unscoped ones that cover every job.
    const scopeFilter = subDepartmentId
        ? `sub_department_id.eq.${subDepartmentId},sub_department_id.is.null`
        : null;

    // 1. Materialized slots in the visible window (the available windows).
    let slotQuery = supabase
        .from('availability_slots')
        .select('profile_id,slot_date,start_time,end_time')
        .in('profile_id', validIds)
        .gte('slot_date', startStr)
        .lte('slot_date', endStr);
    if (scopeFilter) slotQuery = slotQuery.or(scopeFilter);
    const { data: slotRows, error: slotErr } = await slotQuery;

    if (slotErr) {
        console.error('Error fetching availability_slots:', slotErr);
        return result;
    }

    // 2. Which profiles have declared ANY availability rule. This distinguishes
    //    "off that day" (has rules, no slot → unavailable) from "never set
    //    availability" (no rules → we show nothing / universally unknown).
    //
    //    THE PROBE IS SCOPED TOO, and getting this wrong is the whole trap.
    //    Someone who declared for Security but not for Set-up would otherwise
    //    read as "has declared" while holding zero Set-up slots — and every day
    //    of their Set-up roster would render as a positive "unavailable" rather
    //    than the honest "never declared for this job".
    let ruleQuery = supabase
        .from('availability_rules')
        .select('profile_id')
        .in('profile_id', validIds);
    if (scopeFilter) ruleQuery = ruleQuery.or(scopeFilter);
    const { data: ruleRows, error: ruleErr } = await ruleQuery;

    if (ruleErr) {
        console.error('Error fetching availability_rules:', ruleErr);
    }

    const declaredSet = new Set<string>(
        (ruleRows ?? []).map((r) => (r as { profile_id: string }).profile_id),
    );

    // Group slots by profile + date.
    const windowsByProfileDate = new Map<string, AvailabilityWindow[]>();
    for (const slot of (slotRows ?? []) as RawAvailabilitySlot[]) {
        const key = `${slot.profile_id}|${slot.slot_date}`;
        const list = windowsByProfileDate.get(key) ?? [];
        list.push({ start: toHHMM(slot.start_time), end: toHHMM(slot.end_time) });
        windowsByProfileDate.set(key, list);
    }

    const days = eachDayOfInterval({ start: startDate, end: endDate }).map((d) =>
        format(d, 'yyyy-MM-dd'),
    );
    // Slots are only materialized forward from today, so a PAST day with no slot
    // means "not generated" (unknown), not "declared unavailable". Skip those so
    // we don't paint the past days of a month view bright red; future days with
    // no slot are genuine unavailable days per the person's weekly pattern.
    const todayStr = todayISO();

    for (const profileId of validIds) {
        if (!declaredSet.has(profileId)) continue; // no rules → leave null

        const dateMap = new Map<string, EmployeeAvailability>();
        for (const day of days) {
            const windows = windowsByProfileDate.get(`${profileId}|${day}`) ?? [];
            if (windows.length === 0 && day < todayStr) continue; // past + no slot → unknown
            dateMap.set(day, toEmployeeAvailability(profileId, day, windows));
        }
        result.set(profileId, dateMap);
    }

    return result;
}

/**
 * Get availability for a single profile on a single date.
 * Convenience wrapper used by the assign-shift availability warnings.
 */
export async function getEmployeeAvailabilityForDate(
    profileId: string,
    date: Date,
    /** See `getResolvedAvailabilities`. Omit for the person-wide answer. */
    subDepartmentId?: string | null,
): Promise<EmployeeAvailability | null> {
    const result = await getResolvedAvailabilities([profileId], date, date, subDepartmentId);
    const profileMap = result.get(profileId);

    if (!profileMap) return null;

    const dateStr = format(date, 'yyyy-MM-dd');
    return profileMap.get(dateStr) || null;
}

export const availabilityApi = {
    getResolvedAvailabilities,
    getEmployeeAvailabilityForDate,
};
