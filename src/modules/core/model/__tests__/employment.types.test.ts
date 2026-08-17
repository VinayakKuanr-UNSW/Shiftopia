import { describe, it, expect } from 'vitest';
import {
    toTargetEmploymentType,
    isFlexibleEmploymentStatus,
    contractMatchesTarget,
    TARGET_EMPLOYMENT_TYPES,
} from '../employment.types';

/**
 * These helpers are the TypeScript mirror of `_EMPLOYMENT_TYPE_ALIASES` /
 * `normalize_employment_type()` in optimizer-service/model_builder.py. If the
 * two drift, the planner's assignment pool and the solver disagree about who
 * matches a shift's target — which is silent, because both sides still "work".
 *
 * The Python side is locked by
 * optimizer-service/tests/test_employment_type_normalization.py; these cases
 * deliberately mirror it.
 */

describe('toTargetEmploymentType', () => {
    it('canonicalizes every wire form the solver accepts', () => {
        expect(toTargetEmploymentType('Full-Time')).toBe('FT');
        expect(toTargetEmploymentType('full time')).toBe('FT');
        expect(toTargetEmploymentType('FULL_TIME')).toBe('FT');
        expect(toTargetEmploymentType('FT')).toBe('FT');

        expect(toTargetEmploymentType('Part-Time')).toBe('PT');
        expect(toTargetEmploymentType('part_time')).toBe('PT');
        expect(toTargetEmploymentType('PT')).toBe('PT');

        expect(toTargetEmploymentType('Casual')).toBe('Casual');
        expect(toTargetEmploymentType('CASUAL')).toBe('Casual');
    });

    it('collapses Flexible Part-Time onto PT, exactly like the solver', () => {
        expect(toTargetEmploymentType('Flexible Part-Time')).toBe('PT');
        expect(toTargetEmploymentType('flexible part time')).toBe('PT');
        expect(toTargetEmploymentType('  Flexible Part-Time  ')).toBe('PT');
    });

    it('falls back to Casual for unknown/empty values', () => {
        // Matches normalize_employment_type()'s documented posture: casuals
        // carry no FT/PT ordinary-hours contract floor, so it is the safest
        // assumption when the status is unreadable.
        expect(toTargetEmploymentType(null)).toBe('Casual');
        expect(toTargetEmploymentType(undefined)).toBe('Casual');
        expect(toTargetEmploymentType('')).toBe('Casual');
        expect(toTargetEmploymentType('   ')).toBe('Casual');
        expect(toTargetEmploymentType('contractor')).toBe('Casual');
    });

    it('exposes exactly the three tokens the DB CHECK admits', () => {
        expect([...TARGET_EMPLOYMENT_TYPES]).toEqual(['FT', 'PT', 'Casual']);
    });
});

describe('isFlexibleEmploymentStatus', () => {
    it('identifies the flexible variant that toTargetEmploymentType erases', () => {
        expect(isFlexibleEmploymentStatus('Flexible Part-Time')).toBe(true);
        expect(isFlexibleEmploymentStatus('flexible part time')).toBe(true);
    });

    it('is false for every non-flexible status', () => {
        expect(isFlexibleEmploymentStatus('Part-Time')).toBe(false);
        expect(isFlexibleEmploymentStatus('Full-Time')).toBe(false);
        expect(isFlexibleEmploymentStatus('Casual')).toBe(false);
        expect(isFlexibleEmploymentStatus(null)).toBe(false);
        expect(isFlexibleEmploymentStatus(undefined)).toBe(false);
        expect(isFlexibleEmploymentStatus('')).toBe(false);
    });
});

describe('contractMatchesTarget', () => {
    it('matches everything when no target is set', () => {
        expect(contractMatchesTarget('Casual', null)).toBe(true);
        expect(contractMatchesTarget('Full-Time', undefined)).toBe(true);
        // Even an unreadable status passes an absent target.
        expect(contractMatchesTarget(null, null)).toBe(true);
    });

    it('matches on canonical form, not raw string equality', () => {
        expect(contractMatchesTarget('Full-Time', 'FT')).toBe(true);
        expect(contractMatchesTarget('Part-Time', 'PT')).toBe(true);
        expect(contractMatchesTarget('Casual', 'Casual')).toBe(true);
    });

    it('rejects a mismatched type', () => {
        expect(contractMatchesTarget('Casual', 'FT')).toBe(false);
        expect(contractMatchesTarget('Full-Time', 'Casual')).toBe(false);
        expect(contractMatchesTarget('Part-Time', 'FT')).toBe(false);
    });

    it('treats Flexible Part-Time as PT when flexibility is not required', () => {
        expect(contractMatchesTarget('Flexible Part-Time', 'PT')).toBe(true);
    });

    it('separates flexible from plain part-timers when flexibility IS required', () => {
        // This is the case a fourth 'Flexible PT' token could not express: both
        // contracts normalize to 'PT', so only the second axis distinguishes them.
        expect(contractMatchesTarget('Flexible Part-Time', 'PT', true)).toBe(true);
        expect(contractMatchesTarget('Part-Time', 'PT', true)).toBe(false);
    });

    it('never lets the flexible flag widen a non-PT target', () => {
        // Guards the same invariant as shifts_target_flexible_requires_pt_check:
        // a flexible requirement can only narrow, never rescue a type mismatch.
        expect(contractMatchesTarget('Flexible Part-Time', 'FT', true)).toBe(false);
        expect(contractMatchesTarget('Flexible Part-Time', 'Casual', true)).toBe(false);
    });

    it('routes an unreadable status to Casual rather than matching everything', () => {
        expect(contractMatchesTarget(null, 'Casual')).toBe(true);
        expect(contractMatchesTarget(null, 'FT')).toBe(false);
        expect(contractMatchesTarget('', 'PT')).toBe(false);
    });
});
