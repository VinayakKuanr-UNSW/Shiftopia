/**
 * F1 — Fairness Ledger Service.
 *
 * Orchestrates the domain logic and DB queries to maintain the ledger.
 *
 * Exposes:
 *   - getEmployeeDebtsWithStatus: current debts + an explicit freshness verdict.
 *   - getEmployeeDebts: debts only (thin wrapper over the above).
 *   - recomputeLedger: full rebuild from shift history (expensive, authoritative).
 *   - updateAfterCommit: fast incremental update when new shifts are assigned.
 */

import { format, parseISO, differenceInCalendarDays } from 'date-fns';
import { fairnessLedgerQueries } from '../api/fairnessLedger.queries';
import {
    DEFAULT_WINDOW_DAYS,
    type FairnessDebt,
    type ShiftForFairness,
} from '../domain/fairness-ledger';

/**
 * How old the newest ledger window may be before a read is reported as `stale`.
 *
 * The ledger is a 91-day rolling window, so a few days of drift barely moves a
 * debt. A week is the point where "the roster changed and the ledger hasn't
 * noticed" becomes the likelier explanation — and where an operator should be
 * told rather than left to infer it.
 */
export const LEDGER_STALE_AFTER_DAYS = 7;

/**
 * - `ok`          — data found, fresh enough to act on.
 * - `stale`       — data found but older than LEDGER_STALE_AFTER_DAYS. Still
 *                   applied (stale debts beat no debts), but surfaced.
 * - `unavailable` — no rows at all. Longitudinal fairness is NOT being applied.
 */
export type FairnessLedgerStatus = 'ok' | 'stale' | 'unavailable';

export interface FairnessLedgerRead {
    debts: FairnessDebt[];
    status: FairnessLedgerStatus;
    /** `window_end` of the freshest row used, or null when unavailable. */
    windowEnd: string | null;
    /** Calendar days between `windowEnd` and the as-of date, or null. */
    ageDays: number | null;
}

export const fairnessLedgerService = {
    /**
     * Fetch the current fairness debts for a set of employees, together with an
     * explicit freshness verdict.
     *
     * Audit F-04: this used to return a bare `FairnessDebt[]` read at an EXACT
     * `window_end = today`. On any day without a recompute that matched nothing,
     * so the caller got `[]` — indistinguishable from "everyone's debt is
     * genuinely zero" — and longitudinal fairness silently switched itself off.
     * Fairness quality became a function of publishing cadence rather than
     * policy, with no signal anywhere that it had happened.
     *
     * Now: read the most recent window at or before `asOfDate` and report how
     * old it is, so a degraded ledger is VISIBLE rather than inferred.
     *
     * @param organizationId  The org ID.
     * @param employeeIds     The employees to fetch.
     * @param windowDays      Length of the rolling window (default 91).
     * @param asOfDate        The date to consider "today" (defaults to current date).
     */
    async getEmployeeDebtsWithStatus(
        organizationId: string,
        employeeIds: string[],
        windowDays = DEFAULT_WINDOW_DAYS,
        asOfDate = new Date(),
    ): Promise<FairnessLedgerRead> {
        if (employeeIds.length === 0) {
            return { debts: [], status: 'ok', windowEnd: null, ageDays: null };
        }

        const asOfStr = format(asOfDate, 'yyyy-MM-dd');
        const rows = await fairnessLedgerQueries.getLatestDebts(organizationId, employeeIds, asOfStr);

        if (rows.length === 0) {
            console.warn(
                '[FairnessLedger] No ledger data for org %s at or before %s — longitudinal ' +
                'fairness will NOT be applied to this run.',
                organizationId, asOfStr,
            );
            return { debts: [], status: 'unavailable', windowEnd: null, ageDays: null };
        }

        // Rows can straddle windows (an employee whose last recompute predates
        // another's). The freshest window is the ledger's effective age.
        const windowEnd = rows.reduce((max, r) => (r.window_end > max ? r.window_end : max), rows[0].window_end);
        const ageDays = differenceInCalendarDays(asOfDate, parseISO(windowEnd));
        const status: FairnessLedgerStatus = ageDays > LEDGER_STALE_AFTER_DAYS ? 'stale' : 'ok';

        if (status === 'stale') {
            console.warn(
                '[FairnessLedger] Ledger is %d days old (window_end=%s). Debts are being applied ' +
                'but reflect stale history — schedule a recompute.',
                ageDays, windowEnd,
            );
        }

        return {
            debts: rows.map(r => ({
                employeeId: r.employee_id,
                metric: r.metric,
                rollingValue: r.rolling_value,
                teamAverage: r.team_average,
                debt: r.debt,
            })),
            status,
            windowEnd,
            ageDays,
        };
    },

    /**
     * Debts only. Thin wrapper over `getEmployeeDebtsWithStatus` for callers that
     * genuinely cannot act on the freshness verdict (e.g. pure ordering hints).
     * Prefer the `WithStatus` form anywhere the result is user-visible.
     */
    async getEmployeeDebts(
        organizationId: string,
        employeeIds: string[],
        windowDays = DEFAULT_WINDOW_DAYS,
        asOfDate = new Date(),
    ): Promise<FairnessDebt[]> {
        const { debts } = await this.getEmployeeDebtsWithStatus(
            organizationId, employeeIds, windowDays, asOfDate,
        );
        return debts;
    },

    /**
     * Recompute the entire ledger for a window — the AUTHORITATIVE rebuild.
     *
     * Delegates to the `recompute_fairness_ledger` SQL function. Audit F-04
     * moved this server-side for two reasons:
     *
     *   1. It can now be SCHEDULED. The browser-side version could only run
     *      when a human clicked Publish, so the ledger was as fresh as the last
     *      publish and on a quiet week went stale or was never built at all.
     *      `nightly_fairness_recompute` (pg_cron) now runs it daily per org.
     *   2. It stays ONE implementation. Porting the maths to SQL *alongside*
     *      the TS version would have created the exact drift the coefficient
     *      tables already suffer from (audit F-13), so the TS write path is
     *      gone rather than duplicated. Classification parity between the SQL
     *      function and `domain/fairness-ledger.ts` — which still owns the
     *      read-only what-if preview — is pinned by test.
     *
     * The RPC authorises the caller against the same predicate as the
     * `fairness_ledger_org_scoped` RLS policy before delegating, so a manager
     * cannot rebuild another org's ledger by passing its uuid.
     *
     * @param organizationId  The org ID.
     * @param windowEnd       End date of the rolling window.
     * @param departmentId    Unused — the ledger is org-scoped so the team
     *                        average matches the solver's org-wide read (see
     *                        audit F-14). Kept for call-site compatibility.
     * @param windowDays      Unused here; the window length is the SQL
     *                        function's own default (91) so both paths cannot
     *                        disagree about the window.
     */
    async recomputeLedger(
        organizationId: string,
        windowEnd: Date,
        departmentId?: string,
        windowDays = DEFAULT_WINDOW_DAYS,
    ): Promise<void> {
        void departmentId;
        void windowDays;
        const windowEndStr = format(windowEnd, 'yyyy-MM-dd');
        const rows = await fairnessLedgerQueries.requestRecompute(organizationId, windowEndStr);
        console.info('[FairnessLedger] Recomputed %d rows for org %s (window_end=%s).',
            rows, organizationId, windowEndStr);
    },

    /**
     * Record that shifts were just committed.
     *
     * Now a straight re-run of the authoritative recompute. The previous
     * implementation was a client-side read-modify-write — fetch the whole
     * team's rows, add per-shift deltas in memory, upsert everything back — and
     * it carried three defects at once:
     *
     *   - **F-02** it aggregated the delta with `windowWeeks = 0`, which zeroed
     *     the contracted threshold and booked 100% of every committed minute as
     *     overtime.
     *   - **F-06** it added FUTURE shifts to a TRAILING 91-day window, so the
     *     next authoritative recompute (which only sees `[today-90, today]`)
     *     silently discarded them. It also only ever ADDED: cancelling,
     *     unassigning or swapping a shift away never decremented anything.
     *   - **F-20** read-modify-write with no version check or transaction, so
     *     two concurrent commits both read the same baseline and the second
     *     silently overwrote the first. On a monotonic accumulator a lost
     *     update never self-corrects.
     *
     * Deleting it fixes all three, and leaves exactly ONE write path. The
     * recompute is a single idempotent SQL statement, so re-running it per
     * commit is cheap and safe to retry.
     *
     * Semantics this settles: the ledger measures **worked** load over a
     * trailing window, not rostered load. A future shift starts counting when
     * its date arrives, not when it is assigned — so an employee is never in
     * debt for work they have not yet done and might never do.
     *
     * @param organizationId  The org ID.
     * @param committedShifts Only used to skip the call when nothing committed.
     * @param asOfDate        The date to consider "today" (defaults to current date).
     */
    async updateAfterCommit(
        organizationId: string,
        committedShifts: ShiftForFairness[],
        asOfDate = new Date(),
    ): Promise<void> {
        if (committedShifts.length === 0) return;
        await this.recomputeLedger(organizationId, asOfDate);
    },
};
