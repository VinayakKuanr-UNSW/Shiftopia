/**
 * V8 Compliance Engine — Legacy Bridge
 * 
 * Provides backward compatibility for components still using 
 * the single-shift validation pattern.
 */

import { ComplianceCheckInput, ComplianceResult } from './types';
import { runV8LegacyBridge } from './index';

/**
 * @deprecated Use runV8LegacyBridge directly from @/modules/compliance/v8
 */
export function runV8ComplianceCheck(input: ComplianceCheckInput): ComplianceResult[] {
    return runV8LegacyBridge(input);
}

/**
 * @deprecated Use runV8LegacyBridge directly from @/modules/compliance/v8
 */
export function checkV8Compliance(input: ComplianceCheckInput): ComplianceResult[] {
    return runV8LegacyBridge(input);
}

export function isV8ActionAllowed(input: ComplianceCheckInput): boolean {
    const results = runV8LegacyBridge(input);
    return !results.some(r => r.blocking);
}

export function getV8ComplianceSummary(results: ComplianceResult[]) {
    const failing = results.filter(r => r.status === 'fail');
    const warning = results.filter(r => r.status === 'warning');
    
    if (failing.length > 0) return 'BLOCKING';
    if (warning.length > 0) return 'WARNING';
    return 'PASS';
}
