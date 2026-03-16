import React, { useState } from 'react';
import { useAuth } from '@/platform/auth/useAuth';
import { useOrgSelection } from '@/modules/core/contexts/OrgSelectionContext';
import { useTableSorting } from '@/modules/core/hooks/useTableSorting';
import { SortableTableHeader } from '@/modules/core/ui/primitives/sortable-table-header';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO, parse } from 'date-fns';
import { SYDNEY_TZ, parseZonedDateTime, formatInTimezone } from '@/modules/core/lib/date.utils';
import { biddingApi } from '../../api/bidding.api';
import { validateCompliance, type ComplianceResult } from '@/modules/rosters/services/compliance.service';
import {
    Info, User,
    Calendar, Clock, ThumbsUp, ShieldAlert, Ban, Flame,
    Megaphone, UserPlus, UserCheck, Circle, Minus, Gavel, Coffee, Shield, Loader2, AlertTriangle, CheckCircle, XCircle
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Tabs, TabsContent } from '@/modules/core/ui/primitives/tabs';
import { BidStatusBadge } from '../components/BidStatusBadge';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import { useToast } from '@/modules/core/hooks/use-toast';
import { motion } from 'framer-motion';
import { determineShiftState } from '@/modules/rosters/domain/shift-state.utils';

import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/modules/core/ui/primitives/alert-dialog';
import { BidComplianceModal } from '../components/BidComplianceModal';

import { ScopeFilterBanner } from '@/modules/core/ui/components/ScopeFilterBanner';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { FunctionBar } from '@/modules/core/ui/components/FunctionBar';

// ============================================================================
// INTERFACES
// ============================================================================
interface ShiftData {
    id: any;
    role: string;
    organization: string;
    department: string;
    subGroup: string;
    date: string;
    weekday: string;
    startTime: string;
    endTime: string;
    startAt?: string | null;
    endAt?: string | null;
    tzIdentifier?: string | null;
    paidBreak: number;
    unpaidBreak: number;
    netLength: number;
    remunerationLevel: string;
    assignedTo: string | null;
    isEligible: boolean;
    ineligibilityReason?: string;
    groupType?: string | null;
    priority?: string | null;
    biddingWindowOpens?: string | null;
    biddingWindowCloses?: string | null;
    isUrgent?: boolean;
    stateId?: string;
    subGroupColor?: string;
    droppedById?: string | null;
}

interface BidData {
    id: any;
    shiftId: any;
    role: string;
    organization: string;
    department: string;
    subGroup: string;
    date: string;
    weekday: string;
    startTime: string;
    endTime: string;
    startAt?: string | null;
    endAt?: string | null;
    tzIdentifier?: string | null;
    paidBreak: number;
    unpaidBreak: number;
    netLength: number;
    remunerationLevel: string;
    status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
    bidTime: string;
    notes: string | null;
    groupType?: string | null;
    stateId?: string;
    subGroupColor?: string;
}

// ============================================================================
// HELPERS
// ============================================================================
// Department badge classes — uses CSS defined in index.css (light + dark adaptive)
function getDeptColor(groupType: string | null | undefined, dept: string): string {
    if (groupType === 'convention_centre' || dept.toLowerCase().includes('convention'))
        return 'dept-badge-convention';
    if (groupType === 'exhibition_centre' || dept.toLowerCase().includes('exhibition'))
        return 'dept-badge-exhibition';
    if (groupType === 'theatre' || dept.toLowerCase().includes('theatre'))
        return 'dept-badge-theatre';
    return 'dept-badge-default';
}

// Department card classes — uses CSS defined in index.css (light + dark adaptive)
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

function toSeconds(t: string): number {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return h * 3600 + (m || 0) * 60;
}

// ============================================================================
// COMPONENT
// ============================================================================
export const EmployeeBidsPage: React.FC = () => {
    const { user } = useAuth();
    const orgSelection = useOrgSelection();
    const { scope, setScope, scopeKey, isGammaLocked } = useScopeFilter('personal');
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState<'available' | 'myBids'>('available');
    const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
    const [myBidsSubToggle, setMyBidsSubToggle] = useState<'pending' | 'accepted' | 'rejected'>('pending');


    // Selection
    const [selectedBidIds, setSelectedBidIds] = useState<any[]>([]);

    // Compliance Check State
    const [checkingShiftId, setCheckingShiftId] = useState<string | null>(null);
    const [complianceResult, setComplianceResult] = useState<ComplianceResult | null>(null);
    const [showComplianceDialog, setShowComplianceDialog] = useState(false);
    const [pendingBidShift, setPendingBidShift] = useState<ShiftData | null>(null);

    // NEW: Compliance Modal State
    const [complianceModalShift, setComplianceModalShift] = useState<ShiftData | null>(null);
    const [isComplianceModalOpen, setIsComplianceModalOpen] = useState(false);

    // Use scope filter values, falling back to OrgSelectionContext
    const hierarchyFilters = {
        organizationId: scope.org_ids[0] || orgSelection.organizationId || '',
        departmentId: scope.dept_ids[0] || orgSelection.departmentId || undefined,
        subDepartmentId: scope.subdept_ids[0] || orgSelection.subDepartmentId || undefined,
    };

    const { data: rawAvailableShifts = [] } = useQuery({
        queryKey: ['openBidShifts', scopeKey, hierarchyFilters.organizationId, hierarchyFilters.departmentId, hierarchyFilters.subDepartmentId],
        queryFn: () => biddingApi.getOpenBidShifts(hierarchyFilters),
        enabled: !!user && !!hierarchyFilters.organizationId,
    });

    const { data: rawMyBids = [] } = useQuery({
        queryKey: ['myBids', user?.id],
        queryFn: () => (user ? biddingApi.getMyBids(user.id) : Promise.resolve([])),
        enabled: !!user,
    });

    // ========================================================================
    // MUTATIONS
    // ========================================================================
    const placeBidMutation = useMutation({
        mutationFn: (shiftId: string) => biddingApi.placeBid(shiftId, user!.id),
        onSuccess: () => {
            toast({ title: 'Bid Submitted', description: 'Your bid has been placed successfully.' });
            queryClient.invalidateQueries({ queryKey: ['openBidShifts'] });
            queryClient.invalidateQueries({ queryKey: ['myBids'] });
            setSelectedBidIds([]);
        },
        onError: (error: any) => {
            toast({ title: 'Bid Failed', description: error.message || 'Failed to place bid.', variant: 'destructive' });
        }
    });

    const withdrawBidMutation = useMutation({
        mutationFn: (bidId: string) => biddingApi.withdrawBid(bidId),
        onSuccess: () => {
            toast({ title: 'Bid Withdrawn', description: 'You have withdrawn from the bid.' });
            queryClient.invalidateQueries({ queryKey: ['myBids'] });
            setSelectedBidIds([]);
        },
        onError: () => {
            toast({ title: 'Withdraw Failed', description: 'Failed to withdraw bid.', variant: 'destructive' });
        }
    });

    // ========================================================================
    // DATA TRANSFORMATION
    // ========================================================================
    const availableShifts: ShiftData[] = React.useMemo(() => {
        return rawAvailableShifts.map(s => {
            const shiftStartAt = (s as any).start_at ? new Date((s as any).start_at) : parseZonedDateTime(s.shift_date, s.start_time, (s as any).tz_identifier || SYDNEY_TZ);
            const shiftEndAt = (s as any).end_at ? new Date((s as any).end_at) : parseZonedDateTime(s.shift_date, s.end_time, (s as any).tz_identifier || SYDNEY_TZ);

            // Adjust end time if shift passes midnight and no UTC end_at is provided
            if (!(s as any).end_at && shiftEndAt < shiftStartAt) {
                shiftEndAt.setDate(shiftEndAt.getDate() + 1);
            }

            const durationMin = (shiftEndAt.getTime() - shiftStartAt.getTime()) / (1000 * 60);
            const paidBreak = s.paid_break_minutes || 0;
            const unpaidBreak = s.unpaid_break_minutes || 0;
            const netLength = durationMin - unpaidBreak;

            const timeToStartHours = (shiftStartAt.getTime() - new Date().getTime()) / (1000 * 60 * 60);
            const isUrgent = (s as any).bidding_status === 'on_bidding_urgent' || (s as any).is_urgent || (timeToStartHours > 0 && timeToStartHours < 24);

            return {
                id: s.id,
                role: s.roles?.name || 'Unknown',
                organization: (s as any).organizations?.name || 'MCEC',
                department: s.departments?.name || 'Unknown',
                subGroup: s.sub_departments?.name || 'General',
                date: (s as any).start_at ? formatInTimezone(new Date((s as any).start_at), (s as any).tz_identifier || SYDNEY_TZ, 'yyyy-MM-dd') : s.shift_date,
                weekday: (s as any).start_at ? formatInTimezone(new Date((s as any).start_at), (s as any).tz_identifier || SYDNEY_TZ, 'EEE') : format(parseISO(s.shift_date), 'EEE'),
                startTime: (s as any).start_at ? formatInTimezone(new Date((s as any).start_at), (s as any).tz_identifier || SYDNEY_TZ, 'HH:mm') : s.start_time.slice(0, 5),
                endTime: (s as any).end_at ? formatInTimezone(new Date((s as any).end_at), (s as any).tz_identifier || SYDNEY_TZ, 'HH:mm') : s.end_time.slice(0, 5),
                startAt: (s as any).start_at,
                endAt: (s as any).end_at,
                tzIdentifier: (s as any).tz_identifier,
                paidBreak,
                unpaidBreak,
                netLength,
                remunerationLevel: s.remuneration_levels?.level_name || 'Level-4',
                assignedTo: s.assigned_employee_id,
                isEligible: true,
                groupType: s.group_type,
                priority: isUrgent ? 'urgent' : 'normal',
                biddingWindowOpens: (s as any).bidding_open_at || null,
                biddingWindowCloses: (s as any).bidding_close_at || null,
                isUrgent,
                stateId: determineShiftState(s as any),
                subGroupColor: getDeptColor(s.group_type, s.departments?.name || ''),
                droppedById: (s as any).dropped_by_id
            };
        });
    }, [rawAvailableShifts]);

    const myBids: BidData[] = React.useMemo(() => {
        return rawMyBids.map(b => {
            const s = b.shift;
            if (!s) return null;
            const shiftStartAt = (s as any).start_at ? new Date((s as any).start_at) : parseZonedDateTime(s.shift_date, s.start_time, (s as any).tz_identifier || SYDNEY_TZ);
            const shiftEndAt = (s as any).end_at ? new Date((s as any).end_at) : parseZonedDateTime(s.shift_date, s.end_time, (s as any).tz_identifier || SYDNEY_TZ);

            // Adjust end time if shift passes midnight and no UTC end_at is provided
            if (!(s as any).end_at && shiftEndAt < shiftStartAt) {
                shiftEndAt.setDate(shiftEndAt.getDate() + 1);
            }

            const durationMin = (shiftEndAt.getTime() - shiftStartAt.getTime()) / (1000 * 60);
            const paidBreak = s.paid_break_minutes || 0;
            const unpaidBreak = s.unpaid_break_minutes || 0;
            const netLength = durationMin - unpaidBreak;

            return {
                id: b.id,
                shiftId: s.id,
                role: s.roles?.name || 'Unknown',
                organization: (s as any).organizations?.name || 'MCEC',
                department: s.departments?.name || 'Unknown',
                subGroup: s.sub_departments?.name || 'General',
                date: (s as any).start_at ? formatInTimezone(new Date((s as any).start_at), (s as any).tz_identifier || SYDNEY_TZ, 'yyyy-MM-dd') : s.shift_date,
                weekday: (s as any).start_at ? formatInTimezone(new Date((s as any).start_at), (s as any).tz_identifier || SYDNEY_TZ, 'EEE') : format(parseISO(s.shift_date), 'EEE'),
                startTime: (s as any).start_at ? formatInTimezone(new Date((s as any).start_at), (s as any).tz_identifier || SYDNEY_TZ, 'HH:mm') : s.start_time.slice(0, 5),
                endTime: (s as any).end_at ? formatInTimezone(new Date((s as any).end_at), (s as any).tz_identifier || SYDNEY_TZ, 'HH:mm') : s.end_time.slice(0, 5),
                startAt: (s as any).start_at,
                endAt: (s as any).end_at,
                tzIdentifier: (s as any).tz_identifier,
                paidBreak,
                unpaidBreak,
                netLength,
                remunerationLevel: s.remuneration_levels?.level_name || 'Level-4',
                status: b.status as any,
                bidTime: format(parseISO(b.created_at), 'yyyy-MM-dd HH:mm'),
                notes: b.notes,
                groupType: s.group_type,
                stateId: (s as any).stateId || determineShiftState(s as any),
                subGroupColor: getDeptColor(s.group_type, s.departments?.name || '')
            };
        }).filter(Boolean) as BidData[];
    }, [rawMyBids]);


    // ========================================================================
    // SORTING
    // ========================================================================
    const shiftsTableSort = useTableSorting(availableShifts, { key: 'date', direction: 'asc' });
    const bidsTableSort = useTableSorting(myBids, { key: 'bidTime', direction: 'desc' });

    // ========================================================================
    // FILTERS
    // ========================================================================
    const filteredAvailableShifts = shiftsTableSort.sortedData;
    const filteredMyBids = React.useMemo(() => {
        return bidsTableSort.sortedData.filter(bid => {
            if (myBidsSubToggle === 'pending') return bid.status === 'pending';
            if (myBidsSubToggle === 'accepted') return bid.status === 'accepted';
            if (myBidsSubToggle === 'rejected') return bid.status === 'rejected';
            return true;
        });
    }, [bidsTableSort.sortedData, myBidsSubToggle]);

    // ========================================================================
    // SELECTION HANDLERS
    // ========================================================================
    const handleSelectAllAvailable = (isChecked: boolean) => {
        const eligibleShifts = availableShifts.filter(s => {
            const isDroppedByMe = user?.id === s.droppedById;
            return s.isEligible && !isDroppedByMe;
        }).map(s => s.id);
        setSelectedBidIds(isChecked ? eligibleShifts : []);
    };

    const handleSelectAllMyBids = (isChecked: boolean) => {
        const allBidIds = myBids.map(b => b.id);
        setSelectedBidIds(isChecked ? allBidIds : []);
    };

    const handleSelectBid = (id: any) => {
        setSelectedBidIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
    };

    // ========================================================================
    // COMPLIANCE CHECK HANDLER
    // ========================================================================
    const checkComplianceAndBid = async (shift: ShiftData) => {
        if (!user) return;
        setCheckingShiftId(shift.id);
        try {
            const result = await validateCompliance({
                employeeId: user.id,
                shiftDate: shift.date,
                startTime: shift.startTime + ':00',
                endTime: shift.endTime + ':00',
                netLengthMinutes: shift.netLength,
                shiftId: shift.id,
            });
            setCheckingShiftId(null);

            if (result.status === 'violated') {
                // Blocking violation
                setComplianceResult(result);
                setPendingBidShift(shift);
                setShowComplianceDialog(true);
            } else if (result.status === 'warned') {
                // Soft warning - show dialog but allow proceed
                setComplianceResult(result);
                setPendingBidShift(shift);
                setShowComplianceDialog(true);
            } else {
                // All clear - proceed to bid
                placeBidMutation.mutate(shift.id);
            }
        } catch (e) {
            setCheckingShiftId(null);
            // If compliance check fails, allow bid anyway with toast warning
            toast({ title: 'Compliance Check Unavailable', description: 'Proceeding with bid.', variant: 'default' });
            placeBidMutation.mutate(shift.id);
        }
    };

    const handleConfirmBidWithWarning = () => {
        if (pendingBidShift) {
            placeBidMutation.mutate(pendingBidShift.id);
        }
        setShowComplianceDialog(false);
        setPendingBidShift(null);
        setComplianceResult(null);
    };

    const handleCancelBid = () => {
        setShowComplianceDialog(false);
        setPendingBidShift(null);
        setComplianceResult(null);
    };

    // ========================================================================
    // ACTION HANDLERS
    // ========================================================================
    const handleBidForShift = (shiftId: string) => {
        // Find the shift data to pass to compliance check
        const shift = availableShifts.find(s => String(s.id) === String(shiftId));
        if (shift) {
            checkComplianceAndBid(shift);
        } else {
            placeBidMutation.mutate(shiftId);
        }
    };

    const handleWithdrawBid = (bidId: string) => {
        withdrawBidMutation.mutate(bidId);
    };

    const handleBulkExpressInterest = () => {
        // Filter out shifts that the user has dropped or are otherwise ineligible
        const validIds = selectedBidIds.filter(id => {
            const shift = availableShifts.find(s => s.id === id);
            if (!shift) return false;
            const isDroppedByMe = user?.id === shift.droppedById;
            return !isDroppedByMe;
        });

        if (validIds.length === 0 && selectedBidIds.length > 0) {
            toast({ 
                title: 'Bidding Restricted', 
                description: 'None of the selected shifts can be bid on (compliance or previously dropped).',
                variant: 'destructive'
            });
            return;
        }

        validIds.forEach(id => placeBidMutation.mutate(id));
        setSelectedBidIds([]);
    };

    const handleBulkWithdraw = () => {
        selectedBidIds.forEach(id => handleWithdrawBid(id));
        setSelectedBidIds([]);
    };


    // ========================================================================
    // RENDER CARD (Shared between Available and My Bids)
    // ========================================================================
    const renderShiftCard = (shift: ShiftData, isBidCard: boolean = false, bidStatus?: string) => {
        const existingBid = myBids.find(b => String(b.shiftId) === String(shift.id) && b.status !== 'withdrawn');
        const isBidPlaced = !!existingBid;

        // Calculate bidding closes:
        const shiftStart = shift.startAt
            ? new Date(shift.startAt)
            : parseZonedDateTime(shift.date, shift.startTime, SYDNEY_TZ);

        // Bidding closes 4 hours before shift start
        const biddingCloses = new Date(shiftStart.getTime() - 4 * 60 * 60 * 1000);
        const now = new Date(); // Absolute now
        const isExpired = now >= biddingCloses;
        const msUntilClose = biddingCloses.getTime() - now.getTime();

        return (
            <motion.div
                key={shift.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className={`p-4 rounded-lg border relative ${getCardBg(shift.groupType, shift.department)} transition-all duration-300`}
            >
                {/* CHECKBOX + COMPLIANCE BADGE */}
                <div className="flex items-center mb-3">
                    <input
                        type="checkbox"
                        checked={selectedBidIds.includes(shift.id)}
                        onChange={() => handleSelectBid(shift.id)}
                        disabled={!isBidCard && !shift.isEligible}
                        className="mr-2 h-4 w-4"
                    />
                    <span className="text-xs text-slate-500 dark:text-white/60">Select</span>


                    {/* Bid Status Badge - only for my bids */}
                    {isBidCard && bidStatus && (
                        <div className="ml-auto">
                            <BidStatusBadge status={bidStatus as any} />
                        </div>
                    )}
                </div>

                {/* SUB-GROUP BADGE */}
                {shift.subGroup && shift.subGroup !== 'General' && (
                    <div className="mb-2">
                        <Badge variant="outline" className={`text-[10px] px-2 py-0.5 font-medium border ${shift.subGroupColor}`}>
                            {shift.subGroup}
                        </Badge>
                    </div>
                )}

                {/* BREADCRUMB: Org → Dept → SubDept */}
                <div className="text-[10px] text-slate-500 dark:text-white/50 mb-1 flex items-center gap-1">
                    <span>{shift.organization}</span>
                    <span>→</span>
                    <span>{shift.department}</span>
                    {shift.subGroup && shift.subGroup !== 'General' && (
                        <>
                            <span>→</span>
                            <span>{shift.subGroup}</span>
                        </>
                    )}
                </div>

                {/* ROLE */}
                <h3 className="font-semibold text-slate-900 dark:text-white text-base mb-3">{shift.role}</h3>

                {/* DATE */}
                <div className="flex items-center text-sm text-slate-700 dark:text-white/80 mb-2">
                    <Calendar size={14} className="text-slate-400 dark:text-white/50 mr-2" />
                    <span>{shift.date} ({shift.weekday})</span>
                </div>

                {/* TIMINGS */}
                <div className="flex items-center text-sm text-slate-700 dark:text-white/80 mb-2">
                    <Clock size={14} className="text-slate-400 dark:text-white/50 mr-2" />
                    <span>{shift.startTime} - {shift.endTime}</span>
                </div>

                {/* BREAKS */}
                <div className="flex items-center text-sm text-slate-700 dark:text-white/80 mb-2">
                    <Coffee size={14} className="text-slate-400 dark:text-white/50 mr-2" />
                    <span>Paid: {shift.paidBreak}m | Unpaid: {shift.unpaidBreak}m</span>
                </div>

                {/* NET LENGTH */}
                <div className="bg-slate-100 dark:bg-white/5 rounded px-2 py-1 mb-2 text-xs text-slate-500 dark:text-white/70">
                    Net Length: <span className="font-bold text-slate-800 dark:text-white">{Math.round(shift.netLength)}m</span> ({(shift.netLength / 60).toFixed(1)}h)
                </div>

                {/* BIDDING WINDOW COUNTDOWN */}
                {msUntilClose > 0 && (
                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-500/30 rounded px-2 py-1 mb-3 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1">
                        <Clock size={12} />
                        <span>Closes in {(() => {
                            const hours = Math.floor(msUntilClose / (1000 * 60 * 60));
                            const mins = Math.floor((msUntilClose % (1000 * 60 * 60)) / (1000 * 60));
                            if (hours > 0) return `${hours}h ${mins}m`;
                            return `${mins}m`;
                        })()}</span>
                    </div>
                )}
                {isExpired && (
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded px-2 py-1 mb-3 text-xs text-red-700 dark:text-red-300 flex items-center gap-1">
                        <Ban size={12} />
                        <span>Bidding Closed</span>
                    </div>
                )}

                {/* STATUS INDICATORS ROW */}
                <div className="bg-slate-50 dark:bg-[#0f172a]/50 rounded-lg border border-slate-200 dark:border-white/5 p-2 mb-4">
                    <div className="grid grid-cols-6 gap-1 items-center">
                        {/* 1. ID */}
                        <div className="flex flex-col items-center justify-center p-1 rounded hover:bg-slate-100 dark:hover:bg-white/5 transition-colors" title={`State Code: ${shift.stateId || 'Unknown'}`}>
                            <div className="w-3.5 h-3.5 flex items-center justify-center font-mono text-[9px] font-bold text-slate-400 dark:text-white/40 border border-slate-300 dark:border-white/20 rounded mb-0.5">#</div>
                            <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 leading-none">{shift.stateId || 'S?'}</span>
                        </div>

                        {/* 2. LIFECYCLE (Set to Published) */}
                        <div className="flex flex-col items-center justify-center p-1 rounded hover:bg-slate-100 dark:hover:bg-white/5 transition-colors" title="Lifecycle: Published">
                            <Megaphone className="w-3.5 h-3.5 text-blue-500 mb-0.5" />
                            <span className="text-[8px] text-slate-400 dark:text-gray-500 font-bold uppercase tracking-tighter">PUB</span>
                        </div>

                        {/* 3. ASSIGNMENT */}
                        <div className="flex flex-col items-center justify-center p-1 rounded hover:bg-slate-100 dark:hover:bg-white/5 transition-colors" title={shift.assignedTo ? `Assigned to ${shift.assignedTo}` : 'Unassigned'}>
                            {shift.assignedTo ? (
                                <UserCheck className="w-3.5 h-3.5 text-green-500 mb-0.5" />
                            ) : (
                                <UserPlus className="w-3.5 h-3.5 text-amber-500 mb-0.5" />
                            )}
                            <span className="text-[8px] text-slate-400 dark:text-gray-500 font-bold uppercase tracking-tighter">{shift.assignedTo ? 'ASN' : 'VAC'}</span>
                        </div>

                        {/* 4. OFFER (Status Indicator) */}
                        <div className="flex flex-col items-center justify-center p-1 rounded hover:bg-slate-100 dark:hover:bg-white/5 transition-colors" title="Offer Status: None">
                            <Circle className="w-3.5 h-3.5 text-slate-400 dark:text-gray-600 mb-0.5" />
                            <span className="text-[8px] text-slate-400 dark:text-gray-600 font-bold uppercase tracking-tighter">OFF</span>
                        </div>

                        {/* 5. BIDDING (Priority) */}
                        <div className="flex flex-col items-center justify-center p-1 rounded hover:bg-slate-100 dark:hover:bg-white/5 transition-colors" title={`Bidding: ${shift.isUrgent ? 'Urgent' : 'Normal'}`}>
                            {shift.isUrgent ? (
                                <Flame className="w-3.5 h-3.5 text-red-500 mb-0.5" />
                            ) : (
                                <Gavel className="w-3.5 h-3.5 text-blue-500 mb-0.5" />
                            )}
                            <span className={cn(
                                "text-[8px] font-bold uppercase tracking-tighter",
                                shift.isUrgent ? "text-red-500" : "text-blue-500"
                            )}>
                                {shift.isUrgent ? 'URG' : 'NRM'}
                            </span>
                        </div>

                        {/* 6. TRADE */}
                        <div className="flex flex-col items-center justify-center p-1 rounded hover:bg-slate-100 dark:hover:bg-white/5 transition-colors" title="Trade: None">
                            <Minus className="w-3.5 h-3.5 text-slate-400 dark:text-gray-600 mb-0.5" />
                            <span className="text-[8px] text-slate-400 dark:text-gray-600 font-bold uppercase tracking-tighter">TRD</span>
                        </div>
                    </div>
                </div>

                {/* ACTION BUTTONS - Two-button layout */}
                {isBidCard ? (
                    // My Bids tab: Show log status instead of buttons
                    bidStatus === 'pending' ? (
                        <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400 text-sm font-medium">
                            <Clock className="h-4 w-4" /> Awaiting Manager Review
                        </div>
                    ) : bidStatus === 'accepted' ? (
                        <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-sm font-medium">
                            <CheckCircle className="h-4 w-4" /> Shift Won — Assigned to You
                        </div>
                    ) : (
                        <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-400 dark:text-white/40 text-sm">
                            <Ban className="h-4 w-4" /> Bid Not Selected
                        </div>
                    )
                ) : isExpired ? (
                    // Bidding closed
                    <Button disabled className="w-full bg-white/10 text-white/50">
                        <Ban className="mr-2 h-4 w-4" /> Closed
                    </Button>
                ) : (
                    <div className="flex gap-2">
                        {/* Integrated Check & Bid Button */}
                        {isBidPlaced ? (
                            <Button
                                variant="outline"
                                className="w-full border-white/10 hover:bg-red-500/10 hover:text-red-400"
                                onClick={() => handleWithdrawBid(existingBid!.id)}
                            >
                                <XCircle className="mr-1.5 h-4 w-4" /> Withdraw Interest
                            </Button>
                        ) : (
                            <Button
                                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/20 font-bold"
                                onClick={() => {
                                    setComplianceModalShift(shift);
                                    setIsComplianceModalOpen(true);
                                }}
                            >
                                <Shield className="mr-1.5 h-4 w-4" /> Check Compliance & Bid
                            </Button>
                        )}
                    </div>
                )}
            </motion.div>
        );
    };

    // ========================================================================
    // RENDER
    // ========================================================================
    return (
        <div className="w-full text-foreground">
            {/* FILTER BAR */}
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
                    { id: 'available', label: 'Available Shifts', count: filteredAvailableShifts.length },
                    {
                        id: 'myBids',
                        label: 'My Bids',
                        count: filteredMyBids.length,
                        subContent: (
                            <div className="flex bg-slate-100 dark:bg-white/5 p-1 rounded-lg border border-slate-200 dark:border-white/10">
                                {['pending', 'accepted', 'rejected'].map(status => (
                                    <button
                                        key={status}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setMyBidsSubToggle(status as any);
                                        }}
                                        className={cn(
                                            "px-3 py-1 text-[11px] font-medium rounded-md capitalize transition-colors",
                                            myBidsSubToggle === status
                                                ? "bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400"
                                                : "text-slate-500 dark:text-white/50 hover:text-slate-800 dark:hover:text-white/80 hover:bg-slate-200 dark:hover:bg-white/5"
                                        )}
                                    >
                                        {status}
                                    </button>
                                ))}
                            </div>
                        )
                    }
                ]}
                activeTab={activeTab}
                onTabChange={(id) => setActiveTab(id as any)}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                onRefresh={() => {
                    queryClient.invalidateQueries({ queryKey: ['openBidShifts'] });
                    queryClient.invalidateQueries({ queryKey: ['myBids'] });
                }}
                className="mb-6"
            />




            {/* NEW: Tabs Wrapper */}
            <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as typeof activeTab)} className="space-y-4">
                {/* TAB: Available Shifts */}
                <TabsContent value="available" className="space-y-4">
                    <div className="relative mb-6 overflow-hidden rounded-xl border-l-[3px] border-l-blue-500 bg-gradient-to-r from-blue-50 dark:from-blue-500/10 via-blue-50/50 dark:via-blue-900/5 to-transparent p-4 backdrop-blur-sm">
                        <div className="flex items-start gap-3">
                            <div className="rounded-full bg-blue-100 dark:bg-blue-500/20 p-1.5 ring-1 ring-blue-200 dark:ring-blue-500/30">
                                <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                            </div>
                            <div className="space-y-1">
                                <h4 className="text-sm font-medium text-blue-700 dark:text-blue-200">Available Shifts</h4>
                                <p className="text-sm text-blue-600/80 dark:text-blue-200/70 leading-relaxed max-w-2xl">
                                    Browse and bid on shifts matching your role and department. Use the global scope to refine your view.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-2 items-center">
                        <div className="flex items-center bg-slate-100 dark:bg-white/5 px-2 py-1 rounded border border-slate-200 dark:border-white/10">
                            <input
                                type="checkbox"
                                checked={filteredAvailableShifts.length > 0 && filteredAvailableShifts.every(s => selectedBidIds.includes(s.id))}
                                onChange={(e) => handleSelectAllAvailable(e.target.checked)}
                                className="mr-2 h-3 w-3"
                            />
                            <span className="text-xs text-slate-600 dark:text-white/70">Select All</span>
                        </div>
                        <Button size="sm" onClick={handleBulkExpressInterest} disabled={selectedBidIds.length === 0}>
                            Express Interest ({selectedBidIds.length})
                        </Button>
                    </div>

                    {viewMode === 'card' ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {filteredAvailableShifts.map(shift => renderShiftCard(shift, false))}
                            {filteredAvailableShifts.length === 0 && (
                                <div className="col-span-full text-center py-8 text-slate-400 dark:text-white/50">No shifts match filters.</div>
                            )}
                        </div>
                    ) : (
                        <div className="overflow-x-auto border border-slate-200 dark:border-white/10 rounded-lg">
                            <table className="w-full text-sm text-slate-800 dark:text-white">
                                <thead className="bg-slate-100 dark:bg-black/40 text-xs">
                                    <tr>
                                        <th className="p-3 text-left w-[40px]">
                                            <input
                                                type="checkbox"
                                                checked={filteredAvailableShifts.length > 0 && filteredAvailableShifts.every(s => selectedBidIds.includes(s.id))}
                                                onChange={(e) => handleSelectAllAvailable(e.target.checked)}
                                            />
                                        </th>
                                        <SortableTableHeader sortKey="department" currentSort={shiftsTableSort.sortConfig} onSort={shiftsTableSort.handleSort}>Dept</SortableTableHeader>
                                        <SortableTableHeader sortKey="subGroup" currentSort={shiftsTableSort.sortConfig} onSort={shiftsTableSort.handleSort}>Sub</SortableTableHeader>
                                        <SortableTableHeader sortKey="role" currentSort={shiftsTableSort.sortConfig} onSort={shiftsTableSort.handleSort}>Role</SortableTableHeader>
                                        <SortableTableHeader sortKey="date" currentSort={shiftsTableSort.sortConfig} onSort={shiftsTableSort.handleSort}>Date</SortableTableHeader>
                                        <th className="p-3 text-left">Time</th>
                                        <th className="p-3 text-left">Net</th>
                                        <th className="p-3 text-left w-[200px]">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredAvailableShifts.map(shift => {
                                        const existingBid = myBids.find(b => String(b.shiftId) === String(shift.id) && b.status !== 'withdrawn');
                                        const isBidPlaced = !!existingBid;
                                        const isDroppedByMe = user?.id === shift.droppedById;
                                        const canBid = !isDroppedByMe;
                                        const blockReason = "You cannot bid on a shift you dropped";

                                        // Calculate expired status securely using ZonedDateTime
                                        const shiftStart = parseZonedDateTime(shift.date, shift.startTime, SYDNEY_TZ);
                                        const biddingCloses = new Date(shiftStart.getTime() - 4 * 60 * 60 * 1000);
                                        const now = new Date();
                                        const isExpired = now >= biddingCloses;

                                        return (
                                            <tr key={shift.id} className="border-t border-slate-100 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5">
                                                <td className="p-3"><input type="checkbox" checked={selectedBidIds.includes(shift.id)} onChange={() => handleSelectBid(shift.id)} disabled={!shift.isEligible} /></td>
                                                <td className="p-3">{shift.department}</td>
                                                <td className="p-3">{shift.subGroup}</td>
                                                <td className="p-3">{shift.role}</td>
                                                <td className="p-3">{shift.date}</td>
                                                <td className="p-3">{shift.startTime}-{shift.endTime}</td>
                                                <td className="p-3">{Math.round(shift.netLength)}m</td>
                                                <td className="p-3">
                                                    {isExpired ? (
                                                        <Button disabled size="sm" className="w-full bg-slate-200 dark:bg-white/10 text-slate-400 dark:text-white/50 h-8 text-xs">
                                                            <Ban className="mr-1.5 h-3 w-3" /> Closed
                                                        </Button>
                                                    ) : (
                                                        <div className="flex gap-2">
                                                            {/* Check Button */}
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                className="h-8 text-xs flex-1 border-slate-200 dark:border-white/10 hover:bg-purple-50 dark:hover:bg-purple-500/10 hover:text-purple-600 dark:hover:text-purple-400"
                                                                onClick={() => {
                                                                    setComplianceModalShift(shift);
                                                                    setIsComplianceModalOpen(true);
                                                                }}
                                                            >
                                                                <Shield className="mr-1 h-3 w-3" /> Check
                                                            </Button>

                                                            {/* Action Button */}
                                                            {isBidPlaced ? (
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="h-8 text-xs flex-1 border-slate-200 dark:border-white/10 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                                                                    onClick={() => handleWithdrawBid(existingBid!.id)}
                                                                >
                                                                    <XCircle className="mr-1 h-3 w-3" /> Withdraw
                                                                </Button>
                                                            ) : (
                                                                <Button
                                                                    size="sm"
                                                                    className={cn(
                                                                        "h-8 text-xs flex-1",
                                                                        canBid
                                                                            ? "bg-purple-600 hover:bg-purple-700 text-white"
                                                                            : "bg-slate-200 dark:bg-white/10 text-slate-400 dark:text-white/50 cursor-not-allowed"
                                                                    )}
                                                                    disabled={!canBid || placeBidMutation.isPending}
                                                                    onClick={() => {
                                                                        if (canBid) placeBidMutation.mutate(shift.id);
                                                                    }}
                                                                    title={!canBid ? blockReason : "Express interest"}
                                                                >
                                                                    {placeBidMutation.isPending && placeBidMutation.variables === shift.id ? (
                                                                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                                                    ) : (
                                                                        <ThumbsUp className="mr-1 h-3 w-3" />
                                                                    )}
                                                                    {placeBidMutation.isPending && placeBidMutation.variables === shift.id ? '' : 'Interest'}
                                                                </Button>
                                                            )}
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </TabsContent>

                {/* TAB: My Bids */}
                <TabsContent value="myBids" className="space-y-4">
                    {viewMode === 'card' ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {filteredMyBids.map(bid => {
                                const shiftData: ShiftData = {
                                    ...bid,
                                    assignedTo: null,
                                    isEligible: true,
                                    isUrgent: false,
                                    biddingWindowCloses: null,
                                    biddingWindowOpens: null,
                                    priority: 'normal'
                                };
                                return renderShiftCard(shiftData, true, bid.status);
                            })}
                            {filteredMyBids.length === 0 && (
                                <div className="col-span-full text-center py-8 text-slate-400 dark:text-white/50">No bids yet.</div>
                            )}
                        </div>
                    ) : (
                        <div className="overflow-x-auto border border-slate-200 dark:border-white/10 rounded-lg">
                            <table className="w-full text-sm text-slate-800 dark:text-white">
                                <thead className="bg-slate-100 dark:bg-black/40 text-xs">
                                    <tr>
                                        <th className="p-3 text-left w-[40px]">
                                        </th>
                                        <th className="p-3 text-left">Bid Time</th>
                                        <th className="p-3 text-left">Details</th>
                                        <th className="p-3 text-left">Status</th>
                                        <th className="p-3 text-left">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredMyBids.map(bid => (
                                        <tr key={bid.id} className="border-t border-slate-100 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5">
                                            <td className="p-3"></td>
                                            <td className="p-3 text-xs">{bid.bidTime}</td>
                                            <td className="p-3">
                                                <div className="font-medium">{bid.role}</div>
                                                <div className="text-xs text-slate-500 dark:text-white/50">{bid.department} • {bid.date}</div>
                                            </td>
                                            <td className="p-3"><BidStatusBadge status={bid.status} /></td>
                                            <td className="p-3">
                                                {bid.status === 'pending' ? (
                                                    <span className="text-xs text-amber-400 flex items-center gap-1"><Clock size={14} /> Pending review</span>
                                                ) : bid.status === 'accepted' ? (
                                                    <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle size={14} /> Won</span>
                                                ) : (
                                                    <span className="text-xs text-slate-400 dark:text-white/40 flex items-center gap-1"><Ban size={14} /> Failed</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </TabsContent>
            </Tabs>

            {/* COMPLIANCE CHECK DIALOG */}
            <AlertDialog open={showComplianceDialog} onOpenChange={setShowComplianceDialog}>
                <AlertDialogContent className="bg-background border-border text-foreground max-w-md">
                    <AlertDialogHeader>
                        {complianceResult && complianceResult.status === 'violated' ? (
                            <>
                                <AlertDialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
                                    <XCircle className="h-5 w-5" />
                                    Cannot Place Bid
                                </AlertDialogTitle>
                                <AlertDialogDescription asChild>
                                    <div className="text-muted-foreground">
                                        <span>This shift cannot be accepted due to compliance violations:</span>
                                        <ul className="mt-2 space-y-1 text-red-600 dark:text-red-300">
                                            {complianceResult.violations.map((v, i) => (
                                                <li key={i} className="flex items-start gap-2">
                                                    <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                                                    <span>{v}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                </AlertDialogDescription>
                            </>
                        ) : complianceResult && complianceResult.warnings.length > 0 ? (
                            <>
                                <AlertDialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                                    <AlertTriangle className="h-5 w-5" />
                                    Compliance Warnings
                                </AlertDialogTitle>
                                <AlertDialogDescription asChild>
                                    <div className="text-muted-foreground">
                                        <span>There are potential issues with this shift:</span>
                                        <ul className="mt-2 space-y-1 text-amber-600 dark:text-amber-300">
                                            {complianceResult.warnings.map((w, i) => (
                                                <li key={i} className="flex items-start gap-2">
                                                    <Shield className="h-4 w-4 shrink-0 mt-0.5" />
                                                    <span>{w}</span>
                                                </li>
                                            ))}
                                        </ul>
                                        <p className="mt-3 text-muted-foreground">Do you want to proceed anyway?</p>
                                    </div>
                                </AlertDialogDescription>
                            </>
                        ) : null}
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        {complianceResult && complianceResult.status === 'violated' ? (
                            <AlertDialogAction onClick={handleCancelBid} className="bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/20 text-foreground">
                                Understood
                            </AlertDialogAction>
                        ) : (
                            <>
                                <AlertDialogCancel onClick={handleCancelBid} className="bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/20 border-slate-200 dark:border-white/10">
                                    Cancel
                                </AlertDialogCancel>
                                <AlertDialogAction onClick={handleConfirmBidWithWarning} className="bg-amber-600 hover:bg-amber-700">
                                    Proceed Anyway
                                </AlertDialogAction>
                            </>
                        )}
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* NEW: Compliance Check Modal */}
            <BidComplianceModal
                isOpen={isComplianceModalOpen}
                onClose={() => {
                    setIsComplianceModalOpen(false);
                    setComplianceModalShift(null);
                }}
                shift={complianceModalShift}
                onConfirmBid={() => {
                    if (complianceModalShift) {
                        placeBidMutation.mutate(complianceModalShift.id);
                    }
                    setIsComplianceModalOpen(false);
                    setComplianceModalShift(null);
                }}
                isPending={placeBidMutation.isPending}
            />
        </div >
    );
};

export default EmployeeBidsPage;

