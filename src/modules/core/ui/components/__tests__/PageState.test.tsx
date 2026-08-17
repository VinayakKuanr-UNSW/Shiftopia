import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PageState } from '../PageState';

describe('PageState', () => {
  it('announces loading accessibly', () => {
    render(<PageState state="loading" title="Loading roster" />);

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Loading roster')).toBeInTheDocument();
  });

  it('uses a supplied layout-aware skeleton for loading', () => {
    render(<PageState state="loading" skeleton={<div data-testid="roster-skeleton" />} />);

    expect(screen.getByTestId('roster-skeleton')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it('offers a retry action for errors', () => {
    const onRetry = vi.fn();
    render(<PageState state="error" title="Couldn’t load roster" onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t load roster');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('offers a useful next action for empty states', () => {
    const onClick = vi.fn();
    render(<PageState state="empty" action={{ label: 'Create template', onClick }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Create template' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
