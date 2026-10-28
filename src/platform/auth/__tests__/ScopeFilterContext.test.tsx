import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { AuthContext } from '../AuthProvider';
import { ScopeFilterProvider, scopeStorageKey, useGlobalScopeContext } from '../ScopeFilterContext';
import type { ScopeSelection } from '../types';

/**
 * The saved scope belonged to the device, not the person: one localStorage key,
 * never cleared on sign-out. The next person on a shared tablet opened every page
 * on the last person's sub-departments — and a gamma, whose filter is hidden,
 * had no way to change it.
 */

const BAR: ScopeSelection = { org_ids: ['icc'], dept_ids: ['delivery'], subdept_ids: ['bar'] };
const KITCHEN: ScopeSelection = { org_ids: ['icc'], dept_ids: ['delivery'], subdept_ids: ['kitchen'] };

let ctx: ReturnType<typeof useGlobalScopeContext>;
const Probe = () => {
    ctx = useGlobalScopeContext();
    return null;
};

const auth = (userId: string | null) => ({ user: userId ? { id: userId } : null }) as any;

function Harness({ userId }: { userId: string | null }) {
    return (
        <AuthContext.Provider value={auth(userId)}>
            <ScopeFilterProvider><Probe /></ScopeFilterProvider>
        </AuthContext.Provider>
    );
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('ScopeFilterProvider — the saved scope is per person', () => {
    it('the next person to sign in starts from nothing, and the first gets theirs back', () => {
        const { rerender } = render(<Harness userId="alice" />);
        act(() => ctx.setManagerialScope(BAR));
        expect(ctx.managerialScope).toEqual(BAR);

        rerender(<Harness userId="bob" />);
        expect(ctx.managerialScope).toBeNull();
        act(() => ctx.setManagerialScope(KITCHEN));

        rerender(<Harness userId="alice" />);
        expect(ctx.managerialScope).toEqual(BAR);
        expect(JSON.parse(localStorage.getItem(scopeStorageKey('bob'))!).managerial).toEqual(KITCHEN);
    });

    it('signed out, nothing is read or written', () => {
        render(<Harness userId={null} />);
        act(() => ctx.setPersonalScope(BAR));
        expect(localStorage.length).toBe(0);
    });

    it('removes the old device-wide key and never reads it', () => {
        localStorage.setItem('superman_scope_filters', JSON.stringify({ managerial: BAR, personal: BAR }));
        render(<Harness userId="carol" />);
        expect(ctx.managerialScope).toBeNull();
        expect(localStorage.getItem('superman_scope_filters')).toBeNull();
    });

    it('ignores a damaged saved value', () => {
        localStorage.setItem(scopeStorageKey('dave'), JSON.stringify({ managerial: { org_ids: 'icc' } }));
        render(<Harness userId="dave" />);
        expect(ctx.managerialScope).toBeNull();
    });

    it('works when storage throws (private mode, blocked site data)', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
        render(<Harness userId="erin" />);
        act(() => ctx.setPersonalScope(BAR));
        expect(ctx.personalScope).toEqual(BAR);
    });
});
