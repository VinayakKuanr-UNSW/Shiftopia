// src/modules/templates/ui/components/__tests__/ShiftCard.test.tsx

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
