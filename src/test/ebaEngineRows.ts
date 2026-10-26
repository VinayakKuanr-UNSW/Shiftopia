/**
 * Compliance tests speak in verdicts — `{ status, violations, warnings }`, the
 * ComplianceResult shape — while eba_check_assignment answers in rows. This
 * turns a mocked verdict response into the engine's rows, so a test can keep
 * saying "the engine refused, because X" and the real compliance service maps
 * it back. Errors (and thrown errors) pass through untouched.
 */
interface Verdict {
    status: string;
    violations?: string[];
    warnings?: string[];
}

const PASSED_ROW = {
    is_compliant: true, rule_id: null, rule_name: null, tier: null,
    summary: 'Passed', details: 'All EBA compliance checks passed.', payload: {},
};

export function engineRowsFor(response: { data: Verdict | null; error: unknown }): { data: unknown; error: unknown } {
    const verdict = response?.data;
    if (response?.error || !verdict) return response;

    const finding = (tier: 'BLOCKING' | 'WARNING') => (details: string) => ({
        is_compliant: tier !== 'BLOCKING', rule_id: 'V8_TEST_RULE', rule_name: 'Test rule',
        tier, summary: details, details, payload: {},
    });
    const rows = [
        ...(verdict.violations ?? []).map(finding('BLOCKING')),
        ...(verdict.warnings ?? []).map(finding('WARNING')),
    ];
    return { data: rows.length > 0 ? rows : [PASSED_ROW], error: null };
}
