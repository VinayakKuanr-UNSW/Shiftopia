/**
 * Compliance Bucket Mapper
 *
 * Maps v2 RuleHitV2[] + RULE_METADATA to display buckets A/B/C/D.
 *
 * A = Blockers (BLOCKING severity hits, excluding SKILL category)
 * B = Warnings (WARNING severity hits, excluding SKILL category)
 * C = Passed (rules in RULE_METADATA that produced NO hits)
 * D = System/Quals (SKILL category hits — role contract, qualifications, expiry)
 */

import type { RuleHitV2 } from '@/modules/compliance/v2/types';
import { RULE_METADATA } from '@/modules/compliance/v2/rules/registry';

export interface BucketMap {
    A: RuleHitV2[];    // blockers
    B: RuleHitV2[];    // warnings
    C: PassedRule[];   // passed
    D: RuleHitV2[];    // system / qualifications
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
 * AND to ensure they don't block the panel's canProceed logic if they are warnings.
 */
export const UI_VALIDATED_RULES = new Set(['R08_MEAL_BREAK']);

export function classifyBuckets(hits: RuleHitV2[]): BucketMap {
    const A: RuleHitV2[] = [];
    const B: RuleHitV2[] = [];
    const D: RuleHitV2[] = [];

    // Filter hits and tracks IDs for Passed logic
    const filteredHits = hits.filter(h => !UI_VALIDATED_RULES.has(h.rule_id));
    const hitRuleIds = new Set(filteredHits.map(h => h.rule_id.toUpperCase()));

    for (const hit of filteredHits) {
        const ruleIdUpper = hit.rule_id.toUpperCase();
        const meta = RULE_METADATA[ruleIdUpper] ?? RULE_METADATA[hit.rule_id];
        if (meta && SYSTEM_CATEGORIES.has(meta.category)) {
            D.push(hit);
        } else if (hit.severity === 'BLOCKING') {
            A.push(hit);
        } else {
            B.push(hit);
        }
    }

    // Passed = all known rules that produced no hits AND aren't UI-validated
    const C: PassedRule[] = Object.values(RULE_METADATA)
        .filter(meta => !hitRuleIds.has(meta.rule_id.toUpperCase()) && !UI_VALIDATED_RULES.has(meta.rule_id))
        .map(meta => ({
            rule_id:     meta.rule_id,
            description: meta.description,
            category:    meta.category,
        }));

    return { A, B, C, D };
}

export function getBucketSummary(buckets: BucketMap): BucketSummary {
    return {
        blockers:    buckets.A.length,
        warnings:    buckets.B.length,
        passed:      buckets.C.length,
        systemFails: buckets.D.filter(h => h.severity === 'BLOCKING').length,
    };
}
