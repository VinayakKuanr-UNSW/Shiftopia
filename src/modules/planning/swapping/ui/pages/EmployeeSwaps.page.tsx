import React, { useState, useCallback, useEffect } from 'react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Badge } from '@/modules/core/ui/primitives/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/modules/core/ui/primitives/select';
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
    Search,
    Filter,
    RefreshCw,
    SortAsc,
    AlertTriangle,
    Loader2,
    Eye,
    X,
    Clock,
    Calendar,
    Building2,
    CheckCircle2,
    XCircle,
    Timer,
    UserCheck,
    ShieldCheck,
    Plus,
    AlertCircle,
} from 'lucide-react';
import { Switch } from '@/modules/core/ui/primitives/switch';
import { Label } from '@/modules/core/ui/primitives/label';
import { cn } from '@/modules/core/lib/utils';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useSwaps } from '../../state/useSwaps';
import { ShiftSwap, swapsApi } from '../../api/swaps.api';
import { format, differenceInMinutes } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { ViewOffersModal } from '../components/ViewOffersModal';
import { OfferSwapModal } from '../components/OfferSwapModal';
import { useQuery } from '@tanstack/react-query';

import { ScopeFilterBanner } from '@/modules/core/ui/components/ScopeFilterBanner';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';

type TabType = 'my-requests' | 'requests-to-review' | 'manager-review';
type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'cancelled';
type SortOption = 'date-soonest' | 'date-latest';

// Helper to format time
const formatTime = (time: string): string => {
    if (!time) return '';
    const [h, m] = time.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const display = h % 12 || 12;
    return `${display}:${m?.toString().padStart(2, '0') || '00'} ${period}`;
};

// Status configuration with icons, colors, and labels
const getStatusConfig = (status: string) => {
    switch (status) {
        case 'OPEN':
            return {
                icon: Timer,
                label: 'Open for Offers',
                helperText: 'Awaiting offers from colleagues',
                bgColor: 'bg-amber-500/10',
                borderColor: 'border-amber-500/30',
                textColor: 'text-amber-500',
                iconColor: 'text-amber-500',
            };
        case 'MANAGER_PENDING':
            return {
                icon: UserCheck,
                label: 'Pending Manager',
                helperText: 'Awaiting manager approval',
                bgColor: 'bg-blue-500/10',
                borderColor: 'border-blue-500/30',
                textColor: 'text-blue-500',
                iconColor: 'text-blue-500',
            };
        case 'APPROVED':
            return {
                icon: CheckCircle2,
                label: 'Approved',
                helperText: 'Swap has been approved',
                bgColor: 'bg-emerald-500/10',
                borderColor: 'border-emerald-500/30',
                textColor: 'text-emerald-500',
                iconColor: 'text-emerald-500',
            };
        case 'REJECTED':
            return {
                icon: XCircle,
                label: 'Rejected',
                helperText: 'Request was rejected',
                bgColor: 'bg-red-500/10',
                borderColor: 'border-red-500/30',
                textColor: 'text-red-500',
                iconColor: 'text-red-500',
            };
        case 'CANCELLED':
            return {
                icon: X,
                label: 'Cancelled',
                helperText: 'Request was cancelled',
                bgColor: 'bg-gray-500/10',
                borderColor: 'border-gray-500/30',
                textColor: 'text-gray-500',
                iconColor: 'text-gray-500',
            };
        case 'EXPIRED':
            return {
                icon: Clock,
                label: 'Expired',
                helperText: 'Request expired',
                bgColor: 'bg-gray-500/10',
                borderColor: 'border-gray-500/30',
                textColor: 'text-gray-500',
                iconColor: 'text-gray-500',
            };
        default:
            return {
                icon: Clock,
                label: status.replace('_', ' '),
                helperText: '',
                bgColor: 'bg-gray-500/10',
                borderColor: 'border-gray-500/30',
                textColor: 'text-gray-500',
                iconColor: 'text-gray-500',
            };
    }
};

// Calculate countdown to shift close (4h before start) in Sydney timezone
const SYDNEY_TZ = 'Australia/Sydney';

const getCountdown = (shiftDate: string, startTime: string) => {
    if (!shiftDate || !startTime) return null;

    // Parse shift time as Sydney time
    const shiftStartUtc = new Date(`${shiftDate}T${startTime}`);
    const nowInSydney = toZonedTime(new Date(), SYDNEY_TZ);
    const closeTime = new Date(shiftStartUtc.getTime() - 4 * 60 * 60 * 1000); // 4 hours before

    if (nowInSydney >= closeTime) return { text: 'Closed', isUrgent: true, isClosed: true };

    const minutesLeft = differenceInMinutes(closeTime, nowInSydney);
    const hoursLeft = Math.floor(minutesLeft / 60);
    const mins = minutesLeft % 60;

    const isUrgent = minutesLeft <= 30;

    if (hoursLeft > 24) {
        const days = Math.floor(hoursLeft / 24);
        return { text: `Closes in ${days}d ${hoursLeft % 24}h`, isUrgent: false, isClosed: false };
    }

    return {
        text: `Closes in ${hoursLeft}h ${mins}m`,
        isUrgent,
        isClosed: false
    };
};

export const EmployeeSwapsPage: React.FC = () => {
    const { toast } = useToast();
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
    } = useSwaps();

    // Personal scope filter
    const { scope, setScope, isGammaLocked } = useScopeFilter('personal');

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
    const [activeTab, setActiveTab] = useState<TabType>('my-requests');
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [sortOption, setSortOption] = useState<SortOption>('date-soonest');
    const [showHistory, setShowHistory] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [, setTick] = useState(0); // For countdown refresh

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

    // Refresh countdown every minute
    useEffect(() => {
        const interval = setInterval(() => setTick(t => t + 1), 60000);
        return () => clearInterval(interval);
    }, []);

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

    // 2. Filter my swap requests (Excluding Manager Review items)
    //    Issue 2 fix: Only show swaps I CREATED in "My Requests" tab.
    //    Swaps I only offered on stay in Available Swaps with "Offered ✓".
    const filteredMySwaps = mySwapRequests
        .filter((swap) => {
            // Only show swaps I created (requester) — offers go to Available tab
            // Only show swaps I created (requester) — offers to others go to Available tab (while active)
            // In HISTORY mode, show everything.
            if (activeTab === 'my-requests' && !showHistory && swap.requester_id !== userId) return false;

            // Exclude MANAGER_PENDING from My Requests to avoid duplication with Manager Review tab
            if (activeTab === 'my-requests' && swap.status === 'MANAGER_PENDING') return false;

            // TOGGLE LOGIC: History vs Active
            const isHistoryStatus = ['APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED'].includes(swap.status);

            if (activeTab === 'my-requests') {
                if (showHistory) {
                    // Show ONLY history items
                    if (!isHistoryStatus) return false;
                } else {
                    // Show ONLY active items (OPEN)
                    // Note: MANAGER_PENDING is already excluded above
                    if (isHistoryStatus) return false;
                }
            }

            if (statusFilter === 'all' && swap.status === 'CANCELLED' && !showHistory) return false;

            if (statusFilter === 'pending') {
                return swap.status === 'OPEN';
            }

            if (statusFilter !== 'all' && swap.status !== statusFilter) return false;

            if (searchQuery) {
                const query = searchQuery.toLowerCase();
                const role = (swap as any).requester_shift?.roles?.name || '';
                const dept = (swap as any).requester_shift?.departments?.name || '';
                return role.toLowerCase().includes(query) || dept.toLowerCase().includes(query);
            }
            return true;
        })
        .sort((a, b) => {
            const dateA = new Date((a as any).requester_shift?.shift_date || a.created_at);
            const dateB = new Date((b as any).requester_shift?.shift_date || b.created_at);
            return sortOption === 'date-soonest'
                ? dateA.getTime() - dateB.getTime()
                : dateB.getTime() - dateA.getTime();
        });

    // 3. Filter available swaps (Excluding pending_manager)
    const filteredAvailableSwaps = availableSwaps.filter((swap) => {
        if (swap.status === 'MANAGER_PENDING') return false;

        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            const role = (swap as any).requester_shift?.roles?.name || '';
            const dept = (swap as any).requester_shift?.departments?.name || '';
            const name = (swap as any).requested_by?.full_name || (swap as any).requested_by?.email || 'Unknown Employee';
            return role.toLowerCase().includes(query) ||
                dept.toLowerCase().includes(query) ||
                name.toLowerCase().includes(query);
        }
        return true;
    });

    const myRequestsCount = mySwapRequests.filter(s => s.requester_id === userId && s.status === 'OPEN').length;
    const availableCount = availableSwaps.length;
    const managerReviewCount = managerReviewSwaps.length;

    // Render swap card for "My Requests" and "Manager Review" tab
    const renderMySwapCard = (swap: ShiftSwap) => {
        const shift = (swap as any).requester_shift;
        const statusConfig = getStatusConfig(swap.status);
        const StatusIcon = statusConfig.icon;
        const countdown = getCountdown(shift?.shift_date || '', shift?.start_time || '');

        return (
            <div
                key={swap.id}
                className={cn(
                    "bg-slate-800/50 border rounded-xl overflow-hidden flex flex-col h-full",
                    statusConfig.borderColor
                )}
            >
                {/* HEADER ZONE */}
                <div className={cn("px-4 py-3 border-b border-white/5", statusConfig.bgColor)}>
                    <div className="flex items-center justify-between gap-2">
                        <div className={cn("flex items-center gap-2", statusConfig.textColor)}>
                            <StatusIcon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                            <span className="text-sm font-medium">{statusConfig.label}</span>
                        </div>
                        <h3 className="font-bold text-base text-foreground truncate">
                            {shift?.roles?.name || 'Shift'}
                        </h3>
                    </div>
                    {/* §2 State Debug Label */}
                    <Badge variant="outline" className="mt-1 text-[10px] font-mono opacity-60">
                        {getCombinedState(swap.status)}
                    </Badge>
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
                        <span>{shift?.shift_date ? format(new Date(shift.shift_date), 'EEEE, MMM d, yyyy') : 'Unknown date'}</span>
                    </div>

                    {/* Time */}
                    <div className="flex items-center gap-2 text-sm text-foreground">
                        <Clock className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span>{formatTime(shift?.start_time || '')} - {formatTime(shift?.end_time || '')}</span>
                    </div>

                    {/* Countdown Timer */}
                    {countdown && !countdown.isClosed && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className={cn(
                                    "flex items-center gap-2 text-xs px-2 py-1 rounded-md w-fit",
                                    countdown.isUrgent
                                        ? "bg-red-500/10 text-red-400"
                                        : "bg-muted text-muted-foreground"
                                )}>
                                    <Timer className="h-3 w-3" aria-hidden="true" />
                                    <span>{countdown.text}</span>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>Swaps close 4 hours before shift start</p>
                            </TooltipContent>
                        </Tooltip>
                    )}

                    {countdown?.isClosed && (
                        <div className="flex items-center gap-2 text-xs px-2 py-1 rounded-md w-fit bg-red-500/10 text-red-400">
                            <XCircle className="h-3 w-3" aria-hidden="true" />
                            <span>Swap window closed</span>
                        </div>
                    )}

                    {/* Compliance Indicators */}
                    <div className="flex items-center gap-3 text-xs">
                        <div className="flex items-center gap-1 text-emerald-500">
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
                <div className="px-4 py-3 border-t border-white/5 bg-slate-900/30 space-y-2">
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
                            <div className="w-full h-11 flex items-center justify-center bg-slate-800 border border-slate-700 rounded-md text-sm text-foreground">
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
                                    "text-red-400 hover:text-red-300 hover:bg-red-500/10 h-11",
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
        const countdown = getCountdown(shift?.shift_date || '', shift?.start_time || '');

        return (
            <div
                key={swap.id}
                className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden flex flex-col h-full"
            >
                {/* HEADER ZONE */}
                <div className="px-4 py-3 border-b border-white/5 bg-slate-700/30">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                                {myActiveOfferSwapIds.has(swap.id) ? '✓ Offered' : 'Swap Available'}
                            </Badge>
                        </div>
                        <h3 className="font-bold text-base text-foreground truncate">
                            {shift?.roles?.name || 'Shift'}
                        </h3>
                    </div>
                    {/* §2 State Debug Label */}
                    <Badge variant="outline" className="mt-1 text-[10px] font-mono opacity-60">
                        {getCombinedState(swap.status)}
                    </Badge>
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
                        <span>{shift?.shift_date ? format(new Date(shift.shift_date), 'EEE, MMM d') : 'Unknown'}</span>
                    </div>

                    {/* Time */}
                    <div className="flex items-center gap-2 text-sm text-foreground">
                        <Clock className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span>{formatTime(shift?.start_time || '')} - {formatTime(shift?.end_time || '')}</span>
                    </div>

                    {/* Countdown Timer */}
                    {countdown && !countdown.isClosed && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className={cn(
                                    "flex items-center gap-2 text-xs px-2 py-1 rounded-md w-fit",
                                    countdown.isUrgent
                                        ? "bg-red-500/10 text-red-400"
                                        : "bg-muted text-muted-foreground"
                                )}>
                                    <Timer className="h-3 w-3" aria-hidden="true" />
                                    <span>{countdown.text}</span>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>Swaps close 4 hours before shift start</p>
                            </TooltipContent>
                        </Tooltip>
                    )}

                    {/* Posted By */}
                    <div className="text-xs text-muted-foreground">
                        Posted by <span className="text-foreground">{requesterName}</span>
                    </div>
                </div>

                {/* FOOTER ZONE */}
                <div className="px-4 py-3 border-t border-white/5 bg-slate-900/30">
                    {myActiveOfferSwapIds.has(swap.id) ? (
                        <div className="flex items-center gap-2 w-full">
                            <div className="flex-1 h-11 flex items-center justify-center bg-slate-800 border border-emerald-500/30 rounded-md text-sm text-emerald-400">
                                <CheckCircle2 className="h-4 w-4 mr-2" aria-hidden="true" />
                                Offer Sent
                            </div>
                            <Button
                                variant="outline"
                                className="h-11 px-4 border-dashed border-slate-600 hover:border-primary hover:text-primary"
                                onClick={() => setOfferSwapTarget(swap)}
                                disabled={isMakingOffer || countdown?.isClosed}
                                title="Make another offer"
                            >
                                <Plus className="h-5 w-5" />
                            </Button>
                        </div>
                    ) : (
                        <Button
                            className="w-full h-11"
                            onClick={() => setOfferSwapTarget(swap)}
                            disabled={isMakingOffer || countdown?.isClosed}
                        >
                            <ArrowLeftRight className="h-4 w-4 mr-2" aria-hidden="true" />
                            Make Offer
                        </Button>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className="max-w-7xl mx-auto p-4 md:p-6">


                {/* Scope Filter */}
                <ScopeFilterBanner
                    mode="personal"
                    onScopeChange={setScope}
                    hidden={isGammaLocked}
                    className="mb-6"
                />

                {/* Refresh Button */}
                <div className="flex justify-end mb-4">
                    <Button
                        variant="outline"
                        onClick={handleRefresh}
                        disabled={isRefreshing}
                        className="h-11 px-4"
                    >
                        <RefreshCw className={cn('h-4 w-4 mr-2', isRefreshing && 'animate-spin')} aria-hidden="true" />
                        Refresh Data
                    </Button>
                </div>

                {/* Tabs */}
                <div className="flex flex-wrap items-center gap-2 mb-6">
                    <button
                        onClick={() => setActiveTab('my-requests')}
                        className={cn(
                            'px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-200 min-h-[44px]',
                            activeTab === 'my-requests'
                                ? 'bg-primary text-primary-foreground shadow-lg'
                                : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
                        )}
                    >
                        My Swaps
                        {myRequestsCount > 0 && (
                            <Badge className="ml-2 bg-primary-foreground/20 text-primary-foreground text-[10px]">
                                {myRequestsCount}
                            </Badge>
                        )}
                    </button>
                    <button
                        onClick={() => setActiveTab('requests-to-review')}
                        className={cn(
                            'px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-200 min-h-[44px]',
                            activeTab === 'requests-to-review'
                                ? 'bg-primary text-primary-foreground shadow-lg'
                                : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
                        )}
                    >
                        Available Swaps
                        {availableCount > 0 && (
                            <Badge className="ml-2 bg-primary-foreground/20 text-primary-foreground text-[10px]">
                                {availableCount}
                            </Badge>
                        )}
                    </button>
                    <button
                        onClick={() => setActiveTab('manager-review')}
                        className={cn(
                            'px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-200 min-h-[44px]',
                            activeTab === 'manager-review'
                                ? 'bg-primary text-primary-foreground shadow-lg'
                                : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
                        )}
                    >
                        Manager Review
                        {managerReviewCount > 0 && (
                            <Badge className="ml-2 bg-primary-foreground/20 text-primary-foreground text-[10px]">
                                {managerReviewCount}
                            </Badge>
                        )}
                    </button>
                </div>

                {/* Filters */}
                <div className="flex flex-col sm:flex-row gap-3 mb-6">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        <Input
                            placeholder="Search by role, department..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-10 h-11"
                            aria-label="Search swaps"
                        />
                    </div>

                    {activeTab === 'my-requests' && (
                        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                            <SelectTrigger className="w-[180px] h-11">
                                <Filter className="h-4 w-4 mr-2 text-muted-foreground" aria-hidden="true" />
                                <SelectValue placeholder="Filter by Status" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Status</SelectItem>
                                <SelectItem value="pending">Pending</SelectItem>
                                <SelectItem value="approved">Approved</SelectItem>
                                <SelectItem value="rejected">Rejected</SelectItem>
                                <SelectItem value="cancelled">Cancelled</SelectItem>
                            </SelectContent>
                        </Select>
                    )}

                    <div className="flex items-center space-x-2">
                        <Switch
                            id="show-history"
                            checked={showHistory}
                            onCheckedChange={setShowHistory}
                        />
                        <Label htmlFor="show-history" className="whitespace-nowrap">Show History</Label>
                    </div>

                    <Select value={sortOption} onValueChange={(v) => setSortOption(v as SortOption)}>
                        <SelectTrigger className="w-[180px] h-11">
                            <SortAsc className="h-4 w-4 mr-2 text-muted-foreground" aria-hidden="true" />
                            <SelectValue placeholder="Sort by" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="date-soonest">Date (Soonest)</SelectItem>
                            <SelectItem value="date-latest">Date (Latest)</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {/* Content */}
                {isLoading ? (
                    <div className="flex items-center justify-center py-16">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
                        <span className="ml-2 text-muted-foreground">Loading swaps...</span>
                    </div>
                ) : activeTab === 'manager-review' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {managerReviewSwaps.length === 0 ? (
                            <div className="col-span-full">
                                <EmptyState
                                    icon={UserCheck}
                                    title="No swaps waiting for approval"
                                    description="Swaps requiring manager approval will appear here."
                                />
                            </div>
                        ) : (
                            managerReviewSwaps.map(renderMySwapCard)
                        )}
                    </div>
                ) : activeTab === 'my-requests' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredMySwaps.length === 0 ? (
                            <div className="col-span-full">
                                <EmptyState
                                    icon={ArrowLeftRight}
                                    title="No swap requests found"
                                    description={
                                        searchQuery || statusFilter !== 'all'
                                            ? 'Try adjusting your filters. Check "Cancelled" for past requests.'
                                            : 'Create a swap request from your roster to get started. Check "Cancelled" for past requests.'
                                    }
                                />
                            </div>
                        ) : (
                            filteredMySwaps.map(renderMySwapCard)
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredAvailableSwaps.length === 0 ? (
                            <div className="col-span-full">
                                <EmptyState
                                    icon={ArrowLeftRight}
                                    title="No available shifts found"
                                    description="Check back later for swap opportunities from other employees."
                                />
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
    <div className="text-center py-16 bg-slate-800/30 rounded-xl border border-slate-700">
        <Icon className="h-12 w-12 text-muted-foreground mx-auto mb-4" aria-hidden="true" />
        <h3 className="text-lg font-medium text-foreground mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">{description}</p>
    </div>
);
