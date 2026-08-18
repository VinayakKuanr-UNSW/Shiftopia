/**
 * V8 Compliance Engine — Rule Metadata
 *
 * DERIVED VIEW. The source of truth is `@/modules/compliance/registry`; this
 * module projects the LABOUR-layer rules into the shape the compliance panel and
 * the orchestrator's aggregator already consume. Do not add entries here.
 *
 * It used to be a hand-maintained table, and it had drifted the way every such
 * table does. It listed 12 rules while V8 emitted 19, and one of the 12 —
 * `V8_MAX_CONSECUTIVE_DAYS` — was an id no rule has ever raised. Two live
 * consequences, both in `ui/bucket-map.ts`:
 *
 *   • Bucket C ("Passed") is built from `Object.values(V8_RULE_METADATA)`, so
 *     the phantom id was reported as a passing rule on every evaluation, while
 *     the eight real rules missing from the table could never appear as passed.
 *
 *   • Bucket D ("System / Quals") is chosen by `category === 'SKILL'`. With
 *     `V8_QUALIFICATION_EXPIRED` absent, its metadata lookup returned undefined
 *     and an expired-qualification hit fell through to bucket A instead.
 *
 * Deriving fixes both, and `registry/__tests__/registry-parity.test.ts` makes the
 * drift impossible to reintroduce: a rule V8 emits that is not registered fails
 * the build, and vice versa.
 */

import { RULE_REGISTRY } from '../registry/rules';
import type { RuleSpec } from '../registry/types';

/** The five categories this projection can express. `STRUCTURE` is shape-only. */
const V8_CATEGORIES = ['TIME', 'LEGAL', 'CONTRACT', 'SKILL', 'AVAILABILITY'] as const;

export type V8RuleCategory = (typeof V8_CATEGORIES)[number];

export interface V8RuleMeta {
    id:          string;
    name:        string;
    category:    V8RuleCategory;
    description: string;
}

function isV8Category(c: RuleSpec['category']): c is V8RuleCategory {
    return (V8_CATEGORIES as readonly string[]).includes(c);
}

/**
 * Every LABOUR-layer rule, keyed by id.
 *
 * Shape rules are excluded on purpose: they are decided at shift creation and
 * their findings are rendered by the form, never reaching the compliance panel
 * this feeds. Including them would put permanently-"passed" rows in bucket C —
 * the same class of lie the phantom id used to tell.
 */
export const V8_RULE_METADATA: Record<string, V8RuleMeta> = Object.freeze(
    Object.fromEntries(
        Object.values(RULE_REGISTRY)
            .filter(r => r.layer === 'LABOUR')
            .filter(r => isV8Category(r.category))
            .map(r => [r.id, {
                id:          r.id,
                name:        r.name,
                category:    r.category as V8RuleCategory,
                description: r.description,
            }]),
    ),
);
