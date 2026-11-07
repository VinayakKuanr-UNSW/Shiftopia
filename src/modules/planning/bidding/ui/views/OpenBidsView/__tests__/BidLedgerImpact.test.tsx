import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { projectFairnessImpact, type FairnessStanding } from '@/modules/rosters/domain/fairness-ledger';
import { BidLedgerImpact, type BidLedgerImpactData } from '../BidLedgerImpact';

const sunday = { shiftDate: '2026-12-06', startTime: '09:00', endTime: '17:30', unpaidBreakMinutes: 30 };
const row = (metric: FairnessStanding['metric'], over: Partial<FairnessStanding>): FairnessStanding => ({
    employeeId: 'A', metric, actualHours: 0, expectedHours: 0, debtHours: 0,
    opportunityCount: 1, confidence: 0.1, windowStart: '2026-11-07', windowEnd: '2026-12-01', ...over,
});
const data = (over: Partial<BidLedgerImpactData>): BidLedgerImpactData => ({
    fatigue: null, fairness: null, casualShift: true, unavailable: false, poolSize: 2, ...over,
});

describe('BidLedgerImpact', () => {
    it('shows hours before → after and the debt move for each metric the shift touches', () => {
        const fairness = projectFairnessImpact(
            [row('sunday_hours', { actualHours: 16, expectedHours: 20, debtHours: -4, opportunityCount: 8, confidence: 0.8 })],
            sunday, 2, () => false,
        );
        render(<BidLedgerImpact impact={data({ fairness })} />);

        expect(screen.getByText('Sunday')).toBeInTheDocument();
        expect(screen.getByText('16.0h → 24.0h')).toBeInTheDocument();
        expect(screen.getByText('-4.0 → 0.0')).toBeInTheDocument();
        expect(screen.getByText('below share')).toBeInTheDocument();
        expect(screen.queryByText(/overtime/i)).not.toBeInTheDocument();
    });

    it('explains the numbers in visible text, naming the bidder pool', () => {
        const fairness = projectFairnessImpact([], sunday, 3, () => false);
        render(<BidLedgerImpact impact={data({ fairness, poolSize: 3 })} />);
        expect(screen.getByText(/hours above \(\+\) or below \(−\) their fair share.*3 bidders/i)).toBeInTheDocument();
    });

    it('counts the shifts already on record, not the one under review, and does not colour a thin record', () => {
        const fairness = projectFairnessImpact([], sunday, 1, () => false);
        render(<BidLedgerImpact impact={data({ fairness, poolSize: 1 })} />);

        expect(screen.getAllByText('building history · no shifts yet').length).toBeGreaterThan(0);
        expect(screen.queryByText('above share')).not.toBeInTheDocument();
        expect(screen.queryByText('below share')).not.toBeInTheDocument();
        for (const debt of screen.getAllByText('0.0 → 0.0')) {
            expect(debt.className).not.toMatch(/amber|emerald/);
        }
    });

    it('does not claim a worsening when the debt does not move', () => {
        // One bidder: they take exactly their fair share, so the debt stays at +2.
        const fairness = projectFairnessImpact(
            [row('sunday_hours', { actualHours: 22, expectedHours: 20, debtHours: 2, opportunityCount: 8, confidence: 0.8 })],
            sunday, 1, () => false,
        );
        render(<BidLedgerImpact impact={data({ fairness, poolSize: 1 })} />);
        expect(screen.queryByText(/pushes them further/i)).not.toBeInTheDocument();
    });

    it('says when the standing could not be loaded, rather than calling it empty', () => {
        render(<BidLedgerImpact impact={data({ fatigue: { current: 1, projected: 2, band: 'ok' }, unavailable: true })} />);
        expect(screen.getByText("Fairness standing couldn't be loaded.")).toBeInTheDocument();
        expect(screen.queryByText(/No fairness history yet/)).not.toBeInTheDocument();
    });

    it('says fairness is casual-only on a non-casual shift', () => {
        render(<BidLedgerImpact impact={data({ fatigue: { current: 1, projected: 2, band: 'ok' }, casualShift: false })} />);
        expect(screen.getByText('Fairness applies to casual shifts only.')).toBeInTheDocument();
    });
});
