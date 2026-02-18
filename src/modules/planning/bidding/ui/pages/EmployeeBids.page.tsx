import React, { useState } from 'react';
import { useAuth } from '@/platform/auth/useAuth';
import { useOrgSelection } from '@/modules/core/contexts/OrgSelectionContext';
import { useTableSorting } from '@/modules/core/hooks/useTableSorting';
import { SortableTableHeader } from '@/modules/core/ui/primitives/sortable-table-header';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { biddingApi } from '../../api/bidding.api';
import { complianceService, ComplianceValidationResult } from '@/modules/rosters/services/compliance.service';
import {
    Info, Filter as FilterIcon, Columns, List as ListIcon, User,
    Calendar, Clock, ThumbsUp, ShieldAlert, Ban, Flame,
    Megaphone, UserPlus, UserCheck, Circle, Minus, Gavel, Coffee, Shield, Loader2, AlertTriangle, CheckCircle, XCircle
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/modules/core/ui/primitives/tabs';
import { BidStatusBadge } from '../components/BidStatusBadge';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import { useToast } from '@/modules/core/hooks/use-toast';
import { motion } from 'framer-motion';
import { determineShiftState } from '@/modules/rosters/domain/shift-state.utils';
import {
    Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from '@/modules/core/ui/primitives/select';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/modules/core/ui/primitives/alert-dialog';
import { BidComplianceModal } from '../components/BidComplianceModal';
import { BidComplianceBadge } from '../components/BidComplianceBadge';
import { useBulkBidCompliance, BulkComplianceShift } from '../../hooks/useBulkBidCompliance';

import { ScopeFilterBanner } from '@/modules/core/ui/components/ScopeFilterBanner';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';

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
    paidBreak: number;
    unpaidBreak: number;
    netLength: number;
    remunerationLevel: string;
    status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
    bidTime: string;
    notes: string | null;
    groupType?: string | null;
    stateId?: string;
    subGroupColor?: string;
}

// ============================================================================
// HELPERS
// ============================================================================
function getDeptColor(groupType: string | null | undefined, dept: string): string {
    if (groupType === 'convention_centre') return 'border-blue-500/40 text-blue-300';
    if (groupType === 'exhibition_centre') return 'border-green-500/40 text-green-300';
    if (groupType === 'theatre') return 'border-red-500/40 text-red-300';
    const d = dept.toLowerCase();
    if (d.includes('convention')) return 'border-blue-500/40 text-blue-300';
    if (d.includes('exhibition')) return 'border-green-500/40 text-green-300';
    if (d.includes('theatre')) return 'border-red-500/40 text-red-300';
    return 'border-white/20 text-white/60';
}

function getCardBg(groupType: string | null | undefined, dept: string): string {
    if (groupType === 'convention_centre') return 'bg-blue-900/20 border-blue-500/30';
    if (groupType === 'exhibition_centre') return 'bg-green-900/20 border-green-500/30';
    if (groupType === 'theatre') return 'bg-red-900/20 border-red-500/30';
    const d = dept.toLowerCase();
    if (d.includes('convention')) return 'bg-blue-900/20 border-blue-500/30';
    if (d.includes('exhibition')) return 'bg-green-900/20 border-green-500/30';
    if (d.includes('theatre')) return 'bg-red-900/20 border-red-500/30';
    return 'bg-white/5 border-white/10';
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

    // Filters
    const [deptFilter, setDeptFilter] = useState('all');
    const [subDeptFilter, setSubDeptFilter] = useState('all');
    const [roleFilter, setRoleFilter] = useState('all');
    const [tierFilter, setTierFilter] = useState('all');
    const [eligibilityFilter, setEligibilityFilter] = useState('all');

    // Selection
    const [selectedBidIds, setSelectedBidIds] = useState<any[]>([]);

    // Compliance Check State
    const [checkingShiftId, setCheckingShiftId] = useState<string | null>(null);
    const [complianceResult, setComplianceResult] = useState<ComplianceValidationResult | null>(null);
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
            const durationSec = toSeconds(s.end_time) - toSeconds(s.start_time);
            const durationMin = durationSec > 0 ? durationSec / 60 : (durationSec + 86400) / 60;
            const paidBreak = s.paid_break_minutes || 0;
            const unpaidBreak = s.unpaid_break_minutes || 0;
            const netLength = durationMin - unpaidBreak;

            const start = parseISO(s.shift_date + 'T' + s.start_time);
            const timeToStartHours = (start.getTime() - new Date().getTime()) / (1000 * 60 * 60);
            const isUrgent = (s as any).bidding_status === 'on_bidding_urgent' || (s as any).is_urgent || (timeToStartHours > 0 && timeToStartHours < 24);

            return {
                id: s.id,
                role: s.roles?.name || 'Unknown',
                organization: (s as any).organizations?.name || 'MCEC',
                department: s.departments?.name || 'Unknown',
                subGroup: s.sub_departments?.name || 'General',
                date: s.shift_date,
                weekday: format(parseISO(s.shift_date), 'EEE'),
                startTime: s.start_time.slice(0, 5),
                endTime: s.end_time.slice(0, 5),
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
                subGroupColor: getDeptColor(s.group_type, s.departments?.name || '')
            };
        });
    }, [rawAvailableShifts]);

    const myBids: BidData[] = React.useMemo(() => {
        return rawMyBids.map(b => {
            const s = b.shift;
            if (!s) return null;
            const durationSec = toSeconds(s.end_time) - toSeconds(s.start_time);
            const durationMin = durationSec > 0 ? durationSec / 60 : (durationSec + 86400) / 60;
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
                date: s.shift_date,
                weekday: format(parseISO(s.shift_date), 'EEE'),
                startTime: s.start_time.slice(0, 5),
                endTime: s.end_time.slice(0, 5),
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
    // BULK COMPLIANCE CHECKS
    // ========================================================================
    const bulkComplianceShifts: BulkComplianceShift[] = React.useMemo(() => {
        return availableShifts.map(s => ({
            id: s.id,
            date: s.date,
            startTime: s.startTime,
            endTime: s.endTime,
            unpaidBreak: s.unpaidBreak,
        }));
    }, [availableShifts]);

    const {
        results: bulkComplianceResults,
        isLoading: isLoadingCompliance,
        getResultForShift,
    } = useBulkBidCompliance(bulkComplianceShifts);

    // ========================================================================
    // SORTING
    // ========================================================================
    const shiftsTableSort = useTableSorting(availableShifts, { key: 'date', direction: 'asc' });
    const bidsTableSort = useTableSorting(myBids, { key: 'bidTime', direction: 'desc' });

    // ========================================================================
    // FILTERS
    // ========================================================================
    const filterShifts = (items: ShiftData[]) => {
        return items.filter((shift) => {
            if (deptFilter !== 'all' && shift.department !== deptFilter) return false;
            if (subDeptFilter !== 'all' && shift.subGroup !== subDeptFilter) return false;
            if (roleFilter !== 'all' && shift.role !== roleFilter) return false;
            if (tierFilter !== 'all' && shift.remunerationLevel !== tierFilter) return false;
            if (eligibilityFilter === 'eligible' && !shift.isEligible) return false;
            if (eligibilityFilter === 'ineligible' && shift.isEligible) return false;
            return true;
        });
    };

    const filterBids = (items: BidData[]) => {
        return items.filter((bid) => {
            if (deptFilter !== 'all' && bid.department !== deptFilter) return false;
            if (subDeptFilter !== 'all' && bid.subGroup !== subDeptFilter) return false;
            if (roleFilter !== 'all' && bid.role !== roleFilter) return false;
            if (tierFilter !== 'all' && bid.remunerationLevel !== tierFilter) return false;
            return true;
        });
    };

    const filteredAvailableShifts = filterShifts(shiftsTableSort.sortedData);
    const filteredMyBids = filterBids(bidsTableSort.sortedData);

    // ========================================================================
    // SELECTION HANDLERS
    // ========================================================================
    const handleSelectAllAvailable = (isChecked: boolean) => {
        const eligibleShifts = filterShifts(availableShifts).filter(s => s.isEligible).map(s => s.id);
        setSelectedBidIds(isChecked ? eligibleShifts : []);
    };

    const handleSelectAllMyBids = (isChecked: boolean) => {
        const allBidIds = filterBids(myBids).map(b => b.id);
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
            const result = await complianceService.validateShiftCompliance(
                user.id,
                shift.date,
                shift.startTime + ':00',
                shift.endTime + ':00',
                shift.netLength
            );
            setCheckingShiftId(null);

            if (!result.isValid) {
                // Blocking violation
                setComplianceResult(result);
                setPendingBidShift(shift);
                setShowComplianceDialog(true);
            } else if (result.warnings.length > 0) {
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
        // For bulk, run compliance check on first, then proceed sequentially
        // Simplified: just bid without check for bulk (can be enhanced later)
        selectedBidIds.forEach(id => placeBidMutation.mutate(id));
        setSelectedBidIds([]);
    };

    const handleBulkWithdraw = () => {
        selectedBidIds.forEach(id => handleWithdrawBid(id));
        setSelectedBidIds([]);
    };

    const clearFilters = () => {
        setDeptFilter('all');
        setSubDeptFilter('all');
        setRoleFilter('all');
        setTierFilter('all');
        setEligibilityFilter('all');
    };

    // ========================================================================
    // RENDER CARD (Shared between Available and My Bids)
    // ========================================================================
    const renderShiftCard = (shift: ShiftData, isBidCard: boolean = false, bidStatus?: string) => {
        const existingBid = myBids.find(b => String(b.shiftId) === String(shift.id) && b.status !== 'withdrawn');
        const isBidPlaced = !!existingBid;

        // Calculate bidding closes: 4 hours before shift start
        const shiftStart = new Date(`${shift.date}T${shift.startTime}:00`);
        const biddingCloses = new Date(shiftStart.getTime() - 4 * 60 * 60 * 1000);
        const now = new Date();
        const isExpired = now >= biddingCloses;
        const msUntilClose = biddingCloses.getTime() - now.getTime();

        return (
            <motion.div
                key={shift.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className={`p-4 rounded-lg border ${getCardBg(shift.groupType, shift.department)} transition-all duration-300`}
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
                    <span className="text-xs text-white/60">Select</span>

                    {/* Compliance Badge - only for available shifts */}
                    {!isBidCard && (
                        <div className="ml-auto">
                            {(() => {
                                const compResult = getResultForShift(shift.id);
                                if (isLoadingCompliance) {
                                    return <BidComplianceBadge status="loading" passedCount={0} totalCount={8} />;
                                }
                                if (!compResult) {
                                    return <BidComplianceBadge status="unknown" passedCount={0} totalCount={8} />;
                                }
                                return (
                                    <BidComplianceBadge
                                        status={compResult.status}
                                        passedCount={compResult.passedCount}
                                        totalCount={compResult.totalCount}
                                    />
                                );
                            })()}
                        </div>
                    )}

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
                <div className="text-[10px] text-white/50 mb-1 flex items-center gap-1">
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
                <h3 className="font-semibold text-white text-base mb-3">{shift.role}</h3>

                {/* DATE */}
                <div className="flex items-center text-sm text-white/80 mb-2">
                    <Calendar size={14} className="text-white/50 mr-2" />
                    <span>{shift.date} ({shift.weekday})</span>
                </div>

                {/* TIMINGS */}
                <div className="flex items-center text-sm text-white/80 mb-2">
                    <Clock size={14} className="text-white/50 mr-2" />
                    <span>{shift.startTime} - {shift.endTime}</span>
                </div>

                {/* BREAKS */}
                <div className="flex items-center text-sm text-white/80 mb-2">
                    <Coffee size={14} className="text-white/50 mr-2" />
                    <span>Paid: {shift.paidBreak}m | Unpaid: {shift.unpaidBreak}m</span>
                </div>

                {/* NET LENGTH */}
                <div className="bg-white/5 rounded px-2 py-1 mb-2 text-xs text-white/70">
                    Net Length: <span className="font-bold text-white">{Math.round(shift.netLength)}m</span> ({(shift.netLength / 60).toFixed(1)}h)
                </div>

                {/* BIDDING WINDOW COUNTDOWN */}
                {msUntilClose > 0 && (
                    <div className="bg-amber-900/20 border border-amber-500/30 rounded px-2 py-1 mb-3 text-xs text-amber-300 flex items-center gap-1">
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
                    <div className="bg-red-900/20 border border-red-500/30 rounded px-2 py-1 mb-3 text-xs text-red-300 flex items-center gap-1">
                        <Ban size={12} />
                        <span>Bidding Closed</span>
                    </div>
                )}

                {/* ICONS GRID (3x2) */}
                <div className="bg-[#0f172a] rounded-lg border border-white/10 p-2 mb-4">
                    <div className="grid grid-cols-3 gap-y-2 gap-x-1 text-center">
                        {/* ID */}
                        <div className="flex flex-col items-center gap-0.5">
                            <div className="w-4 h-4 flex items-center justify-center font-mono text-[10px] text-white/40 border border-white/20 rounded">#</div>
                            <span className="text-[9px] font-bold text-blue-400">{shift.stateId || 'S?'}</span>
                        </div>
                        {/* LIFECYCLE */}
                        <div className="flex flex-col items-center gap-0.5">
                            <Megaphone className="w-4 h-4 text-blue-500" />
                            <span className="text-[9px] text-gray-400">Published</span>
                        </div>
                        {/* ASSIGNMENT */}
                        <div className="flex flex-col items-center gap-0.5">
                            {shift.assignedTo ? <UserCheck className="w-4 h-4 text-green-500" /> : <UserPlus className="w-4 h-4 text-amber-500" />}
                            <span className="text-[9px] text-gray-400">{shift.assignedTo ? 'Assigned' : 'Unassigned'}</span>
                        </div>
                        {/* OFFER */}
                        <div className="flex flex-col items-center gap-0.5">
                            <Circle className="w-4 h-4 text-gray-400" />
                            <span className="text-[9px] text-gray-400">-</span>
                        </div>
                        {/* BIDDING */}
                        <div className="flex flex-col items-center gap-0.5">
                            {shift.isUrgent ? <Flame className="w-4 h-4 text-red-500" /> : <Gavel className="w-4 h-4 text-blue-500" />}
                            <span className="text-[9px] text-gray-400">{shift.isUrgent ? 'Urgent' : 'Normal'}</span>
                        </div>
                        {/* TRADE */}
                        <div className="flex flex-col items-center gap-0.5">
                            <Minus className="w-4 h-4 text-gray-400" />
                            <span className="text-[9px] text-gray-400">NoTrade</span>
                        </div>
                    </div>
                </div>

                {/* ACTION BUTTONS - Two-button layout */}
                {isBidCard ? (
                    // My Bids tab: just show Withdraw
                    <Button
                        variant="outline"
                        className="w-full border-white/10 hover:bg-red-500/10 hover:text-red-400"
                        onClick={() => handleWithdrawBid(shift.id)}
                    >
                        Withdraw Bid
                    </Button>
                ) : isExpired ? (
                    // Bidding closed
                    <Button disabled className="w-full bg-white/10 text-white/50">
                        <Ban className="mr-2 h-4 w-4" /> Closed
                    </Button>
                ) : (
                    // Available shifts: Two-button layout
                    <div className="flex gap-2">
                        {/* Check Compliance Button */}
                        <Button
                            variant="outline"
                            className="flex-1 border-white/10 hover:bg-purple-500/10 hover:text-purple-400"
                            onClick={() => {
                                setComplianceModalShift(shift);
                                setIsComplianceModalOpen(true);
                            }}
                        >
                            <Shield className="mr-1.5 h-4 w-4" /> Check
                        </Button>

                        {/* Express Interest / Withdraw Button */}
                        {isBidPlaced ? (
                            <Button
                                variant="outline"
                                className="flex-1 border-white/10 hover:bg-red-500/10 hover:text-red-400"
                                onClick={() => handleWithdrawBid(existingBid!.id)}
                            >
                                <XCircle className="mr-1.5 h-4 w-4" /> Withdraw
                            </Button>
                        ) : (() => {
                            const compResult = getResultForShift(shift.id);
                            const canBid = !compResult || compResult.status !== 'fail';
                            const isBlocked = compResult?.status === 'fail';

                            return (
                                <Button
                                    className={cn(
                                        "flex-1",
                                        canBid
                                            ? "bg-purple-600 hover:bg-purple-700 text-white"
                                            : "bg-white/10 text-white/50 cursor-not-allowed"
                                    )}
                                    disabled={isBlocked || placeBidMutation.isPending}
                                    onClick={() => {
                                        if (canBid) {
                                            placeBidMutation.mutate(shift.id);
                                        }
                                    }}
                                    title={isBlocked ? "Compliance check failed - cannot bid" : "Express interest in this shift"}
                                >
                                    {placeBidMutation.isPending && placeBidMutation.variables === shift.id ? (
                                        <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Bidding...</>
                                    ) : (
                                        <><ThumbsUp className="mr-1.5 h-4 w-4" /> Interest</>
                                    )}
                                </Button>
                            );
                        })()}
                    </div>
                )}
            </motion.div>
        );
    };

    // ========================================================================
    // RENDER
    // ========================================================================
    return (
        <div className="min-h-screen w-full p-4 md:p-8">
            {/* FILTER BAR */}
            <div className="flex flex-wrap items-center gap-3 mb-6">
                <div className="flex items-center space-x-2 text-white/80 font-semibold">
                    <FilterIcon size={18} />
                    <span className="text-sm">Filters:</span>
                </div>

                <Select value={deptFilter} onValueChange={setDeptFilter}>
                    <SelectTrigger className="w-[140px] bg-white/5 border-white/10 text-white/80 text-xs h-8">
                        <SelectValue placeholder="Department" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Depts</SelectItem>
                        <SelectItem value="Convention Centre">Convention Centre</SelectItem>
                        <SelectItem value="Exhibition Centre">Exhibition Centre</SelectItem>
                        <SelectItem value="Theatre">Theatre</SelectItem>
                    </SelectContent>
                </Select>

                <Select value={subDeptFilter} onValueChange={setSubDeptFilter}>
                    <SelectTrigger className="w-[120px] bg-white/5 border-white/10 text-white/80 text-xs h-8">
                        <SelectValue placeholder="Sub-Dept" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="AM Base">AM Base</SelectItem>
                        <SelectItem value="PM Base">PM Base</SelectItem>
                        <SelectItem value="Bump-In">Bump-In</SelectItem>
                    </SelectContent>
                </Select>

                <Select value={roleFilter} onValueChange={setRoleFilter}>
                    <SelectTrigger className="w-[120px] bg-white/5 border-white/10 text-white/80 text-xs h-8">
                        <SelectValue placeholder="Role" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Roles</SelectItem>
                        <SelectItem value="Team Leader">Team Leader</SelectItem>
                        <SelectItem value="TM3">TM3</SelectItem>
                        <SelectItem value="TM2">TM2</SelectItem>
                    </SelectContent>
                </Select>

                {activeTab === 'available' && (
                    <Select value={eligibilityFilter} onValueChange={setEligibilityFilter}>
                        <SelectTrigger className="w-[100px] bg-white/5 border-white/10 text-white/80 text-xs h-8">
                            <SelectValue placeholder="Eligibility" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="eligible">Eligible</SelectItem>
                            <SelectItem value="ineligible">Ineligible</SelectItem>
                        </SelectContent>
                    </Select>
                )}

                <Button variant="ghost" size="sm" className="text-xs text-white/60" onClick={clearFilters}>
                    Clear
                </Button>

                <div className="ml-auto flex items-center gap-2">
                    <Button variant={viewMode === 'card' ? 'secondary' : 'ghost'} size="sm" onClick={() => setViewMode('card')}>
                        <Columns size={14} className="mr-1" /> Cards
                    </Button>
                    <Button variant={viewMode === 'table' ? 'secondary' : 'ghost'} size="sm" onClick={() => setViewMode('table')}>
                        <ListIcon size={14} className="mr-1" /> Table
                    </Button>
                </div>
            </div>


            {/* Scope Filter */}
            <ScopeFilterBanner
                mode="personal"
                onScopeChange={setScope}
                hidden={isGammaLocked}
                className="mb-6"
            />

            {/* TABS */}
            <Tabs defaultValue="available" value={activeTab} onValueChange={(val) => setActiveTab(val as typeof activeTab)}>
                <TabsList className="bg-black/20 border border-white/10 mb-6">
                    <TabsTrigger value="available" className="data-[state=active]:bg-white/10">
                        Available Shifts ({filteredAvailableShifts.length})
                    </TabsTrigger>
                    <TabsTrigger value="myBids" className="data-[state=active]:bg-white/10">
                        My Bids ({filteredMyBids.length})
                    </TabsTrigger>
                </TabsList>

                {/* TAB: Available Shifts */}
                <TabsContent value="available" className="space-y-4">
                    <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-3 flex items-start text-sm">
                        <Info className="text-blue-400 mr-2 mt-0.5 shrink-0" size={16} />
                        <p className="text-white/80">
                            Bid on shifts matching your role and department. Use filters to narrow results.
                        </p>
                    </div>

                    <div className="flex gap-2 items-center">
                        <div className="flex items-center bg-white/5 px-2 py-1 rounded border border-white/10">
                            <input
                                type="checkbox"
                                checked={filteredAvailableShifts.length > 0 && filteredAvailableShifts.every(s => selectedBidIds.includes(s.id))}
                                onChange={(e) => handleSelectAllAvailable(e.target.checked)}
                                className="mr-2 h-3 w-3"
                            />
                            <span className="text-xs text-white/70">Select All</span>
                        </div>
                        <Button size="sm" onClick={handleBulkExpressInterest} disabled={selectedBidIds.length === 0}>
                            Express Interest ({selectedBidIds.length})
                        </Button>
                    </div>

                    {viewMode === 'card' ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {filteredAvailableShifts.map(shift => renderShiftCard(shift, false))}
                            {filteredAvailableShifts.length === 0 && (
                                <div className="col-span-full text-center py-8 text-white/50">No shifts match filters.</div>
                            )}
                        </div>
                    ) : (
                        <div className="overflow-x-auto border border-white/10 rounded-lg">
                            <table className="w-full text-sm text-white">
                                <thead className="bg-black/40 text-xs">
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
                                        <th className="p-3 text-left">Compliance</th>
                                        <th className="p-3 text-left w-[200px]">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredAvailableShifts.map(shift => {
                                        const existingBid = myBids.find(b => String(b.shiftId) === String(shift.id) && b.status !== 'withdrawn');
                                        const isBidPlaced = !!existingBid;
                                        const compResult = getResultForShift(shift.id);
                                        const canBid = !compResult || compResult.status !== 'fail';
                                        const isBlocked = compResult?.status === 'fail';

                                        // Calculate expired status (logic copied from renderCard)
                                        const shiftStart = new Date(`${shift.date}T${shift.startTime}:00`);
                                        const biddingCloses = new Date(shiftStart.getTime() - 4 * 60 * 60 * 1000);
                                        const now = new Date();
                                        const isExpired = now >= biddingCloses;

                                        return (
                                            <tr key={shift.id} className="border-t border-white/10 hover:bg-white/5">
                                                <td className="p-3"><input type="checkbox" checked={selectedBidIds.includes(shift.id)} onChange={() => handleSelectBid(shift.id)} disabled={!shift.isEligible} /></td>
                                                <td className="p-3">{shift.department}</td>
                                                <td className="p-3">{shift.subGroup}</td>
                                                <td className="p-3">{shift.role}</td>
                                                <td className="p-3">{shift.date}</td>
                                                <td className="p-3">{shift.startTime}-{shift.endTime}</td>
                                                <td className="p-3">{Math.round(shift.netLength)}m</td>
                                                <td className="p-3">
                                                    {isLoadingCompliance ? (
                                                        <BidComplianceBadge status="loading" passedCount={0} totalCount={8} />
                                                    ) : compResult ? (
                                                        <BidComplianceBadge
                                                            status={compResult.status}
                                                            passedCount={compResult.passedCount}
                                                            totalCount={compResult.totalCount}
                                                        />
                                                    ) : (
                                                        <BidComplianceBadge status="unknown" passedCount={0} totalCount={8} />
                                                    )}
                                                </td>
                                                <td className="p-3">
                                                    {isExpired ? (
                                                        <Button disabled size="sm" className="w-full bg-white/10 text-white/50 h-8 text-xs">
                                                            <Ban className="mr-1.5 h-3 w-3" /> Closed
                                                        </Button>
                                                    ) : (
                                                        <div className="flex gap-2">
                                                            {/* Check Button */}
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                className="h-8 text-xs flex-1 border-white/10 hover:bg-purple-500/10 hover:text-purple-400"
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
                                                                    className="h-8 text-xs flex-1 border-white/10 hover:bg-red-500/10 hover:text-red-400"
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
                                                                            : "bg-white/10 text-white/50 cursor-not-allowed"
                                                                    )}
                                                                    disabled={isBlocked || placeBidMutation.isPending}
                                                                    onClick={() => {
                                                                        if (canBid) placeBidMutation.mutate(shift.id);
                                                                    }}
                                                                    title={isBlocked ? "Compliance check failed" : "Express interest"}
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
                    <div className="flex gap-2 items-center">
                        <div className="flex items-center bg-white/5 px-2 py-1 rounded border border-white/10">
                            <input
                                type="checkbox"
                                checked={filteredMyBids.length > 0 && filteredMyBids.every(b => selectedBidIds.includes(b.id))}
                                onChange={(e) => handleSelectAllMyBids(e.target.checked)}
                                className="mr-2 h-3 w-3"
                            />
                            <span className="text-xs text-white/70">Select All</span>
                        </div>
                        <Button size="sm" variant="destructive" onClick={handleBulkWithdraw} disabled={selectedBidIds.length === 0}>
                            Withdraw ({selectedBidIds.length})
                        </Button>
                    </div>

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
                                <div className="col-span-full text-center py-8 text-white/50">No bids yet.</div>
                            )}
                        </div>
                    ) : (
                        <div className="overflow-x-auto border border-white/10 rounded-lg">
                            <table className="w-full text-sm text-white">
                                <thead className="bg-black/40 text-xs">
                                    <tr>
                                        <th className="p-3 text-left">
                                            <input type="checkbox" checked={filteredMyBids.length > 0 && filteredMyBids.every(b => selectedBidIds.includes(b.id))} onChange={(e) => handleSelectAllMyBids(e.target.checked)} />
                                        </th>
                                        <th className="p-3 text-left">Bid Time</th>
                                        <th className="p-3 text-left">Details</th>
                                        <th className="p-3 text-left">Status</th>
                                        <th className="p-3 text-left">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredMyBids.map(bid => (
                                        <tr key={bid.id} className="border-t border-white/10 hover:bg-white/5">
                                            <td className="p-3"><input type="checkbox" checked={selectedBidIds.includes(bid.id)} onChange={() => handleSelectBid(bid.id)} /></td>
                                            <td className="p-3 text-xs">{bid.bidTime}</td>
                                            <td className="p-3">
                                                <div className="font-medium">{bid.role}</div>
                                                <div className="text-xs text-white/50">{bid.department} • {bid.date}</div>
                                            </td>
                                            <td className="p-3"><BidStatusBadge status={bid.status} /></td>
                                            <td className="p-3">
                                                <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300" onClick={() => handleWithdrawBid(bid.id)}>
                                                    Withdraw
                                                </Button>
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
                <AlertDialogContent className="bg-[#0f172a] border-white/10 text-white max-w-md">
                    <AlertDialogHeader>
                        {complianceResult && !complianceResult.isValid ? (
                            <>
                                <AlertDialogTitle className="flex items-center gap-2 text-red-400">
                                    <XCircle className="h-5 w-5" />
                                    Cannot Place Bid
                                </AlertDialogTitle>
                                <AlertDialogDescription asChild>
                                    <div className="text-white/70">
                                        <span>This shift cannot be accepted due to compliance violations:</span>
                                        <ul className="mt-2 space-y-1 text-red-300">
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
                                <AlertDialogTitle className="flex items-center gap-2 text-amber-400">
                                    <AlertTriangle className="h-5 w-5" />
                                    Compliance Warnings
                                </AlertDialogTitle>
                                <AlertDialogDescription asChild>
                                    <div className="text-white/70">
                                        <span>There are potential issues with this shift:</span>
                                        <ul className="mt-2 space-y-1 text-amber-300">
                                            {complianceResult.warnings.map((w, i) => (
                                                <li key={i} className="flex items-start gap-2">
                                                    <Shield className="h-4 w-4 shrink-0 mt-0.5" />
                                                    <span>{w}</span>
                                                </li>
                                            ))}
                                        </ul>
                                        <p className="mt-3 text-white/60">Do you want to proceed anyway?</p>
                                    </div>
                                </AlertDialogDescription>
                            </>
                        ) : null}
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        {complianceResult && !complianceResult.isValid ? (
                            <AlertDialogAction onClick={handleCancelBid} className="bg-white/10 hover:bg-white/20">
                                Understood
                            </AlertDialogAction>
                        ) : (
                            <>
                                <AlertDialogCancel onClick={handleCancelBid} className="bg-white/10 hover:bg-white/20 border-white/10">
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
        </div>
    );
};

export default EmployeeBidsPage;

