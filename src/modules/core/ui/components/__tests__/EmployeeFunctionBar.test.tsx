import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmployeeFunctionBar } from '../EmployeeFunctionBar';
import { DEFAULT_ROW_SORT } from '@/modules/core/lib/row-sorting';

const mockIsMobile = vi.fn(() => false);
vi.mock('@/modules/core/hooks/use-mobile', () => ({
  useIsMobile: () => mockIsMobile(),
}));
vi.mock('@/modules/core/ui/calendar', () => ({
  DatePicker: ({ children }: any) => <>{children}</>,
}));

const GROUP_OPTIONS = [
  { value: 'none' as const, label: 'None' },
  { value: 'date' as const, label: 'Date' },
  { value: 'role' as const, label: 'Role' },
];

describe('EmployeeFunctionBar', () => {
  beforeEach(() => mockIsMobile.mockReturnValue(false));

  it('renders the view range as a radiogroup with spoken names', () => {
    render(
      <EmployeeFunctionBar view="week" onViewChange={vi.fn()} />,
    );

    expect(screen.getByRole('radiogroup', { name: 'View range' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    // The visible label is "W" at mobile widths; the name is always the word.
    expect(screen.getByRole('radio', { name: 'Week view' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: '3-Day view' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('names the range picker controls after the range they move', () => {
    render(
      <EmployeeFunctionBar
        view="week"
        onViewChange={vi.fn()}
        rangeLabel="12 – 18 Aug"
        onPrevious={vi.fn()}
        onNext={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Previous week' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next week' })).toBeInTheDocument();
  });

  it('shows only the control name but still speaks the current selection', () => {
    render(
      <EmployeeFunctionBar
        sort={DEFAULT_ROW_SORT}
        onSortChange={vi.fn()}
        sortOptions={['date', 'role']}
      />,
    );

    // Visible text is the bare word; the settings do not get painted back at
    // the reader across three two-line chips.
    const trigger = screen.getByRole('button', { name: 'Sort: Date, earliest first' });
    expect(trigger).toHaveTextContent(/^Sort$/i);

    // The accessible name still starts with that visible word, so voice
    // control can address it (WCAG 2.5.3 Label in Name), and a screen-reader
    // user is not left worse off than a sighted one.
    expect(trigger.getAttribute('aria-label')).toMatch(/^Sort\b/);
  });

  it('highlights a control only once it differs from the default', () => {
    // Three permanently lit chips would make the highlight mean nothing.
    const { rerender } = render(
      <EmployeeFunctionBar sort={DEFAULT_ROW_SORT} onSortChange={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /^Sort:/ }).className)
      .not.toMatch(/border-primary/);

    rerender(
      <EmployeeFunctionBar
        sort={{ by: 'role', direction: 'desc' }}
        onSortChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /^Sort:/ }).className)
      .toMatch(/border-primary/);
  });

  it('gives the three menus equal width across the row', () => {
    const { container } = render(
      <EmployeeFunctionBar
        sort={DEFAULT_ROW_SORT}
        onSortChange={vi.fn()}
        filterContent={<p>x</p>}
        groupBy="none"
        onGroupByChange={vi.fn()}
        groupByOptions={GROUP_OPTIONS}
      />,
    );

    expect(container.querySelector('.grid-cols-3')).not.toBeNull();
  });

  it('renders each control as a collapsed disclosure, not an open panel', () => {
    render(
      <EmployeeFunctionBar
        sort={DEFAULT_ROW_SORT}
        onSortChange={vi.fn()}
        filterContent={<p>filters</p>}
        groupBy="date"
        onGroupByChange={vi.fn()}
        groupByOptions={GROUP_OPTIONS}
      />,
    );

    for (const name of [/^Sort:/, /^Filter$/, /^Group By:/]) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-expanded', 'false');
    }
    expect(screen.queryByText('filters')).not.toBeInTheDocument();
  });

  it('advertises a dropdown on desktop and a dialog on mobile', () => {
    const { unmount } = render(
      <EmployeeFunctionBar groupBy="date" onGroupByChange={vi.fn()} groupByOptions={GROUP_OPTIONS} />,
    );
    expect(screen.getByRole('button', { name: /^Group By:/ })).toHaveAttribute(
      'aria-haspopup',
      'menu',
    );
    unmount();

    mockIsMobile.mockReturnValue(true);
    render(
      <EmployeeFunctionBar groupBy="date" onGroupByChange={vi.fn()} groupByOptions={GROUP_OPTIONS} />,
    );
    expect(screen.getByRole('button', { name: /^Group By:/ })).toHaveAttribute(
      'aria-haspopup',
      'dialog',
    );
  });

  it('shows the active filter count on the trigger', () => {
    render(<EmployeeFunctionBar filterContent={<p>x</p>} activeFilterCount={3} />);

    expect(screen.getByRole('button', { name: 'Filter' })).toHaveTextContent('3');
  });

  it('omits sections a page did not ask for', () => {
    // A page with nothing to sort must not show an inert Sort menu.
    render(<EmployeeFunctionBar view="day" onViewChange={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /^Sort/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Filter/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Group By/ })).not.toBeInTheDocument();
  });

  it('has no refresh control', () => {
    render(
      <EmployeeFunctionBar
        view="week"
        onViewChange={vi.fn()}
        sort={DEFAULT_ROW_SORT}
        onSortChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /refresh/i })).not.toBeInTheDocument();
  });
});
