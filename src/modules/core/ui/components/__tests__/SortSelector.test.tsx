import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SortSelector } from '../SortSelector';
import { DEFAULT_ROW_SORT, type RowSort } from '@/modules/core/lib/row-sorting';

describe('SortSelector', () => {
  it('renders an icon trigger by default with accessible tooltip label', () => {
    render(
      <SortSelector
        value={DEFAULT_ROW_SORT}
        onChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Sort: Date, earliest first' });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-pressed', 'false');
  });

  it('indicates active state when sort differs from default', () => {
    const activeSort: RowSort = { by: 'role', direction: 'desc' };
    render(
      <SortSelector
        value={activeSort}
        onChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('button', { name: /Sort: Role/ });
    expect(trigger).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders dropdown trigger variant when requested', () => {
    render(
      <SortSelector
        value={DEFAULT_ROW_SORT}
        onChange={vi.fn()}
        triggerVariant="dropdown"
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Sort: Date, earliest first' });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent('Sort');
    expect(trigger).toHaveTextContent('Date');
  });

  it('opens detached command popover and allows selecting sort field and direction', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SortSelector
        value={DEFAULT_ROW_SORT}
        onChange={onChange}
        options={['date', 'role', 'status']}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Sort: Date, earliest first' });
    await user.click(trigger);

    expect(screen.getByPlaceholderText('Search sort options...')).toBeInTheDocument();
    expect(screen.getByText('Sort By')).toBeInTheDocument();
    expect(screen.getByText('Direction')).toBeInTheDocument();

    const roleOption = screen.getByText('Role');
    await user.click(roleOption);

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ by: 'role' }));
  });
});
