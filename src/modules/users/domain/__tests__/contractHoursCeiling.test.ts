import { describe, it, expect } from 'vitest';
import {
    MAX_CONTRACTED_WEEKLY_HOURS,
    computeRemainingCapacity,
    validateContractHours,
    isCeilingCounted,
    type ExistingContract,
} from '../contractHoursCeiling';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Shorthand factory for an Active contract. */
function active(
    employmentStatus: string,
    hours: number,
    id = crypto.randomUUID(),
): ExistingContract {
    return { id, employment_status: employmentStatus, contracted_weekly_hours: hours, status: 'Active' };
}

/** Shorthand factory for an Inactive contract. */
function inactive(
    employmentStatus: string,
    hours: number,
    id = crypto.randomUUID(),
): ExistingContract {
    return { id, employment_status: employmentStatus, contracted_weekly_hours: hours, status: 'Inactive' };
}

/** Shorthand factory for a Terminated contract. */
function terminated(
    employmentStatus: string,
    hours: number,
    id = crypto.randomUUID(),
): ExistingContract {
    return { id, employment_status: employmentStatus, contracted_weekly_hours: hours, status: 'Terminated' };
}

// Stable UUIDs for edit-mode tests
const EDIT_CONTRACT_ID = '00000000-0000-0000-0000-000000000001';
const CASUAL_EDIT_ID = '00000000-0000-0000-0000-000000000002';

// ── isCeilingCounted ───────────────────────────────────────────────────────

describe('isCeilingCounted', () => {
    it('counts Full-Time', () => expect(isCeilingCounted('Full-Time')).toBe(true));
    it('counts Part-Time', () => expect(isCeilingCounted('Part-Time')).toBe(true));
    it('counts Flexible Part-Time', () => expect(isCeilingCounted('Flexible Part-Time')).toBe(true));
    it('does NOT count Casual', () => expect(isCeilingCounted('Casual')).toBe(false));
    it('does NOT count null', () => expect(isCeilingCounted(null)).toBe(false));
    it('does NOT count undefined', () => expect(isCeilingCounted(undefined)).toBe(false));
    it('does NOT count empty string', () => expect(isCeilingCounted('')).toBe(false));
});

// ── computeRemainingCapacity ───────────────────────────────────────────────

describe('computeRemainingCapacity', () => {
    it('returns full capacity when no contracts exist', () => {
        const result = computeRemainingCapacity([]);
        expect(result.existingHours).toBe(0);
        expect(result.remainingCapacity).toBe(38);
        expect(result.isAtCapacity).toBe(false);
    });

    it('subtracts Active FT hours from capacity', () => {
        const result = computeRemainingCapacity([active('Full-Time', 38)]);
        expect(result.existingHours).toBe(38);
        expect(result.remainingCapacity).toBe(0);
        expect(result.isAtCapacity).toBe(true);
    });

    it('subtracts Active PT hours from capacity', () => {
        const result = computeRemainingCapacity([active('Part-Time', 20)]);
        expect(result.existingHours).toBe(20);
        expect(result.remainingCapacity).toBe(18);
        expect(result.isAtCapacity).toBe(false);
    });

    it('sums multiple Active PT contracts', () => {
        const result = computeRemainingCapacity([
            active('Part-Time', 20),
            active('Part-Time', 18),
        ]);
        expect(result.existingHours).toBe(38);
        expect(result.remainingCapacity).toBe(0);
        expect(result.isAtCapacity).toBe(true);
    });

    it('does NOT count Casual contracts toward the ceiling', () => {
        const result = computeRemainingCapacity([
            active('Part-Time', 20),
            active('Casual', 0),
            active('Casual', 0),
        ]);
        expect(result.existingHours).toBe(20);
        expect(result.remainingCapacity).toBe(18);
    });

    it('does NOT count Inactive contracts', () => {
        const result = computeRemainingCapacity([
            active('Part-Time', 20),
            inactive('Part-Time', 18),
        ]);
        expect(result.existingHours).toBe(20);
        expect(result.remainingCapacity).toBe(18);
    });

    it('does NOT count Terminated contracts', () => {
        const result = computeRemainingCapacity([
            active('Part-Time', 20),
            terminated('Full-Time', 38),
        ]);
        expect(result.existingHours).toBe(20);
        expect(result.remainingCapacity).toBe(18);
    });

    it('excludes a specific contract by ID (edit mode)', () => {
        const result = computeRemainingCapacity(
            [
                active('Part-Time', 20),
                active('Part-Time', 18, EDIT_CONTRACT_ID),
            ],
            EDIT_CONTRACT_ID,
        );
        // Only the non-excluded contract counts
        expect(result.existingHours).toBe(20);
        expect(result.remainingCapacity).toBe(18);
    });

    it('handles contracted_weekly_hours as string (PostgREST numeric serialisation)', () => {
        const contract: ExistingContract = {
            id: '00000000-0000-0000-0000-000000000099',
            employment_status: 'Part-Time',
            contracted_weekly_hours: '20' as any,
            status: 'Active',
        };
        const result = computeRemainingCapacity([contract]);
        expect(result.existingHours).toBe(20);
    });

    it('handles null contracted_weekly_hours as 0', () => {
        const contract: ExistingContract = {
            id: '00000000-0000-0000-0000-000000000098',
            employment_status: 'Part-Time',
            contracted_weekly_hours: null,
            status: 'Active',
        };
        const result = computeRemainingCapacity([contract]);
        expect(result.existingHours).toBe(0);
    });
});

// ── validateContractHours ──────────────────────────────────────────────────

describe('validateContractHours', () => {
    // ── FT 38h → cannot add FT/PT/Flexible PT ─────────────────────────
    describe('FT 38h → no room for additional non-Casual contracts', () => {
        const existing = [active('Full-Time', 38)];

        it('blocks adding another FT', () => {
            const result = validateContractHours(38, 'Full-Time', existing);
            expect(result.valid).toBe(false);
            expect(result.message).toContain('38h contracted');
        });

        it('blocks adding PT', () => {
            const result = validateContractHours(1, 'Part-Time', existing);
            expect(result.valid).toBe(false);
        });

        it('blocks adding Flexible PT', () => {
            const result = validateContractHours(1, 'Flexible Part-Time', existing);
            expect(result.valid).toBe(false);
        });

        it('still allows adding Casual', () => {
            const result = validateContractHours(0, 'Casual', existing);
            expect(result.valid).toBe(true);
        });
    });

    // ── PT 20h + PT 18h → allowed ──────────────────────────────────────
    it('allows PT 20h + PT 18h = 38h', () => {
        const existing = [active('Part-Time', 20)];
        const result = validateContractHours(18, 'Part-Time', existing);
        expect(result.valid).toBe(true);
        expect(result.proposedTotal).toBe(38);
        expect(result.remainingCapacity).toBe(0);
    });

    // ── PT 20h + PT 19h → blocked ──────────────────────────────────────
    it('blocks PT 20h + PT 19h = 39h', () => {
        const existing = [active('Part-Time', 20)];
        const result = validateContractHours(19, 'Part-Time', existing);
        expect(result.valid).toBe(false);
        expect(result.proposedTotal).toBe(39);
        expect(result.message).toContain('39h');
        expect(result.message).toContain('38h/week ceiling');
    });

    // ── PT 20h + Flexible PT 18h → allowed ─────────────────────────────
    it('allows PT 20h + Flexible PT 18h = 38h', () => {
        const existing = [active('Part-Time', 20)];
        const result = validateContractHours(18, 'Flexible Part-Time', existing);
        expect(result.valid).toBe(true);
        expect(result.proposedTotal).toBe(38);
    });

    // ── PT 30h + Flexible PT 9h → blocked ──────────────────────────────
    it('blocks PT 30h + Flexible PT 9h = 39h', () => {
        const existing = [active('Part-Time', 30)];
        const result = validateContractHours(9, 'Flexible Part-Time', existing);
        expect(result.valid).toBe(false);
        expect(result.proposedTotal).toBe(39);
    });

    // ── FT 38h + PT 1h → blocked ──────────────────────────────────────
    it('blocks FT 38h + PT 1h = 39h', () => {
        const existing = [active('Full-Time', 38)];
        const result = validateContractHours(1, 'Part-Time', existing);
        expect(result.valid).toBe(false);
    });

    // ── FT 38h + Flexible PT 1h → blocked ──────────────────────────────
    it('blocks FT 38h + Flexible PT 1h = 39h', () => {
        const existing = [active('Full-Time', 38)];
        const result = validateContractHours(1, 'Flexible Part-Time', existing);
        expect(result.valid).toBe(false);
    });

    // ── PT 30h + Flexible PT 8h → allowed ──────────────────────────────
    it('allows PT 30h + Flexible PT 8h = 38h', () => {
        const existing = [active('Part-Time', 30)];
        const result = validateContractHours(8, 'Flexible Part-Time', existing);
        expect(result.valid).toBe(true);
        expect(result.proposedTotal).toBe(38);
    });

    // ── Flex PT 15h + PT 15h → allowed ─────────────────────────────────
    it('allows Flex PT 15h + PT 15h = 30h', () => {
        const existing = [active('Flexible Part-Time', 15)];
        const result = validateContractHours(15, 'Part-Time', existing);
        expect(result.valid).toBe(true);
        expect(result.proposedTotal).toBe(30);
        expect(result.remainingCapacity).toBe(8);
    });

    // ── Multiple Casual contracts → allowed ────────────────────────────
    it('allows unlimited Casual contracts', () => {
        const existing = [
            active('Casual', 0),
            active('Casual', 0),
            active('Casual', 0),
        ];
        const result = validateContractHours(0, 'Casual', existing);
        expect(result.valid).toBe(true);
    });

    // ── PT + multiple Casual contracts → allowed ───────────────────────
    it('allows PT + multiple Casual contracts', () => {
        const existing = [
            active('Part-Time', 20),
            active('Part-Time', 18),
            active('Casual', 0),
            active('Casual', 0),
            active('Casual', 0),
        ];
        const result = validateContractHours(0, 'Casual', existing);
        expect(result.valid).toBe(true);
    });

    // ── Editing a contract correctly recalculates capacity ──────────────
    describe('edit mode (excludeContractId)', () => {
        it('recalculates capacity when editing a contract down', () => {
            const existing = [
                active('Part-Time', 20),
                active('Part-Time', 18, EDIT_CONTRACT_ID),
            ];
            // Edit PT B from 18h → 15h
            const result = validateContractHours(15, 'Part-Time', existing, EDIT_CONTRACT_ID);
            expect(result.valid).toBe(true);
            expect(result.existingHours).toBe(20); // only PT A
            expect(result.proposedTotal).toBe(35);
            expect(result.remainingCapacity).toBe(3);
        });

        it('blocks editing a contract up beyond ceiling', () => {
            const existing = [
                active('Part-Time', 20),
                active('Part-Time', 18, EDIT_CONTRACT_ID),
            ];
            // Edit PT B from 18h → 20h → total would be 40h
            const result = validateContractHours(20, 'Part-Time', existing, EDIT_CONTRACT_ID);
            expect(result.valid).toBe(false);
            expect(result.proposedTotal).toBe(40);
        });

        it('decreasing an existing contract frees capacity', () => {
            const existing = [
                active('Part-Time', 20),
                active('Part-Time', 18, EDIT_CONTRACT_ID),
            ];
            // Edit PT B from 18h → 10h
            const result = validateContractHours(10, 'Part-Time', existing, EDIT_CONTRACT_ID);
            expect(result.valid).toBe(true);
            expect(result.proposedTotal).toBe(30);
            expect(result.remainingCapacity).toBe(8);
        });

        it('editing a Casual contract always succeeds', () => {
            const existing = [
                active('Full-Time', 38),
                active('Casual', 0, CASUAL_EDIT_ID),
            ];
            const result = validateContractHours(0, 'Casual', existing, CASUAL_EDIT_ID);
            expect(result.valid).toBe(true);
        });
    });

    // ── Cancelled/inactive/ended contracts are handled ─────────────────
    describe('inactive and terminated contracts excluded', () => {
        it('inactive contracts do not block new ones', () => {
            const existing = [
                inactive('Full-Time', 38),
            ];
            const result = validateContractHours(38, 'Full-Time', existing);
            expect(result.valid).toBe(true);
            expect(result.existingHours).toBe(0);
        });

        it('terminated contracts do not block new ones', () => {
            const existing = [
                terminated('Full-Time', 38),
            ];
            const result = validateContractHours(20, 'Part-Time', existing);
            expect(result.valid).toBe(true);
            expect(result.existingHours).toBe(0);
        });

        it('mix of active and inactive correctly computed', () => {
            const existing = [
                active('Part-Time', 20),
                inactive('Part-Time', 18),
                terminated('Full-Time', 38),
            ];
            // Only the active PT 20h counts
            const result = validateContractHours(18, 'Part-Time', existing);
            expect(result.valid).toBe(true);
            expect(result.existingHours).toBe(20);
            expect(result.proposedTotal).toBe(38);
        });
    });

    // ── Casual contracts don't consume the FT/PT ceiling ───────────────
    it('casual hours do not consume the 38h ceiling', () => {
        const existing = [
            active('Part-Time', 20),
            active('Part-Time', 18),
            active('Casual', 0),
            active('Casual', 0),
            active('Casual', 0),
        ];
        // Total FT/PT = 38h → at capacity
        const result = validateContractHours(1, 'Part-Time', existing);
        expect(result.valid).toBe(false);
        expect(result.existingHours).toBe(38); // Casuals excluded
    });

    // ── Edge: exactly at boundary ──────────────────────────────────────
    it('allows exactly 38h total', () => {
        const existing = [active('Part-Time', 10), active('Part-Time', 10)];
        const result = validateContractHours(18, 'Part-Time', existing);
        expect(result.valid).toBe(true);
        expect(result.proposedTotal).toBe(38);
        expect(result.remainingCapacity).toBe(0);
    });

    it('blocks 38.01h total', () => {
        const existing = [active('Part-Time', 10), active('Part-Time', 10)];
        const result = validateContractHours(18.01, 'Part-Time', existing);
        expect(result.valid).toBe(false);
    });

    // ── Edge: no existing contracts ────────────────────────────────────
    it('allows a new FT 38h when no contracts exist', () => {
        const result = validateContractHours(38, 'Full-Time', []);
        expect(result.valid).toBe(true);
        expect(result.remainingCapacity).toBe(0);
    });

    it('blocks a new FT 39h when no contracts exist', () => {
        const result = validateContractHours(39, 'Full-Time', []);
        expect(result.valid).toBe(false);
    });
});

// ── MAX_CONTRACTED_WEEKLY_HOURS constant ───────────────────────────────────

describe('MAX_CONTRACTED_WEEKLY_HOURS', () => {
    it('is 38', () => {
        expect(MAX_CONTRACTED_WEEKLY_HOURS).toBe(38);
    });
});
