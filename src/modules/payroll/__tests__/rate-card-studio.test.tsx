/**
 * The Rate Card Studio (Versions tab → New card / Edit): what each control
 * sends to the authoring RPCs, and who is offered them. The API module is
 * mocked (rate-cards-api.test.ts covers the RPC payloads); the hooks,
 * helpers and components are real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RateCard } from '../data/rateCards.api';
import { ICC_SYDNEY_EA_LOADINGS } from '@/modules/rosters/domain/projections/utils/cost/loadings';

const h = vi.hoisted(() => ({
  auth: { user: { certificates: [] as unknown[] }, accessScope: { organizationId: 'org-1' } },
  list: vi.fn(), create: vi.fn(), copy: vi.fn(), upsertRates: vi.fn(), bulk: vi.fn(),
  loadings: vi.fn(), copyItems: vi.fn(), estimate: vi.fn(), jurisdiction: vi.fn(),
}));

vi.mock('@/platform/auth/useAuth', () => ({ useAuth: () => h.auth }));
vi.mock('../data/rateCards.api', async (importActual) => ({
  ...(await importActual<typeof import('../data/rateCards.api')>()),
  listRateCards: h.list,
  createRateCard: h.create,
  copyRateCard: h.copy,
  upsertRateCardRates: h.upsertRates,
  bulkAdjustRateCardRates: h.bulk,
  updateRateCardLoadings: h.loadings,
  copyRateCardItems: h.copyItems,
  estimateShiftCost: h.estimate,
  getOrganizationJurisdiction: h.jurisdiction,
}));

import RateCardPeriods from '../ui/rate-admin/components/RateCardPeriods';

const zeta = { id: 'c', userId: 'u', certificateType: 'Y', accessLevel: 'zeta', organizationId: 'org-1', departmentId: null, subDepartmentId: null, isActive: true };
const epsilon = { ...zeta, accessLevel: 'epsilon' };

const card = (o: Partial<RateCard>): RateCard => ({
  id: 'id', organizationId: 'org-1', code: 'CODE', name: 'Name', currency: 'AUD', ruleSet: 'icc_sydney_ea',
  validFrom: '2025-01-01', validTo: null, status: 'published', derivation: null, publishedAt: null,
  notes: null, awardFloorCheckedAt: null, rates: [], allowances: [], loadings: { ...ICC_SYDNEY_EA_LOADINGS }, trainee: null, ...o,
});
const L2_CASUAL = { classification: 'LEVEL_2', employmentBasis: 'casual', ordinaryHourlyRate: 31.26, paidHourlyRate: 39.08, isManualOverride: false, notes: null };
const C2026 = card({
  id: 'b', code: 'ICC-EA-2026-27', validFrom: '2026-07-06',
  rates: [{ ...L2_CASUAL, ordinaryHourlyRate: 30, paidHourlyRate: 37.5 }],
});
const DRAFT = card({ id: 'd', code: 'ICC-EA-2027-28', validFrom: '2099-07-05', status: 'draft', rates: [L2_CASUAL] });

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><RateCardPeriods /></QueryClientProvider>);
  return userEvent.setup();
}

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Edit' }));
  return screen.getByRole('region', { name: 'Edit draft ICC-EA-2027-28' });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.user.certificates = [zeta];
  h.list.mockResolvedValue([C2026, DRAFT]);
  h.jurisdiction.mockResolvedValue('AU-NSW');
});

describe('who is offered the studio', () => {
  it('view-only (epsilon) gets neither New card nor Edit', async () => {
    h.auth.user.certificates = [epsilon];
    renderTab();
    await screen.findByText('ICC-EA-2027-28');
    expect(screen.queryByRole('button', { name: 'New card…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });
});

describe('new card', () => {
  it('blank: creates a draft in the active organization', async () => {
    h.create.mockResolvedValue('new-id');
    const user = renderTab();
    await user.click(await screen.findByRole('button', { name: 'New card…' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByLabelText('Blank card'));
    await user.type(within(dialog).getByLabelText('Code'), 'BCEC-EA-2026');
    await user.type(within(dialog).getByLabelText('Name'), 'BCEC Agreement');
    await user.type(within(dialog).getByLabelText('Applies from'), '2026-07-01');
    await user.click(within(dialog).getByRole('button', { name: 'Create draft' }));
    await waitFor(() => expect(h.create).toHaveBeenCalledWith({
      organizationId: 'org-1', code: 'BCEC-EA-2026', name: 'BCEC Agreement', validFrom: '2026-07-01', notes: '',
    }));
  });

  it('copy: sends the chosen source, toggles and multiplier; checks the form first', async () => {
    h.copy.mockResolvedValue('copy-id');
    const user = renderTab();
    await user.click(await screen.findByRole('button', { name: 'New card…' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Create draft' }));
    expect(within(dialog).getByText('Enter a code, e.g. BCEC-EA-2026.')).toBeInTheDocument();
    expect(h.copy).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText('Code'), 'ICC-COPY');
    await user.type(within(dialog).getByLabelText('Name'), 'Copy');
    await user.type(within(dialog).getByLabelText('Applies from'), '2030-07-01');
    await user.click(within(dialog).getByLabelText('Allowances'));
    await user.clear(within(dialog).getByLabelText('Multiplier'));
    await user.type(within(dialog).getByLabelText('Multiplier'), '1.05');
    await user.click(within(dialog).getByRole('button', { name: 'Create draft' }));
    await waitFor(() => expect(h.copy).toHaveBeenCalledWith({
      sourceCardId: 'b', code: 'ICC-COPY', name: 'Copy', validFrom: '2030-07-01',
      rates: true, allowances: false, trainee: true, multiplier: 1.05,
    }));
  });
});

describe('base rates', () => {
  it('a casual line follows ordinary × (1 + casual loading); the paid rate is left to the database', async () => {
    h.upsertRates.mockResolvedValue(1);
    const user = renderTab();
    const editor = await openEditor(user);
    const ordinary = within(editor).getByLabelText('Level 2 casual ordinary rate');
    await user.clear(ordinary);
    await user.type(ordinary, '30');
    expect(within(editor).getByLabelText('Level 2 casual paid rate')).toHaveTextContent('$37.50');
    await user.click(within(editor).getByRole('button', { name: 'Save 1 change' }));
    await waitFor(() => expect(h.upsertRates).toHaveBeenCalledWith('d', [{
      classification: 'LEVEL_2', employmentBasis: 'casual', ordinaryHourlyRate: 30, isManualOverride: false, notes: null,
    }]));
  });

  it('marked Manual, the casual paid rate is sent as typed', async () => {
    h.upsertRates.mockResolvedValue(1);
    const user = renderTab();
    const editor = await openEditor(user);
    await user.click(within(editor).getByLabelText('Level 2 casual manual rate'));
    const paid = within(editor).getByLabelText('Level 2 casual paid rate');
    await user.clear(paid);
    await user.type(paid, '40');
    await user.click(within(editor).getByRole('button', { name: 'Save 1 change' }));
    await waitFor(() => expect(h.upsertRates).toHaveBeenCalledWith('d', [expect.objectContaining({
      paidHourlyRate: 40, isManualOverride: true,
    })]));
  });

  it('selected lines are raised by a percentage', async () => {
    h.bulk.mockResolvedValue(1);
    const user = renderTab();
    const editor = await openEditor(user);
    await user.click(within(editor).getByLabelText('Select Level 2 casual'));
    await user.type(within(editor).getByLabelText(/Adjust 1 selected classification/), '5');
    await user.click(within(editor).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(h.bulk).toHaveBeenCalledWith('d', ['LEVEL_2'], 1.05));
  });

  it('lines are copied from another card', async () => {
    h.copyItems.mockResolvedValue(1);
    const user = renderTab();
    const editor = await openEditor(user);
    await user.selectOptions(within(editor).getByLabelText('Copy rates from another card'), 'b');
    await user.click(within(editor).getByLabelText('Copy Level 2'));
    await user.click(within(editor).getByRole('button', { name: 'Copy 1 classification' }));
    await waitFor(() => expect(h.copyItems).toHaveBeenCalledWith('d', 'b', ['LEVEL_2']));
  });

  it('a refusal is shown in plain words', async () => {
    h.upsertRates.mockRejectedValue({ code: '22023', message: 'LEVEL_2 casual: paid 99 is not ordinary × (1 + 0.25) = 37.50' });
    const user = renderTab();
    const editor = await openEditor(user);
    await user.click(within(editor).getByLabelText('Level 2 casual manual rate'));
    await user.click(within(editor).getByRole('button', { name: 'Save 1 change' }));
    expect(await within(editor).findByRole('alert')).toHaveTextContent('Check the details: LEVEL_2 casual: paid 99');
  });
});

describe('loadings', () => {
  it('percentages are typed as percent and sent as fractions', async () => {
    h.loadings.mockResolvedValue(undefined);
    const user = renderTab();
    const editor = await openEditor(user);
    await user.click(within(editor).getByRole('tab', { name: 'Loadings & rules' }));
    const sat = within(editor).getByLabelText('Saturday (cl 41) (%)');
    expect(sat).toHaveValue('25');
    await user.clear(sat);
    await user.type(sat, '30');
    await user.click(within(editor).getByRole('button', { name: 'Save 1 change' }));
    await waitFor(() => expect(h.loadings).toHaveBeenCalledWith('d', { saturdayLoading: 0.3 }));
  });
});

describe('cost sandbox', () => {
  it('prices the shift on the draft and on the published card covering the date', async () => {
    h.estimate.mockImplementation(async (cardId: string) => (cardId === 'd' ? 300 : 280));
    const user = renderTab();
    const editor = await openEditor(user);
    await user.click(within(editor).getByRole('tab', { name: 'Cost sandbox' }));
    await user.click(within(editor).getByRole('button', { name: 'Price this shift' }));
    const dl = await within(editor).findByLabelText('Sandbox result');
    expect(dl).toHaveTextContent('$300.00');
    expect(dl).toHaveTextContent('ICC-EA-2026-27 (published)');
    expect(dl).toHaveTextContent('$280.00');
    expect(dl).toHaveTextContent('+$20.00 (+7.14%)');
    expect(h.estimate).toHaveBeenCalledWith('d', 'AU-NSW', {
      shiftDate: '2099-07-05', startTime: '09:00', minutes: 420, baseRate: 39.08, employmentType: 'Casual',
    });
    expect(h.estimate).toHaveBeenCalledWith('b', 'AU-NSW', expect.objectContaining({ baseRate: 37.5 }));
  });
});
