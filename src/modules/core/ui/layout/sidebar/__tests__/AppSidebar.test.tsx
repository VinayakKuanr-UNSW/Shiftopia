import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppSidebar from '../AppSidebar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
  persona: 'employee',
  canSwitch: true,
  availablePersonas: ['employee', 'employer'],
  displayLevel: 'alpha',
  setPersona: vi.fn(),
}));

vi.mock('@/modules/core/contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: 'dark',
    isDark: true,
    toggleTheme: vi.fn(),
  }),
}));

const sidebarStateMock = vi.hoisted(() => ({
  state: 'expanded',
  toggleSidebar: vi.fn(),
  isMobile: false,
}));

vi.mock('@/platform/auth/PersonaProvider', () => ({
  usePersona: () => ({
    persona: personaMocks.persona,
    canSwitch: personaMocks.canSwitch,
    availablePersonas: personaMocks.availablePersonas,
    displayLevel: personaMocks.displayLevel,
    setPersona: personaMocks.setPersona,
  }),
}));

vi.mock('@/platform/auth/useAuth', () => ({
  useAuth: () => ({
    user: authMocks.user,
    logout: authMocks.logout,
    hasPermission: authMocks.hasPermission,
    activeCertificate: authMocks.activeCertificate,
  }),
}));

vi.mock('@/modules/core/ui/primitives/sidebar', () => ({
  useSidebar: () => ({
    state: sidebarStateMock.state,
    toggleSidebar: sidebarStateMock.toggleSidebar,
    isMobile: sidebarStateMock.isMobile,
  }),
}));

vi.mock('@/modules/core/hooks/useNotifications', () => ({
  useNotifications: () => ({
    unreadCount: 3,
  }),
}));

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

function renderSidebar(initialPath = '/my-roster') {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <AppSidebar />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AppSidebar', () => {
  beforeEach(() => {
    sidebarStateMock.state = 'expanded';
    sidebarStateMock.isMobile = false;
    sidebarStateMock.toggleSidebar.mockReset();
    personaMocks.persona = 'employee';
  });

  it('renders branding logo, search bar, and user profile', () => {
    renderSidebar();

    expect(screen.getByText('ShiftoPia')).toBeInTheDocument();
    expect(screen.queryByText('MAIN')).not.toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('renders employee navigation sections and tree leaf links in expanded mode', () => {
    renderSidebar();

    // Group headings
    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.getByText('Requests')).toBeInTheDocument();
    expect(screen.getByText('Communication')).toBeInTheDocument();

    // Leaf links
    expect(screen.getByText('My Roster')).toBeInTheDocument();
    expect(screen.getByText('Clock In / Out')).toBeInTheDocument();
    expect(screen.getByText('Availabilities')).toBeInTheDocument();
  });

  it('renders employer navigation sections when persona is employer', () => {
    personaMocks.persona = 'employer';
    renderSidebar('/rosters');

    expect(screen.getByText('Rostering')).toBeInTheDocument();
    expect(screen.getByText('Management')).toBeInTheDocument();
    expect(screen.getByText('Features')).toBeInTheDocument();

    expect(screen.getByText('Rosters')).toBeInTheDocument();
    expect(screen.getByText('Templates')).toBeInTheDocument();
    expect(screen.getByText('Timesheet')).toBeInTheDocument();
  });

  it('toggles sidebar state when clicking the edge collapse button', () => {
    renderSidebar();

    const collapseBtn = screen.getByRole('button', { name: /collapse navigation sidebar/i });
    expect(collapseBtn).toBeInTheDocument();

    fireEvent.click(collapseBtn);
    expect(sidebarStateMock.toggleSidebar).toHaveBeenCalledOnce();
  });

  it('renders in collapsed icon-rail mode without text labels', () => {
    sidebarStateMock.state = 'collapsed';
    renderSidebar();

    // In collapsed mode, expanded text labels are not rendered
    expect(screen.queryByText('ShiftoPia')).not.toBeInTheDocument();
    expect(screen.queryByText('My Roster')).not.toBeInTheDocument();

    // The collapse button now says "Expand navigation sidebar"
    const expandBtn = screen.getByRole('button', { name: /expand navigation sidebar/i });
    expect(expandBtn).toBeInTheDocument();

    // Collapsed search icon button is present
    const searchBtn = screen.getByRole('button', { name: /search navigation/i });
    expect(searchBtn).toBeInTheDocument();
  });

  it('opens quick search dialog when clicking search button', () => {
    renderSidebar();

    const searchBtn = screen.getByRole('button', { name: /search navigation/i });
    fireEvent.click(searchBtn);

    expect(screen.getByPlaceholderText(/search pages or jump to route/i)).toBeInTheDocument();
  });
});
