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
    it('renders the compact shift card, rules, reason input, and accessible actions', () => {
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
        />
      );

      // Drawer Title
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

      // Reason input
      const reasonInput = screen.getByLabelText(/Reason for Drop/);
      expect(reasonInput).toBeInTheDocument();

      // Action Buttons
      const keepBtn = screen.getByRole('button', { name: 'Keep Shift' });
      const dropBtn = screen.getByRole('button', { name: 'Confirm Drop' });
      expect(keepBtn).toBeInTheDocument();
      expect(dropBtn).toBeDisabled();

      // Enter reason and confirm
      fireEvent.change(reasonInput, { target: { value: 'Unable to attend due to family commitment' } });
      expect(dropBtn).toBeEnabled();

      fireEvent.click(dropBtn);
      expect(onConfirmDrop).toHaveBeenCalledWith('Unable to attend due to family commitment');

      // Dismiss with Keep Shift
      fireEvent.click(keepBtn);
      expect(onClose).toHaveBeenCalled();
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
