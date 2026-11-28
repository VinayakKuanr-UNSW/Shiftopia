/**
 * PayRatesSettings — ensures organizations with zero published rate cards
 * (e.g. a newly onboarded venue like BCEC) still render the tab bar and open
 * on Versions so payroll.manage administrators can create and publish their
 * first rate card instead of hitting a dead-end empty screen.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({
  auth: {
    user: {
      certificates: [{
        id: 'c1', userId: 'u1', certificateType: 'Y', accessLevel: 'zeta',
        organizationId: 'org-bcec', departmentId: null, subDepartmentId: null, isActive: true,
      }],
    },
    accessScope: { organizationId: 'org-bcec' },
  },
  ebaSchedule: [] as any[],
  listCards: vi.fn(),
}));

vi.mock('@/platform/auth/useAuth', () => ({ useAuth: () => h.auth }));
vi.mock('../state/useEbaRates', () => ({
  useEbaRates: () => ({ schedule: h.ebaSchedule, isLoading: false, error: null, refetch: vi.fn() }),
  useTraineeRates: () => ({ schedule: [] }),
}));
vi.mock('../data/rateCards.api', async (importActual) => ({
  ...(await importActual<typeof import('../data/rateCards.api')>()),
  listRateCards: h.listCards,
}));

import { PayRatesSettings } from '../ui/rate-admin/PayRatesSettings';

function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <PayRatesSettings />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup() };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.ebaSchedule = [];
  h.listCards.mockResolvedValue([]);
});

describe('PayRatesSettings empty-org behavior', () => {
  it('opens on Versions with New card… accessible when an organization has 0 published cards', async () => {
    renderSettings();

    // All tabs remain visible (no early-return lockout).
    expect(screen.getByRole('tab', { name: 'Versions' })).toHaveAttribute('data-state', 'active');
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument();

    // RateCardPeriods mounts inside Versions and offers New card… to zeta admin.
    expect(await screen.findByRole('button', { name: /New card/i })).toBeInTheDocument();
  });

  it('shows an actionable empty state on Overview that navigates back to Versions', async () => {
    const { user } = renderSettings();

    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(screen.getByText('No published rate card yet')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open Versions' }));
    expect(screen.getByRole('tab', { name: 'Versions' })).toHaveAttribute('data-state', 'active');
  });
});
