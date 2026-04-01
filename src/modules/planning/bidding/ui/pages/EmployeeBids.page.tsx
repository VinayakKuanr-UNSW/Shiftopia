import React, { useState } from 'react';
import { useAuth } from '@/platform/auth/useAuth';

import { useTableSorting } from '@/modules/core/hooks/useTableSorting';
import { SortableTableHeader } from '@/modules/core/ui/primitives/sortable-table-header';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { SYDNEY_TZ, parseZonedDateTime, formatInTimezone } from '@/modules/core/lib/date.utils';
import { biddingApi } from '../../api/bidding.api';
import { validateCompliance, type ComplianceResult, type QualificationViolation } from '@/modules/rosters/services/compliance.service';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/modules/core/ui/primitives/tooltip';
import {
    Info, User,
    Calendar, Clock, ThumbsUp, ShieldAlert, Ban, Flame,
    Megaphone, UserPlus, UserCheck as LucideUserCheck, Circle, Minus, Gavel, Coffee, Shield, Loader2, AlertTriangle, CheckCircle, XCircle,
    Filter, Zap, Signal, History, ChevronDown, ChevronRight
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { BidStatusBadge } from '../components/BidStatusBadge';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import { useToast } from '@/modules/core/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { determineShiftState } from '@/modules/rosters/domain/shift-state.utils';
import { calculateTimeRemaining, formatTimeRemaining } from '../views/OpenBidsView/utils';
import { SharedShiftCard } from '../../../../planning/ui/components/SharedShiftCard';

import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/modules/core/ui/primitives/alert-dialog';
import { BidComplianceModal } from '../components/BidComplianceModal';

import { ScopeFilterBanner } from '@/modules/core/ui/components/ScopeFilterBanner';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { FunctionBar } from '@/modules/core/ui/components/FunctionBar';
import type { ParticipationStatus } from '../../model/bid.types';

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
    lifecycleStatus?: string;
    subGroupColor?: string;
    droppedById?: string | null;
    last_dropped_by?: string | null;
    bidding_iteration?: number;
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
    status: 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'selected';
    bidTime: string;
    notes: string | null;
    groupType?: string | null;
    stateId?: string;
    subGroupColor?: string;
    bidding_iteration?: number;
}

/** Atomic shift opportunity — shift + per-user participation for current iteration */
interface ShiftOpportunity extends ShiftData {
    participationStatus: ParticipationStatus;
    currentBid: BidData | null;
    /** Bids from previous iterations (read-only history) */
    bidHistory: BidData[];
}

// ============================================================================
// HELPERS
// ============================================================================

export type BidPriority = 'normal' | 'urgent';

export const PRIORITY_CONFIG: Record<BidPriority, {
    label: string;
    badgeCls: string;
    icon: React.ElementType;
    chipActiveCls: string;
}> = {
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

export const getBidPriority = (
    shift: ShiftData | BidData,
    now: Date = new Date()
): BidPriority => {
    const shiftStart = (shift as any).startAt
        ? new Date((shift as any).startAt)
        : parseZonedDateTime(shift.date, shift.startTime, SYDNEY_TZ);

    if (isNaN(shiftStart.getTime())) return 'normal';
    const hoursUntil = (shiftStart.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursUntil <= 24) return 'urgent';
    return 'normal';
};

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

/**
 * Derive participation status for the CURRENT bidding iteration.
 * History (past iterations) is handled separately by bidHistory.
 */
function getParticipationStatus(
    shift: ShiftData,
    allMyBids: BidData[],
    userId: string
): ParticipationStatus {
    // Not eligible: user dropped this shift
    if (shift.last_dropped_by === userId || shift.droppedById === userId) {
        return 'not_eligible';
    }

    const currentIteration = shift.bidding_iteration || 1;

    // Find user's bid for the CURRENT iteration only
    const currentBid = allMyBids.find(b =>
        String(b.shiftId) === String(shift.id) &&
        b.bidding_iteration === currentIteration &&
        b.status !== 'withdrawn'
    );

    if (!currentBid) {
        // Check if bidding window has closed
        const shiftStart = shift.startAt
            ? new Date(shift.startAt)
            : parseZonedDateTime(shift.date, shift.startTime, SYDNEY_TZ);
        const biddingCloses = new Date(shiftStart.getTime() - 4 * 60 * 60 * 1000);
        if (new Date() >= biddingCloses) return 'expired';
        return 'not_participated';
    }

    if (currentBid.status === 'pending') return 'pending';
    if (currentBid.status === 'accepted' || currentBid.status === 'selected') return 'selected';
    if (currentBid.status === 'rejected') return 'rejected';
    return 'not_participated';
}

// ============================================================================
// COMPONENT
// ============================================================================
export const EmployeeBidsPage: React.FC = () => {
    const { user } = useAuth();
    const { scope, setScope, scopeKey, isGammaLocked, isLoading: isScopeLoading } = useScopeFilter('personal');
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
    const [priorityFilter, setPriorityFilter] = useState<BidPriority | 'all'>('all');
    const [expandedHistoryIds, setExpandedHistoryIds] = useState<Set<string>>(new Set());

    // Selection (for bulk bid on not_participated eligible shifts)
    const [selectedShiftIds, setSelectedShiftIds] = useState<any[]>([]);

    // Compliance Check State
    const [checkingShiftId, setCheckingShiftId] = useState<string | null>(null);
    const [complianceResult, setComplianceResult] = useState<ComplianceResult | null>(null);
    const [showComplianceDialog, setShowComplianceDialog] = useState(false);
    const [pendingBidShift, setPendingBidShift] = useState<ShiftData | null>(null);

    // Compliance Modal State
    const [complianceModalShift, setComplianceModalShift] = useState<ShiftData | null>(null);
    const [isComplianceModalOpen, setIsComplianceModalOpen] = useState(false);

    const hierarchyFilters = {
        organizationId: scope.org_ids[0] ?? '',
        departmentId: scope.dept_ids[0] ?? undefined,
        subDepartmentId: scope.subdept_ids[0] ?? undefined,
    };

    // ========================================================================
    // DATA FETCHING
    // ========================================================================
    const { data: rawAvailableShifts = [] } = useQuery({
        queryKey: ['openBidShifts', scopeKey, hierarchyFilters.organizationId, hierarchyFilters.departmentId, hierarchyFilters.subDepartmentId],
        queryFn: () => biddingApi.getOpenBidShifts(hierarchyFilters),
        enabled: !!user && !!hierarchyFilters.organizationId && !isScopeLoading,
    });

    const { data: rawMyBids = [] } = useQuery({
        queryKey: ['myBids', user?.id],
        queryFn: () => (user ? biddingApi.getMyBids(user.id) : Promise.resolve([])),
        enabled: !!user,
    });

    // ========================================================================
    // BUCKET A: ELIGIBILITY SCAN (5-min cache)
    // ========================================================================
    const eligibilityQueryKey = rawAvailableShifts.map(s => s.id).join('|');

    const { data: eligibilityMap = new Map<string, { eligible: boolean; reasons: string[] }>(), isFetching: eligibilityLoading } = useQuery({
        queryKey: ['bidEligibilityScan', eligibilityQueryKey, user?.id],
        queryFn: async (): Promise<Map<string, { eligible: boolean; reasons: string[] }>> => {
            const newMap = new Map<string, { eligible: boolean; reasons: string[] }>();
            const results = await Promise.allSettled(
                rawAvailableShifts.map(s => validateCompliance({
                    employeeId: user!.id,
                    shiftDate: s.shift_date,
                    startTime: (s.start_time || '00:00').slice(0, 5) + ':00',
                    endTime:   (s.end_time   || '00:00').slice(0, 5) + ':00',
                    netLengthMinutes: (() => {
                        const toMin = (t: string) => { const [h, m] = (t || '00:00').split(':').map(Number); return h * 60 + (m || 0); };
                        const sMin = toMin(s.start_time || '00:00');
                        const eMin = toMin(s.end_time   || '00:00');
                        const dur  = eMin > sMin ? eMin - sMin : eMin + 1440 - sMin;
                        return Math.max(1, dur - (s.unpaid_break_minutes || 0));
                    })(),
                    shiftId: s.id,
                }))
            );
            rawAvailableShifts.forEach((s, i) => {
                const result = results[i];
                if (result.status === 'fulfilled') {
                    const qv: QualificationViolation[] = result.value.qualificationViolations;
                    if (qv.length > 0) {
                        newMap.set(s.id, {
                            eligible: false,
                            reasons: qv.map(v => {
                                if (v.type === 'ROLE_MISMATCH')     return 'Role mismatch — no matching contract';
                                if (v.type === 'LICENSE_MISSING')   return `Missing licence: ${v.license_name || 'required'}`;
                                if (v.type === 'LICENSE_EXPIRED')   return `Expired licence: ${v.license_name || 'required'}`;
                                if (v.type === 'SKILL_MISSING')     return `Missing skill: ${v.skill_name || 'required'}`;
                                if (v.type === 'SKILL_EXPIRED')     return `Expired skill: ${v.skill_name || 'required'}`;
                                return v.message;
                            }),
                        });
                    } else {
                        newMap.set(s.id, { eligible: true, reasons: [] });
                    }
                } else {
                    newMap.set(s.id, { eligible: true, reasons: [] });
                }
            });
            return newMap;
        },
        enabled: !!user && rawAvailableShifts.length > 0,
        staleTime: 5 * 60_000,
        gcTime:    10 * 60_000,
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
            setSelectedShiftIds([]);
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
            setSelectedShiftIds([]);
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
                isEligible:          eligibilityMap.get(s.id)?.eligible ?? true,
                ineligibilityReason: eligibilityMap.get(s.id)?.reasons.join(' · ') ?? undefined,
                groupType: s.group_type,
                priority: isUrgent ? 'urgent' : 'normal',
                biddingWindowOpens: (s as any).bidding_open_at || null,
                biddingWindowCloses: (s as any).bidding_close_at || null,
                isUrgent,
                stateId: determineShiftState(s as any),
                subGroupColor: getDeptColor(s.group_type, s.departments?.name || ''),
                droppedById: (s as any).dropped_by_id,
                last_dropped_by: (s as any).last_dropped_by,
                bidding_iteration: (s as any).bidding_iteration || 1
            };
        });
    }, [rawAvailableShifts, eligibilityMap]);

    const myBids: BidData[] = React.useMemo(() => {
        return rawMyBids.map(b => {
            const s = b.shift;
            if (!s) return null;
            const shiftStartAt = (s as any).start_at ? new Date((s as any).start_at) : parseZonedDateTime(s.shift_date, s.start_time, (s as any).tz_identifier || SYDNEY_TZ);
            const shiftEndAt = (s as any).end_at ? new Date((s as any).end_at) : parseZonedDateTime(s.shift_date, s.end_time, (s as any).tz_identifier || SYDNEY_TZ);

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
                subGroupColor: getDeptColor(s.group_type, s.departments?.name || ''),
                bidding_iteration: b.bidding_iteration || 1
            };
        }).filter(Boolean) as BidData[];
    }, [rawMyBids]);

    // ========================================================================
    // SORTING
    // ========================================================================
    const shiftsTableSort = useTableSorting(availableShifts, { key: 'date', direction: 'asc' });

    // ========================================================================
    // UNIFIED BID OPPORTUNITIES
    // Each open shift enriched with current-iteration participation status + history
    // ========================================================================
    const bidOpportunities: ShiftOpportunity[] = React.useMemo(() => {
        return shiftsTableSort.sortedData
            .filter(shift => {
                if (priorityFilter !== 'all') {
                    if (getBidPriority(shift) !== priorityFilter) return false;
                }
                return true;
            })
            .map(shift => {
                const currentIteration = shift.bidding_iteration || 1;

                const currentBid = myBids.find(b =>
                    String(b.shiftId) === String(shift.id) &&
                    b.bidding_iteration === currentIteration &&
                    b.status !== 'withdrawn'
                ) || null;

                const bidHistory = myBids.filter(b =>
                    String(b.shiftId) === String(shift.id) &&
                    b.bidding_iteration !== currentIteration &&
                    b.status !== 'withdrawn'
                );

                const participationStatus = getParticipationStatus(shift, myBids, user?.id || '');

                return { ...shift, participationStatus, currentBid, bidHistory };
            });
    }, [shiftsTableSort.sortedData, myBids, priorityFilter, user?.id]);

    // ========================================================================
    // SELECTION HANDLERS (only applicable to not_participated eligible shifts)
    // ========================================================================
    const handleSelectAll = (isChecked: boolean) => {
        const eligible = bidOpportunities
            .filter(o => o.participationStatus === 'not_participated' && o.isEligible)
            .map(o => o.id);
        setSelectedShiftIds(isChecked ? eligible : []);
    };

    const handleSelectShift = (id: any) => {
        setSelectedShiftIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const toggleHistory = (shiftId: string) => {
        setExpandedHistoryIds(prev => {
            const next = new Set(prev);
            if (next.has(shiftId)) next.delete(shiftId);
            else next.add(shiftId);
            return next;
        });
    };

    // ========================================================================
    // COMPLIANCE HANDLERS
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

            if (result.status === 'violated' || result.status === 'warned') {
                setComplianceResult(result);
                setPendingBidShift(shift);
                setShowComplianceDialog(true);
            } else {
                placeBidMutation.mutate(shift.id);
            }
        } catch {
            setCheckingShiftId(null);
            toast({ title: 'Compliance Check Unavailable', description: 'Proceeding with bid.', variant: 'default' });
            placeBidMutation.mutate(shift.id);
        }
    };

    const handleConfirmBidWithWarning = () => {
        if (pendingBidShift) placeBidMutation.mutate(pendingBidShift.id);
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
    // Quick bid — Bucket A already checked at scan time; B/C/D advisory in background
    const handleQuickBid = (shift: ShiftData) => {
        placeBidMutation.mutate(shift.id, {
            onSuccess: () => {
                validateCompliance({
                    employeeId: user!.id,
                    shiftDate: shift.date,
                    startTime: shift.startTime + ':00',
                    endTime:   shift.endTime   + ':00',
                    netLengthMinutes: shift.netLength,
                    shiftId: shift.id,
                }).then(result => {
                    const hasNonEligibilityIssues =
                        (result.violations.length > 0 || result.warnings.length > 0) &&
                        result.qualificationViolations.length === 0;
                    if (hasNonEligibilityIssues) {
                        toast({
                            title: 'Advisory notice',
                            description: result.violations[0] || result.warnings[0],
                            variant: 'default',
                        });
                    }
                }).catch(() => {});
            },
        });
    };

    const handleWithdrawBid = (bidId: string) => {
        withdrawBidMutation.mutate(bidId);
    };

    const handleBulkBid = async () => {
        if (!user) return;

        const validIds = selectedShiftIds.filter(id => {
            const opp = bidOpportunities.find(o => o.id === id);
            return opp?.participationStatus === 'not_participated' && opp?.isEligible !== false;
        });

        if (validIds.length === 0) {
            toast({ title: 'No eligible shifts selected', variant: 'destructive' });
            return;
        }

        const results = await Promise.allSettled(
            validIds.map(id => biddingApi.placeBid(id, user.id))
        );

        const succeeded = results.filter(r => r.status === 'fulfilled').length;
        const failed    = results.filter(r => r.status === 'rejected').length;

        toast({
            title: `${succeeded} bid${succeeded !== 1 ? 's' : ''} placed`,
            description: failed > 0 ? `${failed} failed` : undefined,
        });

        setSelectedShiftIds([]);
        queryClient.invalidateQueries({ queryKey: ['openBidShifts'] });
        queryClient.invalidateQueries({ queryKey: ['myBids'] });
    };

    // ========================================================================
    // RENDER: Shift Opportunity Card
    // ========================================================================
    const renderOpportunityCard = (opp: ShiftOpportunity) => {
        const { participationStatus, currentBid, bidHistory } = opp;
        const currentIteration = opp.bidding_iteration || 1;
        const isHistoryExpanded = expandedHistoryIds.has(String(opp.id));

        const shiftStart = opp.startAt
            ? new Date(opp.startAt)
            : parseZonedDateTime(opp.date, opp.startTime, SYDNEY_TZ);
        const biddingCloses = new Date(shiftStart.getTime() - 4 * 60 * 60 * 1000);
        const tr = calculateTimeRemaining(biddingCloses.toISOString());

        const isTerminal = participationStatus === 'selected' ||
                           participationStatus === 'not_eligible' ||
                           participationStatus === 'expired';
        const timerDisplay = isTerminal ? null
            : tr.isExpired ? 'Bidding Closed'
            : `Closes in ${formatTimeRemaining(tr)}`;

        const canSelect = participationStatus === 'not_participated' && opp.isEligible;

        const footerActions = (
            <div className="flex flex-col gap-2">

                {/* ── CURRENT ITERATION STATUS ── */}
                {participationStatus === 'not_eligible' && (
                    <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 text-sm font-medium">
                        <XCircle className="h-4 w-4 shrink-0" /> You dropped this shift
                    </div>
                )}

                {participationStatus === 'not_participated' && (
                    opp.isEligible ? (
                        <Button
                            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/20 font-bold h-10 transition-all active:scale-[0.98]"
                            onClick={() => handleQuickBid(opp)}
                            disabled={placeBidMutation.isPending}
                        >
                            {placeBidMutation.isPending && placeBidMutation.variables === opp.id ? (
                                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                            ) : (
                                <ThumbsUp className="mr-1.5 h-4 w-4" />
                            )}
                            {placeBidMutation.isPending && placeBidMutation.variables === opp.id ? 'Placing…' : 'Bid Now'}
                        </Button>
                    ) : (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <span className="w-full">
                                        <Button
                                            disabled
                                            className="w-full bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 cursor-not-allowed opacity-90 pointer-events-none h-10"
                                        >
                                            <Ban className="mr-1.5 h-4 w-4" /> Ineligible
                                        </Button>
                                    </span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-[220px] text-xs">
                                    {opp.ineligibilityReason ?? 'You are not eligible for this shift'}
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )
                )}

                {participationStatus === 'pending' && (
                    <>
                        <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400 text-sm font-medium">
                            <Clock className="h-4 w-4 shrink-0" /> Awaiting Manager Review
                        </div>
                        {!tr.isExpired && currentBid && (
                            <Button
                                variant="outline"
                                className="w-full border-slate-200 dark:border-white/10 hover:bg-red-500/10 hover:text-red-400 h-10"
                                onClick={() => handleWithdrawBid(currentBid.id)}
                                disabled={withdrawBidMutation.isPending}
                            >
                                <XCircle className="mr-1.5 h-4 w-4" /> Withdraw
                            </Button>
                        )}
                    </>
                )}

                {participationStatus === 'selected' && (
                    <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-sm font-medium">
                        <CheckCircle className="h-4 w-4 shrink-0" /> Bid Selected — Assigned to You
                    </div>
                )}

                {participationStatus === 'rejected' && (
                    <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/40 text-sm">
                        <Ban className="h-4 w-4 shrink-0" /> Not Selected This Round
                    </div>
                )}

                {participationStatus === 'expired' && (
                    <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-400 dark:text-white/40 text-sm">
                        <Ban className="h-4 w-4 shrink-0" /> Bidding Closed
                    </div>
                )}

                {/* ── ITERATION HISTORY — ALL past ITRs, DNB for missed ── */}
                {currentIteration > 1 && (
                    <div className="mt-1 border-t border-slate-100 dark:border-white/[0.06] pt-2">
                        <button
                            onClick={() => toggleHistory(String(opp.id))}
                            className="flex items-center gap-1.5 w-full text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                        >
                            {isHistoryExpanded
                                ? <ChevronDown className="h-3 w-3" />
                                : <ChevronRight className="h-3 w-3" />
                            }
                            <History className="h-3 w-3" />
                            History ({currentIteration - 1} round{currentIteration - 1 !== 1 ? 's' : ''})
                        </button>
                        <AnimatePresence>
                            {isHistoryExpanded && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.15 }}
                                    className="overflow-hidden"
                                >
                                    <div className="mt-1.5 space-y-0.5">
                                        {Array.from({ length: currentIteration - 1 }, (_, i) => i + 1).map(itr => {
                                            const bid = bidHistory.find(b => b.bidding_iteration === itr);
                                            return (
                                                <div key={itr} className="flex items-center justify-between text-xs py-0.5">
                                                    <span className="text-muted-foreground/60 font-mono">ITR {itr}</span>
                                                    {bid ? (
                                                        <BidStatusBadge status={bid.status} />
                                                    ) : (
                                                        <span className="text-[10px] font-bold uppercase tracking-tight px-1.5 py-0.5 rounded bg-slate-200 dark:bg-white/10 text-slate-400 dark:text-white/30">DNB</span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                )}
            </div>
        );

        const topContent = (
            <div className="flex items-center gap-2">
                <input
                    type="checkbox"
                    checked={selectedShiftIds.includes(opp.id)}
                    onChange={() => handleSelectShift(opp.id)}
                    disabled={!canSelect}
                    className="h-4 w-4 rounded border-white/20 bg-white/5 text-primary focus:ring-primary/30"
                />
                <span className="text-[10px] text-muted-foreground/60 font-bold uppercase tracking-wider">Select</span>
                {currentIteration > 1 && (
                    <span className="ml-auto text-[9px] font-mono font-bold text-muted-foreground/40 bg-muted/20 px-1.5 py-0.5 rounded uppercase">
                        ITR {currentIteration}
                    </span>
                )}
            </div>
        );

        return (
            <SharedShiftCard
                key={opp.id}
                organization={opp.organization}
                department={opp.department}
                subGroup={opp.subGroup}
                role={opp.role}
                shiftDate={opp.date}
                startTime={opp.startTime}
                endTime={opp.endTime}
                netLength={opp.netLength}
                paidBreak={opp.paidBreak}
                unpaidBreak={opp.unpaidBreak}
                timerText={timerDisplay}
                isExpired={isTerminal ? false : tr.isExpired}
                isUrgent={opp.isUrgent}
                lifecycleStatus={opp.lifecycleStatus || 'Published'}
                groupVariant={
                    opp.groupType === 'convention_centre' ? 'convention' :
                    opp.groupType === 'exhibition_centre' ? 'exhibition' :
                    opp.groupType === 'theatre' ? 'theatre' : 'default'
                }
                footerActions={footerActions}
                topContent={topContent}
            />
        );
    };

    // ========================================================================
    // RENDER
    // ========================================================================
    return (
        <div className="w-full text-foreground">
            <ScopeFilterBanner
                mode="personal"
                onScopeChange={setScope}
                hidden={isGammaLocked}
                className="mb-6"
            />

            <FunctionBar
                tabs={[{ id: 'all', label: 'Open Shifts', count: bidOpportunities.length }]}
                activeTab="all"
                onTabChange={() => {}}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                onRefresh={() => {
                    queryClient.invalidateQueries({ queryKey: ['openBidShifts'] });
                    queryClient.invalidateQueries({ queryKey: ['myBids'] });
                }}
                className="mb-6"
                endActions={
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-muted-foreground/60 mr-1">
                            <Filter className="h-3 w-3" />
                            Priority
                        </div>
                        {(['all', 'normal', 'urgent'] as const).map((p) => {
                            const isAll = p === 'all';
                            const conf = isAll ? null : PRIORITY_CONFIG[p];
                            const active = priorityFilter === p;
                            return (
                                <button
                                    key={p}
                                    onClick={() => setPriorityFilter(p)}
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

            {/* Eligibility scan indicator */}
            {eligibilityLoading && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60 mb-4">
                    <Loader2 className="h-3 w-3 animate-spin" /> Checking eligibility…
                </div>
            )}

            {/* ── UNIFIED SHIFT OPPORTUNITIES GRID ── */}
            {viewMode === 'card' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {bidOpportunities.map(opp => renderOpportunityCard(opp))}
                    {bidOpportunities.length === 0 && (
                        <div className="col-span-full text-center py-16 text-muted-foreground/50">
                            No open shifts match your filters.
                        </div>
                    )}
                </div>
            ) : (
                /* ── TABLE VIEW ── */
                <div className="overflow-x-auto border border-slate-200 dark:border-white/10 rounded-lg">
                    <table className="w-full text-sm text-slate-800 dark:text-white">
                        <thead className="bg-slate-100 dark:bg-black/40 text-xs">
                            <tr>
                                <th className="p-3 text-left w-[40px]">
                                    <input
                                        type="checkbox"
                                        checked={
                                            bidOpportunities.some(o => o.participationStatus === 'not_participated' && o.isEligible) &&
                                            bidOpportunities
                                                .filter(o => o.participationStatus === 'not_participated' && o.isEligible)
                                                .every(o => selectedShiftIds.includes(o.id))
                                        }
                                        onChange={(e) => handleSelectAll(e.target.checked)}
                                    />
                                </th>
                                <SortableTableHeader sortKey="department" currentSort={shiftsTableSort.sortConfig} onSort={shiftsTableSort.handleSort}>Dept</SortableTableHeader>
                                <SortableTableHeader sortKey="subGroup" currentSort={shiftsTableSort.sortConfig} onSort={shiftsTableSort.handleSort}>Sub</SortableTableHeader>
                                <SortableTableHeader sortKey="role" currentSort={shiftsTableSort.sortConfig} onSort={shiftsTableSort.handleSort}>Role</SortableTableHeader>
                                <SortableTableHeader sortKey="date" currentSort={shiftsTableSort.sortConfig} onSort={shiftsTableSort.handleSort}>Date</SortableTableHeader>
                                <th className="p-3 text-left">Time</th>
                                <th className="p-3 text-left">Net</th>
                                <th className="p-3 text-left">ITR</th>
                                <th className="p-3 text-left w-[200px]">Status / Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {bidOpportunities.map(opp => {
                                const { participationStatus, currentBid } = opp;
                                const shiftStart = opp.startAt
                                    ? new Date(opp.startAt)
                                    : parseZonedDateTime(opp.date, opp.startTime, SYDNEY_TZ);
                                const biddingCloses = new Date(shiftStart.getTime() - 4 * 60 * 60 * 1000);
                                const isExpired = new Date() >= biddingCloses;
                                const canSelect = participationStatus === 'not_participated' && opp.isEligible;

                                return (
                                    <tr key={opp.id} className="border-t border-slate-100 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5">
                                        <td className="p-3">
                                            <input
                                                type="checkbox"
                                                checked={selectedShiftIds.includes(opp.id)}
                                                onChange={() => handleSelectShift(opp.id)}
                                                disabled={!canSelect}
                                            />
                                        </td>
                                        <td className="p-3">{opp.department}</td>
                                        <td className="p-3">{opp.subGroup}</td>
                                        <td className="p-3">{opp.role}</td>
                                        <td className="p-3">{opp.date}</td>
                                        <td className="p-3">{opp.startTime}–{opp.endTime}</td>
                                        <td className="p-3">{Math.round(opp.netLength)}m</td>
                                        <td className="p-3 text-xs font-mono text-muted-foreground">
                                            {(opp.bidding_iteration || 1) > 1 ? `ITR ${opp.bidding_iteration}` : '—'}
                                        </td>
                                        <td className="p-3">
                                            {participationStatus === 'not_eligible' && (
                                                <span className="text-xs text-rose-500 flex items-center gap-1"><XCircle size={12} /> Dropped</span>
                                            )}
                                            {participationStatus === 'not_participated' && !isExpired && (
                                                opp.isEligible ? (
                                                    <Button
                                                        size="sm"
                                                        className="h-8 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
                                                        disabled={placeBidMutation.isPending}
                                                        onClick={() => handleQuickBid(opp)}
                                                    >
                                                        {placeBidMutation.isPending && placeBidMutation.variables === opp.id
                                                            ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                                            : <ThumbsUp className="mr-1 h-3 w-3" />
                                                        }
                                                        Bid
                                                    </Button>
                                                ) : (
                                                    <span className="text-xs text-rose-500 flex items-center gap-1"><Ban size={12} /> Ineligible</span>
                                                )
                                            )}
                                            {participationStatus === 'not_participated' && isExpired && (
                                                <span className="text-xs text-slate-400 flex items-center gap-1"><Ban size={12} /> Closed</span>
                                            )}
                                            {participationStatus === 'pending' && (
                                                <div className="flex gap-2 items-center">
                                                    <span className="text-xs text-amber-500 flex items-center gap-1"><Clock size={12} /> Pending</span>
                                                    {!isExpired && currentBid && (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            className="h-7 text-xs border-white/10 hover:bg-red-500/10 hover:text-red-400"
                                                            onClick={() => handleWithdrawBid(currentBid.id)}
                                                            disabled={withdrawBidMutation.isPending}
                                                        >
                                                            <XCircle className="mr-1 h-3 w-3" /> Withdraw
                                                        </Button>
                                                    )}
                                                </div>
                                            )}
                                            {participationStatus === 'selected' && (
                                                <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle size={12} /> Selected</span>
                                            )}
                                            {participationStatus === 'rejected' && (
                                                <span className="text-xs text-slate-400 flex items-center gap-1"><Ban size={12} /> Not Selected</span>
                                            )}
                                            {participationStatus === 'expired' && (
                                                <span className="text-xs text-slate-400 flex items-center gap-1"><Ban size={12} /> Expired</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* ── FLOATING BULK ACTION BAR ── */}
            <AnimatePresence>
                {selectedShiftIds.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: 50, x: '-50%' }}
                        animate={{ opacity: 1, y: 0, x: '-50%' }}
                        exit={{ opacity: 0, y: 50, x: '-50%' }}
                        className="fixed bottom-6 left-1/2 z-50 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-5 py-3 rounded-full shadow-2xl flex items-center gap-4 border border-slate-700 dark:border-slate-200"
                    >
                        <div className="flex items-center gap-2">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500 text-[12px] font-bold text-white shadow-sm">
                                {selectedShiftIds.length}
                            </span>
                            <span className="text-sm font-semibold">Selected</span>
                        </div>

                        <div className="h-5 w-[1px] bg-white/20 dark:bg-black/10 mx-1" />

                        <div className="flex items-center gap-1">
                            <Button
                                size="sm"
                                className="h-8 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-4 rounded-full"
                                onClick={handleBulkBid}
                                disabled={placeBidMutation.isPending}
                            >
                                {placeBidMutation.isPending ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <ThumbsUp className="mr-1.5 h-3.5 w-3.5" />}
                                Bid All
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 text-white/70 dark:text-slate-500 hover:text-white dark:hover:text-slate-900 text-xs rounded-full px-3"
                                onClick={() => setSelectedShiftIds([])}
                            >
                                Clear
                            </Button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── COMPLIANCE WARNING DIALOG ── */}
            <AlertDialog open={showComplianceDialog} onOpenChange={setShowComplianceDialog}>
                <AlertDialogContent className="bg-background border-border text-foreground">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                            <ShieldAlert className="h-5 w-5 text-amber-500" />
                            {complianceResult?.status === 'violated' ? 'Compliance Issue' : 'Advisory Notice'}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {complianceResult?.status === 'violated'
                                ? 'This shift has a blocking compliance issue. You cannot bid on this shift.'
                                : 'This shift has a compliance warning. You may still proceed, but your bid may be reviewed.'}
                        </AlertDialogDescription>
                        <div className="space-y-1 mt-2">
                            {complianceResult?.violations.map((v, i) => (
                                <div key={i} className="flex items-center gap-2 text-sm text-red-500">
                                    <XCircle className="h-4 w-4 shrink-0" /> {v}
                                </div>
                            ))}
                            {complianceResult?.warnings.map((w, i) => (
                                <div key={i} className="flex items-center gap-2 text-sm text-amber-500">
                                    <AlertTriangle className="h-4 w-4 shrink-0" /> {w}
                                </div>
                            ))}
                        </div>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={handleCancelBid}>Cancel</AlertDialogCancel>
                        {complianceResult?.status !== 'violated' && (
                            <AlertDialogAction onClick={handleConfirmBidWithWarning}>
                                Proceed Anyway
                            </AlertDialogAction>
                        )}
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* ── COMPLIANCE DETAIL MODAL ── */}
            {complianceModalShift && (
                <BidComplianceModal
                    isOpen={isComplianceModalOpen}
                    onClose={() => { setIsComplianceModalOpen(false); setComplianceModalShift(null); }}
                    shift={complianceModalShift as any}
                    onConfirmBid={() => {
                        if (complianceModalShift) placeBidMutation.mutate(complianceModalShift.id);
                        setIsComplianceModalOpen(false);
                        setComplianceModalShift(null);
                    }}
                    isPending={placeBidMutation.isPending}
                />
            )}
        </div>
    );
};

export default EmployeeBidsPage;
