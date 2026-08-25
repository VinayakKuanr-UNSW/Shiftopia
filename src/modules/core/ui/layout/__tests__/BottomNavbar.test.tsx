import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BottomNavbar from '../BottomNavbar';

const authMocks = vi.hoisted(() => ({
  logout: vi.fn(),
  hasPermission: vi.fn(),
}));

const personaMocks = vi.hoisted(() => ({
  persona: 'employee' as 'employee' | 'employer',
  canSwitch: false,
  togglePersona: vi.fn(),
}));

vi.mock('@/platform/auth/PersonaProvider', () => ({
  usePersona: () => ({
    persona: personaMocks.persona,
    canSwitch: personaMocks.canSwitch,
    togglePersona: personaMocks.togglePersona,
    setPersona: vi.fn(),
    employeeCertificate: null,
    employerCertificate: null,
    displayLevel: 'alpha',
  }),
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
    personaMocks.persona = 'employee';
    personaMocks.canSwitch = false;
    personaMocks.togglePersona.mockReset();
  });

  // NOTE: this asserts the EMPLOYEE persona hides employer links. It used to be
  // the permission test, but once the nav split by persona it would have passed
  // whatever hasPermission returned — the employer entries are not in this
  // persona's list at all. The permission filtering is now tested where it
  // actually applies, in the employer persona below.
  it('hides employer links from the employee persona', () => {
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

  it('does not offer the persona switch to someone who cannot switch', () => {
    renderNavbar();
    openMoreNavigation();
    expect(screen.queryByRole('button', { name: /Switch to employer view/ })).not.toBeInTheDocument();
  });

  it('offers the persona switch when the user holds employer permissions', () => {
    personaMocks.canSwitch = true;
    renderNavbar();
    openMoreNavigation();

    fireEvent.click(screen.getByRole('button', { name: 'Switch to employer view' }));
    expect(personaMocks.togglePersona).toHaveBeenCalledOnce();
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

describe('BottomNavbar — employer persona', () => {
  beforeEach(() => {
    authMocks.logout.mockReset();
    authMocks.hasPermission.mockReset();
    personaMocks.persona = 'employer';
    personaMocks.canSwitch = true;
    personaMocks.togglePersona.mockReset();
  });

  it('shows employer surfaces and drops the employee ones', () => {
    authMocks.hasPermission.mockReturnValue(true);
    renderNavbar();

    expect(screen.getByRole('link', { name: 'Rosters' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Roster' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Atten' })).not.toBeInTheDocument();
  });

  // The one that matters: permission filtering must happen BEFORE the first
  // four are taken for tabs, or a user holding one permission gets three dead
  // tabs and one real one.
  it('fills the tab slots with what the user can actually reach', () => {
    authMocks.hasPermission.mockImplementation((p: string) => p === 'insights');
    renderNavbar();

    expect(screen.getByRole('link', { name: 'KPI' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Rosters' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Templates' })).not.toBeInTheDocument();
  });

  it('keeps Settings reachable from either persona', () => {
    authMocks.hasPermission.mockReturnValue(false);
    renderNavbar();
    openMoreNavigation();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });
});
