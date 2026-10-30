/**
 * The confirmation used for deleting a sub-group, undoing a template
 * application and applying a template on top of existing shifts. It must show
 * the dry run's answer before offering the button, hold the button when staff
 * already rely on the shifts until that is acknowledged, and stay open when the
 * action itself fails.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { ImpactConfirmDialog } from '../ImpactConfirmDialog';
import type { ChangeSummary } from '../rosterChangeCopy';

const summary = (over: Partial<ChangeSummary> = {}): ChangeSummary => ({
  lines: ['5 shifts will be permanently deleted from 3 days.'],
  warnings: [],
  blocked: null,
  needsAcknowledgement: false,
  confirmLabel: 'Delete 5 shifts',
  ...over,
});

function Harness({ load, onConfirm }: { load: () => Promise<ChangeSummary>; onConfirm: () => Promise<void> }) {
  const [open, setOpen] = React.useState(true);
  return (
    <>
      <span data-testid="open">{String(open)}</span>
      <ImpactConfirmDialog open={open} onOpenChange={setOpen} title="Delete “AM Base”?" description="Theatre" load={load} onConfirm={onConfirm} />
    </>
  );
}

describe('ImpactConfirmDialog', () => {
  it('shows the dry run, then confirms and closes', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<Harness load={() => Promise.resolve(summary())} onConfirm={onConfirm} />);

    expect(screen.getByText('Checking what this changes…')).toBeTruthy();
    expect(await screen.findByText('5 shifts will be permanently deleted from 3 days.')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Delete 5 shifts' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByTestId('open').textContent).toBe('false'));
  });

  it('holds the button until shifts staff rely on are acknowledged', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<Harness
      load={() => Promise.resolve(summary({ warnings: ['2 shifts are assigned to staff.'], needsAcknowledgement: true }))}
      onConfirm={onConfirm}
    />);

    const confirm = await screen.findByRole('button', { name: 'Delete 5 shifts' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('2 shifts are assigned to staff.')).toBeTruthy();

    await userEvent.click(screen.getByRole('checkbox'));
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('offers no confirm button when the change is blocked', async () => {
    render(<Harness
      load={() => Promise.resolve(summary({ lines: [], blocked: 'There is nothing to delete.' }))}
      onConfirm={vi.fn()}
    />);
    expect(await screen.findByText('There is nothing to delete.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('stays open when the action fails, so it can be retried or cancelled', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('network'));
    render(<Harness load={() => Promise.resolve(summary())} onConfirm={onConfirm} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete 5 shifts' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(screen.getByTestId('open').textContent).toBe('true');
    expect((screen.getByRole('button', { name: 'Delete 5 shifts' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('reports a failed dry run and can try again', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('Not authorised: shift.delete is not granted to you in this scope'))
      .mockResolvedValueOnce(summary());
    render(<Harness load={load} onConfirm={vi.fn()} />);

    expect(await screen.findByText(/Not authorised/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete 5 shifts' })?.hasAttribute('disabled') ?? true).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByText('5 shifts will be permanently deleted from 3 days.')).toBeTruthy();
  });
});
