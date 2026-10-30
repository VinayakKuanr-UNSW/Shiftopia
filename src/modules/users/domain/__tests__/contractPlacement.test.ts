import { describe, expect, it } from 'vitest';
import { findContractForRole, rolesHeldAt } from '../contractPlacement';

/**
 * One contract per role in a place — the rule behind
 * UNIQUE (user_id, organization_id, department_id, sub_department_id, role_id).
 */
const HERE = { organization_id: 'org', department_id: 'dept', sub_department_id: 'sd' };
const at = (id: string, role_id: string, o: Record<string, unknown> = {}) =>
    ({ id, role_id, organization_id: 'org', department_id: 'dept', sub_department_id: 'sd', ...o });

describe('rolesHeldAt', () => {
    it('lists the roles held in this place', () => {
        expect(rolesHeldAt([at('a', 'usher'), at('b', 'supervisor')], HERE)).toEqual(new Set(['usher', 'supervisor']));
    });

    it('ignores contracts in another sub-department, department or organisation', () => {
        const held = rolesHeldAt([
            at('a', 'usher', { sub_department_id: 'sd-2' }),
            at('b', 'usher', { department_id: 'dept-2' }),
            at('c', 'usher', { organization_id: 'org-2' }),
        ], HERE);
        expect(held.size).toBe(0);
    });

    it('treats a missing sub-department as the same place whether null or empty', () => {
        const deptWide = { ...HERE, sub_department_id: '' };
        expect(rolesHeldAt([at('a', 'usher', { sub_department_id: null })], deptWide)).toEqual(new Set(['usher']));
    });

    it('leaves out the contract being edited', () => {
        expect(rolesHeldAt([at('a', 'usher')], HERE, 'a').size).toBe(0);
    });
});

describe('findContractForRole', () => {
    it('finds the contract holding this role here', () => {
        expect(findContractForRole([at('a', 'usher')], HERE, 'usher')?.id).toBe('a');
    });

    it('finds nothing for another role, another place, or the contract itself', () => {
        expect(findContractForRole([at('a', 'usher')], HERE, 'supervisor')).toBeNull();
        expect(findContractForRole([at('a', 'usher', { sub_department_id: 'sd-2' })], HERE, 'usher')).toBeNull();
        expect(findContractForRole([at('a', 'usher')], HERE, 'usher', 'a')).toBeNull();
    });

    it('finds nothing before a role is chosen', () => {
        expect(findContractForRole([at('a', '')], HERE, '')).toBeNull();
    });
});
