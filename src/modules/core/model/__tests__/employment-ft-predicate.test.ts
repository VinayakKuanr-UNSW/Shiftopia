/**
 * `resolveEmploymentType` / `isFullTimeEmployee` — the single FT predicate the
 * scheduling pipeline shares.
 *
 * The invariant worth protecting: `RosterFetcher.fetchAvailability` decides whose
 * slots to SKIP and `auto-scheduler.controller` decides whose mode is OPT_OUT,
 * both from this function. An employee classified FT by one and not the other is
 * sent an empty slot list under OPT_IN, which under `enforce_availability` is a
 * hard filter against every shift in the window.
 */

import { describe, expect, it } from 'vitest';
import { isFullTimeEmployee, resolveEmploymentType, hasContractObligation } from '../employment.types';

describe('resolveEmploymentType', () => {
    // 17 of 122 staff in production have a `profiles.employment_type` that
    // contradicts their Active contract; 12 look Casual but are Full-Time. The
    // contract wins because the write path's trigger compares against it.
    it('prefers the contract employment_status over contract_type', () => {
        expect(resolveEmploymentType('Full-Time', 'CASUAL')).toBe('FT');
        expect(resolveEmploymentType('Casual', 'FT')).toBe('Casual');
    });

    it('falls back to contract_type when the status is absent', () => {
        expect(resolveEmploymentType(null, 'FT')).toBe('FT');
        expect(resolveEmploymentType('', 'PT')).toBe('PT');
        expect(resolveEmploymentType(undefined, 'CASUAL')).toBe('Casual');
    });

    it('collapses Flexible Part-Time onto PT, matching the solver', () => {
        expect(resolveEmploymentType('Flexible Part-Time', null)).toBe('PT');
    });

    it('resolves to Casual when neither field is readable', () => {
        expect(resolveEmploymentType(null, null)).toBe('Casual');
    });
});

describe('isFullTimeEmployee', () => {
    it('accepts every spelling of full-time that reaches the pipeline', () => {
        for (const s of ['Full-Time', 'full time', 'FULL_TIME', 'FT', 'fulltime']) {
            expect(isFullTimeEmployee(s, null)).toBe(true);
        }
    });

    it('is false for PT, Casual and unknown', () => {
        expect(isFullTimeEmployee('Part-Time', null)).toBe(false);
        expect(isFullTimeEmployee('Flexible Part-Time', null)).toBe(false);
        expect(isFullTimeEmployee('Casual', null)).toBe(false);
        expect(isFullTimeEmployee(null, null)).toBe(false);
    });

    // A false FT would exempt someone from availability enforcement entirely, so
    // an unrecognised token must never land there.
    it('does not treat an unrecognised status as full-time', () => {
        expect(isFullTimeEmployee('Contractor', null)).toBe(false);
        expect(isFullTimeEmployee('Fully Flexible', null)).toBe(false);
    });
});

describe('hasContractObligation', () => {
    it('is true for FT and PT, false for casual and unknown', () => {
        expect(hasContractObligation('Full-Time', null)).toBe(true);
        expect(hasContractObligation('Part-Time', null)).toBe(true);
        expect(hasContractObligation('Flexible Part-Time', null)).toBe(true);
        expect(hasContractObligation('Casual', null)).toBe(false);
        expect(hasContractObligation(null, null)).toBe(false);
    });
});
