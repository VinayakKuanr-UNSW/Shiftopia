/**
 * assertWrote — a write row-level security refused must not read as done.
 * PostgREST answers a refused UPDATE/DELETE with success and zero rows.
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../rpc/errors';
import { WriteRefusedError, assertWrote } from '../writes';

describe('assertWrote', () => {
    it('throws when a counted write touched nothing', () => {
        expect(() => assertWrote({ error: null, count: 0 }, 'approve this timesheet'))
            .toThrow(WriteRefusedError);
    });

    it('throws when a returning write came back empty', () => {
        expect(() => assertWrote({ error: null, data: [] }, 'revoke this certificate'))
            .toThrow(/Nothing changed: you can't revoke this certificate/);
    });

    it('raises the same code a refusing RPC does, so existing handling shows it', () => {
        try {
            assertWrote({ error: null, count: 0 }, 'delete this template');
            expect.unreachable();
        } catch (e) {
            expect(e).toBeInstanceOf(AppError);
            expect((e as AppError).code).toBe('PERMISSION_DENIED');
            expect((e as AppError).details).toEqual({ action: 'delete this template' });
        }
    });

    it('passes a write that touched rows', () => {
        expect(() => assertWrote({ error: null, count: 1 }, 'x')).not.toThrow();
        expect(() => assertWrote({ error: null, data: [{ id: 'a' }] }, 'x')).not.toThrow();
    });

    it('leaves an errored result to the caller', () => {
        expect(() => assertWrote({ error: { message: 'boom' }, count: 0 }, 'x')).not.toThrow();
    });

    it('does not guess when the result carries neither a count nor rows', () => {
        expect(() => assertWrote({ error: null }, 'x')).not.toThrow();
        expect(() => assertWrote({ error: null, count: null, data: null }, 'x')).not.toThrow();
    });
});
