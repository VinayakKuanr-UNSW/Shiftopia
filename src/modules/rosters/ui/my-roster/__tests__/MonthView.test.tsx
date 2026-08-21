import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MonthView from '../MonthView';

vi.mock('@/modules/core/hooks/use-mobile', () => ({
  useIsMobile: vi.fn(),
}));

vi.mock('@/platform/auth/useAuth', () => ({
  useAuth: vi.fn().mockReturnValue({
    user: { id: 'test-user', employmentType: 'Full-Time' },
    hasPermission: vi.fn().mockReturnValue(true),
  }),
}));

vi.mock('../ShiftDetailsDialog', () => ({
  default: ({ isOpen, shiftData }: any) =>
    isOpen ? <div data-testid="shift-details-dialog">{shiftData?.shift?.id}</div> : null,
}));

import { useIsMobile } from '@/modules/core/hooks/use-mobile';

describe('MonthView — mobile layout & fill', () => {
  const AUGUST_2026 = new Date(2026, 7, 19);
  const queryClient = new QueryClient();

  it('renders mobile layout with flex-1 container and fills table', () => {
    vi.mocked(useIsMobile).mockReturnValue(true);

    const getShiftsForDate = vi.fn().mockReturnValue([]);
    const offerDates = new Set<string>();

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MonthView
          date={AUGUST_2026}
          getShiftsForDate={getShiftsForDate}
          pendingOfferCount={0}
          offerDates={offerDates}
        />
      </QueryClientProvider>,
    );

    const outerContainer = container.querySelector('.flex.h-full.flex-col');
    expect(outerContainer).not.toBeNull();

    const table = container.querySelector('table');
    expect(table?.className).toContain('flex-1');

    const tbody = container.querySelector('tbody');
    expect(tbody?.className).toContain('flex-1');
    expect(tbody?.className).toContain('flex-col');

    // Day 19 should be present
    expect(screen.getByRole('gridcell', { name: /Wednesday,? 19 August 2026/ })).toBeInTheDocument();
  });

  it('renders pending offer indicator on relevant dates', () => {
    vi.mocked(useIsMobile).mockReturnValue(true);

    const getShiftsForDate = vi.fn().mockReturnValue([]);
    const offerDates = new Set<string>(['2026-08-19']);

    render(
      <QueryClientProvider client={queryClient}>
        <MonthView
          date={AUGUST_2026}
          getShiftsForDate={getShiftsForDate}
          pendingOfferCount={1}
          offerDates={offerDates}
        />
      </QueryClientProvider>,
    );

    const cell = screen.getByRole('gridcell', { name: /offer pending/ });
    expect(cell).toBeInTheDocument();
  });

  it('opens shift details popover directly on date activation with 1 shift', async () => {
    vi.mocked(useIsMobile).mockReturnValue(true);

    const shift = {
      shift: { id: 'shift-aug-19', start_time: '09:00:00', end_time: '17:00:00', roles: { name: 'TM1' } },
      groupName: 'Convention',
      groupColor: 'blue',
      subGroupName: 'Hall A',
    } as any;

    const getShiftsForDate = vi.fn().mockImplementation((d: Date) => (d.getDate() === 19 ? [shift] : []));
    const offerDates = new Set<string>();

    render(
      <QueryClientProvider client={queryClient}>
        <MonthView
          date={AUGUST_2026}
          getShiftsForDate={getShiftsForDate}
          pendingOfferCount={0}
          offerDates={offerDates}
        />
      </QueryClientProvider>,
    );

    const cell = screen.getByRole('gridcell', { name: /19 August 2026/ });
    const button = cell.querySelector('button') || cell;
    button.click();

    expect(await screen.findByTestId('shift-details-dialog')).toHaveTextContent('shift-aug-19');
  });

  it('opens multi-shift picker popover dialog on date activation with >1 shifts', async () => {
    vi.mocked(useIsMobile).mockReturnValue(true);

    const shift1 = {
      shift: { id: 'shift-1', start_time: '09:00:00', end_time: '13:00:00', roles: { name: 'TM1' } },
      groupName: 'Convention',
      groupColor: 'blue',
      subGroupName: 'Hall A',
    } as any;
    const shift2 = {
      shift: { id: 'shift-2', start_time: '14:00:00', end_time: '18:00:00', roles: { name: 'TM2' } },
      groupName: 'Theatre',
      groupColor: 'red',
      subGroupName: 'Hall B',
    } as any;

    const getShiftsForDate = vi.fn().mockImplementation((d: Date) => (d.getDate() === 19 ? [shift1, shift2] : []));
    const offerDates = new Set<string>();

    render(
      <QueryClientProvider client={queryClient}>
        <MonthView
          date={AUGUST_2026}
          getShiftsForDate={getShiftsForDate}
          pendingOfferCount={0}
          offerDates={offerDates}
        />
      </QueryClientProvider>,
    );

    const cell = screen.getByRole('gridcell', { name: /19 August 2026/ });
    const button = cell.querySelector('button') || cell;
    button.click();

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Wednesday, 19 August')).toBeInTheDocument();
    expect(screen.getByText('2 Shifts Scheduled')).toBeInTheDocument();
  });
});

