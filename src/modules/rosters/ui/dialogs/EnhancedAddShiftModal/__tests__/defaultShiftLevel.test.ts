import { describe, expect, it } from 'vitest';
import { defaultShiftLevel } from '../utils';

/**
 * The level a new shift pre-fills from its role.
 *
 * A role's level stopped being unique and mandatory (migration
 * roles_level_band): it is now an optional default, with the role's EA band
 * behind it. And Level 0 is a real level — the pre-fill used to test
 * `if (role?.remuneration_level)`, which treats 0 as "no level".
 */
describe('defaultShiftLevel', () => {
    it('uses the role default level', () => {
        expect(defaultShiftLevel({ id: 'r', name: 'Supervisor', remuneration_level: 6, eba_level_min: 6, eba_level_max: 7 })).toBe(6);
    });

    it('keeps Level 0 rather than treating it as missing', () => {
        expect(defaultShiftLevel({ id: 'r', name: 'Introductory', remuneration_level: 0, eba_level_min: 0, eba_level_max: 0 })).toBe(0);
    });

    it('falls back to the bottom of the band when the role has no default', () => {
        expect(defaultShiftLevel({ id: 'r', name: 'Event Delivery Manager', remuneration_level: null, eba_level_min: 6, eba_level_max: 7 })).toBe(6);
    });

    it('returns null when the role has neither a default nor a band', () => {
        expect(defaultShiftLevel({ id: 'r', name: 'Unbanded', remuneration_level: null, eba_level_min: null, eba_level_max: null })).toBeNull();
        expect(defaultShiftLevel(undefined)).toBeNull();
    });
});
