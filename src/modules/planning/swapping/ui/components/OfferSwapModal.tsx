import React, { useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/modules/core/ui/primitives/dialog';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Button } from '@/modules/core/ui/primitives/button';
import { useQuery } from '@tanstack/react-query';
import { shiftsApi } from '@/modules/rosters';
import { swapsApi } from '../../api/swaps.api';
import { useAuth } from '@/platform/auth/useAuth';
import { format, addDays } from 'date-fns';
import {
    Loader2,
    Clock,
    Calendar,
    Check,
    MessageSquare,
    UserCheck,
    CheckCircle2,
    Send,
    Shield,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { Avatar, AvatarFallback } from '@/modules/core/ui/primitives/avatar';
import { SwapComplianceModal } from './SwapComplianceModal';

interface OfferSwapModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirmOffer: (shiftId: string | undefined) => void;
    isSubmitting: boolean;
    swapId: string;
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

export const OfferSwapModal: React.FC<OfferSwapModalProps> = ({
    isOpen,
    onClose,
    onConfirmOffer,
    isSubmitting,
    swapId,
}) => {
    const { user } = useAuth();
    const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
    const [showComplianceModal, setShowComplianceModal] = useState(false);

    // Fetch the swap request details to get the requester's info
    const { data: currentSwap } = useQuery({
        queryKey: ['swapDetails', swapId],
        queryFn: () => swapsApi.getSwapById(swapId),
        enabled: isOpen && !!swapId,
    });

    const requesterName = currentSwap?.requestorEmployee?.fullName || 'Unknown User';
    const theirShift = currentSwap?.originalShift;

    // 1. Fetch existing offers for THIS swap
    const { data: existingOffers } = useQuery({
        queryKey: ['swapOffers', swapId],
        queryFn: () => swapsApi.getSwapOffers(swapId),
        enabled: isOpen && !!swapId,
    });

    // Identify offers that are PENDING or ACCEPTED (active)
    const alreadyOfferedForThisSwapIds = new Set(
        existingOffers
            ?.filter(offer => offer.offering_employee_id === user?.id && offer.status !== 'rejected' && offer.status !== 'withdrawn')
            .map(offer => offer.offered_shift_id)
            .filter(Boolean) as string[]
    );

    // Identify offers that were REJECTED for this swap
    const rejectedOfferIds = new Set(
        existingOffers
            ?.filter(offer => offer.offering_employee_id === user?.id && offer.status === 'rejected')
            .map(offer => offer.offered_shift_id)
            .filter(Boolean) as string[]
    );

    const { data: allMyActiveOffers } = useQuery({
        queryKey: ['myActiveOfferDetails', user?.id],
        queryFn: () => swapsApi.getMyActiveOfferDetails(user!.id),
        enabled: isOpen && !!user?.id,
    });

    const offeredElsewhereIds = new Set(
        allMyActiveOffers
            ?.filter(offer => offer.swap_request_id !== swapId)
            .map(offer => offer.offered_shift_id)
            .filter(Boolean) as string[]
    );

    // 3. Fetch future shifts for the next 30 days
    const { data: myShifts, isLoading } = useQuery({
        queryKey: ['myFutureShifts', user?.id],
        queryFn: async () => {
            if (!user?.id) return [];
            const today = new Date();
            const future = addDays(today, 90);
            return shiftsApi.getEmployeeShifts(
                user.id,
                format(today, 'yyyy-MM-dd'),
                format(future, 'yyyy-MM-dd')
            );
        },
        enabled: isOpen && !!user?.id,
    });

    // Get the selected shift details
    const selectedShift = myShifts?.find(s => s.id === selectedShiftId);

    const handleOpenComplianceCheck = () => {
        if (selectedShiftId) {
            setShowComplianceModal(true);
        }
    };

    const handleConfirmFromComplianceModal = () => {
        onConfirmOffer(selectedShiftId || undefined);
        setShowComplianceModal(false);
        setSelectedShiftId(null);
    };

    const handleClose = () => {
        setSelectedShiftId(null);
        setShowComplianceModal(false);
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="max-w-lg bg-slate-900 border-slate-700">
                <DialogHeader>
                    <DialogTitle className="text-xl font-bold text-foreground">
                        Swap Offers
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground sr-only">
                        Select a shift to offer for this swap
                    </DialogDescription>
                </DialogHeader>

                {/* Timeline */}
                <div className="flex items-center justify-between px-2 py-4">
                    <TimelineStep
                        icon={<Check className="h-3 w-3" />}
                        label="Created"
                        isActive={false}
                        isCompleted={true}
                    />
                    <TimelineConnector isActive={true} />
                    <TimelineStep
                        icon={<MessageSquare className="h-3 w-3" />}
                        label="Send Offer"
                        isActive={true}
                        isCompleted={false}
                    />
                    <TimelineConnector isActive={false} />
                    <TimelineStep
                        icon={<UserCheck className="h-3 w-3" />}
                        label="Employee Approved"
                        isActive={false}
                        isCompleted={false}
                    />
                    <TimelineConnector isActive={false} />
                    <TimelineStep
                        icon={<CheckCircle2 className="h-3 w-3" />}
                        label="Manager Approved"
                        isActive={false}
                        isCompleted={false}
                    />
                </div>

                {/* Dynamic Status Message */}
                <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 mb-4 text-center">
                    <p className="text-sm font-medium text-primary">
                        Step 2: Make an Offer
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                        Select a shift to offer in exchange. Once sent, {requesterName} will need to approve it.
                    </p>
                </div>

                {/* Proposed By Section */}
                <div className="flex items-center justify-between bg-slate-800/50 rounded-xl p-4 mb-4">
                    <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10 bg-slate-700">
                            <AvatarFallback className="bg-gradient-to-br from-cyan-500 to-blue-500 text-white text-sm font-medium">
                                {getInitials(requesterName)}
                            </AvatarFallback>
                        </Avatar>
                        <div>
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                Proposed By
                            </p>
                            <p className="font-semibold text-foreground">
                                {requesterName}
                            </p>
                        </div>
                    </div>
                    <Badge variant="outline" className="text-primary border-primary/30 bg-primary/5">
                        Offer Received
                    </Badge>
                </div>

                {/* Two Column Shift Display */}
                <div className="flex items-stretch gap-2 mb-4">
                    {/* You Offer (My Selected Shift) */}
                    <div className={cn(
                        "flex-1 p-4 rounded-xl border relative overflow-hidden transition-all",
                        selectedShift
                            ? getGroupColor((selectedShift as any).group_type || selectedShift.roles?.group_type, selectedShift.departments?.name)
                            : "bg-slate-800/30 border-slate-700"
                    )}>
                        <p className={cn(
                            "text-[10px] uppercase tracking-wide mb-3 font-medium",
                            selectedShift ? "text-white/80" : "text-cyan-400"
                        )}>
                            You Offer
                        </p>
                        {selectedShift ? (
                            <div className="space-y-2 text-white">
                                <div>
                                    <p className="text-[10px] uppercase tracking-wide text-white/60">
                                        Shift Date
                                    </p>
                                    <p className="text-sm font-bold">
                                        {format(new Date((selectedShift as any).shift_date), 'EEEE, MMM d, yyyy')}
                                    </p>
                                </div>
                                <div className="flex gap-4">
                                    <div>
                                        <p className="text-[10px] uppercase tracking-wide text-white/60">
                                            Time
                                        </p>
                                        <p className="text-sm">
                                            {formatTime((selectedShift as any).start_time)} - {formatTime((selectedShift as any).end_time)}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase tracking-wide text-white/60">
                                            Role
                                        </p>
                                        <p className="text-sm">
                                            {selectedShift.roles?.name || 'Shift'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground italic mt-4">
                                Select a shift from the list below
                            </p>
                        )}
                    </div>

                    {/* Swap Icon */}
                    <div className="flex items-center justify-center">
                        <div className="bg-slate-800 rounded-full p-2 border border-slate-700">
                            <Send className="h-4 w-4 text-muted-foreground rotate-45" />
                        </div>
                    </div>

                    {/* They Offer (Target Shift) */}
                    <div className={cn(
                        "flex-1 p-4 rounded-xl border relative overflow-hidden",
                        theirShift
                            ? getGroupColor((theirShift as any).group_type || theirShift.roles?.group_type, theirShift.departments?.name)
                            : "bg-slate-800/30 border-slate-700"
                    )}>
                        <p className={cn(
                            "text-[10px] uppercase tracking-wide mb-3 font-medium",
                            theirShift ? "text-white/80" : "text-muted-foreground"
                        )}>
                            They Offer
                        </p>
                        {theirShift ? (
                            <div className="space-y-2 text-white">
                                <div>
                                    <p className="text-[10px] uppercase tracking-wide text-white/60">
                                        Shift Date
                                    </p>
                                    <p className="text-sm font-bold">
                                        {format(new Date((theirShift as any).shiftDate || (theirShift as any).shift_date), 'EEEE, MMM d, yyyy')}
                                    </p>
                                </div>
                                <div className="flex gap-4">
                                    <div>
                                        <p className="text-[10px] uppercase tracking-wide text-white/60">
                                            Time
                                        </p>
                                        <p className="text-sm">
                                            {formatTime((theirShift as any).startTime || (theirShift as any).start_time)} - {formatTime((theirShift as any).endTime || (theirShift as any).end_time)}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase tracking-wide text-white/60">
                                            Role
                                        </p>
                                        <p className="text-sm">
                                            {theirShift.roles?.name || 'Shift'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground italic">
                                Loading...
                            </p>
                        )}
                    </div>
                </div>

                {/* Select Shift Section */}
                <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">Select a shift to offer:</p>
                    <div className="max-h-[200px] overflow-y-auto space-y-2 pr-1">
                        {isLoading ? (
                            <div className="flex justify-center py-6">
                                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                            </div>
                        ) : !myShifts || myShifts.length === 0 ? (
                            <div className="text-center py-6 text-muted-foreground text-sm">
                                You have no upcoming shifts to offer.
                            </div>
                        ) : (
                            myShifts.map((shift) => {
                                const isOfferedHere = alreadyOfferedForThisSwapIds.has(shift.id);
                                const isRejected = rejectedOfferIds.has(shift.id);
                                const isOfferedElsewhere = offeredElsewhereIds.has(shift.id);
                                const isUnavailable = isOfferedHere || isOfferedElsewhere || isRejected;
                                const isSelected = selectedShiftId === shift.id;

                                const cardColorClass = isUnavailable
                                    ? "opacity-50 grayscale bg-slate-800"
                                    : getGroupColor((shift as any).group_type || (shift as any).roles?.group_type, shift.departments?.name);

                                return (
                                    <div
                                        key={shift.id}
                                        onClick={() => !isUnavailable && setSelectedShiftId(shift.id)}
                                        className={cn(
                                            "p-3 rounded-lg border transition-all cursor-pointer",
                                            cardColorClass,
                                            isUnavailable
                                                ? 'cursor-not-allowed border-dashed border-slate-600'
                                                : isSelected
                                                    ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900'
                                                    : 'hover:opacity-90'
                                        )}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className={cn(
                                                    "w-5 h-5 rounded-full border-2 flex items-center justify-center",
                                                    isSelected ? "border-white bg-white" : "border-white/50"
                                                )}>
                                                    {isSelected && <Check className={cn("h-3 w-3",
                                                        cardColorClass.includes('bg-white') ? "text-black" : "text-primary"
                                                    )} />}
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <Calendar className="h-3 w-3 text-white/80" />
                                                        <span className="text-sm font-medium text-white">
                                                            {format(new Date(shift.shift_date), 'EEE, MMM d')}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-0.5">
                                                        <Clock className="h-3 w-3 text-white/80" />
                                                        <span className="text-xs text-white/80">
                                                            {formatTime(shift.start_time)} - {formatTime(shift.end_time)}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            {isRejected ? (
                                                <Badge variant="destructive" className="text-[10px] h-5 bg-red-950 text-red-200 border-red-800">
                                                    Rejected
                                                </Badge>
                                            ) : isOfferedHere ? (
                                                <Badge variant="secondary" className="text-[10px] h-5 bg-slate-900/50 text-white border-white/20">
                                                    Offered
                                                </Badge>
                                            ) : isOfferedElsewhere ? (
                                                <Badge variant="outline" className="text-[10px] h-5 bg-amber-950/50 text-amber-200 border-amber-500/50">
                                                    Elsewhere
                                                </Badge>
                                            ) : null}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center justify-end gap-3 pt-2">
                    <Button
                        variant="ghost"
                        onClick={handleClose}
                        disabled={isSubmitting}
                        className="text-muted-foreground hover:text-foreground"
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleOpenComplianceCheck}
                        disabled={isSubmitting || !selectedShiftId}
                        className="bg-purple-600 hover:bg-purple-700 px-6 gap-2"
                    >
                        <Shield className="h-4 w-4" />
                        Check & Offer
                    </Button>
                </div>

                {/* Swap Compliance Modal */}
                <SwapComplianceModal
                    isOpen={showComplianceModal}
                    onClose={() => setShowComplianceModal(false)}
                    offeredShift={selectedShift ? {
                        id: selectedShift.id,
                        shift_date: (selectedShift as any).shift_date,
                        start_time: (selectedShift as any).start_time,
                        end_time: (selectedShift as any).end_time,
                        unpaid_break_minutes: (selectedShift as any).unpaid_break_minutes,
                        role_name: selectedShift.roles?.name,
                        department_name: selectedShift.departments?.name,
                    } : null}
                    requesterShift={theirShift ? {
                        id: theirShift.id,
                        shift_date: theirShift.shift_date,
                        start_time: theirShift.start_time,
                        end_time: theirShift.end_time,
                        unpaid_break_minutes: theirShift.unpaid_break_minutes,
                    } : null}
                    requesterId={currentSwap?.requestorEmployee?.id || null}
                    requesterName={requesterName}
                    offererId={user?.id || null}
                    offererName={user?.user_metadata?.full_name || 'You'}
                    onConfirmOffer={handleConfirmFromComplianceModal}
                    isSubmitting={isSubmitting}
                />
            </DialogContent>
        </Dialog>
    );
};
