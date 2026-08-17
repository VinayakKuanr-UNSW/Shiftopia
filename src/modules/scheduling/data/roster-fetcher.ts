/**
 * RosterFetcher — Supabase data-loading for the AutoScheduler.
 *
 * Extracted from `auto-scheduler.controller.ts` in Phase 2 (H5). The
 * controller used to own three responsibilities this module now handles:
 *
 *   1. **Existing roster context** — fetches each candidate employee's
 *      already-committed shifts within (and around) the optimization
 *      window so the solver can enforce rest-gap / fatigue constraints.
 *
 *   2. **Declared availability** — loads employee availability slots and
 *      a has-any-data flag to distinguish "not onboarded" from
 *      "declared but empty in window."
 *
 *   3. **Time/date utilities** shared with the controller — normalizeTime,
 *      shiftDate, durationMinutes.
 *
 * Design decision: the class takes a Supabase client so tests can inject
 * a mock. The exported singleton wires the real production client.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as prodSupabase } from '@/platform/supabase/client';
import type { AvailabilityOverrideRef, ExistingShiftRef, OptimizerEmployee } from '../types';
import type { ShiftMeta, EmployeeMeta } from '../optimizer/solution-parser';
import { isFullTimeEmployee } from '@/modules/core/model/employment.types';

// =============================================================================
// SHARED UTILITIES — pure functions, no I/O
// =============================================================================

/** Postgres returns 'HH:MM:SS' for time columns; the optimizer expects 'HH:MM'. */
export function normalizeTime(t: string): string {
    if (!t) return t;
    const parts = t.split(':');
    return `${parts[0]}:${parts[1]}`;
}

/** Add or subtract calendar days from YYYY-MM-DD without timezone drift. */
export function shiftDate(date: string, offsetDays: number): string {
    const [y, m, d] = date.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + offsetDays);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}

/** Compute shift duration in minutes from HH:MM strings, wrapping past midnight. */
export function durationMinutes(start: string, end: string): number {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    let mins = eh * 60 + em - (sh * 60 + sm);
    if (mins <= 0) mins += 1440;
    return mins;
}

// =============================================================================
// AVAILABILITY RESULT TYPE
// =============================================================================

export interface AvailabilityResult {
    slots: Array<{ slot_date: string; start_time: string; end_time: string }>;
    hasAnyData: boolean;
}

// =============================================================================
// ROSTER FETCHER
// =============================================================================

export class RosterFetcher {
    constructor(private readonly supabase: SupabaseClient = prodSupabase) {}

    // ── Existing Roster ──────────────────────────────────────────────────────

    /**
     * Fetch each candidate employee's already-committed shifts within (and
     * just outside) the optimization window. The window is widened by one day
     * on each side so shifts adjacent to the window can still anchor rest-gap
     * checks (e.g. a Sunday-night shift constrains a Monday-morning proposal).
     *
     * Uses the SECURITY DEFINER RPC `get_employee_shift_window` so cross-
     * department shifts remain visible regardless of the calling manager's
     * RLS scope — the same correctness reasoning the bulk-assignment scenario
     * loader uses. A direct `.from('shifts')` query is RLS-scoped and can
     * silently omit shifts in other departments, producing false-pass
     * proposals that would later be rejected by compliance.
     *
     * OPTIMIZATION (Bulk): We now use a single RPC call for all employees to
     * avoid browser request limits and Navigator Lock timeouts (common with
     * 50+ staff).
     */
    async fetchExistingRoster(
        shifts: ShiftMeta[],
        employees: EmployeeMeta[],
    ): Promise<Map<string, ExistingShiftRef[]>> {
        const result = new Map<string, ExistingShiftRef[]>();
        if (shifts.length === 0 || employees.length === 0) return result;

        const dates = shifts.map(s => s.shift_date).sort();
        // Look back 28 days to support V8 rolling average context (2W/3W/4W checks)
        const windowStart = shiftDate(dates[0], -28);
        const windowEnd = shiftDate(dates[dates.length - 1], +1);
        const candidateV8ShiftIds = new Set(shifts.map(s => s.id));

        console.debug('[RosterFetcher] Fetching roster context for %d employees...', employees.length);

        try {
            // ── Try Bulk Fetch First (New RPC) ───────────────────────────────
            const { data, error } = await (this.supabase.rpc as any)('get_employees_shift_window_bulk', {
                p_employee_ids: employees.map(e => e.id),
                p_start_date: windowStart,
                p_end_date: windowEnd,
            });

            if (!error && data) {
                const rows = data as Array<{
                    id: string;
                    assigned_employee_id: string;
                    shift_date: string;
                    start_time: string;
                    end_time: string;
                    unpaid_break_minutes: number;
                }>;

                // Group by employee
                for (const emp of employees) {
                    const empRows = rows.filter(r => r.assigned_employee_id === emp.id);
                    const refs: ExistingShiftRef[] = empRows
                        .filter(r => !candidateV8ShiftIds.has(r.id))
                        .map(r => ({
                            id: r.id,
                            shift_date: r.shift_date,
                            start_time: normalizeTime(r.start_time),
                            end_time: normalizeTime(r.end_time),
                            duration_minutes: durationMinutes(
                                normalizeTime(r.start_time),
                                normalizeTime(r.end_time),
                            ),
                            unpaid_break_minutes: r.unpaid_break_minutes ?? 0,
                        }));
                    result.set(emp.id, refs);
                }
                console.debug('[RosterFetcher] Bulk roster fetch successful (%d total shifts)', rows.length);
                return result;
            }

            console.warn('[RosterFetcher] Bulk roster fetch failed or RPC missing, falling back to chunked sequential...', error);
        } catch (err) {
            console.warn('[RosterFetcher] Bulk roster fetch threw, falling back...', err);
        }

        // ── Fallback: Chunked Sequential Fetch ──────────────────────────────
        // We process in small batches (e.g., 5 at a time) to avoid browser lock contention
        const CHUNK_SIZE = 5;
        for (let i = 0; i < employees.length; i += CHUNK_SIZE) {
            const chunk = employees.slice(i, i + CHUNK_SIZE);
            await Promise.all(chunk.map(async emp => {
                try {
                    const { data, error } = await (this.supabase.rpc as any)('get_employee_shift_window', {
                        p_employee_id: emp.id,
                        p_start_date: windowStart,
                        p_end_date: windowEnd,
                        p_exclude_id: null,
                    });
                    if (error) {
                        console.warn('[RosterFetcher] Roster fetch failed for', emp.id, error);
                        result.set(emp.id, []);
                        return;
                    }
                    const rows = (data ?? []) as any[];
                    const refs: ExistingShiftRef[] = rows
                        .filter(r => !candidateV8ShiftIds.has(r.id))
                        .map(r => ({
                            id: r.id,
                            shift_date: r.shift_date,
                            start_time: normalizeTime(r.start_time),
                            end_time: normalizeTime(r.end_time),
                            duration_minutes: durationMinutes(
                                normalizeTime(r.start_time),
                                normalizeTime(r.end_time),
                            ),
                            unpaid_break_minutes: r.unpaid_break_minutes ?? 0,
                        }));
                    result.set(emp.id, refs);
                } catch (err) {
                    console.warn('[RosterFetcher] Roster fetch threw for', emp.id, err);
                    result.set(emp.id, []);
                }
            }));
        }

        return result;
    }

    // ── Availability ─────────────────────────────────────────────────────────

    /**
     * Fetch declared availability slots for each employee within the
     * optimization window, plus a flag indicating whether the employee has
     * *any* availability records on file at all (anywhere, anytime).
     *
     * The flag distinguishes:
     *   - "not yet onboarded" (0 records ever) → universally available
     *   - "has declared availability" (records exist somewhere) → only
     *     available where slots cover the shift
     *
     * Returns a Map keyed by employee id with { slots, hasAnyData }.
     */
    async fetchAvailability(
        shifts: ShiftMeta[],
        employees: EmployeeMeta[],
    ): Promise<Map<string, AvailabilityResult>> {
        const result = new Map<string, AvailabilityResult>();
        if (shifts.length === 0 || employees.length === 0) return result;

        // Partition: FT employees are available by contract obligation;
        // unavailability is managed via Leave (`unavailable_dates`), so we
        // neither query nor enforce availability slots for them.
        //
        // PT are deliberately NOT partitioned out even though they are also
        // OPT_OUT. A part-timer's declaration is a real, per-date narrowing they
        // are entitled to make; only FT has no declaration to read.
        //
        // `isFullTimeEmployee` rather than a local regex: the controller derives
        // `availability_mode` from the same predicate, and an FT classified here
        // but not there would be sent an empty slot list under OPT_IN and
        // hard-filtered out of every shift. See that function's note.
        const isFtEmp = (e: EmployeeMeta) =>
            isFullTimeEmployee(e.employment_status, e.contract_type);

        const nonFtEmployees = employees.filter(e => !isFtEmp(e));
        const nonFtEmployeeIds = nonFtEmployees.map(e => e.id);

        for (const emp of employees) {
            if (isFtEmp(emp)) {
                result.set(emp.id, { slots: [], hasAnyData: false });
            }
        }

        if (nonFtEmployeeIds.length === 0) {
            return result;
        }

        const dates = shifts.map(s => s.shift_date).sort();
        const windowStart = dates[0];
        const windowEnd = dates[dates.length - 1];

        // Slots in the window for non-FT employees
        const { data: slotRows, error: slotErr } = await this.supabase
            .from('availability_slots')
            .select('profile_id,slot_date,start_time,end_time')
            .in('profile_id', nonFtEmployeeIds)
            .gte('slot_date', windowStart)
            .lte('slot_date', windowEnd);

        if (slotErr) {
            console.warn('[RosterFetcher] Availability slot fetch failed — treating all employees as universally available', slotErr);
            for (const emp of nonFtEmployees) {
                result.set(emp.id, { slots: [], hasAnyData: false });
            }
            return result;
        }

        // Has-any-records check (lookup any rule, not just slots in window).
        // We use availability_rules because it's the source of declared
        // intent; the slots table is materialized output.
        const { data: hasDataRows, error: hasErr } = await this.supabase
            .from('availability_rules')
            .select('profile_id')
            .in('profile_id', nonFtEmployeeIds)
            .limit(nonFtEmployeeIds.length);

        if (hasErr) {
            // Fall back to inferring from in-window slots: if the employee
            // has any in-window slots, they have data; otherwise we
            // conservatively treat them as no-data (universally available)
            // rather than blocking everyone on a transient query failure.
            console.warn('[RosterFetcher] Availability rule fetch failed — falling back to slot-presence inference', hasErr);
        }

        const hasDataSet = new Set<string>(
            (hasDataRows ?? []).map(r => (r as any).profile_id as string),
        );

        const slotsByEmp = new Map<string, Array<{ slot_date: string; start_time: string; end_time: string }>>();
        for (const r of (slotRows ?? []) as any[]) {
            const list = slotsByEmp.get(r.profile_id) ?? [];
            list.push({
                slot_date: r.slot_date,
                start_time: normalizeTime(r.start_time),
                end_time: normalizeTime(r.end_time),
            });
            slotsByEmp.set(r.profile_id, list);
        }

        for (const emp of nonFtEmployees) {
            const slots = slotsByEmp.get(emp.id) ?? [];
            const hasAnyData = hasErr
                ? slots.length > 0
                : hasDataSet.has(emp.id);
            result.set(emp.id, { slots, hasAnyData });
        }

        const enforced = Array.from(result.values()).filter(v => v.hasAnyData).length;
        console.info(
            '[RosterFetcher] Availability: %d/%d non-FT employees have declared records (will be hard-filtered); %d FT employees are contract-available',
            enforced, nonFtEmployees.length, employees.length - nonFtEmployees.length,
        );

        return result;
    }

    // ── Approved Leave ───────────────────────────────────────────────────────

    /**
     * Fetch each candidate employee's APPROVED leave dates inside the
     * optimization window (audit F1 — leave↔scheduler integration).
     *
     * Approved leave is a LEGAL-HARD unavailability: it wins over coverage
     * (mirrors the locked legal_hard » coverage precedence). The dates feed the
     * solver's existing `unavailable_dates` per-day hard exclusion — no
     * optimizer-service change is required.
     *
     * Fail-open: on query error we log and return an empty map (the solver run
     * proceeds; the V8 leave-conflict layer still guards the commit path).
     *
     * @returns employeeId → sorted YYYY-MM-DD dates on approved leave, clamped
     *          to [windowStart, windowEnd].
     */
    async fetchApprovedLeave(
        shifts: ShiftMeta[],
        employees: EmployeeMeta[],
    ): Promise<Map<string, string[]>> {
        return (await this.fetchLeaveByStatus(shifts, employees, 'approved')).dates;
    }

    /**
     * Each candidate's PENDING leave dates inside the window.
     *
     * WHY THIS EXISTS. Only approved leave was ever read, so a request sitting
     * in someone's inbox was invisible to the solver: a manager runs autopilot
     * on Monday, an employee has leave pending for next week, the solver
     * rosters them into it, the leave is approved on Wednesday — and now there
     * is a rostered shift inside approved leave, recoverable only through the
     * manual post-approval unassign flow.
     *
     * It is NOT hard-excluded. Pending leave is a request, not a decision, and
     * treating it as binding would let anyone remove themselves from the roster
     * by asking. It becomes a SOFT `availability_overrides` entry instead —
     * 5000c, so the solver routes around it when it cheaply can and still
     * covers the shift when nobody else exists.
     */
    async fetchPendingLeave(
        shifts: ShiftMeta[],
        employees: EmployeeMeta[],
    ): Promise<Map<string, string[]>> {
        return (await this.fetchLeaveByStatus(shifts, employees, 'pending')).dates;
    }

    /** Shared reader — the two statuses differ only in how the solver treats them. */
    private async fetchLeaveByStatus(
        shifts: ShiftMeta[],
        employees: EmployeeMeta[],
        status: 'approved' | 'pending',
    ): Promise<{ dates: Map<string, string[]> }> {
        const result = new Map<string, string[]>();
        if (shifts.length === 0 || employees.length === 0) return { dates: result };

        const dates = shifts.map(s => s.shift_date).sort();
        const windowStart = dates[0];
        const windowEnd = dates[dates.length - 1];
        const employeeIds = employees.map(e => e.id);

        // leave_requests start/end are timestamptz in prod — the T23:59:59
        // suffix keeps a same-day range overlapping (parity with payroll's
        // leaveGrossPay reader).
        const { data, error } = await this.supabase
            .from('leave_requests')
            .select('employee_id, start_date, end_date, status')
            .in('employee_id', employeeIds)
            .eq('status', status)
            .lte('start_date', `${windowEnd}T23:59:59`)
            .gte('end_date', windowStart);

        if (error) {
            console.warn(
                `[RosterFetcher] ${status}-leave fetch failed — solver will NOT account for it this run`,
                error,
            );
            return { dates: result };
        }

        const toYmd = (v: string | null | undefined): string =>
            (v ?? '').includes('T') ? String(v).split('T')[0] : String(v ?? '').slice(0, 10);

        for (const row of (data ?? []) as any[]) {
            const emp = row.employee_id as string | null;
            if (!emp) continue;
            const from0 = toYmd(row.start_date);
            const to0 = toYmd(row.end_date);
            if (!from0 || !to0) continue;
            const from = from0 > windowStart ? from0 : windowStart;
            const to = to0 < windowEnd ? to0 : windowEnd;
            if (from > to) continue;
            const days = result.get(emp) ?? [];
            for (let d = from; d <= to; d = shiftDate(d, 1)) days.push(d);
            result.set(emp, days);
        }

        for (const [emp, days] of result) {
            result.set(emp, Array.from(new Set(days)).sort());
        }
        if (result.size > 0) {
            console.info(
                '[RosterFetcher] %s leave: %d employee(s) have leave dates inside the window (%s)',
                status, result.size,
                status === 'approved' ? 'hard-excluded' : 'SOFT-penalised, still assignable',
            );
        }
        return { dates: result };
    }

    /**
     * Employee-declared availability EXCEPTIONS in the window — the producer
     * for `availability_overrides`, which has been fully implemented in the
     * solver since it was written and never had one.
     *
     * Subtractive by construction: an exception says "not during this", so
     * unlike a declaration in `availability_rules` it can never accidentally
     * un-roster someone by being too narrow.
     *
     * Fail-open: on a query error we log and return an empty map. An exception
     * is a preference, and losing one for a run degrades the roster; blocking
     * the run instead would be a worse trade.
     */
    async fetchAvailabilityExceptions(
        shifts: ShiftMeta[],
        employees: EmployeeMeta[],
    ): Promise<Map<string, AvailabilityOverrideRef[]>> {
        const result = new Map<string, AvailabilityOverrideRef[]>();
        if (shifts.length === 0 || employees.length === 0) return result;

        const dates = shifts.map(s => s.shift_date).sort();
        const windowStart = dates[0];
        const windowEnd = dates[dates.length - 1];

        // An undated exception applies on EVERY day, so it can never be
        // filtered out by the window — hence the `is null` arm rather than a
        // plain range predicate.
        const { data, error } = await (this.supabase as any)
            .from('availability_exceptions')
            .select('profile_id,exception_date,start_time,end_time,severity')
            .in('profile_id', employees.map(e => e.id))
            .or(`exception_date.is.null,and(exception_date.gte.${windowStart},exception_date.lte.${windowEnd})`);

        if (error) {
            console.warn('[RosterFetcher] Availability-exception fetch failed — solver will not see them this run', error);
            return result;
        }

        for (const row of (data ?? []) as any[]) {
            const profileId = row.profile_id as string | null;
            if (!profileId) continue;
            const list = result.get(profileId) ?? [];
            list.push({
                start_time: normalizeTime(row.start_time),
                end_time: normalizeTime(row.end_time),
                severity: row.severity as AvailabilityOverrideRef['severity'],
                // `undefined`, never `null` — an undated override means every
                // day, and the solver distinguishes the two by absence.
                date: row.exception_date ? String(row.exception_date).slice(0, 10) : undefined,
            });
            result.set(profileId, list);
        }

        if (result.size > 0) {
            console.info(
                '[RosterFetcher] Availability exceptions: %d employee(s) have declared windows in this run',
                result.size,
            );
        }
        return result;
    }

    // ── Employee contract details (compliance audit finding — 2026-08-02) ────

    /**
     * Resolves each employee's Schedule 1/2 classification level, Schedule
     * 3 Security status, and Schedule 4/5/6 (apprentice/trainee/SWS) wage
     * category from their Active `user_contracts` row(s) — the real, RLS-
     * exposed `public.user_contracts` view over `hr.user_contracts` (140
     * populated rows in production as of 2026-08-02, 100% coverage on
     * `remuneration_level`/`role_id`).
     *
     * Previously the AutoScheduler had no path to this data at all: neither
     * live UI caller ever populated `employeeDetails`, so `det?.level` was
     * always undefined and every employee was priced off the classification-
     * blind default rate. This closes that gap directly, and supersedes the
     * P0.4 best-effort `deriveSecurityRoleIds()` heuristic (which could only
     * guess Security status from shift role names appearing in the CURRENT
     * batch) with a definitive answer from the employee's actual contract.
     *
     * An employee with more than one Active contract (multi-skilled staff)
     * is represented by: the HIGHEST `remuneration_level` among their
     * contracts (a reasonable "top" classification for rate-ranking
     * purposes), `is_security_role` true if ANY contract's role is
     * Security-named, and the apprentice/trainee/SWS fields from whichever
     * contract has one of those flags set (mirroring the mutual exclusivity
     * `useContractForm.ts` already enforces at entry).
     */
    /**
     * Contract ordinary-hours envelopes for the pool (solver HC-5e).
     *
     * WHY THIS IS ITS OWN READ. The envelope columns landed in migration
     * 20260817000000, and PostgREST rejects the ENTIRE select when any one column
     * name is unknown — a 400, not a null column. Naming them inside
     * `fetchEmployeeContractDetails`'s big select would therefore take out every
     * classification field with it on any environment that had not migrated,
     * silently reverting the whole pool to default pay rates. Isolated here, a
     * pre-migration database costs exactly one warned-about failure and an
     * unrestricted envelope — which is the correct answer there anyway, since
     * nothing in it has a span.
     *
     * ONE CONTRACT PER PERSON, chosen to match `sm_materialize_contract_envelope`
     * and `resolveComplianceBasis`: the largest weekly basis wins, then the later
     * start. 30 of 103 people hold several Active contracts, so an arbitrary pick
     * would make a person's rosterable span depend on row order.
     */
    async fetchOrdinaryHoursEnvelopes(
        employees: EmployeeMeta[],
    ): Promise<Map<string, Pick<OptimizerEmployee, 'ordinary_span_start' | 'ordinary_span_end' | 'ordinary_days'>>> {
        const result = new Map<string, Pick<OptimizerEmployee, 'ordinary_span_start' | 'ordinary_span_end' | 'ordinary_days'>>();
        if (employees.length === 0) return result;

        const { data, error } = await this.supabase
            .from('user_contracts')
            .select('user_id,ordinary_span_start,ordinary_span_end,ordinary_days,contracted_weekly_hours,start_date')
            .in('user_id', employees.map(e => e.id))
            .eq('status', 'Active');

        if (error) {
            // Unrestricted is the FAIL-OPEN direction, and the right one here: an
            // envelope this read cannot see must not become a hard filter that
            // excludes the whole pool from every shift.
            console.warn('[RosterFetcher] Ordinary-hours envelope fetch failed — treating every contract as unrestricted this run', error);
            return result;
        }

        type Row = {
            user_id: string;
            ordinary_span_start: string | null;
            ordinary_span_end: string | null;
            ordinary_days: number[] | null;
            contracted_weekly_hours: number | string | null;
            start_date: string | null;
        };

        const best = new Map<string, Row>();
        for (const row of (data ?? []) as Row[]) {
            const incumbent = best.get(row.user_id);
            if (!incumbent) {
                best.set(row.user_id, row);
                continue;
            }
            const hours = (r: Row) => Number(r.contracted_weekly_hours ?? 0) || 0;
            if (hours(row) > hours(incumbent)) { best.set(row.user_id, row); continue; }
            if (hours(row) === hours(incumbent)
                && (row.start_date ?? '') > (incumbent.start_date ?? '')) {
                best.set(row.user_id, row);
            }
        }

        for (const [userId, row] of best) {
            // Both ends or neither — a half-configured span is unrestricted, not a
            // bound with one open edge. Mirrors `toEnvelope` in
            // availability/domain/contract-basis.ts and the DB's own
            // `user_contracts_ordinary_span_valid` CHECK.
            if (!row.ordinary_span_start || !row.ordinary_span_end) continue;
            result.set(userId, {
                ordinary_span_start: row.ordinary_span_start,
                ordinary_span_end: row.ordinary_span_end,
                ordinary_days: row.ordinary_days ?? [],
            });
        }

        if (result.size > 0) {
            console.info(
                '[RosterFetcher] Ordinary-hours envelope binds for %d/%d employees (HC-5e)',
                result.size, employees.length,
            );
        }
        return result;
    }

    async fetchEmployeeContractDetails(
        employees: EmployeeMeta[],
    ): Promise<Map<string, Partial<OptimizerEmployee>>> {
        const result = new Map<string, Partial<OptimizerEmployee>>();
        if (employees.length === 0) return result;

        const employeeIds = employees.map(e => e.id);

        const { data, error } = await this.supabase
            .from('user_contracts')
            .select(`
                user_id, role_id, remuneration_level,
                is_apprentice, apprentice_type, apprentice_year, has_completed_year_12,
                is_trainee, trainee_category, trainee_level, trainee_exit_year,
                trainee_years_out, trainee_aqf_level, trainee_year,
                is_training_on_job, prefers_sba_loading,
                is_sws, sws_capacity_percentage
            `)
            .in('user_id', employeeIds)
            .eq('status', 'Active');

        if (error) {
            console.warn('[RosterFetcher] user_contracts fetch failed — AutoScheduler will use classification-blind default rates this run', error);
            return result;
        }

        const rows = (data ?? []) as any[];
        if (rows.length === 0) return result;

        // ── Resolve Security status from each contract's role name ──────────
        const roleIds = Array.from(new Set(rows.map(r => r.role_id).filter(Boolean)));
        const securityRoleIds = new Set<string>();
        if (roleIds.length > 0) {
            const { data: roleRows, error: roleErr } = await this.supabase
                .from('roles')
                .select('id, name')
                .in('id', roleIds);
            if (roleErr) {
                console.warn('[RosterFetcher] roles lookup failed — Security status will not be resolved from contracts this run', roleErr);
            } else {
                for (const r of (roleRows ?? []) as any[]) {
                    if (/security/i.test(r?.name || '')) securityRoleIds.add(r.id);
                }
            }
        }

        const byEmployee = new Map<string, any[]>();
        for (const row of rows) {
            const uid = row.user_id as string | null;
            if (!uid) continue;
            const list = byEmployee.get(uid) ?? [];
            list.push(row);
            byEmployee.set(uid, list);
        }

        for (const [employeeId, contracts] of byEmployee) {
            const isSecurityRole = contracts.some(c => c.role_id && securityRoleIds.has(c.role_id));
            const specialCategory = contracts.find(c => c.is_apprentice || c.is_trainee || c.is_sws);
            const topLevelContract = [...contracts].sort(
                (a, b) => (b.remuneration_level ?? -1) - (a.remuneration_level ?? -1),
            )[0];

            const details: Partial<OptimizerEmployee> = {
                level: topLevelContract?.remuneration_level ?? undefined,
                is_security_role: isSecurityRole,
            };
            if (specialCategory) {
                details.is_apprentice = specialCategory.is_apprentice ?? false;
                details.apprentice_type = specialCategory.apprentice_type ?? undefined;
                details.apprentice_year = specialCategory.apprentice_year ?? undefined;
                details.has_completed_year_12 = specialCategory.has_completed_year_12 ?? false;
                details.is_trainee = specialCategory.is_trainee ?? false;
                details.trainee_category = specialCategory.trainee_category ?? undefined;
                details.trainee_level = specialCategory.trainee_level ?? undefined;
                details.trainee_exit_year = specialCategory.trainee_exit_year ?? undefined;
                details.trainee_years_out = specialCategory.trainee_years_out ?? undefined;
                details.trainee_aqf_level = specialCategory.trainee_aqf_level ?? undefined;
                details.trainee_year = specialCategory.trainee_year ?? undefined;
                details.is_training_on_job = specialCategory.is_training_on_job ?? false;
                details.prefers_sba_loading = specialCategory.prefers_sba_loading ?? false;
                details.is_sws = specialCategory.is_sws ?? false;
                details.sws_capacity_percentage = specialCategory.sws_capacity_percentage ?? undefined;
            }
            result.set(employeeId, details);
        }

        console.info('[RosterFetcher] Contract details: %d/%d employee(s) resolved from Active user_contracts', result.size, employees.length);
        return result;
    }
}

/** Singleton wired against the production Supabase client. Tests construct
 *  `new RosterFetcher(mockClient)` to inject a fake. */
export const rosterFetcher = new RosterFetcher();
