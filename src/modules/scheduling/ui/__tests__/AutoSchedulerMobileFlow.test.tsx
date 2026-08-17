import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { AutoSchedulerMobileFlow } from '../AutoSchedulerMobileFlow';
import type { EmployeeGroup } from '../useAutoScheduler';
import type { AutoSchedulerResult, ValidatedProposal } from '../../types';

function proposal(over: Partial<ValidatedProposal> = {}): ValidatedProposal {
    return {
        shiftId: 's1',
        employeeId: 'e1',
        employeeName: 'Ada Lovelace',
        shiftDate: '2026-08-12',
        startTime: '10:00',
        endTime: '16:00',
        roleName: 'Barista',
        complianceStatus: 'PASS',
        optimizerCost: 240,
        ...over,
    } as ValidatedProposal;
}

function group(over: Partial<EmployeeGroup> = {}): EmployeeGroup {
    return {
        id: 'e1',
        name: 'Ada Lovelace',
        proposals: [proposal()],
        roleDistribution: [{ name: 'Barista', value: 1 }],
        totalCost: 240,
        avgFatigue: 3.2,
        utilization: 62,
        employmentType: 'Casual',
        contractedHours: 20,
        assignedRoles: ['Barista'],
        ...over,
    };
}

function result(over: Partial<AutoSchedulerResult> = {}): AutoSchedulerResult {
    return {
        optimizerStatus: 'OPTIMAL',
        solveTimeMs: 1200,
        validationTimeMs: 30,
        totalProposals: 1,
        passing: 1,
        failing: 0,
        uncoveredV8ShiftIds: [],
        proposals: [proposal()],
        canCommit: true,
        usedFallback: false,
        ...over,
    } as AutoSchedulerResult;
}

const noop = () => {};

function renderFlow(over: Partial<React.ComponentProps<typeof AutoSchedulerMobileFlow>> = {}) {
    const props: React.ComponentProps<typeof AutoSchedulerMobileFlow> = {
        health: { available: true } as any,
        phase: 'idle',
        result: null,
        isCommitting: false,
        isDownloading: false,
        elapsedTime: 0,
        estimatedTotalSeconds: 30,
        startDate: '2026-08-12',
        setStartDate: noop,
        endDate: '2026-08-18',
        setEndDate: noop,
        validationError: null,
        applyWindowPreset: noop,
        activeWindowPreset: null,
        isShiftsLoading: false,
        shiftsInScope: 12,
        staffCount: 8,
        scopeBreakdown: { total: 12, eligible: 12, assigned: 0, published: 0, startingSoon: 0 },
        preRunCapacity: null,
        canRun: true,
        runBlockedReason: null,
        employeeGroups: [],
        onRun: noop,
        onCancelRun: noop,
        onCommit: noop,
        onClose: noop,
        onDownloadAudit: noop,
        ...over,
    };
    render(<AutoSchedulerMobileFlow {...props} />);
    return props;
}

describe('AutoSchedulerMobileFlow', () => {
    describe('set-up phase', () => {
        it('states position and task, not just a progress bar', () => {
            renderFlow();

            expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
            expect(screen.getByText('Set your scheduling window')).toBeInTheDocument();
        });

        it('offers exactly one primary action', () => {
            renderFlow();

            expect(screen.getByRole('button', { name: 'Start Auto-Schedule' })).toBeEnabled();
            expect(screen.queryByRole('button', { name: /apply/i })).not.toBeInTheDocument();
        });

        it('renders dates unambiguously rather than as 04/08/2026', () => {
            renderFlow({ startDate: '2026-08-04', endDate: '2026-08-31' });

            expect(screen.getByText('4 Aug 2026')).toBeInTheDocument();
            expect(screen.getByText('31 Aug 2026')).toBeInTheDocument();
        });

        it('describes the situation in the planner\'s terms, not the service\'s', () => {
            renderFlow({ shiftsInScope: 12 });

            expect(screen.getByText('Ready · 12 shifts to fill')).toBeInTheDocument();
            expect(screen.queryByText(/optimizer ready/i)).not.toBeInTheDocument();
        });

        it('offers window presets so nobody drives two pickers by hand', () => {
            const applyWindowPreset = vi.fn();
            renderFlow({ applyWindowPreset, activeWindowPreset: 'month' });

            fireEvent.click(screen.getByRole('button', { name: '2 weeks' }));
            expect(applyWindowPreset).toHaveBeenCalledWith('fortnight');
            expect(screen.getByRole('button', { name: 'This month' })).toHaveAttribute(
                'aria-pressed',
                'true',
            );
        });

        it('shows what is in scope before committing to a run', () => {
            renderFlow({ shiftsInScope: 12, staffCount: 8 });

            expect(screen.getByText('12')).toBeInTheDocument();
            expect(screen.getByText('8')).toBeInTheDocument();
            expect(screen.getByText('12 eligible shifts · 12 Aug → 18 Aug 2026')).toBeInTheDocument();
        });

        it('ties the window error to the control that caused it', () => {
            renderFlow({ validationError: 'Start date cannot be after end date.' });

            const alert = screen.getByRole('alert');
            expect(alert).toHaveTextContent('Start date cannot be after end date.');
            // Named explicitly, not concatenated from its own text content.
            expect(screen.getByRole('button', { name: 'Start date: 12 Aug 2026' })).toHaveAttribute(
                'aria-describedby',
                alert.id,
            );
        });

        it('offers a way forward instead of a dead button when nothing is eligible', () => {
            renderFlow({
                shiftsInScope: 0,
                canRun: false,
                runBlockedReason: 'No shifts to fill in this window.',
            });

            expect(screen.queryByRole('button', { name: 'Start Auto-Schedule' })).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Adjust dates' })).toBeEnabled();
            expect(screen.getByText('No shifts to fill in this window.')).toBeInTheDocument();
        });

        it('says WHY nothing is eligible, using the real exclusion counts', () => {
            renderFlow({
                shiftsInScope: 0,
                canRun: false,
                scopeBreakdown: {
                    total: 13,
                    eligible: 0,
                    assigned: 8,
                    published: 3,
                    startingSoon: 2,
                },
            });

            expect(screen.getByText('Nothing to schedule yet')).toBeInTheDocument();
            expect(screen.getByText(/all 13 shifts in this range are already handled/i)).toBeInTheDocument();
            expect(screen.getByText('already assigned')).toBeInTheDocument();
            expect(screen.getByText('published — out for bidding')).toBeInTheDocument();
            expect(screen.getByText('starting within 4 hours')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /widen to this month/i })).toBeInTheDocument();
        });

        it('drops the widen shortcut when the window is already this month', () => {
            renderFlow({ shiftsInScope: 0, canRun: false, activeWindowPreset: 'month' });

            expect(screen.queryByRole('button', { name: /widen to this month/i })).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Adjust dates' })).toBeInTheDocument();
        });

        it('distinguishes an empty range from a fully-handled one', () => {
            renderFlow({
                shiftsInScope: 0,
                canRun: false,
                scopeBreakdown: { total: 0, eligible: 0, assigned: 0, published: 0, startingSoon: 0 },
            });

            expect(screen.getByText(/no shifts at all in this date range/i)).toBeInTheDocument();
        });

        it('previews measured capacity rather than predicting coverage', () => {
            renderFlow({
                preRunCapacity: {
                    deficitDays: [{}, {}],
                    perDay: [],
                    totalDemandMinutes: 6000,
                    totalSupplyMinutes: 4800,
                } as any,
            });

            expect(screen.getByText('100h needed · 80h available')).toBeInTheDocument();
            expect(screen.getByText(/short on 2 days/i)).toBeInTheDocument();
            // A shortfall is information, not a blocker.
            expect(screen.getByRole('button', { name: 'Start Auto-Schedule' })).toBeEnabled();
        });

        it('keeps the priority explanation collapsed until asked', () => {
            renderFlow();

            expect(screen.getByText('Coverage → Wellbeing → Cost')).toBeInTheDocument();
            expect(screen.queryByText(/fill as many open shifts as possible/i)).not.toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', { name: /how it decides/i }));

            expect(screen.getByText(/fill as many open shifts as possible/i)).toBeInTheDocument();
        });
    });

    describe('optimising phase', () => {
        it('reports measurable progress, not just a spinner', () => {
            renderFlow({ phase: 'optimizing', elapsedTime: 9, estimatedTotalSeconds: 30 });

            const bar = screen.getByRole('progressbar', { name: /optimisation progress/i });
            expect(bar).toHaveAttribute('aria-valuenow', '30');
            expect(screen.getByText('9s elapsed')).toBeInTheDocument();
            expect(screen.getByText(/about 21s left/i)).toBeInTheDocument();
        });

        it('swaps the primary action for a way out', () => {
            const onCancelRun = vi.fn();
            renderFlow({ phase: 'optimizing', onCancelRun });

            expect(screen.queryByRole('button', { name: /compute optimal roster/i })).not.toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
            expect(onCancelRun).toHaveBeenCalledOnce();
        });
    });

    describe('review phase', () => {
        it('leads with the outcome and reassures that nothing is saved yet', () => {
            renderFlow({ phase: 'reviewing', result: result(), employeeGroups: [group()] });

            expect(screen.getByText(/1 assignments ready · every shift covered/i)).toBeInTheDocument();
            expect(screen.getByText(/nothing is saved until you apply/i)).toBeInTheDocument();
        });

        it('counts open shifts in the headline when coverage is partial', () => {
            renderFlow({
                phase: 'reviewing',
                result: result({ uncoveredV8ShiftIds: ['a', 'b'], passing: 5 }),
                employeeGroups: [group()],
            });

            expect(screen.getByText(/5 assignments ready · 2 shifts left open/i)).toBeInTheDocument();
        });

        it('renders staff as tappable cards, not a table', () => {
            renderFlow({ phase: 'reviewing', result: result(), employeeGroups: [group()] });

            expect(screen.queryByRole('table')).not.toBeInTheDocument();
            expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
            expect(screen.getByText(/Casual · 20h contract · 1 shift/)).toBeInTheDocument();
        });

        it('reveals role detail on tap — the desktop popover needs hover', () => {
            renderFlow({ phase: 'reviewing', result: result(), employeeGroups: [group()] });

            const disclosure = screen.getByRole('button', { expanded: false });
            expect(screen.queryByText('Shifts by role')).not.toBeInTheDocument();

            fireEvent.click(disclosure);

            expect(disclosure).toHaveAttribute('aria-expanded', 'true');
            expect(screen.getByText('Shifts by role')).toBeInTheDocument();
            expect(screen.getByText(/100% clear/)).toBeInTheDocument();
        });

        it('names the commit action with its consequence', () => {
            const onCommit = vi.fn();
            renderFlow({
                phase: 'reviewing',
                result: result({ passing: 7 }),
                employeeGroups: [group()],
                onCommit,
            });

            const apply = screen.getByRole('button', { name: 'Apply 7 assignments' });
            fireEvent.click(apply);
            expect(onCommit).toHaveBeenCalledOnce();
        });

        it('blocks commit when nothing passed', () => {
            renderFlow({
                phase: 'reviewing',
                result: result({ passing: 0, totalProposals: 0, proposals: [] }),
                employeeGroups: [],
            });

            expect(screen.getByRole('button', { name: /apply 0 assignments/i })).toBeDisabled();
            expect(screen.getByText(/nobody could be assigned/i)).toBeInTheDocument();
        });

        it('surfaces a degraded run rather than passing it off as optimal', () => {
            renderFlow({
                phase: 'reviewing',
                result: result({ usedFallback: true }),
                employeeGroups: [group()],
            });

            expect(screen.getByText(/built with the fallback engine/i)).toBeInTheDocument();
        });

        it('shows the audit download in a loading state while preparing', () => {
            renderFlow({
                phase: 'reviewing',
                result: result(),
                employeeGroups: [group()],
                isDownloading: true,
            });

            expect(screen.getByRole('button', { name: /preparing report/i })).toBeDisabled();
        });

        it('sorts the staff list', () => {
            const groups = [
                group({ id: 'a', name: 'Ada', utilization: 20 }),
                group({ id: 'b', name: 'Grace', utilization: 90 }),
            ];
            renderFlow({ phase: 'reviewing', result: result(), employeeGroups: groups });

            // Defaults to busiest-first, which is what a reviewer scans for.
            const names = screen.getAllByRole('button', { expanded: false })
                .map(b => within(b).getByText(/Ada|Grace/).textContent);
            expect(names).toEqual(['Grace', 'Ada']);
        });
    });

    it('closes from the app bar', () => {
        const onClose = vi.fn();
        renderFlow({ onClose });

        fireEvent.click(screen.getByRole('button', { name: /close auto-schedule/i }));
        expect(onClose).toHaveBeenCalledOnce();
    });
});
