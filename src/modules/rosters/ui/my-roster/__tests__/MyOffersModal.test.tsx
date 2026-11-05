import { describe, expect, it, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MyOffersModal } from '../MyOffersModal';

/**
 * This file runs as a viewer OUTSIDE Sydney.
 *
 * Shift times are Australia/Sydney wall-clock and must resolve to the same
 * instant for everyone, so the timezone assertions below only mean anything
 * when the runtime zone is not already the answer. The suite as a whole pins no
 * TZ and therefore inherits the developer's machine; on a Sydney laptop a
 * browser-local date parse is accidentally correct and proves nothing.
 */
const originalTz = process.env.TZ;
beforeAll(() => { process.env.TZ = 'UTC'; });
afterAll(() => { process.env.TZ = originalTz; });

vi.mock('@/modules/core/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/modules/core/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock('@/platform/auth/useAuth', () => ({
  useAuth: () => ({ user: { id: 'emp-1', fullName: 'Kurry Admin', name: 'Kurry Admin' } }),
}));

const mutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const pending = { data: [] as any[], isLoading: false, isPending: false, isError: false, error: null as Error | null, refetch: vi.fn() };
const history = { data: [] as any[], isLoading: false, isPending: false, isError: false, error: null as Error | null, refetch: vi.fn() };

vi.mock('@/modules/rosters/state/useRosterShifts', () => ({
  useMyOffers: () => pending,
  useMyOffersHistory: () => history,
  useAcceptOffer: () => mutation,
  useDeclineOffer: () => mutation,
}));

// The card is exercised for real elsewhere; here we only need to see which
// props the inbox hands it.
vi.mock('@/modules/planning/ui/components/SharedShiftCard', () => ({
  SharedShiftCard: (props: any) => (
    <div
      data-testid="shift-card"
      data-identity-grid={String(!!props.identityGrid)}
      data-employee={props.employeeName ?? ''}
      data-group={props.group ?? ''}
      data-sub-group={props.subGroup ?? ''}
      data-sub-dept={props.subDepartment ?? ''}
    >
      {props.footerActions}
    </div>
  ),
}));

function offer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'offer-1',
    shift_id: 'shift-1',
    status: 'Pending',
    offered_at: '2026-08-19T09:39:46Z',
    offer_expires_at: null,
    offered_by_name: 'Admin',
    shift: {
      id: 'shift-1',
      // 05:30 Sydney on the 20th = 19:30 UTC on the 19th.
      shift_date: '2026-08-20',
      start_time: '05:30:00',
      end_time: '16:30:00',
      roles: { name: 'Team Leader' },
      departments: { name: 'Event Delivery' },
      sub_departments: { name: 'Set-up' },
      organizations: { name: 'ICC Sydney' },
      group_type: 'theatre',
      ...(overrides.shift as object ?? {}),
    },
    ...overrides,
  };
}

describe('MyOffersModal', () => {
  beforeEach(() => {
    pending.data = [];
    pending.isError = false;
    pending.isLoading = false;
    pending.isPending = false;
    pending.error = null;
    history.data = [];
    vi.setSystemTime(new Date('2026-08-19T09:43:00Z')); // 19:43 Sydney
  });

  it('never labels the recipient\'s own offer as unassigned', () => {
    // Every row here is `assigned_employee_id = me` — that IS the query — yet
    // the card used to fall through to its "Unassigned" branch and tell the
    // recipient, in amber, that the shift being offered to them belonged to
    // nobody. The grid's Employee cell now gets the viewer's name, so the
    // shift cannot read as unheld while it sits in their own inbox.
    pending.data = [offer()];

    render(<MyOffersModal isOpen onClose={vi.fn()} />);

    const card = screen.getByTestId('shift-card');
    expect(card).toHaveAttribute('data-identity-grid', 'true');
    expect(card).toHaveAttribute('data-employee', 'Kurry Admin');
  });

  it('feeds the grid the roster group and sub-department as separate facts', () => {
    // They had been arriving through the same `subGroup` prop, so the card
    // could only ever show one of them.
    pending.data = [offer()];

    render(<MyOffersModal isOpen onClose={vi.fn()} />);

    const card = screen.getByTestId('shift-card');
    expect(card).toHaveAttribute('data-group', 'Theatre');
    expect(card).toHaveAttribute('data-sub-dept', 'Set-up');
  });

  it('does not present a failed fetch as an empty inbox', () => {
    pending.isError = true;
    pending.error = new Error('JWT expired');

    render(<MyOffersModal isOpen onClose={vi.fn()} />);

    expect(screen.getByText(/Couldn’t load your offers/)).toBeInTheDocument();
    expect(screen.getByText('JWT expired')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/No offers waiting/)).not.toBeInTheDocument();
  });

  it('shows the empty state only when the query really came back empty', () => {
    render(<MyOffersModal isOpen onClose={vi.fn()} />);

    expect(screen.getByText('No offers waiting')).toBeInTheDocument();
  });

  it('without a stated deadline an offer stays open until the shift starts (no 4h cut-off)', () => {
    // 05:30 Sydney on 2026-08-20 is 19:30 UTC on the 19th. At 18:00 UTC the
    // shift is 1.5h away: the offer is still answerable (B-D9). The old code
    // closed it four hours before the start.
    vi.setSystemTime(new Date('2026-08-19T18:00:00Z'));
    pending.data = [offer()];

    render(<MyOffersModal isOpen onClose={vi.fn()} />);

    expect(screen.getByTestId('shift-card')).toBeInTheDocument();
  });

  it('closes at the start on Sydney wall-clock, not on the naive string read as UTC', () => {
    // At 19:45 UTC the shift (19:30 UTC) has started and the offer must be gone.
    // Reading "2026-08-20T05:30" in the viewer's zone instead would put the
    // start at 05:30 UTC on the 20th under TZ=UTC and keep the offer live.
    vi.setSystemTime(new Date('2026-08-19T19:45:00Z'));
    pending.data = [offer()];

    render(<MyOffersModal isOpen onClose={vi.fn()} />);

    expect(screen.queryByTestId('shift-card')).not.toBeInTheDocument();
    expect(screen.getByText('No offers waiting')).toBeInTheDocument();
  });

  it('honours the database offer_expires_at when it is stated', () => {
    // Shift starts at 19:30 UTC. At 18:00 UTC (1.5h to start), an urgent offer with
    // offer_expires_at set to 19:00 UTC remains active until its stated expiry.
    vi.setSystemTime(new Date('2026-08-19T18:00:00Z'));
    pending.data = [offer({ offer_expires_at: '2026-08-19T19:00:00Z' })];

    render(<MyOffersModal isOpen onClose={vi.fn()} />);

    expect(screen.getByTestId('shift-card')).toBeInTheDocument();
  });

  it('exposes the status filters as a tablist', () => {
    render(<MyOffersModal isOpen onClose={vi.fn()} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(['Pending', 'Accepted', 'Declined']);
    expect(screen.getByRole('tab', { name: /pending/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toBeInTheDocument();
  });

  it('gives the close control an accessible name', () => {
    render(<MyOffersModal isOpen onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Close shift offers' })).toBeInTheDocument();
  });

  it('offers exactly one way to close, not two', () => {
    // `DialogContent` renders its own absolutely-positioned close button, and
    // this modal lays one out in its header row — so the dialog showed two,
    // one sitting over the other's corner.
    render(<MyOffersModal isOpen onClose={vi.fn()} />);

    const closers = screen
      .getAllByRole('button')
      .filter((b) => /close/i.test(b.getAttribute('aria-label') ?? b.textContent ?? ''));

    expect(closers).toHaveLength(1);
  });

  it('forwards subGroup to SharedShiftCard', () => {
    const o = offer();
    (o.shift as any).sub_group_name = 'AM Base';
    pending.data = [o];

    render(<MyOffersModal isOpen onClose={vi.fn()} />);

    const card = screen.getByTestId('shift-card');
    expect(card).toHaveAttribute('data-sub-group', 'AM Base');
  });
});
