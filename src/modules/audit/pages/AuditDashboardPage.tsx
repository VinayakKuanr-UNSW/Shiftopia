import React, { useState } from 'react';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { ScopeFilterBanner } from '@/modules/core/ui/components/ScopeFilterBanner';
import {
    Activity, Clock, CheckCircle2, XCircle, ArrowLeftRight,
    Gavel, RefreshCw, Filter,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import {
    Plus, UserPlus, UserMinus, Send, EyeOff, Trash2, XCircle as XCircleIcon,
    Pencil, CheckCircle, Lock, Trophy, Undo2, TimerOff, Zap,
    ArrowLeftRight as ArrowLR, CheckCircle2 as Check2, PlayCircle,
    LogIn, LogOut, UserX, Timer, ShieldCheck, X, Handshake,
} from 'lucide-react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Button } from '@/modules/core/ui/primitives/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/modules/core/ui/primitives/select';
import { useRecentAuditActivity, useAuditActionCounts } from '../hooks/useAuditLog';
import { AuditLogEntryWithActor, AUDIT_ACTION_META, AuditAction, AuditCategory } from '../types/audit.types';

// ── Icon map ─────────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
    Plus, UserPlus, UserMinus, Send, EyeOff, Trash2, XCircle: XCircleIcon,
    Pencil, CheckCircle, Clock, Lock, Gavel, Trophy, Undo2, TimerOff, Zap,
    ArrowLeftRight: ArrowLR, CheckCircle2: Check2, PlayCircle,
    LogIn, LogOut, UserX, Timer, ShieldCheck, X, Handshake,
};

// ── State label ───────────────────────────────────────────────────────────────

const STATE_LABEL: Record<string, string> = {
    S1: 'Draft', S2: 'Draft Assigned', S3: 'Offered',
    S4: 'Confirmed', S5: 'Bidding (Normal)', S6: 'Bidding (Urgent)',
    S7: 'Emergency', S8: 'Bidding Closed', S9: 'Trade Requested',
    S10: 'Trade Accepted', S11: 'In Progress', S12: 'In Progress',
    S13: 'Completed', S14: 'Completed', S15: 'Cancelled',
};

// ── Summary card ─────────────────────────────────────────────────────────────

interface SummaryCardProps {
    label: string;
    value: number;
    icon: React.ReactNode;
    color: string;
}

const SummaryCard: React.FC<SummaryCardProps> = ({ label, value, icon, color }) => (
    <div className="rounded-xl border border-border dark:border-white/10 bg-card dark:bg-white/5 p-4 flex items-center gap-4">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
            {icon}
        </div>
        <div>
            <p className="text-2xl font-bold text-foreground">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
        </div>
    </div>
);

// ── Activity row ─────────────────────────────────────────────────────────────

const ActivityRow: React.FC<{ entry: AuditLogEntryWithActor }> = ({ entry }) => {
    const meta = AUDIT_ACTION_META[entry.action as AuditAction] ?? {
        label: entry.action, icon: 'Clock', color: 'bg-gray-500/20 text-gray-400', category: 'system' as AuditCategory,
    };
    const IconComp = ICON_MAP[meta.icon] ?? Clock;
    const actorName = entry.actor?.full_name ?? entry.actor_role ?? 'System';
    const isSystem  = !entry.actor_id || entry.actor_role === 'system';

    return (
        <div className="flex items-start gap-3 py-3 border-b border-border/50 dark:border-white/5 last:border-0">
            <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${meta.color}`}>
                <IconComp className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground truncate">{meta.label}</p>
                    <time className="flex-shrink-0 text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(entry.occurred_at), { addSuffix: true })}
                    </time>
                </div>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {isSystem ? (
                        <Badge variant="outline" className="text-[10px] px-1 py-0">System</Badge>
                    ) : (
                        <span className="text-xs text-muted-foreground">{actorName}</span>
                    )}
                    {entry.from_state && entry.to_state && (
                        <span className="text-xs text-muted-foreground">
                            {STATE_LABEL[entry.from_state] ?? entry.from_state}
                            {' → '}
                            {STATE_LABEL[entry.to_state] ?? entry.to_state}
                        </span>
                    )}
                    {entry.reason && (
                        <span className="text-xs text-muted-foreground italic truncate">
                            "{entry.reason}"
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};

// ── Main page ─────────────────────────────────────────────────────────────────

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
    { value: 'all',        label: 'All Categories' },
    { value: 'lifecycle',  label: 'Lifecycle' },
    { value: 'offer',      label: 'Offers' },
    { value: 'bidding',    label: 'Bidding' },
    { value: 'trade',      label: 'Trades & Swaps' },
    { value: 'attendance', label: 'Attendance' },
];

const DATE_RANGE_OPTIONS = [
    { value: '1',  label: 'Last 24 hours' },
    { value: '7',  label: 'Last 7 days' },
    { value: '30', label: 'Last 30 days' },
];

const AuditDashboardPage: React.FC = () => {
    const [days,     setDays]     = useState('7');
    const [category, setCategory] = useState('all');
    const { scope, setScope, isGammaLocked } = useScopeFilter('managerial');

    const today    = format(endOfDay(new Date()),         "yyyy-MM-dd'T'HH:mm:ss'Z'");
    const fromDate = format(startOfDay(subDays(new Date(), Number(days))), 'yyyy-MM-dd');
    const toDate   = format(new Date(), 'yyyy-MM-dd');

    const orgIds  = scope.org_ids.length  ? scope.org_ids  : undefined;
    const deptIds = scope.dept_ids.length ? scope.dept_ids : undefined;

    const { data: activity = [], isLoading, refetch } = useRecentAuditActivity({
        category: category !== 'all' ? category as AuditCategory : undefined,
        fromDate,
        toDate,
        limit: 200,
        orgIds,
        deptIds,
    });

    const { data: counts = {} } = useAuditActionCounts(fromDate, toDate, orgIds, deptIds);

    // Summary stats from counts
    const totalEvents      = Object.values(counts).reduce((a, b) => a + b, 0);
    const offers           = (counts['OFFER_ACCEPTED'] ?? 0) + (counts['OFFER_DECLINED'] ?? 0) + (counts['OFFER_EXPIRED'] ?? 0);
    const tradeEvents      = (counts['TRADE_REQUESTED'] ?? 0) + (counts['TRADE_APPROVED'] ?? 0);
    const bidEvents        = (counts['BID_PLACED'] ?? 0) + (counts['BID_SELECTED'] ?? 0);
    const systemEvents     = (counts['BIDDING_TIMEOUT'] ?? 0) + (counts['AUTO_START'] ?? 0) + (counts['AUTO_COMPLETE'] ?? 0) + (counts['SWAP_EXPIRED'] ?? 0);

    return (
        <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
            <main className="p-4 md:p-8 space-y-6 max-w-6xl mx-auto pb-24 md:pb-8">

                {/* Scope Filter */}
                <ScopeFilterBanner
                    mode="managerial"
                    onScopeChange={setScope}
                    hidden={isGammaLocked}
                />

                {/* Header */}
                <div className="rounded-2xl border border-border dark:border-white/10 bg-card dark:bg-white/5 backdrop-blur-xl p-6">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div>
                            <h1 className="text-3xl font-bold text-foreground">Audit Trail</h1>
                            <p className="text-muted-foreground mt-1 text-sm">
                                Full traceability of every shift lifecycle event — who did what and when.
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => refetch()}
                            className="border-border dark:border-white/10 text-foreground hover:bg-muted dark:hover:bg-white/10"
                        >
                            <RefreshCw className="w-4 h-4 mr-2" />
                            Refresh
                        </Button>
                    </div>
                </div>

                {/* Summary cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <SummaryCard
                        label="Total Events"
                        value={totalEvents}
                        icon={<Activity className="w-5 h-5" />}
                        color="bg-blue-500/20 text-blue-400"
                    />
                    <SummaryCard
                        label="Offer Events"
                        value={offers}
                        icon={<CheckCircle2 className="w-5 h-5" />}
                        color="bg-green-500/20 text-green-400"
                    />
                    <SummaryCard
                        label="Bid Events"
                        value={bidEvents}
                        icon={<Gavel className="w-5 h-5" />}
                        color="bg-cyan-500/20 text-cyan-400"
                    />
                    <SummaryCard
                        label="Trade Events"
                        value={tradeEvents}
                        icon={<ArrowLeftRight className="w-5 h-5" />}
                        color="bg-violet-500/20 text-violet-400"
                    />
                </div>

                {/* Filters + feed */}
                <div className="rounded-xl border border-border dark:border-white/10 bg-card dark:bg-white/5 p-4 md:p-6">
                    {/* Filters row */}
                    <div className="flex items-center gap-3 flex-wrap mb-4">
                        <Filter className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <Select value={days} onValueChange={setDays}>
                            <SelectTrigger className="w-40 bg-background dark:bg-white/5 border-border dark:border-white/10 text-sm">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {DATE_RANGE_OPTIONS.map(o => (
                                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Select value={category} onValueChange={setCategory}>
                            <SelectTrigger className="w-48 bg-background dark:bg-white/5 border-border dark:border-white/10 text-sm">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {CATEGORY_OPTIONS.map(o => (
                                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <span className="text-xs text-muted-foreground ml-auto">
                            {activity.length} events
                        </span>
                    </div>

                    {/* Activity feed */}
                    {isLoading ? (
                        <div className="space-y-3">
                            {[1, 2, 3, 4, 5].map(i => (
                                <div key={i} className="flex gap-3 animate-pulse py-3">
                                    <div className="w-8 h-8 rounded-full bg-muted dark:bg-white/10 flex-shrink-0" />
                                    <div className="flex-1 space-y-2 pt-1">
                                        <div className="h-3 bg-muted dark:bg-white/10 rounded w-1/3" />
                                        <div className="h-2 bg-muted dark:bg-white/10 rounded w-1/4" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : activity.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                            <Activity className="w-10 h-10 mx-auto mb-3 opacity-30" />
                            <p className="text-sm">No events in the selected range.</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-border dark:divide-white/5">
                            {activity.map(entry => (
                                <ActivityRow key={entry.id} entry={entry} />
                            ))}
                        </div>
                    )}
                </div>

                {/* System automation status */}
                {systemEvents > 0 && (
                    <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 flex items-center gap-3">
                        <Timer className="w-5 h-5 text-yellow-400 flex-shrink-0" />
                        <p className="text-sm text-yellow-200/80">
                            <span className="font-semibold">{systemEvents}</span> automated timer event
                            {systemEvents !== 1 ? 's' : ''} executed in this period
                            (bidding timeouts, auto-starts, swap expirations).
                        </p>
                    </div>
                )}

            </main>
        </div>
    );
};

export default AuditDashboardPage;
