import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Trash2
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { 
  useNotifications, 
  resolveNotificationLink, 
  type AppNotification 
} from '@/modules/core/hooks/useNotifications';
import { Button } from '@/modules/core/ui/primitives/button';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { Separator } from '@/modules/core/ui/primitives/separator';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Input } from '@/modules/core/ui/primitives/input';
import { cn } from '@/modules/core/lib/utils';

/* ── Type metadata ──────────────────────────────────────────── */
type TypeMeta = { label: string; icon: React.ElementType; color: string; group: string };

const TYPE_META: Record<string, TypeMeta> = {
  shift_assigned:       { label: 'Shift Assigned',   icon: Calendar,      color: 'bg-cyan-500',    group: 'Shifts'     },
  shift_cancelled:      { label: 'Shift Cancelled',  icon: Calendar,      color: 'bg-red-500',     group: 'Shifts'     },
  shift_dropped:        { label: 'Shift Dropped',    icon: Calendar,      color: 'bg-orange-500',  group: 'Shifts'     },
  shift_updated:        { label: 'Shift Updated',    icon: Calendar,      color: 'bg-blue-500',    group: 'Shifts'     },
  emergency_assignment: { label: 'Emergency',        icon: BellRing,      color: 'bg-rose-600',    group: 'Shifts'     },
  bid_accepted:         { label: 'Bid Accepted',     icon: BadgeCheck,    color: 'bg-green-500',   group: 'Bids'       },
  bid_rejected:         { label: 'Bid Rejected',     icon: BadgeCheck,    color: 'bg-red-500',     group: 'Bids'       },
  bid_no_winner:        { label: 'No Winner',        icon: BadgeCheck,    color: 'bg-rose-500',    group: 'Bids'       },
  offer_expired:        { label: 'Offer Expired',    icon: Calendar,      color: 'bg-rose-500',    group: 'Shifts'     },
  swap_request:         { label: 'Swap Request',     icon: RefreshCw,     color: 'bg-orange-500',  group: 'Swaps'      },
  swap_approved:        { label: 'Swap Approved',    icon: RefreshCw,     color: 'bg-green-500',   group: 'Swaps'      },
  swap_rejected:        { label: 'Swap Rejected',    icon: RefreshCw,     color: 'bg-red-500',     group: 'Swaps'      },
  swap_expired:         { label: 'Swap Expired',     icon: RefreshCw,     color: 'bg-rose-500',    group: 'Swaps'      },
  broadcast:            { label: 'Message',          icon: MessageSquare, color: 'bg-indigo-500',  group: 'Messages'   },
  timesheet_approved:   { label: 'Timesheet Apprv',  icon: Clock,         color: 'bg-emerald-500', group: 'Timesheets' },
  timesheet_rejected:   { label: 'Timesheet Rej',    icon: Clock,         color: 'bg-red-500',     group: 'Timesheets' },
  general:              { label: 'Notice',           icon: Bell,          color: 'bg-slate-400',   group: 'General'    },
};

function getMeta(type: string): TypeMeta {
  return TYPE_META[type] ?? { label: 'Notice', icon: Bell, color: 'bg-slate-400', group: 'General' };
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
    const groups: Record<string, AppNotification[]> = {};
    filteredNotifications.forEach(n => {
      const group = getMeta(n.type).group;
      if (!groups[group]) groups[group] = [];
      groups[group].push(n);
    });
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredNotifications]);

  const handleNotificationClick = async (n: AppNotification) => {
    if (!n.read_at) await markRead(n.id);
    navigate(resolveNotificationLink(n));
  };

  return (
    <div className="flex flex-col h-full bg-background/50 backdrop-blur-sm p-8 space-y-8 animate-in fade-in duration-500">
      {/* Header Section */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-primary via-purple-500 to-indigo-600 bg-clip-text text-transparent">
            My Notifications
          </h1>
          <p className="text-muted-foreground mt-2 text-lg">
            Stay updated with your latest workspace activity.
          </p>
        </div>
        <div className="flex items-center gap-4">
          {unreadCount > 0 && (
            <Button 
              onClick={markAllRead}
              className="bg-primary/10 hover:bg-primary/20 text-primary border-primary/20"
              variant="outline"
            >
              <CheckCheck className="mr-2 h-4 w-4" />
              Mark all as read
            </Button>
          )}
        </div>
      </div>

      {/* Controls Section */}
      <div className="flex flex-col md:flex-row gap-6 items-center">
        <div className="flex bg-muted/30 p-1 rounded-2xl border border-border/40 backdrop-blur-md">
          <button
            onClick={() => setActiveTab('all')}
            className={cn(
              "px-6 py-2 rounded-xl text-sm font-semibold transition-all duration-300",
              activeTab === 'all' 
                ? "bg-background shadow-lg text-primary scale-105" 
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            All Notifications
            <Badge variant="outline" className="ml-2 bg-transparent opacity-60">
              {notifications.length}
            </Badge>
          </button>
          <button
            onClick={() => setActiveTab('unread')}
            className={cn(
              "px-6 py-2 rounded-xl text-sm font-semibold transition-all duration-300",
              activeTab === 'unread' 
                ? "bg-background shadow-lg text-primary scale-105" 
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            Unread
            {unreadCount > 0 && (
              <Badge className="ml-2 bg-primary/20 text-primary hover:bg-primary/20">
                {unreadCount}
              </Badge>
            )}
          </button>
        </div>

        <div className="relative flex-1 group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground transition-colors group-focus-within:text-primary" />
          <Input
            placeholder="Search notifications..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-12 h-12 bg-muted/20 border-border/40 rounded-2xl focus:ring-primary/20 focus:border-primary/40 text-lg transition-all"
          />
        </div>

        <Button variant="ghost" className="h-12 rounded-2xl px-6 text-muted-foreground hover:text-foreground">
          <Filter className="mr-2 h-5 w-5" />
          Filter
        </Button>
      </div>

      {/* Notifications List */}
      <ScrollArea className="flex-1 -mx-4 px-4 overflow-y-auto pr-6 custom-scrollbar">
        {loading ? (
          <div className="space-y-6">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-32 w-full bg-muted/30 rounded-3xl animate-pulse border border-border/20" />
            ))}
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-center opacity-70">
            <div className="h-24 w-24 rounded-full bg-muted/40 flex items-center justify-center mb-6">
              <Inbox className="h-12 w-12 text-muted-foreground/40" />
            </div>
            <h3 className="text-2xl font-bold text-foreground/80">All caught up!</h3>
            <p className="text-muted-foreground max-w-sm mt-2">
              No notifications found. Enjoy your productive workspace!
            </p>
          </div>
        ) : (
          <div className="space-y-12 pb-12">
            {groupedNotifications.map(([group, items]) => (
              <section key={group} className="space-y-4">
                <div className="flex items-center gap-4">
                  <h2 className="text-xl font-bold tracking-tight text-foreground/70 uppercase">
                    {group}
                  </h2>
                  <div className="h-px flex-1 bg-gradient-to-r from-border/50 to-transparent" />
                  <span className="text-sm font-medium text-muted-foreground bg-muted/40 px-3 py-1 rounded-full border border-border/30">
                    {items.length} items
                  </span>
                </div>
                
                <div className="grid gap-4">
                  {items.map(n => {
                    const meta = getMeta(n.type);
                    const isUnread = !n.read_at;
                    const Icon = meta.icon;

                    return (
                      <div
                        key={n.id}
                        onClick={() => handleNotificationClick(n)}
                        className={cn(
                          "group relative flex items-center gap-6 p-6 rounded-3xl cursor-pointer transition-all duration-400 overflow-hidden",
                          "border border-border/40",
                          isUnread 
                            ? "bg-gradient-to-r from-primary/10 via-background to-background shadow-xl scale-[1.01] border-primary/20" 
                            : "bg-background/40 opacity-80 hover:opacity-100 hover:bg-muted/10"
                        )}
                      >
                        {/* Status bar */}
                        {isUnread && (
                          <div className="absolute left-0 top-0 h-full w-1.5 bg-gradient-to-b from-primary to-purple-600 rounded-r-full" />
                        )}

                        {/* Icon Container */}
                        <div className={cn(
                          "relative h-16 w-16 shrink-0 rounded-2xl flex items-center justify-center transition-transform duration-300 group-hover:scale-110",
                          meta.color,
                          "shadow-lg"
                        )}>
                          <Icon className="h-8 w-8 text-white drop-shadow-sm" />
                          {isUnread && (
                            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-white animate-pulse shadow-md flex items-center justify-center">
                              <span className="h-2 w-2 rounded-full bg-primary" />
                            </span>
                          )}
                        </div>

                        {/* Text Content */}
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center justify-between gap-4">
                            <h4 className={cn(
                              "text-xl font-bold truncate transition-colors",
                              isUnread ? "text-foreground" : "text-foreground/70"
                            )}>
                              {n.title}
                            </h4>
                            <span className="text-sm font-medium text-muted-foreground/60 whitespace-nowrap bg-muted/30 px-3 py-1 rounded-lg">
                              {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                            </span>
                          </div>
                          {n.message && (
                            <p className="text-muted-foreground text-base line-clamp-2 max-w-4xl leading-relaxed">
                              {n.message}
                            </p>
                          )}
                          <div className="flex items-center gap-3 pt-1">
                            <Badge variant="secondary" className="bg-muted/50 text-xs font-semibold uppercase tracking-wider">
                              {meta.label}
                            </Badge>
                            {n.link && (
                              <span className="text-primary/70 text-sm font-medium flex items-center group-hover:text-primary transition-colors">
                                View details <ArrowRight className="ml-1 h-3 w-3 transition-transform group-hover:translate-x-1" />
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Actions Overlay */}
                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-x-4 group-hover:translate-x-0">
                          {isUnread && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-10 w-10 rounded-xl hover:bg-primary/20 text-primary transition-all active:scale-90"
                              onClick={(e) => { e.stopPropagation(); markRead(n.id); }}
                              title="Mark as read"
                            >
                              <CheckCheck className="h-5 w-5" />
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-10 w-10 rounded-xl hover:bg-red-500/20 text-red-500 transition-all active:scale-90"
                            onClick={(e) => { e.stopPropagation(); dismiss(n.id); }}
                            title="Dismiss"
                          >
                            <Trash2 className="h-5 w-5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Footer Info */}
      <div className="flex items-center justify-between pt-6 border-t border-border/30 text-muted-foreground/50 text-xs">
        <p>Notifications are automatically cleared 7 days after being read.</p>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-cyan-500" /> Shifts
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-green-500" /> Bids
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-orange-500" /> Swaps
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-indigo-500" /> Messages
          </span>
        </div>
      </div>
    </div>
  );
};

export default MyNotificationsPage;
