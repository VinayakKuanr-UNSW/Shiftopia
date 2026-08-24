import { describe, expect, it, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { DropShiftDrawer } from '../DropShiftDrawer';
import { CreateSwapRequestModal } from '../CreateSwapRequestModal';

const mockCreateSwap = vi.fn().mockImplementation((_payload, options) => {
  options?.onSuccess?.();
});

vi.mock('@/platform/auth/useAuth', () => ({
  useAuth: vi.fn().mockReturnValue({
    user: { id: 'test-user-1', employmentType: 'Full-Time' },
    hasPermission: vi.fn().mockReturnValue(true),
  }),
}));

vi.mock('@/modules/planning', () => ({
  useSwaps: vi.fn().mockReturnValue({
    createSwap: (...args: any[]) => mockCreateSwap(...args),
  }),
}));

// The drop drawer reads the seeded reason catalogue. Mocked here so the test
// exercises the picker without a QueryClient.
vi.mock('@/modules/insights/hooks/useCancellationReasons', () => ({
  useCancellationReasons: vi.fn().mockReturnValue({
    isLoading: false,
    data: [
      { code: 'ILLNESS', label: 'Illness', description: null, requires_note: false, sort_order: 10 },
      { code: 'TRANSPORT', label: 'Transport problem', description: null, requires_note: false, sort_order: 40 },
      { code: 'OTHER', label: 'Other', description: null, requires_note: true, sort_order: 999 },
    ],
  }),
}));

vi.mock('@/modules/core/hooks/use-toast', () => ({
  useToast: vi.fn().mockReturnValue({
    toast: vi.fn(),
  }),
}));

// Mock Drawer primitive for standard DOM rendering in jsdom
vi.mock('@/modules/core/ui/primitives/drawer', () => ({
  Drawer: ({ children, open }: any) => (open ? <div role="dialog">{children}</div> : null),
  DrawerContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  DrawerHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  DrawerTitle: ({ children, ...props }: any) => <h2 {...props}>{children}</h2>,
  DrawerDescription: ({ children, ...props }: any) => <p {...props}>{children}</p>,
  DrawerFooter: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  DrawerClose: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

describe('Swap and Drop Bottom Sheet Drawers', () => {
  const sampleShift = {
    id: 'shift-101',
    start_time: '08:00:00',
    end_time: '16:30:00',
    paid_break_minutes: 0,
    unpaid_break_minutes: 30,
    break_minutes: 30,
    remuneration_level: 4,
    roles: { name: 'Team Leader' },
    departments: { name: 'Theatre' },
    target_employment_type: 'FT',
    assigned_employee_id: 'test-user-1',
  } as any;

  describe('DropShiftDrawer', () => {
    const renderDrawer = (overrides: Record<string, unknown> = {}) => {
      const onClose = vi.fn();
      const onConfirmDrop = vi.fn();
      render(
        <DropShiftDrawer
          isOpen={true}
          onClose={onClose}
          shift={sampleShift}
          shiftDate={new Date('2026-08-20')}
          groupName="Theatre"
          groupColor="red"
          isWithinLockoutPeriod={false}
          onConfirmDrop={onConfirmDrop}
          isDropping={false}
          {...overrides}
        />
      );
      return { onClose, onConfirmDrop };
    };

    it('renders the compact shift card, rules and accessible actions', () => {
      const { onClose } = renderDrawer();

      expect(screen.getByText('Drop Shift Assignment')).toBeInTheDocument();

      // Compact Shift Card elements
      expect(screen.getByText('Team Leader')).toBeInTheDocument();
      expect(screen.getByText('Level 4')).toBeInTheDocument();
      expect(screen.getByText('8h net')).toBeInTheDocument();
      expect(screen.getByText('30m unpaid')).toBeInTheDocument();
      expect(screen.getByText('Full-Time')).toBeInTheDocument();

      // Rules section
      expect(screen.getByText('Drop Rules & Guidelines')).toBeInTheDocument();
      expect(screen.getByText(/Dropped shifts return to the open marketplace/)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Keep Shift' }));
      expect(onClose).toHaveBeenCalled();
    });

    it('offers the seeded reasons as a radio group', () => {
      renderDrawer();
      const group = screen.getByRole('radiogroup', { name: /Reason for dropping this shift/ });
      expect(group).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Illness' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Transport problem' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Other' })).toBeInTheDocument();
    });

    it('requires a reason to be chosen before the drop can be confirmed', () => {
      const { onConfirmDrop } = renderDrawer();
      const dropBtn = screen.getByRole('button', { name: 'Confirm Drop' });

      // A typed note alone is not enough — the structured code is what the
      // manager dashboard aggregates.
      fireEvent.change(screen.getByLabelText(/Anything to add/), { target: { value: 'car broke down' } });
      expect(dropBtn).toBeDisabled();

      fireEvent.click(screen.getByRole('radio', { name: 'Transport problem' }));
      expect(dropBtn).toBeEnabled();

      fireEvent.click(dropBtn);
      expect(onConfirmDrop).toHaveBeenCalledWith('car broke down', 'TRANSPORT');
    });

    it('sends the code with an empty note when no note is typed', () => {
      const { onConfirmDrop } = renderDrawer();
      fireEvent.click(screen.getByRole('radio', { name: 'Illness' }));

      const dropBtn = screen.getByRole('button', { name: 'Confirm Drop' });
      expect(dropBtn).toBeEnabled();
      fireEvent.click(dropBtn);
      expect(onConfirmDrop).toHaveBeenCalledWith('', 'ILLNESS');
    });

    it('demands a note only for a reason that requires one', () => {
      const { onConfirmDrop } = renderDrawer();
      const dropBtn = screen.getByRole('button', { name: 'Confirm Drop' });

      fireEvent.click(screen.getByRole('radio', { name: 'Other' }));
      expect(dropBtn).toBeDisabled();

      // Whitespace is not a note.
      fireEvent.change(screen.getByLabelText(/Tell us more/), { target: { value: '   ' } });
      expect(dropBtn).toBeDisabled();

      fireEvent.change(screen.getByLabelText(/Tell us more/), { target: { value: 'jury duty' } });
      expect(dropBtn).toBeEnabled();
      fireEvent.click(dropBtn);
      expect(onConfirmDrop).toHaveBeenCalledWith('jury duty', 'OTHER');
    });
  });

  describe('CreateSwapRequestModal', () => {
    it('renders the compact shift card, swap rules, reason input, and accessible actions', () => {
      const onClose = vi.fn();

      render(
        <CreateSwapRequestModal
          isOpen={true}
          onClose={onClose}
          shift={sampleShift}
          shiftDate={new Date('2026-08-20')}
          groupName="Theatre"
          groupColor="red"
        />
      );

      // Drawer Title
      expect(screen.getByText('Request Shift Swap')).toBeInTheDocument();

      // Compact Shift Card elements
      expect(screen.getByText('Team Leader')).toBeInTheDocument();
      expect(screen.getByText('Level 4')).toBeInTheDocument();
      expect(screen.getByText('8h net')).toBeInTheDocument();
      expect(screen.getByText('30m unpaid')).toBeInTheDocument();
      expect(screen.getByText('Full-Time')).toBeInTheDocument();

      // Rules section
      expect(screen.getByText('Swap Rules & Guidelines')).toBeInTheDocument();
      expect(screen.getByText(/Must be requested at least 4 hours before the shift start/)).toBeInTheDocument();

      // Reason input
      const reasonInput = screen.getByLabelText(/Reason for Swap/);
      expect(reasonInput).toBeInTheDocument();

      // Action Buttons
      const keepBtn = screen.getByRole('button', { name: 'Keep Shift' });
      const swapBtn = screen.getByRole('button', { name: 'Request Swap' });
      expect(keepBtn).toBeInTheDocument();
      expect(swapBtn).toBeDisabled();

      // Enter reason and submit
      fireEvent.change(reasonInput, { target: { value: 'Need to swap for morning appointment' } });
      expect(swapBtn).toBeEnabled();

      fireEvent.click(swapBtn);
      expect(mockCreateSwap).toHaveBeenCalledWith(
        expect.objectContaining({
          requesterV8ShiftId: 'shift-101',
          requestedByEmployeeId: 'test-user-1',
          reason: 'Need to swap for morning appointment',
        }),
        expect.any(Object)
      );

      // Dismiss with Keep Shift
      fireEvent.click(keepBtn);
      expect(onClose).toHaveBeenCalled();
    });
  });
});
