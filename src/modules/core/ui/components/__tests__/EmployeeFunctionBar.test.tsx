import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('renders Today button and invokes onToday when clicked', () => {
    const onToday = vi.fn();
    render(
      <EmployeeFunctionBar
        view="week"
        onViewChange={vi.fn()}
        selectedDate={new Date(2026, 9, 1)}
        showToday
        onToday={onToday}
      />,
    );

    const todayBtn = screen.getByRole('button', { name: 'Snap to today' });
    expect(todayBtn).toBeInTheDocument();
    expect(todayBtn).toHaveTextContent('Today');
    fireEvent.click(todayBtn);
    expect(onToday).toHaveBeenCalled();
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

  it('renders Sort as an icon button and speaks the current selection', () => {
    render(
      <EmployeeFunctionBar
        sort={DEFAULT_ROW_SORT}
        onSortChange={vi.fn()}
        sortOptions={['date', 'role']}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Sort: Date, earliest first' });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-label', 'Sort: Date, earliest first');
  });

  it('highlights a control only once it differs from the default', () => {
    const { rerender } = render(
      <EmployeeFunctionBar sort={DEFAULT_ROW_SORT} onSortChange={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /^Sort:/ })).toHaveAttribute('aria-pressed', 'false');

    rerender(
      <EmployeeFunctionBar
        sort={{ by: 'role', direction: 'desc' }}
        onSortChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /^Sort:/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders Sort, Filter, and Group By as icon buttons in actions zone', () => {
    render(
      <EmployeeFunctionBar
        sort={DEFAULT_ROW_SORT}
        onSortChange={vi.fn()}
        filterContent={<p>filters</p>}
        groupBy="none"
        onGroupByChange={vi.fn()}
        groupByOptions={GROUP_OPTIONS}
      />,
    );

    expect(screen.getByRole('button', { name: /^Sort:/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Filters/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Group by:/ })).toBeInTheDocument();
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

    for (const name of [/^Sort:/, /^Filters/, /^Group by:/]) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-expanded', 'false');
    }
    expect(screen.queryByText('filters')).not.toBeInTheDocument();
  });

  it('shows the active filter count on the trigger badge', () => {
    render(<EmployeeFunctionBar filterContent={<p>x</p>} activeFilterCount={3} />);

    expect(screen.getByRole('button', { name: 'Filters (3 active)' })).toHaveTextContent('3');
  });

  it('omits sections a page did not ask for', () => {
    render(<EmployeeFunctionBar view="day" onViewChange={vi.fn()} showToday={false} />);

    expect(screen.queryByRole('button', { name: /^Sort/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Filters/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Group by/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Snap to today' })).not.toBeInTheDocument();
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
