import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShiftCardOverflowMenu } from '../ShiftCardOverflowMenu';
import type { Shift } from '@/modules/rosters/domain/shift.entity';

function mockShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    organization_id: 'org-1',
    department_id: 'dept-1',
    sub_department_id: 'sub-1',
    role_id: 'role-1',
    roster_id: 'roster-1',
    roster_subgroup_id: 'subgroup-1',
    shift_date: '2026-11-10',
    start_time: '09:00:00',
    end_time: '17:00:00',
    lifecycle_status: 'Draft',
    assignment_status: 'unassigned',
    bidding_status: 'not_on_bidding',
    fulfillment_status: 'none',
    trading_status: 'NoTrade',
    is_cancelled: false,
    version: 1,
    roles: { id: 'role-1', name: 'Stagehand' },
    ...overrides,
  } as Shift;
}

describe('ShiftCardOverflowMenu', () => {
  it('gives every item and the trigger a 44px touch target', async () => {
    const user = userEvent.setup();
    render(
      <ShiftCardOverflowMenu
        shift={mockShift()}
        onEdit={vi.fn()}
        onAudit={vi.fn()}
        onDetails={vi.fn()}
        onPublish={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const trigger = screen.getByRole('button', { name: 'Actions for Stagehand' });
    expect(trigger).toHaveClass('before:-inset-2');
    await user.click(trigger);

    const items = await screen.findAllByRole('menuitem');
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item).toHaveClass('min-h-[44px]');
  });

  it('renders circular trigger button with accessible name for screen readers', () => {
    render(<ShiftCardOverflowMenu shift={mockShift()} />);

    const trigger = screen.getByRole('button', { name: 'Actions for Stagehand' });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveClass('rounded-full');
  });

  it('displays one-word only items for primary actions with aria-hidden icons', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onAudit = vi.fn();
    const onDetails = vi.fn();

    render(
      <ShiftCardOverflowMenu
        shift={mockShift()}
        onEdit={onEdit}
        onAudit={onAudit}
        onDetails={onDetails}
      />
    );

    const trigger = screen.getByRole('button', { name: 'Actions for Stagehand' });
    await user.click(trigger);

    // Verify exact one-word menu items
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Audit' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Details' })).toBeInTheDocument();

    // Verify no multi-word labels like "Edit Details" or "Edit Shift"
    expect(screen.queryByText(/Edit Shift/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Audit Compliance/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/More/i)).not.toBeInTheDocument();
  });

  it('renders Publish and Delete (not Cancel or Unpublish) for draft shifts', async () => {
    const user = userEvent.setup();
    const onPublish = vi.fn();
    const onUnpublish = vi.fn();
    const onDelete = vi.fn();
    const onCancel = vi.fn();

    render(
      <ShiftCardOverflowMenu
        shift={mockShift({ lifecycle_status: 'Draft' })}
        onPublish={onPublish}
        onUnpublish={onUnpublish}
        onDelete={onDelete}
        onCancel={onCancel}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Actions for Stagehand' }));

    expect(await screen.findByRole('menuitem', { name: 'Publish' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Unpublish' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('renders Unpublish and Cancel (not Delete or Publish) for published shifts', async () => {
    const user = userEvent.setup();
    const onPublish = vi.fn();
    const onUnpublish = vi.fn();
    const onDelete = vi.fn();
    const onCancel = vi.fn();

    render(
      <ShiftCardOverflowMenu
        shift={mockShift({ lifecycle_status: 'Published' })}
        onPublish={onPublish}
        onUnpublish={onUnpublish}
        onDelete={onDelete}
        onCancel={onCancel}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Actions for Stagehand' }));

    expect(await screen.findByRole('menuitem', { name: 'Unpublish' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Publish' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('disables Edit and Delete when shift is locked/past and hides lifecycle actions', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const onPublish = vi.fn();

    render(
      <ShiftCardOverflowMenu
        shift={mockShift({ lifecycle_status: 'Draft' })}
        isPast={true}
        onEdit={onEdit}
        onDelete={onDelete}
        onPublish={onPublish}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Actions for Stagehand' }));

    const editItem = await screen.findByRole('menuitem', { name: 'Edit' });
    expect(editItem).toHaveAttribute('data-disabled');

    const deleteItem = screen.getByRole('menuitem', { name: 'Delete' });
    expect(deleteItem).toHaveAttribute('data-disabled');

    // Publish is completely omitted when past
    expect(screen.queryByRole('menuitem', { name: 'Publish' })).not.toBeInTheDocument();
  });

  it('triggers callbacks when menu items are clicked', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onAudit = vi.fn();

    render(
      <ShiftCardOverflowMenu
        shift={mockShift()}
        onEdit={onEdit}
        onAudit={onAudit}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Actions for Stagehand' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Audit' }));

    expect(onAudit).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
  });
});
