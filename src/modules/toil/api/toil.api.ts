/**
 * TOIL — Supabase client layer.
 *
 * Reads go through RLS (`toil_ledger`: self, or `leave.view` / `timesheet.approve`
 * in scope) or the guarded RPCs `get_toil_balances` / `get_toil_lots`. There is
 * no client write path to the ledger at all: earning happens in triggers on
 * timesheets, taking through leave requests, and the only two direct actions —
 * a payout and a manual adjustment — are guarded RPCs.
 */
import { supabase } from '@/platform/supabase/client';
import type { ToilEntryType, ToilLedgerEntry, ToilLot, ToilPosition } from '../model/toil.types';

export interface MutationResult<T = void> {
    data?: T;
    error?: string;
}

function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function mapEntry(r: any): ToilLedgerEntry {
    return {
        id: r.id,
        employeeId: r.employee_id,
        userContractId: r.user_contract_id,
        entryType: r.entry_type as ToilEntryType,
        minutes: num(r.minutes),
        effectiveDate: String(r.effective_date).slice(0, 10),
        leaveRequestId: r.leave_request_id ?? null,
        sourceTimesheetIds: Array.isArray(r.source_timesheet_ids) ? r.source_timesheet_ids : [],
        workedMinutes: r.worked_minutes == null ? null : num(r.worked_minutes),
        thresholdMinutes: r.threshold_minutes == null ? null : num(r.threshold_minutes),
        reason: r.reason ?? null,
        createdBy: r.created_by ?? null,
        createdAt: r.created_at,
    };
}

function mapPosition(r: any): ToilPosition {
    const balance = num(r.balance_minutes);
    const held = num(r.held_minutes);
    return {
        employeeId: r.employee_id,
        eligible: Boolean(r.eligible),
        balanceMinutes: balance,
        heldMinutes: held,
        availableMinutes: balance - held,
        earnedMinutes: num(r.earned_minutes),
        takenMinutes: num(r.taken_minutes),
        paidOutMinutes: num(r.paid_out_minutes),
        nextExpiry: r.next_expiry_date
            ? { date: String(r.next_expiry_date).slice(0, 10), minutes: num(r.next_expiry_minutes) }
            : null,
        hasHistory: Boolean(r.has_history),
    };
}

/**
 * Each person's position, keyed by employee. People the caller may not see
 * are simply absent (the RPC skips them rather than failing the whole read).
 */
export async function getToilPositions(employeeIds: readonly string[]): Promise<Map<string, ToilPosition>> {
    const out = new Map<string, ToilPosition>();
    const ids = [...new Set(employeeIds.filter(Boolean))];
    if (ids.length === 0) return out;
    const { data, error } = await (supabase as any).rpc('get_toil_balances', { p_employee_ids: ids });
    if (error) throw new Error(error.message);
    for (const r of data ?? []) out.set(r.employee_id, mapPosition(r));
    return out;
}

/** One person's ledger, newest first. */
export async function getToilLedger(employeeId: string): Promise<ToilLedgerEntry[]> {
    const { data, error } = await (supabase as any)
        .from('toil_ledger')
        .select('*')
        .eq('employee_id', employeeId)
        .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapEntry);
}

/** What is left of each earned day / week, and when it expires. */
export async function getToilLots(employeeId: string): Promise<ToilLot[]> {
    const { data, error } = await (supabase as any).rpc('get_toil_lots', { p_employee: employeeId });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
        lotDate: String(r.lot_date).slice(0, 10),
        earnedMinutes: num(r.earned_minutes),
        remainingMinutes: num(r.remaining_minutes),
        expiresOn: String(r.expires_on).slice(0, 10),
    }));
}

/**
 * Daily TOIL booked per person-day, with the timesheets it came from — for the
 * "+0.4h TOIL" badge on approved timesheet rows. Key: `${employeeId}:${yyyy-MM-dd}`.
 * The contributing timesheets are those on the day's most recent entry.
 */
export async function getDailyToilByDay(
    employeeIds: readonly string[],
    from: string,
    to: string,
): Promise<Map<string, { minutes: number; timesheetIds: string[] }>> {
    const out = new Map<string, { minutes: number; timesheetIds: string[] }>();
    const ids = [...new Set(employeeIds.filter(Boolean))];
    if (ids.length === 0 || !from || !to) return out;
    const { data, error } = await (supabase as any)
        .from('toil_ledger')
        .select('employee_id, effective_date, minutes, source_timesheet_ids, created_at')
        .eq('entry_type', 'accrual')
        .in('employee_id', ids)
        .gte('effective_date', from)
        .lte('effective_date', to)
        .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
        const key = `${r.employee_id}:${String(r.effective_date).slice(0, 10)}`;
        const cur = out.get(key) ?? { minutes: 0, timesheetIds: [] };
        cur.minutes += num(r.minutes);
        cur.timesheetIds = Array.isArray(r.source_timesheet_ids) ? r.source_timesheet_ids : [];
        out.set(key, cur);
    }
    return out;
}

/** Entries of the given types effective inside [from, to], RLS-scoped. */
export async function getToilEntriesInRange(
    types: readonly ToilEntryType[],
    from: string,
    to: string,
): Promise<ToilLedgerEntry[]> {
    const { data, error } = await (supabase as any)
        .from('toil_ledger')
        .select('*')
        .in('entry_type', [...types])
        .gte('effective_date', from)
        .lte('effective_date', to);
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapEntry);
}

/**
 * Pay out unused TOIL in the next pay run. The employee may ask for their own
 * at any time — no approval step, the employer must pay on request — and a
 * leave approver in scope may pay out on their behalf.
 */
export async function requestToilPayout(
    employeeId: string,
    minutes: number,
    note?: string,
): Promise<MutationResult<string>> {
    const { data, error } = await (supabase as any).rpc('toil_request_payout', {
        p_employee: employeeId,
        p_minutes: Math.round(minutes),
        p_note: note?.trim() || null,
    });
    if (error) return { error: error.message };
    return { data: data as string };
}

/** A manual correction (leave approvers in scope, never their own). Reason required. */
export async function adjustToil(
    employeeId: string,
    minutes: number,
    reason: string,
): Promise<MutationResult<string>> {
    if (!reason.trim()) return { error: 'Say why the balance is being adjusted.' };
    const { data, error } = await (supabase as any).rpc('toil_adjust', {
        p_employee: employeeId,
        p_minutes: Math.round(minutes),
        p_reason: reason.trim(),
    });
    if (error) return { error: error.message };
    return { data: data as string };
}
