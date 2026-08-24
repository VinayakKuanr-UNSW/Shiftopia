/**
 * Cross-source parity: the three KPI aggregates must count the same things.
 *
 * Three functions derive attendance and cancellation figures from
 * assignment_snapshots, at three different grains:
 *
 *   get_quarterly_performance_report  per employee, per quarter
 *   get_kpi_behaviour_summary         org-wide, collapsed over a window
 *   get_kpi_behaviour_trend           org-wide, grouped into buckets
 *
 * The whole point of writing the last two against the first's definitions is
 * that a tile, the chart under it and the per-employee table beneath that
 * cannot disagree. Nothing in TypeScript enforces that — the agreement lives
 * in SQL — so this test reads the migration source and pins the FILTER
 * expressions against each other.
 *
 * It is a source-reading test, so it strips SQL comments before matching:
 * a comment that merely *describes* a definition would otherwise satisfy an
 * assertion about the definition itself.
 */

import { describe, it, expect } from 'vitest';
import { analysisHref as analysisHrefSync } from '../metric-registry';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');

/** Strip `--` line comments so a comment can never satisfy a match. */
function stripSqlComments(sql: string): string {
    return sql
        .split('\n')
        .map((line) => line.replace(/--.*$/, ''))
        .join('\n');
}

function readMigration(fragment: string): string {
    const file = readdirSync(MIGRATIONS).find((f) => f.includes(fragment) && f.endsWith('.sql'));
    if (!file) throw new Error(`no migration matching "${fragment}"`);
    return stripSqlComments(readFileSync(join(MIGRATIONS, file), 'utf8'));
}

/**
 * The last CREATE ... FUNCTION block for `name` in a migration.
 *
 * Tolerates both dialects present in this repo: unquoted `public.fn` closed
 * with `$function$` (hand-written migrations) and quoted `"public"."fn"`
 * closed with `$$` (pg_dump-derived ones).
 */
function functionBody(sql: string, name: string): string {
    const re = new RegExp(
        `CREATE (?:OR REPLACE )?FUNCTION "?public"?\\."?${name}"?\\b[\\s\\S]*?\\$(?:function)?\\$[\\s\\S]*?\\$(?:function)?\\$`,
        'g',
    );
    const matches = sql.match(re);
    if (!matches?.length) throw new Error(`no body for ${name}`);
    return matches[matches.length - 1];
}

/** Collapse whitespace so formatting differences do not fail a match. */
const flat = (s: string) => s.replace(/\s+/g, ' ');

const report = flat(
    functionBody(readMigration('secure_quarterly_performance_report'), 'get_quarterly_performance_report'),
);
const summary = flat(
    functionBody(readMigration('standard_vs_critical_cancellations'), 'get_kpi_behaviour_summary'),
);
const trend = flat(
    functionBody(readMigration('kpi_trend_series'), 'get_kpi_behaviour_trend'),
);

/**
 * Each outcome, as the filter predicate every aggregate must use.
 * `end_reason` is the discriminator in all three.
 */
const OUTCOMES: Array<{ label: string; predicate: string }> = [
    { label: 'worked',               predicate: "end_reason = 'worked'" },
    { label: 'no-show',              predicate: "end_reason = 'no_show'" },
    { label: 'standard cancellation', predicate: "end_reason = 'dropped_std'" },
    { label: 'critical cancellation', predicate: "end_reason = 'dropped_late'" },
    { label: 'traded out',           predicate: "end_reason = 'traded_out'" },
];

describe('the three aggregates count the same outcomes', () => {
    it.each(OUTCOMES)('$label uses the same end_reason predicate everywhere', ({ predicate }) => {
        expect(report, 'get_quarterly_performance_report').toContain(predicate);
        expect(summary, 'get_kpi_behaviour_summary').toContain(predicate);
        expect(trend, 'get_kpi_behaviour_trend').toContain(predicate);
    });

    it('reads assignment_snapshots in all three, not a rival table', () => {
        for (const [name, body] of [
            ['report', report], ['summary', summary], ['trend', trend],
        ] as const) {
            expect(body, name).toContain('assignment_snapshots');
        }
    });
});

describe('punctuality is counted over WORKED shifts in every aggregate', () => {
    // Counting a punctuality flag over all held shifts instead of worked ones
    // silently deflates every rate by the no-show and cancellation volume.
    const FLAGS = ['late_in', 'early_out', 'on_time_in', 'on_time_out', 'auto_clock_out'];

    it.each(FLAGS)('%s is always paired with the worked filter', (flag) => {
        for (const [name, body] of [['summary', summary], ['trend', trend]] as const) {
            if (!body.includes(flag)) continue;
            const occurrences = body.match(
                new RegExp(`s\\.${flag}\\s+AND s\\.end_reason = 'worked'`, 'g'),
            );
            expect(occurrences, `${name}: ${flag} not scoped to worked shifts`).not.toBeNull();
        }
    });

    it('defines attendance compliance identically in summary and trend', () => {
        const compliance = "end_reason = 'worked' AND NOT s.late_in AND NOT s.early_out";
        expect(summary).toContain(compliance);
        expect(trend).toContain(compliance);
    });
});

describe('denominators', () => {
    it('rates cancellations and no-shows over HELD, and punctuality over WORKED', () => {
        // c_held is COUNT(*) — every episode with a terminal outcome.
        expect(summary).toContain('COUNT(*)::int AS c_held');
        expect(trend).toContain('COUNT(*)::int AS c_held');

        // Cancellation and no-show rates divide by held.
        expect(summary).toContain('a.c_no_show::numeric / a.c_held');
        expect(summary).toContain('a.c_std::numeric / a.c_held');
        expect(summary).toContain('a.c_critical::numeric / a.c_held');

        // Punctuality divides by worked.
        expect(summary).toContain('a.c_oti::numeric / a.c_worked');
        expect(summary).toContain('a.c_compliant::numeric / a.c_worked');
    });

    it('the trend uses the same denominators as the summary', () => {
        expect(trend).toContain('a.c_no_show::numeric / a.c_held');
        expect(trend).toContain('a.c_std::numeric / a.c_held');
        expect(trend).toContain('a.c_critical::numeric / a.c_held');
        expect(trend).toContain('a.c_compliant::numeric / a.c_worked');
    });
});

describe('the cancellation boundary is 24h, in SQL as well as in the registry', () => {
    it('the episodes view splits standard from critical at 24 hours', () => {
        const view = readMigration('cancellation_threshold_is_24h');
        // The migration patches the view from its own live definition, so the
        // interval literals appear SQL-escaped inside a replace() call rather
        // than as bare SQL. Assert on the substitution itself.
        expect(view).toMatch(/replace\(\s*v_def,\s*'''04:00:00''::interval',\s*'''24:00:00''::interval'\s*\)/);
        // The guard that makes the patch safe must survive too: it aborts
        // unless the 4h literal appears exactly once.
        expect(view).toMatch(/RAISE EXCEPTION[\s\S]*04:00:00/);
        // And it must restate security_invoker, which CREATE OR REPLACE VIEW
        // resets and pg_get_viewdef does not carry.
        expect(view).toContain('security_invoker = on');
    });

    it('the drop RPC cuts at 24h and keeps 4h only as the emergent band', () => {
        const drop = flat(
            functionBody(readMigration('standard_vs_critical_cancellations'), 'sm_employee_drop_shift'),
        );
        expect(drop).toContain("v_cancel_cutoff constant interval := interval '24 hours'");
        expect(drop).toContain("v_emergent_cutoff constant interval := interval '4 hours'");
        // The kind is decided by the 24h cutoff, never the emergent one.
        expect(drop).toContain('v_notice <= v_cancel_cutoff');
        expect(drop).toContain("'critical'");
        expect(drop).not.toContain("'urgent' ELSE 'standard'");
    });
});

describe('scope handling is identical across the KPI aggregates', () => {
    // A missing sub-department filter is invisible until someone narrows the
    // scope and only half the page moves — which is exactly what
    // get_insights_trend did before 20260823090100.
    const bodies = {
        summary,
        trend,
        marketplaceTrend: flat(
            functionBody(readMigration('kpi_trend_series'), 'get_kpi_marketplace_trend'),
        ),
        reasonBreakdown: flat(
            functionBody(readMigration('cancellation_reason_breakdown'), 'get_cancellation_reason_breakdown'),
        ),
    };

    it.each(Object.entries(bodies))('%s filters on all three scope levels', (_name, body) => {
        expect(body).toContain('organization_id = ANY(v_org_ids)');
        expect(body).toContain('department_id = ANY(v_dept_ids)');
        expect(body).toContain('sub_department_id = ANY(v_subdept_ids)');
    });

    it.each(Object.entries(bodies))('%s intersects the request with the caller scope', (_name, body) => {
        expect(body).toContain('is_manager_or_above()');
        expect(body).toContain('INTERSECT');
        // Manager flag with no resolved scope must return nothing, not everything.
        expect(body).toContain('IF array_length(v_allowed_org_ids, 1) IS NULL THEN RETURN; END IF;');
    });
});

describe('every drill-down link points at a branch that exists', () => {
    // Six tiles previously linked with the registry's snake_case ids while the
    // RPC branched on kebab-case ids of its own, so all six landed on the
    // "pending full database migration" fallback. This pins the contract from
    // both ends: the map's targets must be ids the SQL actually branches on.
    const analysisSql = [
        readMigration('metric_analysis_branches_for_kpi_tabs'),
        // The four original branches live in an earlier migration.
        ...readdirSync(MIGRATIONS)
            .filter((f) => f.endsWith('.sql'))
            .map((f) => stripSqlComments(readFileSync(join(MIGRATIONS, f), 'utf8')))
            .filter((sql) => sql.includes("p_metric_id = 'shift-fill-rate'")),
    ].join('\n');

    const branchIds = new Set(
        [...analysisSql.matchAll(/p_metric_id = '([a-z0-9-]+)'/g)].map((m) => m[1]),
    );

    it('the SQL defines the branches the UI expects', () => {
        for (const id of [
            'shift-fill-rate', 'no-show-rate',
            'attendance-compliance-rate', 'cancellation-rate',
            'open-shift-award-rate', 'swap-completion-rate',
        ]) {
            expect(branchIds, `missing branch: ${id}`).toContain(id);
        }
    });

    it('every metric the UI links from resolves to a real branch', async () => {
        const { analysisMetricId, analysisHref } = await import('../metric-registry');

        // The registry ids the tabs actually pass to analysisHref.
        const linked = [
            'shift_fill_rate', 'no_show_rate', 'attendance_compliance_rate',
            'cancel_rate', 'open_shift_fill_rate', 'trade_completion_rate',
        ];

        for (const id of linked) {
            const target = analysisMetricId(id);
            expect(target, `${id} has no analysis mapping`).not.toBeNull();
            expect(branchIds, `${id} maps to "${target}", which the SQL has no branch for`)
                .toContain(target!);
        }
    });

    it('carries the period so the analysis covers the tile’s quarter', () => {
        // Without it the drill-down defaulted to THIS_MONTH off the device clock.
        const href = analysisHrefSync('no_show_rate', 'Q3 2026');
        expect(href).toBe('/insights/no-show-rate?period=Q3%202026');
    });

    it('returns undefined for a metric with no branch, so no dead link renders', () => {
        expect(analysisHrefSync('bid_win_rate', 'Q3 2026')).toBeUndefined();
        expect(analysisHrefSync('not_a_metric', 'Q3 2026')).toBeUndefined();
    });
});
