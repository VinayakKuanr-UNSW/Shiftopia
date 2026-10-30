import { AccessLevel } from './types';
import { User, Users, Building2, Eye, Globe, ShieldCheck } from 'lucide-react';
import React from 'react';

/**
 * What people see for each access level. The data keeps the codes alpha–zeta;
 * screens and messages use these names (the database's access_level_label()
 * returns the same ones, for the messages it raises).
 *
 * Access is set on a contract and reaches that contract's place
 * (docs/rulebook/08-rbac-matrix.md §1).
 */
export const ACCESS_LEVELS: readonly AccessLevel[] = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];

export const ACCESS_LEVEL_CONFIG: Record<AccessLevel, {
    label: string;
    description: string;
    icon: React.ElementType;
    color: string;
}> = {
    alpha: {
        label: 'Employee',
        description: 'Own roster, timesheets, bids, swaps and leave',
        icon: User,
        color: 'text-slate-400'
    },
    beta: {
        label: 'Team Lead',
        description: "Also sees the team's timesheets, read-only",
        icon: Users,
        color: 'text-blue-400'
    },
    gamma: {
        label: 'Manager',
        description: 'Runs rosters, approvals and the team',
        icon: Building2,
        color: 'text-purple-400'
    },
    delta: {
        label: 'Department Viewer',
        description: 'Sees the whole department, changes nothing',
        icon: Eye,
        color: 'text-amber-400'
    },
    epsilon: {
        label: 'Organisation Viewer',
        description: 'Sees the whole organisation, changes nothing',
        icon: Globe,
        color: 'text-emerald-400'
    },
    zeta: {
        label: 'Administrator',
        description: 'Runs everything, including Users, Labor Demand and Compliance',
        icon: ShieldCheck,
        color: 'text-rose-400'
    },
};

export const accessLevelLabel = (level: AccessLevel | null | undefined): string =>
    level ? ACCESS_LEVEL_CONFIG[level]?.label ?? level : '';

/** Where a contract's access reaches, from the contract's own place. */
export function accessReach(
    level: AccessLevel,
    place: { organization?: string | null; department?: string | null; subDepartment?: string | null },
): string {
    switch (level) {
        case 'zeta':
            return 'Everywhere';
        case 'epsilon':
            return place.organization ? `All of ${place.organization}` : 'The whole organisation';
        case 'delta':
            return place.department ? `All of ${place.department}` : 'The whole department';
        default:
            return place.subDepartment ?? 'This sub-department';
    }
}
