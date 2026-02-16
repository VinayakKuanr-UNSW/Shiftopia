import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import {
    Loader2,
    Calendar,
    Clock,
    Check,
    ArrowLeftRight,
    ShieldCheck,
    Timer,
    Info,
    Send,
    MessageSquare,
    UserCheck,
    CheckCircle2,
} from 'lucide-react';
import { format, differenceInMinutes } from 'date-fns';
import { SwapOffer, swapsApi } from '../../api/swaps.api';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/modules/core/lib/utils';
import { Avatar, AvatarFallback } from '@/modules/core/ui/primitives/avatar';

interface ViewOffersModalProps {
    isOpen: boolean;
    onClose: () => void;
    swapResquestId: string;
    onAccept: (offer: SwapOffer) => void;
    onDecline: (offerId: string) => void;
    isAccepting: boolean;
    isDeclining: boolean;
}

const formatTime = (time: string): string => {
    if (!time) return '';
    const [h, m] = time.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const display = h % 12 || 12;
    return `${display}:${m?.toString().padStart(2, '0') || '00'} ${period}`;
};

// Get initials from name
const getInitials = (name: string): string => {
    const parts = name.split(' ');
    if (parts.length >= 2) {
        return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
};

const getGroupColor = (groupType: string | null = null, deptName: string = '') => {
    const type = groupType || '';
    const name = deptName.toLowerCase();

    if (type === 'convention_centre' || name.includes('convention')) return 'bg-blue-600 border-blue-400 text-white';
    if (type === 'exhibition_centre' || name.includes('exhibition')) return 'bg-green-600 border-green-400 text-white';
    if (type === 'theatre' || name.includes('theatre')) return 'bg-red-600 border-red-400 text-white';

    return 'bg-slate-700 border-slate-600 text-slate-100';
};

// Calculate countdown
const getCountdown = (shiftDate: string, startTime: string) => {
    if (!shiftDate || !startTime) return null;

    const shiftStart = new Date(`${shiftDate}T${startTime}`);
    const closeTime = new Date(shiftStart.getTime() - 4 * 60 * 60 * 1000);
    const now = new Date();

    if (now >= closeTime) return { text: 'Closed', isUrgent: true };

    const minutesLeft = differenceInMinutes(closeTime, now);
    const hoursLeft = Math.floor(minutesLeft / 60);
    const mins = minutesLeft % 60;

    return {
        text: `Closes in ${hoursLeft}h ${mins}m`,
        isUrgent: minutesLeft <= 30
    };
};

// Timeline step component  
const TimelineStep: React.FC<{
    icon: React.ReactNode;
    label: string;
    isActive: boolean;
    isCompleted: boolean;
}> = ({ icon, label, isActive, isCompleted }) => (
    <div className="flex flex-col items-center gap-1">
        <div className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center text-xs",
            isCompleted ? "bg-primary text-primary-foreground" :
                isActive ? "bg-primary text-primary-foreground" :
                    "bg-slate-700 text-muted-foreground"
        )}>
            {isCompleted ? <Check className="h-4 w-4" /> : icon}
        </div>
        <span className={cn(
            "text-[9px] font-medium uppercase tracking-wide text-center leading-tight max-w-[60px]",
            isActive ? "text-primary" : "text-muted-foreground"
        )}>
            {label}
        </span>
    </div>
);

// Timeline connector
const TimelineConnector: React.FC<{ isActive: boolean }> = ({ isActive }) => (
    <div className={cn(
        "flex-1 h-0.5 mx-1",
        isActive ? "bg-primary" : "bg-slate-700"
    )} />
);

export const ViewOffersModal: React.FC<ViewOffersModalProps> = ({
    isOpen,
    onClose,
    swapResquestId,
    onAccept,
    onDecline,
    isAccepting,
    isDeclining,
}) => {
    const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
    const [, setTick] = useState(0);

    // Refresh countdown every minute
    useEffect(() => {
        const interval = setInterval(() => setTick(t => t + 1), 60000);
        return () => clearInterval(interval);
    }, []);

    // Fetch offers for this swap request
    const { data: offers, isLoading: isLoadingOffers } = useQuery({
        queryKey: ['swapOffers', swapResquestId],
        queryFn: () => swapsApi.getSwapOffers(swapResquestId),
        enabled: isOpen && !!swapResquestId,
    });

    // Fetch the current swap request details for timeline and "You Give" section
    const { data: currentSwap } = useQuery({
        queryKey: ['swapById', swapResquestId],
        queryFn: () => swapsApi.getSwapById(swapResquestId),
        enabled: isOpen && !!swapResquestId,
    });

    const myShift = currentSwap?.originalShift;

    const pendingOffers = offers?.filter(o => o.status === 'SUBMITTED') || [];
    // If we are past the selection stage, we want to show the accepted offer
    const acceptedOffer = offers?.find(o => o.status === 'SELECTED' || o.status === 'ACCEPTED'); // Map SELECTED/ACCEPTED to accepted logic

    // Determine what to display
    const displayOffers = (currentSwap?.status === 'MANAGER_PENDING' || currentSwap?.status === 'APPROVED')
        ? (acceptedOffer ? [acceptedOffer] : [])
        : pendingOffers;

    const hasOffers = displayOffers.length > 0;

    // Determine timeline state
    const getTimelineState = () => {
        if (!currentSwap) return { created: true, offerReceived: false, approval: false, manager: false };

        if (currentSwap.status === 'MANAGER_PENDING') {
            return { created: true, offerReceived: true, approval: true, manager: false };
        }
        if (currentSwap.status === 'APPROVED') {
            return { created: true, offerReceived: true, approval: true, manager: true };
        }
        if (offers && offers.some(o => o.status === 'SUBMITTED')) {
            return { created: true, offerReceived: true, approval: false, manager: false };
        }
        return { created: true, offerReceived: false, approval: false, manager: false };
    };

    const timeline = getTimelineState();

    // Get dynamic message
    const getTimelineMessage = () => {
        if (timeline.manager) {
            return {
                title: "Swap Approved",
                description: "This swap has been approved by the manager and is now final."
            };
        }
        if (timeline.approval) {
            return {
                title: "Waiting for Manager",
                description: "You have accepted an offer. Waiting for manager approval."
            };
        }
        if (timeline.offerReceived) {
            return {
                title: "Review Offers",
                description: "You have received offers! Select one to proceed or reject them."
            };
        }
        return {
            title: "Waiting for Offers",
            description: "Your request is active. We'll notify you when someone sends an offer."
        };
    };

    const message = getTimelineMessage();

    const handleApprove = () => {
        const offer = selectedOfferId
            ? offers?.find(o => o.id === selectedOfferId)
            : pendingOffers[0];

        if (offer) {
            onAccept(offer);
        }
    };

    const handleReject = () => {
        if (selectedOfferId) {
            onDecline(selectedOfferId);
            setSelectedOfferId(null);
        } else if (pendingOffers.length === 1) {
            onDecline(pendingOffers[0].id);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-lg bg-slate-900 border-slate-700">
                <DialogHeader>
                    <DialogTitle className="text-xl font-bold text-foreground">
                        Received Offers
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground">
                        Choose which shift you want to swap with yours
                    </DialogDescription>
                </DialogHeader>

                {/* Timeline */}
                <div className="flex items-center justify-between px-2 py-4">
                    <TimelineStep
                        icon={<Check className="h-3 w-3" />}
                        label="Created"
                        isActive={false}
                        isCompleted={timeline.created}
                    />
                    <TimelineConnector isActive={timeline.offerReceived} />
                    <TimelineStep
                        icon={<MessageSquare className="h-3 w-3" />}
                        label="Offer Received"
                        isActive={timeline.offerReceived && !timeline.approval}
                        isCompleted={timeline.approval}
                    />
                    <TimelineConnector isActive={timeline.approval} />
                    <TimelineStep
                        icon={<UserCheck className="h-3 w-3" />}
                        label="Approval"
                        isActive={timeline.approval && !timeline.manager}
                        isCompleted={timeline.manager}
                    />
                    <TimelineConnector isActive={timeline.manager} />
                    <TimelineStep
                        icon={<CheckCircle2 className="h-3 w-3" />}
                        label="Manager"
                        isActive={timeline.manager}
                        isCompleted={timeline.manager} // Fully completed if approved
                    />
                </div>

                {/* Dynamic Status Message */}
                <div className={cn(
                    "border rounded-lg p-3 mb-4 text-center",
                    timeline.manager ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600" :
                        timeline.approval ? "bg-blue-500/10 border-blue-500/20 text-blue-600" :
                            timeline.offerReceived ? "bg-primary/10 border-primary/20 text-primary" :
                                "bg-slate-800 border-slate-700 text-muted-foreground"
                )}>
                    <p className="text-sm font-medium">
                        {message.title}
                    </p>
                    <p className="text-xs opacity-90 mt-1">
                        {message.description}
                    </p>
                </div>

                {/* Content */}
                <div className="space-y-4 max-h-[50vh] overflow-y-auto px-1">
                    {isLoadingOffers ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : !hasOffers ? (
                        <div className="text-center py-12 text-muted-foreground">
                            <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
                            <p>No offers to display.</p>
                            <p className="text-sm mt-1">Check back later for responses.</p>
                        </div>
                    ) : (
                        displayOffers.map((offer) => {
                            // If status is NOT pending, click should probably do nothing or just select for highlighting
                            const isPending = offer.status === 'SUBMITTED';
                            const countdown = getCountdown(
                                offer.offered_shift?.shift_date || '',
                                offer.offered_shift?.start_time || ''
                            );
                            // Auto-select if it's the accepted one or single pending
                            const isSelected = selectedOfferId === offer.id || displayOffers.length === 1;

                            return (
                                <div
                                    key={offer.id}
                                    onClick={() => isPending && setSelectedOfferId(offer.id)}
                                    className={cn(
                                        "bg-slate-800/50 border rounded-xl p-4 transition-all",
                                        isPending ? "cursor-pointer hover:border-slate-600" : "cursor-default",
                                        isSelected && isPending
                                            ? "border-primary ring-1 ring-primary"
                                            : "border-slate-700"
                                    )}
                                >
                                    {/* Offerer Info */}
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-3">
                                            <Avatar className="h-10 w-10 bg-slate-700">
                                                <AvatarFallback className="bg-gradient-to-br from-purple-500 to-blue-500 text-white text-sm font-medium">
                                                    {getInitials(offer.offerer?.full_name || 'U')}
                                                </AvatarFallback>
                                            </Avatar>
                                            <div>
                                                <p className="font-semibold text-foreground">
                                                    {offer.offerer?.full_name || 'Unknown User'}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {offer.offered_shift?.roles?.name || 'Employee'}
                                                </p>
                                            </div>
                                        </div>
                                        <Badge variant="outline" className="text-primary border-primary/30 bg-primary/5">
                                            Offer Received
                                        </Badge>
                                    </div>

                                    {/* Shift Details - Two Columns */}
                                    <div className="flex items-stretch gap-2 mb-3">
                                        {/* They Offer */}
                                        <div className={cn(
                                            "flex-1 p-3 rounded-xl border relative overflow-hidden",
                                            offer.offered_shift
                                                ? getGroupColor(offer.offered_shift.roles?.group_type, offer.offered_shift.departments?.name)
                                                : "bg-slate-800/30 border-slate-700"
                                        )}>
                                            <p className={cn(
                                                "text-[10px] uppercase tracking-wide mb-2 font-medium",
                                                offer.offered_shift ? "text-white/80" : "text-muted-foreground"
                                            )}>
                                                They Offer
                                            </p>
                                            {offer.offered_shift ? (
                                                <div className="space-y-1 text-white">
                                                    <div className="flex items-center gap-2 text-sm font-bold">
                                                        <Calendar className="h-3.5 w-3.5 text-white/80" />
                                                        <span>
                                                            {format(new Date(offer.offered_shift.shift_date), 'EEE, MMM d')}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2 text-xs text-white/90">
                                                        <Clock className="h-3.5 w-3.5 text-white/80" />
                                                        <span>
                                                            {formatTime(offer.offered_shift.start_time)} - {formatTime(offer.offered_shift.end_time)}
                                                        </span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <p className="text-sm text-muted-foreground italic">
                                                    Taking your shift
                                                </p>
                                            )}
                                        </div>

                                        {/* Swap Icon */}
                                        <div className="flex items-center justify-center">
                                            <div className="bg-slate-800 rounded-full p-1.5 border border-slate-700">
                                                <Send className="h-3 w-3 text-muted-foreground rotate-45" />
                                            </div>
                                        </div>

                                        {/* You Give */}
                                        <div className={cn(
                                            "flex-1 p-3 rounded-xl border relative overflow-hidden",
                                            myShift
                                                ? getGroupColor(myShift.roles?.group_type, myShift.departments?.name)
                                                : "bg-slate-800/30 border-slate-700"
                                        )}>
                                            <p className={cn(
                                                "text-[10px] uppercase tracking-wide mb-2 font-medium",
                                                myShift ? "text-white/80" : "text-muted-foreground"
                                            )}>
                                                You Give
                                            </p>
                                            {myShift ? (
                                                <div className="space-y-1 text-white">
                                                    <div className="flex items-center gap-2 text-sm font-bold">
                                                        <Calendar className="h-3.5 w-3.5 text-white/80" />
                                                        <span>
                                                            {format(new Date(myShift.shift_date), 'EEE, MMM d')}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2 text-xs text-white/90">
                                                        <Clock className="h-3.5 w-3.5 text-white/80" />
                                                        <span>
                                                            {formatTime(myShift.start_time)} - {formatTime(myShift.end_time)}
                                                        </span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <p className="text-sm text-muted-foreground">Your shift</p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Badges Row */}
                                    <div className="flex items-center gap-3 mt-3">
                                        {/* Show Status Badge if not pending */}
                                        {!isPending && (
                                            <Badge variant={offer.status === 'SELECTED' || offer.status === 'ACCEPTED' ? 'default' : 'secondary'}>
                                                {offer.status}
                                            </Badge>
                                        )}

                                        <div className="flex items-center gap-1.5 text-xs text-emerald-500">
                                            <ShieldCheck className="h-3.5 w-3.5" />
                                            <span>Compliance OK</span>
                                        </div>
                                        {/* Only show countdown if pending */}
                                        {isPending && countdown && (
                                            <div className={cn(
                                                "flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full",
                                                countdown.isUrgent
                                                    ? "bg-red-500/10 text-red-400"
                                                    : "bg-amber-500/10 text-amber-400"
                                            )}>
                                                <Timer className="h-3 w-3" />
                                                <span>{countdown.text}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Info Text - Only if pending offers exist */}
                {hasOffers && currentSwap?.status === 'OPEN' && (
                    <div className="flex items-start gap-2 px-4 py-3 bg-slate-800/30 rounded-lg text-xs text-muted-foreground">
                        <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
                        <p>
                            Only one offer can be approved. Others will be declined automatically once you make a selection.
                        </p>
                    </div>
                )}

                {/* Action Buttons - Only if pending */}
                {currentSwap?.status === 'OPEN' && (
                    <div className="flex items-center justify-end gap-3 pt-2">
                        <Button
                            variant="ghost"
                            onClick={handleReject}
                            disabled={!hasOffers || isAccepting || isDeclining}
                            className="text-muted-foreground hover:text-foreground"
                        >
                            Reject
                        </Button>
                        <Button
                            onClick={handleApprove}
                            disabled={!hasOffers || isAccepting || isDeclining}
                            className="bg-primary hover:bg-primary/90 text-primary-foreground px-6"
                        >
                            {isAccepting ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Processing...
                                </>
                            ) : (
                                <>
                                    <Send className="h-4 w-4 mr-2" />
                                    Approve & Send to Manager
                                </>
                            )}
                        </Button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};
