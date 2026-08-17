import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { CalendarPane } from '../CalendarPane';
import type { AvailabilitySlot } from '../../../model/availability.types';
import type { AssignedShiftInterval } from '../../../api/availability-view.api';

/**
 * Post-migration cover for the availability pane.
 *
 * The pane's four-state model (locked / available / partial / unset) is the
 * feature behaviour the shared `MonthGrid` had to preserve; the grid itself only
 * supplies weeks, holidays and keyboard access. These tests assert that the
 * states still resolve AND that each one is now announced, which it was not when
 * the state was carried by a background colour and a native `title`.
 */

const APRIL_2026 = new Date(2026, 3, 1);

const slot = (date: string, start: string, end: string, id = `${date}-${start}`): AvailabilitySlot => ({
  id,
  rule_id: 'rule-1',
  profile_id: 'profile-1',
  slot_date: date,
  start_time: start,
  end_time: end,
  created_at: '2026-01-01T00:00:00Z',
});

const assigned = (date: string): AssignedShiftInterval =>
  ({
    id: `shift-${date}`,
    shift_date: date,
    start_time: '09:00:00',
    end_time: '17:00:00',
    role_name: 'Rigger',
    department_name: 'Theatre',
  }) as AssignedShiftInterval;

function renderPane(overrides: Partial<React.ComponentProps<typeof CalendarPane>> = {}) {
  return render(
    <CalendarPane
      slots={[]}
      assignedShifts={[]}
      currentMonth={APRIL_2026}
      isLoading={false}
      {...overrides}
    />,
  );
}

describe('CalendarPane', () => {
  it('starts the week on Monday', () => {
    renderPane();
    expect(screen.getAllByRole('columnheader')[0]).toHaveAttribute('aria-label', 'Monday');
  });

  it('announces a day with no slots as unset', () => {
    renderPane();
    expect(screen.getByRole('gridcell', { name: /14 April 2026.*no availability set/ })).toBeInTheDocument();
  });

  it('announces full-day coverage as available', () => {
    // 09:00–17:00 spans the whole configured working day.
    renderPane({ slots: [slot('2026-04-14', '09:00:00', '17:00:00')] });
    expect(screen.getByRole('gridcell', { name: /14 April 2026.*available all day/ })).toBeInTheDocument();
  });

  it('announces partial coverage as partial, with the slot times', () => {
    renderPane({ slots: [slot('2026-04-14', '09:00:00', '12:00:00')] });
    const cell = screen.getByRole('gridcell', { name: /14 April 2026.*partially available/ });
    expect(cell).toHaveAccessibleName(/09:00 to 12:00/);
  });

  it('announces an assigned shift as locked, with role and department', () => {
    // Previously this detail lived only in a native `title`, so it was
    // unavailable to keyboard and touch users.
    renderPane({
      slots: [slot('2026-04-14', '09:00:00', '17:00:00')],
      assignedShifts: [assigned('2026-04-14')],
    });
    const cell = screen.getByRole('gridcell', { name: /blocked by 1 assigned shift/ });
    expect(cell).toHaveAccessibleName(/Rigger, Theatre, 09:00 to 17:00/);
  });

  it('lets locked win over declared availability', () => {
    renderPane({
      slots: [slot('2026-04-14', '09:00:00', '17:00:00')],
      assignedShifts: [assigned('2026-04-14')],
    });
    expect(screen.queryByRole('gridcell', { name: /14 April 2026.*available all day/ })).toBeNull();
  });

  it('still marks NSW public holidays', () => {
    renderPane();
    // Good Friday 2026 = 3 April.
    expect(screen.getByRole('gridcell', { name: /Good Friday, public holiday/ })).toBeInTheDocument();
  });

  it('renders the four-state legend', () => {
    renderPane();
    for (const label of ['Available', 'Partial', 'Assigned', 'Unset']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('shows a skeleton while loading and no grid', () => {
    renderPane({ isLoading: true });
    expect(screen.queryByRole('grid')).toBeNull();
  });
});
