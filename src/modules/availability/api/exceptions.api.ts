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
    createdAt: string;
}

export interface CreateExceptionInput {
    exceptionDate: string | null;
    startTime: string;
    endTime: string;
    severity: ExceptionSeverity;
    reason?: string;
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
): Promise<AvailabilityException[]> {
    const { data, error } = await (supabase as any)
        .from('availability_exceptions')
        .select('id,profile_id,exception_date,start_time,end_time,severity,reason,created_at')
        .eq('profile_id', profileId)
        .order('exception_date', { ascending: true, nullsFirst: false })
        .order('start_time', { ascending: true });

    if (error) throw error;
    return (data ?? []).map(mapRow);
}

export async function createAvailabilityException(
    profileId: string,
    input: CreateExceptionInput,
): Promise<AvailabilityException> {
    const { data, error } = await (supabase as any)
        .from('availability_exceptions')
        .insert({
            profile_id: profileId,
            exception_date: input.exceptionDate,
            start_time: input.startTime,
            end_time: input.endTime,
            severity: input.severity,
            reason: input.reason ?? null,
            created_by: profileId,
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
