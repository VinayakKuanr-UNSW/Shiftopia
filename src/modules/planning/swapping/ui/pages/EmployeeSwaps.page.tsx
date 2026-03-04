import React, { useState, useCallback, useEffect } from 'react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Badge } from '@/modules/core/ui/primitives/badge';

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from '@/modules/core/ui/primitives/dialog';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import {
    ArrowLeftRight,
    Loader2,
    Eye,
    X,
    Clock,
    Calendar,
    Building2,
    CheckCircle2,
    XCircle,
    UserCheck,
    ShieldCheck,
    AlertTriangle,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useSwaps } from '../../state/useSwaps';
import { ShiftSwap, swapsApi } from '../../api/swaps.api';
import { format, differenceInMinutes, parse } from 'date-fns';
import { SYDNEY_TZ, parseZonedDateTime, formatInTimezone } from '@/modules/core/lib/date.utils';
import { ViewOffersModal } from '../components/ViewOffersModal';
import { OfferSwapModal } from '../components/OfferSwapModal';
import { useQuery } from '@tanstack/react-query';

import { ScopeFilterBanner } from '@/modules/core/ui/components/ScopeFilterBanner';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { FunctionBar } from '@/modules/core/ui/components/FunctionBar';
import { useMinuteTick } from '@/modules/core/hooks/useMinuteTick';

type TabType = 'my-swaps' | 'available-swaps';
type SortOption = 'date-soonest' | 'date-latest';

// Helper to format time
const formatTime = (time: string): string => {
    if (!time) return '';
    const [h, m] = time.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const display = h % 12 || 12;
    return `${display}:${m?.toString().padStart(2, '0') || '00'} ${period}`;
};

// Premium Department Color Styling (Badges)
function getDeptColor(groupType: string | null | undefined, dept: string): string {
    if (groupType === 'convention_centre' || dept.toLowerCase().includes('convention'))
        return 'dept-badge-convention';
    if (groupType === 'exhibition_centre' || dept.toLowerCase().includes('exhibition'))
        return 'dept-badge-exhibition';
    if (groupType === 'theatre' || dept.toLowerCase().includes('theatre'))
        return 'dept-badge-theatre';
    return 'dept-badge-default';
}

// Premium Card Background Styling — semantic CSS classes handle light/dark
function getCardBg(groupType: string | null | undefined, dept: string): string {
    const base = 'dept-card-base';
    if (groupType === 'convention_centre' || dept.toLowerCase().includes('convention'))
        return `${base} dept-card-convention`;
    if (groupType === 'exhibition_centre' || dept.toLowerCase().includes('exhibition'))
        return `${base} dept-card-exhibition`;
    if (groupType === 'theatre' || dept.toLowerCase().includes('theatre'))
        return `${base} dept-card-theatre`;
    return `${base} dept-card-default`;
}

// Status configuration with icons, colors, and labels
const getStatusConfig = (status: string) => {
    switch (status) {
        case 'OPEN':
            return {
                icon: Clock,
                label: 'Open',
                helperText: 'Awaiting offers',
                textColor: 'text-amber-400',
            };
        case 'MANAGER_PENDING':
            return {
                icon: UserCheck,
                label: 'Pending Manager',
                helperText: 'Awaiting approval',
                textColor: 'text-blue-400',
            };
        case 'APPROVED':
            return {
                icon: CheckCircle2,
                label: 'Approved',
                helperText: 'Approved',
                textColor: 'text-emerald-400',
            };
        case 'REJECTED':
            return {
                icon: XCircle,
                label: 'Rejected',
                helperText: 'Rejected',
                textColor: 'text-red-400',
            };
        case 'CANCELLED':
            return {
                icon: X,
                label: 'Cancelled',
                helperText: 'Cancelled',
                textColor: 'text-gray-400',
            };
        case 'EXPIRED':
            return {
                icon: Clock,
                label: 'Expired',
                helperText: 'Expired',
                textColor: 'text-gray-400',
            };
        default:
            return {
                icon: Clock,
                label: status,
                helperText: '',
                textColor: 'text-gray-400',
            };
    }
};

// Calculate countdown to shift close (4h before start) in Sydney timezone

// Helper to check if a swap is expired (4h before start)
export const getSwapTimer = (now: Date, startAt?: string, shiftDate?: string, startTime?: string, tzIdentifier?: string) => {
    if (!startAt && (!shiftDate || !startTime)) return null;

    // Safety: ensure startTime is only HH:mm if it contains seconds
    const cleanStartTime = startTime?.includes(':') ? startTime.split(':').slice(0, 2).join(':') : startTime;

    const shiftStartUtc = startAt
        ? new Date(startAt)
        : parseZonedDateTime(shiftDate as string, cleanStartTime as string, tzIdentifier || SYDNEY_TZ);

    if (isNaN(shiftStartUtc.getTime())) {
        console.warn('[Timer] Invalid shift start date/time:', { shiftDate, startTime, cleanStartTime });
        return null;
    }

    const closeTime = new Date(shiftStartUtc.getTime() - 4 * 60 * 60 * 1000); // 4 hours before
    const diffMs = closeTime.getTime() - now.getTime();

    if (diffMs <= 0) return 'Expired';

    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours > 0) {
        return `Expires in ${hours}h ${minutes}m`;
    }
    return `Expires in ${minutes}m`;
};

// Simplified check for styling
const isSwapExpired = (now: Date, startAt?: string, shiftDate?: string, startTime?: string, tzIdentifier?: string): boolean => {
    const timer = getSwapTimer(now, startAt, shiftDate, startTime, tzIdentifier);
    return timer === 'Expired';
};

export const EmployeeSwapsPage: React.FC = () => {
    const now = useMinuteTick();
    const { toast } = useToast();
    // Personal scope filter
    const { scope, setScope, isGammaLocked } = useScopeFilter('personal');

    const {
        mySwapRequests,
        availableSwaps,
        myActiveOfferSwapIds,
        isLoading,
        makeOffer,
        acceptOffer,
        declineOffer,
        cancelSwap,
        refetchMySwaps,
        refetchAvailable,
        isMakingOffer,
        isAccepting,
        isDeclining,
        isCancelling,
        userId,
    } = useSwaps({
        organizationId: scope.org_ids[0],
        departmentId: scope.dept_ids[0],
        subDepartmentId: scope.subdept_ids[0]
    });

    // §2 Combined State helper — derive C1-C7 from swap status
    const getCombinedState = (status: string): string => {
        switch (status) {
            case 'OPEN': return 'C2: S9/OPEN';
            case 'MANAGER_PENDING': return 'C3: S10/MGR_PENDING';
            case 'APPROVED': return 'C4: S4/APPROVED';
            case 'REJECTED': return 'C5: S4/REJECTED';
            case 'CANCELLED': return 'C6: S4/CANCELLED';
            case 'EXPIRED': return 'C7: S4/EXPIRED';
            default: return `?/${status}`;
        }
    };

    // State
    const [activeTab, setActiveTab] = useState<TabType>('my-swaps');
    const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
    const [sortOption, setSortOption] = useState<SortOption>('date-soonest');
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Modal State
    const [offerSwapTarget, setOfferSwapTarget] = useState<ShiftSwap | null>(null);
    const [viewOffersSwapId, setViewOffersSwapId] = useState<string | null>(null);

    // Confirmation dialog state
    const [confirmDialog, setConfirmDialog] = useState<{
        isOpen: boolean;
        swap: ShiftSwap | null;
    }>({
        isOpen: false,
        swap: null,
    });

    // Handle refresh
    const handleRefresh = useCallback(async () => {
        setIsRefreshing(true);
        await Promise.all([refetchMySwaps(), refetchAvailable()]);
        setIsRefreshing(false);
        toast({
            title: 'Refreshed',
            description: 'Swap requests have been updated.',
        });
    }, [refetchMySwaps, refetchAvailable, toast]);

    // Handle Make Offer Confirmation
    const handleMakeOffer = (targetShiftId: string | undefined) => {
        if (offerSwapTarget) {
            makeOffer({ swapId: offerSwapTarget.id, targetShiftId });
            setOfferSwapTarget(null);
        }
    };

    // Confirm cancel
    const confirmCancel = useCallback(() => {
        if (confirmDialog.swap) {
            cancelSwap(confirmDialog.swap.id);
            setConfirmDialog({ isOpen: false, swap: null });
        }
    }, [confirmDialog, cancelSwap]);

    // 1. Manager Review Swaps — includes requests I created AND swaps where I offered
    const managerReviewSwaps = mySwapRequests.filter(s => s.status === 'MANAGER_PENDING');

    // 2. Filter my swap requests (Consolidated View)
    //    Include: OPEN, MANAGER_PENDING, APPROVED, REJECTED, CANCELLED, EXPIRED
    //    Where I am the requester.
    const filteredMySwaps = mySwapRequests
        .filter((swap) => {
            // Only show swaps I created
            if (swap.requester_id !== userId) return false;

            return true;
        })
        .sort((a, b) => {
            const dateA = (a as any).requester_shift?.start_at ? new Date((a as any).requester_shift.start_at) : (a.requester_shift?.shift_date ? parse(a.requester_shift.shift_date, 'yyyy-MM-dd', new Date()) : new Date(a.created_at));
            const dateB = (b as any).requester_shift?.start_at ? new Date((b as any).requester_shift.start_at) : (b.requester_shift?.shift_date ? parse(b.requester_shift.shift_date, 'yyyy-MM-dd', new Date()) : new Date(b.created_at));
            return sortOption === 'date-soonest'
                ? dateA.getTime() - dateB.getTime()
                : dateB.getTime() - dateA.getTime();
        });

    // 3. Filter available swaps
    const filteredAvailableSwaps = availableSwaps.filter((swap) => {
        // Exclude my own swaps (just safety check, hook likely handles API filter)
        if (swap.requester_id === userId) return false;

        // Exclude if already pending manager (not open for offers anymore)
        if (swap.status === 'MANAGER_PENDING') return false;

        return true;
    }).sort((a, b) => {
        const dateA = (a as any).requester_shift?.start_at ? new Date((a as any).requester_shift.start_at) : ((a as any).requester_shift?.shift_date ? parse((a as any).requester_shift.shift_date, 'yyyy-MM-dd', new Date()) : new Date(0));
        const dateB = (b as any).requester_shift?.start_at ? new Date((b as any).requester_shift.start_at) : ((b as any).requester_shift?.shift_date ? parse((b as any).requester_shift.shift_date, 'yyyy-MM-dd', new Date()) : new Date(0));
        return sortOption === 'date-soonest' ? dateA.getTime() - dateB.getTime() : dateB.getTime() - dateA.getTime();
    });



    // Render swap card for "My Requests" and "Manager Review" tab
    const renderMySwapCard = (swap: ShiftSwap) => {
        const shift = (swap as any).requester_shift;
        const statusConfig = getStatusConfig(swap.status);
        const StatusIcon = statusConfig.icon;
        const timerText = getSwapTimer(now, shift?.start_at, shift?.shift_date, shift?.start_time, shift?.tz_identifier);

        const isExpired = timerText === 'Expired';

        return (
            <div
                key={swap.id}
                className={cn(
                    getCardBg(shift?.group_type, shift?.departments?.name || ''),
                    "flex flex-col h-full rounded-xl transition-all duration-300",
                    isExpired && "opacity-60 grayscale-[0.8] hover:grayscale-0 hover:opacity-90"
                )}
            >
                {/* HEADER ZONE */}
                <div className="px-4 py-3 border-b border-slate-200/60 dark:border-white/5 bg-slate-50/80 dark:bg-black/20 backdrop-blur-sm">
                    <div className="flex items-center justify-between gap-2">
                        <div className={cn("flex items-center gap-1.5", statusConfig.textColor)}>
                            <StatusIcon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                            <span className="text-xs font-bold uppercase tracking-wide">{statusConfig.label}</span>
                        </div>
                        <h3 className="font-bold text-sm text-slate-900 dark:text-white/90 truncate">
                            {shift?.roles?.name || 'Shift'}
                        </h3>
                    </div>
                </div>

                {/* BODY ZONE */}
                <div className="px-4 py-4 flex-1 space-y-3">
                    {/* Department */}
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Building2 className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                        <span>{shift?.departments?.name || 'Department'} • {shift?.sub_departments?.name || 'General'}</span>
                    </div>

                    {/* Date */}
                    <div className="flex items-center gap-2 text-sm text-foreground">
                        <Calendar className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span>{shift?.start_at ? formatInTimezone(new Date(shift.start_at), shift.tz_identifier || SYDNEY_TZ, 'EEEE, MMM d, yyyy') : (shift?.shift_date ? format(parse(shift.shift_date, 'yyyy-MM-dd', new Date()), 'EEEE, MMM d, yyyy') : 'Unknown date')}</span>
                    </div>

                    {/* Time */}
                    <div className="flex items-center gap-2 text-sm text-foreground">
                        <Clock className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span>{shift?.start_at ? formatInTimezone(new Date(shift.start_at), shift.tz_identifier || SYDNEY_TZ, 'HH:mm') : formatTime(shift?.start_time || '')} - {shift?.end_at ? formatInTimezone(new Date(shift.end_at), shift.tz_identifier || SYDNEY_TZ, 'HH:mm') : formatTime(shift?.end_time || '')}</span>
                    </div>

                    {timerText && (
                        <div className={cn(
                            "flex items-center gap-2 text-xs px-2 py-1 rounded-md w-fit font-bold",
                            isExpired ? "bg-red-50 dark:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/30" : "bg-purple-50 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-500/30"
                        )}>
                            <Clock className="h-3 w-3" aria-hidden="true" />
                            <span>{timerText}</span>
                        </div>
                    )}

                    {/* Compliance Indicators */}
                    <div className="flex items-center gap-3 text-xs">
                        <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                            <span>Compliant</span>
                        </div>
                    </div>

                    {/* Helper Text */}
                    {statusConfig.helperText && swap.status === 'OPEN' && (
                        <p className="text-xs text-amber-500/80 italic mt-2">
                            {statusConfig.helperText}
                        </p>
                    )}
                </div>

                {/* FOOTER ZONE */}
                <div className="px-4 py-3 border-t border-slate-200/60 dark:border-white/5 bg-slate-50/60 dark:bg-slate-900/30 space-y-2">
                    {/* Logic: Show options based on ownership and status */}
                    {swap.requester_id === userId ? (
                        // I am the REQUESTER
                        (swap.status === 'OPEN') && (
                            <SwapCardOfferButton swapId={swap.id} onClick={() => setViewOffersSwapId(swap.id)} />
                        )
                    ) : (
                        // I am the OFFERER (or it's a manager review, but manager tab handles that separate)
                        // If I offered, I want to see status.
                        // For now, if status is pending, show "Offer Sent"
                        (swap.status === 'OPEN') && (
                            <div className="w-full h-11 flex items-center justify-center bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-sm text-foreground">
                                <CheckCircle2 className="h-4 w-4 mr-2 text-emerald-500" />
                                Offer Sent
                            </div>
                        )
                    )}

                    {(swap.status === 'OPEN' || swap.status === 'MANAGER_PENDING') && (
                        <div className="flex items-center justify-between gap-2">
                            {swap.status === 'MANAGER_PENDING' && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="flex-1 h-11"
                                    onClick={() => setViewOffersSwapId(swap.id)}
                                >
                                    <Eye className="h-4 w-4 mr-2" aria-hidden="true" />
                                    View Details
                                </Button>
                            )}

                            <Button
                                variant="ghost"
                                size="sm"
                                className={cn(
                                    "text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10 h-11",
                                    swap.status === 'OPEN' ? 'flex-1' : 'flex-1'
                                )}
                                onClick={() => setConfirmDialog({ isOpen: true, swap })}
                                disabled={isCancelling || swap.status === 'MANAGER_PENDING'}
                            >
                                <X className="h-4 w-4 mr-2" aria-hidden="true" />
                                Cancel Request
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // Render available swap card
    const renderAvailableSwapCard = (swap: ShiftSwap) => {
        const shift = (swap as any).requester_shift;
        const requesterName = (swap as any).requested_by?.full_name || (swap as any).requested_by?.email || 'Unknown Employee';
        const timerText = getSwapTimer(now, shift?.start_at, shift?.shift_date, shift?.start_time, shift?.tz_identifier);
        const isExpired = timerText === 'Expired';

        return (
            <div
                key={swap.id}
                className={cn(
                    getCardBg(shift?.group_type, shift?.departments?.name || ''),
                    "flex flex-col h-full rounded-xl transition-all duration-300",
                    isExpired && "opacity-60 grayscale-[0.8] hover:grayscale-0 hover:opacity-90"
                )}
            >
                {/* HEADER ZONE */}
                <div className="px-4 py-3 border-b border-slate-200/60 dark:border-white/5 bg-slate-50/80 dark:bg-black/20 backdrop-blur-sm">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px] bg-slate-100 dark:bg-white/5 border-slate-300 dark:border-white/10 text-slate-600 dark:text-white/70">
                                {myActiveOfferSwapIds.has(swap.id) ? '✓ Offered' : 'Swap Available'}
                            </Badge>
                        </div>
                        <h3 className="font-bold text-sm text-slate-900 dark:text-white/90 truncate">
                            {shift?.roles?.name || 'Shift'}
                        </h3>
                    </div>
                </div>

                {/* BODY ZONE */}
                <div className="px-4 py-4 flex-1 space-y-3">
                    {/* Department */}
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Building2 className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                        <span>{shift?.departments?.name || 'Department'}</span>
                    </div>

                    {/* Date */}
                    <div className="flex items-center gap-2 text-sm text-foreground">
                        <Calendar className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span>{shift?.start_at ? formatInTimezone(new Date(shift.start_at), shift.tz_identifier || SYDNEY_TZ, 'EEE, MMM d') : (shift?.shift_date ? format(parse(shift.shift_date, 'yyyy-MM-dd', new Date()), 'EEE, MMM d') : 'Unknown')}</span>
                    </div>

                    {/* Time */}
                    <div className="flex items-center gap-2 text-sm text-foreground">
                        <Clock className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span>{shift?.start_at ? formatInTimezone(new Date(shift.start_at), shift.tz_identifier || SYDNEY_TZ, 'HH:mm') : formatTime(shift?.start_time || '')} - {shift?.end_at ? formatInTimezone(new Date(shift.end_at), shift.tz_identifier || SYDNEY_TZ, 'HH:mm') : formatTime(shift?.end_time || '')}</span>
                    </div>

                    {/* Posted By */}
                    <div className="text-xs text-muted-foreground">
                        Posted by <span className="text-foreground">{requesterName}</span>
                    </div>

                    {timerText && (
                        <div className={cn(
                            "flex items-center gap-2 text-xs px-2 py-1 rounded-md w-fit font-bold",
                            isExpired ? "bg-red-50 dark:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/30" : "bg-purple-50 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-500/30"
                        )}>
                            <Clock className="h-3 w-3" aria-hidden="true" />
                            <span>{timerText}</span>
                        </div>
                    )}
                </div>

                {/* FOOTER ZONE */}
                <div className="px-4 py-3 border-t border-slate-200/60 dark:border-white/5 bg-slate-50/60 dark:bg-slate-900/30">
                    {myActiveOfferSwapIds.has(swap.id) ? (
                        <div className="w-full h-11 flex items-center justify-center bg-emerald-50 dark:bg-slate-800 border border-emerald-200 dark:border-emerald-500/30 rounded-md text-sm text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="h-4 w-4 mr-2" aria-hidden="true" />
                            Offer Sent
                        </div>
                    ) : (
                        <Button
                            className="w-full h-11"
                            onClick={() => setOfferSwapTarget(swap)}
                            disabled={isMakingOffer || isExpired}
                            variant={isExpired ? "outline" : "default"}
                        >
                            {isExpired ? (
                                <>
                                    <Clock className="h-4 w-4 mr-2" aria-hidden="true" />
                                    Expired
                                </>
                            ) : (
                                <>
                                    <ArrowLeftRight className="h-4 w-4 mr-2" aria-hidden="true" />
                                    Make Offer
                                </>
                            )}
                        </Button>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="w-full text-foreground">


            {/* Scope Filter */}
            <ScopeFilterBanner
                mode="personal"
                onScopeChange={setScope}
                hidden={isGammaLocked}
                className="mb-6"
            />

            {/* Function Bar */}
            <FunctionBar
                tabs={[
                    { id: 'my-swaps', label: 'My Swaps', count: filteredMySwaps.length },
                    { id: 'available-swaps', label: 'Available Swaps', count: filteredAvailableSwaps.length }
                ]}
                activeTab={activeTab}
                onTabChange={(id) => setActiveTab(id as any)}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                onRefresh={handleRefresh}
                className="mb-6"
            />

            {/* Info Banner */}
            {activeTab === 'available-swaps' && (
                <div className="relative mb-6 overflow-hidden rounded-xl border-l-[3px] border-l-purple-500 bg-gradient-to-r from-purple-50 dark:from-purple-500/10 via-purple-50/50 dark:via-purple-900/5 to-transparent p-4 backdrop-blur-sm">
                    <div className="flex items-start gap-3">
                        <div className="rounded-full bg-purple-100 dark:bg-purple-500/20 p-1.5 ring-1 ring-purple-200 dark:ring-purple-500/30">
                            <ArrowLeftRight className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                        </div>
                        <div className="space-y-1">
                            <h4 className="text-sm font-medium text-purple-700 dark:text-purple-200">Shift Swaps</h4>
                            <p className="text-sm text-purple-600/80 dark:text-purple-200/70 leading-relaxed max-w-2xl">
                                Browse available swaps from colleagues or manage your own swap requests.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Content */}
            {isLoading ? (
                <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
                    <span className="ml-2 text-muted-foreground">Loading swaps...</span>
                </div>
            ) : activeTab === 'my-swaps' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredMySwaps.length === 0 ? (
                        <div className="col-span-full py-12 text-center">
                            <div className="mx-auto w-12 h-12 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center mb-4">
                                <ArrowLeftRight className="h-6 w-6 text-slate-300 dark:text-white/20" />
                            </div>
                            <h3 className="text-lg font-medium text-slate-400 dark:text-white/50">No swap requests found</h3>
                            <p className="text-sm text-slate-400/70 dark:text-white/30 mt-1">Create a swap request from your roster to get started.</p>
                        </div>
                    ) : (
                        filteredMySwaps.map(renderMySwapCard)
                    )}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredAvailableSwaps.length === 0 ? (
                        <div className="col-span-full py-12 text-center">
                            <div className="mx-auto w-12 h-12 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center mb-4">
                                <ArrowLeftRight className="h-6 w-6 text-slate-300 dark:text-white/20" />
                            </div>
                            <h3 className="text-lg font-medium text-slate-400 dark:text-white/50">No available swaps</h3>
                            <p className="text-sm text-slate-400/70 dark:text-white/30 mt-1">Check back later for opportunities.</p>
                        </div>
                    ) : (
                        filteredAvailableSwaps.map(renderAvailableSwapCard)
                    )}
                </div>
            )}

            {/* Modals */}
            <OfferSwapModal
                isOpen={!!offerSwapTarget}
                onClose={() => setOfferSwapTarget(null)}
                onConfirmOffer={handleMakeOffer}
                isSubmitting={isMakingOffer}
                swapId={offerSwapTarget?.id || ''}
            />

            <ViewOffersModal
                isOpen={!!viewOffersSwapId}
                onClose={() => setViewOffersSwapId(null)}
                swapResquestId={viewOffersSwapId || ''}
                onAccept={(offer) => {
                    acceptOffer({
                        swapId: offer.swap_request_id,
                        offerId: offer.id,
                        offererId: offer.offerer_id,
                        offeredShiftId: offer.offered_shift_id
                    });
                    setViewOffersSwapId(null);
                }}
                onDecline={(offerId) => declineOffer(offerId)}
                isAccepting={isAccepting}
                isDeclining={isDeclining}
            />

            {/* Cancel Confirmation Dialog */}
            <Dialog
                open={confirmDialog.isOpen}
                onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, isOpen: open }))}
            >
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden="true" />
                            Cancel Request
                        </DialogTitle>
                        <DialogDescription>
                            Are you sure you want to cancel this swap request? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="flex gap-2 mt-4">
                        <Button
                            variant="outline"
                            onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
                            className="flex-1 h-11"
                        >
                            Go Back
                        </Button>
                        <Button
                            onClick={confirmCancel}
                            className="flex-1 h-11 bg-destructive hover:bg-destructive/90"
                        >
                            Yes, Cancel
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

// Sub-component for View Offers button with count
const SwapCardOfferButton: React.FC<{ swapId: string; onClick: () => void }> = ({ swapId, onClick }) => {
    const { data: offers, isLoading } = useQuery({
        queryKey: ['swapOffers', swapId],
        queryFn: () => swapsApi.getSwapOffers(swapId),
    });

    const pendingCount = offers?.filter(o => o.status === 'SUBMITTED').length || 0;

    return (
        <Button
            variant={pendingCount > 0 ? 'default' : 'outline'}
            size="sm"
            className="w-full h-11"
            onClick={onClick}
            disabled={isLoading}
        >
            <Eye className="h-4 w-4 mr-2" aria-hidden="true" />
            {isLoading ? (
                'Loading...'
            ) : pendingCount > 0 ? (
                `View Offers (${pendingCount})`
            ) : (
                'No Offers Yet'
            )}
        </Button>
    );
};

// Empty State Component
const EmptyState: React.FC<{
    icon: React.ElementType;
    title: string;
    description: string;
}> = ({ icon: Icon, title, description }) => (
    <div className="text-center py-16 bg-slate-100/60 dark:bg-slate-800/30 rounded-xl border border-slate-200 dark:border-slate-700">
        <Icon className="h-12 w-12 text-muted-foreground mx-auto mb-4" aria-hidden="true" />
        <h3 className="text-lg font-medium text-foreground mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">{description}</p>
    </div>
);

export default EmployeeSwapsPage;
