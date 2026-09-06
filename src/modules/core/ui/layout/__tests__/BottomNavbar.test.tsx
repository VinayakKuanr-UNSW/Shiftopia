import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BottomNavbar from '../BottomNavbar';
import { ALLOWED_MOBILE_ROUTES } from '@/modules/core/ui/components/MobileAccessGuard';

const authMocks = vi.hoisted(() => ({
  logout: vi.fn(),
  hasPermission: vi.fn(),
}));

const personaMocks = vi.hoisted(() => ({
  persona: 'employee' as 'employee' | 'employer',
  canSwitch: false,
  togglePersona: vi.fn(),
}));

vi.mock('@/platform/auth/PersonaProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/auth/PersonaProvider')>();
  return {
    ...actual,
    usePersona: () => ({
      persona: personaMocks.persona,
      canSwitch: personaMocks.canSwitch,
      togglePersona: personaMocks.togglePersona,
      setPersona: vi.fn(),
      employeeCertificate: null,
      employerCertificate: null,
      displayLevel: 'alpha',
    }),
  };
});

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

  it('puts the four employee tabs in the bar', () => {
    renderNavbar();
    for (const label of ['Roster', 'Avail', 'Requests', 'Leave']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('keeps the shared surfaces reachable in the employee persona', () => {
    renderNavbar();
    openMoreNavigation();
    for (const label of ['Notif', 'Profile', 'Settings']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
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

  // Both are actions on the session rather than destinations, so they sit
  // together beneath the grid. Placement regresses silently, so it is pinned.
  it('places the persona switch directly above sign out', () => {
    personaMocks.canSwitch = true;
    renderNavbar();
    openMoreNavigation();

    const lastGridLink = screen.getByRole('link', { name: 'Settings' });
    const persona = screen.getByRole('button', { name: 'Switch to employer view' });
    const signOut = screen.getByRole('button', { name: 'Sign out' });

    // Node.DOCUMENT_POSITION_FOLLOWING === 4. BOTH assertions are needed:
    // "before sign out" alone is satisfied by sitting above the grid too, which
    // is where this button used to be — so that half proves nothing on its own.
    expect(lastGridLink.compareDocumentPosition(persona) & 4).toBeTruthy();
    expect(persona.compareDocumentPosition(signOut) & 4).toBeTruthy();
  });

  // The visible text must BE the accessible name (WCAG SC 2.5.3), or a voice
  // user saying what they can see fails to activate it.
  it('names the switch with its visible text', () => {
    personaMocks.canSwitch = true;
    renderNavbar();
    openMoreNavigation();

    expect(
      screen.getByRole('button', { name: 'Switch to employer view' }),
    ).toHaveTextContent('Switch to employer view');
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

  // The four employer tabs, per the agreed layout:
  // Roster / Team / Requests / Insights, then More.
  it('puts the four employer tabs in the bar', () => {
    authMocks.hasPermission.mockReturnValue(true);
    renderNavbar();

    for (const label of ['Roster', 'Team', 'Requests', 'Insights']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    // Employee-only surfaces are gone from the bar entirely.
    expect(screen.queryByRole('link', { name: 'Avail' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Leave' })).not.toBeInTheDocument();
  });

  // /management/payroll is in the router but NOT in ALLOWED_MOBILE_ROUTES, so
  // offering it here would land on the Desktop Only screen.
  it('never offers payroll on mobile', () => {
    authMocks.hasPermission.mockReturnValue(true);
    renderNavbar();
    openMoreNavigation();
    expect(screen.queryByRole('link', { name: /Payroll/i })).not.toBeInTheDocument();
  });

  // The one that matters: permission filtering must happen BEFORE the first
  // four are taken for tabs, or a user holding one permission gets three dead
  // tabs and one real one.
  it('fills the tab slots with what the user can actually reach', () => {
    authMocks.hasPermission.mockImplementation((p: string) => p === 'insights');
    renderNavbar();

    expect(screen.getByRole('link', { name: 'Insights' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Roster' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Templates' })).not.toBeInTheDocument();
  });

  // Notifications, Profile and Settings belong to the application, not
  // to either persona. Reachable even when the user holds no employer
  // permission at all.
  it('keeps the shared surfaces reachable from either persona', () => {
    authMocks.hasPermission.mockReturnValue(false);
    renderNavbar();
    openMoreNavigation();

    for (const label of ['Notif', 'Profile', 'Settings']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });
});

// The bottom bar IS the phone navigation, and MobileAccessGuard renders the
// "Desktop Only" screen for any path outside its allowlist. Nothing connects
// the two files, so a destination can be added here and be dead on every phone
// — which is exactly what happened to Leave: it shipped pointing at /my-leave
// while the allowlist did not contain it, and every tap hit Desktop Only.
// 41ff0e1 allowlisted it but pinned nothing, so the next entry can repeat it.
// This asserts the join instead of the two halves separately.
describe('every destination the phone nav offers clears the mobile guard', () => {
  function renderedRoutes(): string[] {
    return screen
      .getAllByRole('link')
      .map((el) => el.getAttribute('href') ?? '')
      .filter((href) => href.startsWith('/'));
  }

  function assertAllAllowlisted(routes: string[]): void {
    expect(routes.length).toBeGreaterThan(0);
    const blocked = [...new Set(routes)].filter(
      (route) => !ALLOWED_MOBILE_ROUTES.has(route),
    );
    // Name the offenders — "expected true to be false" would send the next
    // person back to the allowlist to diff it by eye.
    expect(blocked).toEqual([]);
  }

  it('in the employee persona, including the more drawer', () => {
    personaMocks.persona = 'employee';
    renderNavbar();
    const bar = renderedRoutes();
    openMoreNavigation();
    assertAllAllowlisted([...bar, ...renderedRoutes()]);
  });

  it('in the employer persona, holding every permission', () => {
    personaMocks.persona = 'employer';
    personaMocks.canSwitch = true;
    authMocks.hasPermission.mockReturnValue(true);
    renderNavbar();
    const bar = renderedRoutes();
    openMoreNavigation();
    assertAllAllowlisted([...bar, ...renderedRoutes()]);
  });
});
