/**
 * The Versions tab (RateCardPeriods): who is offered the actions, roll-forward
 * validation, and the publish / discard flows with their confirms and the
 * React Query refresh. The API module is mocked (its own test covers the
 * PostgREST calls); the hook and components are real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RateCard } from '../data/rateCards.api';
import { ICC_SYDNEY_EA_LOADINGS } from '@/modules/rosters/domain/projections/utils/cost/loadings';

const h = vi.hoisted(() => ({
  auth: { user: { certificates: [] as unknown[] }, accessScope: { organizationId: 'org-1' } },
  list: vi.fn(),
  roll: vi.fn(),
  publish: vi.fn(),
  discard: vi.fn(),
}));

vi.mock('@/platform/auth/useAuth', () => ({ useAuth: () => h.auth }));
vi.mock('../data/rateCards.api', async (importActual) => ({
  ...(await importActual<typeof import('../data/rateCards.api')>()),
  listRateCards: h.list,
  rollRateCardForward: h.roll,
  publishRateCard: h.publish,
  discardRateCard: h.discard,
}));

import RateCardPeriods from '../ui/rate-admin/components/RateCardPeriods';

const zeta = (organizationId = 'org-1') => ({
  id: 'c', userId: 'u', certificateType: 'Y', accessLevel: 'zeta', organizationId,
  departmentId: null, subDepartmentId: null, isActive: true,
});
const epsilon = { ...zeta(), accessLevel: 'epsilon' };

const card = (o: Partial<RateCard>): RateCard => ({
  id: 'id', code: 'CODE', name: 'Name', validFrom: '2025-01-01', validTo: null, status: 'published',
  derivation: null, publishedAt: null, rates: [], allowances: [], loadings: null, ...o,
});
const C2025 = card({ id: 'a', code: 'ICC-EA-2025', name: 'ICC Sydney EA 2025', validFrom: '2025-01-01', validTo: '2026-07-05' });
const C2026 = card({
  id: 'b', code: 'ICC-EA-2026-27', name: 'ICC Sydney EA 2026–27', validFrom: '2026-07-06',
  rates: [{ classification: 'LEVEL_2', employmentBasis: 'casual', ordinaryHourlyRate: 30, paidHourlyRate: 37.5 }],
  allowances: [{ code: 'meal', amount: 20, unit: 'per_occasion' }],
  loadings: { ...ICC_SYDNEY_EA_LOADINGS },
});
const DRAFT = card({
  id: 'd', code: 'ICC-EA-2027-28', name: 'ICC Sydney EA 2027–28', validFrom: '2099-07-05', status: 'draft',
  derivation: 'ICC-EA-2026-27 × 1.042',
  rates: [{ classification: 'LEVEL_2', employmentBasis: 'casual', ordinaryHourlyRate: 31.26, paidHourlyRate: 39.08 }],
  allowances: [{ code: 'meal', amount: 20.84, unit: 'per_occasion' }],
  loadings: { ...ICC_SYDNEY_EA_LOADINGS },
});

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(<QueryClientProvider client={client}><RateCardPeriods /></QueryClientProvider>);
  return { invalidate, user: userEvent.setup() };
}

const invalidatedKeys = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.map((c: any[]) => c[0].queryKey[0]).sort();

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.user.certificates = [zeta()];
  h.list.mockResolvedValue([C2025, C2026, DRAFT]);
});

describe('the periods list', () => {
  it('lists every card as a period, newest first, with status and derivation', async () => {
    renderTab();
    const items = await screen.findAllByRole('listitem');
    expect(items.map((li) => within(li).getAllByText(/^ICC-EA-/)[0].textContent)).toEqual([
      'ICC-EA-2027-28', 'ICC-EA-2026-27', 'ICC-EA-2025',
    ]);
    expect(within(items[0]).getByText('Draft')).toBeInTheDocument();
    expect(within(items[0]).getByText('Derived from ICC-EA-2026-27 × 1.042')).toBeInTheDocument();
    expect(within(items[1]).getByText(/6 Jul\w* 2026 – open/)).toBeInTheDocument();
    expect(within(items[2]).getByText(/1 Jan 2025 – 5 Jul\w* 2026/)).toBeInTheDocument();
    expect(within(items[2]).getByText('Published')).toBeInTheDocument();
  });

  it('says so when the read fails, rather than showing no cards', async () => {
    h.list.mockRejectedValue({ code: '42703', message: 'bad column' });
    renderTab();
    expect(await screen.findByText('The rate cards could not be read.')).toBeInTheDocument();
  });
});

describe('permission: payroll.manage is zeta in this organization', () => {
  it('zeta is offered Roll forward, Publish and Discard', async () => {
    const { user } = renderTab();
    await user.click(await screen.findByRole('button', { name: 'Review' }));
    expect(screen.getByRole('button', { name: 'Roll forward…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard draft' })).toBeInTheDocument();
  });

  it.each([
    ['epsilon', [epsilon]],
    ['zeta of another organization', [zeta('org-2')]],
  ])('%s is offered none of them', async (_label, certs) => {
    h.auth.user.certificates = certs;
    const { user } = renderTab();
    await user.click(await screen.findByRole('button', { name: 'Review' }));
    expect(screen.queryByRole('button', { name: 'Roll forward…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publish…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Discard draft' })).toBeNull();
  });
});

describe('roll forward', () => {
  it('checks the form before sending anything', async () => {
    const { user } = renderTab();
    await user.click(await screen.findByRole('button', { name: 'Roll forward…' }));
    const dialog = await screen.findByRole('dialog');
    // The source defaults to the latest published card.
    expect(within(dialog).getByLabelText('Source card')).toHaveValue('b');

    await user.click(within(dialog).getByRole('button', { name: 'Create draft' }));
    expect(within(dialog).getByText(/Enter a code/)).toBeInTheDocument();
    expect(within(dialog).getByText('Enter a name.')).toBeInTheDocument();
    expect(within(dialog).getByText(/Enter the date the new rates apply from/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Enter a multiplier/)).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Code'), 'ICC-EA-2026-27');
    await user.type(within(dialog).getByLabelText('Applies from'), '2026-07-01');
    await user.type(within(dialog).getByLabelText('Multiplier'), '2.5');
    await user.click(within(dialog).getByRole('button', { name: 'Create draft' }));
    expect(within(dialog).getByText('A card with this code already exists.')).toBeInTheDocument();
    expect(within(dialog).getByText(/Must be after the source card starts \(2026-07-06\)/)).toBeInTheDocument();
    expect(within(dialog).getByText(/at most 2/)).toBeInTheDocument();

    expect(h.roll).not.toHaveBeenCalled();
  });

  it('the cl 25.1 helper fills the multiplier; a valid form creates the draft and opens its review', async () => {
    h.roll.mockResolvedValue('new-draft');
    const { user, invalidate } = renderTab();
    await user.click(await screen.findByRole('button', { name: 'Roll forward…' }));
    const dialog = await screen.findByRole('dialog');

    await user.type(within(dialog).getByLabelText('Code'), 'ICC-EA-2028-29');
    await user.type(within(dialog).getByLabelText('Name'), 'ICC Sydney EA 2028–29');
    await user.type(within(dialog).getByLabelText('Applies from'), '2028-07-03');
    await user.type(within(dialog).getByLabelText('CPI change (%)'), '3.7');
    await user.click(within(dialog).getByRole('button', { name: 'Use cl 25.1' }));
    expect(within(dialog).getByLabelText('Multiplier')).toHaveValue('1.042');
    expect(within(dialog).getByText('+4.20% on every rate and allowance')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Create draft' }));
    await waitFor(() => expect(h.roll).toHaveBeenCalledWith({
      sourceCardId: 'b', code: 'ICC-EA-2028-29', name: 'ICC Sydney EA 2028–29', validFrom: '2028-07-03', multiplier: 1.042,
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(invalidatedKeys(invalidate)).toEqual(['rate-cards']);
  });

  it('shows the server\'s refusal in plain words and keeps the form', async () => {
    h.roll.mockRejectedValue({ code: '42501', message: 'rate card not found, or payroll.manage not held in its organization' });
    const { user } = renderTab();
    await user.click(await screen.findByRole('button', { name: 'Roll forward…' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Code'), 'ICC-EA-2028-29');
    await user.type(within(dialog).getByLabelText('Name'), 'ICC 2028–29');
    await user.type(within(dialog).getByLabelText('Applies from'), '2028-07-03');
    await user.type(within(dialog).getByLabelText('Multiplier'), '1.03');
    await user.click(within(dialog).getByRole('button', { name: 'Create draft' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Only this organization's Administrator/);
    expect(within(dialog).getByLabelText('Code')).toHaveValue('ICC-EA-2028-29');
  });
});

describe('draft review', () => {
  it('compares each line with its source: old → new, % change', async () => {
    const { user } = renderTab();
    await user.click(await screen.findByRole('button', { name: 'Review' }));
    const rates = screen.getByRole('table', { name: 'Rate changes' });
    const row = within(rates).getByText('Level 2').closest('tr')!;
    expect(within(row).getByText('$37.50')).toBeInTheDocument();
    expect(within(row).getByText('$39.08')).toBeInTheDocument();
    expect(within(row).getByText('+4.21%')).toBeInTheDocument();
    const allowances = screen.getByRole('table', { name: 'Allowance changes' });
    expect(within(allowances).getByText('+4.20%')).toBeInTheDocument();
  });

  it('a loading edited on the draft (update_rate_card_loadings) shows in the review', async () => {
    h.list.mockResolvedValue([C2025, C2026, { ...DRAFT, loadings: { ...ICC_SYDNEY_EA_LOADINGS, saturdayLoading: 0.3 } }]);
    const { user } = renderTab();
    await user.click(await screen.findByRole('button', { name: 'Review' }));
    const loadings = screen.getByRole('table', { name: 'Loading changes' });
    const row = within(loadings).getByText('Saturday (cl 41)').closest('tr')!;
    expect(within(row).getByText('25%')).toBeInTheDocument();
    expect(within(row).getByText('30%')).toBeInTheDocument();
    expect(within(loadings).getAllByRole('row')).toHaveLength(2); // header + the one change
  });

  it('unchanged loadings are summarised, not listed', async () => {
    const { user } = renderTab();
    await user.click(await screen.findByRole('button', { name: 'Review' }));
    expect(screen.queryByRole('table', { name: 'Loading changes' })).toBeNull();
    expect(screen.getByText(/All 21 loadings and rules are unchanged/)).toBeInTheDocument();
  });

  it('a draft without loadings says it cannot be published', async () => {
    h.list.mockResolvedValue([C2025, C2026, { ...DRAFT, loadings: null }]);
    const { user } = renderTab();
    await user.click(await screen.findByRole('button', { name: 'Review' }));
    expect(screen.getByText(/has no loadings, so it cannot be published/)).toBeInTheDocument();
  });

  it('publish: the confirm says what closes and from when; publishing refreshes every schedule', async () => {
    h.publish.mockResolvedValue(undefined);
    const { user, invalidate } = renderTab();
    await user.click(await screen.findByRole('button', { name: 'Review' }));
    await user.click(screen.getByRole('button', { name: 'Publish…' }));

    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Publish ICC-EA-2027-28?');
    expect(confirm).toHaveTextContent(/price every shift from 5 Jul\w* 2099/);
    expect(confirm).toHaveTextContent(/ICC-EA-2026-27 will end on 4 Jul\w* 2099/);
    expect(confirm).not.toHaveTextContent(/repriced/); // not backdated
    expect(h.publish).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(h.publish).toHaveBeenCalledWith('d'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(invalidatedKeys(invalidate)).toEqual(['eba-rate-schedule', 'eba-trainee-schedule', 'rate-cards']);
  });

  it('publish: a backdated card warns that worked shifts are repriced', async () => {
    h.list.mockResolvedValue([C2025, C2026, { ...DRAFT, validFrom: '2026-10-01' }]);
    const { user } = renderTab();
    await user.click(await screen.findByRole('button', { name: 'Review' }));
    await user.click(screen.getByRole('button', { name: 'Publish…' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(/already rostered or worked are repriced/);
  });

  it('discard: confirmed first; a refusal stays on screen in plain words', async () => {
    h.discard.mockRejectedValue({ code: '55000', message: 'card ICC-EA-2027-28 is published; only a draft can be discarded' });
    const { user, invalidate } = renderTab();
    await user.click(await screen.findByRole('button', { name: 'Review' }));
    await user.click(screen.getByRole('button', { name: 'Discard draft' }));

    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Discard ICC-EA-2027-28?');
    await user.click(within(confirm).getByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(h.discard).toHaveBeenCalledWith('d'));
    expect(await within(confirm).findByRole('alert')).toHaveTextContent(
      'Card ICC-EA-2027-28 is published; only a draft can be discarded. Refresh the list to see its current state.',
    );
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('discard: success refreshes the card list only', async () => {
    h.discard.mockResolvedValue(undefined);
    const { user, invalidate } = renderTab();
    await user.click(await screen.findByRole('button', { name: 'Review' }));
    await user.click(screen.getByRole('button', { name: 'Discard draft' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(h.discard).toHaveBeenCalledWith('d'));
    await waitFor(() => expect(invalidatedKeys(invalidate)).toEqual(['rate-cards']));
  });
});
