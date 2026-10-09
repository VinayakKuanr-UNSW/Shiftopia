import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { SharedShiftCard } from '../SharedShiftCard';

function renderCard(props: Record<string, unknown> = {}) {
  return render(
    <SharedShiftCard
      variant="timecard"
      organization="ICC Sydney"
      department="Event Delivery"
      subDepartment="Set-up"
      group="Theatre"
      subGroup="AM Set"
      role="Team Leader"
      shiftDate="Thu, Aug 20, 2026"
      startTime="05:30"
      endTime="16:30"
      netLength={630}
      paidBreak={0}
      unpaidBreak={30}
      {...props}
    />,
  );
}

/** The value rendered under a given label in the identity grid. */
function cellValue(label: string) {
  const dt = screen.getByText(label);
  return dt.parentElement?.querySelector('dd')?.textContent?.trim();
}

describe('SharedShiftCard — identity grid', () => {
  it('renders seven cells in a fixed order, the lone last one spanning its row', () => {
    renderCard({ identityGrid: true, employeeName: 'Kurry Admin' });

    expect(
      screen.getAllByRole('term').map((t) => t.textContent?.trim()),
    ).toEqual([
      'Org', 'Dept', 'Sub-Dept',
      'Group', 'Sub-Group', 'Role',
      'Employee',
    ]);
    expect(screen.getByText('Employee').parentElement?.className).toContain('col-span-3');

    expect(cellValue('Org')).toBe('ICC Sydney');
    expect(cellValue('Dept')).toBe('Event Delivery');
    expect(cellValue('Sub-Dept')).toBe('Set-up');
    expect(cellValue('Group')).toBe('Theatre');
    expect(cellValue('Sub-Group')).toBe('AM Set');
    expect(cellValue('Role')).toBe('Team Leader');
    expect(cellValue('Employee')).toBe('Kurry Admin');
  });

  it('replaces the heading, assignee and breadcrumbs', () => {
    renderCard({ identityGrid: true, employeeName: 'Kurry Admin' });

    expect(screen.queryByRole('heading', { name: 'Team Leader' })).not.toBeInTheDocument();
    expect(screen.queryByText('DATES')).not.toBeInTheDocument();
    expect(screen.queryByText('TIMESHEET STATUS')).not.toBeInTheDocument();
  });

  it('says Unassigned — not a dash — when nobody holds the shift', () => {
    // An unfilled shift is a real state, not a missing value. The em-dash is
    // for facts the caller had nothing to say about.
    renderCard({
      identityGrid: true,
      employeeName: undefined,
      shiftData: { assigned_employee_id: null },
    });

    expect(cellValue('Employee')).toBe('Unassigned');
  });

  it('does not claim Unassigned when the caller simply never said', () => {
    // The swap pickers select no profile at all, so they know nothing about
    // who holds the shift — and asserting "Unassigned" there would be the same
    // lie the offers inbox used to tell its own recipient.
    renderCard({ identityGrid: true, employeeName: undefined, shiftData: {} });

    expect(cellValue('Employee')).toBe('—Not set');
  });

  it('shows no pay anywhere — pay is shown in Gross Pay alone', () => {
    // Even a caller still passing the old pay props gets no figure: the card
    // has no pay props, cells or lines any more (decision 2026-10-09).
    const legacyPay = {
      estimatedPay: '$412.50',
      estimatedPayBreakdown: [{ description: 'Ordinary', hours: 7.5, amount: 412.5 }],
      billablePay: '$398.20',
      actualPay: '$401.00',
    };
    const { container } = renderCard({
      identityGrid: true,
      sectionLayout: 'columns',
      clockIn: '05:28',
      clockOut: '16:31',
      ...legacyPay,
    } as Record<string, unknown>);

    expect(container.textContent).not.toMatch(/\$\d/);
    expect(container.textContent).not.toMatch(/(Sched\.|Est\.|Billable|Actual) Pay/);
    expect(screen.queryByRole('button', { name: /rate breakdown/i })).toBeNull();
  });

  it('falls back to shiftData for facts the caller did not spell out', () => {
    // Adoption on a new surface should be one boolean, not six prop rewrites.
    render(
      <SharedShiftCard
        variant="timecard"
        identityGrid
        organization=""
        department=""
        role=""
        shiftDate="Thu, Aug 20, 2026"
        startTime="05:30"
        endTime="16:30"
        netLength={630}
        paidBreak={0}
        unpaidBreak={30}
        shiftData={{
          organizations: { name: 'ICC Sydney' },
          departments: { name: 'Event Delivery' },
          sub_departments: { name: 'Set-up' },
          group_type: 'theatre',
          sub_group_name: 'AM Set',
          roles: { name: 'Team Leader' },
        }}
      />,
    );

    expect(cellValue('Org')).toBe('ICC Sydney');
    expect(cellValue('Sub-Dept')).toBe('Set-up');
    expect(cellValue('Sub-Group')).toBe('AM Set');
    expect(cellValue('Role')).toBe('Team Leader');
  });

  it('maps a raw group_type through the canonical display names', () => {
    renderCard({ identityGrid: true, group: undefined, shiftData: { group_type: 'the_cutaway' } });

    expect(cellValue('Group')).toBe('The Cutaway');
  });

  it('keeps the heading and the segmented box for callers that opt out', () => {
    renderCard({ employeeName: 'Kurry Admin' });

    expect(screen.getByRole('heading', { name: 'Team Leader' })).toBeInTheDocument();
    expect(screen.getByText('Kurry Admin')).toBeInTheDocument();
    expect(screen.getByText('TIMESHEET STATUS')).toBeInTheDocument();
  });

  it('renders a dash with a spoken fallback for a missing value', () => {
    renderCard({ identityGrid: true, subGroup: '  ', group: '' });

    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Not set').length).toBeGreaterThanOrEqual(1);
  });

  it('renders only the named cells, in the order given', () => {
    // The roster drill-down states its org → sub-group scope once in the panel
    // header, so its cards carry only what differs between them.
    renderCard({
      identityGrid: true,
      identityFields: ['role', 'employee'],
      employeeName: 'Kurry Admin',
    });

    expect(
      screen.getAllByRole('term').map((t) => t.textContent?.trim()),
    ).toEqual(['Role', 'Employee']);
    expect(screen.queryByText('Org')).not.toBeInTheDocument();
    expect(screen.queryByText('Sub-Group')).not.toBeInTheDocument();
  });

  it('lays four cells out as 2×2 rather than leaving a ragged row', () => {
    const { container } = renderCard({
      identityGrid: true,
      identityFields: ['org', 'dept', 'role', 'employee'],
    });

    expect(container.querySelector('.grid-cols-2')).not.toBeNull();
    expect(container.querySelector('.grid-cols-3')).toBeNull();
  });

  it('marks each collapsible section as an expandable control', () => {
    renderCard({ identityGrid: true });

    const scheduled = screen.getByRole('button', { name: /scheduled/i });
    expect(scheduled).toHaveAttribute('aria-expanded');
    const panelId = scheduled.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();

    const expanded = scheduled.getAttribute('aria-expanded') === 'true';
    expect(!!document.getElementById(panelId!)).toBe(expanded);
  });

  it('does not draw a border when embedded flat', () => {
    // `.dept-card-glass-base` sets `border` with !important and the group class
    // colours it, so a flat card used to show a coloured hairline tracking its
    // own radius inside the container's. The override class must be present.
    const { container } = renderCard({ identityGrid: true, isFlat: true });

    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('dept-card-glass-flat');
    expect(card.className).not.toMatch(/\bborder-border\//);
  });

  it('still shows the sub-department in the breadcrumb trail when not gridded', () => {
    // Call sites moved sub-department off `subGroup` onto its own prop; the
    // trail must read the same for anyone still using the heading layout.
    const { container } = renderCard({ subDepartment: 'Set-up', subGroup: undefined });

    expect(within(container).getByText('Set-up')).toBeInTheDocument();
  });
});

describe('SharedShiftCard — columns layout (Office expand dialog)', () => {
  const columns = () => renderCard({
    sectionLayout: 'columns',
    defaultExpandedSections: { scheduled: false, actual: false, payroll: false, variance: false },
  });

  it('opens every section and offers no toggle, whatever the defaults say', () => {
    const { container } = columns();
    expect(container.querySelectorAll('[aria-expanded]')).toHaveLength(0);
    for (const name of ['scheduled', 'actual', 'payroll', 'variance']) {
      expect(container.querySelector(`[role="region"][id$="-${name}"]`)).not.toBeNull();
    }
  });

  it('three equal panes in a row, Variance full width beneath', () => {
    const { container } = columns();
    const grid = container.querySelector('[role="region"][id$="-scheduled"]')!.parentElement!.parentElement!;
    expect(grid.className).toContain('sm:grid-cols-3');
    const panes = Array.from(grid.children) as HTMLElement[];
    expect(panes).toHaveLength(4);
    for (const pane of panes.slice(0, 3)) expect(pane.className).toContain('h-full');
    expect(panes[3].className).toContain('sm:col-span-3');
    expect(within(panes[3]).getByText('Variance')).toBeInTheDocument();
  });

  it('the stacked layout is unchanged: toggles', () => {
    const { container } = renderCard({ defaultExpandedSections: { actual: true } });
    expect(container.querySelectorAll('button[aria-expanded]').length).toBeGreaterThanOrEqual(4);
  });
});
