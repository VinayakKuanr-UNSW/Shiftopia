/**
 * Security role identification — EBA Schedule 3.
 *
 * Schedule 3 §1.1 makes the schedule prevail over the Agreement wherever the two
 * conflict, and it conflicts in several places the codebase cares about: meal
 * breaks are PAID (§3.2(a), §5.3(a),(c)), the ordinary-hours envelope is 42h
 * averaged over 8 weeks rather than 38h over 4 (§3.1), and the annualised rate
 * replaces the general classification rate.
 *
 * Every one of those depends on the same fact — is this a Security role? — and
 * that fact had SIXTEEN separate implementations spread across thirteen files:
 * cost projection, the pay engine, the AutoScheduler, the compliance employee
 * context, four different card components, the leave API and the payroll export.
 * Fourteen wrote `.toLowerCase().includes('security')`, two wrote
 * `/security/i.test(...)`, and they disagreed on null handling — some returned
 * `false`, some returned `undefined`, which is falsy but not the same value once
 * it reaches a `??` guard downstream.
 *
 * That is the shape of every drift bug in this system: a rule with no owner, so
 * each caller keeps its own copy and nothing notices when they diverge. This
 * module is the owner.
 *
 * WHY A NAME MATCH. There is no `is_security` column on `roles`, and no category
 * or `forecasting_bucket` value that separates them — the name is the only signal
 * the schema carries. In production it is a clean one: 24 of 200 roles match, and
 * all 24 are genuine Security roles ("Security Officer", "Security Team Member
 * Level 3", "Senior Security Manager", …) with no false positives. If a
 * discriminating column is ever added, this is the single place that changes.
 */

/**
 * True when a role name denotes a Security role under EBA Schedule 3.
 *
 * Returns a plain `false` for null, undefined and empty names rather than
 * `undefined`, so callers can use the result directly in a `??` chain without
 * the absent-name case silently falling through to a default.
 */
export function isSecurityRoleName(name: string | null | undefined): boolean {
    return typeof name === 'string' && name.toLowerCase().includes('security');
}

/** The subset of `roles` rows denoting Security, as an id set for `.has()` lookups. */
export function securityRoleIdSet(
    roles: ReadonlyArray<{ id?: string | null; name?: string | null }>,
): Set<string> {
    const ids = new Set<string>();
    for (const r of roles) {
        if (r?.id && isSecurityRoleName(r.name)) ids.add(r.id);
    }
    return ids;
}
