/**
 * The banner says OPPOSITE things to the two populations, so the thing worth
 * testing is that it never says the wrong one — including in the loading
 * state, where the resolved basis is the strict OPT_IN default and rendering
 * it would flash "your availability is required" at a full-timer.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ContractBasisBanner } from '../ContractBasisBanner';
import { resolveComplianceBasis, type ContractBasisInput } from '../../../domain/contract-basis';

const basisFor = (over: Partial<ContractBasisInput>) =>
    resolveComplianceBasis([{
        employmentStatus: null,
        contractedWeeklyHours: null,
        startDate: '2026-01-01',
        ...over,
    }]);

const renderBanner = (props: React.ComponentProps<typeof ContractBasisBanner>) =>
    render(<MemoryRouter><ContractBasisBanner {...props} /></MemoryRouter>);

describe('ContractBasisBanner', () => {
    it('renders nothing while the contract is still loading', () => {
        const { container } = renderBanner({
            basis: basisFor({ employmentStatus: 'Full-Time', contractedWeeklyHours: 38 }),
            loading: true,
        });
        expect(container).toBeEmptyDOMElement();
    });

    it('tells a casual that an undeclared day is unavailable', () => {
        renderBanner({
            basis: basisFor({ employmentStatus: 'Casual', contractedWeeklyHours: 0 }),
        });
        expect(screen.getByText(/only offered shifts you declare for/i)).toBeInTheDocument();
        expect(screen.getByText(/treated as unavailable/i)).toBeInTheDocument();
    });

    it('tells a full-timer they do not need to declare, and names their contract', () => {
        renderBanner({
            basis: basisFor({ employmentStatus: 'Full-Time', contractedWeeklyHours: 38 }),
        });
        expect(screen.getByText(/do not need to declare availability/i)).toBeInTheDocument();
        expect(screen.getByText(/38h a week/i)).toBeInTheDocument();
    });

    it('points permanents at leave rather than at this page', () => {
        renderBanner({
            basis: basisFor({ employmentStatus: 'Part-Time', contractedWeeklyHours: 20 }),
        });
        expect(screen.getByRole('link', { name: /leave/i })).toHaveAttribute('href', '/my-leave');
    });

    it('warns that a declaration NARROWS a permanent\'s roster', () => {
        // The counter-intuitive part, and the one that actually bit production:
        // five FT held a 2h weekly window and were eligible for nothing.
        renderBanner({
            basis: basisFor({ employmentStatus: 'Full-Time', contractedWeeklyHours: 38 }),
        });
        expect(screen.getByText(/narrows/i)).toBeInTheDocument();
    });

    it('never shows the casual warning to a permanent', () => {
        renderBanner({
            basis: basisFor({ employmentStatus: 'Full-Time', contractedWeeklyHours: 38 }),
        });
        expect(screen.queryByText(/treated as unavailable/i)).not.toBeInTheDocument();
    });

    it('never shows the permanent reassurance to a casual', () => {
        renderBanner({
            basis: basisFor({ employmentStatus: 'Casual', contractedWeeklyHours: 0 }),
        });
        expect(screen.queryByText(/do not need to declare/i)).not.toBeInTheDocument();
    });

    it('states an unconfigured envelope as "any time", not as a restriction', () => {
        renderBanner({
            basis: basisFor({ employmentStatus: 'Full-Time', contractedWeeklyHours: 38 }),
        });
        expect(screen.getByText(/rostered at any time your contract allows/i)).toBeInTheDocument();
    });

    it('renders a configured envelope as a readable span and day range', () => {
        renderBanner({
            basis: basisFor({
                employmentStatus: 'Full-Time', contractedWeeklyHours: 38,
                ordinarySpanStart: '06:00:00', ordinarySpanEnd: '18:00:00',
                ordinaryDays: [1, 2, 3, 4, 5],
            }),
        });
        expect(screen.getByText(/6am–6pm, Mon–Fri/)).toBeInTheDocument();
    });

    it('renders non-contiguous days as a list', () => {
        renderBanner({
            basis: basisFor({
                employmentStatus: 'Part-Time', contractedWeeklyHours: 20,
                ordinarySpanStart: '08:30:00', ordinarySpanEnd: '14:00:00',
                ordinaryDays: [1, 3, 5],
            }),
        });
        expect(screen.getByText(/8:30am–2pm, Mon, Wed, Fri/)).toBeInTheDocument();
    });

    it('treats all seven days as "any day" rather than listing them', () => {
        renderBanner({
            basis: basisFor({
                employmentStatus: 'Full-Time', contractedWeeklyHours: 38,
                ordinarySpanStart: '06:00:00', ordinarySpanEnd: '22:00:00',
                ordinaryDays: [1, 2, 3, 4, 5, 6, 7],
            }),
        });
        expect(screen.getByText(/6am–10pm, any day/)).toBeInTheDocument();
    });

    it('falls back to the casual message when no contract could be read', () => {
        // The strict reading. Telling someone with no readable contract that
        // they need not declare would be a promise the solver will not keep.
        renderBanner({ basis: resolveComplianceBasis([]) });
        expect(screen.getByText(/only offered shifts you declare for/i)).toBeInTheDocument();
    });
});
