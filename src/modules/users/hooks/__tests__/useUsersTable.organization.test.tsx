import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from '@/platform/auth/AuthProvider';
import { ScopeFilterProvider } from '@/platform/auth/ScopeFilterContext';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import type { PermissionObject, ScopeTree } from '@/platform/auth/types';
import { useUsersTable } from '../useUsersTable';

/**
 * The Users page follows the organization chosen in the account menu
 * (docs/architecture/multi-organization.md S4). An Administrator of two
 * organizations used to see both organizations' contracts in one table, because
 * the page's scope filter offered every organization the contracts reach and
 * started on all of them.
 */

const db = vi.hoisted(() => ({ rows: {} as Record<string, unknown[]> }));

vi.mock('@/platform/supabase/client', () => {
    const chain = (table: string) => {
        const q: Record<string, unknown> = {};
        for (const m of ['select', 'order', 'in', 'eq']) q[m] = () => q;
        q.then = (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) =>
            Promise.resolve({ data: db.rows[table] ?? [], error: null }).then(ok, fail);
        return q;
    };
    return { supabase: { from: chain } };
});

const tree = (orgs: Array<[string, string, string]>): ScopeTree => ({
    organizations: orgs.map(([o, d, s]) => ({
        id: o, name: o, departments: [{ id: d, name: d, subdepartments: [{ id: s, name: s }] }],
    })),
});
const BOTH = tree([['icc', 'icc-admin', 'icc-mgmt'], ['bcec', 'bcec-admin', 'bcec-mgmt']]);
const PERMS: PermissionObject = {
    typeX: [], typeY: null, typeYs: [],
    allowed_scope_tree: BOTH, contracted_scope_tree: BOTH, timesheet_scope_tree: BOTH,
};
const ORGS = [{ id: 'icc', name: 'ICC Sydney' }, { id: 'bcec', name: 'BCEC' }];

const contract = (id: string, user: string, org: string) => ({
    id, user_id: user, organization_id: org, department_id: `${org}-admin`, sub_department_id: `${org}-mgmt`,
    role_id: null, status: 'Active', employment_status: 'Casual',
});

let seen: { orgs: string[]; contractIds: string[] } = { orgs: [], contractIds: [] };
function Probe() {
    const { scope, scopeTree } = useScopeFilter('managerial');
    const table = useUsersTable(scope);
    seen = {
        orgs: (scopeTree?.organizations ?? []).map((o) => o.id),
        contractIds: table.groups.flatMap((g) => g.contracts.map((c) => c.id)).sort(),
    };
    return null;
}

function Shell({ chosen, organizations, client }: { chosen: string; organizations: typeof ORGS; client: QueryClient }) {
    const value = {
        user: { id: 'admin' },
        permissionObject: PERMS,
        isPermissionsLoading: false,
        organizations,
        accessScope: { organizationId: chosen },
        refreshPermissions: async () => {},
    } as any;
    return (
        <QueryClientProvider client={client}>
            <AuthContext.Provider value={value}>
                <ScopeFilterProvider><Probe /></ScopeFilterProvider>
            </AuthContext.Provider>
        </QueryClientProvider>
    );
}

beforeEach(() => {
    localStorage.clear();
    db.rows = {
        profiles: [
            { id: 'p1', full_name: 'Sydney Staff' },
            { id: 'p2', full_name: 'Brisbane Staff' },
            { id: 'admin', full_name: 'Kurry Admin' },
        ],
        user_contracts: [
            contract('c-icc', 'p1', 'icc'),
            contract('c-bcec', 'p2', 'bcec'),
            contract('c-admin-icc', 'admin', 'icc'),
            contract('c-admin-bcec', 'admin', 'bcec'),
        ],
    };
});

describe('Users page — the chosen organization', () => {
    it('lists only the chosen organization\'s contracts, and switches with the choice', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const { rerender } = render(<Shell chosen="icc" organizations={ORGS} client={client} />);
        await waitFor(() => expect(seen.contractIds.length).toBeGreaterThan(0));
        expect(seen.orgs).toEqual(['icc']);
        expect(seen.contractIds).toEqual(['c-admin-icc', 'c-icc']);

        rerender(<Shell chosen="bcec" organizations={ORGS} client={client} />);
        await waitFor(() => expect(seen.contractIds).toEqual(['c-admin-bcec', 'c-bcec']));
        expect(seen.orgs).toEqual(['bcec']);
    });

    it('without a choice to make (one organization held), the tree is left whole', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(<Shell chosen="icc" organizations={ORGS.slice(0, 1)} client={client} />);
        await waitFor(() => expect(seen.contractIds.length).toBe(4));
        expect(seen.orgs).toEqual(['icc', 'bcec']);
    });
});
