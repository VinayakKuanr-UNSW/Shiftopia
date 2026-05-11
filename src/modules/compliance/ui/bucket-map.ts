/**
 * V8 Compliance Bucket Mapper
 *
 * Maps V8Hit[] + V8_RULE_METADATA to display buckets A/B/C/D.
 *
 * A = Blockers (BLOCKING status hits, excluding SKILL category)
 * B = Warnings (WARNING status hits, excluding SKILL category)
 * C = Passed (rules in V8_RULE_METADATA that produced NO hits)
 * D = System/Quals (SKILL category hits — role contract, qualifications, expiry)
 */

import type { V8Hit } from '@/modules/compliance/v8';
import { V8_RULE_METADATA } from '@/modules/compliance/v8';

export interface BucketMap {
    A: V8Hit[];    // blockers
    B: V8Hit[];    // warnings
    C: PassedRule[];   // passed
    D: V8Hit[];    // system / qualifications
}

export interface PassedRule {
    rule_id:     string;
    description: string;
    category:    string;
}

export interface BucketSummary {
    blockers:    number;
    warnings:    number;
    passed:      number;
    systemFails: number;
}

/** Rules with these categories always go to Bucket D regardless of severity */
const SYSTEM_CATEGORIES = new Set(['SKILL']);

/**
 * Rules whose feedback is surfaced directly in the form UI (Timings section).
 * These are excluded from the compliance panel to avoid duplicate / confusing messaging
 */
export const UI_VALIDATED_RULES = new Set(['V8_MEAL_BREAK']);

export function classifyBuckets(hits: V8Hit[]): BucketMap {
    const A: V8Hit[] = [];
    const B: V8Hit[] = [];
    const D: V8Hit[] = [];

    const filteredHits = hits.filter(h => !UI_VALIDATED_RULES.has(h.rule_id));
    const hitRuleIds = new Set(filteredHits.map(h => h.rule_id.toUpperCase()));

    for (const hit of filteredHits) {
        const ruleIdUpper = hit.rule_id.toUpperCase();
        const meta = V8_RULE_METADATA[ruleIdUpper] ?? V8_RULE_METADATA[hit.rule_id];
        if (meta && SYSTEM_CATEGORIES.has(meta.category)) {
            D.push(hit);
        } else if (hit.status === 'BLOCKING') {
            A.push(hit);
        } else {
            B.push(hit);
        }
    }

    const C: PassedRule[] = Object.values(V8_RULE_METADATA)
        .filter(meta => !hitRuleIds.has(meta.id.toUpperCase()) && !UI_VALIDATED_RULES.has(meta.id))
        .map(meta => ({
            rule_id:     meta.id,
            description: meta.description,
            category:    meta.category,
        }));

    return { A, B, C, D };
}

export function getV8BucketSummary(buckets: BucketMap): BucketSummary {
    return {
        blockers:    buckets.A.length,
        warnings:    buckets.B.length,
        passed:      buckets.C.length,
        systemFails: buckets.D.filter(h => h.status === 'BLOCKING').length,
    };
}

export { getV8BucketSummary as getBucketSummary };
