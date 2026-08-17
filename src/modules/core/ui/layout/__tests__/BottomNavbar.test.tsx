import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BottomNavbar from '../BottomNavbar';

const authMocks = vi.hoisted(() => ({
  logout: vi.fn(),
  hasPermission: vi.fn(),
}));

vi.mock('@/platform/auth/useAuth', () => ({
  useAuth: () => ({
    logout: authMocks.logout,
    hasPermission: authMocks.hasPermission,
  }),
}));

vi.mock('@/modules/core/contexts/ThemeContext', () => ({
  useTheme: () => ({ isDark: false, toggleTheme: vi.fn() }),
}));

vi.mock('@/modules/broadcasts/state/useBroadcasts', () => ({
  useEmployeeBroadcastGroups: () => ({ groups: [] }),
  useBroadcastNotifications: () => ({ unreadCount: 0 }),
}));

function renderNavbar(): void {
  render(
    <MemoryRouter initialEntries={['/my-roster']}>
      <BottomNavbar />
    </MemoryRouter>,
  );
}

function openMoreNavigation(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Open more navigation' }));
}

describe('BottomNavbar', () => {
  beforeEach(() => {
    authMocks.logout.mockReset();
    authMocks.hasPermission.mockReset();
    authMocks.hasPermission.mockReturnValue(true);
  });

  it('hides More links when the user lacks their route permission', () => {
    authMocks.hasPermission.mockImplementation(
      (permission: string) => permission === 'my-broadcasts',
    );

    renderNavbar();
    openMoreNavigation();

    expect(screen.getByRole('link', { name: 'Radio' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Rosters' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Manager Bids' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Timesheets' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
  });

  it('keeps the remote two-step sign-out behaviour', () => {
    renderNavbar();
    openMoreNavigation();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(authMocks.logout).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));
    expect(authMocks.logout).toHaveBeenCalledOnce();
  });
});
