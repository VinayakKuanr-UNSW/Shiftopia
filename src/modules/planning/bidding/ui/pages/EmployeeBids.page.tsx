import React, { useState } from 'react';
import { useAuth } from '@/platform/auth/useAuth';

import { useTableSorting } from '@/modules/core/hooks/useTableSorting';
import { SortableTableHeader } from '@/modules/core/ui/primitives/sortable-table-header';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO, parse } from 'date-fns';
import { SYDNEY_TZ, parseZonedDateTime, formatInTimezone } from '@/modules/core/lib/date.utils';
import { biddingApi } from '../../api/bidding.api';
import { validateCompliance, type ComplianceResult, type QualificationViolation } from '@/modules/rosters/services/compliance.service';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/modules/core/ui/primitives/tooltip';
import {
    Info, User,
    Calendar, Clock, ThumbsUp, ShieldAlert, Ban, Flame,
    Megaphone, UserPlus, UserCheck as LucideUserCheck, Circle, Minus, Gavel, Coffee, Shield, Loader2, AlertTriangle, CheckCircle, XCircle,
    Filter, Zap, Signal
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Tabs, TabsContent } from '@/modules/core/ui/primitives/tabs';
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
    
    // Urgent if within 24h
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
    const { scope, setScope, scopeKey, isGammaLocked, isLoading: isScopeLoading } = useScopeFilter('personal');
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState<'available' | 'myBids'>('available');
    const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
    const [priorityFilter, setPriorityFilter] = useState<BidPriority | 'all'>('all');


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

    const hierarchyFilters = {
        organizationId: scope.org_ids[0] ?? '',
        departmentId: scope.dept_ids[0] ?? undefined,
        subDepartmentId: scope.subdept_ids[0] ?? undefined,
    };

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
    // BUCKET A: ELIGIBILITY SCAN
    // Stable query — React Query handles dependency tracking, caching, and
    // cancellation. The queryKey string is a primitive so React Query only
    // re-fetches when the actual set of shift IDs changes, not on every render.
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
                    // Edge function unreachable → optimistic pass (fail-open)
                    newMap.set(s.id, { eligible: true, reasons: [] });
                }
            });
            return newMap;
        },
        enabled: !!user && rawAvailableShifts.length > 0,
        staleTime: 5 * 60_000,   // re-use cached result for 5 min
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
                isEligible:          eligibilityMap.get(s.id)?.eligible ?? true,   // optimistic until scan completes
                ineligibilityReason: eligibilityMap.get(s.id)?.reasons.join(' · ') ?? undefined,
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
    }, [rawAvailableShifts, eligibilityMap]);

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
    // FILTERS — NO DUPLICATES: Available excludes shifts with active bids
    // ========================================================================
    const myBidShiftIds = React.useMemo(() => {
        return new Set(myBids.filter(b => b.status !== 'withdrawn').map(b => String(b.shiftId)));
    }, [myBids]);

    const filteredAvailableShifts = React.useMemo(() => {
        return shiftsTableSort.sortedData.filter(s => {
            // Priority Filter
            if (priorityFilter !== 'all') {
                const p = getBidPriority(s);
                if (p !== priorityFilter) return false;
            }

            // ISSUE 3: Filter OUT expired shifts from Available Bids
            const shiftStart = s.startAt
                ? new Date(s.startAt)
                : parseZonedDateTime(s.date, s.startTime, SYDNEY_TZ);
            const biddingCloses = new Date(shiftStart.getTime() - 4 * 60 * 60 * 1000);
            const isExpired = new Date() >= biddingCloses;
            if (isExpired) return false;

            // Exclude shifts the user already has active bids on
            return !myBidShiftIds.has(String(s.id));
        });
    }, [shiftsTableSort.sortedData, myBidShiftIds, priorityFilter]);

    // My Bids: ISSUE 3 — filter out expired pending bids, keep accepted/rejected
    const filteredMyBids = React.useMemo(() => {
        return bidsTableSort.sortedData.filter(bid => {
            // Priority Filter
            if (priorityFilter !== 'all') {
                const p = getBidPriority(bid);
                if (bid.status === 'pending' && p !== priorityFilter) return false;
                // For accepted/selected/rejected, we might still want to filter by priority if the user expects it
                // but usually priority is a "live" thing. Let's filter it consistently.
                if (p !== priorityFilter) return false;
            }

            // Terminal outcomes (accepted/rejected) always shown
            if (bid.status === 'accepted' || bid.status === 'selected') return true;
            if (bid.status === 'rejected') return true;
            // Pending bids: only show if NOT expired
            if (bid.status === 'pending') {
                const shiftStart = bid.startAt
                    ? new Date(bid.startAt)
                    : parseZonedDateTime(bid.date, bid.startTime, SYDNEY_TZ);
                const biddingCloses = new Date(shiftStart.getTime() - 4 * 60 * 60 * 1000);
                return new Date() < biddingCloses;
            }
            // Withdrawn bids: don't show
            return false;
        });
    }, [bidsTableSort.sortedData, priorityFilter]);

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

    // Direct bid — no compliance gate (Bucket A already checked at scan time)
    // After success, run B/C/D in background and show advisory toast if needed
    const handleQuickBid = (shift: ShiftData) => {
        placeBidMutation.mutate(shift.id, {
            onSuccess: () => {
                // Background soft check for Buckets B/C/D (fire-and-forget)
                validateCompliance({
                    employeeId: user!.id,
                    shiftDate: shift.date,
                    startTime: shift.startTime + ':00',
                    endTime:   shift.endTime   + ':00',
                    netLengthMinutes: shift.netLength,
                    shiftId: shift.id,
                }).then(result => {
                    // Only advisory for B/C/D — qualification issues are already surfaced via badge
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
                }).catch(() => { /* ignore background check failures */ });
            },
        });
    };

    const handleWithdrawBid = (bidId: string) => {
        withdrawBidMutation.mutate(bidId);
    };

    const handleBulkBid = async () => {
        if (!user) return;

        // Only bid on eligible, non-dropped shifts
        const validIds = selectedBidIds.filter(id => {
            const shift = availableShifts.find(s => s.id === id);
            if (!shift) return false;
            const isDroppedByMe = user.id === shift.droppedById;
            return !isDroppedByMe && (eligibilityMap.get(id)?.eligible !== false);
        });

        if (validIds.length === 0) {
            toast({
                title: 'No eligible shifts selected',
                description: 'All selected shifts are either ineligible or previously dropped.',
                variant: 'destructive',
            });
            return;
        }

        const results = await Promise.allSettled(
            validIds.map(id => biddingApi.placeBid(id, user.id))
        );

        const succeeded = results.filter(r => r.status === 'fulfilled').length;
        const failed    = results.filter(r => r.status === 'rejected').length;

        toast({
            title: `${succeeded} bid${succeeded !== 1 ? 's' : ''} placed`,
            description: failed > 0 ? `${failed} shift${failed !== 1 ? 's' : ''} failed to submit` : undefined,
        });

        setSelectedBidIds([]);
        queryClient.invalidateQueries({ queryKey: ['openBidShifts'] });
        queryClient.invalidateQueries({ queryKey: ['myBids'] });
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
        const isDroppedByMe = user?.id === shift.droppedById;

        // Calculate bidding closes:
        const shiftStart = shift.startAt
            ? new Date(shift.startAt)
            : parseZonedDateTime(shift.date, shift.startTime, SYDNEY_TZ);

        // Bidding closes 4 hours before shift start
        const biddingCloses = new Date(shiftStart.getTime() - 4 * 60 * 60 * 1000);
        const tr = calculateTimeRemaining(biddingCloses.toISOString());

        // ── DERIVE TIMER DISPLAY ──
        // ISSUE 2: Only show timer for pending, non-expired bids. Terminal states are handled by footer badges/actions.
        const isTerminalBid = isBidCard && (bidStatus === 'accepted' || bidStatus === 'selected' || bidStatus === 'rejected');
        const timerDisplay = isTerminalBid
            ? null
            : tr.isExpired
                ? 'Bidding Closed'
                : `Closes in ${formatTimeRemaining(tr)}`;

        return (
            <SharedShiftCard
                key={shift.id}
                organization={shift.organization}
                department={shift.department}
                subGroup={shift.subGroup}
                role={shift.role}
                shiftDate={shift.date}
                startTime={shift.startTime}
                endTime={shift.endTime}
                netLength={shift.netLength}
                paidBreak={shift.paidBreak}
                unpaidBreak={shift.unpaidBreak}
                timerText={timerDisplay}
                isExpired={isTerminalBid ? false : tr.isExpired}
                isUrgent={shift.isUrgent}
                lifecycleStatus={shift.lifecycleStatus || 'Published'}
                groupVariant={
                    shift.groupType === 'convention_centre' ? 'convention' :
                    shift.groupType === 'exhibition_centre' ? 'exhibition' :
                    shift.groupType === 'theatre' ? 'theatre' : 'default'
                }

                footerActions={
                    <div className="flex flex-col gap-2">
                        {isBidCard ? (
                            /* ── MY BIDS STATE MACHINE ── */
                            <>
                                {/* Status Badge — deterministic from bid.status */}
                                {bidStatus === 'pending' ? (
                                    <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400 text-sm font-medium">
                                        <Clock className="h-4 w-4" /> Awaiting Manager Review
                                    </div>
                                ) : (bidStatus === 'selected' || bidStatus === 'accepted') ? (
                                    <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-sm font-medium">
                                        <CheckCircle className="h-4 w-4" />
                                        {bidStatus === 'selected' ? 'Selected | Awaiting Manager Review' : 'Accepted — Assigned to You'}
                                    </div>
                                ) : (
                                    <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-400 dark:text-white/40 text-sm">
                                        <Ban className="h-4 w-4" /> Bid Not Selected
                                    </div>
                                )}
                                {/* ISSUE 1: Withdraw ONLY when pending AND not expired — terminal states have NO actions */}
                                {bidStatus === 'pending' && !tr.isExpired && (
                                    <Button
                                        variant="outline"
                                        className="w-full border-slate-200 dark:border-white/10 hover:bg-red-500/10 hover:text-red-400 h-10"
                                        onClick={() => {
                                            const bid = myBids.find(b => String(b.shiftId) === String(shift.id) && b.status !== 'withdrawn');
                                            if (bid) handleWithdrawBid(bid.id);
                                        }}
                                        disabled={withdrawBidMutation.isPending}
                                    >
                                        <XCircle className="mr-1.5 h-4 w-4" /> Withdraw
                                    </Button>
                                )}
                            </>
                        ) : (
                            /* ── AVAILABLE BIDS ACTIONS (expired already filtered out in filteredAvailableShifts) ── */
                            isDroppedByMe ? (
                                <div className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 text-sm font-medium">
                                    <XCircle className="h-4 w-4" /> Shift Dropped (Cannot Re-bid)
                                </div>
                            ) : shift.isEligible ? (
                                <Button
                                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/20 font-bold h-10 transition-all active:scale-[0.98]"
                                    onClick={() => handleQuickBid(shift)}
                                    disabled={placeBidMutation.isPending}
                                >
                                    {eligibilityLoading && !eligibilityMap.has(shift.id) ? (
                                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                                    ) : placeBidMutation.isPending && placeBidMutation.variables === shift.id ? (
                                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                                    ) : (
                                        <ThumbsUp className="mr-1.5 h-4 w-4" />
                                    )}
                                    {placeBidMutation.isPending && placeBidMutation.variables === shift.id ? 'Placing…' : 'Bid Now'}
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
                                            {shift.ineligibilityReason ?? 'You are not eligible for this shift'}
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            )
                        )}
                    </div>
                }
                topContent={
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={selectedBidIds.includes(shift.id)}
                            onChange={() => handleSelectBid(shift.id)}
                            disabled={!isBidCard && !shift.isEligible}
                            className="h-4 w-4 rounded border-white/20 bg-white/5 text-primary focus:ring-primary/30"
                        />
                        <span className="text-[10px] text-muted-foreground/60 font-bold uppercase tracking-wider">Select</span>
                    </div>
                }
            />
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
                    { id: 'myBids', label: 'My Bids', count: filteredMyBids.length }
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

                    <div className="flex gap-2 items-center flex-wrap mb-4">
                        {/* Eligibility loading indicator */}
                        {eligibilityLoading && (
                            <span className="flex items-center gap-1 text-xs text-slate-400 dark:text-white/40">
                                <Loader2 className="h-3 w-3 animate-spin" /> Checking eligibility…
                            </span>
                        )}
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
                                                            {isDroppedByMe ? (
                                                                <div className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 text-[10px] font-medium">
                                                                    <XCircle className="h-3 w-3" /> Dropped
                                                                </div>
                                                            ) : isBidPlaced ? (
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="h-8 text-xs flex-1 border-slate-200 dark:border-white/10 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                                                                    onClick={() => handleWithdrawBid(existingBid!.id)}
                                                                >
                                                                    <XCircle className="mr-1 h-3 w-3" /> Withdraw
                                                                </Button>
                                                            ) : shift.isEligible ? (
                                                                <Button
                                                                    size="sm"
                                                                    className="h-8 text-xs flex-1 bg-indigo-600 hover:bg-indigo-700 text-white"
                                                                    disabled={!canBid || placeBidMutation.isPending}
                                                                    onClick={() => { if (canBid) handleQuickBid(shift); }}
                                                                    title={!canBid ? blockReason : 'Bid on this shift'}
                                                                >
                                                                    {placeBidMutation.isPending && placeBidMutation.variables === shift.id ? (
                                                                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                                                    ) : (
                                                                        <ThumbsUp className="mr-1 h-3 w-3" />
                                                                    )}
                                                                    Bid
                                                                </Button>
                                                            ) : (
                                                                <TooltipProvider>
                                                                    <Tooltip>
                                                                        <TooltipTrigger asChild>
                                                                            <span className="flex-1">
                                                                                <Button
                                                                                    size="sm"
                                                                                    disabled
                                                                                    className="h-8 text-xs w-full bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 cursor-not-allowed pointer-events-none"
                                                                                >
                                                                                    <Ban className="mr-1 h-3 w-3" /> Ineligible
                                                                                </Button>
                                                                            </span>
                                                                        </TooltipTrigger>
                                                                        <TooltipContent side="top" className="max-w-[200px] text-xs">
                                                                            {shift.ineligibilityReason ?? 'Not eligible for this shift'}
                                                                        </TooltipContent>
                                                                    </Tooltip>
                                                                </TooltipProvider>
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
                                                {(() => {
                                                    // ISSUE 1 (table): Withdraw only for pending + non-expired
                                                    const bidShiftStart = bid.startAt
                                                        ? new Date(bid.startAt)
                                                        : parseZonedDateTime(bid.date, bid.startTime, SYDNEY_TZ);
                                                    const bidBiddingCloses = new Date(bidShiftStart.getTime() - 4 * 60 * 60 * 1000);
                                                    const bidIsExpired = new Date() >= bidBiddingCloses;

                                                    if (bid.status === 'pending' && !bidIsExpired) {
                                                        return (
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                className="h-7 text-xs border-slate-200 dark:border-white/10 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                                                                onClick={() => handleWithdrawBid(bid.id)}
                                                                disabled={withdrawBidMutation.isPending}
                                                            >
                                                                <XCircle className="mr-1 h-3 w-3" /> Withdraw
                                                            </Button>
                                                        );
                                                    }
                                                    if (bid.status === 'selected' || bid.status === 'accepted') {
                                                        return <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle size={14} /> {bid.status === 'selected' ? 'Selected' : 'Won'}</span>;
                                                    }
                                                    if (bid.status === 'rejected') {
                                                        return <span className="text-xs text-slate-400 dark:text-white/40 flex items-center gap-1"><Ban size={14} /> Rejected</span>;
                                                    }
                                                    // Default: no action for terminal/expired
                                                    return <span className="text-xs text-slate-400 dark:text-white/40">—</span>;
                                                })()}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </TabsContent>
            </Tabs>

            {/* FLOATING BULK ACTION BAR */}
            <AnimatePresence>
                {selectedBidIds.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: 50, x: '-50%' }}
                        animate={{ opacity: 1, y: 0, x: '-50%' }}
                        exit={{ opacity: 0, y: 50, x: '-50%' }}
                        className="fixed bottom-6 left-1/2 z-50 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-5 py-3 rounded-full shadow-2xl flex items-center gap-4 border border-slate-700 dark:border-slate-200"
                    >
                        <div className="flex items-center gap-2">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500 text-[12px] font-bold text-white shadow-sm">
                                {selectedBidIds.length}
                            </span>
                            <span className="text-sm font-semibold">Selected</span>
                        </div>
                        
                        <div className="h-5 w-[1px] bg-white/20 dark:bg-black/10 mx-1" />
                        
                        <div className="flex items-center gap-1">
                            <Button 
                                size="sm" 
                                variant="ghost" 
                                className="hover:bg-white/10 dark:hover:bg-slate-100 text-white dark:text-slate-900 rounded-full h-8 px-3 text-xs font-medium" 
                                onClick={() => activeTab === 'available' ? handleSelectAllAvailable(true) : handleSelectAllMyBids(true)}
                            >
                                Select All
                            </Button>
                            <Button 
                                size="sm" 
                                variant="ghost" 
                                className="hover:bg-white/10 dark:hover:bg-slate-100 text-white dark:text-slate-900 rounded-full h-8 px-3 text-xs font-medium" 
                                onClick={() => setSelectedBidIds([])}
                            >
                                Deselect All
                            </Button>
                            
                            <Button 
                                size="sm" 
                                className="bg-indigo-500 hover:bg-indigo-600 dark:bg-indigo-600 dark:hover:bg-indigo-700 text-white rounded-full h-8 px-5 text-xs font-bold ml-2 shadow-md transition-transform active:scale-95" 
                                onClick={activeTab === 'available' ? handleBulkBid : handleBulkWithdraw}
                                disabled={placeBidMutation.isPending}
                            >
                                {activeTab === 'available' ? (
                                    <><ThumbsUp className="mr-1.5 h-3.5 w-3.5" /> Bid Selected</>
                                ) : (
                                    <><XCircle className="mr-1.5 h-3.5 w-3.5" /> Withdraw Selected</>
                                )}
                            </Button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

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

