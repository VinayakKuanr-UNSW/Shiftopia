#!/usr/bin/env node
/**
 * gen-eba-parity-sql.mjs — EBA engine parity (database half)
 * ────────────────────────────────────────────────────────────────────────────
 * There are two EBA rule engines: V8 in the app (src/modules/compliance/v8)
 * and internal.eba_evaluate in the database, which every shift write now
 * answers to. One answer key holds them together:
 *
 *   src/modules/compliance/__tests__/eba-parity/scenarios.json
 *
 * v8-parity.test.ts runs every scenario through V8 in CI. This script turns
 * the same scenarios into ONE query against internal.eba_evaluate, which is a
 * pure function of its arguments — no tables are seeded or touched.
 *
 * Usage:
 *   node scripts/gen-eba-parity-sql.mjs > eba-parity.sql
 *   then run it against the database (Supabase MCP execute_sql, or psql).
 *
 * The query returns one row per scenario the database DISAGREES with, then a
 * final "TOTAL scenarios" row. Only the total row means the engines agree.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, '../src/modules/compliance/__tests__/eba-parity/scenarios.json');

const literal = (text) => `'${String(text).replace(/'/g, "''")}'`;
const textArray = (ids) => (ids.length === 0 ? `ARRAY[]::text[]` : `ARRAY[${ids.map(literal).join(', ')}]::text[]`);

/**
 * One shift as a positional array, expanded back into eba_shifts' keys by the
 * query (UNPACK below). Packed because the query travels through an MCP call
 * and the long histories would otherwise make it ~75 KB.
 */
function packShift(shift, employee) {
    const flag = (v) => (v ? 1 : 0);
    return [
        shift.date, shift.start, shift.end,
        shift.unpaid ?? 0, shift.paid ?? 0, shift.meal ?? shift.unpaid ?? 0,
        flag(shift.training), flag(shift.multi_hire), flag(shift.salaried ?? employee.salaried), flag(shift.candidate),
    ];
}

const UNPACK = `(SELECT jsonb_agg(jsonb_build_object(
            'shift_date', a->>0, 'start_time', a->>1, 'end_time', a->>2,
            'unpaid_break_minutes', (a->>3)::int, 'paid_break_minutes', (a->>4)::int, 'meal_break_minutes', (a->>5)::int,
            'is_training', a->>6 = '1', 'is_multi_hire', a->>7 = '1', 'is_salaried', a->>8 = '1', 'is_candidate', a->>9 = '1'))
          FROM jsonb_array_elements(sc.packed) a)`;

/** Absent keys take eba_evaluate's defaults, so only the set ones travel. */
function toDbFacts(employee) {
    const facts = {
        contract_type: employee.contract_type,
        is_security:   employee.security,
        rest_gap_8h:   employee.rest_gap_8h,
        student_visa:  employee.student_visa,
        cycle_weeks:   employee.cycle_weeks,
    };
    return Object.fromEntries(Object.entries(facts).filter(([, v]) => v != null && v !== false));
}

const { scenarios } = JSON.parse(readFileSync(FIXTURE, 'utf8'));

const rows = scenarios.map((sc) => `  (${[
    literal(sc.name),
    `${literal(JSON.stringify(toDbFacts(sc.employee)))}::jsonb`,
    `${literal(JSON.stringify(sc.shifts.map((s) => packShift(s, sc.employee))))}::jsonb`,
    textArray(sc.blocking),
    textArray(sc.warning),
].join(', ')})`);

process.stdout.write(`WITH sc(name, facts, packed, exp_block, exp_warn) AS (VALUES
${rows.join(',\n')}
)
SELECT sc.name, g.got_block, sc.exp_block, g.got_warn, sc.exp_warn
  FROM sc
 CROSS JOIN LATERAL (
     WITH r AS (SELECT DISTINCT e.rule_id, e.tier FROM internal.eba_evaluate(sc.facts, ${UNPACK}) e)
     SELECT COALESCE((SELECT array_agg(r.rule_id ORDER BY r.rule_id COLLATE "C") FROM r WHERE r.tier = 'BLOCKING'), '{}') AS got_block,
            COALESCE((SELECT array_agg(r.rule_id ORDER BY r.rule_id COLLATE "C") FROM r WHERE r.tier = 'WARNING'), '{}') AS got_warn
 ) g
 WHERE g.got_block IS DISTINCT FROM sc.exp_block OR g.got_warn IS DISTINCT FROM sc.exp_warn
UNION ALL
SELECT 'TOTAL scenarios: ' || count(*), NULL, NULL, NULL, NULL FROM sc;
`);
