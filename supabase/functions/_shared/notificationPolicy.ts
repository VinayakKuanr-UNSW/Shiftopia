export type NotificationPriority = 'low' | 'medium' | 'high' | 'critical';
export type NotificationDelivery = 'immediate' | 'digest' | 'in_app_only';

export type NotificationPolicy = {
  eventType: string;
  recipient: string;
  priority: NotificationPriority;
  delivery: NotificationDelivery;
  batchable: boolean;
  cooldownMinutes: number;
  messageTemplate: string;
};

type PolicyDefinition = Omit<NotificationPolicy, 'eventType'>;

const policy = (
  recipient: string,
  priority: NotificationPriority,
  delivery: NotificationDelivery,
  batchable: boolean,
  cooldownMinutes: number,
  messageTemplate: string,
): PolicyDefinition => ({ recipient, priority, delivery, batchable, cooldownMinutes, messageTemplate });

export const NOTIFICATION_POLICIES: Readonly<Record<string, PolicyDefinition>> = {
  SHIFT_OFFER_RECEIVED: policy('Employee', 'high', 'immediate', false, 0, 'You have been offered a shift. Respond before XhYm.'),
  SHIFT_OFFER_REMINDER: policy('Employee', 'high', 'immediate', false, 0, 'Your shift offer expires soon!'),
  SHIFT_OFFER_EXPIRED: policy('Employee', 'high', 'immediate', false, 0, 'Your shift offer has now expired!'),
  SHIFT_ASSIGNED: policy('Employee', 'high', 'immediate', false, 0, 'You have been assigned to this shift.'),
  URGENT_SHIFT_ASSIGNED: policy('Employee', 'critical', 'immediate', false, 0, 'You have been called in urgently to cover this shift.'),
  SHIFT_BIDDING_OPEN: policy('Eligible Employees', 'low', 'digest', true, 30, '{count} new shifts are available for bidding.'),
  BID_SUBMITTED: policy('Bidder', 'low', 'in_app_only', false, 0, 'Your bid has been submitted.'),
  BID_SUCCESSFUL: policy('Winning Bidder', 'high', 'immediate', false, 0, 'Congratulations! Your bid was successful.'),
  BID_UNSUCCESSFUL: policy('Losing Bidder', 'low', 'digest', true, 60, 'Your bid was unsuccessful.'),
  BIDDING_EXPIRED: policy('Bidder', 'low', 'in_app_only', false, 0, 'This shift is no longer available.'),
  SHIFT_DROPPED: policy('Manager', 'medium', 'immediate', false, 0, 'An assigned shift has been dropped.'),
  SHIFT_REOPENED_FOR_BIDDING: policy('Eligible Employees', 'low', 'digest', true, 30, '{count} additional shifts are now available for bidding.'),
  SWAP_REQUEST_SENT: policy('Requestor', 'low', 'in_app_only', false, 0, 'Your swap request has been sent.'),
  SWAP_REQUEST_RECEIVED: policy('Peer Employee', 'high', 'immediate', false, 0, 'A colleague is requesting a shift swap.'),
  SWAP_PEER_ACCEPTED: policy('Requestor', 'high', 'immediate', false, 0, 'A peer accepted the swap. Awaiting manager approval.'),
  SWAP_PEER_REJECTED: policy('Requestor', 'high', 'immediate', false, 0, 'The swap request was declined.'),
  SWAP_EXPIRED: policy('Requestor', 'high', 'immediate', false, 0, 'The swap request expired.'),
  SWAP_APPROVAL_REQUIRED: policy('Manager', 'high', 'immediate', false, 0, 'A swap request is awaiting your approval.'),
  SWAP_APPROVED: policy('Both Employees', 'high', 'immediate', false, 0, 'Your manager approved the swap.'),
  SWAP_REJECTED: policy('Both Employees', 'high', 'immediate', false, 0, 'Your manager rejected the swap request.'),
  SWAP_APPROVAL_EXPIRED: policy('Both Employees', 'high', 'immediate', false, 0, 'The swap approval request expired.'),
  SHIFT_REMOVED: policy('Assigned Employee', 'critical', 'immediate', false, 0, 'You were removed from this shift.'),
  SHIFT_CANCELLED: policy('Assigned Employee', 'critical', 'immediate', false, 0, 'This shift has been cancelled.'),
  MANAGER_OFFER_ACCEPTED: policy('Manager', 'medium', 'immediate', false, 0, 'An employee accepted the shift offer.'),
  MANAGER_OFFER_REJECTED: policy('Manager', 'medium', 'immediate', false, 0, 'An employee rejected the shift offer.'),
  MANAGER_OFFER_EXPIRED: policy('Manager', 'medium', 'immediate', false, 0, 'A shift offer expired without response.'),
  MANAGER_BID_RECEIVED: policy('Manager', 'low', 'digest', true, 15, '{count} new bids have been received.'),
  MARKETPLACE_UPDATED: policy('Eligible Employees', 'low', 'digest', true, 30, '{count} new opportunities are available.'),
  SHIFT_STARTING_SOON: policy('Employee', 'high', 'immediate', false, 0, 'Your shift starts in 1 hour.'),
  SHIFT_STARTING_15_MIN: policy('Employee', 'high', 'immediate', false, 0, 'Your shift starts in 15 minutes.'),
  EMPLOYEE_LATE: policy('Employee', 'medium', 'immediate', false, 0, 'You have been marked as late.'),
  CLOCK_IN_RECORDED: policy('Employee', 'low', 'in_app_only', false, 0, 'Your clock in has been recorded.'),
  CLOCK_OUT_RECORDED: policy('Employee', 'low', 'in_app_only', false, 0, 'Your clock out has been recorded.'),
  OVERTIME_STARTED: policy('Employee', 'high', 'immediate', false, 0, 'You have entered overtime.'),
  SHIFT_COMPLETED: policy('Employee', 'low', 'in_app_only', false, 0, 'Your shift has been completed.'),
};

const LEGACY_EVENT_ALIASES: Readonly<Record<string, string>> = {
  shift_assigned: 'SHIFT_ASSIGNED',
  emergency_assignment: 'URGENT_SHIFT_ASSIGNED',
  bid_accepted: 'BID_SUCCESSFUL',
  bid_rejected: 'BID_UNSUCCESSFUL',
  bid_no_winner: 'MANAGER_OFFER_EXPIRED',
  shift_dropped: 'SHIFT_DROPPED',
  swap_request: 'SWAP_REQUEST_RECEIVED',
  swap_approved: 'SWAP_APPROVED',
  swap_rejected: 'SWAP_REJECTED',
  swap_expired: 'SWAP_EXPIRED',
  shift_cancelled: 'SHIFT_CANCELLED',
};

const DEFAULT_POLICY: PolicyDefinition = policy('Employee', 'medium', 'immediate', false, 0, '');

export function normalizeNotificationEventType(eventType: string): string {
  const normalized = eventType.trim().replace(/[^a-zA-Z0-9]+/g, '_');
  return LEGACY_EVENT_ALIASES[normalized.toLowerCase()] ?? normalized.toUpperCase();
}

export function resolveNotificationPolicy(eventType: string): NotificationPolicy {
  const canonicalType = normalizeNotificationEventType(eventType);
  return { eventType: canonicalType, ...(NOTIFICATION_POLICIES[canonicalType] ?? DEFAULT_POLICY) };
}

export function renderNotificationMessage(
  policyDefinition: NotificationPolicy,
  count: number,
  fallbackMessage: string | null,
): string {
  const template = policyDefinition.messageTemplate || fallbackMessage || '';
  // A global regex rather than String.replaceAll: this module is imported by
  // the web client, which compiles against `lib: ES2020` where replaceAll is
  // not declared. Identical behaviour, and still valid in Deno.
  if (template.includes('{count}')) return template.replace(/\{count\}/g, String(count));
  return count > 1 ? `${count} updates: ${template}` : template;
}

export function isRemoteDeliveryAllowed(policyDefinition: NotificationPolicy): boolean {
  return policyDefinition.delivery !== 'in_app_only';
}

export function isHighPriority(policyDefinition: NotificationPolicy): boolean {
  return policyDefinition.priority === 'high' || policyDefinition.priority === 'critical';
}
