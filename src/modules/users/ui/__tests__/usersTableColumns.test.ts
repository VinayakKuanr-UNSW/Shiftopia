/**
 * The Users table's column choice (2026-10-17): Name always shows, Email starts
 * hidden, and what the browser remembers is read defensively — storage can be
 * empty, blocked, or hold anything.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    HIDEABLE_COLUMNS,
    hiddenColumnCount,
    isColumnShown,
    readColumnVisibility,
    writeColumnVisibility,
} from '../usersTableColumns';

const KEY = 'users.table.columns.v1';

afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
});

describe('users table columns', () => {
    it('always shows Name, starts with Email hidden, and everything else shown', () => {
        expect(HIDEABLE_COLUMNS.some((c) => c.id === 'name')).toBe(false);
        expect(isColumnShown({ name: false } as never, 'name')).toBe(true);
        expect(isColumnShown({}, 'email')).toBe(false);
        expect(isColumnShown({}, 'workRights')).toBe(true);
        expect(isColumnShown({ workRights: false }, 'workRights')).toBe(false);
        expect(isColumnShown(undefined, 'email')).toBe(false);
        expect(isColumnShown(null, 'organization')).toBe(true);
        expect(isColumnShown(undefined, 'name')).toBe(true);
        expect(hiddenColumnCount(undefined)).toBe(1);
    });

    it('remembers the choice in this browser', () => {
        writeColumnVisibility({ role: false, email: true });
        expect(readColumnVisibility()).toEqual({ role: false, email: true });
    });

    it('ignores anything in storage that isn’t a known column set to true or false', () => {
        // Raw JSON: an object literal's __proto__ would set the prototype, never reaching storage.
        window.localStorage.setItem(KEY, '{"role":false,"bogus":false,"email":"yes","__proto__":{"polluted":true}}');
        const read = readColumnVisibility();
        expect(read).toEqual({ role: false });
        expect(Object.getPrototypeOf(read)).toBe(Object.prototype);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        window.localStorage.setItem(KEY, '[1,2]');
        expect(readColumnVisibility()).toEqual({});
        window.localStorage.setItem(KEY, '{not json');
        expect(readColumnVisibility()).toEqual({});
    });

    it('falls back to the defaults when storage is blocked', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
        expect(readColumnVisibility()).toEqual({});
        expect(() => writeColumnVisibility({ role: false })).not.toThrow();
    });
});
