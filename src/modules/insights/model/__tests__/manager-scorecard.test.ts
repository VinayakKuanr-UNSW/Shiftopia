import { describe, it, expect } from 'vitest';
import {
    EMPTY_SCORECARD,
    type ManagerScorecard,
} from '../manager-scorecard.types';

describe('EMPTY_SCORECARD', () => {
    it('has every field set to 0', () => {
        for (const value of Object.values(EMPTY_SCORECARD)) {
            expect(value).toBe(0);
        }
    });

    it('is structurally a complete ManagerScorecard (compile-time check)', () => {
        // If a field were missing, this assignment would fail tsc.
        const scorecard: ManagerScorecard = EMPTY_SCORECARD;
        expect(Object.keys(scorecard).length).toBe(16);
    });
});
