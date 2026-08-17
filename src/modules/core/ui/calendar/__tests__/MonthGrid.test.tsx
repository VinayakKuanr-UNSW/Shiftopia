import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MonthGrid } from '../MonthGrid';
import { Calendar } from '@/modules/core/ui/primitives/calendar';

/**
 * These assert the contract the shared calendar exists to guarantee. Each one
 * corresponds to something at least one of the hand-rolled grids got wrong.
 */

const APRIL_2026 = new Date(2026, 3, 1);

describe('MonthGrid — week ordering', () => {
  it('renders Monday as the first column and Sunday as the last', () => {
    render(<MonthGrid month={APRIL_2026} />);
    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(7);
    expect(headers[0]).toHaveTextContent('Mon');
    expect(headers[6]).toHaveTextContent('Sun');
  });

  it('gives each weekday column its full name for assistive tech', () => {
    render(<MonthGrid month={APRIL_2026} />);
    expect(screen.getAllByRole('columnheader')[0]).toHaveAttribute('aria-label', 'Monday');
  });

  it('pads the month to whole weeks without a phantom sixth row', () => {
    // April 2026 spans Mon 30 Mar → Sun 3 May: five rows, 35 cells.
    const { container } = render(<MonthGrid month={APRIL_2026} />);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(5);
  });
});

describe('MonthGrid — grid semantics', () => {
  it('exposes a grid whose rows own gridcells', () => {
    const { container } = render(<MonthGrid month={APRIL_2026} />);
    const grid = container.querySelector('[role="grid"]');
    expect(grid).not.toBeNull();

    const bodyRow = container.querySelectorAll('tbody tr')[0];
    // Every day is a gridcell; nothing unlabelled sits between row and cell.
    expect(within(bodyRow as HTMLElement).getAllByRole('gridcell')).toHaveLength(7);
  });

  it('makes every day a real button, not a clickable div', () => {
    render(<MonthGrid month={APRIL_2026} />);
    // 35 padded cells, all focusable buttons.
    expect(screen.getAllByRole('gridcell')).toHaveLength(35);
    expect(screen.getAllByRole('gridcell')[0].tagName).toBe('BUTTON');
  });
});

/** The one day in the tab order — the grid's keyboard entry point. */
const rovingDay = () =>
  screen.getAllByRole('gridcell').find((el) => el.getAttribute('tabindex') === '0')!;

describe('MonthGrid — keyboard access', () => {
  it('reaches a day by tabbing past the month navigation', async () => {
    const user = userEvent.setup();
    render(<MonthGrid month={APRIL_2026} />);

    // prev-month, next-month, then the grid's roving day.
    await user.tab();
    await user.tab();
    await user.tab();

    expect(document.activeElement).toBe(rovingDay());
  });

  it('activates a day with Enter', async () => {
    const user = userEvent.setup();
    const onDayActivate = vi.fn();
    render(<MonthGrid month={APRIL_2026} onDayActivate={onDayActivate} />);

    rovingDay().focus();
    await user.keyboard('{Enter}');

    expect(onDayActivate).toHaveBeenCalledTimes(1);
  });

  it('activates a day with Space', async () => {
    const user = userEvent.setup();
    const onDayActivate = vi.fn();
    render(<MonthGrid month={APRIL_2026} onDayActivate={onDayActivate} />);

    rovingDay().focus();
    await user.keyboard(' ');

    expect(onDayActivate).toHaveBeenCalledTimes(1);
  });

  it('moves focus between days with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<MonthGrid month={APRIL_2026} />);

    const start = rovingDay();
    start.focus();
    await user.keyboard('{ArrowRight}');

    // react-day-picker's focus model moved the roving day one column on.
    expect(document.activeElement).not.toBe(start);
    expect(document.activeElement?.getAttribute('role')).toBe('gridcell');
  });

  it('uses a roving tabindex — exactly one day is in the tab order', () => {
    render(<MonthGrid month={APRIL_2026} />);
    const tabbable = screen.getAllByRole('gridcell').filter((el) => el.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
  });
});

describe('MonthGrid — accessible names', () => {
  it('names each day with its full date by default', () => {
    render(<MonthGrid month={APRIL_2026} />);
    expect(screen.getByRole('gridcell', { name: /Wednesday,? 1 April 2026/ })).toBeInTheDocument();
  });

  it('announces NSW public holidays rather than relying on colour', () => {
    render(<MonthGrid month={APRIL_2026} />);
    // Good Friday 2026 = 3 April.
    expect(screen.getByRole('gridcell', { name: /Good Friday, public holiday/ })).toBeInTheDocument();
  });

  it('lets a feature fold its own state into the name', () => {
    render(
      <MonthGrid
        month={APRIL_2026}
        dayLabel={(ctx) => `${ctx.date.getDate()} April, 2 shifts`}
      />,
    );
    expect(screen.getAllByRole('gridcell', { name: /2 shifts/ }).length).toBeGreaterThan(0);
  });
});

describe('MonthGrid — feature content', () => {
  it('renders per-day content supplied by the feature', () => {
    render(
      <MonthGrid
        month={APRIL_2026}
        renderDay={(ctx) => <span>{ctx.date.getDate() === 15 ? 'BUSY' : ctx.date.getDate()}</span>}
      />,
    );
    expect(screen.getByText('BUSY')).toBeInTheDocument();
  });

  it('applies feature modifiers as classes', () => {
    render(
      <MonthGrid
        month={APRIL_2026}
        dayModifiers={{ locked: (d) => d.getDate() === 15 && d.getMonth() === 3 }}
        modifiersClassNames={{ locked: 'test-locked' }}
      />,
    );
    const day15 = screen.getByRole('gridcell', { name: /Wednesday,? 15 April 2026/ });
    expect(day15).toHaveClass('test-locked');
  });

  it('keeps overlay content out of the day button', () => {
    const { container } = render(
      <MonthGrid
        month={APRIL_2026}
        renderOverlay={(ctx) =>
          ctx.date.getDate() === 15 && ctx.date.getMonth() === 3 ? (
            <button type="button" tabIndex={-1}>
              chip
            </button>
          ) : null
        }
      />,
    );
    const chip = screen.getByText('chip');
    // A button inside a button is invalid HTML and swallows clicks.
    expect(chip.closest('button')).toBe(chip);
    expect(container.querySelector('button button')).toBeNull();
  });
});

describe('Calendar primitive', () => {
  it('defaults to a Monday-start week without being told', () => {
    render(<Calendar mode="single" defaultMonth={APRIL_2026} />);
    expect(screen.getAllByRole('columnheader')[0]).toHaveTextContent('Mon');
  });

  it('still starts on Monday when a caller passes no options at all', () => {
    render(<Calendar defaultMonth={APRIL_2026} />);
    expect(screen.getAllByRole('columnheader')[0]).toHaveAttribute('aria-label', 'Monday');
  });

  it('marks public holidays with an announced name', () => {
    render(<Calendar mode="single" defaultMonth={APRIL_2026} />);
    expect(screen.getByRole('gridcell', { name: /Good Friday, public holiday/ })).toBeInTheDocument();
  });
});
