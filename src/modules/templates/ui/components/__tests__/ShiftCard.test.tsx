// src/modules/templates/ui/components/__tests__/ShiftCard.test.tsx

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShiftCard from '../ShiftCard';
import { TemplateShift } from '@/modules/templates/model/templates.types';

// Mock skills and licenses hooks
vi.mock('@/modules/rosters/state/useRosterShifts', () => ({
  useSkills: () => ({ data: [] }),
  useLicenses: () => ({ data: [] }),
}));

describe('ShiftCard', () => {
  const mockShift: TemplateShift = {
    id: 'shift-1',
    name: 'Team Leader',
    roleName: 'Team Leader',
    remunerationLevel: 4,
    remunerationLevelName: 'Level 4',
    startTime: '05:30',
    endTime: '16:30',
    paidBreakDuration: 30,
    unpaidBreakDuration: 30,
    skills: [],
    licenses: [],
    siteTags: [],
    eventTags: [],
    sortOrder: 0,
    targetEmploymentType: 'FT',
  };


  // Regression: the 2026-08-17 a11y pass replaced the old icon button with an
  // aria-labelled one and deleted the <DropdownMenuTrigger asChild> wrapper with
  // it, leaving TooltipTrigger as the only wrapper. The button rendered, was
  // focusable and named — and opened nothing. Assert on the menu, not the button.
  it('opens the actions menu when the ... button is clicked', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();

    render(
      <ShiftCard
        shift={mockShift}
        isReadOnly={false}
        groupColor="blue"
        onEdit={onEdit}
        onDelete={vi.fn()}
        onClone={vi.fn()}
      />
    );

    const trigger = screen.getByRole('button', { name: /actions for/i });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');

    await user.click(trigger);

    const menu = await screen.findByRole('menu');
    expect(menu).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: /edit shift/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: /clone shift/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: /delete shift/i })
    ).toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: /edit shift/i }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('renders role and remuneration level together on row 1', () => {
    render(
      <ShiftCard
        shift={mockShift}
        isReadOnly={false}
        groupColor="blue"
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText('Team Leader')).toBeInTheDocument();
    expect(screen.getByText('Level 4')).toBeInTheDocument();
  });

  it('renders timings and net hours on row 2', () => {
    render(
      <ShiftCard
        shift={mockShift}
        isReadOnly={false}
        groupColor="blue"
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText(/5:30 AM - 4:30 PM/i)).toBeInTheDocument();
    expect(screen.getByText('10.5h net')).toBeInTheDocument();
  });

  it('renders breaks on row 3', () => {
    render(
      <ShiftCard
        shift={mockShift}
        isReadOnly={false}
        groupColor="blue"
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText(/30m paid/i)).toBeInTheDocument();
    expect(screen.getByText(/30m unpaid/i)).toBeInTheDocument();
  });

  it('renders target employment type on row 4', () => {
    render(
      <ShiftCard
        shift={mockShift}
        isReadOnly={false}
        groupColor="blue"
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText('Full-Time')).toBeInTheDocument();
  });

  it('renders flexible part-time when targetRequiresFlexible is true', () => {
    const ptShift: TemplateShift = {
      ...mockShift,
      targetEmploymentType: 'PT',
      targetRequiresFlexible: true,
    };

    render(
      <ShiftCard
        shift={ptShift}
        isReadOnly={false}
        groupColor="blue"
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText('Flexible Part-Time')).toBeInTheDocument();
  });
});
