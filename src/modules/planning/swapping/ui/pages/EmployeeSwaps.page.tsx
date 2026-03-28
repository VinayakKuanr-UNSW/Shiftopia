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
    ShieldCheck,
    AlertTriangle,
    Lock,
    Zap,
    Signal,
    Filter,
    Flame,
    Gavel,
    UserPlus,
    Circle,
    UserCheck as LucideUserCheck,
    Megaphone,
    Hourglass,
    Ban,
    ThumbsUp,
    CheckCircle,
    Minus
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useSwaps } from '../../state/useSwaps';
import { ShiftSwap, swapsApi } from '../../api/swaps.api';
import { format, differenceInMinutes, parse } from 'date-fns';
import { SYDNEY_TZ, parseZonedDateTime, formatInTimezone } from '@/modules/core/lib/date.utils';
import { ViewOffersModal } from '../components/ViewOffersModal';
import { UnifiedSwapModal } from '../components/UnifiedSwapModal';
import { useQuery } from '@tanstack/react-query';

import { ScopeFilterBanner } from '@/modules/core/ui/components/ScopeFilterBanner';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { FunctionBar } from '@/modules/core/ui/components/FunctionBar';
import { useMinuteTick } from '@/modules/core/hooks/useMinuteTick';
import { computeShiftUrgency, ShiftUrgency } from '@/modules/rosters/domain/bidding-urgency';
import { SharedShiftCard } from '../../../../planning/ui/components/SharedShiftCard';
import { calculateTimeRemaining, formatTimeRemaining } from '../../../../planning/bidding/ui/views/OpenBidsView/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useTableSorting } from '@/modules/core/hooks/useTableSorting';
import { SortableTableHeader } from '@/modules/core/ui/primitives/sortable-table-header';

type TabType = 'available-swaps' | 'my-offers' | 'my-swaps';
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
    const base = 'dept-card-glass-base';
    if (groupType === 'convention_centre' || dept.toLowerCase().includes('convention'))
        return `${base} dept-card-glass-convention`;
    if (groupType === 'exhibition_centre' || dept.toLowerCase().includes('exhibition'))
        return `${base} dept-card-glass-exhibition`;
    if (groupType === 'theatre' || dept.toLowerCase().includes('theatre'))
        return `${base} dept-card-glass-theatre`;
    return `${base} dept-card-glass-default`;
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
                icon: LucideUserCheck,
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

// =============================================================================
// SWAP PRIORITY — unified TTS derivation via shared bidding-urgency utility
// Rules: TTS > 24h = normal | 4–24h = urgent | <4h = locked
// =============================================================================

// Status configuration for table badges and consistency
const STATUS_CONFIG: Record<string, { label: string; icon: any; badgeCls: string }> = {
    OPEN: {
        label: 'Open',
        icon: Clock,
        badgeCls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    },
    MANAGER_PENDING: {
        label: 'Pending Manager',
        icon: LucideUserCheck,
        badgeCls: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    },
    APPROVED: {
        label: 'Approved',
        icon: CheckCircle2,
        badgeCls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    },
    REJECTED: {
        label: 'Rejected',
        icon: XCircle,
        badgeCls: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
    },
    CANCELLED: {
        label: 'Cancelled',
        icon: X,
        badgeCls: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20',
    },
    EXPIRED: {
        label: 'Expired',
        icon: AlertTriangle,
        badgeCls: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    },
};

/** Re-export so ManagerSwaps can import from one place */
export type SwapPriority = ShiftUrgency;

/**
 * Compute swap/offer priority — delegates to the shared TTS utility.
 * Accepts either (shiftDate, startTime) or an ISO startAt datetime.
 */
export const getSwapPriority = (
    _now: Date,
    shiftDate?: string,
    startTime?: string,
    startAt?: string,
    _tzIdentifier?: string,
): SwapPriority => {
    return computeShiftUrgency(shiftDate ?? '', startTime ?? '', startAt);
};

export const PRIORITY_CONFIG: Record<SwapPriority, {
    label: string;
    badgeCls: string;
    icon: React.ElementType;
    chipActiveCls: string;
}> = {
    locked: {
        label: 'Not Allowed',
        badgeCls: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
        icon: Lock,
        chipActiveCls: 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400',
    },
    urgent: {
        label: 'Urgent',
        badgeCls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
        icon: Zap,
        chipActiveCls: 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400',
    },
    normal: {
        label: 'Normal',
        badgeCls: 'bg-slate-500/10 text-muted-foreground border-slate-500/20',
        icon: Signal,
        chipActiveCls: 'bg-muted/40 border-border text-foreground',
    },
};

// =============================================================================
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
    const tr = calculateTimeRemaining(startAt || (shiftDate && startTime ? `${shiftDate}T${startTime}` : ''));
    return tr.isExpired;
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
    const [activeTab, setActiveTab] = useState<TabType>('available-swaps');
    const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [priorityFilter, setPriorityFilter] = useState<ShiftUrgency | 'all'>('all');

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

    // Selection State
    const [selectedSwapIds, setSelectedSwapIds] = useState<string[]>([]);

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

    // Sorting
    const availableSort = useTableSorting(availableSwaps, { key: 'created_at', direction: 'desc' });
    const myOffersSort = useTableSorting(mySwapRequests.filter(s => s.requester_id !== userId), { key: 'created_at', direction: 'desc' });
    const mySwapsSort = useTableSorting(mySwapRequests.filter(s => s.requester_id === userId), { key: 'created_at', direction: 'desc' });

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
    const filteredMySwaps = React.useMemo(() => {
        return mySwapsSort.sortedData.filter((swap) => {
            // Only show swaps I created
            if (swap.requester_id !== userId) return false;

            // Priority filter
            if (priorityFilter !== 'all') {
                const shift = (swap as any).requester_shift;
                const p = getSwapPriority(now, shift?.shift_date, shift?.start_time, shift?.start_at, shift?.tz_identifier);
                if (p !== priorityFilter) return false;
            }

            return true;
        });
    }, [mySwapsSort.sortedData, userId, priorityFilter, now]);

    // 3. Filter available swaps — NO DUPLICATES with My Swap Offers
    const filteredAvailableSwaps = React.useMemo(() => {
        return availableSort.sortedData.filter((swap) => {
            // Exclude my own swaps (safety check)
            if (swap.requester_id === userId) return false;
            // Exclude if already pending manager (not open for offers anymore)
            if (swap.status === 'MANAGER_PENDING') return false;
            // Exclude if I already offered on this swap
            if (myActiveOfferSwapIds.has(swap.id)) return false;

            // Priority filter
            if (priorityFilter !== 'all') {
                const shift = (swap as any).requester_shift;
                const p = getSwapPriority(now, shift?.shift_date, shift?.start_time, shift?.start_at, shift?.tz_identifier);
                if (p !== priorityFilter) return false;
            }

            return true;
        });
    }, [availableSort.sortedData, userId, myActiveOfferSwapIds, priorityFilter, now]);

    // 4. My Swap Offers — swaps where I offered (requester_id !== userId)
    const filteredMyOffers = React.useMemo(() => {
        return myOffersSort.sortedData.filter((swap) => {
            // Already filtered in myOffersSort for requester_id !== userId
            // But double check my offer exists
            const myOffer = ((swap as any).swap_offers || []).find((o: any) => o.offerer_id === userId || o.offerer?.id === userId);
            return !!myOffer;
        });
    }, [myOffersSort.sortedData, userId]);


    // ========================================================================
    // SELECTION HANDLERS
    // ========================================================================
    const handleSelectSwap = (id: string, label: string) => {
        setSelectedSwapIds(prev => {
            const isAdding = !prev.includes(id);
            if (isAdding) {
                toast({
                    description: `Selected: ${label}`,
                    duration: 1500,
                });
                return [...prev, id];
            } else {
                return prev.filter(i => i !== id);
            }
        });
    };

    const handleSelectAll = (ids: string[]) => {
        setSelectedSwapIds(ids);
        toast({
            description: `Selected all ${ids.length} items`,
            duration: 2000,
        });
    };

    const handleDeselectAll = () => {
        setSelectedSwapIds([]);
        toast({
            description: "Deselected all items",
            duration: 1500,
        });
    };


    const handleBulkWithdraw = async () => {
        const results = await Promise.allSettled(
            selectedSwapIds.map(id => {
                const swap = mySwapRequests.find(s => s.id === id);
                const myOffer = ((swap as any).swap_offers || []).find((o: any) => o.offerer_id === userId || o.offerer?.id === userId);
                if (myOffer) {
                    return declineOffer(myOffer.id); 
                }
                return Promise.resolve();
            })
        );
        const succeeded = results.filter(r => r.status === 'fulfilled').length;
        toast({ title: `${succeeded} offer(s) withdrawn` });
        setSelectedSwapIds([]);
        refetchMySwaps();
    };

    const handleBulkCancel = async () => {
        const results = await Promise.allSettled(
            selectedSwapIds.map(id => cancelSwap(id))
        );
        const succeeded = results.filter(r => r.status === 'fulfilled').length;
        toast({ title: `${succeeded} request(s) cancelled` });
        setSelectedSwapIds([]);
        refetchMySwaps();
    };

    // ========================================================================
    // RENDER: My Swap Offer Card (state-machine driven)
    // ========================================================================
    const renderMyOfferCard = (swap: ShiftSwap) => {
        const shift = (swap as any).requester_shift;
        const myOffer = ((swap as any).swap_offers || []).find((o: any) => o.offerer_id === userId || o.offerer?.id === userId);

        const deadline = shift?.start_at || (shift?.shift_date && shift?.start_time ? `${shift?.shift_date}T${shift?.start_time}` : '');
        const tr = calculateTimeRemaining(deadline);
        const timerText = formatTimeRemaining(tr);
        const isExpired = tr.isExpired;

        // Terminal check for timer redundancy
        const isTerminalSwap = swap.status === 'APPROVED' || swap.status === 'REJECTED' || swap.status === 'CANCELLED' || myOffer?.status === 'WITHDRAWN';
        const timerDisplay = isTerminalSwap ? null : (isExpired ? 'Expired' : timerText ? `Closes in ${timerText}` : null);

        // Derive status from state machine
        const deriveOfferStatus = () => {
            if (isExpired) return { label: 'Expired', color: 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-400 dark:text-white/40' };
            if (myOffer?.status === 'WITHDRAWN') return { label: 'Withdrawn', color: 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-400 dark:text-white/40' };
            if (myOffer?.status === 'REJECTED') return { label: 'Peer Rejected', color: 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400' };
            if (swap.status === 'APPROVED') return { label: 'Accepted', color: 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400' };
            if (swap.status === 'REJECTED') return { label: 'Rejected', color: 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400' };
            if (myOffer?.status === 'SELECTED' && swap.status === 'MANAGER_PENDING') return { label: 'Pending Manager Review', color: 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400' };
            if (myOffer?.status === 'SUBMITTED') return { label: 'Pending Peer Review', color: 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20 text-blue-700 dark:text-blue-400' };
            return { label: 'Pending', color: 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-400 dark:text-white/40' };
        };

        const status = deriveOfferStatus();

        // Consistent groupVariant derivation (same as renderMySwapCard / renderAvailableSwapCard)
        const offerGroupVariant: 'convention' | 'exhibition' | 'theatre' | 'default' =
            (shift?.group_type === 'convention_centre' || shift?.roles?.group_type === 'convention_centre' || (shift?.departments?.name || '').toLowerCase().includes('convention')) ? 'convention' :
            (shift?.group_type === 'exhibition_centre' || shift?.roles?.group_type === 'exhibition_centre' || (shift?.departments?.name || '').toLowerCase().includes('exhibition')) ? 'exhibition' :
            (shift?.group_type === 'theatre' || shift?.roles?.group_type === 'theatre' || (shift?.departments?.name || '').toLowerCase().includes('theatre')) ? 'theatre' : 'default';

        // Derive status icon + label for the icon grid
        const isAwaitingMgr = myOffer?.status === 'SELECTED' && swap.status === 'MANAGER_PENDING';
        const isAwaitingPeer = myOffer?.status === 'SUBMITTED';
        const offerStatusIcon = isExpired || myOffer?.status === 'WITHDRAWN' || swap.status === 'REJECTED' || myOffer?.status === 'REJECTED'
            ? <Ban className="w-3.5 h-3.5 text-slate-400 dark:text-white/30" />
            : swap.status === 'APPROVED'
                ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500/60" />
                : isAwaitingMgr
                    ? <LucideUserCheck className="w-3.5 h-3.5 text-amber-500/60" />
                    : isAwaitingPeer
                        ? <Hourglass className="w-3.5 h-3.5 text-blue-500/60" />
                        : <Clock className="w-3.5 h-3.5 text-muted-foreground/40" />;
        const offerStatusLabel = isExpired ? 'Expired'
            : myOffer?.status === 'WITHDRAWN' ? 'Withdrawn'
            : swap.status === 'APPROVED' ? 'Accepted'
            : swap.status === 'REJECTED' || myOffer?.status === 'REJECTED' ? 'Rejected'
            : isAwaitingMgr ? 'Pending Manager Review'
            : isAwaitingPeer ? 'Pending Peer Review'
            : 'Pending';

        return (
            <SharedShiftCard
                key={swap.id}
                organization={shift?.organizations?.name || ''}
                department={shift?.departments?.name || ''}
                subGroup={shift?.sub_departments?.name}
                role={shift?.roles?.name || 'Unknown Role'}
                shiftDate={shift?.shift_date || ''}
                startTime={shift?.start_time || ''}
                endTime={shift?.end_time || ''}
                netLength={shift?.net_length_minutes || 0}
                paidBreak={shift?.paid_break_minutes ?? 0}
                unpaidBreak={shift?.unpaid_break_minutes ?? 0}
                timerText={timerDisplay}
                isExpired={isExpired}
                groupVariant={offerGroupVariant}

                footerActions={
                    <div className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md border text-sm font-medium ${status.color}`}>
                        {status.label === 'Accepted' ? <CheckCircle className="h-4 w-4" /> :
                         status.label === 'Expired' || status.label === 'Withdrawn' ? <Ban className="h-4 w-4" /> :
                         status.label.includes('Rejected') ? <XCircle className="h-4 w-4" /> :
                         <Clock className="h-4 w-4" />}
                        {status.label}
                    </div>
                }
                topContent={
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={selectedSwapIds.includes(swap.id)}
                            onChange={() => handleSelectSwap(swap.id, `Offer: ${shift?.roles?.name || 'Shift'}`)}
                            className="h-4 w-4 rounded border-slate-300 dark:border-white/20 text-indigo-600 focus:ring-indigo-500 accent-indigo-500 cursor-pointer"
                        />
                        {selectedSwapIds.includes(swap.id) && (
                            <span className="text-[10px] text-indigo-500 font-bold uppercase tracking-wider animate-in fade-in slide-in-from-left-1">
                                Selected
                            </span>
                        )}
                    </div>
                }
            />
        );
    };


    // Render swap card for "My Requests" and "Manager Review" tab
    const renderMySwapCard = (swap: ShiftSwap) => {
        const shift = (swap as any).requester_shift;
        const statusConfig = getStatusConfig(swap.status);
        const StatusIcon = statusConfig.icon;
        
        const deadline = shift?.start_at || (shift?.shift_date && shift?.start_time ? `${shift?.shift_date}T${shift?.start_time}` : '');
        const tr = calculateTimeRemaining(deadline);
        const timerText = formatTimeRemaining(tr);
        const priority = getSwapPriority(now, shift?.shift_date, shift?.start_time, shift?.start_at, shift?.tz_identifier);
        
        const isExpired = tr.isExpired;
        const isTerminalRequest = swap.status === 'APPROVED' || swap.status === 'REJECTED' || swap.status === 'CANCELLED';
        const timerDisplay = isTerminalRequest ? null : timerText;

        const groupVariant: 'convention' | 'exhibition' | 'theatre' | 'default' = 
            (shift?.group_type === 'convention_centre' || (shift?.departments?.name || '').toLowerCase().includes('convention')) ? 'convention' :
            (shift?.group_type === 'exhibition_centre' || (shift?.departments?.name || '').toLowerCase().includes('exhibition')) ? 'exhibition' :
            (shift?.group_type === 'theatre' || (shift?.departments?.name || '').toLowerCase().includes('theatre')) ? 'theatre' : 'default';

        return (
            <SharedShiftCard
                key={swap.id}
                organization={shift?.organizations?.name || 'ICC Sydney'}
                department={shift?.departments?.name || 'Department'}
                subGroup={shift?.sub_departments?.name}
                role={shift?.roles?.name || 'Shift'}
                shiftDate={shift?.start_at ? formatInTimezone(new Date(shift.start_at), shift.tz_identifier || SYDNEY_TZ, 'EEEE, MMM d, yyyy') : (shift?.shift_date ? format(parse(shift.shift_date, 'yyyy-MM-dd', new Date()), 'EEEE, MMM d, yyyy') : 'Unknown')}
                startTime={shift?.start_at ? formatInTimezone(new Date(shift.start_at), shift.tz_identifier || SYDNEY_TZ, 'HH:mm') : (shift?.start_time ? formatTime(shift.start_time) : '00:00')}
                endTime={shift?.end_at ? formatInTimezone(new Date(shift.end_at), shift.tz_identifier || SYDNEY_TZ, 'HH:mm') : (shift?.end_time ? formatTime(shift.end_time) : '00:00')}
                netLength={shift?.net_length_minutes || 0}
                paidBreak={shift?.paid_break_minutes || 0}
                unpaidBreak={shift?.unpaid_break_minutes || 0}
                timerText={timerDisplay}
                isExpired={isExpired}
                urgency={priority}
                lifecycleStatus={shift?.lifecycle_status}
                groupVariant={groupVariant}

                footerActions={
                    <div className="flex flex-col gap-1.5">
                        {/* ── EXPIRY GLOBAL OVERRIDE ── */}
                        {isExpired ? (
                            <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-400 dark:text-white/40 text-sm font-medium">
                                <Ban className="h-4 w-4" /> Expired
                            </div>
                        ) : swap.status === 'APPROVED' ? (
                            <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-sm font-medium">
                                <CheckCircle className="h-4 w-4" /> Accepted
                            </div>
                        ) : swap.status === 'REJECTED' ? (
                            <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 text-sm font-medium">
                                <XCircle className="h-4 w-4" /> Rejected
                            </div>
                        ) : swap.status === 'CANCELLED' ? (
                            <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-400 dark:text-white/40 text-sm font-medium">
                                <Ban className="h-4 w-4" /> Cancelled
                            </div>
                        ) : swap.status === 'MANAGER_PENDING' ? (
                            <>
                                <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400 text-sm font-medium">
                                    <Clock className="h-4 w-4" /> Awaiting Manager Review
                                </div>
                                <Button
                                    variant="outline"
                                    className="w-full border-border/10 hover:bg-primary/10 h-9"
                                    onClick={() => setViewOffersSwapId(swap.id)}
                                >
                                    <Eye className="mr-1.5 h-4 w-4" /> Details
                                </Button>
                            </>
                        ) : (
                            /* OPEN state */
                            <>
                                <SwapCardOfferButton
                                    swapId={swap.id}
                                    onClick={() => setViewOffersSwapId(swap.id)}
                                />
                                <Button
                                    variant="outline"
                                    className="w-full border-border/10 hover:bg-rose-500/10 hover:text-rose-400 h-9"
                                    onClick={() => setConfirmDialog({ isOpen: true, swap })}
                                    disabled={isCancelling}
                                >
                                    <X className="mr-1.5 h-4 w-4" /> Cancel
                                </Button>
                            </>
                        )}
                    </div>
                }
                topContent={
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={selectedSwapIds.includes(swap.id)}
                            onChange={() => handleSelectSwap(swap.id, `Swap: ${shift?.roles?.name || 'Shift'}`)}
                            className="h-4 w-4 rounded border-slate-300 dark:border-white/20 text-indigo-600 focus:ring-indigo-500 accent-indigo-500 cursor-pointer"
                        />
                        {selectedSwapIds.includes(swap.id) && (
                            <span className="text-[10px] text-indigo-500 font-bold uppercase tracking-wider animate-in fade-in slide-in-from-left-1">
                                Selected
                            </span>
                        )}
                    </div>
                }
            />
        );
    };

    // Render available swap card
    const renderAvailableSwapCard = (swap: ShiftSwap) => {
        const shift = (swap as any).requester_shift;
        const requesterName = (swap as any).requested_by?.full_name || (swap as any).requested_by?.email || 'Someone';
        
        const deadline = shift?.start_at || (shift?.shift_date && shift?.start_time ? `${shift?.shift_date}T${shift?.start_time}` : '');
        const tr = calculateTimeRemaining(deadline);
        const timerText = formatTimeRemaining(tr);
        const isExpired = tr.isExpired;
        const hasOffered = myActiveOfferSwapIds.has(swap.id);
        const priority = getSwapPriority(now, shift?.shift_date, shift?.start_time, shift?.start_at, shift?.tz_identifier);

        const groupVariant: 'convention' | 'exhibition' | 'theatre' | 'default' = 
            (shift?.group_type === 'convention_centre' || (shift?.departments?.name || '').toLowerCase().includes('convention')) ? 'convention' :
            (shift?.group_type === 'exhibition_centre' || (shift?.departments?.name || '').toLowerCase().includes('exhibition')) ? 'exhibition' :
            (shift?.group_type === 'theatre' || (shift?.departments?.name || '').toLowerCase().includes('theatre')) ? 'theatre' : 'default';

        return (
            <SharedShiftCard
                key={swap.id}
                organization={shift?.organizations?.name || 'ICC Sydney'}
                department={shift?.departments?.name || 'Department'}
                subGroup={shift?.sub_departments?.name}
                role={shift?.roles?.name || 'Shift'}
                shiftDate={shift?.start_at ? formatInTimezone(new Date(shift.start_at), shift.tz_identifier || SYDNEY_TZ, 'EEE, MMM d') : (shift?.shift_date ? format(parse(shift.shift_date, 'yyyy-MM-dd', new Date()), 'EEE, MMM d') : 'Unknown')}
                startTime={shift?.start_at ? formatInTimezone(new Date(shift.start_at), shift.tz_identifier || SYDNEY_TZ, 'HH:mm') : (shift?.start_time ? formatTime(shift.start_time) : '00:00')}
                endTime={shift?.end_at ? formatInTimezone(new Date(shift.end_at), shift.tz_identifier || SYDNEY_TZ, 'HH:mm') : (shift?.end_time ? formatTime(shift.end_time) : '00:00')}
                netLength={shift?.net_length_minutes || 0}
                paidBreak={shift?.paid_break_minutes || 0}
                unpaidBreak={shift?.unpaid_break_minutes || 0}
                timerText={timerText}
                isExpired={isExpired}
                urgency={priority}
                lifecycleStatus={shift?.lifecycle_status}
                groupVariant={groupVariant}

                footerActions={
                    isExpired ? (
                        <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-400 dark:text-white/40 text-sm font-medium">
                            <Ban className="h-4 w-4" /> Expired
                        </div>
                    ) : (
                        <Button
                            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold h-10"
                            onClick={() => setOfferSwapTarget(swap)}
                            disabled={isMakingOffer}
                        >
                            <ArrowLeftRight className="mr-1.5 h-4 w-4" />
                            Offer Swap
                        </Button>
                    )
                }
                topContent={
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={selectedSwapIds.includes(swap.id)}
                            onChange={() => handleSelectSwap(swap.id, `Market: ${shift?.roles?.name || 'Shift'}`)}
                            className="h-4 w-4 rounded border-slate-300 dark:border-white/20 text-indigo-600 focus:ring-indigo-500 accent-indigo-500 cursor-pointer"
                            disabled={hasOffered}
                        />
                        {selectedSwapIds.includes(swap.id) && (
                            <span className="text-[10px] text-indigo-500 font-bold uppercase tracking-wider animate-in fade-in slide-in-from-left-1">
                                Selected
                            </span>
                        )}
                    </div>
                }
            />
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
                    { id: 'available-swaps', label: 'Available Swaps', count: filteredAvailableSwaps.length },
                    { id: 'my-offers', label: 'My Swap Offers', count: filteredMyOffers.length },
                    { id: 'my-swaps', label: 'My Swaps', count: filteredMySwaps.length }
                ]}
                activeTab={activeTab}
                onTabChange={(id) => setActiveTab(id as any)}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                onRefresh={handleRefresh}
                className="mb-6"
                endActions={
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-muted-foreground/60 mr-1">
                            <Filter className="h-3 w-3" />
                            Priority
                        </div>
                        {(['all', 'normal', 'urgent', 'locked'] as const).map((p) => {
                            const isAll = p === 'all';
                            const conf = isAll ? null : PRIORITY_CONFIG[p];
                            const active = priorityFilter === p;
                            return (
                                <button
                                    key={p}
                                    onClick={() => setPriorityFilter(p as ShiftUrgency | 'all')}
                                    className={cn(
                                        "flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-black uppercase tracking-wider transition-all",
                                        active
                                            ? isAll
                                                ? "bg-primary/10 border-primary/30 text-primary"
                                                : conf!.chipActiveCls
                                            : "bg-muted/20 border-border/30 text-muted-foreground hover:bg-muted/40"
                                    )}
                                >
                                    {isAll ? 'All' : (
                                        <>
                                            {conf?.icon && <conf.icon className="h-3 w-3" />}
                                            {conf?.label}
                                        </>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                }
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
            ) : activeTab === 'available-swaps' ? (
                viewMode === 'card' ? (
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
                ) : (
                    <div className="overflow-x-auto border border-slate-200 dark:border-white/10 rounded-lg">
                        <table className="w-full text-sm text-slate-800 dark:text-white">
                            <thead className="bg-slate-100 dark:bg-black/40 text-xs text-muted-foreground uppercase tracking-wider">
                                <tr>
                                    <th className="p-3 text-left w-[40px]">
                                        <input
                                            type="checkbox"
                                            checked={filteredAvailableSwaps.length > 0 && filteredAvailableSwaps.every(s => selectedSwapIds.includes(s.id))}
                                            onChange={(e) => handleSelectAll(e.target.checked ? filteredAvailableSwaps.map(s => s.id) : [])}
                                            className="accent-indigo-500"
                                        />
                                    </th>
                                    <SortableTableHeader sortKey="requester_shift.departments.name" currentSort={availableSort.sortConfig} onSort={availableSort.handleSort}>Dept</SortableTableHeader>
                                    <SortableTableHeader sortKey="requester_shift.subGroups.name" currentSort={availableSort.sortConfig} onSort={availableSort.handleSort}>Sub</SortableTableHeader>
                                    <SortableTableHeader sortKey="requester_shift.roles.name" currentSort={availableSort.sortConfig} onSort={availableSort.handleSort}>Role</SortableTableHeader>
                                    <SortableTableHeader sortKey="requester_shift.shift_date" currentSort={availableSort.sortConfig} onSort={availableSort.handleSort}>Date</SortableTableHeader>
                                    <th className="p-3 text-left">Time</th>
                                    <th className="p-3 text-left">Net</th>
                                    <th className="p-3 text-left w-[180px]">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                                {filteredAvailableSwaps.map(swap => {
                                    const shift = (swap as any).requester_shift;
                                    const hasOffered = myActiveOfferSwapIds.has(swap.id);
                                    return (
                                        <tr key={swap.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                                            <td className="p-3">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedSwapIds.includes(swap.id)}
                                                    onChange={() => handleSelectSwap(swap.id, shift?.roles?.name || 'Shift')}
                                                    disabled={hasOffered}
                                                    className="accent-indigo-500"
                                                />
                                            </td>
                                            <td className="p-3 font-medium">{shift?.departments?.name || '---'}</td>
                                            <td className="p-3">{shift?.subGroups?.name || '---'}</td>
                                            <td className="p-3 font-semibold text-indigo-600 dark:text-indigo-400">{shift?.roles?.name || '---'}</td>
                                            <td className="p-3">{shift?.shift_date || '---'}</td>
                                            <td className="p-3 text-[11px] font-medium opacity-80">
                                                {shift ? `${shift.start_time.slice(0, 5)} - ${shift.end_time.slice(0, 5)}` : '---'}
                                            </td>
                                            <td className="p-3 opacity-60 font-mono text-xs">{shift?.net_length ? `${Math.round(shift.net_length)}m` : '---'}</td>
                                            <td className="p-3">
                                                {hasOffered ? (
                                                    <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 text-xs font-bold">
                                                        <CheckCircle2 className="h-4 w-4" /> Offered
                                                    </div>
                                                ) : (
                                                    <Button
                                                        size="sm"
                                                        onClick={() => setOfferSwapTarget(swap)}
                                                        className="h-8 w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-md shadow-sm text-xs font-bold"
                                                    >
                                                        <ThumbsUp className="mr-1.5 h-3.5 w-3.5" /> Offer Swap
                                                    </Button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )
            ) : activeTab === 'my-offers' ? (
                /* ── MY SWAP OFFERS (Offers I made on others' swaps) ── */
                viewMode === 'card' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredMyOffers.length === 0 ? (
                            <div className="col-span-full py-12 text-center">
                                <div className="mx-auto w-12 h-12 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center mb-4">
                                    <ArrowLeftRight className="h-6 w-6 text-slate-300 dark:text-white/20" />
                                </div>
                                <h3 className="text-lg font-medium text-slate-400 dark:text-white/50">No swap offers yet</h3>
                                <p className="text-sm text-slate-400/70 dark:text-white/30 mt-1">Offer on available swaps to see them here.</p>
                            </div>
                        ) : (
                            filteredMyOffers.map(renderMyOfferCard)
                        )}
                    </div>
                ) : (
                    <div className="overflow-x-auto border border-slate-200 dark:border-white/10 rounded-lg">
                        <table className="w-full text-sm text-slate-800 dark:text-white">
                            <thead className="bg-slate-100 dark:bg-black/40 text-xs text-muted-foreground uppercase tracking-wider">
                                <tr>
                                    <th className="p-3 text-left w-[40px]">
                                        <input
                                            type="checkbox"
                                            checked={filteredMyOffers.length > 0 && filteredMyOffers.every(s => selectedSwapIds.includes(s.id))}
                                            onChange={(e) => handleSelectAll(e.target.checked ? filteredMyOffers.map(s => s.id) : [])}
                                            className="accent-indigo-500"
                                        />
                                    </th>
                                    <SortableTableHeader sortKey="requester_shift.departments.name" currentSort={myOffersSort.sortConfig} onSort={myOffersSort.handleSort}>Dept</SortableTableHeader>
                                    <SortableTableHeader sortKey="requester_shift.roles.name" currentSort={myOffersSort.sortConfig} onSort={myOffersSort.handleSort}>Role</SortableTableHeader>
                                    <SortableTableHeader sortKey="requester_shift.shift_date" currentSort={myOffersSort.sortConfig} onSort={myOffersSort.handleSort}>Date</SortableTableHeader>
                                    <th className="p-3 text-left">Time</th>
                                    <th className="p-3 text-left">Status</th>
                                    <th className="p-3 text-left w-[150px]">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                                {filteredMyOffers.map(swap => {
                                    const shift = (swap as any).requester_shift;
                                    const myOffer = ((swap as any).swap_offers || []).find((o: any) => o.offerer_id === userId || o.offerer?.id === userId);
                                    if (!myOffer) return null;
                                    const statusConf = STATUS_CONFIG[myOffer.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.OPEN;
                                    const StatusIcon = statusConf.icon;

                                    return (
                                        <tr key={swap.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                                            <td className="p-3">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedSwapIds.includes(swap.id)}
                                                    onChange={() => handleSelectSwap(swap.id, shift?.roles?.name || 'Offer')}
                                                    className="accent-indigo-500"
                                                />
                                            </td>
                                            <td className="p-3">{shift?.departments?.name || '---'}</td>
                                            <td className="p-3 font-semibold text-indigo-600 dark:text-indigo-400">{shift?.roles?.name || '---'}</td>
                                            <td className="p-3">{shift?.shift_date || '---'}</td>
                                            <td className="p-3 text-[11px] font-medium opacity-80">
                                                {shift ? `${shift.start_time.slice(0, 5)} - ${shift.end_time.slice(0, 5)}` : '---'}
                                            </td>
                                            <td className="p-3">
                                                <div className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider", statusConf.badgeCls)}>
                                                    <StatusIcon className="h-3 w-3" />
                                                    {statusConf.label}
                                                </div>
                                            </td>
                                            <td className="p-3 text-right">
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => declineOffer(myOffer.id)}
                                                    className="h-8 w-full text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-500/10 text-xs font-bold border border-red-200 dark:border-red-500/30"
                                                >
                                                    <XCircle className="mr-1.5 h-3.5 w-3.5" /> Withdraw
                                                </Button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )
            ) : (
                /* ── MY SWAPS (Shifts I posted for swap) ── */
                viewMode === 'card' ? (
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
                    <div className="overflow-x-auto border border-slate-200 dark:border-white/10 rounded-lg">
                        <table className="w-full text-sm text-slate-800 dark:text-white">
                            <thead className="bg-slate-100 dark:bg-black/40 text-xs text-muted-foreground uppercase tracking-wider">
                                <tr>
                                    <th className="p-3 text-left w-[40px]">
                                        <input
                                            type="checkbox"
                                            checked={filteredMySwaps.length > 0 && filteredMySwaps.every(s => selectedSwapIds.includes(s.id))}
                                            onChange={(e) => handleSelectAll(e.target.checked ? filteredMySwaps.map(s => s.id) : [])}
                                            className="accent-indigo-500"
                                        />
                                    </th>
                                    <SortableTableHeader sortKey="requester_shift.departments.name" currentSort={mySwapsSort.sortConfig} onSort={mySwapsSort.handleSort}>Dept</SortableTableHeader>
                                    <SortableTableHeader sortKey="requester_shift.roles.name" currentSort={mySwapsSort.sortConfig} onSort={mySwapsSort.handleSort}>Role</SortableTableHeader>
                                    <SortableTableHeader sortKey="requester_shift.shift_date" currentSort={mySwapsSort.sortConfig} onSort={mySwapsSort.handleSort}>Date</SortableTableHeader>
                                    <th className="p-3 text-left">Time</th>
                                    <th className="p-3 text-left">Status</th>
                                    <th className="p-3 text-left w-[220px]">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                                {filteredMySwaps.map(swap => {
                                    const shift = (swap as any).requester_shift;
                                    const statusConf = STATUS_CONFIG[swap.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.OPEN;
                                    const StatusIcon = statusConf.icon;
                                    const offersCount = ((swap as any).swap_offers || []).length;

                                    return (
                                        <tr key={swap.id} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                                            <td className="p-3">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedSwapIds.includes(swap.id)}
                                                    onChange={() => handleSelectSwap(swap.id, shift?.roles?.name || 'Swap')}
                                                    className="accent-indigo-500"
                                                />
                                            </td>
                                            <td className="p-3 font-medium">{shift?.departments?.name || '---'}</td>
                                            <td className="p-3 font-semibold text-indigo-600 dark:text-indigo-400">{shift?.roles?.name || '---'}</td>
                                            <td className="p-3">{shift?.shift_date || '---'}</td>
                                            <td className="p-3 text-[11px] font-medium opacity-80">
                                                {shift ? `${shift.start_time.slice(0, 5)} - ${shift.end_time.slice(0, 5)}` : '---'}
                                            </td>
                                            <td className="p-3">
                                                <div className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider", statusConf.badgeCls)}>
                                                    <StatusIcon className="h-3 w-3" />
                                                    {statusConf.label}
                                                </div>
                                            </td>
                                            <td className="p-3">
                                                <div className="flex gap-2">
                                                    {swap.status === 'OPEN' && (
                                                        <Button
                                                            size="sm"
                                                            onClick={(e) => { e.stopPropagation(); setViewOffersSwapId(swap.id); }}
                                                            className="h-8 flex-1 bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 text-xs font-bold"
                                                        >
                                                            <Eye className="mr-1.5 h-3.5 w-3.5" /> 
                                                            Offers ({offersCount})
                                                        </Button>
                                                    )}
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => setConfirmDialog({ isOpen: true, swap })}
                                                        disabled={isCancelling}
                                                        className="h-8 flex-1 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-500/10 text-xs font-bold border border-red-200 dark:border-red-500/30"
                                                    >
                                                        <Ban className="mr-1.5 h-3.5 w-3.5" /> Cancel
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )
            )}

            {/* Modals */}
            <UnifiedSwapModal
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

            {/* FLOATING ACTION BAR */}
            <AnimatePresence>
                {selectedSwapIds.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: 50, x: '-50%' }}
                        animate={{ opacity: 1, y: 0, x: '-50%' }}
                        exit={{ opacity: 0, y: 50, x: '-50%' }}
                        className="fixed bottom-6 left-1/2 z-50 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-5 py-3 rounded-full shadow-2xl flex items-center gap-4 border border-slate-700 dark:border-slate-200 pointer-events-auto"
                    >
                        <div className="flex items-center gap-2">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500 text-[12px] font-bold text-white shadow-sm">
                                {selectedSwapIds.length}
                            </span>
                            <span className="text-sm font-semibold">Selected</span>
                        </div>
                        
                        <div className="h-5 w-[1px] bg-white/20 dark:bg-black/10 mx-1" />
                        
                        <div className="flex items-center gap-1">
                            {/* Select All */}
                            <Button 
                                size="sm" 
                                variant="ghost" 
                                className="hover:bg-white/10 dark:hover:bg-slate-100 text-white dark:text-slate-900 rounded-full h-8 px-3 text-xs font-medium" 
                                onClick={() => {
                                    if (activeTab === 'available-swaps') handleSelectAll(filteredAvailableSwaps.map(s => s.id));
                                    else if (activeTab === 'my-offers') handleSelectAll(filteredMyOffers.map(s => s.id));
                                    else if (activeTab === 'my-swaps') handleSelectAll(filteredMySwaps.map(s => s.id));
                                }}
                            >
                                Select All
                            </Button>

                            {/* Deselect All */}
                            <Button 
                                size="sm" 
                                variant="ghost" 
                                className="hover:bg-white/10 dark:hover:bg-slate-100 text-white dark:text-slate-900 rounded-full h-8 px-3 text-xs font-medium" 
                                onClick={handleDeselectAll}
                            >
                                Deselect All
                            </Button>
                            
                            {/* Contextual Action */}
                            <Button 
                                size="sm" 
                                className="bg-indigo-500 hover:bg-indigo-600 dark:bg-indigo-600 dark:hover:bg-indigo-700 text-white rounded-full h-8 px-5 text-xs font-bold ml-2 shadow-md transition-transform active:scale-95" 
                                onClick={() => {
                                    if (activeTab === 'my-offers') handleBulkWithdraw();
                                    else if (activeTab === 'my-swaps') handleBulkCancel();
                                    else {
                                        toast({ description: "Select individual cards to offer swaps." });
                                    }
                                }}
                            >
                                {activeTab === 'available-swaps' ? (
                                    <><ThumbsUp className="mr-1.5 h-3.5 w-3.5" /> Bulk Action</>
                                ) : activeTab === 'my-offers' ? (
                                    <><XCircle className="mr-1.5 h-3.5 w-3.5" /> Withdraw Selected</>
                                ) : (
                                    <><Ban className="mr-1.5 h-3.5 w-3.5" /> Cancel Selected</>
                                )}
                            </Button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
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
        <button
            className={cn(
                "w-full h-12 flex items-center justify-center gap-3 text-[11px] font-black tracking-[0.3em] uppercase transition-all backdrop-blur-md",
                pendingCount > 0
                    ? "bg-primary/20 text-primary hover:bg-primary/30"
                    : "bg-muted/30 text-foreground/40 hover:bg-muted/40"
            )}
            onClick={onClick}
            disabled={isLoading}
        >
            <Eye className="h-4 w-4" aria-hidden="true" />
            {isLoading ? (
                'Loading...'
            ) : pendingCount > 0 ? (
                `View Offers (${pendingCount})`
            ) : (
                'No Offers Yet'
            )}
        </button>
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

// Force reload: Sun Mar 22 13:03:21 AEDT 2026
