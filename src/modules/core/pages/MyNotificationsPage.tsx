// src/modules/core/pages/MyNotificationsPage.tsx
import { PageState } from '@/modules/core/ui/components/PageState';
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell,
  BellRing,
  CheckCheck,
  X,
  Inbox,
  Search,
  Filter,
  Calendar,
  BadgeCheck,
  RefreshCw,
  MessageSquare,
  Clock,
  ArrowRight,
} from 'lucide-react';
import {
  formatDistanceToNow,
  isToday,
  isYesterday,
} from 'date-fns';
import {
  useNotifications,
  resolveNotificationLink,
  type AppNotification
} from '@/modules/core/hooks/useNotifications';
import { Button } from '@/modules/core/ui/primitives/button';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { PageLayout } from '@/modules/core/ui/layout/PageLayout';
import { ToolbarRow, ToolbarSegmented, toolbar } from '@/modules/core/ui/components/Toolbar';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/modules/core/ui/primitives/dropdown-menu';
import { surface } from '@/modules/core/ui/layout/pageTokens';
import { text } from '@/modules/core/ui/typography';
import { pageVariants, itemVariants, listItemSpring } from '@/modules/core/ui/motion/presets';
import { normalizeNotificationEventType } from '@/platform/notifications/notificationPolicy';

/* ── Badge color helper ─────────────────────────────────────── */
type BadgeTone = 'info' | 'urgent' | 'warning' | 'success' | 'neutral';

const BADGE_CLASSES: Record<BadgeTone, string> = {
  info:    'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400',
  urgent:  'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400',
  warning: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
  neutral: 'bg-muted/60 text-muted-foreground dark:bg-muted/30 dark:text-muted-foreground',
};

/* ── Type metadata ──────────────────────────────────────────── */
type TypeMeta = {
  label: string;
  icon: React.ElementType;
  color: string;
  group: string;
  accent: string;
  tone: BadgeTone;
};

const TYPE_META: Record<string, TypeMeta> = {
  shift_assigned:       { label: 'Shift Assigned',   icon: Calendar,      color: 'bg-cyan-500',    group: 'Shifts',     accent: 'bg-cyan-500',    tone: 'info' },
  shift_cancelled:      { label: 'Shift Cancelled',  icon: Calendar,      color: 'bg-red-500',     group: 'Shifts',     accent: 'bg-red-500',     tone: 'urgent' },
  shift_dropped:        { label: 'Shift Dropped',    icon: Calendar,      color: 'bg-orange-500',  group: 'Shifts',     accent: 'bg-orange-500',  tone: 'warning' },
  shift_updated:        { label: 'Shift Updated',    icon: Calendar,      color: 'bg-blue-500',    group: 'Shifts',     accent: 'bg-blue-500',    tone: 'info' },
  emergency_assignment: { label: 'Emergency',        icon: BellRing,      color: 'bg-rose-600',    group: 'Shifts',     accent: 'bg-rose-600',    tone: 'urgent' },
  bid_accepted:         { label: 'Bid Accepted',     icon: BadgeCheck,    color: 'bg-green-500',   group: 'Bids',       accent: 'bg-green-500',   tone: 'success' },
  bid_rejected:         { label: 'Bid Rejected',     icon: BadgeCheck,    color: 'bg-red-500',     group: 'Bids',       accent: 'bg-red-500',     tone: 'urgent' },
  bid_submitted:        { label: 'Bid Submitted',    icon: BadgeCheck,    color: 'bg-blue-500',    group: 'Bids',       accent: 'bg-blue-500',    tone: 'info' },
  shift_bidding_open:   { label: 'Bidding Open',     icon: BadgeCheck,    color: 'bg-blue-500',    group: 'Bids',       accent: 'bg-blue-500',    tone: 'info' },
  bid_no_winner:        { label: 'No Winner',        icon: BadgeCheck,    color: 'bg-rose-500',    group: 'Bids',       accent: 'bg-rose-500',    tone: 'urgent' },
  offer_expired:        { label: 'Offer Expired',    icon: Calendar,      color: 'bg-rose-500',    group: 'Shifts',     accent: 'bg-rose-500',    tone: 'warning' },
  swap_request:         { label: 'Swap Request',     icon: RefreshCw,     color: 'bg-orange-500',  group: 'Swaps',      accent: 'bg-orange-500',  tone: 'warning' },
  swap_approved:        { label: 'Swap Approved',    icon: RefreshCw,     color: 'bg-green-500',   group: 'Swaps',      accent: 'bg-green-500',   tone: 'success' },
  swap_rejected:        { label: 'Swap Rejected',    icon: RefreshCw,     color: 'bg-red-500',     group: 'Swaps',      accent: 'bg-red-500',     tone: 'urgent' },
  swap_expired:         { label: 'Swap Expired',     icon: RefreshCw,     color: 'bg-rose-500',    group: 'Swaps',      accent: 'bg-rose-500',    tone: 'warning' },
  broadcast:            { label: 'Message',          icon: MessageSquare, color: 'bg-indigo-500',  group: 'Messages',   accent: 'bg-indigo-500',  tone: 'info' },
  timesheet_approved:   { label: 'Timesheet Apprv',  icon: Clock,         color: 'bg-emerald-500', group: 'Timesheets', accent: 'bg-emerald-500', tone: 'success' },
  timesheet_rejected:   { label: 'Timesheet Rej',    icon: Clock,         color: 'bg-red-500',     group: 'Timesheets', accent: 'bg-red-500',     tone: 'urgent' },
  general:              { label: 'Notice',           icon: Bell,          color: 'bg-slate-400',   group: 'General',    accent: 'bg-slate-400',   tone: 'neutral' },
};

function getMeta(type: string): TypeMeta {
  const key = type.toLowerCase();
  const canonicalKey = normalizeNotificationEventType(type).toLowerCase();
  return TYPE_META[key] ?? TYPE_META[canonicalKey] ?? inferMeta(canonicalKey);
}

function inferMeta(type: string): TypeMeta {
  if (type.includes('swap')) return { label: 'Swap', icon: RefreshCw, color: 'bg-orange-500', group: 'Swaps', accent: 'bg-orange-500', tone: 'warning' };
  if (type.includes('bid') || type.includes('marketplace')) return { label: 'Bid', icon: BadgeCheck, color: 'bg-blue-500', group: 'Bids', accent: 'bg-blue-500', tone: 'info' };
  if (type.includes('shift') || type.includes('offer')) return { label: 'Shift', icon: Calendar, color: 'bg-cyan-500', group: 'Shifts', accent: 'bg-cyan-500', tone: 'info' };
  return { label: 'Notice', icon: Bell, color: 'bg-slate-400', group: 'General', accent: 'bg-slate-400', tone: 'neutral' };
}

const MyNotificationsPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    notifications,
    unreadCount,
    loading,
    markRead,
    markAllRead,
    dismiss,
  } = useNotifications();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'unread'>('all');
  // Category filter (Shifts, Bids, Swaps…). Empty = every category.
  const [groups, setGroups] = useState<ReadonlySet<string>>(new Set());

  /** The categories actually present, so the menu never offers an empty one. */
  const availableGroups = useMemo(
    () => [...new Set(notifications.map(n => getMeta(n.type).group))].sort(),
    [notifications],
  );

  const toggleGroup = (g: string) =>
    setGroups(prev => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g); else next.add(g);
      return next;
    });

  const filteredNotifications = useMemo(() => {
    let list = notifications;
    if (activeTab === 'unread') {
      list = list.filter(n => !n.read_at);
    }
    if (groups.size > 0) {
      list = list.filter(n => groups.has(getMeta(n.type).group));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(n =>
        n.title.toLowerCase().includes(q) ||
        (n.message?.toLowerCase().includes(q))
      );
    }
    return list;
  }, [notifications, activeTab, searchQuery, groups]);

  const groupedNotifications = useMemo(() => {
    const groups: { title: string; items: AppNotification[] }[] = [
      { title: 'Today', items: [] },
      { title: 'Yesterday', items: [] },
      { title: 'Earlier', items: [] }
    ];

    filteredNotifications.forEach(n => {
      const date = new Date(n.created_at);
      if (isToday(date)) {
        groups[0].items.push(n);
      } else if (isYesterday(date)) {
        groups[1].items.push(n);
      } else {
        groups[2].items.push(n);
      }
    });

    return groups.filter(g => g.items.length > 0);
  }, [filteredNotifications]);

  const handleNotificationClick = async (n: AppNotification) => {
    if (!n.read_at) await markRead(n.id);
    navigate(resolveNotificationLink(n));
  };

  const { isDark } = useTheme();

  return (
    <PageLayout>
      <GoldStandardHeader
        title="My Notifications"
        Icon={Bell}
        functionBar={
          <ToolbarRow
            views={
              <ToolbarSegmented<'all' | 'unread'>
                value={activeTab}
                onValueChange={setActiveTab}
                options={[
                  { id: 'all', label: 'All', count: notifications.length },
                  { id: 'unread', label: 'Unread', count: unreadCount },
                ]}
                itemAriaLabel={(label) => `${label} notifications`}
              />
            }
            actions={<>
              <label className={toolbar.search}>
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <input
                  type="search"
                  aria-label="Search notifications"
                  placeholder="Search notifications..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={toolbar.searchInput}
                />
              </label>
              {unreadCount > 0 && (
                <button type="button" onClick={markAllRead} className={toolbar.secondaryAction}>
                  Mark all as read
                </button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={groups.size > 0 ? `Filters, ${groups.size} selected` : 'Filters'}
                    className={cn(toolbar.secondaryAction, groups.size > 0 && toolbar.secondaryActionOn)}
                  >
                    <Filter className="h-3.5 w-3.5" aria-hidden="true" />
                    Filters
                    {groups.size > 0 && (
                      <span className="rounded-full bg-primary px-1.5 text-[11px] font-bold tabular-nums text-primary-foreground">
                        {groups.size}
                      </span>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[220px]">
                  <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Show categories
                  </DropdownMenuLabel>
                  {availableGroups.length === 0 ? (
                    <p className="px-2 py-2 text-[13px] text-muted-foreground">No notifications yet.</p>
                  ) : (
                    availableGroups.map(g => (
                      <DropdownMenuCheckboxItem
                        key={g}
                        checked={groups.has(g)}
                        onCheckedChange={() => toggleGroup(g)}
                        // Keep the menu open so several categories can be picked in a row.
                        onSelect={(e) => e.preventDefault()}
                        className="min-h-[44px] text-[13px]"
                      >
                        {g}
                      </DropdownMenuCheckboxItem>
                    ))
                  )}
                  {groups.size > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => setGroups(new Set())} className="min-h-[44px] text-[13px]">
                        Clear filters
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </>}
          />
        }
      />

      {/* ── BODY ── */}
      <div className={cn(
          "flex-1 min-h-0 overflow-auto p-4 lg:p-6 scrollbar-none",
          surface.bodyCard
        )}>
          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="h-24 w-full bg-primary/5 rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : filteredNotifications.length === 0 ? (
            <motion.div variants={itemVariants}>
              {/* A narrowed list is not an empty inbox — say which it is. */}
              {groups.size > 0 || searchQuery.trim() || activeTab === 'unread' ? (
                <PageState
                  state="empty"
                  icon={Inbox}
                  title="No notifications match"
                  description="Try another category, tab or search."
                  action={groups.size > 0 ? { label: 'Clear filters', onClick: () => setGroups(new Set()) } : undefined}
                />
              ) : (
                <PageState state="empty" icon={Inbox} title="You're all caught up" description="New notifications will appear here." />
              )}
            </motion.div>
          ) : (
            <motion.div variants={pageVariants} className="flex flex-col gap-4 pb-12">
              {groupedNotifications.map((group) => (
                <motion.section variants={itemVariants} key={group.title} className="flex flex-col gap-4">
                  <h3 className="text-[11px] font-black uppercase tracking-[0.4em] text-muted-foreground/40 ml-1">
                    {group.title}
                  </h3>

                  <div className="flex flex-col gap-3">
                    <AnimatePresence initial={false}>
                      {group.items.map(n => {
                        const meta = getMeta(n.type);
                        const isUnread = !n.read_at;
                        const Icon = meta.icon;

                        return (
                          <motion.div
                            key={n.id}
                            {...listItemSpring}
                            onClick={() => handleNotificationClick(n)}
                            className={cn(
                              "group relative flex items-start gap-5 p-5 rounded-2xl cursor-pointer transition-all duration-300 border",
                              isUnread
                                ? (isDark ? "bg-primary/10 border-primary/20 shadow-lg shadow-primary/5" : "bg-primary/5 border-primary/20 shadow-md shadow-primary/5")
                                : (isDark ? "bg-white/[0.02] border-white/5 hover:bg-white/[0.05]" : "bg-white border-slate-100 hover:border-slate-200 shadow-sm")
                            )}
                          >
                            {/* Icon badge */}
                            <div className={cn(
                              "relative h-12 w-12 shrink-0 rounded-xl flex items-center justify-center transition-all duration-300 shadow-lg",
                              isUnread ? meta.color : (isDark ? "bg-white/5" : "bg-slate-100")
                            )}>
                              <Icon className={cn(
                                "h-5 w-5",
                                isUnread ? "text-white" : "text-muted-foreground"
                              )} />
                              {isUnread && (
                                <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-primary ring-2 ring-background animate-pulse" />
                              )}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-3 flex-wrap">
                                  <h4 className={cn(
                                    "text-[13px] font-black uppercase tracking-wider",
                                    isUnread ? "text-foreground" : "text-muted-foreground"
                                  )}>
                                    {n.title}
                                  </h4>
                                  <span className={cn(
                                    "text-[11px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full shadow-sm",
                                    BADGE_CLASSES[meta.tone]
                                  )}>
                                    {meta.label}
                                  </span>
                                </div>
                                <p className={cn(
                                  "text-[13px] leading-relaxed",
                                  isUnread ? "font-medium text-foreground/90" : "text-muted-foreground/80"
                                )}>
                                  {n.message}
                                </p>
                              </div>

                              <div className="flex items-center gap-4 mt-3">
                                <span className="text-[11px] font-black text-muted-foreground/40 uppercase tracking-widest">
                                  {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                                </span>

                                {n.link && (
                                  <button className="text-[11px] font-black uppercase tracking-widest text-primary hover:underline transition-all flex items-center gap-1">
                                    VIEW DETAILS <ArrowRight className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                              {isUnread && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-9 w-9 rounded-xl hover:bg-primary/20 text-primary"
                                  onClick={(e) => { e.stopPropagation(); markRead(n.id); }}
                                >
                                  <CheckCheck className="h-4 w-4" />
                                </Button>
                              )}
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-9 w-9 rounded-xl hover:bg-rose-500/20 text-rose-500"
                                onClick={(e) => { e.stopPropagation(); dismiss(n.id); }}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                </motion.section>
              ))}
            </motion.div>
          )}
      </div>

      {/* Footer Info */}
      <PageLayout.Footer className={cn(surface.footerBar, 'hidden md:flex', text.overline)}>
        <p>Notifications are archived after 7 days</p>
        <div className="flex items-center gap-4">
          {(['Shifts', 'Bids', 'Swaps', 'Messages'] as const).map(kind => (
            <span key={kind} className="flex items-center gap-2">
              <span className={cn(
                "h-1.5 w-1.5 rounded-full",
                kind === 'Shifts' ? 'bg-cyan-500' : kind === 'Bids' ? 'bg-green-500' : kind === 'Swaps' ? 'bg-orange-500' : 'bg-indigo-500'
              )} /> {kind}
            </span>
          ))}
        </div>
      </PageLayout.Footer>
    </PageLayout>
  );
};

export default MyNotificationsPage;
