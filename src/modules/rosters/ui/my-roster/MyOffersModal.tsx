import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
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
import { useAuth } from '@/modules/auth/hooks/useAuth';
import { cn } from '@/modules/core/lib/utils';
import {
    Inbox,
    CheckCircle,
    XCircle,
    Loader2,
    X,
} from 'lucide-react';
import { isShiftLocked } from '@/modules/rosters/domain/shift-locking.utils';
import { SharedShiftCard } from '@/modules/planning/ui/components/SharedShiftCard';
import { ResponsiveDialog } from '@/modules/core/ui/components/ResponsiveDialog';

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

function parseExpiry(raw: any): number | null {
    if (!raw) return null;
    const s = typeof raw === 'string' ? raw.trim() : String(raw);
    const normalised = s.includes(' ') && !s.includes('T') ? s.replace(' ', 'T') : s;
    const withZ = /Z|[+-]\d{2}/.test(normalised) ? normalised : normalised + 'Z';
    const t = new Date(withZ).getTime();
    return isNaN(t) ? null : t;
}

/* ═══════════════════════════════════════════════════════════════════════
   OFFER ITEM — wraps SharedShiftCard with live expiry countdown
   ═══════════════════════════════════════════════════════════════════════ */

const OfferItem: React.FC<{
    offer: OfferData;
    showActions: boolean;
    processingId: string | null;
    onAccept: (shiftId: string) => void;
    onDeclineRequest: (shiftId: string) => void;
    onExpire: (shiftId: string) => void;
}> = ({ offer, showActions, processingId, onAccept, onDeclineRequest, onExpire }) => {
    const [timerText, setTimerText] = useState<string | null>(null);
    const [isExpired, setIsExpired] = useState(false);
    const expiredRef = React.useRef(false);

    const expiresRaw = offer.offer_expires_at || (offer.shift as any).offer_expires_at;
    const expiryMs = parseExpiry(expiresRaw);

    // TTS-aware expiry: Must expire at least 4h before start
    const startMs = parseExpiry(`${offer.shift.shift_date}T${offer.shift.start_time}`);
    const autoExpiryMs = startMs ? startMs - (4 * 60 * 60 * 1000) : null;
    const finalExpiryMs = autoExpiryMs ? Math.min(expiryMs ?? Infinity, autoExpiryMs) : expiryMs;

    useEffect(() => {
        if (!finalExpiryMs) return;

        const tick = () => {
            const diff = Math.max(0, Math.floor((finalExpiryMs - Date.now()) / 1000));
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
    }, [finalExpiryMs, offer.shift_id, onExpire]);

    const isLocked = isShiftLocked(offer.shift.shift_date, offer.shift.start_time);
    const isActionDisabled = !!processingId || isLocked || isExpired;
    const isProcessingThis = processingId === offer.shift_id;
    const netLength = computeNetLength(offer.shift);

    const footerActions = showActions ? (
        <div className="flex gap-2 p-2">
            <Button
                size="sm"
                className={cn(
                    'flex-1 font-black text-xs uppercase tracking-wider transition-all',
                    isActionDisabled
                        ? 'bg-muted text-muted-foreground cursor-not-allowed'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white',
                )}
                onClick={() => !isActionDisabled && onAccept(offer.shift_id)}
                disabled={isActionDisabled}
            >
                {isProcessingThis ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : isLocked ? (
                    'Window Closed'
                ) : (
                    'Accept'
                )}
            </Button>
            <Button
                size="sm"
                variant="outline"
                className="font-black text-xs uppercase tracking-wider text-destructive border-destructive/30 hover:bg-destructive/10"
                onClick={() => !isActionDisabled && onDeclineRequest(offer.shift_id)}
                disabled={isActionDisabled}
            >
                Decline
            </Button>
        </div>
    ) : (
        <div className="p-3 flex justify-center">
            <Badge
                variant="outline"
                className={cn(
                    'text-[10px] uppercase tracking-wider font-black flex items-center gap-1',
                    offer.status === 'Accepted'
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                        : 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400',
                )}
            >
                {offer.status === 'Accepted' ? (
                    <CheckCircle className="h-3 w-3" />
                ) : (
                    <XCircle className="h-3 w-3" />
                )}
                {offer.status}
            </Badge>
        </div>
    );

    return (
        <SharedShiftCard
            organization={offer.shift.organizations?.name || ''}
            department={offer.shift.departments?.name || ''}
            subGroup={offer.shift.sub_departments?.name}
            role={offer.shift.roles?.name || 'Shift'}
            shiftDate={format(new Date(offer.shift.shift_date), 'EEE, MMM d')}
            startTime={offer.shift.start_time.slice(0, 5)}
            endTime={offer.shift.end_time.slice(0, 5)}
            netLength={netLength}
            paidBreak={offer.shift.paid_break_minutes ?? offer.shift.break_minutes ?? 0}
            unpaidBreak={offer.shift.unpaid_break_minutes ?? 0}
            timerText={timerText}
            isExpired={isExpired || isLocked}
            groupVariant={
                offer.shift.group_type === 'convention_centre' ? 'convention' :
                offer.shift.group_type === 'exhibition_centre' ? 'exhibition' :
                offer.shift.group_type === 'theatre' ? 'theatre' : 'default'
            }
            footerActions={footerActions}
        />
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

    const { data: pendingOffers = [], isLoading: isLoadingPending } = useMyOffers(
        isOpen && user?.id ? user.id : null,
        filters,
    );
    const { data: acceptedOffers = [], isLoading: isLoadingAccepted } = useMyOffersHistory(
        isOpen && user?.id ? user.id : null,
        'Accepted',
        filters,
    );
    const { data: declinedOffers = [], isLoading: isLoadingDeclined } = useMyOffersHistory(
        isOpen && user?.id ? user.id : null,
        'Declined',
        filters,
    );

    const acceptOfferMutation = useAcceptOffer();
    const declineOfferMutation = useDeclineOffer();
    const expireOfferMutation = useExpireOffer();

    // Silently exclude expired pending offers from the list
    const activePending = (pendingOffers as OfferData[]).filter((o) => {
        const expiryMs = parseExpiry(o.offer_expires_at || (o.shift as any).offer_expires_at);
        return !expiryMs || expiryMs > Date.now();
    });

    const currentOffers: OfferData[] =
        activeTab === 'Pending'
            ? activePending
            : activeTab === 'Accepted'
              ? (acceptedOffers as OfferData[])
              : (declinedOffers as OfferData[]);

    const isLoading =
        activeTab === 'Pending'
            ? isLoadingPending
            : activeTab === 'Accepted'
              ? isLoadingAccepted
              : isLoadingDeclined;

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
        { label: 'Accepted', count: (acceptedOffers as OfferData[]).length },
        { label: 'Declined', count: (declinedOffers as OfferData[]).length },
    ];

    return (
        <>
            <ResponsiveDialog
                open={isOpen}
                onOpenChange={(open) => !open && onClose()}
                dialogClassName="sm:max-w-[480px] max-h-[82vh] p-0 overflow-hidden flex flex-col rounded-2xl [&>button]:hidden z-[150]"
                drawerClassName="bg-background border-border"
            >
                <ResponsiveDialog.Header className="sr-only">
                    <ResponsiveDialog.Title>My Shift Offers</ResponsiveDialog.Title>
                    <ResponsiveDialog.Description>
                        Review and respond to shift offers assigned to you.
                    </ResponsiveDialog.Description>
                </ResponsiveDialog.Header>

                {/* Header */}
                <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
                    <div className="h-8 w-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                        <Inbox className="h-4 w-4 text-blue-500" />
                    </div>
                    <div className="flex-1">
                        <h2 className="font-black text-foreground tracking-tight leading-none">
                            Shift Offers
                        </h2>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mt-0.5">
                            My Inbox
                        </p>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-lg"
                        onClick={onClose}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                {/* Tab Selector */}
                <div className="flex gap-1.5 px-5 pt-4 pb-2 shrink-0">
                    {tabs.map(({ label, count }) => (
                        <button
                            key={label}
                            onClick={() => setActiveTab(label)}
                            className={cn(
                                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all min-h-[44px]',
                                activeTab === label
                                    ? 'bg-foreground text-background'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                            )}
                        >
                            {label}
                            {count > 0 && (
                                <span
                                    className={cn(
                                        'h-4 min-w-[1rem] rounded-full text-[9px] flex items-center justify-center px-1 font-black',
                                        activeTab === label
                                            ? 'bg-background/20 text-background'
                                            : 'bg-muted-foreground/20 text-muted-foreground',
                                    )}
                                >
                                    {count}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Offer List */}
                <ResponsiveDialog.Body className="flex-1 overflow-y-auto px-5 pb-5 space-y-3 min-h-0">
                    {isLoading ? (
                        [1, 2, 3].map((i) => (
                            <Skeleton key={i} className="h-52 w-full rounded-xl" />
                        ))
                    ) : currentOffers.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center opacity-30">
                            <Inbox className="h-8 w-8 mb-3 stroke-[1]" />
                            <p className="text-xs font-black uppercase tracking-widest">
                                Nothing Here
                            </p>
                        </div>
                    ) : (
                        currentOffers.map((offer) => (
                            <OfferItem
                                key={offer.id}
                                offer={offer}
                                showActions={activeTab === 'Pending'}
                                processingId={processingId}
                                onAccept={handleAccept}
                                onDeclineRequest={(id) => setShowDeclineConfirm(id)}
                                onExpire={handleExpire}
                            />
                        ))
                    )}
                </ResponsiveDialog.Body>
            </ResponsiveDialog>

            {/* Decline Confirmation */}
            <AlertDialog
                open={!!showDeclineConfirm}
                onOpenChange={() => setShowDeclineConfirm(null)}
            >
                <AlertDialogContent className="bg-background border border-border rounded-2xl p-6 max-w-sm z-[200] shadow-2xl">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="font-black text-foreground tracking-tight">
                            Decline Shift?
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-muted-foreground text-sm">
                            This shift will be returned to the pool for bidding. This cannot be
                            undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="mt-6 gap-3">
                        <AlertDialogCancel className="font-black text-xs uppercase tracking-wider rounded-xl">
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground font-black text-xs uppercase tracking-wider rounded-xl"
                            onClick={() =>
                                showDeclineConfirm && handleDecline(showDeclineConfirm)
                            }
                            disabled={!!processingId}
                        >
                            {processingId ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : null}
                            Decline
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};
