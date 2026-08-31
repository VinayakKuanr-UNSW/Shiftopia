/**
 * The two digests Baseline FT relies on, and the difference between them.
 *
 * `snapshotVersion` answers "has the roster moved since I read it?" — it is a
 * CONCURRENCY check, recomputed at Apply and compared against what Generate
 * stored. `inputDigest` answers "were these the same inputs?" — it is a
 * DETERMINISM check, and equal digests must imply identical proposals.
 *
 * Neither is a security primitive. Both are change detectors over data the
 * caller already holds, so a fast non-cryptographic hash is the right tool:
 * FNV-1a, the same family already used for the compliance cache keys. What
 * matters far more than hash strength is CANONICALISATION — two reads of the
 * same rows must produce the same string before hashing, whatever order
 * PostgREST happened to return them in, or the digest reports a change that
 * never happened and Apply refuses work it should have done.
 */

/**
 * FNV-1a, 64-bit, as lowercase hex.
 *
 * 64 bits rather than 32 because these digests are compared for EQUALITY to
 * decide whether to write: a collision at 32 bits would silently let Apply
 * proceed against a roster that had changed. BigInt keeps the arithmetic exact
 * — the same loop in Number would lose precision past 2^53 and quietly stop
 * being a hash.
 */
export function fnv1a64(input: string): string {
    const PRIME = 1099511628211n;
    const MASK = 0xffffffffffffffffn;
    let hash = 14695981039346656037n;
    for (let i = 0; i < input.length; i++) {
        hash ^= BigInt(input.charCodeAt(i));
        hash = (hash * PRIME) & MASK;
    }
    return hash.toString(16).padStart(16, '0');
}

/**
 * Deterministic JSON: object keys sorted at every depth, arrays left in the
 * order given.
 *
 * Array order is preserved deliberately. For a list the CALLER has sorted (as
 * both functions below do) the order is meaningful and sorting again would be
 * wasted work; for a list the caller has not sorted, silently reordering it
 * here would hide a real difference between two inputs.
 */
export function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** The minimum a shift must expose for the snapshot to detect a change to it. */
export interface SnapshotShiftRef {
    id: string;
    version: number;
}

/**
 * Digest of the roster as it was read.
 *
 * Carries `version` as well as `id` so an EDIT is detected, not merely an
 * insert or delete — `shifts.version` is bumped by the mutation gateway on
 * every change, which is what makes it a usable change token here. Sorted by
 * id so two reads of the same roster agree regardless of row order.
 */
export function snapshotVersion(shifts: readonly SnapshotShiftRef[]): string {
    const canonical = [...shifts]
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map(s => `${s.id}:${s.version}`)
        .join('|');
    return fnv1a64(`v1|${shifts.length}|${canonical}`);
}

/** Everything that must be identical for two runs to be the same run. */
export interface InputDigestParts {
    subDepartmentId: string;
    periodStart: string;
    periodEnd: string;
    /**
     * The `baseline_ft_patterns` rows the proposal was built from.
     *
     * There is no `templateId` any more: patterns are per-employee, so the
     * pattern IS these rows rather than a pointer to a shared template. Sorting
     * by id below is what keeps two identical reads from digesting differently.
     */
    patternSlots: ReadonlyArray<Record<string, unknown>>;
    /** One entry per eligible employee: contract facts that steer the result. */
    employees: ReadonlyArray<Record<string, unknown>>;
    /** Roster snapshot at read time. */
    snapshotVersion: string;
    /** Engine configuration that could change a verdict. */
    config: Record<string, unknown>;
}

/**
 * Digest of the resolved inputs.
 *
 * Includes `snapshotVersion`, so a run against a changed roster is a DIFFERENT
 * run even when the contracts and pattern are untouched — which is correct:
 * the existing shifts are an input to the deficit, so a different roster is a
 * different question. Employees and slots are sorted by id so PostgREST's row
 * order cannot make two identical reads look different.
 */
export function inputDigest(parts: InputDigestParts): string {
    const byId = (a: Record<string, unknown>, b: Record<string, unknown>) => {
        const x = String(a.id ?? '');
        const y = String(b.id ?? '');
        return x < y ? -1 : x > y ? 1 : 0;
    };
    return fnv1a64(canonicalJson({
        v: 1,
        subDepartmentId: parts.subDepartmentId,
        periodStart: parts.periodStart,
        periodEnd: parts.periodEnd,
        patternSlots: [...parts.patternSlots].sort(byId),
        employees: [...parts.employees].sort(byId),
        snapshotVersion: parts.snapshotVersion,
        config: parts.config,
    }));
}
