/**
 * The notes under a contract's dates (dates drive the contract, 2026-10-16):
 * what an upcoming start, a backdated start and an early last day mean.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContractDateFields } from '../ContractDateFields';

beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T02:00:00Z')); // 1 pm in Sydney
});
afterAll(() => { vi.useRealTimers(); });

const renderFields = (props: { start_date: string; end_date?: string; savedStart?: string }) =>
    render(<ContractDateFields end_date="" onChange={() => {}} {...props} />);

describe('ContractDateFields', () => {
    it('says a future start is upcoming: no access or rostering until then', () => {
        renderFields({ start_date: '2026-11-02' });
        expect(screen.getByText('Upcoming: no access or rostering until 2 Nov 2026.')).toBeTruthy();
    });

    it('says what backdating does', () => {
        renderFields({ start_date: '2026-10-06' });
        expect(screen.getByText(/^Backdated 10 days\. Access applies from now, and pay for shifts already processed isn't recalculated\.$/)).toBeTruthy();
    });

    it("doesn't call a saved start date a backdate when editing", () => {
        renderFields({ start_date: '2025-03-03', savedStart: '2025-03-03' });
        expect(screen.queryByText(/Access applies from now/)).toBeNull();
    });

    it('flags a last day before the start', () => {
        renderFields({ start_date: '2026-10-06', end_date: '2026-10-01' });
        expect(screen.getByRole('alert').textContent).toBe('The last day is before the start date.');
    });

    it('warns that a last day of today ends the contract on save', () => {
        renderFields({ start_date: '2026-03-02', end_date: '2026-10-16', savedStart: '2026-03-02' });
        expect(screen.getByText(/ends the contract when you save: its access stops, and it becomes a read-only record/)).toBeTruthy();
    });

    it('says an ongoing contract runs until it is ended', () => {
        renderFields({ start_date: '2026-10-16' });
        expect(screen.getByText('No last day: the contract runs until it is ended.')).toBeTruthy();
    });
});
