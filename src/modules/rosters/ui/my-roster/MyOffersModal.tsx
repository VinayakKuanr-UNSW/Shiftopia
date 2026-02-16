import React, { useState } from 'react';
import { format } from 'date-fns';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/modules/core/ui/primitives/dialog';
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
import { useMyOffers, useMyOffersHistory, useAcceptOffer, useDeclineOffer } from '@/modules/rosters/state/useRosterShifts';
import { useAuth } from '@/modules/auth/hooks/useAuth';
import { cn } from '@/modules/core/lib/utils';
import {
    Calendar,
    Clock,
    MapPin,
    User,
    FileText,
    Inbox,
    CheckCircle,
    XCircle,
    Loader2,
    AlertCircle,
} from 'lucide-react';
import { isShiftLocked } from '@/modules/rosters/domain/shift-locking.utils';

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
        remuneration_levels?: { level_name: string; hourly_rate_min: number } | null;
    };
}

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

    // Get filters from context or props? 
    // Ideally passed in, but for now we might default to user's org if not provided, 
    // or rely on the parent to pass them. 
    // The user mentioned "Global filter", usually implying a context.
    // Let's assume for now we want ALL unless specific filters are needed.
    // ACTUALLY: User said "Offers are not filtered by the global filter". 
    // This implies we should listen to the global filter context if it exists.
    // However, MyOffers is usually personal. 
    // "Meaning I can accept it from a different department." -> They want to filter OUT offers from other depts?
    // Or they want to SEE offers from other depts but the global filter in the UI is hiding them?
    // Re-reading: "Shift Offers are not filtered by the global filter... Meaning I can accept it from a different department."
    // This sounds like they WANT restriction.
    // Let's import the store hook if available.

    // Using user's current view context if available, otherwise default.
    // For "My Roster" page, there might be filters. 
    // But `MyOffersModal` is often global.
    // Let's use `useRosterStore` or similar if it exists? 
    // Checking previous context: `useRosterState` or `useRosterFilters`?
    // Let's try to find where filters come from in `ManagerSwaps` or `MyRoster`.
    // In `ManagerSwaps`, filters come from local state.
    // In `MyRoster`, likely similar.

    // For now, let's look at `useRosterShifts` usage.
    // I will add optional props for filters to `MyOffersModal` and let the parent pass them.
    // But I can't change the call sites easily without knowing them all.
    // The user said "Global filter", so I assume they mean the filters on the page.
    // I I'll add `organizationId` and `departmentId` to props.

    // Updating logic to fetch based on tab
    // We need to get these from somewhere. 
    // If not passed, we might be showing everything.
    // Let's rely on the hook calls for now.

    // 1. Pending Offers
    const { data: pendingOffers = [], isLoading: isLoadingPending, error: errorPending } = useMyOffers(
        isOpen && user?.id ? user.id : null,
        filters
    );

    // 2. History (Accepted)
    const { data: acceptedOffers = [], isLoading: isLoadingAccepted, error: errorAccepted } = useMyOffersHistory(
        isOpen && user?.id ? user.id : null,
        'Accepted',
        filters
    );

    // 3. History (Declined)
    const { data: declinedOffers = [], isLoading: isLoadingDeclined, error: errorDeclined } = useMyOffersHistory(
        isOpen && user?.id ? user.id : null,
        'Declined',
        filters
    );

    // Combine for display based on tab
    const offers = activeTab === 'Pending' ? pendingOffers as OfferData[]
        : activeTab === 'Accepted' ? acceptedOffers as OfferData[]
            : declinedOffers as OfferData[];

    const isLoading = activeTab === 'Pending' ? isLoadingPending
        : activeTab === 'Accepted' ? isLoadingAccepted
            : isLoadingDeclined;

    // Combine errors
    const error = activeTab === 'Pending' ? errorPending
        : activeTab === 'Accepted' ? errorAccepted
            : errorDeclined;

    // Mutation hooks for accept/decline
    const acceptOfferMutation = useAcceptOffer();
    const declineOfferMutation = useDeclineOffer();

    // Counts
    const pendingCount = pendingOffers.length;
    // We can't easily get total counts for history without fetching them all, 
    // but we are fetching them now so we can use length.
    const acceptedCount = acceptedOffers.length;
    const declinedCount = declinedOffers.length;

    // Filter offers by active tab - ALREADY DONE by selecting data source
    const filteredOffers = offers;

    // Handle Accept
    const handleAccept = async (shiftId: string) => {
        setProcessingId(shiftId);
        try {
            await acceptOfferMutation.mutateAsync(shiftId);
            toast({
                title: 'Shift Accepted',
                description: 'Shift accepted and added to your roster.',
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

    // Handle Decline
    const handleDecline = async (shiftId: string) => {
        setProcessingId(shiftId);
        try {
            await declineOfferMutation.mutateAsync(shiftId);
            toast({
                title: 'Shift Declined',
                description: 'Shift declined and moved to bidding.',
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

    // Render status pill
    const renderStatusPill = (status: OfferStatus) => {
        const variants: Record<OfferStatus, { bg: string; text: string }> = {
            Pending: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
            Accepted: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
            Declined: { bg: 'bg-red-500/20', text: 'text-red-400' },
        };
        return (
            <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', variants[status].bg, variants[status].text)}>
                {status}
            </span>
        );
    };

    // Render empty state
    const renderEmptyState = () => {
        if (activeTab === 'Pending') {
            return (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                    <Inbox className="h-12 w-12 text-muted-foreground/50 mb-4" />
                    <h3 className="text-lg font-medium text-foreground mb-1">No pending offers</h3>
                    <p className="text-sm text-muted-foreground">New shift offers will appear here</p>
                </div>
            );
        }
        return (
            <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-sm text-muted-foreground">
                    {activeTab === 'Accepted' ? 'No accepted offers yet' : 'No declined offers yet'}
                </p>
            </div>
        );
    };



    // ... (existing imports)

    // Render offer card
    const renderOfferCard = (offer: OfferData) => {
        const shift = offer.shift;
        const isProcessing = processingId === offer.shift_id;
        const isLocked = isShiftLocked(shift.shift_date, shift.start_time, 'my_roster');

        return (
            <div
                key={offer.id}
                className="border border-border rounded-lg p-4 bg-card hover:bg-accent/50 transition-colors"
            >
                {/* Card Header */}
                <div className="flex items-center justify-between mb-3">
                    <span className="font-semibold text-foreground">
                        {shift.roles?.name || 'Shift'}
                    </span>
                    <div className="flex items-center gap-2">
                        {isLocked && (
                            <Badge variant="outline" className="text-muted-foreground border-muted-foreground/30">
                                Expired
                            </Badge>
                        )}
                        {renderStatusPill(offer.status)}
                    </div>
                </div>

                {/* Card Body */}
                <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <Calendar className="h-4 w-4" />
                        <span>{format(new Date(shift.shift_date), 'EEE dd MMM yyyy')}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        <span>{shift.start_time?.slice(0, 5)} – {shift.end_time?.slice(0, 5)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <MapPin className="h-4 w-4" />
                        <span>{shift.departments?.name || shift.organizations?.name || 'Unknown'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <User className="h-4 w-4" />
                        <span>Offered by Admin</span>
                    </div>
                    {shift.notes && (
                        <div className="col-span-2 flex items-start gap-2 text-muted-foreground">
                            <FileText className="h-4 w-4 mt-0.5" />
                            <span className="line-clamp-2">{shift.notes}</span>
                        </div>
                    )}
                </div>

                {/* Card Footer Actions */}
                {offer.status === 'Pending' ? (
                    <div className="flex gap-2">
                        {isLocked ? (
                            <div className="w-full text-center p-2 bg-muted/50 rounded text-sm text-muted-foreground">
                                This offer has expired because the shift started.
                            </div>
                        ) : (
                            <>
                                <Button
                                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                                    onClick={() => handleAccept(offer.shift_id)}
                                    disabled={isProcessing}
                                >
                                    {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-1" />}
                                    Accept
                                </Button>
                                <Button
                                    variant="outline"
                                    className="flex-1 border-red-500/30 text-red-400 hover:bg-red-950/30"
                                    onClick={() => setShowDeclineConfirm(offer.shift_id)}
                                    disabled={isProcessing}
                                >
                                    <XCircle className="h-4 w-4 mr-1" />
                                    Decline
                                </Button>
                            </>
                        )}
                    </div>
                ) : offer.status === 'Accepted' ? (
                    <div className="text-center">
                        <Button variant="secondary" className="w-full" disabled>
                            <CheckCircle className="h-4 w-4 mr-1 text-emerald-400" />
                            Accepted
                        </Button>
                        <p className="text-xs text-muted-foreground mt-1">This shift is now on your roster</p>
                    </div>
                ) : (
                    <div className="text-center">
                        <Button variant="secondary" className="w-full" disabled>
                            <XCircle className="h-4 w-4 mr-1 text-red-400" />
                            Declined
                        </Button>
                        <p className="text-xs text-muted-foreground mt-1">This shift is now open for bidding</p>
                    </div>
                )}
            </div>
        );
    };

    return (
        <>
            <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
                <DialogContent className="sm:max-w-[800px] max-h-[80vh] flex flex-col">
                    {/* Header */}
                    <DialogHeader className="flex-shrink-0">
                        <DialogTitle className="text-xl">My Offers</DialogTitle>
                        <DialogDescription>Review and respond to shift offers</DialogDescription>
                    </DialogHeader>

                    {/* Tabs */}
                    <div className="flex-shrink-0 flex items-center bg-muted rounded-lg p-1 mb-4">
                        {(['Pending', 'Accepted', 'Declined'] as OfferStatus[]).map((tab) => {
                            const count = tab === 'Pending' ? pendingCount : tab === 'Accepted' ? acceptedCount : declinedCount;
                            return (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    className={cn(
                                        'flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all',
                                        activeTab === tab
                                            ? 'bg-background text-foreground shadow-sm'
                                            : 'text-muted-foreground hover:text-foreground'
                                    )}
                                >
                                    {tab}
                                    {count > 0 && (
                                        <Badge
                                            variant={tab === 'Pending' ? 'default' : 'secondary'}
                                            className={cn(
                                                'min-w-[20px] h-5 text-xs',
                                                tab === 'Pending' && 'bg-amber-500 text-white'
                                            )}
                                        >
                                            {count}
                                        </Badge>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {/* Content */}
                    <div className="flex-grow overflow-y-auto space-y-3 pr-1">
                        {isLoading ? (
                            <div className="space-y-3">
                                {[1, 2, 3].map((i) => (
                                    <Skeleton key={i} className="h-40 w-full rounded-lg" />
                                ))}
                            </div>
                        ) : error ? (
                            <div className="flex items-center justify-center py-8 text-destructive gap-2">
                                <AlertCircle className="h-5 w-5" />
                                Something went wrong. Please try again.
                            </div>
                        ) : filteredOffers.length === 0 ? (
                            renderEmptyState()
                        ) : (
                            filteredOffers.map(renderOfferCard)
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Decline Confirmation */}
            <AlertDialog open={!!showDeclineConfirm} onOpenChange={() => setShowDeclineConfirm(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Decline shift offer</AlertDialogTitle>
                        <AlertDialogDescription>
                            This shift will become available for bidding. You will no longer be assigned.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={!!processingId}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-red-600 hover:bg-red-700 text-white"
                            onClick={() => showDeclineConfirm && handleDecline(showDeclineConfirm)}
                            disabled={!!processingId}
                        >
                            {processingId ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            Confirm Decline
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};
