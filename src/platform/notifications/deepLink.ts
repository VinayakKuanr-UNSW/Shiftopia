/**
 * Single source of truth for turning a notification into an in-app route.
 * Shared by the in-app bell/page (`useNotifications`), local notifications, and
 * push-notification tap handlers so the deep-link map is never duplicated.
 */

export type NotificationRoute = {
  type: string;
  link?: string | null;
};

const DEEP_LINK_MAP: Record<string, string> = {
  shift_offer_received:    '/my-roster',
  shift_offer_reminder:    '/my-roster',
  shift_offer_expired:     '/my-roster',
  shift_assigned:          '/my-roster',
  urgent_shift_assigned:   '/my-roster',
  shift_cancelled:         '/my-roster',
  shift_removed:           '/my-roster',
  shift_updated:           '/my-roster',
  shift_dropped:           '/management/bids',
  emergency_assignment:    '/my-roster',
  shift_bidding_open:      '/my-bids',
  shift_reopened_for_bidding: '/my-bids',
  marketplace_updated:     '/my-bids',
  bid_submitted:           '/my-bids',
  bid_successful:          '/my-bids',
  bid_unsuccessful:        '/my-bids',
  bidding_expired:         '/my-bids',
  bid_accepted:            '/my-bids',
  bid_rejected:            '/my-bids',
  bid_no_winner:           '/management/bids',
  offer_expired:           '/my-roster',
  manager_offer_accepted:  '/management/bids',
  manager_offer_rejected:  '/management/bids',
  manager_offer_expired:   '/management/bids',
  manager_bid_received:    '/management/bids',
  swap_request_sent:       '/my-swaps',
  swap_request_received:   '/my-swaps',
  swap_peer_accepted:      '/my-swaps',
  swap_peer_rejected:      '/my-swaps',
  swap_request:            '/my-swaps',
  swap_approved:           '/my-swaps',
  swap_rejected:           '/my-swaps',
  swap_expired:            '/my-swaps',
  swap_approval_required:  '/management/swaps',
  swap_approval_expired:   '/my-swaps',
  shift_starting_soon:     '/my-roster',
  shift_starting_15_min:   '/my-roster',
  employee_late:           '/my-roster',
  clock_in_recorded:       '/timesheet',
  clock_out_recorded:      '/timesheet',
  overtime_started:        '/timesheet',
  shift_completed:         '/my-roster',
  broadcast:               '/my-broadcasts',
  timesheet_approved:      '/timesheet',
  timesheet_rejected:      '/timesheet',
};

const FALLBACK_ROUTE = '/my-roster';

const LEGACY_LINK_MAP: Record<string, string> = {
  '/bids': '/my-bids',
};

export function resolveNotificationLink(notification: NotificationRoute): string {
  if (notification.link) return LEGACY_LINK_MAP[notification.link] ?? notification.link;
  return DEEP_LINK_MAP[notification.type.toLowerCase()] ?? FALLBACK_ROUTE;
}
