/**
 * rbac-ladder-consolidation.test.ts — the ladder stays in one place
 * ────────────────────────────────────────────────────────────────────────────
 * The access-level ladder (Zeta all/all/all, Epsilon one/all/all, Delta
 * one/one/all, Gamma one/one/one) was restated by hand in 16 RLS policies and
 * 19 functions. Delta was wrong in one of those copies for as long as it
 * existed — org-wide where it should have been department-scoped, behind the
 * gate for eighteen policies including INSERT/UPDATE/DELETE on `shifts` —
 * while three other copies had it right. Nobody noticed, because the UI agreed
 * with the correct copies.
 *
 * Phases 1–3 removed every inline ladder from the policy layer and collapsed
 * the five manager predicates onto one threshold. This test is what stops the
 * next one being written: a new migration may not create a policy that names an
 * access level unless it goes through `user_has_action_in_scope`.
 *
 * WHY A SOURCE-READING TEST AND NOT A DATABASE ASSERTION. vitest has no
 * database, so the live catalogue is out of reach here; `diag.rbac_ladder_
 * violations()` covers that side and has to be run against the database. What
 * CI *can* see is the migrations, and since migrations are the only way a
 * policy reaches production, guarding them guards the outcome. Same shape as
 * rate-schedule-sync.test.ts, which pins a DB migration against a TS constant.
 *
 * TWO THINGS THAT KEEP THIS FROM PASSING VACUOUSLY, both of which have burned
 * this repo before:
 *
 *   1. SQL COMMENTS ARE STRIPPED BEFORE MATCHING. The Phase 1–3 migrations
 *      quote the old IN-lists at length in their comment headers, explaining
 *      what was wrong with them. A matcher that reads comments would either
 *      flag those as violations or — far worse — be tuned until it stopped,
 *      and stop catching real ones too. A previous test in this repo passed
 *      against the comment describing the bug it was meant to catch.
 *
 *   2. THE DETECTOR IS TESTED AGAINST A KNOWN-BAD SAMPLE. The guard below only
 *      inspects migrations at or after CUTOFF, and there are none yet, so on
 *      its own it would pass whatever it did. The synthetic cases prove it can
 *      still tell a violation from a compliant policy.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../../../../supabase/migrations');

/**
 * Migrations from this version onward must not inline the ladder. Everything
 * before it is history: it contains the copies Phases 1–3 removed, and
 * rewriting applied migrations is not a thing that can be done.
 */
const CUTOFF = '20260825190000';

/** The four levels that only ever appear in a ladder. */
const LEVEL_LITERAL = /'(gamma|delta|epsilon|zeta)'/;

/**
 * Remove `-- line` and block comments so the matcher sees only executable SQL.
 * Load-bearing, not tidiness — see the header.
 */
export function stripSqlComments(sql: string): string {
    return sql
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/--[^\n]*/g, ' ');
}

/** Every `CREATE POLICY …;` statement in a migration, comments already gone. */
export function createPolicyStatements(sql: string): string[] {
    const bare = stripSqlComments(sql);
    const out: string[] = [];
    const re = /CREATE\s+POLICY[\s\S]*?;/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(bare)) !== null) out.push(m[0]);
    return out;
}

/**
 * A policy violates the rule when it decides something from an access level
 * without asking the gate. Naming a level while calling
 * `user_has_action_in_scope` is fine — that is what a scoped exception looks
 * like — and naming none at all is trivially fine.
 */
export function violatesLadderRule(statement: string): boolean {
    if (!/access_level/i.test(statement)) return false;
    if (!LEVEL_LITERAL.test(statement)) return false;
    return !/user_has_action_in_scope/i.test(statement);
}

function migrationFiles(): string[] {
    return readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort();
}

describe('the ladder is stated once', () => {
    // ── the detector itself ──────────────────────────────────────────────
    it('catches a policy that inlines the ladder', () => {
        const bad = `
            CREATE POLICY managers_read_thing ON public.thing
                AS PERMISSIVE FOR SELECT TO authenticated
                USING (EXISTS (SELECT 1 FROM app_access_certificates ac
                                WHERE ac.user_id = auth.uid()
                                  AND ac.access_level IN ('gamma','delta','epsilon','zeta')));
        `;
        expect(createPolicyStatements(bad)).toHaveLength(1);
        expect(violatesLadderRule(createPolicyStatements(bad)[0])).toBe(true);
    });

    it('clears a policy that goes through the gate', () => {
        const good = `
            CREATE POLICY managers_read_thing ON public.thing
                AS PERMISSIVE FOR SELECT TO authenticated
                USING (public.user_has_action_in_scope(
                        'shift.view', thing.organization_id,
                        thing.department_id, thing.sub_department_id));
        `;
        expect(violatesLadderRule(createPolicyStatements(good)[0])).toBe(false);
    });

    it('clears a policy that names no level at all', () => {
        const neutral = `
            CREATE POLICY own_rows ON public.thing
                FOR SELECT TO authenticated USING (employee_id = auth.uid());
        `;
        expect(violatesLadderRule(createPolicyStatements(neutral)[0])).toBe(false);
    });

    // THE ONE THAT MATTERS. A migration explaining a ladder it is removing
    // quotes that ladder in its header. Reading comments would flag the fix as
    // the defect.
    it('does not read the ladder out of a comment', () => {
        const documented = `
            -- Replaces: ac.access_level IN ('gamma','delta','epsilon','zeta')
            /* The old rule named 'epsilon' and 'zeta' explicitly. */
            CREATE POLICY managers_read_thing ON public.thing
                FOR SELECT TO authenticated
                USING (public.user_has_action_in_scope('shift.view', thing.organization_id, NULL, NULL));
        `;
        const statements = createPolicyStatements(documented);
        expect(statements).toHaveLength(1);
        expect(violatesLadderRule(statements[0])).toBe(false);
    });

    it('still sees a violation that sits below a comment', () => {
        const sneaky = `
            -- this policy goes through user_has_action_in_scope, honest
            CREATE POLICY managers_read_thing ON public.thing
                FOR SELECT TO authenticated
                USING (EXISTS (SELECT 1 FROM app_access_certificates ac
                                WHERE ac.access_level >= 'gamma'));
        `;
        expect(violatesLadderRule(createPolicyStatements(sneaky)[0])).toBe(true);
    });

    // ── the guard ────────────────────────────────────────────────────────
    it('finds the migrations directory and the historical copies in it', () => {
        const files = migrationFiles();
        expect(files.length).toBeGreaterThan(100);

        // Sanity: the pre-cutoff history really does contain inline ladders, so
        // a green result after the cutoff means the rule holds rather than that
        // the matcher never matches anything.
        const historical = files
            .filter((f) => f < CUTOFF)
            .flatMap((f) =>
                createPolicyStatements(readFileSync(resolve(MIGRATIONS_DIR, f), 'utf8')),
            )
            .filter(violatesLadderRule);
        expect(historical.length).toBeGreaterThan(0);
    });

    it('no migration at or after the cutoff inlines the ladder', () => {
        const offenders: string[] = [];

        for (const file of migrationFiles()) {
            if (basename(file) < CUTOFF) continue;
            const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
            for (const statement of createPolicyStatements(sql)) {
                if (violatesLadderRule(statement)) {
                    // Quoted names exist in this schema ("Managers can view all shift
                    // events"), so match a quoted string OR a bare identifier —
                    // not `[\w ]+`, which swallows the ` ON public` that follows.
                    const name = statement.match(/CREATE\s+POLICY\s+("[^"]+"|\w+)/i)?.[1] ?? '?';
                    offenders.push(`${file} → ${name}`);
                }
            }
        }

        expect(
            offenders,
            'A new policy decides access from a level without calling '
            + 'user_has_action_in_scope. Put the rule in rbac_permissions and ask the gate, '
            + 'or — if the table genuinely cannot reach an organization, as demand_templates '
            + 'cannot — say so in a COMMENT ON TABLE and add it to the exceptions here.',
        ).toEqual([]);
    });
});
