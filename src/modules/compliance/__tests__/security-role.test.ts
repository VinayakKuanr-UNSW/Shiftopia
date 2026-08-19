import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { isSecurityRoleName, securityRoleIdSet } from '../security-role';

/**
 * One owner for "is this a Security role?".
 *
 * EBA Schedule 3 prevails over the Agreement for these roles (§1.1), changing
 * the meal break from unpaid to paid, the ordinary-hours envelope from 38h/4wk
 * to 42h/8wk, and the rate to the annualised one. Every consumer of those
 * differences needs the same answer to the same question, and until now
 * EIGHTEEN call sites across thirteen files each answered it themselves —
 * cost projection, the pay engine, payroll export, the AutoScheduler, the
 * compliance employee context, four card components, the leave API.
 *
 * They had already begun to diverge on null handling. That is the whole failure
 * mode this consolidation exists to stop, so it is worth a test rather than a
 * comment.
 */

describe('isSecurityRoleName', () => {
    it('matches the production Security roles', () => {
        // Verbatim from `roles` — 24 of 200 rows match, and all 24 are genuine.
        for (const name of [
            'Security Officer', 'Senior Security Officer', 'Security Supervisor',
            'Security Manager', 'Senior Security Manager', 'Director Security',
            'Security Assistant', 'Security Trainee',
            'Security Team Member Level 3', 'Security - Frontline / Casual',
            'Security - Level 0 - Entry', 'Security - Skilled Frontline',
        ]) {
            expect(isSecurityRoleName(name), name).toBe(true);
        }
    });

    it('does not match the general roles', () => {
        for (const name of ['Team Member', 'Team Leader', 'TM3', 'Chef de Partie', 'Concierge']) {
            expect(isSecurityRoleName(name), name).toBe(false);
        }
    });

    it('is case-insensitive', () => {
        expect(isSecurityRoleName('SECURITY OFFICER')).toBe(true);
        expect(isSecurityRoleName('security')).toBe(true);
    });

    it('returns false — not undefined — for an absent name', () => {
        // The divergence that made this worth owning. Several old copies were
        // `roleName?.toLowerCase().includes('security')`, which yields `undefined`
        // for a null role. Falsy, but not the same value: downstream it survives
        // a `?? true` guard that `false` would stop.
        for (const absent of [null, undefined, '']) {
            expect(isSecurityRoleName(absent)).toBe(false);
            expect(isSecurityRoleName(absent)).not.toBeUndefined();
        }
    });
});

describe('securityRoleIdSet', () => {
    it('keeps only Security rows, and only those with an id', () => {
        const set = securityRoleIdSet([
            { id: 'a', name: 'Security Officer' },
            { id: 'b', name: 'Team Member' },
            { id: null, name: 'Security Manager' },
            { id: 'd', name: null },
        ]);
        expect([...set]).toEqual(['a']);
    });
});

describe('the predicate has no rivals left in the tree', () => {
    it('finds no hand-rolled security name test outside this module', () => {
        // Guards against re-drift. A new copy is how the old sixteen started.
        let out = '';
        try {
            out = execSync(
                `grep -rn --include='*.ts' --include='*.tsx' ` +
                `-e "toLowerCase()\\.includes('security')" -e "/security/i" src || true`,
                { encoding: 'utf8' },
            );
        } catch {
            out = '';
        }
        const strays = out
            .split('\n')
            .filter(Boolean)
            .filter(l => !l.startsWith('src/modules/compliance/security-role.ts'))
            .filter(l => !l.startsWith('src/modules/compliance/__tests__/security-role.test.ts'));

        expect(strays, `re-implemented instead of importing isSecurityRoleName:\n${strays.join('\n')}`)
            .toEqual([]);
    });
});
