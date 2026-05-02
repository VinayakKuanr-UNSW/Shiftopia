/**
 * Demand Engine L3 — applies_when matcher.
 *
 * The applies_when JSON predicate is a flat object whose keys are
 * EventFeatureForRules fields. Values support these forms:
 *
 *   literal:           {"service_type":"buffet","alcohol":true}
 *   comparator string: {"pax":">300"}      // operators: > >= < <=
 *   between:           {"pax":"between:100,300"}  // inclusive
 *   in-list:           {"event_type":"in:Conference,Gala"}
 *
 * Empty object means "always applies".
 */

import type { EventFeatureForRules } from './ruleEngine.types';

export function ruleApplies(
    appliesWhen: Record<string, unknown>,
    feature: EventFeatureForRules,
): boolean {
    const keys = Object.keys(appliesWhen);
    if (keys.length === 0) return true;

    for (const key of keys) {
        const matchValue = appliesWhen[key];
        const featureValue = (feature as unknown as Record<string, unknown>)[key];
        if (!checkOne(matchValue, featureValue)) return false;
    }
    return true;
}

function checkOne(matchValue: unknown, featureValue: unknown): boolean {
    if (typeof matchValue === 'string') {
        if (matchValue.startsWith('>=')) return numeric(featureValue) >= parseFloat(matchValue.slice(2));
        if (matchValue.startsWith('<=')) return numeric(featureValue) <= parseFloat(matchValue.slice(2));
        if (matchValue.startsWith('>'))  return numeric(featureValue) >  parseFloat(matchValue.slice(1));
        if (matchValue.startsWith('<'))  return numeric(featureValue) <  parseFloat(matchValue.slice(1));
        if (matchValue.startsWith('between:')) {
            const [lo, hi] = matchValue.slice('between:'.length).split(',').map((s) => parseFloat(s.trim()));
            const n = numeric(featureValue);
            return n >= lo && n <= hi;
        }
        if (matchValue.startsWith('in:')) {
            const opts = matchValue.slice('in:'.length).split(',').map((s) => s.trim());
            return opts.includes(String(featureValue));
        }
        return String(featureValue) === matchValue;
    }
    if (typeof matchValue === 'number' || typeof matchValue === 'boolean') {
        return featureValue === matchValue;
    }
    if (matchValue === null) return featureValue === null;
    return false;
}

function numeric(v: unknown): number {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : NaN;
    }
    return NaN;
}
