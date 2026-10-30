/**
 * Access suites — the client half of the access model agreed on 2026-10-14
 * (docs/architecture/access-suites-plan.md).
 *
 *   Personal    every contract           own data, in that contract's sub-department
 *   Managerial  beta     Timesheets, view-only, the contract's sub-department
 *               gamma    full, the contract's sub-department
 *               delta    view-only, the contract's department
 *               epsilon  view-only, the contract's organization
 *               zeta     full, everything
 *   Admin       zeta only: Labor Demand, Compliance Rejections, Users
 *
 * Access is set on CONTRACTS (2026-10-15): every contract row carries the access
 * its position gives, reaching the row's own place, and a person may hold several
 * (EBA cl 13 multi-hiring). The certificate rows the app reads are the database's
 * mirror of those contracts — one per contract above alpha, Type X for beta and
 * Type Y for gamma–zeta. So access is decided per suite from all of them, never
 * from one "effective level": gamma in one sub-department and delta in another
 * department is full access in the first and read-only in the second.
 *
 * The database is the authority (rbac_permissions + RLS); this file decides
 * what to show. Keep the two in step: a write the UI offers but the matrix
 * refuses comes back as a silent 0-row update, not an error.
 */
import type { AccessCertificate, AccessLevel } from './types';


/**
 * What the Managerial suite lets this person do.
 * - `full`: every managerial page, read and write (gamma, zeta)
 * - `view`: every managerial page, read-only (delta, epsilon)
 * - `timesheets-view`: the Timesheets page only, read-only (beta)
 * - `none`: no managerial page (alpha, or no certificate)
 */
type ManagerialMode = 'none' | 'timesheets-view' | 'view' | 'full';

export interface AccessHolding {
    /** The highest active Type X level (beta, a team lead somewhere), if any. */
    xLevel: AccessLevel | null;
    /** The highest active Type Y level, if any — zeta means the Admin suite. */
    yLevel: AccessLevel | null;
    /** Every active managerial (Type Y) level held, one per contract, deduplicated. */
    yLevels: AccessLevel[];
    /** True when the person has at least one active contract. */
    hasContract: boolean;
}

const LADDER: AccessLevel[] = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];
const X_LEVELS: AccessLevel[] = ['alpha', 'beta'];

export function holdingFrom(
    certificates: readonly AccessCertificate[] | undefined,
    contracts: readonly unknown[] | undefined,
): AccessHolding {
    let xLevel: AccessLevel | null = null;
    let yLevel: AccessLevel | null = null;
    const yLevels: AccessLevel[] = [];
    for (const c of certificates ?? []) {
        if (c.isActive === false) continue;
        // Trust the level over the type column: the DB pins them together
        // (chk_level_matches_type), and older rows may lack the type.
        if (X_LEVELS.includes(c.accessLevel)) {
            if (!xLevel || LADDER.indexOf(c.accessLevel) > LADDER.indexOf(xLevel)) xLevel = c.accessLevel;
        } else {
            if (!yLevels.includes(c.accessLevel)) yLevels.push(c.accessLevel);
            if (!yLevel || LADDER.indexOf(c.accessLevel) > LADDER.indexOf(yLevel)) yLevel = c.accessLevel;
        }
    }
    yLevels.sort((a, b) => LADDER.indexOf(b) - LADDER.indexOf(a));
    return { xLevel, yLevel, yLevels, hasContract: (contracts?.length ?? 0) > 0 };
}

/**
 * The most the Managerial suite allows anywhere. With several managerial
 * contracts this is the best of them — the database still decides per place,
 * so a write in a view-only place is refused there (and surfaces as an error,
 * see platform/supabase/writes.ts).
 */
export function managerialMode(h: AccessHolding): ManagerialMode {
    const levels = h.yLevels ?? (h.yLevel ? [h.yLevel] : []);
    if (levels.some((l) => l === 'gamma' || l === 'zeta')) return 'full';
    if (levels.some((l) => l === 'delta' || l === 'epsilon')) return 'view';
    return h.xLevel === 'beta' ? 'timesheets-view' : 'none';
}

/**
 * May this person write shifts AT THIS PLACE (publish, create, assign, edit the
 * roster)? Place-aware, unlike managerialMode, which is the best level held
 * anywhere.
 *
 * Mirrors the database matrix for shift.publish / shift.create / shift.assign /
 * roster.edit (rbac_permissions, read 2026-10-18): gamma at SUB_DEPT scope,
 * zeta everywhere (user_has_action_in_scope treats zeta as a global bypass).
 * SUB_DEPT matches organisation + sub-department; like SQL, a missing
 * sub-department matches nothing. Delta and epsilon are view-only.
 *
 * Why it exists: with gamma in one sub-department and delta in another, the
 * page enabled Publish for both, and the server refused the WHOLE batch
 * because some of it sat in the view-only place.
 */
export function allowsShiftWriteAt(
    certificates: readonly AccessCertificate[] | undefined,
    place: { organizationId: string | null | undefined; subDepartmentId: string | null | undefined },
): boolean {
    return (certificates ?? []).some((c) => {
        if (c.isActive === false) return false;
        if (c.accessLevel === 'zeta') return true;
        return c.accessLevel === 'gamma'
            && !!place.organizationId && c.organizationId === place.organizationId
            && !!place.subDepartmentId && c.subDepartmentId === place.subDepartmentId;
    });
}

/** Personal suite: anyone with an active contract (every access level sits on one). */
export function hasPersonalSuite(h: AccessHolding): boolean {
    return h.xLevel !== null || h.hasContract;
}

/** Admin suite: zeta only. */
export function hasAdminSuite(h: AccessHolding): boolean {
    return h.yLevel === 'zeta';
}

type Rule = 'signed-in' | 'personal' | 'timesheets' | 'managerial-view' | 'managerial-write' | 'admin';

/**
 * Every feature key the app gates on, and the rule behind it. Route guards
 * (FeatureGate), the sidebar, the bottom nav and in-page write controls all
 * ask `hasPermission(key)`, so a key means the same thing everywhere.
 */
export const FEATURE_RULES: Record<string, Rule> = {
    // Shared across all three suites
    profile: 'signed-in',
    read: 'signed-in',

    // Personal suite
    'my-roster': 'personal',
    availabilities: 'personal',
    bids: 'personal',
    'my-swaps': 'personal',
    'my-broadcasts': 'personal',
    performance: 'personal',

    // Managerial suite: pages (view-only levels see them too)
    'timesheet-view': 'timesheets', // the one page beta also sees
    rosters: 'managerial-view',
    templates: 'managerial-view',
    management: 'managerial-view', // Open Bids, Swap Requests, Leave Approvals, Payroll
    broadcast: 'managerial-view',
    insights: 'managerial-view', // KPI and the Grid

    // Managerial suite: changing anything (gamma and zeta only)
    create: 'managerial-write',
    update: 'managerial-write',
    delete: 'managerial-write',
    'timesheet-edit': 'managerial-write',
    'managerial-write': 'managerial-write',

    // Admin suite
    admin: 'admin',
    users: 'admin',
    'labor-demand': 'admin',
    compliance: 'admin',
    configurations: 'admin', // Settings → Pay Rates
    audit: 'admin',
};

export function allows(h: AccessHolding, feature: string): boolean {
    const rule = FEATURE_RULES[feature];
    switch (rule) {
        case 'signed-in':
            return true;
        case 'personal':
            return hasPersonalSuite(h);
        case 'timesheets':
            return managerialMode(h) !== 'none';
        case 'managerial-view': {
            const m = managerialMode(h);
            return m === 'view' || m === 'full';
        }
        case 'managerial-write':
            return managerialMode(h) === 'full';
        case 'admin':
            return hasAdminSuite(h);
        default:
            // Unknown key: refuse. Every key in use is listed above, so this
            // only fires for a typo — which must not open a page.
            return false;
    }
}
