/**
 * Availability exceptions — the subtractive counterpart to
 * `availability_rules`.
 *
 * An exception says "do not roster me during this", which is the thing a
 * permanent actually needs to say. Expressing the same intent through
 * availability rules would mean declaring every hour you CAN work in order to
 * carve out the hours you cannot — and under the solver's full-containment
 * rule a too-narrow declaration silently un-rosters you, which is exactly the
 * state five production full-timers are in from a 2-hour seeded window.
 *
 * Severity maps to the solver's tiers. Employees may set SOFT (5000c) and
 * PREFERENCE (1000c); HARD is a pre-filter block at the same tier as approved
 * leave and is manager-only, enforced by RLS rather than here — a client-side
 * check is a courtesy, not a control.
 */

import { supabase } from '@/platform/supabase/client';
import { fetchScopedContractBasis } from './contract-basis.api';
import { scopeFilter } from './availability.api';
import { FT_AVAILABILITY_ERROR, resolveProfileId } from './availability.service';

export type ExceptionSeverity = 'HARD' | 'SOFT' | 'PREFERENCE';

/** Severities an employee may set on themselves. Mirrors the RLS WITH CHECK. */
export const SELF_SERVICE_SEVERITIES: ExceptionSeverity[] = ['SOFT', 'PREFERENCE'];

export interface AvailabilityException {
    id: string;
    profileId: string;
    /** yyyy-MM-dd, or null for "every day". */
    exceptionDate: string | null;
    startTime: string;   // HH:mm
    endTime: string;     // HH:mm
    severity: ExceptionSeverity;
    reason: string | null;
    /** Which job this subtracts from. Null = every one of them. */
    subDepartmentId: string | null;
    createdAt: string;
}

export interface CreateExceptionInput {
    exceptionDate: string | null;
    startTime: string;
    endTime: string;
    severity: ExceptionSeverity;
    reason?: string;
    /** Which job this subtracts from. Null/undefined = every one of them. */
    subDepartmentId?: string | null;
}

const toTime = (t: string): string => (t ? t.split(':').slice(0, 2).join(':') : t);

function mapRow(row: Record<string, unknown>): AvailabilityException {
    return {
        id: row.id as string,
        profileId: row.profile_id as string,
        exceptionDate: row.exception_date ? String(row.exception_date).slice(0, 10) : null,
        startTime: toTime(String(row.start_time ?? '')),
        endTime: toTime(String(row.end_time ?? '')),
        severity: row.severity as ExceptionSeverity,
        reason: (row.reason as string | null) ?? null,
        subDepartmentId: (row.sub_department_id as string | null) ?? null,
        createdAt: row.created_at as string,
    };
}

/**
 * Every exception on file for one profile, soonest first with the recurring
 * ones last — an undated entry applies forever, so it belongs at the bottom of
 * a list ordered by when it next bites.
 */
export async function listAvailabilityExceptions(
    profileId: string,
    /**
     * Which job's exceptions to list. Omit for the person-wide list — that is
     * what every caller got before scoping, and what a caller with no resolved
     * job still gets.
     *
     * A NULL `sub_department_id` on the ROW means "every job", so it is always
     * included. That widening is the same one `scopeFilter` applies to rules,
     * and it is why the filter is an `.or()` rather than an `.eq()`: an
     * unscoped exception is not a Set-up exception, but it does subtract from
     * Set-up. Listing it under the Set-up job is therefore honest, and hiding
     * it would show the employee a calendar that disagrees with the solver.
     */
    subDepartmentId?: string | null,
): Promise<AvailabilityException[]> {
    let query = (supabase as any)
        .from('availability_exceptions')
        .select('id,profile_id,exception_date,start_time,end_time,severity,reason,created_at,sub_department_id')
        .eq('profile_id', profileId);

    const filter = scopeFilter(subDepartmentId);
    if (filter) query = query.or(filter);

    const { data, error } = await query
        .order('exception_date', { ascending: true, nullsFirst: false })
        .order('start_time', { ascending: true });

    if (error) throw error;
    return (data ?? []).map(mapRow);
}

export async function createAvailabilityException(
    profileId: string,
    input: CreateExceptionInput,
): Promise<AvailabilityException> {
    // `resolveProfileId` FIRST: callers pass the 'current-user' sentinel here as
    // well as real uuids, and `fetchContractBasis('current-user')` returns the
    // empty basis (not Full-Time), which would wave an FT straight through.
    // The DB-level guard landed in 20260821090100; this stays as the courtesy
    // that produces a readable message instead of a check_violation.
    const resolvedProfileId = await resolveProfileId(profileId);
    // SCOPED: a Full-Time job still refuses exceptions, but a Casual job held
    // by the same person accepts them. The database agrees — 20260821090100
    // attached `trg_prevent_ft_availability_rule` to this table too, closing the
    // gap this comment used to describe (there was no DB-level guard here at
    // all, so the client check WAS the only enforcement).
    const basis = await fetchScopedContractBasis(resolvedProfileId, {
        subDepartmentId: input.subDepartmentId ?? null,
    });
    if (basis.isFullTime) throw new Error(FT_AVAILABILITY_ERROR);

    const { data, error } = await (supabase as any)
        .from('availability_exceptions')
        .insert({
            // The RESOLVED id in both columns. These read `profileId` verbatim
            // before, so a 'current-user' caller sent the literal string into a
            // uuid column and got a 22P02 rather than a row.
            profile_id: resolvedProfileId,
            exception_date: input.exceptionDate,
            start_time: input.startTime,
            end_time: input.endTime,
            severity: input.severity,
            reason: input.reason ?? null,
            sub_department_id: input.subDepartmentId ?? null,
            created_by: resolvedProfileId,
        })
        .select()
        .single();

    if (error) throw error;
    return mapRow(data);
}

export async function deleteAvailabilityException(id: string): Promise<void> {
    const { error } = await (supabase as any)
        .from('availability_exceptions')
        .delete()
        .eq('id', id);
    if (error) throw error;
}
