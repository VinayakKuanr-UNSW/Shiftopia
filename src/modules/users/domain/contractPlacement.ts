/**
 * One contract is one role in one place — Organisation › Department ›
 * Sub-Department › Role — and a person holds a given role in a given place at
 * most once.
 *
 * hr.user_contracts enforces this with
 * UNIQUE (user_id, organization_id, department_id, sub_department_id, role_id),
 * plus a twin unique index that COALESCEs the nullable department and
 * sub-department so a missing one still counts as a place. Neither looks at
 * status: an ended contract still occupies its role. These helpers let the
 * contract wizard say so before the write instead of surfacing a raw
 * unique-violation.
 *
 * Holding two DIFFERENT roles in one sub-department is still allowed — that is
 * an EBA cl 13 multi-hire, and each role is its own contract.
 */

export interface PlacedContract {
    id: string;
    organization_id?: string | null;
    department_id?: string | null;
    sub_department_id?: string | null;
    role_id?: string | null;
}

export interface Placement {
    organization_id: string;
    department_id: string;
    sub_department_id: string;
}

/** Null and '' are the same missing place, as in the COALESCE unique index. */
const samePlace = (c: PlacedContract, p: Placement): boolean =>
    (c.organization_id ?? '') === p.organization_id
    && (c.department_id ?? '') === p.department_id
    && (c.sub_department_id ?? '') === p.sub_department_id;

/** Roles this person already holds a contract for in this place, any status. */
export function rolesHeldAt(
    contracts: readonly PlacedContract[],
    placement: Placement,
    exceptContractId?: string,
): Set<string> {
    const held = new Set<string>();
    for (const c of contracts) {
        if (c.id === exceptContractId || !c.role_id) continue;
        if (samePlace(c, placement)) held.add(c.role_id);
    }
    return held;
}

/** The contract that already holds this role in this place, if any. */
export function findContractForRole(
    contracts: readonly PlacedContract[],
    placement: Placement,
    roleId: string,
    exceptContractId?: string,
): PlacedContract | null {
    if (!roleId) return null;
    return contracts.find(c =>
        c.id !== exceptContractId && c.role_id === roleId && samePlace(c, placement)) ?? null;
}

/** Postgres unique_violation — what the insert returns if the check above was bypassed. */
export const UNIQUE_VIOLATION = '23505';

export const DUPLICATE_CONTRACT_MESSAGE =
    'This person already has a contract for this role here. Edit that contract instead.';
