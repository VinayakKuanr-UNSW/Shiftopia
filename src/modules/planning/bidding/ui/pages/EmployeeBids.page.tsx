import React, { useState } from 'react';
import { useAuth } from '@/platform/auth/useAuth';

import { useTableSorting } from '@/modules/core/hooks/useTableSorting';
import { SortableTableHeader } from '@/modules/core/ui/primitives/sortable-table-header';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO, addDays, startOfWeek, endOfWeek } from 'date-fns';
import { SYDNEY_TZ, parseZonedDateTime, formatInTimezone } from '@/modules/core/lib/date.utils';
import { biddingApi } from '../../api/bidding.api';
import { validateCompliance, type ComplianceResult, type QualificationViolation } from '@/modules/rosters/services/compliance.service';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/modules/core/ui/primitives/tooltip';
import {
    Info, User,
    Calendar, Clock, ThumbsUp, ShieldAlert, Ban, Flame,
    Megaphone, UserPlus, UserCheck as LucideUserCheck, Circle, Minus, Gavel, Coffee, Shield, Loader2, AlertTriangle, CheckCircle, XCircle,
    X, Filter, Zap, Signal, History, ChevronDown, ChevronRight
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
import { Drawer, DrawerContent, DrawerTitle, DrawerClose } from '@/modules/core/ui/primitives/drawer';

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
    last_rejected_by?: string | null;
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
    // Not eligible: user dropped or rejected the offer this iteration
    if (shift.last_dropped_by === userId || shift.droppedById === userId || shift.last_rejected_by === userId) {
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
// DATE PRESETS
// ============================================================================
const DATE_PRESETS = [
    { id: 'today'     as const, label: 'Today'     },
    { id: 'tomorrow'  as const, label: 'Tomorrow'  },
    { id: 'this_week' as const, label: 'This Week' },
    { id: 'weekend'   as const, label: 'Weekend'   },
    { id: 'next_week' as const, label: 'Next Week' },
    { id: 'all'       as const, label: 'All Dates' },
] as const;

type DatePreset = typeof DATE_PRESETS[number]['id'];

// ============================================================================
// MOTION VARIANTS
// ============================================================================
const pageVariants = {
    hidden: {},
    show: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } }
};
const itemVariants = {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0, transition: { ease: [0.16, 1, 0.3, 1], duration: 0.4 } }
};
const listItemSpring = {
    layout: true as const,
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1, transition: { type: 'spring' as const, stiffness: 280, damping: 26 } },
    exit: { opacity: 0, scale: 0.96, transition: { duration: 0.15 } }
};

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
    const [datePreset, setDatePreset] = useState<DatePreset>('today');
    const [stripDate, setStripDate] = useState<string | null>(null);
    const [expandedHistoryIds, setExpandedHistoryIds] = useState<Set<string>>(new Set());
    const [drawerOpp, setDrawerOpp] = useState<ShiftOpportunity | null>(null);

    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const todayDate = React.useMemo(() => {
        const d = new Date(); d.setHours(0, 0, 0, 0); return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [todayStr]);
    const stripDays = React.useMemo(
        () => Array.from({ length: 14 }, (_, i) => addDays(todayDate, i)),
        [todayDate]
    );

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
                last_rejected_by: (s as any).last_rejected_by ?? null,
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
    // SHIFT COUNTS BY DATE (dot indicators — pre-date-filter)
    // ========================================================================
    const shiftsByDate = React.useMemo(() => {
        const map = new Map<string, { count: number; hasUrgent: boolean }>();
        shiftsTableSort.sortedData.forEach(shift => {
            const existing = map.get(shift.date) || { count: 0, hasUrgent: false };
            map.set(shift.date, {
                count: existing.count + 1,
                hasUrgent: existing.hasUrgent || getBidPriority(shift) === 'urgent',
            });
        });
        return map;
    }, [shiftsTableSort.sortedData]);

    // ========================================================================
    // DATE-FILTERED BID OPPORTUNITIES
    // ========================================================================
    const filteredBidOpportunities = React.useMemo(() => {
        if (stripDate) return bidOpportunities.filter(opp => opp.date === stripDate);
        return bidOpportunities.filter(opp => {
            const oppDate = new Date(opp.date + 'T00:00:00');
            switch (datePreset) {
                case 'today':     return opp.date === todayStr;
                case 'tomorrow':  return opp.date === format(addDays(todayDate, 1), 'yyyy-MM-dd');
                case 'this_week': {
                    const ws = startOfWeek(todayDate, { weekStartsOn: 1 });
                    const we = endOfWeek(todayDate, { weekStartsOn: 1 });
                    return oppDate >= ws && oppDate <= we;
                }
                case 'weekend': {
                    const ws = startOfWeek(todayDate, { weekStartsOn: 1 });
                    const sat = format(addDays(ws, 5), 'yyyy-MM-dd');
                    const sun = format(addDays(ws, 6), 'yyyy-MM-dd');
                    return opp.date === sat || opp.date === sun;
                }
                case 'next_week': {
                    const nm = addDays(startOfWeek(todayDate, { weekStartsOn: 1 }), 7);
                    const ns = addDays(nm, 6);
                    return oppDate >= nm && oppDate <= ns;
                }
                default: return true;
            }
        });
    }, [bidOpportunities, datePreset, stripDate, todayStr, todayDate]);

    const nextAvailableDate = React.useMemo(() => {
        if (datePreset !== 'today' || filteredBidOpportunities.length > 0 || stripDate) return null;
        for (let i = 1; i <= 30; i++) {
            const d = format(addDays(todayDate, i), 'yyyy-MM-dd');
            const dayData = shiftsByDate.get(d);
            if (dayData && dayData.count > 0) {
                return { date: d, count: dayData.count, label: format(parseISO(d), 'EEE, d MMM') };
            }
        }
        return null;
    }, [datePreset, filteredBidOpportunities.length, stripDate, shiftsByDate, todayDate]);

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
                    className="h-4 w-4 rounded border-border/50 text-primary focus:ring-primary/30 accent-primary"
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
            <motion.div key={opp.id} {...listItemSpring} whileHover={{ y: -2, transition: { duration: 0.15 } }} whileTap={{ scale: 0.98, transition: { duration: 0.1 } }}>
                <SharedShiftCard
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
            </motion.div>
        );
    };

    // ========================================================================
    // RENDER: Compact mobile list row (table view on mobile)
    // ========================================================================
    const renderBidListItem = (opp: ShiftOpportunity) => {
        const { participationStatus } = opp;
        const priority = getBidPriority(opp);
        const pConf = PRIORITY_CONFIG[priority];
        const PIcon = pConf.icon;
        const shiftStart = opp.startAt
            ? new Date(opp.startAt)
            : parseZonedDateTime(opp.date, opp.startTime, SYDNEY_TZ);
        const biddingCloses = new Date(shiftStart.getTime() - 4 * 60 * 60 * 1000);
        const tr = calculateTimeRemaining(biddingCloses.toISOString());
        const isExpired = tr.isExpired;
        const canSelect = participationStatus === 'not_participated' && opp.isEligible;

        const netH = Math.floor(opp.netLength / 60);
        const netM = Math.round(opp.netLength % 60);
        const netStr = netH > 0 ? `${netH}h${netM > 0 ? ` ${netM}m` : ''}` : `${netM}m`;

        const statusPill = (() => {
            if (participationStatus === 'selected')     return { label: 'Selected',     cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' };
            if (participationStatus === 'pending')      return { label: 'Pending',       cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' };
            if (participationStatus === 'rejected')     return { label: 'Not Selected',  cls: 'bg-slate-500/10 text-muted-foreground border-slate-500/20' };
            if (participationStatus === 'not_eligible') return { label: 'Dropped',       cls: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20' };
            if (participationStatus === 'expired' || (participationStatus === 'not_participated' && isExpired))
                return { label: 'Closed', cls: 'bg-slate-500/10 text-muted-foreground border-slate-500/20' };
            if (!opp.isEligible) return { label: 'Ineligible', cls: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20' };
            return null;
        })();

        return (
            <motion.div
                key={opp.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-3 px-4 py-3.5 border-b border-border/40 last:border-0 active:bg-muted/40 transition-colors cursor-pointer"
                onClick={() => setDrawerOpp(opp)}
            >
                {/* Checkbox — stopPropagation so tap on checkbox doesn't open drawer */}
                <div onClick={e => { e.stopPropagation(); if (canSelect) handleSelectShift(opp.id); }} className="shrink-0">
                    <input
                        type="checkbox"
                        readOnly
                        checked={selectedShiftIds.includes(opp.id)}
                        disabled={!canSelect}
                        className="h-4 w-4 rounded border-border/50 accent-primary"
                    />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    {/* Line 1: role + urgency badge */}
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[13px] font-semibold text-foreground truncate flex-1 leading-snug">{opp.role}</span>
                        {priority !== 'normal' && (
                            <span className={cn('shrink-0 inline-flex items-center gap-0.5 text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full border leading-none', pConf.badgeCls)}>
                                <PIcon className="h-2 w-2" />{pConf.label}
                            </span>
                        )}
                    </div>
                    {/* Line 2: dept */}
                    <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5 leading-none">
                        {opp.department}{opp.subGroup && opp.subGroup !== opp.department ? ` · ${opp.subGroup}` : ''}
                    </p>
                    {/* Line 3: date · time · net · status */}
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                        <span className="text-[11px] text-muted-foreground/60 font-medium">{format(parseISO(opp.date), 'EEE d MMM')}</span>
                        <span className="text-muted-foreground/25">·</span>
                        <span className="text-[11px] text-muted-foreground/60 font-mono">{opp.startTime}–{opp.endTime}</span>
                        <span className="text-muted-foreground/25">·</span>
                        <span className="text-[11px] text-muted-foreground/50">{netStr}</span>
                        {statusPill && (
                            <>
                                <span className="text-muted-foreground/25">·</span>
                                <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded border leading-none', statusPill.cls)}>
                                    {statusPill.label}
                                </span>
                            </>
                        )}
                    </div>
                </div>

                <ChevronRight className="h-4 w-4 text-muted-foreground/25 shrink-0" />
            </motion.div>
        );
    };

    // ========================================================================
    // RENDER
    // ========================================================================
    return (
        <motion.div className="w-full text-foreground pb-24 md:pb-0" variants={pageVariants} initial="hidden" animate="show">
            <ScopeFilterBanner
                mode="personal"
                onScopeChange={setScope}
                hidden={isGammaLocked}
                className="mb-2 md:mb-6"
            />

            {/* ═══════════════════════════════════════════════════════════════
                STICKY HEADER — 2 rows: title+actions | unified date strip
            ═══════════════════════════════════════════════════════════════ */}
            <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border/40 -mx-4 px-4 md:-mx-8 md:px-8 mb-5">

                {/* ── Row 1: Title + Priority toggles + view/refresh ── */}
                <div className="flex items-center gap-2 pt-2.5 pb-2">

                    {/* Left: title + count */}
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-sm font-black text-foreground tracking-tight leading-none">Open Shifts</span>
                        <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-primary/10 text-primary text-[10px] font-black leading-none tabular-nums">
                            {filteredBidOpportunities.length}
                        </span>
                        {eligibilityLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/40 shrink-0" />}
                    </div>

                    {/* Priority toggles — tap to activate, tap again to clear */}
                    <div className="flex items-center gap-1">
                        {(['normal', 'urgent'] as const).map(p => {
                            const conf = PRIORITY_CONFIG[p];
                            const active = priorityFilter === p;
                            return (
                                <motion.button
                                    key={p}
                                    onClick={() => setPriorityFilter(active ? 'all' : p)}
                                    whileTap={{ scale: 0.88 }}
                                    className={cn(
                                        'flex items-center gap-1 px-2.5 h-8 rounded-full border text-[10px] font-black uppercase tracking-wider transition-all',
                                        active ? conf.chipActiveCls : 'border-border/30 text-muted-foreground/50 hover:bg-muted/30 hover:text-foreground'
                                    )}
                                >
                                    <conf.icon className="h-3 w-3" />
                                    <span className="hidden sm:inline">{conf.label}</span>
                                </motion.button>
                            );
                        })}
                    </div>

                    {/* View toggle + Refresh */}
                    <div className="flex items-center gap-1 pl-2 border-l border-border/30">
                        <button
                            onClick={() => setViewMode(v => v === 'card' ? 'table' : 'card')}
                            className="h-8 w-8 flex items-center justify-center rounded-lg border border-border/30 text-muted-foreground/50 hover:bg-muted/30 hover:text-foreground transition-colors"
                            title={viewMode === 'card' ? 'Table view' : 'Card view'}
                        >
                            {viewMode === 'card'
                                ? <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none"><rect x="0.5" y="0.5" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.2"/><rect x="8" y="0.5" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.2"/><rect x="0.5" y="8" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.2"/><rect x="8" y="8" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.2"/></svg>
                                : <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none"><rect x="0.5" y="1.5" width="13" height="1.5" rx="0.75" fill="currentColor"/><rect x="0.5" y="6" width="13" height="1.5" rx="0.75" fill="currentColor"/><rect x="0.5" y="10.5" width="13" height="1.5" rx="0.75" fill="currentColor"/></svg>
                            }
                        </button>
                        <button
                            onClick={() => {
                                queryClient.invalidateQueries({ queryKey: ['openBidShifts'] });
                                queryClient.invalidateQueries({ queryKey: ['myBids'] });
                            }}
                            className="h-8 w-8 flex items-center justify-center rounded-lg border border-border/30 text-muted-foreground/50 hover:bg-muted/30 hover:text-foreground transition-colors"
                            title="Refresh"
                        >
                            <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none"><path d="M13 2.5C11.6 1 9.9 0 8 0 4.1 0 1 3.1 1 7s3.1 7 7 7c3.3 0 6-2.1 6.9-5H13c-.9 2.3-3.1 4-5.5 4-3.3 0-6-2.7-6-6s2.7-6 6-6c1.7 0 3.1.7 4.2 1.8L9 5h5V0l-1 2.5z" fill="currentColor"/></svg>
                        </button>
                    </div>
                </div>

                {/* ── Row 2: Unified date selector — presets + individual days in one strip ── */}
                {/* Preset pills first, then a hairline separator, then scrollable day cells */}
                <div className="flex gap-1.5 pb-3 overflow-x-auto" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>

                    {/* Preset pills: All | Today | Tmrw | Week | Wknd | Next */}
                    {([
                        { id: 'all'       as DatePreset, label: 'All'  },
                        { id: 'today'     as DatePreset, label: 'Today' },
                        { id: 'tomorrow'  as DatePreset, label: 'Tmrw' },
                        { id: 'this_week' as DatePreset, label: 'Week' },
                        { id: 'weekend'   as DatePreset, label: 'Wknd' },
                        { id: 'next_week' as DatePreset, label: 'Next Wk' },
                    ] as const).map(preset => {
                        const isActive = !stripDate && datePreset === preset.id;
                        const dotDate = preset.id === 'today' ? todayStr
                                      : preset.id === 'tomorrow' ? format(addDays(todayDate, 1), 'yyyy-MM-dd')
                                      : null;
                        const dotData = dotDate ? shiftsByDate.get(dotDate) : null;
                        return (
                            <motion.button
                                key={preset.id}
                                onClick={() => { setDatePreset(preset.id); setStripDate(null); }}
                                whileTap={{ scale: 0.92 }}
                                className={cn(
                                    'shrink-0 flex flex-col items-center justify-center px-3 min-h-[52px] rounded-xl border text-[11px] font-bold whitespace-nowrap transition-all',
                                    isActive
                                        ? 'bg-foreground text-background border-foreground'
                                        : 'border-border/40 text-muted-foreground hover:border-border hover:text-foreground'
                                )}
                            >
                                {preset.label}
                                {dotData && dotData.count > 0 && (
                                    <span className={cn('h-1 w-1 rounded-full mt-1', isActive ? 'bg-background/50' : dotData.hasUrgent ? 'bg-amber-500' : 'bg-primary')} />
                                )}
                            </motion.button>
                        );
                    })}

                    {/* Hairline separator */}
                    <div className="shrink-0 w-px bg-border/50 self-stretch mx-0.5 my-2" />

                    {/* Individual day pills */}
                    {stripDays.map(day => {
                        const dayStr = format(day, 'yyyy-MM-dd');
                        const dayData = shiftsByDate.get(dayStr);
                        const isSelected = stripDate === dayStr;
                        const isCurrentDay = dayStr === todayStr;
                        return (
                            <motion.button
                                key={dayStr}
                                onClick={() => setStripDate(isSelected ? null : dayStr)}
                                whileTap={{ scale: 0.88 }}
                                className={cn(
                                    'shrink-0 flex flex-col items-center w-12 min-h-[52px] py-2 rounded-xl border transition-all',
                                    isSelected
                                        ? 'bg-foreground border-foreground text-background'
                                        : isCurrentDay && !stripDate
                                        ? 'bg-primary/10 border-primary/40 text-primary'
                                        : 'border-border/30 text-muted-foreground hover:bg-muted/30 hover:border-border'
                                )}
                            >
                                <span className="text-[10px] font-semibold uppercase tracking-wide leading-none opacity-60 mt-1">
                                    {format(day, 'EEE')}
                                </span>
                                <span className="text-base font-black leading-none tabular-nums mt-1">
                                    {format(day, 'd')}
                                </span>
                                <div className="h-2 flex items-center justify-center mt-0.5">
                                    {dayData && dayData.count > 0
                                        ? <span className={cn('h-1 w-1 rounded-full', isSelected ? 'bg-background/60' : dayData.hasUrgent ? 'bg-amber-500' : 'bg-primary')} />
                                        : <span className="h-1 w-1" />
                                    }
                                </div>
                            </motion.button>
                        );
                    })}
                </div>
            </div>

            {/* ── CARD / TABLE VIEW ── */}
            {viewMode === 'card' ? (
                <AnimatePresence mode="wait">
                    <motion.div
                        key={`${priorityFilter}-${datePreset}-${stripDate ?? ''}`}
                        className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
                        variants={pageVariants}
                        initial="hidden"
                        animate="show"
                        exit={{ opacity: 0, transition: { duration: 0.15 } }}
                    >
                        {filteredBidOpportunities.map(opp => renderOpportunityCard(opp))}
                        {filteredBidOpportunities.length === 0 && (
                            <motion.div variants={itemVariants} className="col-span-full">
                                <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                                    <div className="h-12 w-12 rounded-2xl bg-muted/40 flex items-center justify-center">
                                        <Calendar className="h-6 w-6 text-muted-foreground/40" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold text-foreground/60">
                                            {stripDate
                                                ? `No shifts on ${format(parseISO(stripDate), 'EEE, d MMM')}`
                                                : datePreset === 'today'
                                                ? 'No open shifts today'
                                                : 'No shifts match your filters'}
                                        </p>
                                        {nextAvailableDate && (
                                            <p className="text-xs text-muted-foreground/50 mt-1.5">
                                                Next available:{' '}
                                                <button
                                                    onClick={() => setStripDate(nextAvailableDate.date)}
                                                    className="text-primary font-semibold hover:underline"
                                                >
                                                    {nextAvailableDate.label} ({nextAvailableDate.count} shift{nextAvailableDate.count !== 1 ? 's' : ''})
                                                </button>
                                            </p>
                                        )}
                                        {!nextAvailableDate && datePreset !== 'all' && (
                                            <button
                                                onClick={() => { setDatePreset('all'); setStripDate(null); }}
                                                className="text-xs text-primary hover:underline mt-1.5 block mx-auto"
                                            >
                                                Show all dates
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </motion.div>
                </AnimatePresence>
            ) : (
                /* ── LIST / TABLE VIEW ── */
                <>
                    {/* Mobile: vertical list rows, tap → bottom drawer */}
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={`list-${priorityFilter}-${datePreset}-${stripDate ?? ''}`}
                            className="md:hidden border border-border/40 rounded-xl overflow-hidden"
                            variants={pageVariants}
                            initial="hidden"
                            animate="show"
                            exit={{ opacity: 0, transition: { duration: 0.12 } }}
                        >
                            {filteredBidOpportunities.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                                    <div className="h-12 w-12 rounded-2xl bg-muted/40 flex items-center justify-center">
                                        <Calendar className="h-6 w-6 text-muted-foreground/40" />
                                    </div>
                                    <p className="text-sm font-semibold text-foreground/60">No shifts match your filters</p>
                                </div>
                            ) : (
                                filteredBidOpportunities.map(renderBidListItem)
                            )}
                        </motion.div>
                    </AnimatePresence>

                    {/* Desktop: traditional sortable table */}
                    <div className="hidden md:block overflow-x-auto border border-border rounded-lg">
                        <table className="w-full text-sm text-foreground">
                            <thead className="bg-muted/60 text-xs">
                                <tr>
                                    <th className="p-3 text-left w-[40px]">
                                        <input
                                            type="checkbox"
                                            checked={
                                                filteredBidOpportunities.some(o => o.participationStatus === 'not_participated' && o.isEligible) &&
                                                filteredBidOpportunities
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
                                {filteredBidOpportunities.map(opp => {
                                    const { participationStatus, currentBid } = opp;
                                    const shiftStart = opp.startAt
                                        ? new Date(opp.startAt)
                                        : parseZonedDateTime(opp.date, opp.startTime, SYDNEY_TZ);
                                    const biddingCloses = new Date(shiftStart.getTime() - 4 * 60 * 60 * 1000);
                                    const isExpired = new Date() >= biddingCloses;
                                    const canSelect = participationStatus === 'not_participated' && opp.isEligible;

                                    return (
                                        <tr key={opp.id} className="border-t border-border/50 hover:bg-muted/30 transition-colors">
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
                                                                className="h-7 text-xs border-border/40 hover:bg-red-500/10 hover:text-red-400"
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
                </>
            )}

            {/* ── FLOATING BULK ACTION BAR ── */}
            <AnimatePresence>
                {selectedShiftIds.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: 50, x: '-50%' }}
                        animate={{ opacity: 1, y: 0, x: '-50%' }}
                        exit={{ opacity: 0, y: 50, x: '-50%' }}
                        className="fixed bottom-24 md:bottom-6 left-1/2 z-50 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-5 py-3 rounded-full shadow-2xl flex items-center gap-4 border border-slate-700 dark:border-slate-200"
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

            {/* ── BID DETAIL DRAWER (mobile list tap) ── */}
            <Drawer open={drawerOpp !== null} onOpenChange={open => { if (!open) setDrawerOpp(null); }}>
                <DrawerContent className="max-h-[88dvh] flex flex-col">
                    <div className="overflow-y-auto flex-1 px-4 pb-8">
                        {drawerOpp && (() => {
                            const opp = drawerOpp;
                            const { participationStatus, currentBid } = opp;
                            const shiftStart = opp.startAt
                                ? new Date(opp.startAt)
                                : parseZonedDateTime(opp.date, opp.startTime, SYDNEY_TZ);
                            const biddingCloses = new Date(shiftStart.getTime() - 4 * 60 * 60 * 1000);
                            const tr = calculateTimeRemaining(biddingCloses.toISOString());
                            const isExpired = tr.isExpired;
                            const timerStr = formatTimeRemaining(tr);
                            const priority = getBidPriority(opp);
                            const pConf = PRIORITY_CONFIG[priority];
                            const netH = Math.floor(opp.netLength / 60);
                            const netM = Math.round(opp.netLength % 60);
                            const netStr = netH > 0 ? `${netH}h${netM > 0 ? ` ${netM}m` : ''}` : `${netM}m`;

                            return (
                                <>
                                    {/* Header */}
                                    <div className="flex items-start justify-between pt-2 pb-4 border-b border-border/40">
                                        <div className="min-w-0 pr-3">
                                            <DrawerTitle className="text-base font-bold leading-tight">{opp.role}</DrawerTitle>
                                            <p className="text-sm text-muted-foreground mt-0.5 truncate">
                                                {opp.department}{opp.subGroup && opp.subGroup !== opp.department ? ` · ${opp.subGroup}` : ''}
                                            </p>
                                            {priority !== 'normal' && (
                                                <span className={cn('inline-flex items-center gap-1 text-[10px] font-black uppercase px-2 py-0.5 rounded-full border mt-1.5', pConf.badgeCls)}>
                                                    <pConf.icon className="h-2.5 w-2.5" />{pConf.label}
                                                </span>
                                            )}
                                        </div>
                                        <DrawerClose asChild>
                                            <button className="shrink-0 h-8 w-8 flex items-center justify-center rounded-full bg-muted/50 text-muted-foreground hover:bg-muted transition-colors">
                                                <X className="h-4 w-4" />
                                            </button>
                                        </DrawerClose>
                                    </div>

                                    {/* Detail grid */}
                                    <div className="grid grid-cols-2 gap-2.5 mt-4">
                                        {[
                                            { label: 'Date',     value: format(parseISO(opp.date), 'EEE, d MMM yyyy') },
                                            { label: 'Time',     value: `${opp.startTime} – ${opp.endTime}`, mono: true },
                                            { label: 'Duration', value: netStr },
                                            { label: 'Level',    value: opp.remunerationLevel },
                                        ].map(({ label, value, mono }) => (
                                            <div key={label} className="flex flex-col gap-0.5 p-3 rounded-xl bg-muted/30 border border-border/30">
                                                <span className="text-[9px] uppercase tracking-widest text-muted-foreground/50 font-bold">{label}</span>
                                                <span className={cn('text-sm font-semibold mt-0.5', mono && 'font-mono')}>{value}</span>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Bidding timer */}
                                    {!isExpired && timerStr && (
                                        <div className="flex items-center gap-2 mt-4 px-3 py-2.5 rounded-xl bg-amber-500/8 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-sm">
                                            <Clock className="h-4 w-4 shrink-0" />
                                            <span>Closes in <strong>{timerStr}</strong></span>
                                        </div>
                                    )}

                                    {/* Iteration badge */}
                                    {(opp.bidding_iteration || 1) > 1 && (
                                        <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-xl bg-muted/30 border border-border/30 text-xs text-muted-foreground font-mono">
                                            <History className="h-3.5 w-3.5" />
                                            Iteration {opp.bidding_iteration}
                                        </div>
                                    )}

                                    {/* Actions */}
                                    <div className="flex flex-col gap-2 mt-5">
                                        {participationStatus === 'not_eligible' && (
                                            <div className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 text-sm font-medium">
                                                <XCircle className="h-4 w-4 shrink-0" /> You dropped this shift
                                            </div>
                                        )}
                                        {participationStatus === 'not_participated' && opp.isEligible && !isExpired && (
                                            <Button
                                                className="w-full h-12 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm shadow-lg shadow-indigo-900/20"
                                                onClick={() => { handleQuickBid(opp); setDrawerOpp(null); }}
                                                disabled={placeBidMutation.isPending}
                                            >
                                                {placeBidMutation.isPending && placeBidMutation.variables === opp.id
                                                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                    : <ThumbsUp className="mr-2 h-4 w-4" />
                                                }
                                                {placeBidMutation.isPending && placeBidMutation.variables === opp.id ? 'Placing…' : 'Bid Now'}
                                            </Button>
                                        )}
                                        {participationStatus === 'not_participated' && !opp.isEligible && (
                                            <div className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 text-sm font-medium">
                                                <Ban className="h-4 w-4 shrink-0" />
                                                <span>{opp.ineligibilityReason ?? 'Ineligible for this shift'}</span>
                                            </div>
                                        )}
                                        {participationStatus === 'not_participated' && isExpired && (
                                            <div className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-muted/30 border border-border/30 text-muted-foreground text-sm">
                                                <Ban className="h-4 w-4 shrink-0" /> Bidding Closed
                                            </div>
                                        )}
                                        {participationStatus === 'pending' && (
                                            <>
                                                <div className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400 text-sm font-medium">
                                                    <Clock className="h-4 w-4 shrink-0" /> Awaiting Manager Review
                                                </div>
                                                {!isExpired && currentBid && (
                                                    <Button
                                                        variant="outline"
                                                        className="w-full h-11 border-border/50 hover:bg-rose-500/10 hover:text-rose-500 hover:border-rose-500/30 text-sm"
                                                        onClick={() => { handleWithdrawBid(currentBid.id); setDrawerOpp(null); }}
                                                        disabled={withdrawBidMutation.isPending}
                                                    >
                                                        <XCircle className="mr-2 h-4 w-4" /> Withdraw Bid
                                                    </Button>
                                                )}
                                            </>
                                        )}
                                        {participationStatus === 'selected' && (
                                            <div className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-sm font-medium">
                                                <CheckCircle className="h-4 w-4 shrink-0" /> Bid Selected — Assigned to You
                                            </div>
                                        )}
                                        {participationStatus === 'rejected' && (
                                            <div className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-muted/30 border border-border/30 text-muted-foreground text-sm">
                                                <Ban className="h-4 w-4 shrink-0" /> Not Selected This Round
                                            </div>
                                        )}
                                        {participationStatus === 'expired' && (
                                            <div className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-muted/30 border border-border/30 text-muted-foreground text-sm">
                                                <Ban className="h-4 w-4 shrink-0" /> Bidding Closed
                                            </div>
                                        )}
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                </DrawerContent>
            </Drawer>
        </motion.div>
    );
};

export default EmployeeBidsPage;
