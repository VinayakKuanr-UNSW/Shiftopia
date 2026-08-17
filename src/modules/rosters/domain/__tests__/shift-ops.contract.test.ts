import { describe, it, expect } from 'vitest';
import { mapShiftOpResultToUx, type ShiftOpResult } from '../shift-ops.contract';

/**
 * Gateway result → UX mapping, with focus on the new AUTO_OWNER_ACTIVE code the
 * AutoPilot RDT ownership lock returns (a human tried to resolve a swap/bid the
 * bot has taken). Also pins the existing branches so the map stays exhaustive.
 */

const res = (over: Partial<ShiftOpResult>): ShiftOpResult => ({ ok: false, code: 'ERROR', ...over });

describe('mapShiftOpResultToUx — AUTO_OWNER_ACTIVE', () => {
    it('maps to a friendly, non-destructive "try again" intent that refreshes', () => {
        const ux = mapShiftOpResultToUx(res({ code: 'AUTO_OWNER_ACTIVE', note: 'AutoPilot is resolving this swap.' }));
        expect(ux.kind).toBe('auto_owned');
        expect(ux.toast).toMatch(/AutoPilot is resolving/i);
        expect(ux.refresh).toBe(true);
        expect(ux.showDiff).toBeFalsy(); // it's not a conflict — nothing to diff
    });
});

describe('mapShiftOpResultToUx — existing branches remain intact', () => {
    it('APPLIED / IDEMPOTENT_REPLAY are silent successes', () => {
        expect(mapShiftOpResultToUx(res({ ok: true, code: 'APPLIED' }))).toEqual({ kind: 'success' });
        expect(mapShiftOpResultToUx(res({ ok: true, code: 'IDEMPOTENT_REPLAY' }))).toEqual({ kind: 'success' });
    });

    it('VERSION_CONFLICT prompts a diff + refresh', () => {
        const ux = mapShiftOpResultToUx(res({ code: 'VERSION_CONFLICT' }));
        expect(ux).toMatchObject({ kind: 'conflict', refresh: true, showDiff: true });
    });

    it('WRITE_REJECTED surfaces the note copy and refreshes', () => {
        expect(mapShiftOpResultToUx(res({ code: 'WRITE_REJECTED', note: 'PUBLISH_TOO_LATE' })).toast)
            .toMatch(/4-hour lock/i);
        expect(mapShiftOpResultToUx(res({ code: 'WRITE_REJECTED', note: 'MISSING_WINNER_ID' })).toast)
            .toMatch(/no bid winner/i);
    });

    it('ILLEGAL_TRANSITION / GONE / FORBIDDEN / ERROR map to their intents', () => {
        expect(mapShiftOpResultToUx(res({ code: 'ILLEGAL_TRANSITION', current_state: 'S4', attempted: 'approve_trade' })).kind).toBe('illegal');
        expect(mapShiftOpResultToUx(res({ code: 'GONE' })).kind).toBe('gone');
        expect(mapShiftOpResultToUx(res({ code: 'FORBIDDEN' })).kind).toBe('forbidden');
        expect(mapShiftOpResultToUx(res({ code: 'ERROR', error: 'boom' })).toast).toBe('boom');
    });
});
