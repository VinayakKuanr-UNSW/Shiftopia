import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MobileViewRangeToggle } from '../MobileViewRangeToggle';

describe('MobileViewRangeToggle', () => {
  it('exposes the four ranges as a radiogroup with the current one checked', () => {
    render(<MobileViewRangeToggle value="week" onChange={vi.fn()} />);

    expect(screen.getByRole('radiogroup', { name: 'View range' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.getByRole('radio', { name: 'Week view' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'Day view' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('spells the abbreviation out in the accessible name', () => {
    // The visible label is "3D"; on its own that tells a screen-reader user
    // nothing, so the button is named for the range it selects.
    render(<MobileViewRangeToggle value="day" onChange={vi.fn()} />);

    const threeDay = screen.getByRole('radio', { name: '3-Day view' });
    expect(threeDay).toHaveTextContent('3D');
  });

  it('reports the selected range', () => {
    const onChange = vi.fn();
    render(<MobileViewRangeToggle value="week" onChange={onChange} />);

    screen.getByRole('radio', { name: 'Month view' }).click();

    expect(onChange).toHaveBeenCalledWith('month');
  });
});
