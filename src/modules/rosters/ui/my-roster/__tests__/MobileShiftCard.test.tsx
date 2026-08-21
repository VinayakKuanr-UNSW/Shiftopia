import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileShiftCard } from '../MobileShiftCard';

vi.mock('@/platform/auth/useAuth', () => ({
  useAuth: vi.fn().mockReturnValue({
    user: { id: 'test-user-1', employmentType: 'Full-Time' },
    hasPermission: vi.fn().mockReturnValue(true),
  }),
}));

describe('MobileShiftCard — compacted layout matching template_shifts', () => {
  const sampleShiftData = {
    shift: {
      id: 'shift-101',
      start_time: '16:30:00',
      end_time: '21:30:00',
      paid_break_minutes: 15,
      unpaid_break_minutes: 0,
      break_minutes: 15,
      remuneration_level: 3,
      roles: { name: 'TM3' },
      target_employment_type: 'FT',
    } as any,
    groupName: 'Exhibition',
    groupColor: 'green',
    subGroupName: 'Operations',
  };

  it('renders role, remuneration level, timing, net hours, breaks, and employment type', () => {
    render(<MobileShiftCard shiftData={sampleShiftData} />);

    // Row 1: Role & Level
    expect(screen.getByText('TM3')).toBeInTheDocument();
    expect(screen.getByText('Level 3')).toBeInTheDocument();

    // Row 2: Timing & Net hours badge
    expect(screen.getByText(/4:30 PM - 9:30 PM/)).toBeInTheDocument();
    expect(screen.getByText('5h net')).toBeInTheDocument();

    // Row 3: Paid break
    expect(screen.getByText(/15m paid/)).toBeInTheDocument();

    // Row 4: Employment type
    expect(screen.getByText('Full-Time')).toBeInTheDocument();
  });

  it('triggers onClick on click or Enter key', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<MobileShiftCard shiftData={sampleShiftData} onClick={onClick} />);

    const card = screen.getByRole('button');
    await user.click(card);
    expect(onClick).toHaveBeenCalledTimes(1);

    card.focus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});
