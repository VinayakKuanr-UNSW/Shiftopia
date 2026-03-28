import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellRing, CheckCheck, X, Inbox } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import {
  useNotifications,
  resolveNotificationLink,
  type AppNotification,
} from '@/modules/core/hooks/useNotifications';
import { Button } from '@/modules/core/ui/primitives/button';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { Separator } from '@/modules/core/ui/primitives/separator';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';
import { cn } from '@/modules/core/lib/utils';

/* ── Priority map ───────────────────────────────────────────── */
type Priority = 'high' | 'medium' | 'low';

const PRIORITY_MAP: Record<string, Priority> = {
  emergency_assignment: 'high',
  shift_cancelled:      'high',
  shift_assigned:       'high',
  shift_dropped:        'high',
  timesheet_rejected:   'high',
  swap_rejected:        'high',
  bid_no_winner:        'high',
  offer_expired:        'high',
  swap_expired:         'high',
  bid_rejected:         'medium',
  timesheet_approved:   'medium',
  swap_approved:        'medium',
  bid_accepted:         'medium',
  swap_request:         'medium',
  broadcast:            'medium',
  shift_updated:        'low',
  general:              'low',
};

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

function getPriority(type: string): Priority {
  return PRIORITY_MAP[type] ?? 'low';
}

/* ── Type metadata ──────────────────────────────────────────── */
type TypeMeta = { label: string; dot: string; group: string };

const TYPE_META: Record<string, TypeMeta> = {
  shift_assigned:       { label: 'Shift',     dot: 'bg-cyan-500',    group: 'Shifts'     },
  shift_cancelled:      { label: 'Shift',     dot: 'bg-red-500',     group: 'Shifts'     },
  shift_dropped:        { label: 'Shift',     dot: 'bg-orange-500',  group: 'Shifts'     },
  shift_updated:        { label: 'Shift',     dot: 'bg-blue-500',    group: 'Shifts'     },
  emergency_assignment: { label: 'Emergency', dot: 'bg-rose-600',    group: 'Shifts'     },
  bid_accepted:      { label: 'Bid',       dot: 'bg-green-500',   group: 'Bids'       },
  bid_rejected:      { label: 'Bid',       dot: 'bg-red-500',     group: 'Bids'       },
  bid_no_winner:     { label: 'Bid',       dot: 'bg-rose-500',    group: 'Bids'       },
  offer_expired:     { label: 'Offer',     dot: 'bg-rose-500',    group: 'Shifts'     },
  swap_request:      { label: 'Swap',      dot: 'bg-orange-500',  group: 'Swaps'      },
  swap_approved:     { label: 'Swap',      dot: 'bg-green-500',   group: 'Swaps'      },
  swap_rejected:     { label: 'Swap',      dot: 'bg-red-500',     group: 'Swaps'      },
  swap_expired:      { label: 'Swap',      dot: 'bg-rose-500',    group: 'Swaps'      },
  broadcast:         { label: 'Message',   dot: 'bg-rose-500',    group: 'Messages'   },
  timesheet_approved:{ label: 'Timesheet', dot: 'bg-emerald-500', group: 'Timesheets' },
  timesheet_rejected:{ label: 'Timesheet', dot: 'bg-red-500',     group: 'Timesheets' },
  general:           { label: 'Notice',    dot: 'bg-slate-400',   group: 'General'    },
};

function getMeta(type: string): TypeMeta {
  return TYPE_META[type] ?? { label: 'Notice', dot: 'bg-slate-400', group: 'General' };
}

/* ── Priority left-border colour ────────────────────────────── */
const PRIORITY_BORDER: Record<Priority, string> = {
  high:   'border-l-2 border-l-red-500',
  medium: 'border-l-2 border-l-amber-400',
  low:    'border-l-2 border-l-transparent',
};

/* ── Sort: priority-first within unread, then read by recency ── */
function sortedNotifications(list: AppNotification[]): AppNotification[] {
  const unread = list
    .filter((n) => !n.read_at)
    .sort((a, b) => {
      const pd = PRIORITY_ORDER[getPriority(a.type)] - PRIORITY_ORDER[getPriority(b.type)];
      if (pd !== 0) return pd;
      return b.created_at.localeCompare(a.created_at);
    });
  const read = list
    .filter((n) => n.read_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return [...unread, ...read];
}

/* ── Group header row ───────────────────────────────────────── */
function GroupHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-1.5 bg-muted/80 backdrop-blur-sm border-y border-border/30">
      <span className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">
        {label}
      </span>
      <span className="text-[10px] text-muted-foreground/50 font-medium">({count})</span>
    </div>
  );
}

/* ── Single notification row ────────────────────────────────── */
function NotificationRow({
  n,
  isSeen,
  onRead,
  onDismiss,
}: {
  n: AppNotification;
  isSeen: boolean;
  onRead: (id: string) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
}) {
  const navigate = useNavigate();
  const meta = getMeta(n.type);
  const priority = getPriority(n.type);
  const isUnread = !n.read_at;
  // Three visual states: fresh-unread | seen-unread | read
  const isFresh = isUnread && !isSeen;

  const handleClick = async () => {
    if (isUnread) await onRead(n.id);
    navigate(resolveNotificationLink(n));
  };

  return (
    <div
      className={cn(
        'group relative flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-muted/50',
        PRIORITY_BORDER[priority],
        isFresh && 'bg-primary/5',
        isUnread && !isFresh && 'bg-muted/20',
      )}
      onClick={handleClick}
    >
      {/* colour dot */}
      <div className="mt-1.5 shrink-0">
        <span className={cn('block h-2 w-2 rounded-full', meta.dot)} />
      </div>

      {/* content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p
            className={cn(
              'text-sm leading-snug',
              isFresh  && 'font-semibold text-foreground',
              isUnread && !isFresh && 'font-medium text-foreground/80',
              !isUnread && 'font-normal text-foreground/60',
            )}
          >
            {n.title}
          </p>
          <button
            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
            onClick={(e) => { e.stopPropagation(); onDismiss(n.id); }}
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {n.message && (
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{n.message}</p>
        )}

        <div className="mt-1 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60 font-medium">
            {meta.label}
          </span>
          {priority === 'high' && isUnread && (
            <>
              <span className="text-[10px] text-muted-foreground/40">·</span>
              <span className="text-[10px] font-semibold text-red-500 uppercase tracking-wide">Urgent</span>
            </>
          )}
          <span className="text-[10px] text-muted-foreground/40">·</span>
          <span className="text-[10px] text-muted-foreground/60">
            {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
          </span>
        </div>
      </div>

      {/* fresh-unread pip */}
      {isFresh && (
        <span className="mt-2 shrink-0 h-1.5 w-1.5 rounded-full bg-primary" />
      )}
    </div>
  );
}

/* ── Grouped list (only shown when total > 4) ───────────────── */
function GroupedList({
  sorted,
  seenIds,
  onRead,
  onDismiss,
}: {
  sorted: AppNotification[];
  seenIds: Set<string>;
  onRead: (id: string) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
}) {
  // Build group sections
  const sections = useMemo(() => {
    const map = new Map<string, AppNotification[]>();
    for (const n of sorted) {
      const group = getMeta(n.type).group;
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push(n);
    }
    return Array.from(map.entries());
  }, [sorted]);

  return (
    <>
      {sections.map(([group, items]) => (
        <div key={group}>
          <GroupHeader label={group} count={items.length} />
          {items.map((n) => (
            <NotificationRow
              key={n.id}
              n={n}
              isSeen={seenIds.has(n.id)}
              onRead={onRead}
              onDismiss={onDismiss}
            />
          ))}
        </div>
      ))}
    </>
  );
}

/* ── Flat list (default when total ≤ 4) ────────────────────── */
function FlatList({
  sorted,
  seenIds,
  onRead,
  onDismiss,
}: {
  sorted: AppNotification[];
  seenIds: Set<string>;
  onRead: (id: string) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
}) {
  return (
    <div className="divide-y divide-border/30">
      {sorted.map((n) => (
        <NotificationRow
          key={n.id}
          n={n}
          isSeen={seenIds.has(n.id)}
          onRead={onRead}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}

/* ── Main component ─────────────────────────────────────────── */
interface BroadcastNotificationsProps {
  isCollapsed?: boolean;
}

export function BroadcastNotifications({ isCollapsed: _isCollapsed }: BroadcastNotificationsProps) {
  const {
    notifications,
    unreadCount,
    loading,
    seenIds,
    markSeen,
    markRead,
    markAllRead,
    dismiss,
  } = useNotifications();

  const sorted = useMemo(() => sortedNotifications(notifications), [notifications]);
  const useGrouped = notifications.length > 4;

  const handleOpenChange = (open: boolean) => {
    if (open) {
      // Mark all currently visible unread as "seen" (local state only, no DB call)
      const unreadIds = notifications.filter((n) => !n.read_at).map((n) => n.id);
      markSeen(unreadIds);
    }
  };

  return (
    <Popover onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 text-muted-foreground hover:text-foreground"
          aria-label="Notifications"
        >
          {unreadCount > 0 ? (
            <BellRing className="h-5 w-5" />
          ) : (
            <Bell className="h-5 w-5" />
          )}

          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white ring-2 ring-background">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="end"
        sideOffset={12}
        className="w-[360px] p-0 shadow-xl border border-border/60"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Notifications</span>
            {unreadCount > 0 && (
              <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">
                {unreadCount} new
              </span>
            )}
          </div>

          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1"
              onClick={markAllRead}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </Button>
          )}
        </div>

        {/* Body */}
        <ScrollArea className="h-[380px]">
          {loading ? (
            <div className="flex flex-col gap-2 p-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex gap-3 animate-pulse">
                  <div className="mt-1.5 h-2 w-2 rounded-full bg-muted" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-3/4 rounded bg-muted" />
                    <div className="h-2.5 w-full rounded bg-muted" />
                    <div className="h-2 w-1/3 rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 py-12 text-muted-foreground">
              <Inbox className="h-10 w-10 opacity-30" />
              <p className="text-sm font-medium">No new notifications</p>
              <p className="text-xs opacity-60">You're up to date</p>
            </div>
          ) : useGrouped ? (
            <GroupedList
              sorted={sorted}
              seenIds={seenIds}
              onRead={markRead}
              onDismiss={dismiss}
            />
          ) : (
            <FlatList
              sorted={sorted}
              seenIds={seenIds}
              onRead={markRead}
              onDismiss={dismiss}
            />
          )}
        </ScrollArea>

        {/* Footer */}
        {notifications.length > 0 && (
          <>
            <Separator className="bg-border/30" />
            <div className="px-4 py-2.5 text-center">
              <span className="text-xs text-muted-foreground/50">
                {notifications.length} notification{notifications.length !== 1 ? 's' : ''} · read items auto-expire after 7 days
              </span>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
