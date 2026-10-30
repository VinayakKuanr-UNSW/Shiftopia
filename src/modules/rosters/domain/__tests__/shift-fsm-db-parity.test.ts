import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getShiftFSMState } from '../shift-fsm';

/**
 * The browser and the database must agree on a shift's state.
 *
 * The cards and every screen read state through `getShiftFSMState`; the
 * database's write guard and the sm_* functions read it through
 * `get_shift_fsm_state()`. `fsm-db-snapshot.json` is the database's answer for
 * every combination of the state columns its constraints and write guard allow
 * (`scripts/db/fsm-parity-snapshot.sql`). Regenerate it after changing
 * `get_shift_fsm_state()`, and change `getShiftFSMState` to match.
 */

// From a string, not `new URL(…)`: the jsdom environment replaces the global URL.
const SNAPSHOT = resolve(dirname(fileURLToPath(import.meta.url)), 'fsm-db-snapshot.json');

interface DbRow {
    lifecycle: string;
    assignment: string;
    outcome: string | null;
    trading: string;
    cancelled: boolean;
    bidding: string;
    state: string;
}

const rows = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as DbRow[];

describe('getShiftFSMState matches the database', () => {
    it('reads the snapshot (guards against an empty file)', () => {
        expect(rows.length).toBeGreaterThan(300);
    });

    it('gives the same state for every combination the database allows', () => {
        const mismatches = rows
            .map((r) => ({
                r,
                client: getShiftFSMState({
                    lifecycle_status: r.lifecycle,
                    assignment_status: r.assignment,
                    assignment_outcome: r.outcome,
                    trading_status: r.trading,
                    is_cancelled: r.cancelled,
                }),
            }))
            .filter(({ r, client }) => client !== r.state)
            .map(({ r, client }) =>
                `${r.lifecycle}/${r.assignment}/${r.outcome ?? 'NULL'}/${r.trading}/cancelled=${r.cancelled}/${r.bidding}: ` +
                `database ${r.state}, browser ${client}`);
        expect(mismatches).toEqual([]);
    });
});
