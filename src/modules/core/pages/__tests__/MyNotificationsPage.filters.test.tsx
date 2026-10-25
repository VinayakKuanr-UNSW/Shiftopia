import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const now = new Date().toISOString();
const notifications = [
  { id: 'n1', type: 'swap_request', title: 'Swap requested by Ana', message: null, link: null, entity_id: null, entity_type: null, read_at: null, created_at: now },
  { id: 'n2', type: 'bid_accepted', title: 'Your bid was accepted', message: null, link: null, entity_id: null, entity_type: null, read_at: null, created_at: now },
];

vi.mock('@/modules/core/hooks/useNotifications', () => ({
  useNotifications: () => ({
    notifications, unreadCount: 2, loading: false,
    markRead: vi.fn(), markAllRead: vi.fn(), dismiss: vi.fn(),
  }),
}));
vi.mock('@/modules/core/contexts/ThemeContext', () => ({ useTheme: () => ({ isDark: false }) }));
// The header's Global Scope wiring is irrelevant here; render just its function bar.
vi.mock('@/modules/core/ui/components/GoldStandardHeader', () => ({
  GoldStandardHeader: ({ functionBar }: { functionBar: ReactNode }) => <div>{functionBar}</div>,
}));

import MyNotificationsPage from '../MyNotificationsPage';

// Radix opens a menu on keyboard activation in jsdom (pointer events are not modelled).
const openFilters = () => {
  const btn = screen.getByRole('button', { name: /^filters/i });
  btn.focus();
  fireEvent.keyDown(btn, { key: 'Enter' });
};

describe('My Notifications — Filters (it used to be a button with no behaviour)', () => {
  it('offers only the categories present, and narrows the list to the ticked ones', async () => {
    render(<MemoryRouter><MyNotificationsPage /></MemoryRouter>);
    expect(screen.getByText('Swap requested by Ana')).toBeInTheDocument();
    expect(screen.getByText('Your bid was accepted')).toBeInTheDocument();

    openFilters();
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitemcheckbox').map((i) => i.textContent)).toEqual(['Bids', 'Swaps']);

    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Swaps' }));
    expect(screen.getByText('Swap requested by Ana')).toBeInTheDocument();
    // The card leaves through an exit animation, so wait for it to go.
    await waitFor(() => expect(screen.queryByText('Your bid was accepted')).not.toBeInTheDocument());
    // Close the (modal) menu, then the trigger reports the active filter count.
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.getByRole('button', { name: /filters, 1 selected/i })).toBeInTheDocument());
  });
});
