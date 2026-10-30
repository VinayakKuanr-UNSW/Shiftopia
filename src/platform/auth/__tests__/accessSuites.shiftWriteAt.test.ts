/**
 * `allowsShiftWriteAt` — the place-aware write check.
 *
 * Mirrors rbac_permissions for shift.publish / create / assign / roster.edit
 * (gamma: SUB_DEPT, zeta: global). If the database matrix changes, this file
 * changes with it. The case that motivated it: gamma in one sub-department and
 * delta in another — the page enabled Publish for both, and the server refused
 * the whole batch.
 */
import { describe, expect, it } from 'vitest';
import { allowsShiftWriteAt } from '../accessSuites';
import type { AccessCertificate, AccessLevel } from '../types';

const ORG = 'org-1';
const SUB_A = 'sub-a';
const SUB_B = 'sub-b';

function cert(level: AccessLevel, place: Partial<AccessCertificate> = {}, isActive = true): AccessCertificate {
    return {
        id: `c-${level}-${place.subDepartmentId ?? 'x'}`,
        userId: 'u',
        certificateType: level === 'alpha' || level === 'beta' ? 'X' : 'Y',
        accessLevel: level,
        organizationId: ORG,
        departmentId: 'dept-1',
        subDepartmentId: null,
        isActive,
        ...place,
    };
}

describe('allowsShiftWriteAt', () => {
    it('gamma may write in its own sub-department, and only there', () => {
        const certs = [cert('gamma', { subDepartmentId: SUB_A })];
        expect(allowsShiftWriteAt(certs, { organizationId: ORG, subDepartmentId: SUB_A })).toBe(true);
        expect(allowsShiftWriteAt(certs, { organizationId: ORG, subDepartmentId: SUB_B })).toBe(false);
    });

    it('gamma in one place and delta in another: write in the first, view-only in the second', () => {
        const certs = [
            cert('gamma', { subDepartmentId: SUB_A }),
            cert('delta', { subDepartmentId: null, departmentId: 'dept-2' }),
        ];
        expect(allowsShiftWriteAt(certs, { organizationId: ORG, subDepartmentId: SUB_A })).toBe(true);
        expect(allowsShiftWriteAt(certs, { organizationId: ORG, subDepartmentId: SUB_B })).toBe(false);
    });

    it('delta and epsilon never write', () => {
        for (const level of ['delta', 'epsilon'] as const) {
            const certs = [cert(level, { subDepartmentId: SUB_A })];
            expect(allowsShiftWriteAt(certs, { organizationId: ORG, subDepartmentId: SUB_A })).toBe(false);
        }
    });

    it('zeta writes anywhere, even in another organisation', () => {
        const certs = [cert('zeta')];
        expect(allowsShiftWriteAt(certs, { organizationId: 'other-org', subDepartmentId: SUB_B })).toBe(true);
    });

    it('gamma cannot write a shift with no sub-department (SQL NULL matches nothing)', () => {
        const certs = [cert('gamma', { subDepartmentId: null })];
        expect(allowsShiftWriteAt(certs, { organizationId: ORG, subDepartmentId: null })).toBe(false);
    });

    it('gamma in the same sub-department id but another organisation does not write', () => {
        const certs = [cert('gamma', { subDepartmentId: SUB_A, organizationId: 'other-org' })];
        expect(allowsShiftWriteAt(certs, { organizationId: ORG, subDepartmentId: SUB_A })).toBe(false);
    });

    it('an inactive certificate grants nothing', () => {
        const certs = [cert('zeta', {}, false), cert('gamma', { subDepartmentId: SUB_A }, false)];
        expect(allowsShiftWriteAt(certs, { organizationId: ORG, subDepartmentId: SUB_A })).toBe(false);
    });
});
