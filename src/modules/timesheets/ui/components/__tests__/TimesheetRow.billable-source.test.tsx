import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TimesheetRow } from '../TimesheetRow';
import type { TimesheetRow as TimesheetRowType } from '../../../model/timesheet.types';

// The billable-source icon beside each adjusted time is labelled for screen
// readers and in its tooltip. The arrival and departure icons were passed
// "Arrival" / "Departure" but rendered the bare source label, so both sides
// read the same ("Manager adjusted") and nothing said which time changed.

const entry = {
  id: 'ts1', date: '2026-07-07', employeeId: 'e1', employee: 'Test Person',
  organization: 'Org', department: 'Dept', subDepartment: 'Sub', group: 'G', subGroup: 'SG',
  role: 'Usher', remunerationLevel: 'Level 3',
  scheduledStart: '09:00', scheduledEnd: '17:00', clockIn: '08:55', clockOut: '17:04',
  adjustedStart: '09:00', adjustedEnd: '17:00', isAdjustedManual: true,
  adjustedStartSource: 'manual', adjustedEndSource: 'snapped',
  length: '8h', paidBreak: '0m', unpaidBreak: '30m', netLength: '7.5h', approximatePay: '$0',
} as unknown as TimesheetRowType;

describe('TimesheetRow billable-source icons', () => {
  it('name the side each adjusted time belongs to', () => {
    render(<table><tbody><TimesheetRow entry={entry} readOnly /></tbody></table>);

    expect(screen.getByLabelText('Arrival: Manager adjusted')).toBeInTheDocument();
    expect(screen.getByLabelText('Departure: Snapped to nearest 15 min')).toBeInTheDocument();
  });
});
