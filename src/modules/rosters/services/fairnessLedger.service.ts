/**
 * Casual fairness ledger: read with an explicit freshness verdict.
 *
 * There is no client write path. The ledger changes only when billables are
 * approved, and `run_casual_fairness_nightly` (pg_cron) recomputes it for
 * every organization; committing a roster does not move it.
 */

import { differenceInCalendarDays, parseISO } from 'date-fns';
import { formatInTimezone } from '@/modules/core/lib/date.utils';
import { fairnessLedgerQueries } from '../api/fairnessLedger.queries';
import type { FairnessStanding } from '../domain/fairness-ledger';

/** The recompute is nightly: two missed nights means the job is not running. */
export const LEDGER_STALE_AFTER_DAYS = 2;

/**
 * - `ok`          — standings found and recent.
 * - `stale`       — standings found but the nightly job has stopped. Still applied.
 * - `unavailable` — no standings: longitudinal fairness is NOT being applied.
 */
type FairnessLedgerStatus = 'ok' | 'stale' | 'unavailable';

interface FairnessLedgerRead {
    standings: FairnessStanding[];
    status: FairnessLedgerStatus;
    windowEnd: string | null;
    ageDays: number | null;
}

export const fairnessLedgerService = {
    async getStandingsWithStatus(
        organizationId: string,
        employeeIds: string[] | null,
        asOf = new Date(),
    ): Promise<FairnessLedgerRead> {
        if (employeeIds !== null && employeeIds.length === 0) {
            return { standings: [], status: 'ok', windowEnd: null, ageDays: null };
        }

        const standings = await fairnessLedgerQueries.getStandings(organizationId, employeeIds);
        if (standings.length === 0) {
            return { standings, status: 'unavailable', windowEnd: null, ageDays: null };
        }

        const windowEnd = standings.reduce((max, s) => (s.windowEnd > max ? s.windowEnd : max), standings[0].windowEnd);
        // Both sides are Sydney calendar dates — the ledger's window_end is one.
        const ageDays = differenceInCalendarDays(parseISO(formatInTimezone(asOf)), parseISO(windowEnd));
        return { standings, status: ageDays > LEDGER_STALE_AFTER_DAYS ? 'stale' : 'ok', windowEnd, ageDays };
    },
};
