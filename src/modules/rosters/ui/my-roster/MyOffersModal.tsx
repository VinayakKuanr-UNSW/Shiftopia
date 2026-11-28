import React, { useState, useEffect, useMemo } from 'react';
import { formatCalendarDate, getShiftInstant } from '@/modules/core/lib/date.utils';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/modules/core/ui/primitives/alert-dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import { useToast } from '@/modules/core/hooks/use-toast';
import {
    useMyOffers,
    useMyOffersHistory,
    useAcceptOffer,
    useDeclineOffer,
} from '@/modules/rosters/state/useRosterShifts';
import { useAuth } from '@/platform/auth/useAuth';
import { cn } from '@/modules/core/lib/utils';
import { text, touch } from '@/modules/core/ui/typography';
import {
    Inbox,
    CheckCircle,
    XCircle,
    Loader2,
    AlertTriangle,
    RotateCw,
    X,
    Ban,
    List,
    LayoutGrid,
    ListChecks,
} from 'lucide-react';
import { isShiftLocked } from '@/modules/rosters/domain/shift-locking.utils';
import { GROUP_DISPLAY_NAMES } from '@/modules/rosters/domain/projections/constants';
import { SharedShiftCard } from '@/modules/planning/ui/components/SharedShiftCard';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/modules/core/ui/primitives/dialog';
import { groupVariantFor } from '@/modules/rosters/domain/shift-ui';
import { Table, tableTokens, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/modules/core/ui/primitives/table';
import { SortableTableHeader } from '@/modules/core/ui/primitives/sortable-table-header';
import { useTableSorting } from '@/modules/core/hooks/useTableSorting';
import { getDeptColor, getRowClass } from '@/modules/planning/bidding/ui/utils/bid-dept-styles';
import { calculateTimeRemaining } from '@/modules/planning/bidding/ui/views/OpenBidsView/utils';
import { Checkbox } from '@/modules/core/ui/primitives/checkbox';

/**
 * Format time remaining without displaying seconds (e.g., '3w 1d 6h 3m' or '< 1m').
 */
export const formatTimeRemainingNoSeconds = (timeRemaining: {
    years: number;
    months: number;
    weeks: number;
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
    isExpired: boolean;
}): string => {
    if (timeRemaining.isExpired) return 'Closed';
    const parts: string[] = [];
    if (timeRemaining.years > 0) parts.push(`${timeRemaining.years}y`);
    if (timeRemaining.months > 0) parts.push(`${timeRemaining.months}mo`);
    if (timeRemaining.weeks > 0) parts.push(`${timeRemaining.weeks}w`);
    if (timeRemaining.days > 0) parts.push(`${timeRemaining.days}d`);
    if (timeRemaining.hours > 0) parts.push(`${timeRemaining.hours}h`);
    if (timeRemaining.minutes > 0) parts.push(`${timeRemaining.minutes}m`);

    return parts.join(' ') || '< 1m';
};

/* ═══════════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════════ */

type OfferStatus = 'Pending' | 'Accepted' | 'Declined';

interface MyOffersModalProps {
    isOpen: boolean;
    onClose: () => void;
    onOfferResponded?: () => void;
    filters?: {
        organizationId?: string;
        departmentId?: string;
    };
    defaultViewMode?: 'table' | 'card';
}

interface OfferData {
    id: string;
    shift_id: string;
    status: OfferStatus;
    offered_at: string;
    offer_expires_at?: string | null;
    offered_by_name: string;
    shift: {
        id: string;
        shift_date: string;
        start_time: string;
        end_time: string;
        roles?: { name: string } | null;
        departments?: { name: string } | null;
        sub_departments?: { name: string } | null;
        organizations?: { name: string } | null;
        notes?: string | null;
        break_minutes?: number;
        paid_break_minutes?: number;
        unpaid_break_minutes?: number;
        offer_expires_at?: string | null;
        remuneration_levels?: {
            level_name: string;
            level_number?: number;
        } | null;
        group_type?: string | null;
        sub_group_name?: string | null;
    };
}

/* ═══════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════ */

function computeNetLength(shift: OfferData['shift']): number {
    const p = (t: string) => {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
    };
    const gross = p(shift.end_time) - p(shift.start_time);
    return Math.max(0, gross - (shift.unpaid_break_minutes ?? 0));
}

/**
 * Parse `offer_expires_at`, which is a timestamptz and so arrives from PostgREST
 * with an offset already attached. The `+ 'Z'` branch is only a fallback for a
 * value that somehow reaches here naive.
 *
 * This must NOT be used on shift_date/start_time. Those are Sydney wall-clock
 * and belong to `getShiftInstant`. Passing them here looks like it works and
 * does not: the guard regex `[+-]\d{2}` matches the hyphens inside the DATE, so
 * "2026-08-20T05:30:00" is mistaken for a string that already carries an offset,
 * no Z is appended, and `new Date` parses it in the VIEWER's timezone. On a
 * Sydney machine that lands on the right instant by coincidence — which is
 * exactly why the wrong reading survived — but for anyone else the 4h offer
 * window, the countdown and the auto-expire write it triggers all move by their
 * local offset.
 */
function parseExpiry(raw: unknown): number | null {
    if (!raw) return null;
    const s = typeof raw === 'string' ? raw.trim() : String(raw);
    const normalised = s.includes(' ') && !s.includes('T') ? s.replace(' ', 'T') : s;
    const withZ = /Z|[+-]\d{2}/.test(normalised) ? normalised : normalised + 'Z';
    const t = new Date(withZ).getTime();
    return isNaN(t) ? null : t;
}

/** The instant an offer stops being actionable, or null when it never does. */
function resolveOfferDeadline(offer: OfferData): number | null {
    const stated = parseExpiry(offer.offer_expires_at ?? offer.shift.offer_expires_at);
    if (stated != null) return stated;

    // No stated deadline: the offer stays open until the shift starts (B-D9).
    const start = getShiftInstant(offer.shift, 'start');
    return start ? start.getTime() : null;
}

/* ═══════════════════════════════════════════════════════════════════════
   OFFER ITEM — wraps SharedShiftCard with live expiry countdown
   ═══════════════════════════════════════════════════════════════════════ */

const OfferItem: React.FC<{
    offer: OfferData;
    recipientName?: string;
    showActions: boolean;
    processingId: string | null;
    onAccept: (shiftId: string) => void;
    onDeclineRequest: (shiftId: string) => void;
}> = ({ offer, recipientName, showActions, processingId, onAccept, onDeclineRequest }) => {
    const [timerText, setTimerText] = useState<string | null>(null);
    const [isExpired, setIsExpired] = useState(false);

    const deadlineMs = resolveOfferDeadline(offer);

    useEffect(() => {
        if (!deadlineMs) return;

        const tick = () => {
            const diff = Math.max(0, Math.floor((deadlineMs - Date.now()) / 1000));
            if (diff === 0) {
                // The minute timer moves the shift on (S5, or S10 at start); the card only stops accepting answers.
                setIsExpired(true);
                setTimerText(null);
                return;
            }
            const h = Math.floor(diff / 3600);
            const m = Math.floor((diff % 3600) / 60);
            setTimerText(h > 0 ? `${h}h ${m}m left` : `${m}m left`);
        };

        tick();
        const id = setInterval(tick, 30_000);
        return () => clearInterval(id);
    }, [deadlineMs]);

    const isLocked = isShiftLocked(offer.shift.shift_date, offer.shift.start_time);
    const isActionDisabled = !!processingId || isLocked || isExpired;
    const isProcessingThis = processingId === offer.shift_id;
    const netLength = computeNetLength(offer.shift);
    const roleLabel = offer.shift.roles?.name || 'Shift';

    const groupName =
        GROUP_DISPLAY_NAMES[offer.shift.group_type as keyof typeof GROUP_DISPLAY_NAMES] ||
        offer.shift.departments?.name ||
        '';

    const subGroupName =
        offer.shift.sub_group_name ||
        (offer.shift as any).roster_subgroup?.name ||
        offer.shift.sub_departments?.name ||
        undefined;

    const footerActions = showActions ? (
        <div className="flex gap-3 p-4 mt-auto">
            <Button
                size="lg"
                className={cn(
                    text.label,
                    touch.target,
                    'flex-1 h-12 rounded-2xl uppercase transition-colors active:scale-[0.98]',
                    isActionDisabled
                        ? 'bg-muted text-muted-foreground cursor-not-allowed'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white',
                )}
                onClick={() => !isActionDisabled && onAccept(offer.shift_id)}
                disabled={isActionDisabled}
                aria-label={
                    isLocked
                        ? `Response window closed for ${roleLabel}`
                        : `Accept ${roleLabel} on ${offer.shift.shift_date}`
                }
            >
                {isProcessingThis ? (
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                ) : isLocked ? (
                    'Window Closed'
                ) : (
                    'Accept'
                )}
            </Button>
            <Button
                size="lg"
                variant="outline"
                className={cn(
                    text.label,
                    touch.target,
                    'flex-1 h-12 rounded-2xl uppercase text-destructive border-destructive/30 hover:bg-destructive/10 transition-colors active:scale-[0.98]',
                )}
                onClick={() => !isActionDisabled && onDeclineRequest(offer.shift_id)}
                disabled={isActionDisabled}
                aria-label={`Decline ${roleLabel} on ${offer.shift.shift_date}`}
            >
                Decline
            </Button>
        </div>
    ) : (
        <div className="p-4 flex justify-center mt-auto">
            <Badge
                variant="outline"
                className={cn(
                    text.overlineBare,
                    'h-10 px-6 rounded-full flex items-center gap-2',
                    offer.status === 'Accepted'
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
                        : 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400',
                )}
            >
                {offer.status === 'Accepted' ? (
                    <CheckCircle className="h-4 w-4" aria-hidden="true" />
                ) : (
                    <XCircle className="h-4 w-4" aria-hidden="true" />
                )}
                {offer.status}
            </Badge>
        </div>
    );

    return (
        <div className="overflow-hidden rounded-2xl border border-border/40 bg-card/40">
            <SharedShiftCard
                variant="timecard"
                isFlat={true}
                identityGrid
                // Every row here is `assigned_employee_id = me` — that IS the
                // query — so the Employee cell is the viewer, never "Unassigned".
                employeeName={recipientName}
                organization={offer.shift.organizations?.name || ''}
                department={offer.shift.departments?.name || ''}
                subDepartment={offer.shift.sub_departments?.name}
                group={groupName}
                subGroup={subGroupName}
                role={roleLabel}
                shiftDate={formatCalendarDate(offer.shift.shift_date, 'EEE, MMM d, yyyy')}
                startTime={offer.shift.start_time?.slice(0, 5) ?? '--:--'}
                endTime={offer.shift.end_time?.slice(0, 5) ?? '--:--'}
                netLength={netLength}
                paidBreak={offer.shift.paid_break_minutes ?? offer.shift.break_minutes ?? 0}
                unpaidBreak={offer.shift.unpaid_break_minutes ?? 0}
                timerText={(showActions && !isProcessingThis && offer.status === 'Pending') ? timerText : null}
                isExpired={isExpired || isLocked}
                shiftData={{ ...offer.shift, sub_group_name: subGroupName } as any}
                groupVariant={groupVariantFor(offer.shift.group_type)}
                footerActions={footerActions}
            />
        </div>
    );
};

/* ═══════════════════════════════════════════════════════════════════════
   MAIN MODAL
   ═══════════════════════════════════════════════════════════════════════ */

export const MyOffersModal: React.FC<MyOffersModalProps> = ({
    isOpen,
    onClose,
    onOfferResponded,
    filters,
    defaultViewMode = 'table',
}) => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [viewMode, setViewMode] = useState<'table' | 'card'>(defaultViewMode);
    const [activeTab, setActiveTab] = useState<OfferStatus>('Pending');
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [showDeclineConfirm, setShowDeclineConfirm] = useState<string | null>(null);
    const [now, setNow] = useState<number>(Date.now());

    // Bulk Mode State
    const [isBulkModeActive, setIsBulkModeActive] = useState<boolean>(false);
    const [selectedShiftIds, setSelectedShiftIds] = useState<string[]>([]);
    const [showBulkDeclineConfirm, setShowBulkDeclineConfirm] = useState<boolean>(false);
    const [isProcessingBulk, setIsProcessingBulk] = useState<boolean>(false);

    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(interval);
    }, []);

    const employeeId = isOpen && user?.id ? user.id : null;
    const recipientName = user?.fullName || user?.name || undefined;

    const pendingQuery = useMyOffers(employeeId, filters);
    const acceptedQuery = useMyOffersHistory(employeeId, 'Accepted', filters);
    const declinedQuery = useMyOffersHistory(employeeId, 'Declined', filters);

    const acceptOfferMutation = useAcceptOffer();
    const declineOfferMutation = useDeclineOffer();

    // Silently exclude expired pending offers from the list
    const activePending = ((pendingQuery.data ?? []) as OfferData[]).filter((o) => {
        const deadline = resolveOfferDeadline(o);
        return !deadline || deadline > Date.now();
    });

    const activeQuery =
        activeTab === 'Pending'
            ? pendingQuery
            : activeTab === 'Accepted'
              ? acceptedQuery
              : declinedQuery;

    const currentOffers: OfferData[] =
        activeTab === 'Pending'
            ? activePending
            : ((activeQuery.data ?? []) as OfferData[]);

    const handleTabChange = (tab: OfferStatus) => {
        setActiveTab(tab);
        setSelectedShiftIds([]);
        if (tab !== 'Pending') {
            setIsBulkModeActive(false);
        }
    };

    /**
     * A disabled query is neither loading nor loaded — React Query reports
     * `isLoading: false` for it — so keying the empty state off `isLoading`
     * alone rendered "Nothing Here" while the query had not run yet, and again
     * whenever it failed. An expired token or a rejected select looked
     * identical to a genuinely empty inbox, which is the one thing this screen
     * must never get wrong.
     */
    const isFetchingFirstPage = activeQuery.isLoading || (!!employeeId && activeQuery.isPending);
    const hasFailed = activeQuery.isError;

    const handleAccept = async (shiftId: string) => {
        setProcessingId(shiftId);
        try {
            await acceptOfferMutation.mutateAsync(shiftId);
            toast({
                title: 'Shift Accepted',
                description: 'The shift has been added to your roster.',
            });
            onOfferResponded?.();
        } catch (err: any) {
            toast({
                title: 'Error',
                description: err?.message || 'Failed to accept offer.',
                variant: 'destructive',
            });
        } finally {
            setProcessingId(null);
        }
    };

    const handleDecline = async (shiftId: string) => {
        setProcessingId(shiftId);
        try {
            await declineOfferMutation.mutateAsync(shiftId);
            toast({
                title: 'Offer Declined',
                description: 'The shift has been returned to the pool.',
            });
            setShowDeclineConfirm(null);
            onOfferResponded?.();
        } catch (err: any) {
            toast({
                title: 'Error',
                description: err?.message || 'Failed to decline offer.',
                variant: 'destructive',
            });
        } finally {
            setProcessingId(null);
        }
    };

    const handleBulkAccept = async () => {
        if (selectedShiftIds.length === 0) return;
        setIsProcessingBulk(true);
        try {
            const results = await Promise.allSettled(
                selectedShiftIds.map(shiftId => acceptOfferMutation.mutateAsync(shiftId))
            );
            const succeeded = results.filter(r => r.status === 'fulfilled').length;
            const failed = results.filter(r => r.status === 'rejected').length;
            if (succeeded > 0) {
                toast({
                    title: `${succeeded} Shift${succeeded > 1 ? 's' : ''} Accepted`,
                    description: failed > 0 ? `${failed} failed to accept.` : 'Added to your roster.',
                });
                onOfferResponded?.();
            }
            if (failed > 0 && succeeded === 0) {
                toast({
                    title: 'Error',
                    description: 'Failed to accept selected offers.',
                    variant: 'destructive',
                });
            }
            setSelectedShiftIds([]);
        } catch (err: any) {
            toast({
                title: 'Error',
                description: err?.message || 'Failed to accept offers.',
                variant: 'destructive',
            });
        } finally {
            setIsProcessingBulk(false);
        }
    };

    const handleBulkDecline = async () => {
        if (selectedShiftIds.length === 0) return;
        setIsProcessingBulk(true);
        try {
            const results = await Promise.allSettled(
                selectedShiftIds.map(shiftId => declineOfferMutation.mutateAsync(shiftId))
            );
            const succeeded = results.filter(r => r.status === 'fulfilled').length;
            const failed = results.filter(r => r.status === 'rejected').length;
            if (succeeded > 0) {
                toast({
                    title: `${succeeded} Offer${succeeded > 1 ? 's' : ''} Declined`,
                    description: failed > 0 ? `${failed} failed to decline.` : 'Returned to the pool.',
                });
                onOfferResponded?.();
            }
            if (failed > 0 && succeeded === 0) {
                toast({
                    title: 'Error',
                    description: 'Failed to decline selected offers.',
                    variant: 'destructive',
                });
            }
            setSelectedShiftIds([]);
            setShowBulkDeclineConfirm(false);
        } catch (err: any) {
            toast({
                title: 'Error',
                description: err?.message || 'Failed to decline offers.',
                variant: 'destructive',
            });
        } finally {
            setIsProcessingBulk(false);
        }
    };

    const transformedOffers = useMemo(() => {
        return currentOffers.map((offer) => {
            const rawSub = (offer.shift as any).roster_subgroup;
            const sub = Array.isArray(rawSub) ? rawSub[0] : rawSub;
            const rawRg = sub?.roster_groups ?? sub?.roster_group;
            const rg = Array.isArray(rawRg) ? rawRg[0] : rawRg;

            const groupType =
                rg?.external_id ||
                offer.shift.group_type ||
                undefined;

            const group =
                rg?.name ||
                GROUP_DISPLAY_NAMES[groupType as keyof typeof GROUP_DISPLAY_NAMES] ||
                offer.shift.departments?.name ||
                'General';

            const subGroupName =
                sub?.name ||
                offer.shift.sub_group_name ||
                offer.shift.sub_departments?.name ||
                'General';

            const department = offer.shift.departments?.name || 'General';
            const subDepartment = offer.shift.sub_departments?.name || 'General';
            const role = offer.shift.roles?.name || 'Shift';
            const date = offer.shift.shift_date;
            const startTime = offer.shift.start_time?.slice(0, 5) ?? '--:--';
            const endTime = offer.shift.end_time?.slice(0, 5) ?? '--:--';
            const netLength = computeNetLength(offer.shift);
            const deadlineMs = resolveOfferDeadline(offer);
            const isLocked = isShiftLocked(offer.shift.shift_date, offer.shift.start_time);
            const subGroupColor = getDeptColor(groupType, department);

            return {
                id: offer.id,
                shift_id: offer.shift_id,
                status: offer.status,
                department,
                subDepartment,
                group,
                subGroupName,
                subGroupColor,
                role,
                date,
                startTime,
                endTime,
                startAt: `${date}T${startTime}`,
                netLength,
                deadlineMs,
                isLocked,
                groupType,
                rawOffer: offer,
            };
        });
    }, [currentOffers]);

    const actionableOffers = useMemo(() => {
        if (activeTab !== 'Pending') return [];
        return transformedOffers.filter((item) => {
            const isExpired = item.deadlineMs ? now >= item.deadlineMs : false;
            return !item.isLocked && !isExpired;
        });
    }, [transformedOffers, activeTab, now]);

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedShiftIds(actionableOffers.map((o) => o.shift_id));
        } else {
            setSelectedShiftIds([]);
        }
    };

    const handleToggleSelect = (shiftId: string) => {
        setSelectedShiftIds((prev) =>
            prev.includes(shiftId) ? prev.filter((id) => id !== shiftId) : [...prev, shiftId]
        );
    };

    const offersTableSort = useTableSorting(transformedOffers, { key: 'date', direction: 'asc' });

    const groupedOffers = useMemo(() => {
        const buckets = new Map<string, { key: string; label: string; items: typeof transformedOffers }>();
        for (const item of offersTableSort.sortedData) {
            const key = item.date;
            const label = formatCalendarDate(item.date, 'EEE d MMM');
            if (!buckets.has(key)) {
                buckets.set(key, { key, label, items: [] });
            }
            buckets.get(key)!.items.push(item);
        }
        return Array.from(buckets.values());
    }, [offersTableSort.sortedData]);

    const tabs: { label: OfferStatus; count: number }[] = [
        { label: 'Pending', count: activePending.length },
        { label: 'Accepted', count: ((acceptedQuery.data ?? []) as OfferData[]).length },
        { label: 'Declined', count: ((declinedQuery.data ?? []) as OfferData[]).length },
    ];

    const panelId = `offers-panel-${activeTab.toLowerCase()}`;

    return (
        <>
            <Dialog
                open={isOpen}
                onOpenChange={(open) => !open && onClose()}
            >
                <DialogContent
                    // The header below lays out its own close button, aligned
                    // with the title and sized for a thumb, so the primitive's
                    // would be a second control for the same action sitting
                    // over the first.
                    hideClose
                    className="w-[calc(100vw-2rem)] sm:w-full max-h-[90vh] p-0 overflow-hidden bg-card/95 flex flex-col z-[150]"
                    size="full"
                >
                    <DialogHeader className="sr-only">
                        <DialogTitle>My Shift Offers</DialogTitle>
                        <DialogDescription>
                            Review and respond to shift offers assigned to you.
                        </DialogDescription>
                    </DialogHeader>

                    {/* Header */}
                    <div className="flex items-center gap-3 px-5 py-4 border-b border-border/40 shrink-0">
                        <div className="h-10 w-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                            <Inbox className="h-5 w-5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <h2 className={cn(text.title, 'text-foreground leading-none')}>
                                Shift Offers
                            </h2>
                            <p className={cn(text.overline, 'mt-1')}>My Inbox</p>
                        </div>
                        <DialogClose asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className={cn(touch.target, 'rounded-xl shrink-0')}
                                aria-label="Close shift offers"
                            >
                                <X className="h-5 w-5" aria-hidden="true" />
                            </Button>
                        </DialogClose>
                    </div>

                    {/* Tab Selector & View Mode Toggle */}
                    <div className="flex items-center justify-between px-5 pt-4 pb-2 shrink-0 gap-3 flex-wrap">
                        <div className="flex gap-2 overflow-x-auto scrollbar-none" role="tablist" aria-label="Offer status">
                            {tabs.map(({ label, count }) => {
                                const isActive = activeTab === label;
                                return (
                                    <button
                                        key={label}
                                        type="button"
                                        role="tab"
                                        id={`offers-tab-${label.toLowerCase()}`}
                                        aria-selected={isActive}
                                        aria-controls={`offers-panel-${label.toLowerCase()}`}
                                        onClick={() => handleTabChange(label)}
                                        className={cn(
                                            text.label,
                                            touch.target,
                                            'flex items-center justify-center gap-2 px-4 rounded-xl uppercase transition-colors shrink-0',
                                            isActive
                                                ? 'bg-foreground text-background'
                                                : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                                        )}
                                    >
                                        {label}
                                        {count > 0 && (
                                            <span
                                                className={cn(
                                                    'h-5 min-w-[1.25rem] rounded-full text-[11px] leading-none flex items-center justify-center px-1.5 font-bold tabular-nums',
                                                    isActive
                                                        ? 'bg-background/20 text-background'
                                                        : 'bg-muted-foreground/20 text-muted-foreground',
                                                )}
                                            >
                                                {count}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                            {/* Bulk Mode toggle (only in Pending tab) */}
                            {activeTab === 'Pending' && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        setIsBulkModeActive((prev) => {
                                            const next = !prev;
                                            if (!next) setSelectedShiftIds([]);
                                            return next;
                                        });
                                    }}
                                    aria-pressed={isBulkModeActive}
                                    className={cn(
                                        "h-8 px-2.5 text-[11px] font-black uppercase tracking-wider rounded-xl transition-colors gap-1.5",
                                        isBulkModeActive
                                            ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
                                            : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    <ListChecks className="h-4 w-4" aria-hidden="true" />
                                    <span>Bulk Mode</span>
                                </Button>
                            )}

                            {/* View Mode Toggle: Table (default) vs Card */}
                            <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-xl border border-border/40 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => setViewMode('table')}
                                    aria-label="Table view"
                                    aria-pressed={viewMode === 'table'}
                                    className={cn(
                                        'p-1.5 rounded-lg transition-colors',
                                        viewMode === 'table'
                                            ? 'bg-background text-foreground shadow-sm'
                                            : 'text-muted-foreground hover:text-foreground',
                                    )}
                                >
                                    <List className="h-4 w-4" aria-hidden="true" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setViewMode('card')}
                                    aria-label="Card view"
                                    aria-pressed={viewMode === 'card'}
                                    className={cn(
                                        'p-1.5 rounded-lg transition-colors',
                                        viewMode === 'card'
                                            ? 'bg-background text-foreground shadow-sm'
                                            : 'text-muted-foreground hover:text-foreground',
                                    )}
                                >
                                    <LayoutGrid className="h-4 w-4" aria-hidden="true" />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Bulk Mode Action Bar */}
                    {isBulkModeActive && activeTab === 'Pending' && (
                        <div className="flex items-center justify-between gap-3 px-5 py-2.5 bg-muted/30 border-y border-border/40 shrink-0 animate-in fade-in slide-in-from-top-1 duration-200">
                            <div className="flex items-center gap-3">
                                <span className="text-[12px] font-bold text-foreground">
                                    {selectedShiftIds.length} selected
                                </span>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-[11px] font-semibold uppercase text-muted-foreground hover:text-foreground"
                                    onClick={() => {
                                        if (actionableOffers.length > 0 && actionableOffers.every((o) => selectedShiftIds.includes(o.shift_id))) {
                                            setSelectedShiftIds([]);
                                        } else {
                                            setSelectedShiftIds(actionableOffers.map((o) => o.shift_id));
                                        }
                                    }}
                                >
                                    {actionableOffers.length > 0 && actionableOffers.every((o) => selectedShiftIds.includes(o.shift_id))
                                        ? 'Deselect All'
                                        : 'Select All'}
                                </Button>
                            </div>

                            <div className="flex items-center gap-2">
                                <Button
                                    size="sm"
                                    className="h-8 px-3 text-[11px] font-black uppercase tracking-wider bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm gap-1.5"
                                    disabled={selectedShiftIds.length === 0 || isProcessingBulk}
                                    onClick={handleBulkAccept}
                                >
                                    {isProcessingBulk ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                    ) : (
                                        <CheckCircle className="h-3.5 w-3.5" />
                                    )}
                                    Accept Selected ({selectedShiftIds.length})
                                </Button>

                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 px-3 text-[11px] font-black uppercase tracking-wider text-rose-500 hover:text-rose-600 border-rose-500/30 hover:bg-rose-500/10 shadow-sm gap-1.5"
                                    disabled={selectedShiftIds.length === 0 || isProcessingBulk}
                                    onClick={() => setShowBulkDeclineConfirm(true)}
                                >
                                    <XCircle className="h-3.5 w-3.5" />
                                    Decline Selected ({selectedShiftIds.length})
                                </Button>

                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                                    onClick={() => {
                                        setIsBulkModeActive(false);
                                        setSelectedShiftIds([]);
                                    }}
                                    aria-label="Close bulk mode"
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Offer List */}
                    <div
                        className="flex-1 overflow-y-auto px-5 pb-5 min-h-0"
                        role="tabpanel"
                        id={panelId}
                        aria-labelledby={`offers-tab-${activeTab.toLowerCase()}`}
                    >
                        {hasFailed ? (
                            <div className="flex flex-col items-center justify-center py-14 text-center gap-3">
                                <AlertTriangle className="h-8 w-8 text-amber-500" aria-hidden="true" />
                                <div>
                                    <p className={cn(text.body, 'text-foreground')}>
                                        Couldn’t load your offers
                                    </p>
                                    <p className={cn(text.caption, 'mt-1 max-w-[16rem]')}>
                                        {(activeQuery.error as Error)?.message ||
                                            'Something went wrong reaching the server.'}
                                    </p>
                                </div>
                                <Button
                                    variant="outline"
                                    onClick={() => void activeQuery.refetch()}
                                    className={cn(text.label, touch.target, 'rounded-xl uppercase gap-2')}
                                >
                                    <RotateCw className="h-4 w-4" aria-hidden="true" />
                                    Try again
                                </Button>
                            </div>
                        ) : currentOffers.length === 0 && !isFetchingFirstPage ? (
                            <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                                <Inbox className="h-8 w-8 stroke-[1.5] text-muted-foreground" aria-hidden="true" />
                                <p className={text.overline}>
                                    {activeTab === 'Pending'
                                        ? 'No offers waiting'
                                        : `No ${activeTab.toLowerCase()} offers`}
                                </p>
                            </div>
                        ) : viewMode === 'table' ? (
                            /* Desktop & Responsive Table: Traditional sortable table exactly like MyBids grid */
                            <div className="overflow-x-auto border border-border/60 rounded-xl bg-card">
                                <Table className="text-foreground min-w-[900px]">
                                    <TableHeader sticky>
                                        <TableRow>
                                            {isBulkModeActive && activeTab === 'Pending' && (
                                                <TableHead className="w-[40px]">
                                                    <Checkbox
                                                        checked={
                                                            actionableOffers.length > 0 &&
                                                            actionableOffers.every((o) => selectedShiftIds.includes(o.shift_id))
                                                        }
                                                        onCheckedChange={(checked) => handleSelectAll(checked === true)}
                                                        aria-label="Select all offers"
                                                    />
                                                </TableHead>
                                            )}
                                            <SortableTableHeader sortKey="department" currentSort={offersTableSort.sortConfig} onSort={offersTableSort.handleSort}>Department</SortableTableHeader>
                                            <SortableTableHeader sortKey="subDepartment" currentSort={offersTableSort.sortConfig} onSort={offersTableSort.handleSort}>SubDepartment</SortableTableHeader>
                                            <SortableTableHeader sortKey="group" currentSort={offersTableSort.sortConfig} onSort={offersTableSort.handleSort}>Group</SortableTableHeader>
                                            <SortableTableHeader sortKey="subGroupName" currentSort={offersTableSort.sortConfig} onSort={offersTableSort.handleSort}>SubGroup</SortableTableHeader>
                                            <SortableTableHeader sortKey="role" currentSort={offersTableSort.sortConfig} onSort={offersTableSort.handleSort}>Role</SortableTableHeader>
                                            <SortableTableHeader sortKey="date" currentSort={offersTableSort.sortConfig} onSort={offersTableSort.handleSort}>Date</SortableTableHeader>
                                            <SortableTableHeader sortKey="startTime" currentSort={offersTableSort.sortConfig} onSort={offersTableSort.handleSort}>Time</SortableTableHeader>
                                            <SortableTableHeader sortKey="netLength" currentSort={offersTableSort.sortConfig} onSort={offersTableSort.handleSort}>Net</SortableTableHeader>
                                            <TableHead className="w-[120px]">Expires in</TableHead>
                                            <TableHead className="w-[180px]">Action</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    {isFetchingFirstPage ? (
                                        <TableBody>
                                            {[1, 2, 3, 4].map((i) => (
                                                <TableRow key={i}>
                                                    <TableCell colSpan={isBulkModeActive && activeTab === 'Pending' ? 11 : 10}>
                                                        <Skeleton className="h-9 w-full rounded" />
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    ) : (
                                        groupedOffers.map((g) => (
                                            <TableBody key={g.key}>
                                                <tr>
                                                    <td colSpan={isBulkModeActive && activeTab === 'Pending' ? 11 : 10} className={tableTokens.band}>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-foreground/80">{g.label}</span>
                                                            <span className="tabular-nums">{g.items.length}</span>
                                                        </div>
                                                    </td>
                                                </tr>
                                                {g.items.map((item) => {
                                                    const isProcessingThis = processingId === item.shift_id;
                                                    const isExpired = item.deadlineMs ? now >= item.deadlineMs : false;
                                                    const isActionDisabled = !!processingId || item.isLocked || isExpired;
                                                    return (
                                                        <TableRow
                                                            key={item.id}
                                                            className={cn(
                                                                getRowClass(item.groupType, item.group || item.department),
                                                                isBulkModeActive && activeTab === 'Pending' && !isActionDisabled && 'cursor-pointer'
                                                            )}
                                                            onClick={() => {
                                                                if (isBulkModeActive && activeTab === 'Pending' && !isActionDisabled) {
                                                                    handleToggleSelect(item.shift_id);
                                                                }
                                                            }}
                                                        >
                                                            {isBulkModeActive && activeTab === 'Pending' && (
                                                                <TableCell className="w-[40px]" onClick={(e) => e.stopPropagation()}>
                                                                    <Checkbox
                                                                        checked={selectedShiftIds.includes(item.shift_id)}
                                                                        disabled={isActionDisabled}
                                                                        onCheckedChange={() => handleToggleSelect(item.shift_id)}
                                                                        aria-label={`Select offer for ${item.role} on ${item.date}`}
                                                                    />
                                                                </TableCell>
                                                            )}
                                                            <TableCell className="font-medium">{item.department}</TableCell>
                                                            <TableCell className="text-muted-foreground/80">{item.subDepartment}</TableCell>
                                                            <TableCell className="font-medium text-foreground/80">{item.group}</TableCell>
                                                            <TableCell>
                                                                <div className="flex items-center gap-2">
                                                                    <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", item.subGroupColor || 'bg-slate-400')} />
                                                                    <span>{item.subGroupName}</span>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="font-bold text-primary">{item.role}</TableCell>
                                                            <TableCell>{formatCalendarDate(item.date, 'EEE d MMM')}</TableCell>
                                                            <TableCell className="tabular-nums font-mono">{item.startTime}–{item.endTime}</TableCell>
                                                            <TableCell className="font-mono text-muted-foreground">
                                                                {(() => {
                                                                    const h = Math.floor(item.netLength / 60);
                                                                    const m = Math.round(item.netLength % 60);
                                                                    return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
                                                                })()}
                                                            </TableCell>
                                                            <TableCell className="font-mono tabular-nums">
                                                                {(() => {
                                                                    if (item.status !== 'Pending') {
                                                                        return <span className="text-muted-foreground/50">—</span>;
                                                                    }
                                                                    if (!item.deadlineMs) return <span className="text-muted-foreground/50">—</span>;
                                                                    const totalMs = item.deadlineMs - now;
                                                                    if (totalMs <= 0 || item.isLocked) {
                                                                        return <span className="text-muted-foreground/50 italic">Closed</span>;
                                                                    }
                                                                    const tr = calculateTimeRemaining(new Date(item.deadlineMs).toISOString());
                                                                    if (tr.isExpired) return <span className="text-muted-foreground/50 italic">Closed</span>;
                                                                    const urgent = totalMs <= 24 * 60 * 60 * 1000;
                                                                    return (
                                                                        <span className={cn(urgent ? 'text-amber-500 font-bold' : 'text-foreground/70')}>
                                                                            {formatTimeRemainingNoSeconds(tr)}
                                                                        </span>
                                                                    );
                                                                })()}
                                                            </TableCell>
                                                            <TableCell>
                                                                {item.status === 'Pending' && (
                                                                    (item.isLocked || isExpired) ? (
                                                                        <span className="text-[11px] text-muted-foreground flex items-center gap-1 font-medium italic">
                                                                            <Ban size={12} aria-hidden="true" /> Window Closed
                                                                        </span>
                                                                    ) : (
                                                                        <div className="flex items-center gap-2">
                                                                            <Button
                                                                                size="sm"
                                                                                className="h-8 text-[11px] font-black uppercase tracking-wider bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm"
                                                                                disabled={isActionDisabled}
                                                                                onClick={() => handleAccept(item.shift_id)}
                                                                                aria-label={`Accept ${item.role} on ${item.date}`}
                                                                            >
                                                                                {isProcessingThis ? (
                                                                                    <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
                                                                                ) : (
                                                                                    <CheckCircle className="mr-1 h-3 w-3" aria-hidden="true" />
                                                                                )}
                                                                                Accept
                                                                            </Button>
                                                                            <Button
                                                                                size="sm"
                                                                                variant="outline"
                                                                                className="h-8 text-[11px] font-black uppercase tracking-wider text-rose-500 hover:text-rose-600 border-rose-500/30 hover:bg-rose-500/10 shadow-sm"
                                                                                disabled={isActionDisabled}
                                                                                onClick={() => setShowDeclineConfirm(item.shift_id)}
                                                                                aria-label={`Decline ${item.role} on ${item.date}`}
                                                                            >
                                                                                <XCircle className="mr-1 h-3 w-3" aria-hidden="true" />
                                                                                Decline
                                                                            </Button>
                                                                        </div>
                                                                    )
                                                                )}
                                                                {item.status === 'Accepted' && (
                                                                    <span className="text-[11px] text-emerald-500 flex items-center gap-1 font-bold">
                                                                        <CheckCircle size={14} aria-hidden="true" /> Accepted
                                                                    </span>
                                                                )}
                                                                {item.status === 'Declined' && (
                                                                    <span className="text-[11px] text-rose-500 flex items-center gap-1 font-bold">
                                                                        <XCircle size={14} aria-hidden="true" /> Declined
                                                                    </span>
                                                                )}
                                                            </TableCell>
                                                        </TableRow>
                                                    );
                                                })}
                                            </TableBody>
                                        ))
                                    )}
                                </Table>
                            </div>
                        ) : (
                            /* Card view: responsive grid */
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {isFetchingFirstPage ? (
                                    [1, 2, 3].map((i) => (
                                        <Skeleton key={i} className="h-52 w-full rounded-xl" />
                                    ))
                                ) : (
                                    currentOffers.map((offer) => {
                                        const isLocked = isShiftLocked(offer.shift.shift_date, offer.shift.start_time);
                                        const deadline = resolveOfferDeadline(offer);
                                        const isExpired = deadline ? now >= deadline : false;
                                        const isActionDisabled = !!processingId || isLocked || isExpired;
                                        return (
                                            <div
                                                key={offer.id}
                                                className={cn(
                                                    'relative rounded-2xl transition-all',
                                                    isBulkModeActive && activeTab === 'Pending' && selectedShiftIds.includes(offer.shift_id) && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                                                )}
                                            >
                                                {isBulkModeActive && activeTab === 'Pending' && (
                                                    <div
                                                        className="absolute top-3 right-3 z-20 bg-background/80 backdrop-blur-sm p-1.5 rounded-lg border border-border/50 shadow-sm"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        <Checkbox
                                                            checked={selectedShiftIds.includes(offer.shift_id)}
                                                            disabled={isActionDisabled}
                                                            onCheckedChange={() => handleToggleSelect(offer.shift_id)}
                                                            aria-label={`Select offer for ${offer.shift.roles?.name || 'Shift'} on ${offer.shift.shift_date}`}
                                                        />
                                                    </div>
                                                )}
                                                <OfferItem
                                                    offer={offer}
                                                    recipientName={recipientName}
                                                    showActions={activeTab === 'Pending'}
                                                    processingId={processingId}
                                                    onAccept={handleAccept}
                                                    onDeclineRequest={(id) => setShowDeclineConfirm(id)}
                                                />
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Decline Confirmation */}
            <AlertDialog
                open={!!showDeclineConfirm}
                onOpenChange={() => setShowDeclineConfirm(null)}
            >
                <AlertDialogContent className="z-[200]" aria-describedby={undefined}>
                    <AlertDialogHeader>
                        <AlertDialogTitle className={cn(text.title, 'text-foreground')}>
                            Decline Shift?
                        </AlertDialogTitle>
                        <AlertDialogDescription className={text.bodyMuted}>
                            This shift will be returned to the pool for bidding. This cannot be
                            undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="mt-6 gap-3">
                        <AlertDialogCancel className={cn(text.label, touch.target, 'uppercase rounded-xl')}>
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            className={cn(
                                text.label,
                                touch.target,
                                'bg-destructive text-destructive-foreground uppercase rounded-xl',
                            )}
                            onClick={() =>
                                showDeclineConfirm && handleDecline(showDeclineConfirm)
                            }
                            disabled={!!processingId}
                        >
                            {processingId ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
                            ) : null}
                            Decline
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Bulk Decline Confirmation */}
            <AlertDialog
                open={showBulkDeclineConfirm}
                onOpenChange={setShowBulkDeclineConfirm}
            >
                <AlertDialogContent className="z-[200]" aria-describedby={undefined}>
                    <AlertDialogHeader>
                        <AlertDialogTitle className={cn(text.title, 'text-foreground')}>
                            Decline {selectedShiftIds.length} Shift Offer{selectedShiftIds.length > 1 ? 's' : ''}?
                        </AlertDialogTitle>
                        <AlertDialogDescription className={text.bodyMuted}>
                            These shifts will be returned to the pool for bidding. This cannot be
                            undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="mt-6 gap-3">
                        <AlertDialogCancel className={cn(text.label, touch.target, 'uppercase rounded-xl')}>
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            className={cn(
                                text.label,
                                touch.target,
                                'bg-destructive text-destructive-foreground uppercase rounded-xl',
                            )}
                            onClick={handleBulkDecline}
                            disabled={isProcessingBulk}
                        >
                            {isProcessingBulk ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
                            ) : null}
                            Decline ({selectedShiftIds.length})
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};
