/**
 * cl 55.1 and cl 58.2 both give the Team Member a CHOICE — accrued paid annual
 * leave, or unpaid leave — and create no separate paid entitlement. The leave
 * type therefore cannot say whether a day is paid; only the recorded election
 * can, and an unrecorded election must stay unresolved rather than defaulting.
 *
 * These pin that, and pin the two policies to the corrected shape so a future
 * edit cannot quietly reintroduce the dedicated balances.
 */
import { describe, expect, it } from 'vitest';
import { LEAVE_POLICIES, resolveOrdinaryHoursCredit } from '../domain/leave-policy';
import { ELECTION_LEAVE_TYPES, type LeaveTypeCode } from '../model/leave.types';

describe('resolveOrdinaryHoursCredit', () => {
    it('passes through a policy that already knows its own answer', () => {
        expect(resolveOrdinaryHoursCredit(LEAVE_POLICIES.annual, null)).toBe('CREDITS');
        expect(resolveOrdinaryHoursCredit(LEAVE_POLICIES.unpaid, null)).toBe('BLOCKS');
        // An election on a type that has none must not change the answer.
        expect(resolveOrdinaryHoursCredit(LEAVE_POLICIES.annual, 'unpaid')).toBe('CREDITS');
    });

    it('resolves an election to the balance it actually draws on', () => {
        for (const type of ELECTION_LEAVE_TYPES) {
            const policy = LEAVE_POLICIES[type];
            expect(resolveOrdinaryHoursCredit(policy, 'annual')).toBe('CREDITS');
            expect(resolveOrdinaryHoursCredit(policy, 'unpaid')).toBe('BLOCKS');
        }
    });

    it('leaves an UNRECORDED election unresolved rather than defaulting', () => {
        // Defaulting either way invents a fact about someone's pay. The
        // Baseline calculator reports both readings instead.
        for (const type of ELECTION_LEAVE_TYPES) {
            expect(resolveOrdinaryHoursCredit(LEAVE_POLICIES[type], null)).toBe('ELECTION');
            expect(resolveOrdinaryHoursCredit(LEAVE_POLICIES[type], undefined)).toBe('ELECTION');
        }
    });
});

describe('the corrected policies', () => {
    it.each(ELECTION_LEAVE_TYPES)('%s grants no dedicated balance', (type: LeaveTypeCode) => {
        const p = LEAVE_POLICIES[type];

        expect(p.ordinaryHoursCredit).toBe('ELECTION');
        expect(p.balanceTracked).toBe(false);
        expect(p.maxBalanceHours).toBeNull();
        expect(p.accrualRateHoursPerYear).toBeNull();
        // grantedUpFront describes FDV's NES Div 11 semantics. These two used
        // to carry it on the strength of balances the Agreement never granted.
        expect(p.grantedUpFront).toBeFalsy();
    });

    it('keeps FDV a real standalone entitlement', () => {
        // cl 46 / NES Div 11 genuinely IS granted up front and paid to casuals.
        // It is not an election and must not be swept up in the correction.
        const fdv = LEAVE_POLICIES.fdv;

        expect(fdv.ordinaryHoursCredit).toBe('CREDITS');
        expect(fdv.balanceTracked).toBe(true);
        expect(fdv.grantedUpFront).toBe(true);
        expect(fdv.paidForCasual).toBe(true);
        expect(fdv.maxBalanceHours).toBe(76);
    });

    it('classifies every leave type exactly once', () => {
        const codes = Object.keys(LEAVE_POLICIES) as LeaveTypeCode[];
        for (const code of codes) {
            expect(['CREDITS', 'BLOCKS', 'ELECTION']).toContain(
                LEAVE_POLICIES[code].ordinaryHoursCredit,
            );
        }
        // Only the two clauses that grant an election may be 'ELECTION'.
        const elections = codes.filter(c => LEAVE_POLICIES[c].ordinaryHoursCredit === 'ELECTION');
        expect(elections.sort()).toEqual([...ELECTION_LEAVE_TYPES].sort());
    });

    it('treats community service and unpaid leave as discharging nothing', () => {
        // cl 57.5 — authorised unpaid leave does not count toward continuous
        // service, so it suspends the exchange rather than completing it.
        expect(LEAVE_POLICIES.unpaid.ordinaryHoursCredit).toBe('BLOCKS');
        expect(LEAVE_POLICIES.community_service.ordinaryHoursCredit).toBe('BLOCKS');
    });

    it('credits jury duty, which is paid as make-up pay for ordinary hours', () => {
        expect(LEAVE_POLICIES.jury_duty.ordinaryHoursCredit).toBe('CREDITS');
    });
});
