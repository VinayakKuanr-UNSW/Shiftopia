import React, { useState, useEffect } from 'react';
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
    useExpireOffer,
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
} from 'lucide-react';
import { isShiftLocked } from '@/modules/rosters/domain/shift-locking.utils';
import { computeShiftUrgency } from '@/modules/rosters/domain/bidding-urgency';
import { resolveGroupVariant } from '@/modules/rosters/domain/shift-ui';
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
            hourly_rate_min: number;
            hourly_rate_max?: number;
            level_number?: number;
        } | null;
        group_type?: string | null;
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

    // TTS rule: an offer must close at least 4h before the shift starts,
    // whatever the stated expiry says.
    const start = getShiftInstant(offer.shift, 'start');
    const ttsDeadline = start ? start.getTime() - 4 * 60 * 60 * 1000 : null;

    if (stated == null) return ttsDeadline;
    if (ttsDeadline == null) return stated;
    return Math.min(stated, ttsDeadline);
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
    onExpire: (shiftId: string) => void;
}> = ({ offer, recipientName, showActions, processingId, onAccept, onDeclineRequest, onExpire }) => {
    const [timerText, setTimerText] = useState<string | null>(null);
    const [isExpired, setIsExpired] = useState(false);
    const expiredRef = React.useRef(false);

    const deadlineMs = resolveOfferDeadline(offer);

    useEffect(() => {
        if (!deadlineMs) return;

        const tick = () => {
            const diff = Math.max(0, Math.floor((deadlineMs - Date.now()) / 1000));
            if (diff === 0) {
                setIsExpired(true);
                setTimerText(null);
                if (!expiredRef.current) {
                    expiredRef.current = true;
                    onExpire(offer.shift_id);
                }
                return;
            }
            const h = Math.floor(diff / 3600);
            const m = Math.floor((diff % 3600) / 60);
            setTimerText(h > 0 ? `${h}h ${m}m left` : `${m}m left`);
        };

        tick();
        const id = setInterval(tick, 30_000);
        return () => clearInterval(id);
    }, [deadlineMs, offer.shift_id, onExpire]);

    const isLocked = isShiftLocked(offer.shift.shift_date, offer.shift.start_time);
    const isActionDisabled = !!processingId || isLocked || isExpired;
    const isProcessingThis = processingId === offer.shift_id;
    const netLength = computeNetLength(offer.shift);
    const roleLabel = offer.shift.roles?.name || 'Shift';

    const groupName =
        GROUP_DISPLAY_NAMES[offer.shift.group_type as keyof typeof GROUP_DISPLAY_NAMES] ||
        offer.shift.departments?.name ||
        '';

    const urgency = computeShiftUrgency(offer.shift.shift_date, offer.shift.start_time);

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
                subGroup={(offer.shift as any).sub_group_name}
                role={roleLabel}
                shiftDate={formatCalendarDate(offer.shift.shift_date, 'EEE, MMM d, yyyy')}
                startTime={offer.shift.start_time.slice(0, 5)}
                endTime={offer.shift.end_time.slice(0, 5)}
                netLength={netLength}
                paidBreak={offer.shift.paid_break_minutes ?? offer.shift.break_minutes ?? 0}
                unpaidBreak={offer.shift.unpaid_break_minutes ?? 0}
                timerText={(showActions && !isProcessingThis && offer.status === 'Pending') ? timerText : null}
                isExpired={isExpired || isLocked}
                urgency={urgency}
                shiftData={offer.shift as any}
                hideGlow
                groupVariant={
                    offer.shift.group_type === 'convention_centre' ? 'convention' :
                    offer.shift.group_type === 'exhibition_centre' ? 'exhibition' :
                    offer.shift.group_type === 'theatre' ? 'theatre' :
                    offer.shift.group_type === 'the_cutaway' ? 'cutaway' :
                    resolveGroupVariant(offer.shift as any, offer.shift.departments?.name, offer.shift.sub_departments?.name)
                }
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
}) => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [activeTab, setActiveTab] = useState<OfferStatus>('Pending');
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [showDeclineConfirm, setShowDeclineConfirm] = useState<string | null>(null);

    const employeeId = isOpen && user?.id ? user.id : null;
    const recipientName = user?.fullName || user?.name || undefined;

    const pendingQuery = useMyOffers(employeeId, filters);
    const acceptedQuery = useMyOffersHistory(employeeId, 'Accepted', filters);
    const declinedQuery = useMyOffersHistory(employeeId, 'Declined', filters);

    const acceptOfferMutation = useAcceptOffer();
    const declineOfferMutation = useDeclineOffer();
    const expireOfferMutation = useExpireOffer();

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

    const handleExpire = React.useCallback(
        (shiftId: string) => {
            if (!expireOfferMutation.isPending) {
                expireOfferMutation.mutate(shiftId);
            }
        },
        [expireOfferMutation],
    );

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
                    className="max-w-md w-[calc(100vw-2rem)] sm:w-full max-h-[85vh] p-0 overflow-hidden bg-card/95 backdrop-blur-2xl border border-border shadow-2xl rounded-[28px] flex flex-col z-[150]"
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

                    {/* Tab Selector */}
                    <div className="flex gap-2 px-5 pt-4 pb-2 shrink-0" role="tablist" aria-label="Offer status">
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
                                    onClick={() => setActiveTab(label)}
                                    className={cn(
                                        text.label,
                                        touch.target,
                                        'flex items-center justify-center gap-2 px-4 rounded-xl uppercase transition-colors',
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

                    {/* Offer List */}
                    <div
                        className="flex-1 overflow-y-auto px-5 pb-5 space-y-3 min-h-0"
                        role="tabpanel"
                        id={panelId}
                        aria-labelledby={`offers-tab-${activeTab.toLowerCase()}`}
                    >
                        {isFetchingFirstPage ? (
                            [1, 2, 3].map((i) => (
                                <Skeleton key={i} className="h-52 w-full rounded-xl" />
                            ))
                        ) : hasFailed ? (
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
                        ) : currentOffers.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                                <Inbox className="h-8 w-8 stroke-[1.5] text-muted-foreground" aria-hidden="true" />
                                <p className={text.overline}>
                                    {activeTab === 'Pending'
                                        ? 'No offers waiting'
                                        : `No ${activeTab.toLowerCase()} offers`}
                                </p>
                            </div>
                        ) : (
                            currentOffers.map((offer) => (
                                <OfferItem
                                    key={offer.id}
                                    offer={offer}
                                recipientName={recipientName}
                                    showActions={activeTab === 'Pending'}
                                    processingId={processingId}
                                    onAccept={handleAccept}
                                    onDeclineRequest={(id) => setShowDeclineConfirm(id)}
                                    onExpire={handleExpire}
                                />
                            ))
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Decline Confirmation */}
            <AlertDialog
                open={!!showDeclineConfirm}
                onOpenChange={() => setShowDeclineConfirm(null)}
            >
                <AlertDialogContent className="bg-background border border-border rounded-2xl p-6 max-w-sm z-[200] shadow-2xl" aria-describedby={undefined}>
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
        </>
    );
};
