// src/modules/core/pages/MyNotificationsPage.tsx
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
import { Input } from '@/modules/core/ui/primitives/input';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { pageVariants, itemVariants, listItemSpring } from '@/modules/core/ui/motion/presets';

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
  return TYPE_META[type] ?? { label: 'Notice', icon: Bell, color: 'bg-slate-400', group: 'General', accent: 'bg-slate-400', tone: 'neutral' };
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

  const filteredNotifications = useMemo(() => {
    let list = notifications;
    if (activeTab === 'unread') {
      list = list.filter(n => !n.read_at);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(n =>
        n.title.toLowerCase().includes(q) ||
        (n.message?.toLowerCase().includes(q))
      );
    }
    return list;
  }, [notifications, activeTab, searchQuery]);

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
    <div className="h-full flex flex-col overflow-hidden bg-background">
      <GoldStandardHeader
        title="My Notifications"
        Icon={Bell}
        rightActions={
          unreadCount > 0 && (
            <Button
              onClick={markAllRead}
              variant="link"
              size="sm"
              className="text-primary font-semibold hover:no-underline px-0 text-[10px] uppercase tracking-widest"
            >
              Mark all as read
            </Button>
          )
        }
        functionBar={
          <div className="flex flex-col lg:flex-row items-center gap-4 w-full">
            <div className={cn(
              "flex p-1 rounded-xl w-full lg:w-auto",
              isDark ? "bg-black/20" : "bg-white/60 border border-slate-200/50 shadow-inner"
            )}>
              <button
                onClick={() => setActiveTab('all')}
                className={cn(
                  "flex-1 lg:flex-none flex items-center justify-center gap-2 px-6 h-10 lg:h-11 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                  activeTab === 'all'
                    ? "bg-primary text-white shadow-lg shadow-primary/20"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                All ({notifications.length})
              </button>
              <button
                onClick={() => setActiveTab('unread')}
                className={cn(
                  "flex-1 lg:flex-none flex items-center justify-center gap-2 px-6 h-10 lg:h-11 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                  activeTab === 'unread'
                    ? "bg-primary text-white shadow-lg shadow-primary/20"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Unread {unreadCount > 0 && `(${unreadCount})`}
              </button>
            </div>

            <div className={cn(
              "flex-1 flex items-center gap-2 w-full lg:w-auto p-1 rounded-xl",
              isDark ? "bg-black/20" : "bg-white/60 border border-slate-200/50 shadow-inner"
            )}>
              <div className="pl-3 text-muted-foreground/40">
                <Search className="h-4 w-4" />
              </div>
              <Input
                placeholder="SEARCH NOTIFICATIONS..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent border-0 shadow-none focus:ring-0 text-[11px] font-black uppercase tracking-widest h-10 lg:h-11"
              />
            </div>

            <Button
              variant="outline"
              className={cn(
                "h-10 lg:h-11 px-4 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all border-0",
                isDark ? "bg-white/5 text-white/40 hover:bg-white/10 hover:text-white" : "bg-white/60 text-slate-900/40 hover:bg-white hover:text-slate-900 border border-slate-200/50"
              )}
            >
              <Filter className="h-3.5 w-3.5 mr-2" />
              FILTERS
            </Button>
          </div>
        }
      />

      {/* ── BODY ── */}
      <div className={cn(
          "flex-1 min-h-0 overflow-auto mx-4 lg:mx-6 mb-4 lg:mb-6 rounded-[32px] transition-all border p-4 lg:p-6 scrollbar-none",
          isDark
            ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20"
            : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
        )}>
          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="h-24 w-full bg-primary/5 rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : filteredNotifications.length === 0 ? (
            <motion.div
              variants={itemVariants}
              className="flex flex-col items-center justify-center py-24 text-center opacity-70"
            >
              <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center mb-6">
                <Inbox className="h-10 w-10 text-primary/40" />
              </div>
              <h3 className="text-xl font-black uppercase tracking-widest text-foreground/80">You're all caught up</h3>
              <p className="text-muted-foreground max-w-sm mt-1 text-sm">
                No notifications found. Enjoy your productive workspace!
              </p>
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
                                    "text-sm font-black uppercase tracking-wider",
                                    isUnread ? "text-foreground" : "text-muted-foreground"
                                  )}>
                                    {n.title}
                                  </h4>
                                  <span className={cn(
                                    "text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full shadow-sm",
                                    BADGE_CLASSES[meta.tone]
                                  )}>
                                    {meta.label}
                                  </span>
                                </div>
                                <p className={cn(
                                  "text-sm leading-relaxed",
                                  isUnread ? "font-medium text-foreground/90" : "text-muted-foreground/80"
                                )}>
                                  {n.message}
                                </p>
                              </div>

                              <div className="flex items-center gap-4 mt-3">
                                <span className="text-[10px] font-black text-muted-foreground/40 uppercase tracking-widest">
                                  {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                                </span>

                                {n.link && (
                                  <button className="text-[10px] font-black uppercase tracking-widest text-primary hover:underline transition-all flex items-center gap-1">
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
      <div className="hidden md:flex items-center justify-between text-muted-foreground/30 text-[9px] font-black uppercase tracking-widest px-4 lg:px-6 pb-4">
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
      </div>
    </div>
  );
};

export default MyNotificationsPage;
