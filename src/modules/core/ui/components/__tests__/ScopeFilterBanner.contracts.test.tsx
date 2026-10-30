import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthContext } from '@/platform/auth/AuthProvider';
import { ScopeFilterProvider, scopeStorageKey } from '@/platform/auth/ScopeFilterContext';
import { useScopeFilter, type ScopeMode } from '@/platform/auth/useScopeFilter';
import type { PermissionObject, ScopeTree } from '@/platform/auth/types';
import { ScopeFilterBanner } from '../ScopeFilterBanner';

/**
 * The global scope filter follows the CONTRACTS (the Users page table), not the
 * certificate mirror. Since contracts carry access, an alpha contract mints no
 * certificate — and the banner used to require a Type X before drawing the
 * personal filter, so 444 of 491 people with a contract never saw it.
 */

const tree = (orgs: Array<[string, Array<[string, string[]]>]>): ScopeTree => ({
    organizations: orgs.map(([o, depts]) => ({
        id: o, name: o,
        departments: depts.map(([d, subs]) => ({
            id: d, name: d, subdepartments: subs.map((s) => ({ id: s, name: s })),
        })),
    })),
});

const EMPTY: ScopeTree = { organizations: [] };
const BAR_AND_KITCHEN = tree([['ICC', [['Delivery', ['Bar', 'Kitchen']]]]]);
const BAR_ONLY = tree([['ICC', [['Delivery', ['Bar']]]]]);

// An alpha: contracts in Bar and Kitchen, no certificate of any kind.
const ALPHA: PermissionObject = {
    typeX: [], typeY: null, typeYs: [],
    allowed_scope_tree: EMPTY, contracted_scope_tree: BAR_AND_KITCHEN, timesheet_scope_tree: EMPTY,
};
// A Team Lead in Bar, ordinary staff in Kitchen.
const BETA: PermissionObject = { ...ALPHA, timesheet_scope_tree: BAR_ONLY };

function Shell({ perms, userId = 'u1', children }: { perms: PermissionObject; userId?: string; children: React.ReactNode }) {
    const value = { user: { id: userId }, permissionObject: perms, isPermissionsLoading: false } as any;
    return (
        <AuthContext.Provider value={value}>
            <ScopeFilterProvider>{children}</ScopeFilterProvider>
        </AuthContext.Provider>
    );
}

const latest = (spy: ReturnType<typeof vi.fn>) =>
    spy.mock.calls.length ? spy.mock.calls[spy.mock.calls.length - 1][0] : null;

beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
});

describe('ScopeFilterBanner — drawn from the contract trees', () => {
    it('shows the personal filter to someone with contracts and no Type X', () => {
        render(<Shell perms={ALPHA}><ScopeFilterBanner mode="personal" onScopeChange={vi.fn()} /></Shell>);
        expect(screen.getAllByText(/Sub-Department/i).length).toBeGreaterThan(0);
    });

    it('draws nothing on a managerial page when no contract reaches a place', () => {
        const { container } = render(
            <Shell perms={ALPHA}><ScopeFilterBanner mode="managerial" onScopeChange={vi.fn()} /></Shell>,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('on Timesheets offers a Team Lead only the sub-department they lead', async () => {
        const onScopeChange = vi.fn();
        render(<Shell perms={BETA}><ScopeFilterBanner mode="timesheet" onScopeChange={onScopeChange} /></Shell>);
        await waitFor(() => expect(latest(onScopeChange)).not.toBeNull());
        expect(latest(onScopeChange).subdept_ids).toEqual(['Bar']);
    });
});

describe('useScopeFilter — what a page reads', () => {
    let seen: ReturnType<typeof useScopeFilter>;
    const Probe = ({ mode }: { mode: ScopeMode }) => {
        seen = useScopeFilter(mode);
        return null;
    };

    it('replaces a saved choice the contracts no longer reach', () => {
        localStorage.setItem(scopeStorageKey('u1'), JSON.stringify({
            personal: { org_ids: ['ICC'], dept_ids: ['Delivery'], subdept_ids: ['Cleaning'] },
            managerial: null,
        }));
        render(<Shell perms={ALPHA}><Probe mode="personal" /></Shell>);
        expect(seen.scope.subdept_ids).toEqual(['Bar', 'Kitchen']);
    });

    it('locks the filter when the managerial tree holds one place, whatever the level', () => {
        render(<Shell perms={{ ...ALPHA, allowed_scope_tree: BAR_ONLY }}><Probe mode="managerial" /></Shell>);
        expect(seen.isGammaLocked).toBe(true);
    });

    it('never locks a personal page', () => {
        render(<Shell perms={{ ...ALPHA, contracted_scope_tree: BAR_ONLY }}><Probe mode="personal" /></Shell>);
        expect(seen.isGammaLocked).toBe(false);
    });
});
