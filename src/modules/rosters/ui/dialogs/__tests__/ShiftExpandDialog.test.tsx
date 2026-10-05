/**
 * The expanded view of a full-time shift, offered from a shift's ⋯ menu on the
 * Rosters page (moved from the Office card, 2026-10-04).
 *
 * `SharedShiftCard` is stubbed to echo the props that decide the expanded
 * layout and the pay row — re-testing a 1400-line shared card through this one
 * is not the point.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import * as React from 'react';
import type { Shift } from '@/modules/rosters/domain/shift.entity';
import { TooltipProvider } from '@/modules/core/ui/primitives/tooltip';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/modules/planning/ui/components/SharedShiftCard', () => ({
    SharedShiftCard: (p: { sectionLayout?: string; topContent?: React.ReactNode; estimatedPay?: React.ReactNode }) => (
        <div data-testid="full-card" data-layout={p.sectionLayout}>
            {p.topContent}
            <div data-testid="pay">{p.estimatedPay}</div>
        </div>
    ),
}));

const { ShiftExpandDialog, isPriceable } = await import('../ShiftExpandDialog');

const shift = {
    id: 'sh-1', shift_date: '2026-10-05', start_time: '08:00', end_time: '16:06',
    unpaid_break_minutes: 30, net_length_minutes: 456, target_employment_type: 'FT',
    assigned_profiles: { first_name: 'James', last_name: 'Smith' },
} as unknown as Shift;

/* Radix logs its missing-Description warning through console.warn; fail on it. */
const warn = vi.spyOn(console, 'warn');
afterEach(() => {
    const radix = warn.mock.calls.filter(c => String(c[0]).includes('Description'));
    warn.mockClear();
    expect(radix).toEqual([]);
});

const wrap = (ui: React.ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

describe('ShiftExpandDialog', () => {
    it('renders nothing without a shift', () => {
        wrap(<ShiftExpandDialog shift={null} onOpenChange={() => {}} />);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('is a titled, described dialog holding the full card in its columns layout', () => {
        wrap(<ShiftExpandDialog shift={shift} onOpenChange={() => {}} />);
        const dialog = screen.getByRole('dialog', { name: 'Mon 5 Oct · 8:00 AM – 4:06 PM' });
        // Names the employee — on the roster one cell holds several people.
        expect(dialog).toHaveAccessibleDescription('James Smith · Shift · Net 7h 36m · Unpaid break 30m');
        expect(within(dialog).getByTestId('full-card')).toHaveAttribute('data-layout', 'columns');
    });

    it('says "Not priced" rather than showing the engine default for a shift with no rate', () => {
        wrap(<ShiftExpandDialog shift={shift} onOpenChange={() => {}} />);
        expect(screen.getByTestId('pay')).toHaveTextContent('Not priced');
    });

    it('treats a level or a rate as enough to price', () => {
        expect(isPriceable({})).toBe(false);
        expect(isPriceable({ remuneration_level: 3 })).toBe(true);
        expect(isPriceable({ remuneration_rate: 41.2 })).toBe(true);
        expect(isPriceable({ remuneration_level: 0, remuneration_rate: 0 })).toBe(false);
    });

    it('flags a second shift the same day', () => {
        wrap(<ShiftExpandDialog shift={shift} alsoOnThisDay={[{ ...shift, id: 'sh-2', start_time: '18:00', end_time: '20:00' } as Shift]} onOpenChange={() => {}} />);
        expect(screen.getByText('Split shift')).toBeTruthy();
    });
});

describe('the roster menus offer Expand on full-time shifts', () => {
    const strip = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

    it('Group mode', () => {
        const src = strip(readFileSync(resolve(process.cwd(), 'src/modules/rosters/ui/modes/GroupModeView.tsx'), 'utf-8'));
        expect(src).toMatch(/target_employment_type === 'FT' && \(\s*<DropdownMenuItem\s*onClick=\{\(\) => setExpandedShift\(shift\.rawShift\)\}/);
        expect(src).toMatch(/<ShiftExpandDialog shift=\{expandedShift\}/);
    });

    it('People mode', () => {
        const src = strip(readFileSync(resolve(process.cwd(), 'src/modules/rosters/ui/modes/PeopleModeGrid.tsx'), 'utf-8'));
        expect(src).toMatch(/onExpand && shift\.rawShift\?\.target_employment_type === 'FT'/);
        expect(src).toMatch(/onExpand=\{onExpandShift\}/);
        expect(src).toMatch(/<ShiftExpandDialog shift=\{expandedShift\}/);
    });
});
