/**
 * Typed RPC client — the one place a Supabase RPC failure becomes a typed
 * AppError. Every module test that goes through this client mocks it out, so
 * until now nothing pinned the auth assertion, the SQLSTATE → code mapping,
 * or the Zod response check that the rest of the app relies on.
 *
 * Network-free: `@/platform/supabase/client` is mocked; each test sets what
 * `supabase.auth.getUser` and `supabase.rpc` resolve to.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const h = vi.hoisted(() => ({
    getUser: vi.fn(),
    rpc: vi.fn(),
}));

vi.mock('@/platform/supabase/client', () => ({
    supabase: { auth: { getUser: h.getUser }, rpc: h.rpc },
}));

import {
    callAuthenticatedRpc,
    callAuthenticatedVoidRpc,
    callRpc,
    requireUser,
} from '../client';
import { AppError, AuthenticationError } from '../errors';

const signedIn = (id = 'user-1') =>
    h.getUser.mockResolvedValue({ data: { user: { id, email: `${id}@test.invalid` } }, error: null });
const signedOut = () =>
    h.getUser.mockResolvedValue({ data: { user: null }, error: null });

/** Await a promise that must reject, and hand back the AppError it rejected with. */
async function rejection(p: Promise<unknown>): Promise<AppError> {
    try {
        await p;
    } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        return e as AppError;
    }
    throw new Error('expected the call to reject, but it resolved');
}

beforeEach(() => {
    h.getUser.mockReset();
    h.rpc.mockReset();
});

describe('callRpc', () => {
    it('sends the RPC name and params unchanged and returns the parsed value', async () => {
        h.rpc.mockResolvedValue({ data: { n: '3' }, error: null });
        const schema = z.object({ n: z.coerce.number() });

        const out = await callRpc('get_thing', { p_id: 'abc' }, schema);

        expect(h.rpc).toHaveBeenCalledWith('get_thing', { p_id: 'abc' });
        // The schema's output, not the raw payload, is what callers get.
        expect(out).toEqual({ n: 3 });
    });

    it.each([
        ['42501', 'PERMISSION_DENIED'],
        ['PGRST116', 'NOT_FOUND'],
        ['23505', 'CONFLICT'],
        ['23503', 'VALIDATION'],
        ['P0001', 'STATE_TRANSITION'],
        ['40001', 'CONFLICT'],
    ])('maps SQLSTATE %s to %s', async (pgCode, appCode) => {
        h.rpc.mockResolvedValue({ data: null, error: { code: pgCode, message: 'db said no' } });

        const err = await rejection(callRpc('sm_do_thing', {}, z.unknown()));

        expect(err.code).toBe(appCode);
        expect(err.rpcName).toBe('sm_do_thing');
        expect(err.message).toBe('db said no');
        expect(err.details).toEqual({ pgCode });
    });

    it('carries the Postgres hint through to details', async () => {
        h.rpc.mockResolvedValue({
            data: null,
            error: { code: 'P0001', message: 'Shift is locked', hint: 'Unlock the roster first' },
        });

        const err = await rejection(callRpc('sm_do_thing', {}, z.unknown()));

        expect(err.details).toEqual({ hint: 'Unlock the roster first', pgCode: 'P0001' });
    });

    it('treats an error with no SQLSTATE (transport failure) as RPC_NETWORK', async () => {
        h.rpc.mockResolvedValue({ data: null, error: { message: 'TypeError: Failed to fetch' } });

        const err = await rejection(callRpc('get_thing', {}, z.unknown()));

        expect(err.code).toBe('RPC_NETWORK');
    });

    it('rejects a response that does not match the schema as RPC_VALIDATION', async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        h.rpc.mockResolvedValue({ data: [{ id: 1 }], error: null });

        const err = await rejection(callRpc('get_thing', {}, z.object({ id: z.string() })));

        expect(err.code).toBe('RPC_VALIDATION');
        expect(err.rpcName).toBe('get_thing');
        expect(err.details?.received).toBe('object');
        expect(Array.isArray(err.details?.issues)).toBe(true);
        expect(logged).toHaveBeenCalled();
        logged.mockRestore();
    });
});

describe('requireUser / authenticated calls', () => {
    it('returns the signed-in user', async () => {
        signedIn('u-42');
        await expect(requireUser()).resolves.toEqual({ id: 'u-42', email: 'u-42@test.invalid' });
    });

    it('throws AuthenticationError when nobody is signed in', async () => {
        signedOut();
        await expect(requireUser()).rejects.toBeInstanceOf(AuthenticationError);
    });

    it('throws AuthenticationError when getUser itself errors', async () => {
        h.getUser.mockResolvedValue({ data: { user: { id: 'stale' } }, error: { message: 'JWT expired' } });
        await expect(requireUser()).rejects.toBeInstanceOf(AuthenticationError);
    });

    it('callAuthenticatedRpc never sends the RPC when signed out', async () => {
        signedOut();

        const err = await rejection(callAuthenticatedRpc('sm_do_thing', () => ({}), z.unknown()));

        expect(err.code).toBe('AUTH_REQUIRED');
        expect(h.rpc).not.toHaveBeenCalled();
    });

    it('callAuthenticatedRpc builds params from the signed-in user id', async () => {
        signedIn('u-7');
        h.rpc.mockResolvedValue({ data: true, error: null });

        await callAuthenticatedRpc('sm_do_thing', (uid) => ({ p_user_id: uid }), z.boolean());

        expect(h.rpc).toHaveBeenCalledWith('sm_do_thing', { p_user_id: 'u-7' });
    });

    it('callAuthenticatedVoidRpc never sends the RPC when signed out', async () => {
        signedOut();

        await expect(callAuthenticatedVoidRpc('sm_do_thing', () => ({}))).rejects.toBeInstanceOf(AuthenticationError);
        expect(h.rpc).not.toHaveBeenCalled();
    });
});

describe('callAuthenticatedVoidRpc', () => {
    it('resolves to undefined whatever the RPC returns', async () => {
        signedIn();
        h.rpc.mockResolvedValue({ data: { anything: 1 }, error: null });
        await expect(callAuthenticatedVoidRpc('sm_do_thing', () => ({}))).resolves.toBeUndefined();
    });

    it('still surfaces a mapped error', async () => {
        signedIn();
        h.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'not allowed' } });

        const err = await rejection(callAuthenticatedVoidRpc('sm_do_thing', () => ({})));

        expect(err.code).toBe('PERMISSION_DENIED');
    });
});
