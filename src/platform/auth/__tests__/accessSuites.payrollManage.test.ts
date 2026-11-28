/**
 * `allowsPayrollManageIn` — who may roll, publish and discard rate cards.
 *
 * Mirrors rbac_permissions for payroll.manage (zeta at ORG scope, migration
 * *_rate_cards_per_period). If the database matrix changes, this file changes
 * with it. The database is the authority; this only decides what to show.
 */
import { describe, expect, it } from 'vitest';
import { allowsPayrollManageIn } from '../accessSuites';
import type { AccessCertificate, AccessLevel } from '../types';

const ORG = 'org-1';
const OTHER = 'org-2';

function cert(level: AccessLevel, organizationId = ORG, isActive = true): AccessCertificate {
    return {
        id: `c-${level}-${organizationId}`,
        userId: 'u',
        certificateType: level === 'alpha' || level === 'beta' ? 'X' : 'Y',
        accessLevel: level,
        organizationId,
        departmentId: null,
        subDepartmentId: null,
        isActive,
    };
}

describe('allowsPayrollManageIn', () => {
    it('zeta in the organization may manage its cards', () => {
        expect(allowsPayrollManageIn([cert('zeta')], ORG)).toBe(true);
    });

    it.each(['alpha', 'beta', 'gamma', 'delta', 'epsilon'] as const)('%s may not', (level) => {
        expect(allowsPayrollManageIn([cert(level)], ORG)).toBe(false);
    });

    it('zeta of another organization may not (Administrator is per organization)', () => {
        expect(allowsPayrollManageIn([cert('zeta', OTHER), cert('epsilon', ORG)], ORG)).toBe(false);
    });

    it('a revoked zeta certificate does not count', () => {
        expect(allowsPayrollManageIn([cert('zeta', ORG, false)], ORG)).toBe(false);
    });

    it('no active organization, no management', () => {
        expect(allowsPayrollManageIn([cert('zeta')], null)).toBe(false);
        expect(allowsPayrollManageIn(undefined, ORG)).toBe(false);
    });
});
