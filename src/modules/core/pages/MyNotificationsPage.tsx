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
import { 
  formatDistanceToNow, 
  isToday, 
  isYesterday, 
  startOfDay, 
  subDays 
} from 'date-fns';
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
type TypeMeta = { label: string; icon: React.ElementType; color: string; group: string; accent: string };

const TYPE_META: Record<string, TypeMeta> = {
  shift_assigned:       { label: 'Shift Assigned',   icon: Calendar,      color: 'bg-cyan-500',    group: 'Shifts',     accent: 'bg-cyan-500' },
  shift_cancelled:      { label: 'Shift Cancelled',  icon: Calendar,      color: 'bg-red-500',     group: 'Shifts',     accent: 'bg-red-500' },
  shift_dropped:        { label: 'Shift Dropped',    icon: Calendar,      color: 'bg-orange-500',  group: 'Shifts',     accent: 'bg-orange-500' },
  shift_updated:        { label: 'Shift Updated',    icon: Calendar,      color: 'bg-blue-500',    group: 'Shifts',     accent: 'bg-blue-500' },
  emergency_assignment: { label: 'Emergency',        icon: BellRing,      color: 'bg-rose-600',    group: 'Shifts',     accent: 'bg-rose-600' },
  bid_accepted:         { label: 'Bid Accepted',     icon: BadgeCheck,    color: 'bg-green-500',   group: 'Bids',       accent: 'bg-green-500' },
  bid_rejected:         { label: 'Bid Rejected',     icon: BadgeCheck,    color: 'bg-red-500',     group: 'Bids',       accent: 'bg-red-500' },
  bid_no_winner:        { label: 'No Winner',        icon: BadgeCheck,    color: 'bg-rose-500',    group: 'Bids',       accent: 'bg-rose-500' },
  offer_expired:        { label: 'Offer Expired',    icon: Calendar,      color: 'bg-rose-500',    group: 'Shifts',     accent: 'bg-rose-500' },
  swap_request:         { label: 'Swap Request',     icon: RefreshCw,     color: 'bg-orange-500',  group: 'Swaps',      accent: 'bg-orange-500' },
  swap_approved:        { label: 'Swap Approved',    icon: RefreshCw,     color: 'bg-green-500',   group: 'Swaps',      accent: 'bg-green-500' },
  swap_rejected:        { label: 'Swap Rejected',    icon: RefreshCw,     color: 'bg-red-500',     group: 'Swaps',      accent: 'bg-red-500' },
  swap_expired:         { label: 'Swap Expired',     icon: RefreshCw,     color: 'bg-rose-500',    group: 'Swaps',      accent: 'bg-rose-500' },
  broadcast:            { label: 'Message',          icon: MessageSquare, color: 'bg-indigo-500',  group: 'Messages',   accent: 'bg-indigo-500' },
  timesheet_approved:   { label: 'Timesheet Apprv',  icon: Clock,         color: 'bg-emerald-500', group: 'Timesheets', accent: 'bg-emerald-500' },
  timesheet_rejected:   { label: 'Timesheet Rej',    icon: Clock,         color: 'bg-red-500',     group: 'Timesheets', accent: 'bg-red-500' },
  general:              { label: 'Notice',           icon: Bell,          color: 'bg-slate-400',   group: 'General',    accent: 'bg-slate-400' },
};

function getMeta(type: string): TypeMeta {
  return TYPE_META[type] ?? { label: 'Notice', icon: Bell, color: 'bg-slate-400', group: 'General', accent: 'bg-slate-400' };
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

  return (
    <div className="flex flex-col h-full bg-background p-4 sm:p-6 md:p-8 animate-in fade-in duration-500">
      {/* 2. Header Redesign (Point 2) */}
      <div className="flex flex-row items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            My Notifications
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Stay updated with your workspace activity
          </p>
        </div>
        
        {unreadCount > 0 && (
          <Button 
            onClick={markAllRead}
            variant="link"
            size="sm"
            className="text-primary font-semibold hover:no-underline px-0"
          >
            Mark all as read
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-6">
        {/* 3. Tabs (Point 3) - Segmented Control */}
        <div className="flex p-1 bg-muted/30 rounded-lg border border-border/40 w-fit">
          <button
            onClick={() => setActiveTab('all')}
            className={cn(
              "flex items-center gap-2 px-6 py-1.5 rounded-md text-sm font-medium transition-all duration-200",
              activeTab === 'all' 
                ? "bg-background shadow-sm text-foreground" 
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            All
            <span className={cn(
              "ml-1 text-[10px] px-1.5 py-0.5 rounded-full",
              activeTab === 'all' ? "bg-muted text-foreground" : "bg-muted/50 text-muted-foreground"
            )}>
              {notifications.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('unread')}
            className={cn(
              "flex items-center gap-2 px-6 py-1.5 rounded-md text-sm font-medium transition-all duration-200",
              activeTab === 'unread' 
                ? "bg-background shadow-sm text-foreground" 
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            Unread
            {unreadCount > 0 && (
              <span className={cn(
                "ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary"
              )}>
                {unreadCount}
              </span>
            )}
          </button>
        </div>

        <div className="sticky top-0 z-20 flex items-center gap-3 bg-background/80 backdrop-blur-md pt-2 pb-4 border-b border-border/10">
          <div className="relative flex-1 group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
            <Input
              placeholder="Search notifications..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-10 bg-muted/20 border-border/40 rounded-lg focus:ring-primary/20 focus:border-primary/40 text-sm"
            />
          </div>
          <Button variant="outline" size="sm" className="h-10 px-3 border-border/40 text-muted-foreground">
            <Filter className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Filter</span>
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-none pb-20">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-20 w-full bg-muted/30 rounded-lg animate-pulse border border-border/20" />
              ))}
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center opacity-70">
              <div className="h-16 w-16 rounded-full bg-muted/40 flex items-center justify-center mb-4">
                <Inbox className="h-8 w-8 text-muted-foreground/40" />
              </div>
              <h3 className="text-xl font-bold text-foreground/80">You're all caught up 🎉</h3>
              <p className="text-muted-foreground max-w-sm mt-1 text-sm">
                No notifications found. Enjoy your productive workspace!
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-8 pb-12">
              {groupedNotifications.map((group) => (
                <section key={group.title} className="flex flex-col gap-3">
                  <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 ml-1">
                    {group.title}
                  </h3>
                  
                  <div className="flex flex-col gap-3">
                    {group.items.map(n => {
                      const meta = getMeta(n.type);
                      const isUnread = !n.read_at;
                      const Icon = meta.icon;

                      return (
                        <div
                          key={n.id}
                          onClick={() => handleNotificationClick(n)}
                          className={cn(
                            "group relative flex items-start gap-4 p-4 rounded-xl cursor-pointer transition-all duration-200 border",
                            "shadow-sm hover:shadow-md hover:border-primary/20",
                            isUnread 
                              ? "bg-primary/5 border-primary/10" 
                              : "bg-card border-border/40"
                          )}
                        >
                          {isUnread && (
                            <div className={cn("absolute left-0 top-3 bottom-3 w-1 rounded-r-full", meta.accent)} />
                          )}

                          <div className={cn(
                            "relative h-8 w-8 shrink-0 rounded-lg flex items-center justify-center transition-transform",
                            isUnread ? meta.color : "bg-muted text-muted-foreground",
                            "shadow-sm"
                          )}>
                            <Icon className={cn("h-4 w-4", isUnread ? "text-white" : "text-muted-foreground")} />
                          </div>

                          <div className="flex-1 min-w-0 pr-10">
                            <div className="flex flex-col">
                              <h4 className={cn(
                                "text-xs font-black uppercase tracking-wider mb-0.5",
                                isUnread ? "text-foreground" : "text-muted-foreground"
                              )}>
                                {n.title}
                              </h4>
                              <p className={cn(
                                "text-sm leading-snug break-words",
                                isUnread ? "font-medium text-foreground/90" : "text-muted-foreground/80"
                              )}>
                                {n.message}
                              </p>
                            </div>
                            
                            <div className="flex items-center gap-3 mt-2">
                              <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest">
                                {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                              </span>
                              
                              {n.link && (
                                <button className="text-[10px] font-black uppercase tracking-tighter text-primary hover:underline transition-colors flex items-center">
                                  View details <ArrowRight className="ml-1 h-2 w-2" />
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="absolute top-4 right-4 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                            {isUnread && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 rounded-lg hover:bg-primary/10 text-primary"
                                onClick={(e) => { e.stopPropagation(); markRead(n.id); }}
                                title="Mark as read"
                              >
                                <CheckCheck className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 rounded-lg hover:bg-red-500/10 text-red-500"
                              onClick={(e) => { e.stopPropagation(); dismiss(n.id); }}
                              title="Dismiss"
                            >
                              <X className="h-4 w-4" />
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
        </div>
      </div>

      <div className="hidden md:flex items-center justify-between pt-6 border-t border-border/10 text-muted-foreground/40 text-[10px] font-bold uppercase tracking-widest mt-auto">
        <p>Notifications are automatically cleared after 7 days</p>
        <div className="flex items-center gap-4">
          {['Shifts', 'Bids', 'Swaps', 'Messages'].map(kind => (
            <span key={kind} className="flex items-center gap-1.5 opacity-60">
              <span className={cn("h-1.5 w-1.5 rounded-full", kind === 'Shifts' ? 'bg-cyan-500' : kind === 'Bids' ? 'bg-green-500' : kind === 'Swaps' ? 'bg-orange-500' : 'bg-indigo-500')} /> {kind}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default MyNotificationsPage;
