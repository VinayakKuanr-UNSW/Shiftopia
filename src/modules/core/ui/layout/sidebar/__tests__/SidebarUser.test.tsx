import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarUser } from '../SidebarUser';
import type { Persona } from '@/platform/auth/PersonaProvider';

const authMocks = vi.hoisted(() => ({
  user: {
    fullName: 'Jane Doe',
    avatar: null,
    systemRole: 'Team Member',
  },
  logout: vi.fn(),
  hasPermission: vi.fn().mockReturnValue(true),
  activeCertificate: null,
}));

const personaMocks = vi.hoisted(() => ({
  persona: 'employee' as Persona,
  canSwitch: false,
  availablePersonas: ['employee', 'employer'] as Persona[],
  displayLevel: 'alpha' as string | null,
  setPersona: vi.fn(),
}));

const themeMocks = vi.hoisted(() => ({
  theme: 'dark' as 'dark' | 'light',
  isDark: true,
  toggleTheme: vi.fn(),
}));

vi.mock('@/platform/auth/PersonaProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/auth/PersonaProvider')>();
  return {
    ...actual,
    usePersona: () => ({
      persona: personaMocks.persona,
      canSwitch: personaMocks.canSwitch,
      availablePersonas: personaMocks.availablePersonas,
      displayLevel: personaMocks.displayLevel,
      setPersona: personaMocks.setPersona,
      togglePersona: vi.fn(),
      employeeCertificate: null,
      employerCertificate: null,
    }),
  };
});

vi.mock('@/platform/auth/useAuth', () => ({
  useAuth: () => ({
    user: authMocks.user,
    logout: authMocks.logout,
    hasPermission: authMocks.hasPermission,
    activeCertificate: authMocks.activeCertificate,
  }),
}));

vi.mock('@/modules/core/contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: themeMocks.theme,
    isDark: themeMocks.isDark,
    toggleTheme: themeMocks.toggleTheme,
  }),
}));

const CurrentPath: React.FC = () => {
  const { pathname } = useLocation();
  return <div data-testid="current-path">{pathname}</div>;
};

function renderSidebarUser(initialPath = '/my-roster'): void {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <SidebarUser />
      <CurrentPath />
    </MemoryRouter>,
  );
}

describe('SidebarUser', () => {
  beforeEach(() => {
    personaMocks.persona = 'employee';
    personaMocks.canSwitch = false;
    personaMocks.availablePersonas = ['employee', 'employer'];
    personaMocks.displayLevel = 'alpha';
    personaMocks.setPersona.mockReset();
    authMocks.logout.mockReset();
    themeMocks.toggleTheme.mockReset();
  });

  it('renders row 1 with user full name and access certificate badge', () => {
    renderSidebarUser();

    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    // Levels show by name, not alpha–zeta (platform/auth/constants.ts).
    expect(screen.getByText('Employee')).toBeInTheDocument();
  });

  // Radix opens a dropdown on keyboard activation in jsdom (pointer events are
  // not modelled), which is also the path a keyboard user takes.
  const openAccountMenu = () => {
    const trigger = screen.getByRole('button', { name: /account menu: jane doe/i });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
  };

  it('puts profile, theme, settings and log out in the account menu — log out last, after a divider', () => {
    personaMocks.canSwitch = true;
    renderSidebarUser();

    // The mode switch is NOT in the menu: it stays a one-tap button on the card.
    expect(screen.getByRole('button', { name: /current mode: employee/i })).toBeInTheDocument();

    openAccountMenu();
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent?.trim())).toEqual([
      'Profile',
      'Switch to light mode',
      'Settings',
      'Log out',
    ]);
    expect(screen.getByRole('menuitem', { name: 'Profile' })).toHaveAttribute('href', '/profile');
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    // A separator sits between Settings and Log out.
    const sep = screen.getAllByRole('separator').at(-1)!;
    expect(sep.compareDocumentPosition(items[3]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('toggles theme from the account menu', () => {
    renderSidebarUser();
    openAccountMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /switch to light mode/i }));
    expect(themeMocks.toggleTheme).toHaveBeenCalledOnce();
  });

  it('switches persona directly on tap without opening a dropdown menu', () => {
    personaMocks.canSwitch = true;
    personaMocks.persona = 'employee';
    renderSidebarUser('/my-roster');

    const toggleButton = screen.getByRole('button', {
      name: /Current mode: Employee. Switch to Employer mode/i,
    });
    expect(toggleButton).toBeInTheDocument();

    // Clicking should directly switch persona and NOT open a dropdown menu
    fireEvent.click(toggleButton);

    expect(personaMocks.setPersona).toHaveBeenCalledWith('employer');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();

    // Route should navigate to paired route
    expect(screen.getByTestId('current-path').textContent).toBe('/rosters');
  });

  it('cycles across employee -> employer -> admin when admin persona is available', () => {
    personaMocks.canSwitch = true;
    personaMocks.availablePersonas = ['employee', 'employer', 'admin'];
    personaMocks.persona = 'employer';
    renderSidebarUser('/rosters');

    const toggleButton = screen.getByRole('button', {
      name: /Current mode: Employer. Switch to Admin mode/i,
    });
    expect(toggleButton).toBeInTheDocument();

    fireEvent.click(toggleButton);

    expect(personaMocks.setPersona).toHaveBeenCalledWith('admin');
  });

  it('cycles back to employee when on admin', () => {
    personaMocks.canSwitch = true;
    personaMocks.availablePersonas = ['employee', 'employer', 'admin'];
    personaMocks.persona = 'admin';
    renderSidebarUser('/labor-demand');

    const toggleButton = screen.getByRole('button', {
      name: /Current mode: Admin. Switch to Employee mode/i,
    });
    expect(toggleButton).toBeInTheDocument();

    fireEvent.click(toggleButton);

    expect(personaMocks.setPersona).toHaveBeenCalledWith('employee');
  });

  it('disables mode changer when canSwitch is false while keeping the icon visible', () => {
    personaMocks.canSwitch = false;
    renderSidebarUser();

    const modeBtn = screen.getByRole('button', { name: /current mode: employee/i });
    expect(modeBtn).toBeDisabled();
  });

  it('calls logout from the account menu', () => {
    renderSidebarUser();
    openAccountMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: /log out/i }));
    expect(authMocks.logout).toHaveBeenCalledOnce();
  });

  it('collapsed: keeps the one-tap mode button and an account-menu avatar', () => {
    render(
      <MemoryRouter initialEntries={['/my-roster']}>
        <SidebarUser isCollapsed={true} />
      </MemoryRouter>
    );

    expect(screen.getByRole('button', { name: /account menu: Jane Doe/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /current mode: employee/i })).toBeInTheDocument();
  });
});
