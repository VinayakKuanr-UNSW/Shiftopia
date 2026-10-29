import { PageState } from '@/modules/core/ui/components/PageState';
import React, { useState } from 'react';
import { useAuth } from '@/platform/auth/useAuth';

import { useTableSorting } from '@/modules/core/hooks/useTableSorting';
import { SortableTableHeader } from '@/modules/core/ui/primitives/sortable-table-header';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { startOfWeekAU, endOfWeekAU } from '@/modules/core/lib/date/week';
import { SYDNEY_TZ, parseZonedDateTime, formatShiftTime, formatShiftDate, getShiftDateKey } from '@/modules/core/lib/date.utils';
import { biddingApi } from '../../api/bidding.api';
import { validateCompliance, type ComplianceResult, type QualificationViolation } from '@/modules/rosters/services/compliance.service';
import { useBreakpoint } from '@/modules/core/hooks/useBreakpoint';
import {
    
    Calendar, Clock, ThumbsUp, Ban,
    Gavel, Loader2, CheckCircle, XCircle,
    ListChecks, Settings2
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { cn } from '@/modules/core/lib/utils';
import { surface } from '@/modules/core/ui/layout/pageTokens';
import { useToast } from '@/modules/core/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { determineShiftState } from '@/modules/rosters/domain/shift-state.utils';
import { calculateTimeRemaining, formatTimeRemaining } from '../views/OpenBidsView/utils';

import { BidComplianceModal } from '../components/BidComplianceModal';
import { BidConfirmComplianceDialog } from '../components/BidConfirmComplianceDialog';
import { BidOpportunityDrawer } from '../components/BidOpportunityDrawer';
import { BidOpportunityCard } from '../components/BidOpportunityCard';
import { BidOpportunityListItem } from '../components/BidOpportunityListItem';
import { BidOpportunityListSection } from '../components/BidOpportunityListSection';
import { BidSelectionToolbar } from '../components/BidSelectionToolbar';
import { groupOpportunities, type BidGroupBy } from '../utils/bid-grouping';
import { GroupBySelector, type GroupBySelectorOption } from '@/modules/core/ui/components/GroupBySelector';

import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { PageLayout } from '@/modules/core/ui/layout/PageLayout';
import { ToolbarIconButton, toolbar } from '@/modules/core/ui/components/Toolbar';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { soleOrgId, deptIds, subDeptIds } from '@/platform/auth/scope-narrowing';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { Popover, PopoverTrigger, PopoverContent } from '@/modules/core/ui/primitives/popover';
import { Check } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/modules/core/ui/primitives/tooltip';
import { getDeptColor, getRowClass } from '../utils/bid-dept-styles';
import { getParticipationStatus } from '../utils/bid-participation';
import { useRealtimeInvalidate } from '@/platform/supabase/hooks/useRealtimeInvalidate';
import type { ShiftData, BidData, ShiftOpportunity } from '../types';
import { Table, tableTokens, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/modules/core/ui/primitives/table';

const BID_GROUP_BY_OPTIONS: GroupBySelectorOption<BidGroupBy>[] = [
    { value: 'subDepartment', label: 'Sub-Department' },
    { value: 'group', label: 'Group' },
    { value: 'subGroupName', label: 'Sub-Group' },
    { value: 'role', label: 'Role' },
    { value: 'date', label: 'Date' },
    { value: 'none', label: 'None' },
];

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
// ============================================================================
// COMPONENT
// ============================================================================
const EmployeeBidsPage: React.FC = () => {
    const { user } = useAuth();
    const breakpoint = useBreakpoint();
    const isMobile = breakpoint === 'mobile';
    const { scope, setScope, scopeKey, isGammaLocked, isLoading: isScopeLoading } = useScopeFilter('personal');
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { isDark } = useTheme();
    const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
    // Default to the current week (Mon–Sun) preset on every load.
    const [startDate, setStartDate] = useState<Date>(() => startOfWeekAU(new Date()));
    const [endDate, setEndDate]     = useState<Date>(() => endOfWeekAU(new Date()));

    const [drawerOpp, setDrawerOpp] = useState<ShiftOpportunity | null>(null);
    const [groupBy, setGroupBy] = useState<BidGroupBy>('date');
    const [showIneligible, setShowIneligible] = useState(false);
    const [showExpired, setShowExpired] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    // Selection (for bulk bid on not_participated eligible shifts)
    const [selectedV8ShiftIds, setSelectedV8ShiftIds] = useState<any[]>([]);
    const [isBulkModeActive, setIsBulkModeActive] = useState<boolean>(false);

    // Compliance Check State
    const [complianceResult, setComplianceResult] = useState<ComplianceResult | null>(null);
    const [showComplianceDialog, setShowComplianceDialog] = useState(false);
    const [pendingBidShift, setPendingBidShift] = useState<ShiftData | null>(null);
    const [availabilityWarning, setAvailabilityWarning] = useState<string | null>(null);

    // Compliance Modal State
    const [complianceModalShift, setComplianceModalShift] = useState<ShiftData | null>(null);
    const [isComplianceModalOpen, setIsComplianceModalOpen] = useState(false);

    const hierarchyFilters = {
        // Narrow only when unambiguous; the dept/sub-dept levels already passed
        // the whole selection, and now drop non-UUIDs before they reach `.in()`.
        organizationId: soleOrgId(scope) ?? '',
        departmentId: deptIds(scope),
        subDepartmentId: subDeptIds(scope),
    };

    // ========================================================================
    // DATA FETCHING
    // ========================================================================
    const { data: rawAvailableShifts = [] } = useQuery({
        queryKey: ['openBidShifts', scopeKey, hierarchyFilters.organizationId, hierarchyFilters.departmentId, hierarchyFilters.subDepartmentId],
        queryFn: () => biddingApi.getOpenBidShifts(hierarchyFilters),
        enabled: !!user && !!hierarchyFilters.organizationId && !isScopeLoading,
        staleTime: 60_000, // 1 minute staleTime
    });

    const { data: rawMyBids = [] } = useQuery({
        queryKey: ['myBids', user?.id],
        queryFn: () => (user ? biddingApi.getMyBids(user.id) : Promise.resolve([])),
        enabled: !!user,
        staleTime: 60_000, // 1 minute staleTime
    });

    // Realtime: refresh my bids live when shift_bids change (RLS-scoped to own).
    useRealtimeInvalidate(
        `bids-rt-${user?.id ?? ''}`,
        ['shift_bids'],
        () => {
            queryClient.invalidateQueries({ queryKey: ['myBids'] });
            queryClient.invalidateQueries({ queryKey: ['openBidShifts'] });
        },
        !!user,
    );

    // ========================================================================
    // BUCKET A: ELIGIBILITY SCAN (5-min cache)
    // ========================================================================
    const eligibilityQueryKey = rawAvailableShifts.map(s => s.id).join('|');

    const { data: eligibilityMap = new Map<string, { eligible: boolean; reasons: string[] }>(), isPending: eligibilityPending, isFetching: eligibilityLoading } = useQuery({
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
            setSelectedV8ShiftIds([]);
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
            setSelectedV8ShiftIds([]);
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
            const isUrgent = timeToStartHours > 0 && timeToStartHours < 24;

            return {
                id: s.id,
                role: s.roles?.name || 'Unknown',
                organization: (s as any).organizations?.name || 'MCEC',
                department: s.departments?.name || 'Unknown',
                subDepartment: s.sub_departments?.name || 'General',
                subDepartmentId: (s as any).sub_department_id ?? null,
                group: (() => {
                    const t = s.group_type;
                    if (!t) return 'General';
                    const map: Record<string, string> = {
                        'convention_centre': 'Convention Centre',
                        'exhibition_centre': 'Exhibition Centre',
                        'theatre': 'Theatre',
                        'the_cutaway': 'The Cutaway',
                        'cutaway': 'The Cutaway',
                        'office': 'Office',
                    };
                    if (map[t]) return map[t];
                    if (t.toLowerCase().includes('cutaway')) return 'The Cutaway';
                    return t.replace(/_/g, ' ');
                })(),
                subGroupName: s.sub_group_name || 'General',
                subGroup: s.sub_departments?.name || 'General',
                date: getShiftDateKey(s as any) ?? s.shift_date,
                weekday: formatShiftDate(s as any, 'EEE', format(parseISO(s.shift_date), 'EEE')),
                startTime: formatShiftTime(s as any, 'start', 'HH:mm', s.start_time?.slice(0, 5)),
                endTime: formatShiftTime(s as any, 'end', 'HH:mm', s.end_time?.slice(0, 5)),
                startAt: shiftStartAt.toISOString(),
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
                lifecycleStatus: s.lifecycle_status,
                subGroupColor: getDeptColor(s.group_type, s.departments?.name || ''),
                droppedById: (s as any).dropped_by_id,
                last_dropped_by: (s as any).last_dropped_by,
                last_rejected_by: (s as any).last_rejected_by ?? null
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
                subDepartment: s.sub_departments?.name || 'General',
                group: (() => {
                    const t = s.group_type;
                    if (!t) return 'General';
                    const map: Record<string, string> = {
                        'convention_centre': 'Convention Centre',
                        'exhibition_centre': 'Exhibition Centre',
                        'theatre': 'Theatre',
                        'the_cutaway': 'The Cutaway',
                        'cutaway': 'The Cutaway',
                        'office': 'Office',
                    };
                    if (map[t]) return map[t];
                    if (t.toLowerCase().includes('cutaway')) return 'The Cutaway';
                    return t.replace(/_/g, ' ');
                })(),
                subGroupName: s.sub_group_name || 'General',
                subGroup: s.sub_departments?.name || 'General',
                date: getShiftDateKey(s as any) ?? s.shift_date,
                weekday: formatShiftDate(s as any, 'EEE', format(parseISO(s.shift_date), 'EEE')),
                startTime: formatShiftTime(s as any, 'start', 'HH:mm', s.start_time?.slice(0, 5)),
                endTime: formatShiftTime(s as any, 'end', 'HH:mm', s.end_time?.slice(0, 5)),
                startAt: shiftStartAt.toISOString(),
                endAt: (s as any).end_at,
                tzIdentifier: (s as any).tz_identifier,
                paidBreak,
                unpaidBreak,
                netLength,
                remunerationLevel: s.remuneration_levels?.level_name || 'Level-4',
                status: b.status as any,
                lifecycleStatus: s.lifecycle_status,
                bidTime: format(parseISO(b.created_at), 'yyyy-MM-dd HH:mm'),
                notes: b.notes,
                groupType: s.group_type,
                subGroupColor: getDeptColor(s.group_type, s.departments?.name || '')
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
        return shiftsTableSort.sortedData.map(shift => {
            const currentBid = myBids.find(b =>
                String(b.shiftId) === String(shift.id) &&
                b.status !== 'withdrawn'
            ) || null;

            const participationStatus = getParticipationStatus(shift, myBids, user?.id || '');

            return { ...shift, participationStatus, currentBid };
        });
    }, [shiftsTableSort.sortedData, myBids, user?.id]);

    // ========================================================================
    // SHIFT COUNTS BY DATE (dot indicators — pre-date-filter)
    // ========================================================================

    // ========================================================================
    // DATE-FILTERED BID OPPORTUNITIES
    // ========================================================================
    const filteredBidOpportunities = React.useMemo(() => {
        const startStr = format(startDate, 'yyyy-MM-dd');
        const endStr = format(endDate, 'yyyy-MM-dd');
        const now = Date.now();
        return bidOpportunities.filter(opp => {
            if (opp.date < startStr || opp.date > endStr) return false;

            const shiftStart = opp.startAt
                ? new Date(opp.startAt).getTime()
                : parseZonedDateTime(opp.date, opp.startTime, SYDNEY_TZ).getTime();
            const biddingCloses = new Date(shiftStart - 4 * 60 * 60 * 1000);
            const isExpired = now >= biddingCloses.getTime();

            // Ineligible check: if not eligible and showIneligible is false, filter out
            if (!opp.isEligible && !showIneligible) {
                return false;
            }

            // Expired check: if expired (either by status or closed window) and showExpired is false, filter out
            const isWindowExpired = opp.participationStatus === 'expired' || 
                                    isExpired || 
                                    (opp.participationStatus === 'not_participated' && isExpired) ||
                                    (opp.participationStatus === 'pending' && isExpired);

            if (isWindowExpired && !showExpired) {
                return false;
            }

            return true;
        });
    }, [bidOpportunities, startDate, endDate, showIneligible, showExpired]);

    // ========================================================================
    // SELECTION HANDLERS (only applicable to not_participated eligible shifts)
    // ========================================================================
    const handleSelectAll = (isChecked: boolean) => {
        if (isChecked) {
            const allIds = filteredBidOpportunities.map(o => o.id);
            setSelectedV8ShiftIds(allIds);
        } else {
            setSelectedV8ShiftIds([]);
        }
    };

    const handleSelectShift = (id: any) => {
        setSelectedV8ShiftIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };



    // ========================================================================
    // COMPLIANCE HANDLERS
    // ========================================================================

    const handleConfirmBidWithWarning = () => {
        if (pendingBidShift) placeBidMutation.mutate(pendingBidShift.id);
        setShowComplianceDialog(false);
        setPendingBidShift(null);
        setComplianceResult(null);
        setAvailabilityWarning(null);
    };

    const handleCancelBid = () => {
        setShowComplianceDialog(false);
        setPendingBidShift(null);
        setComplianceResult(null);
        setAvailabilityWarning(null);
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

    // ========================================================================
    // RENDER: Shift Opportunity Card
    // ========================================================================
    const renderOpportunityCard = (opp: ShiftOpportunity) => (
        <BidOpportunityCard
            key={opp.id}
            opp={opp}
            rawShift={rawAvailableShifts.find(s => s.id === opp.id)}
            isSelected={selectedV8ShiftIds.includes(opp.id)}
            onToggleSelect={handleSelectShift}
            onQuickBid={handleQuickBid}
            onWithdraw={handleWithdrawBid}
            isPlacingBid={placeBidMutation.isPending}
            placingBidId={placeBidMutation.variables}
            isWithdrawing={withdrawBidMutation.isPending}
            isBulkModeActive={isBulkModeActive}
        />
    );

    // ========================================================================
    // RENDER: Compact mobile list row (table view on mobile)
    // ========================================================================
    const renderBidListItem = (opp: ShiftOpportunity) => (
        <BidOpportunityListItem
            key={opp.id}
            opp={opp}
            isSelected={selectedV8ShiftIds.includes(opp.id)}
            onToggleSelect={handleSelectShift}
            onOpen={setDrawerOpp}
            onQuickBid={handleQuickBid}
            onWithdraw={handleWithdrawBid}
            isPlacingBid={placeBidMutation.isPending}
            placingBidId={placeBidMutation.variables}
            isWithdrawing={withdrawBidMutation.isPending}
            isBulkModeActive={isBulkModeActive}
        />
    );

    // Bulk bid on the provided ids (the toolbar pre-filters to bidable opps).
    const handleBulkBidForIds = async (ids: any[]) => {
        if (!user || ids.length === 0) return;
        const results = await Promise.allSettled(ids.map(id => biddingApi.placeBid(id, user.id)));
        const succeeded = results.filter(r => r.status === 'fulfilled').length;
        const failed    = results.filter(r => r.status === 'rejected').length;
        toast({
            title: `${succeeded} bid${succeeded !== 1 ? 's' : ''} placed`,
            description: failed > 0 ? `${failed} failed` : undefined,
        });
        setSelectedV8ShiftIds([]);
        queryClient.invalidateQueries({ queryKey: ['openBidShifts'] });
        queryClient.invalidateQueries({ queryKey: ['myBids'] });
    };

    // Bulk withdraw selected pending bids (used by mobile selection toolbar)
    const handleBulkWithdraw = async (bidIds: string[]) => {
        if (bidIds.length === 0) return;
        const results = await Promise.allSettled(bidIds.map(id => biddingApi.withdrawBid(id)));
        const succeeded = results.filter(r => r.status === 'fulfilled').length;
        const failed    = results.filter(r => r.status === 'rejected').length;
        toast({
            title: `${succeeded} bid${succeeded !== 1 ? 's' : ''} withdrawn`,
            description: failed > 0 ? `${failed} failed` : undefined,
        });
        setSelectedV8ShiftIds([]);
        queryClient.invalidateQueries({ queryKey: ['openBidShifts'] });
        queryClient.invalidateQueries({ queryKey: ['myBids'] });
    };

    return (
        <PageLayout>
            {/* ── GOLD STANDARD HEADER (Rows 1 · 2 · 3) ── */}
            <GoldStandardHeader
                title="My Bids"
                Icon={Gavel}
                scope={scope}
                setScope={setScope}
                isGammaLocked={isGammaLocked}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                startDate={startDate}
                endDate={endDate}
                onDateChange={(start: Date, end: Date) => {
                    setStartDate(start);
                    setEndDate(end);
                }}
                isLoading={eligibilityLoading}
                subFunctionBar={isBulkModeActive ? (
                    <BidSelectionToolbar
                        selectedIds={selectedV8ShiftIds}
                        visibleOpportunities={filteredBidOpportunities}
                        onSelectAllVisible={(ids) => setSelectedV8ShiftIds(ids)}
                        onClear={() => setSelectedV8ShiftIds([])}
                        onBidSelected={handleBulkBidForIds}
                        onWithdrawSelected={handleBulkWithdraw}
                        isBidding={placeBidMutation.isPending}
                        isWithdrawing={withdrawBidMutation.isPending}
                        isBulkModeActive={isBulkModeActive}
                        onCloseBulkMode={() => {
                            setIsBulkModeActive(false);
                            setSelectedV8ShiftIds([]);
                        }}
                        inline={true}
                    />
                ) : undefined}
                functionBarChildren={
                    <>
                        <button
                            type="button"
                            onClick={() => {
                                setIsBulkModeActive(prev => {
                                    const next = !prev;
                                    if (!next) setSelectedV8ShiftIds([]);
                                    return next;
                                });
                            }}
                            aria-pressed={isBulkModeActive}
                            aria-label="Bulk Mode"
                            className={cn(toolbar.secondaryAction, isBulkModeActive && toolbar.secondaryActionOn)}
                        >
                            <ListChecks className="h-4 w-4" aria-hidden="true" />
                            <span className="hidden md:inline">Bulk Mode</span>
                        </button>

                        <Popover open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
                            <PopoverTrigger asChild>
                                <ToolbarIconButton
                                    icon={<Settings2 />}
                                    tooltip="Bidding settings"
                                    aria-pressed={undefined}
                                    isActive={isSettingsOpen}
                                />
                            </PopoverTrigger>
                            <PopoverContent 
                                className={cn(
                                    "rounded-2xl border border-slate-200 dark:border-white/10 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3)] p-4 w-72 z-50 animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-300",
                                    isDark ? "bg-[#1a2333] text-white" : "bg-white text-slate-900"
                                )}
                                sideOffset={10}
                                align="end"
                            >
                                <h4 className="font-black uppercase tracking-widest text-[11px] text-muted-foreground/80 mb-3 select-none">Bidding Settings</h4>
                                <div className="space-y-3">
                                    <label className="flex items-start gap-3 cursor-pointer group select-none p-2 rounded-xl hover:bg-primary/5 transition-colors">
                                        <div className={cn(
                                            "w-5 h-5 rounded-md border flex items-center justify-center transition-all shrink-0 mt-0.5",
                                            showIneligible
                                                ? "bg-primary border-primary text-primary-foreground"
                                                : "border-muted-foreground/30 group-hover:border-primary/40"
                                        )}>
                                            {showIneligible && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={showIneligible}
                                            onChange={(e) => setShowIneligible(e.target.checked)}
                                            className="sr-only"
                                        />
                                        <div className="flex flex-col">
                                            <span className="text-[11px] font-black uppercase tracking-wider group-hover:text-primary transition-colors">Show Ineligible</span>
                                            <span className="text-[11px] text-muted-foreground/60 leading-tight">Display shifts for which qualification is missing</span>
                                        </div>
                                    </label>
                                    <label className="flex items-start gap-3 cursor-pointer group select-none p-2 rounded-xl hover:bg-primary/5 transition-colors">
                                        <div className={cn(
                                            "w-5 h-5 rounded-md border flex items-center justify-center transition-all shrink-0 mt-0.5",
                                            showExpired
                                                ? "bg-primary border-primary text-primary-foreground"
                                                : "border-muted-foreground/30 group-hover:border-primary/40"
                                        )}>
                                            {showExpired && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={showExpired}
                                            onChange={(e) => setShowExpired(e.target.checked)}
                                            className="sr-only"
                                        />
                                        <div className="flex flex-col">
                                            <span className="text-[11px] font-black uppercase tracking-wider group-hover:text-primary transition-colors">Show Expired</span>
                                            <span className="text-[11px] text-muted-foreground/60 leading-tight">Display closed or expired shift opportunities</span>
                                        </div>
                                    </label>
                                </div>
                            </PopoverContent>
                        </Popover>
                    </>
                }
                leftContent={
                    <div className="flex items-center gap-1.5 lg:gap-2">
                        <Calendar className="h-3.5 w-3.5 lg:h-4 lg:w-4 text-primary" />
                        <span className="text-[11px] lg:text-[13px] font-black text-foreground tracking-tight whitespace-nowrap uppercase">
                            <span className="hidden sm:inline">Open Shifts</span>
                            <span className="sm:hidden">Shifts</span>
                        </span>
                        <span className="inline-flex items-center justify-center h-4 lg:h-5 min-w-[16px] lg:min-w-[20px] px-1 lg:px-1.5 rounded-full bg-primary/10 text-primary text-[11px] lg:text-[11px] font-black tabular-nums">
                            {filteredBidOpportunities.length}
                        </span>
                    </div>
                }
                filters={viewMode === 'table' || isMobile ? (
                    // The shared Group By control, with this page's own grouping keys.
                    <GroupBySelector<BidGroupBy>
                        value={groupBy}
                        onChange={setGroupBy}
                        options={BID_GROUP_BY_OPTIONS}
                        triggerVariant="icon"
                    />
                ) : undefined}
            />

            {/* ── ROW 3: CONTENT AREA ───────────────────────────────────────── */}
            <div className="flex-1 min-h-0 overflow-hidden">
                <div className={cn(
                    "h-full overflow-hidden flex flex-col",
                    surface.bodyCard
                )}>
                {isScopeLoading || (eligibilityPending && rawAvailableShifts.length > 0) ? (
                    <PageState state="loading" className="flex-1" title="Checking eligibility" description="Matching open shifts against your compliance rules." />
                ) : viewMode === 'card' ? (
                <div className={cn(
                    "flex-1 overflow-y-auto p-4 lg:p-6 scrollbar-none",
                    filteredBidOpportunities.length === 0 && "flex flex-col items-center justify-center p-0"
                )}>
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={`${startDate.toISOString()}-${endDate.toISOString()}`}
                            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 w-full h-full"
                            variants={pageVariants}
                            initial="hidden"
                            animate="show"
                            exit={{ opacity: 0, transition: { duration: 0.15 } }}
                        >
                        {filteredBidOpportunities.map(opp => renderOpportunityCard(opp))}
                        {filteredBidOpportunities.length === 0 && (
                            <motion.div variants={itemVariants} className="col-span-full w-full h-full flex items-center justify-center">
                                <PageState state="empty" icon={Calendar} title="No shifts match your filters" description="Try expanding your date range or clearing priority filters." />
                            </motion.div>
                        )}
                        </motion.div>
                    </AnimatePresence>
                </div>
                ) : (
                    <div className={cn(
                        "flex-1 overflow-y-auto p-4 lg:p-6 scrollbar-none",
                        filteredBidOpportunities.length === 0 && "md:block flex flex-col items-center justify-center p-0 md:p-6"
                    )}>
                        {/* Mobile: vertical list rows, tap → bottom drawer. Group-by chips live in header. */}
                        <div className={cn("md:hidden w-full", filteredBidOpportunities.length === 0 && "h-full")}>
                            <AnimatePresence mode="wait">
                                <motion.div
                                    key={`list-${groupBy}-${startDate.toISOString()}-${endDate.toISOString()}`}
                                    className={cn(
                                        "border border-border/40 rounded-xl overflow-hidden bg-background/40",
                                        filteredBidOpportunities.length === 0 && "h-full flex flex-col items-center justify-center w-full"
                                    )}
                                    variants={pageVariants}
                                    initial="hidden"
                                    animate="show"
                                    exit={{ opacity: 0, transition: { duration: 0.12 } }}
                                >
                                    {filteredBidOpportunities.length === 0 ? (
                                        <PageState state="empty" icon={Calendar} title="No shifts match your filters" />
                                    ) : groupBy === 'none' ? (
                                        filteredBidOpportunities.map(renderBidListItem)
                                    ) : (
                                        groupOpportunities(filteredBidOpportunities, groupBy).map(g => (
                                            <BidOpportunityListSection
                                                key={g.key}
                                                label={g.label}
                                                count={g.items.length}
                                                accent={g.accent}
                                            >
                                                {g.items.map(renderBidListItem)}
                                            </BidOpportunityListSection>
                                        ))
                                    )}
                                </motion.div>
                            </AnimatePresence>
                        </div>

                        {/* Desktop: traditional sortable table */}
                        <div className="hidden md:block overflow-x-auto border border-border rounded-lg">
                            <Table className="text-foreground">
                                <TableHeader>
                                    <TableRow>
                                        {isBulkModeActive && (
                                            <TableHead className="w-[40px]">
                                                <input
                                                    type="checkbox"
                                                    checked={
                                                        filteredBidOpportunities.length > 0 &&
                                                        filteredBidOpportunities.every(o => selectedV8ShiftIds.includes(o.id))
                                                    }
                                                    onChange={(e) => handleSelectAll(e.target.checked)}
                                                    className="h-4 w-4 rounded border-border/50 accent-primary cursor-pointer"
                                                />
                                            </TableHead>
                                        )}
                                        <SortableTableHeader sortKey="department" currentSort={shiftsTableSort.sortConfig} onSort={shiftsTableSort.handleSort}>Department</SortableTableHeader>
                                        <SortableTableHeader sortKey="subDepartment" currentSort={shiftsTableSort.sortConfig} onSort={shiftsTableSort.handleSort}>SubDepartment</SortableTableHeader>
                                        <SortableTableHeader sortKey="group" currentSort={shiftsTableSort.sortConfig} onSort={shiftsTableSort.handleSort}>Group</SortableTableHeader>
                                        <SortableTableHeader sortKey="subGroupName" currentSort={shiftsTableSort.sortConfig} onSort={shiftsTableSort.handleSort}>SubGroup</SortableTableHeader>
                                        <SortableTableHeader sortKey="role" currentSort={shiftsTableSort.sortConfig} onSort={shiftsTableSort.handleSort}>Role</SortableTableHeader>
                                        <SortableTableHeader sortKey="date" currentSort={shiftsTableSort.sortConfig} onSort={shiftsTableSort.handleSort}>Date</SortableTableHeader>
                                        <SortableTableHeader sortKey="startAt" currentSort={shiftsTableSort.sortConfig} onSort={shiftsTableSort.handleSort}>Time</SortableTableHeader>
                                        <SortableTableHeader sortKey="netLength" currentSort={shiftsTableSort.sortConfig} onSort={shiftsTableSort.handleSort}>Net</SortableTableHeader>
                                        <TableHead className="w-[120px]">Expires in</TableHead>
                                        <TableHead className="w-[200px]">Action</TableHead>
                                    </TableRow>
                                </TableHeader>
                                {(groupBy === 'none'
                                    ? [{ key: '__all__', label: '', items: filteredBidOpportunities, accent: undefined } as const]
                                    : groupOpportunities(filteredBidOpportunities, groupBy)
                                ).map(g => (
                                  <TableBody key={g.key}>
                                    {groupBy !== 'none' && (
                                        <tr>
                                            <td colSpan={isBulkModeActive ? 11 : 10} className={tableTokens.band}>
                                                <div className="flex items-center gap-2">
                                                    {g.accent && <span className={cn('h-2 w-2 rounded-full', g.accent.dot)} />}
                                                    <span className="text-foreground/80">{g.label}</span>
                                                    <span className="tabular-nums">{g.items.length}</span>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                    {g.items.map(opp => {
                                        const { participationStatus, currentBid } = opp;
                                        const shiftStart = opp.startAt
                                            ? new Date(opp.startAt)
                                            : parseZonedDateTime(opp.date, opp.startTime, SYDNEY_TZ);
                                        const biddingCloses = new Date(shiftStart.getTime() - 4 * 60 * 60 * 1000);
                                        const isExpired = new Date() >= biddingCloses;
                                        const canSelect = (participationStatus === 'not_participated' && opp.isEligible) ||
                                                          (participationStatus === 'pending' && !!currentBid);

                                        return (
                                            <TableRow 
                                                key={opp.id} 
                                                className={cn(
                                                    "cursor-pointer",
                                                    getRowClass(opp.groupType, opp.group || opp.department)
                                                )}
                                                onClick={() => {
                                                    if (isBulkModeActive) {
                                                        if (canSelect) {
                                                            handleSelectShift(opp.id);
                                                        }
                                                    }
                                                }}
                                            >
                                                {isBulkModeActive && (
                                                    <TableCell onClick={e => e.stopPropagation()}>
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedV8ShiftIds.includes(opp.id)}
                                                            onChange={() => handleSelectShift(opp.id)}
                                                            disabled={!canSelect}
                                                            className="h-4 w-4 rounded border-border/50 accent-primary cursor-pointer"
                                                        />
                                                    </TableCell>
                                                )}
                                                <TableCell className="font-medium">{opp.department}</TableCell>
                                                <TableCell className="text-muted-foreground/80">{opp.subDepartment}</TableCell>
                                                <TableCell className="font-medium text-foreground/80">{opp.group}</TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-2">
                                                        <div className={cn("w-1.5 h-1.5 rounded-full", opp.subGroupColor || 'bg-slate-400')} />
                                                        {opp.subGroupName}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="font-bold text-primary">{opp.role}</TableCell>
                                                <TableCell>{format(parseISO(opp.date), 'EEE d MMM')}</TableCell>
                                                <TableCell className="tabular-nums font-mono">{opp.startTime}–{opp.endTime}</TableCell>
                                                <TableCell className="font-mono text-muted-foreground">
                                                    {(() => {
                                                        const h = Math.floor(opp.netLength / 60);
                                                        const m = Math.round(opp.netLength % 60);
                                                        return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
                                                    })()}
                                                </TableCell>
                                                <TableCell className="font-mono tabular-nums">
                                                    {(() => {
                                                        const tr = calculateTimeRemaining(biddingCloses.toISOString());
                                                        if (tr.isExpired) return <span className="text-muted-foreground/50 italic">Closed</span>;
                                                        const totalMs = biddingCloses.getTime() - Date.now();
                                                        const urgent = totalMs < 4 * 60 * 60 * 1000;
                                                        return (
                                                            <span className={cn(urgent ? 'text-amber-500 font-bold' : 'text-foreground/70')}>
                                                                {formatTimeRemaining(tr)}
                                                            </span>
                                                        );
                                                    })()}
                                                </TableCell>
                                                <TableCell>
                                                    {participationStatus === 'dropped' && (
                                                        <span className="text-[11px] text-rose-500 flex items-center gap-1 font-bold"><XCircle size={12} /> Dropped</span>
                                                    )}
                                                    {participationStatus === 'rejected_offer' && (
                                                        <span className="text-[11px] text-rose-500 flex items-center gap-1 font-bold"><XCircle size={12} /> Rejected</span>
                                                    )}
                                                    {participationStatus === 'not_participated' && !isExpired && (
                                                        opp.isEligible ? (
                                                            <Button
                                                                size="sm"
                                                                className="h-8 text-[11px] font-black uppercase tracking-wider bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
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
                                                            <TooltipProvider>
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <span className="text-[11px] text-rose-500 flex items-center gap-1 font-medium opacity-60 cursor-help"><Ban size={12} /> Ineligible</span>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent side="top" className="max-w-[220px] text-[11px] font-black uppercase tracking-wider p-2.5 rounded-xl border border-border/45 shadow-xl bg-background text-foreground z-50">
                                                                        {opp.ineligibilityReason ?? 'You are not eligible for this shift'}
                                                                    </TooltipContent>
                                                                </Tooltip>
                                                            </TooltipProvider>
                                                        )
                                                    )}
                                                    {participationStatus === 'not_participated' && isExpired && (
                                                        <span className="text-[11px] text-slate-400 flex items-center gap-1 font-medium italic"><Ban size={12} /> Closed</span>
                                                    )}
                                                    {participationStatus === 'pending' && (
                                                        <div className="flex gap-2 items-center">
                                                            <span className="text-[11px] text-amber-500 flex items-center gap-1 font-bold"><Clock size={12} /> Pending</span>
                                                            {!isExpired && currentBid && (
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="h-7 text-[11px] font-black uppercase tracking-widest border-border/40 hover:bg-red-500/10 hover:text-red-400"
                                                                    onClick={() => handleWithdrawBid(currentBid.id)}
                                                                    disabled={withdrawBidMutation.isPending}
                                                                >
                                                                    Withdraw
                                                                </Button>
                                                            )}
                                                        </div>
                                                    )}
                                                    {participationStatus === 'selected' && (
                                                        <span className="text-[11px] text-emerald-400 flex items-center gap-1 font-bold"><CheckCircle size={12} /> Selected</span>
                                                    )}
                                                    {participationStatus === 'rejected' && (
                                                        <span className="text-[11px] text-slate-400 flex items-center gap-1 font-medium"><Ban size={12} /> Not Selected</span>
                                                    )}
                                                    {participationStatus === 'expired' && (
                                                        <span className="text-[11px] text-slate-400 flex items-center gap-1 font-medium"><Ban size={12} /> Expired</span>
                                                    )}
                                                    {participationStatus === 'auto_rejected' && (
                                                        <span className="text-[11px] text-rose-500 flex items-center gap-1 font-bold"><Ban size={12} /> Auto-Rejected</span>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                  </TableBody>
                                ))}
                                {filteredBidOpportunities.length === 0 && (
                                    <TableBody>
                                        <TableRow>
                                            <TableCell colSpan={isBulkModeActive ? 11 : 10} className="text-center text-muted-foreground/60 italic">
                                                No matching shifts found.
                                            </TableCell>
                                        </TableRow>
                                    </TableBody>
                                )}
                            </Table>
                        </div>
                    </div>
                )}
                </div>
            </div>



            {/* ── COMPLIANCE WARNING DIALOG ── */}
            <BidConfirmComplianceDialog
                open={showComplianceDialog}
                onOpenChange={setShowComplianceDialog}
                result={complianceResult}
                availabilityWarning={availabilityWarning}
                onCancel={handleCancelBid}
                onConfirm={handleConfirmBidWithWarning}
            />

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
            <BidOpportunityDrawer
                opp={drawerOpp}
                onClose={() => setDrawerOpp(null)}
                onQuickBid={handleQuickBid}
                onWithdraw={handleWithdrawBid}
                rawShift={drawerOpp ? rawAvailableShifts.find(s => s.id === drawerOpp.id) : null}
                isPlacingBid={placeBidMutation.isPending}
                placingBidId={placeBidMutation.variables}
                isWithdrawing={withdrawBidMutation.isPending}
            />
        </PageLayout>
    );
};

export default EmployeeBidsPage;
