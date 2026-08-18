import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
    RULE_REGISTRY,
    allRules,
    rulesForLayer,
    solverCoverageGaps,
    rulesWithKnownGaps,
} from '..';
import { V8_RULE_METADATA } from '../../v8/metadata';

/**
 * The registry is only worth having if it cannot drift from the code.
 *
 * Every hand-maintained rule table in this codebase has failed the same way: it
 * described rules that lived in another module, and nothing checked the two
 * agreed. `CONSTRAINT_TO_VIOLATION` dropped three BLOCKING rules through key
 * typos and one omission. `V8_RULE_METADATA` listed 12 rules against 19 emitted
 * and carried a phantom id the compliance panel reported as permanently passing.
 *
 * Neither failure produced an error. Both were invisible until someone read the
 * table beside the source. So these tests read the source: they scrape the rule
 * ids, names and severities the implementations actually emit and compare them
 * to the registry in BOTH directions.
 *
 * Scraping is deliberate. Importing the rule modules and invoking them would
 * only reveal rules that fire for the fixtures chosen, which is precisely the
 * blind spot — `V8_MAX_DAILY_ENGAGEMENTS` needs a casual with three same-day
 * engagements before it says anything. The source text names every rule
 * unconditionally.
 */

const V8_RULES_DIR = 'src/modules/compliance/v8/rules';
const SHAPE_EVALUATE = 'src/modules/compliance/shape/evaluate.ts';

/** `rule_id` / `rule_name` / `status` triples as literally written in source. */
function scrape(source: string, prefix: string): Map<string, { name: string; tier: string }> {
    const found = new Map<string, { name: string; tier: string }>();
    const re = new RegExp(
        `rule_id:\\s*'(${prefix}[A-Z_0-9]+)'\\s*,\\s*\\n` +
        `\\s*rule_name:\\s*'([^']+)'\\s*,\\s*\\n` +
        `\\s*status:\\s*'([A-Z]+)'`,
        'g',
    );
    for (const m of source.matchAll(re)) {
        found.set(m[1], { name: m[2], tier: m[3] });
    }
    return found;
}

function emittedV8(): Map<string, { name: string; tier: string }> {
    const all = new Map<string, { name: string; tier: string }>();
    for (const f of readdirSync(V8_RULES_DIR)) {
        if (!f.endsWith('.ts')) continue;
        for (const [id, v] of scrape(readFileSync(join(V8_RULES_DIR, f), 'utf8'), 'V8_')) {
            all.set(id, v);
        }
    }
    return all;
}

const emittedShape = () => scrape(readFileSync(SHAPE_EVALUATE, 'utf8'), 'SHAPE_');

describe('registry parity with the implementations', () => {
    it('registers every rule the V8 engine emits', () => {
        const missing = [...emittedV8().keys()].filter(id => !RULE_REGISTRY[id]);
        expect(missing, `V8 emits these but the registry does not list them: ${missing.join(', ')}`)
            .toEqual([]);
    });

    it('registers every rule the shape layer emits', () => {
        const missing = [...emittedShape().keys()].filter(id => !RULE_REGISTRY[id]);
        expect(missing, `shape emits these but the registry does not list them: ${missing.join(', ')}`)
            .toEqual([]);
    });

    it('lists no rule that no implementation emits', () => {
        // The failure that put a phantom `V8_MAX_CONSECUTIVE_DAYS` in the panel's
        // "Passed" column on every single evaluation.
        const emitted = new Set([...emittedV8().keys(), ...emittedShape().keys()]);
        const phantom = allRules().map(r => r.id).filter(id => !emitted.has(id));
        expect(phantom, `registered but never emitted: ${phantom.join(', ')}`).toEqual([]);
    });

    it('agrees with the source on every rule name', () => {
        const mismatches: string[] = [];
        for (const [id, { name }] of [...emittedV8(), ...emittedShape()]) {
            const spec = RULE_REGISTRY[id];
            if (spec && spec.name !== name) {
                mismatches.push(`${id}: source "${name}" vs registry "${spec.name}"`);
            }
        }
        expect(mismatches).toEqual([]);
    });

    it('agrees with the source on every severity', () => {
        const mismatches: string[] = [];
        for (const [id, { tier }] of [...emittedV8(), ...emittedShape()]) {
            const spec = RULE_REGISTRY[id];
            if (spec && spec.tier !== tier) {
                mismatches.push(`${id}: source ${tier} vs registry ${spec.tier}`);
            }
        }
        expect(mismatches).toEqual([]);
    });

    it('assigns each rule to the layer whose engine raises it', () => {
        for (const id of emittedShape().keys()) {
            expect(RULE_REGISTRY[id].layer, `${id} is raised by the shape layer`).toBe('SHAPE');
            expect(RULE_REGISTRY[id].engines.shape).toBe(true);
        }
        for (const id of emittedV8().keys()) {
            expect(RULE_REGISTRY[id].layer, `${id} is raised by V8`).toBe('LABOUR');
            expect(RULE_REGISTRY[id].engines.v8).toBe(true);
        }
    });
});

describe('V8_RULE_METADATA is a faithful projection', () => {
    it('covers every labour rule and nothing else', () => {
        expect(Object.keys(V8_RULE_METADATA).sort())
            .toEqual(rulesForLayer('LABOUR').map(r => r.id).sort());
    });

    it('never contains a shape rule', () => {
        // Bucket C treats anything here as a rule that can pass. A shape rule
        // never reaches that panel, so it would sit there permanently "passed".
        for (const r of rulesForLayer('SHAPE')) expect(V8_RULE_METADATA[r.id]).toBeUndefined();
    });

    it('routes qualification rules to the SKILL category', () => {
        // Bucket D is selected by `category === 'SKILL'`. V8_QUALIFICATION_EXPIRED
        // was missing from the old table, so its lookup returned undefined and the
        // hit rendered under blockers instead.
        expect(V8_RULE_METADATA.V8_QUALIFICATIONS.category).toBe('SKILL');
        expect(V8_RULE_METADATA.V8_QUALIFICATION_EXPIRED.category).toBe('SKILL');
    });
});

describe('cross-engine coverage is recorded, not assumed', () => {
    it('pins the labour rules the CP-SAT model does not implement', () => {
        // Each is a way the solver can propose a roster the labour layer rejects.
        // Pinned so the list cannot grow unnoticed — shrinking it means Phase 5
        // landed, and this expectation should shrink with it.
        expect(solverCoverageGaps().map(r => r.id).sort()).toEqual([
            'V8_CASUAL_SECURITY_ENGAGEMENT',
            'V8_DAILY_MEAL_BREAK',
            'V8_FT_DAYS_OFF',
            'V8_MULTI_HIRE_ELIGIBILITY',
            'V8_ORD_HOURS_CONTRACTED',
            'V8_ORD_HOURS_PEAK',
            'V8_SPLIT_SHIFT',
        ]);
    });

    it('pins the recorded divergences from the agreement', () => {
        expect(rulesWithKnownGaps().map(r => r.id).sort()).toEqual([
            'SHAPE_FT_MIN_DAY',
            'SHAPE_MEAL_BREAK',
            'SHAPE_MIN_ENGAGEMENT',
            'SHAPE_REST_PAUSE_1',
            'SHAPE_REST_PAUSE_2',
            'V8_CASUAL_SECURITY_ENGAGEMENT',
            'V8_DAILY_MEAL_BREAK',
            'V8_FT_DAYS_OFF',
        ]);
    });

    it('cites a clause wherever it claims EBA authority', () => {
        for (const r of allRules()) {
            if (r.authority.source === 'eba') {
                expect(r.authority.clauses.length, `${r.id} claims EBA authority`).toBeGreaterThan(0);
            } else {
                expect(r.authority.clauses, `${r.id} is not an EBA rule`).toEqual([]);
            }
        }
    });
});
