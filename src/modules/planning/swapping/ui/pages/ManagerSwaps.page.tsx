import React, { useState, useEffect, useMemo } from 'react';
import { useIsMobile } from '@/modules/core/hooks/use-mobile';
import { Check, X, ChevronRight, ArrowLeftRight, Clock, CheckCircle, XCircle, Calendar, AlertTriangle, Shield, Gavel, RefreshCw, ShieldCheck, ShieldAlert, ShieldX, ScanSearch, Megaphone, UserCheck as LucideUserCheck, Circle, Minus } from 'lucide-react';
import { ManagerComplianceApprovalModal } from '../components/ManagerComplianceApprovalModal';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Checkbox } from '@/modules/core/ui/primitives/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from '@/modules/core/ui/primitives/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/modules/core/ui/primitives/tooltip';
import { useToast } from '@/modules/core/hooks/use-toast';
import { format, differenceInHours, parseISO, parse } from 'date-fns';
import { cn } from '@/modules/core/lib/utils';
import { useAuth } from '@/platform/auth/useAuth';
import { swapsApi } from '../../api/swaps.api';
import { motion, AnimatePresence } from 'framer-motion';

import { SwapRequestWithDetails, SwapStatus } from '../../model/swap.types';
import { SwapPriority, PRIORITY_CONFIG } from './EmployeeSwaps.page';
import { computeShiftUrgency } from '@/modules/rosters/domain/bidding-urgency';
import { useOrgSelection } from '@/modules/core/contexts/OrgSelectionContext';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { SharedShiftCard } from '../../../../planning/ui/components/SharedShiftCard';
import { PersonalPageHeader } from '@/modules/core/ui/components/PersonalPageHeader';
import { useTheme } from '@/modules/core/contexts/ThemeContext';

/* ============================================================
   DESIGN TOKENS (Deprecated hex scales, using theme-aware variables)
   ============================================================ */

/* ============================================================
   HELPERS
   ============================================================ */

const formatTime = (time: string): string => {
    if (!time) return '';
    const [h, m] = time.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const display = h % 12 || 12;
    return `${display}:${m?.toString().padStart(2, '0') || '00'} ${period}`;
};

const getInitials = (name: string): string => {
    const parts = name.trim().split(' ');
    if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    return name.slice(0, 2).toUpperCase();
};

// Redesigned: Metropolis Glass dynamic classes with deep venue mapping
function getDeptGlassClass(data?: {
    deptName?: string;
    orgName?: string;
    groupType?: string;
    organizationId?: string;
    subDepartmentId?: string;
}): string {
    const d = (data?.deptName || '').toLowerCase();
    const o = (data?.orgName || '').toLowerCase();
    const g = (data?.groupType || '').toLowerCase();
    const sid = data?.subDepartmentId || '';

    // Blue: Convention Centre (Sub-departments: Event Setups, operations, etc. under ED or explicit)
    // Common pattern for Convention: "Event Sales", "Convention Sales", "Floor Management"
    if (d.includes('convention') || o.includes('convention') || o.includes('icc') ||
        g.includes('convention') || sid.startsWith('00000000-0000-0003-01')) return 'dept-card-glass-convention';

    // Green: Exhibition Centre
    if (d.includes('exhibition') || o.includes('exhibition') || g.includes('exhibition') ||
        sid.startsWith('00000000-0000-0003-0502')) return 'dept-card-glass-exhibition';

    // Red: Theatre
    if (d.includes('theatre') || o.includes('theatre') || g.includes('theatre') ||
        sid.startsWith('00000000-0000-0003-0503')) return 'dept-card-glass-theatre';

    return 'dept-card-glass-default';
}




function getDeptAccent(dept?: string | null): string {
    const d = (dept || '').toLowerCase();
    if (d.includes('convention')) return 'text-blue-600 dark:text-blue-400';
    if (d.includes('exhibition')) return 'text-emerald-600 dark:text-emerald-400';
    if (d.includes('theatre')) return 'text-rose-600 dark:text-rose-400';
    return 'text-muted-foreground';
}


function getDeptGlow(dept?: string | null): string {
    const d = (dept || '').toLowerCase();
    if (d.includes('convention')) return 'shadow-blue-500/10';
    if (d.includes('exhibition')) return 'shadow-emerald-500/10';
    if (d.includes('theatre')) return 'shadow-rose-500/10';
    return 'shadow-white/5';
}

/* ============================================================
   STATUS TABS
   ============================================================ */

const STATUS_TABS = [
    { id: 'MANAGER_PENDING', label: 'Pending', icon: Clock, accent: 'amber' },
    { id: 'OPEN', label: 'Open', icon: ArrowLeftRight, accent: 'blue' },
    { id: 'APPROVED', label: 'Approved', icon: CheckCircle, accent: 'emerald' },
    { id: 'REJECTED', label: 'Rejected', icon: XCircle, accent: 'red' },
    { id: 'all', label: 'All', icon: Shield, accent: 'slate' },
] as const;

const accentMap: Record<string, { bg: string; text: string; ring: string; glow: string }> = {
    amber: { bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400', ring: 'ring-amber-500/20', glow: 'shadow-amber-500/10' },
    blue: { bg: 'bg-blue-500/10', text: 'text-blue-600 dark:text-blue-400', ring: 'ring-blue-500/20', glow: 'shadow-blue-500/10' },
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', ring: 'ring-emerald-500/20', glow: 'shadow-emerald-500/10' },
    red: { bg: 'bg-red-500/10', text: 'text-rose-600 dark:text-rose-400', ring: 'ring-rose-500/20', glow: 'shadow-rose-500/10' },
    slate: { bg: 'bg-muted/50', text: 'text-muted-foreground', ring: 'ring-border', glow: 'shadow-sm' },
};

/* ============================================================
   EMPLOYEE SHIFT PANE (within card)
   ============================================================ */

const ShiftPane: React.FC<{ data: any; label: string }> = ({ data, label }) => {
    if (!data) {
        return (
            <div className="flex-1 min-w-0 md:min-w-[200px] rounded-2xl border border-dashed border-border/60 p-5 flex flex-col items-center justify-center gap-2 bg-muted/5 backdrop-blur-sm">
                <div className="h-10 w-10 rounded-full bg-muted/20 flex items-center justify-center">
                    <ArrowLeftRight className="h-4 w-4 text-muted-foreground/30" />
                </div>
                <span className="text-[10px] font-mono font-black uppercase tracking-[0.2em] text-muted-foreground/40">Open Market</span>
            </div>
        );
    }

    const isRequester = label === 'REQUESTER';
    const deptClass = getDeptGlassClass({
        deptName: data.deptName,
        orgName: data.orgName,
        groupType: data.groupType,
        organizationId: data.organizationId,
        subDepartmentId: data.subDepartmentId
    });




    return (
        <div className={cn(
            "flex-1 min-w-0 md:min-w-[240px] w-full p-4 md:p-6 rounded-xl md:rounded-[2rem] border transition-all duration-500 relative overflow-hidden group/pane dept-card-glass-base",
            deptClass
        )}>
            {/* Glass Background Highlight */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/[0.05] blur-3xl rounded-full pointer-events-none" />

            {/* Label */}
            <div className="flex items-center justify-between mb-5 relative z-10">
                <div className="flex items-center gap-2">
                    <div className={cn(
                        "h-1.5 w-6 rounded-full",
                        isRequester ? "bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]" : "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                    )} />
                    <span className={cn(
                        "text-[9px] font-black uppercase tracking-[0.25em]",
                        isRequester ? "text-indigo-600 dark:text-indigo-400" : "text-emerald-600 dark:text-emerald-400"
                    )}>
                        {label}
                    </span>
                </div>
                <Badge variant="outline" className="text-[8px] font-black uppercase tracking-widest bg-background/40 backdrop-blur-md border-border/50">
                    {data.deptName || 'General'}
                </Badge>
            </div>

            {/* Employee Row */}
            <div className="flex items-center gap-3 mb-6 relative z-10">
                <Avatar className="h-10 w-10 ring-2 ring-background shadow-xl">
                    <AvatarImage src={data.avatar} />
                    <AvatarFallback className={cn(
                        "text-[10px] font-black",
                        isRequester
                            ? "bg-indigo-600 text-white"
                            : "bg-emerald-600 text-white"
                    )}>
                        {getInitials(data.employeeName || '?')}
                    </AvatarFallback>
                </Avatar>
                <div>
                    <div className="text-[14px] font-black text-foreground leading-tight tracking-tight">{data.employeeName}</div>
                    <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider opacity-60 italic">{data.roleName}</div>
                </div>
            </div>

            {/* Shift Details (Redesigned Table-like Grid) */}
            <div className="relative z-10 px-1">
                <SharedShiftCard
                    variant="nested"
                    organization={data.orgName || 'ICC Sydney'}
                    department={data.deptName || 'Department'}
                    subGroup={data.subGroupName}
                    role={data.roleName || 'Shift'}
                    shiftDate={data.formattedDate || 'N/A'}
                    startTime={data.time?.split(' - ')[0] || '00:00'}
                    endTime={data.time?.split(' - ')[1] || '00:00'}
                    netLength={data.durationNum * 60}
                    paidBreak={0}
                    unpaidBreak={0}
                    groupVariant={
                        deptClass.includes('convention') ? 'convention' :
                        deptClass.includes('exhibition') ? 'exhibition' :
                        deptClass.includes('theatre') ? 'theatre' : 'default'
                    }
                    complianceLabel="Compliant"

                />
            </div>
        </div>
    );
};


/* ============================================================
   SWAP ARROW (center divider)
   ============================================================ */

type ComplianceStatus = 'PASS' | 'WARNING' | 'BLOCKING' | null;

const COMPLIANCE_STYLES: Record<'PASS' | 'WARNING' | 'BLOCKING', {
    ring: string; icon: React.ReactNode; label: string;
}> = {
    PASS:     { ring: 'bg-emerald-500/10 border-emerald-500/20', icon: <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />, label: 'Compliance Passed' },
    WARNING:  { ring: 'bg-amber-500/10 border-amber-500/20',   icon: <ShieldAlert  className="h-3.5 w-3.5 text-amber-500"  />, label: 'Compliance Warnings' },
    BLOCKING: { ring: 'bg-rose-500/10 border-rose-500/20',     icon: <ShieldX      className="h-3.5 w-3.5 text-rose-500"   />, label: 'Compliance Blocked' },
};

const SwapDivider: React.FC<{ hoursDiff: number; payDiff: number; compliance: ComplianceStatus }> = ({ hoursDiff, payDiff, compliance }) => {
    const hoursColor = hoursDiff > 0 ? 'text-emerald-600 dark:text-emerald-400' : hoursDiff < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground/30';
    const payColor = payDiff > 0 ? 'text-emerald-600 dark:text-emerald-400' : payDiff < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground/30';
    const cStyle = compliance ? COMPLIANCE_STYLES[compliance] : null;

    return (
        <div className="flex sm:flex-col items-center justify-center px-4 py-6 gap-3 flex-shrink-0 relative">
            <div className="h-px w-8 sm:h-8 sm:w-px bg-border/50 absolute top-0 left-1/2 -translate-x-1/2 hidden sm:block" />
            <div className="h-px w-8 sm:h-8 sm:w-px bg-border/50 absolute bottom-0 left-1/2 -translate-x-1/2 hidden sm:block" />

            <div className="h-12 w-12 rounded-full bg-background border border-border flex items-center justify-center shadow-xl relative z-10 transition-transform group-hover:scale-110">
                <ArrowLeftRight className="h-5 w-5 text-primary" />
            </div>

            <div className="flex flex-col items-center gap-1.5 min-w-[60px]">
                <Badge variant="secondary" className={cn("text-[10px] font-black font-mono shadow-none px-2", hoursColor)}>
                    {hoursDiff > 0 ? '+' : ''}{hoursDiff.toFixed(1)}h
                </Badge>
                {payDiff !== 0 && (
                    <span className={cn("text-[9px] font-mono font-black opacity-60", payColor)}>
                        {payDiff > 0 ? '+' : ''}${payDiff.toFixed(0)}
                    </span>
                )}
                {cStyle && (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger className="mt-1">
                                <div className={cn("h-6 w-6 rounded-full flex items-center justify-center border", cStyle.ring)}>
                                    {cStyle.icon}
                                </div>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="bg-popover text-popover-foreground border-border shadow-xl">
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-[10px] font-black uppercase tracking-wider">{cStyle.label}</span>
                                    <span className="text-[9px] font-mono text-muted-foreground opacity-60">Engine v2</span>
                                </div>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )}
            </div>
        </div>
    );
};


/* ============================================================
   UI TYPES & MAPPER
   ============================================================ */

interface SwapRequestManagement {
    id: string;
    requestor: {
        employeeName: string;
        roleName: string;
        date: string;
        formattedDate: string;
        time: string;
        duration: string;
        durationNum: number;
        hourlyRate: number;
        avatar?: string;
        deptName?: string;
        orgName?: string;
        groupType?: string;
        organizationId?: string;
        subDepartmentId?: string;
        lifecycleStatus?: string;
        stateId?: string;
    };




    recipient: {
        employeeName: string;
        roleName: string;
        date: string;
        formattedDate: string;
        time: string;
        duration: string;
        durationNum: number;
        hourlyRate: number;
        avatar?: string;
        deptName?: string;
        orgName?: string;
        groupType?: string;
        organizationId?: string;
        subDepartmentId?: string;
        lifecycleStatus?: string;
        stateId?: string;
    } | null;




    status: SwapStatus;
    reason: string;
    requestedAt: string;
    tags: string[];
    hoursDiff: number;
    payDiff: number;
    complianceStatus: ComplianceStatus;
    priority?: SwapPriority;
    shiftStateId: string;
    combinedStateId: string;
    deptName: string;
    // Raw IDs needed for manager compliance re-check
    requesterEmployeeId: string;
    offererEmployeeId: string | null;
    requesterShiftId: string;
    offererShiftId: string | null;
}

/** Compute duration hours from camelCase timing strings */
const computeShiftHours = (s: { startTime: string; endTime: string; unpaidBreakMinutes?: number }): number => {
    try {
        const [sh, sm] = s.startTime.slice(0, 5).split(':').map(Number);
        const [eh, em] = s.endTime.slice(0, 5).split(':').map(Number);
        let mins = (eh * 60 + em) - (sh * 60 + sm);
        if (mins < 0) mins += 1440;
        return Math.max(0, mins - (s.unpaidBreakMinutes || 0)) / 60;
    } catch { return 0; }
};

const mapToUIModel = (apiData: SwapRequestWithDetails): SwapRequestManagement => {
    const getShiftValue = (shift?: any) => {
        const rate = shift?.remuneration_levels?.hourly_rate_min || 0;
        const netLength = shift?.netLength || 0;
        const durationHours = netLength / 60;
        return { rate, durationHours, value: rate * durationHours };
    };

    const reqVal = getShiftValue(apiData.originalShift);
    const recVal = getShiftValue(apiData.requestedShift);

    const activeOffer = apiData.swap_offers?.find(o =>
        (o.offered_shift_id === apiData.offered_shift_id) ||
        (o.status === 'SELECTED')
    ) ?? apiData.swap_offers?.find(o => o.status !== 'rejected' && o.status !== 'withdrawn');

    const snap = activeOffer?.compliance_snapshot;
    let complianceStatus: ComplianceStatus = null;
    if (snap !== null && snap !== undefined) {
        if (snap.status === 'PASS' || snap.status === 'WARNING' || snap.status === 'BLOCKING') {
            complianceStatus = snap.status as ComplianceStatus;
        } else if (snap.passed === true) {
            complianceStatus = (snap.warnings_count ?? 0) > 0 ? 'WARNING' : 'PASS';
        } else if (snap.passed === false) {
            complianceStatus = 'BLOCKING';
        }
    }

    // Duration / pay delta — use offered_shift when requestedShift absent
    const offerDurationHours = activeOffer?.offered_shift ? computeShiftHours(activeOffer.offered_shift) : 0;
    const hoursDiff = apiData.requestedShift
        ? (recVal.durationHours - reqVal.durationHours)
        : activeOffer?.offered_shift
            ? (offerDurationHours - reqVal.durationHours)
            : -reqVal.durationHours;
    const payDiff = apiData.requestedShift ? (recVal.value - reqVal.value) : -reqVal.value;

    // Auto-compute priority from shift date/time (shared TTS utility)
    const priority: SwapPriority = computeShiftUrgency(
        apiData.originalShift?.shiftDate ?? '',
        apiData.originalShift?.startTime ?? '',
    );

    // Build recipient — fall back to activeOffer.offered_shift for open-market swaps
    let recipient: SwapRequestManagement['recipient'] = null;
    if (apiData.requestedShift || apiData.targetEmployee) {
        recipient = {
            employeeName: apiData.targetEmployee?.fullName || (apiData.requestedShift ? 'Open Swap' : 'Unknown'),
            roleName: apiData.requestedShift?.roles?.name || 'Any Role',
            date: apiData.requestedShift?.shiftDate || '',
            formattedDate: apiData.requestedShift?.shiftDate ? format(parse(apiData.requestedShift.shiftDate, 'yyyy-MM-dd', new Date()), 'EEE, MMM d') : '',
            time: apiData.requestedShift ? `${apiData.requestedShift.startTime} - ${apiData.requestedShift.endTime}` : 'No Shift',
            duration: recVal.durationHours > 0 ? `${recVal.durationHours.toFixed(1)}h` : '0h',
            durationNum: recVal.durationHours,
            hourlyRate: recVal.rate,
            avatar: apiData.targetEmployee?.avatarUrl,
            deptName: apiData.requestedShift?.departments?.name || 'General',
            orgName: apiData.requestedShift?.organizations?.name || '',
            groupType: apiData.requestedShift?.group_type || '',
            organizationId: apiData.requestedShift?.organizationId,
            subDepartmentId: apiData.requestedShift?.subDepartmentId,
            lifecycleStatus: apiData.requestedShift?.lifecycleStatus || 'Published',
            stateId: apiData.requestedShift?.stateId || 'S?',
        };
    } else if (activeOffer?.offered_shift) {
        // Open-market swap where an offer was accepted
        const os = activeOffer.offered_shift;
        const offererName = activeOffer.offerer
            ? `${activeOffer.offerer.first_name} ${activeOffer.offerer.last_name}`.trim()
            : 'Offerer';
        recipient = {
            employeeName: offererName,
            roleName: os.roles?.name || 'Unknown Role',
            date: os.shiftDate,
            formattedDate: os.shiftDate ? format(parse(os.shiftDate, 'yyyy-MM-dd', new Date()), 'EEE, MMM d') : '',
            time: `${os.startTime} - ${os.endTime}`,
            duration: `${offerDurationHours.toFixed(1)}h`,
            durationNum: offerDurationHours,
            hourlyRate: 0,
            avatar: activeOffer.offerer?.avatar_url,
            deptName: os.departments?.name || 'General',
            lifecycleStatus: os.lifecycleStatus || 'Published',
            stateId: os.stateId || 'S?',
        };
    }

    return {
        id: apiData.id,
        requestor: {
            employeeName: apiData.requestorEmployee?.fullName || 'Unknown',
            roleName: apiData.originalShift?.roles?.name || 'Unknown Role',
            date: apiData.originalShift?.shiftDate || '',
            formattedDate: apiData.originalShift?.shiftDate ? format(parse(apiData.originalShift.shiftDate, 'yyyy-MM-dd', new Date()), 'EEE, MMM d') : '',
            time: `${apiData.originalShift?.startTime} - ${apiData.originalShift?.endTime}`,
            duration: `${reqVal.durationHours.toFixed(1)}h`,
            durationNum: reqVal.durationHours,
            hourlyRate: reqVal.rate,
            avatar: apiData.requestorEmployee?.avatarUrl,
            deptName: apiData.originalShift?.departments?.name || 'General',
            orgName: apiData.originalShift?.organizations?.name || '',
            groupType: apiData.originalShift?.group_type || '',
            organizationId: apiData.originalShift?.organizationId,
            subDepartmentId: apiData.originalShift?.subDepartmentId,
            lifecycleStatus: apiData.originalShift?.lifecycleStatus || 'Published',
            stateId: apiData.originalShift?.stateId || 'S?',
        },
        recipient,
        status: apiData.status as any,
        reason: apiData.reason || '',
        requestedAt: apiData.created_at,
        tags: [apiData.originalShift?.departments?.name || 'General'],
        hoursDiff,
        payDiff,
        complianceStatus,
        priority,
        deptName: apiData.originalShift?.departments?.name || 'General',
        ...deriveStateIds(apiData.status),
        requesterEmployeeId: apiData.requested_by_employee_id,
        offererEmployeeId: apiData.swap_with_employee_id || activeOffer?.offerer_id || null,
        requesterShiftId: apiData.original_shift_id,
        offererShiftId: apiData.offered_shift_id || activeOffer?.offered_shift_id || null,
    };
};


const deriveStateIds = (status: string): { shiftStateId: string; combinedStateId: string } => {
    switch (status) {
        case 'OPEN': return { shiftStateId: 'S9', combinedStateId: 'C2' };
        case 'MANAGER_PENDING': return { shiftStateId: 'S10', combinedStateId: 'C3' };
        case 'APPROVED': return { shiftStateId: 'S4', combinedStateId: 'C4' };
        case 'REJECTED': return { shiftStateId: 'S4', combinedStateId: 'C5' };
        case 'CANCELLED': return { shiftStateId: 'S4', combinedStateId: 'C6' };
        case 'EXPIRED': return { shiftStateId: 'S4', combinedStateId: 'C7' };
        default: return { shiftStateId: '??', combinedStateId: '??' };
    }
};

/* ============================================================
   MAIN COMPONENT
   ============================================================ */

export const ManagerSwapsPage: React.FC = () => {
    const { toast } = useToast();
    const { activeContract } = useAuth();
    const isMobile = useIsMobile();
    const orgSelection = useOrgSelection();
    const { scope, setScope, scopeKey, isGammaLocked } = useScopeFilter('managerial');
    const { isDark } = useTheme();

    const currentOrgId = scope.org_ids[0] || orgSelection.organizationId;
    const currentDeptId = scope.dept_ids.length === 1 ? scope.dept_ids[0] : undefined;
    const currentSubDeptId = scope.subdept_ids.length === 1 ? scope.subdept_ids[0] : undefined;

    // ==================== STATE ====================
    const [statusFilter, setStatusFilter] = useState<SwapStatus | 'all'>('MANAGER_PENDING');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [actionConfirm, setActionConfirm] = useState<{
        ids: string[];
        status: 'approved' | 'rejected';
        reason?: string;
    } | null>(null);
    // Single-item compliance approval modal (replaces simple confirm for single approvals)
    const [complianceApprovalTarget, setComplianceApprovalTarget] = useState<SwapRequestManagement | null>(null);
    const [swapRequests, setSwapRequests] = useState<SwapRequestManagement[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // ==================== DATA FETCHING ====================
    const fetchData = async () => {
        if (!currentOrgId) return;

        setIsLoading(true);
        try {
            const apiData = await swapsApi.fetchSwapRequests({
                organizationId: currentOrgId,
                departmentId: currentDeptId,
                subDepartmentId: currentSubDeptId
            });
            const uiData = apiData.map(mapToUIModel);
            setSwapRequests(uiData);
        } catch (error) {
            console.error(error);
            toast({
                title: 'Error fetching requests',
                description: 'Failed to load swap requests.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    // Use scopeKey to stabilize deps and prevent infinite re-fetching
    useEffect(() => {
        if (currentOrgId) {
            fetchData();
        }
        const interval = setInterval(() => {
            if (currentOrgId) fetchData();
        }, 30000);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statusFilter, scopeKey]);

    // ==================== COMPUTED ====================
    const filteredRequests = useMemo(() => {
        if (statusFilter === 'all') return swapRequests;
        return swapRequests.filter(r => r.status === statusFilter);
    }, [swapRequests, statusFilter]);

    const statusCounts = useMemo(() => {
        const counts: Record<string, number> = {
            MANAGER_PENDING: 0, OPEN: 0, APPROVED: 0, REJECTED: 0, all: 0
        };
        swapRequests.forEach(r => {
            if (counts[r.status] !== undefined) counts[r.status]++;
        });
        counts.all = swapRequests.length;
        return counts;
    }, [swapRequests]);

    // ==================== HANDLERS ====================
    const handleAction = (ids: string[], status: 'approved' | 'rejected') => {
        // Single-item approval → open compliance gate modal
        if (status === 'approved' && ids.length === 1) {
            const target = swapRequests.find(r => r.id === ids[0]);
            if (target) {
                setComplianceApprovalTarget(target);
                return;
            }
        }
        // Batch or rejection → simple confirm dialog
        setActionConfirm({ ids, status });
    };

    const handleConfirmAction = async () => {
        if (!actionConfirm) return;

        const { ids, status } = actionConfirm;
        const previousState = [...swapRequests];
        setSwapRequests(prev => prev.map(r => ids.includes(r.id) ? { ...r, status: status === 'approved' ? 'APPROVED' : 'REJECTED' } : r));

        try {
            if (status === 'approved') {
                await Promise.all(ids.map(id => swapsApi.approveSwapRequest(id)));
            } else {
                await Promise.all(ids.map(id => swapsApi.rejectSwapRequest(id, actionConfirm.reason || 'Manager Action')));
            }
            toast({ title: 'Success', description: `Request(s) ${status} successfully` });
            fetchData();
        } catch (error) {
            console.error('Failed to process swap:', error);
            setSwapRequests(previousState);
            toast({
                title: 'Operation Failed',
                description: error instanceof Error ? error.message : 'Could not complete the action.',
                variant: 'destructive',
            });
        }

        setSelectedIds(new Set());
        setActionConfirm(null);
    };

    const toggleSelection = (id: string) => {
        setSelectedIds((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(id)) newSet.delete(id);
            else newSet.add(id);
            return newSet;
        });
    };

    const handleSelectAll = () => {
        if (selectedIds.size === filteredRequests.length) setSelectedIds(new Set());
        else setSelectedIds(new Set(filteredRequests.map(r => r.id)));
    };

    // ==================== RENDER ====================
    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* Ambient glow */}
            <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-primary/[0.05] blur-[150px] rounded-full pointer-events-none" />

            {/* ── Unified Header ────────────────────────────────────────────── */}
            <div className="sticky top-0 z-30 -mx-4 px-4 md:-mx-8 md:px-8 pt-4 pb-4 lg:pb-6">
                <div className={cn(
                    "rounded-[32px] p-4 lg:p-6 transition-all border",
                    isDark 
                        ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
                        : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
                )}>
                    {/* Row 1: Identity & Clock + Row 2: Scope Filter */}
                    <PersonalPageHeader
                        title="Swap Requests"
                        Icon={ArrowLeftRight}
                        scope={scope}
                        setScope={setScope}
                        isGammaLocked={isGammaLocked}
                    />

                    {/* Row 3: Function Bar / Status Tabs */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-4 lg:mt-6">
                        <div className="overflow-x-auto scrollbar-hide -mx-1 px-1">
                            <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-muted/30 border border-border flex-nowrap min-w-max md:min-w-0">
                                {STATUS_TABS.map(tab => {
                                    const isActive = statusFilter === tab.id;
                                    const colors = accentMap[tab.accent];
                                    const TabIcon = tab.icon;
                                    return (
                                        <button
                                            key={tab.id}
                                            onClick={() => setStatusFilter(tab.id as any)}
                                            className={cn(
                                                "relative flex items-center gap-2 px-3.5 py-2 rounded-xl text-[11px] font-black transition-all duration-300",
                                                isActive
                                                    ? `${colors.bg} ${colors.text} shadow-sm`
                                                    : "text-muted-foreground/50 hover:text-foreground hover:bg-muted/50"
                                            )}
                                        >
                                            <TabIcon className="h-3.5 w-3.5" />
                                            <span className="hidden sm:inline">{tab.label}</span>
                                            <span className={cn(
                                                "min-w-[18px] h-[18px] rounded-full text-[9px] font-black flex items-center justify-center px-1",
                                                isActive ? `${colors.bg} ${colors.text} ring-1 ${colors.ring}` : "bg-muted text-muted-foreground/40"
                                            )}>
                                                {statusCounts[tab.id] || 0}
                                            </span>
                                            {isActive && (
                                                <motion.div
                                                    layoutId="activeSwapTab"
                                                    className={`absolute inset-0 rounded-xl ring-1 ${colors.ring}`}
                                                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                                                />
                                            )}
                                        </button>
                                    );
                                })}

                                {/* Refresh */}
                                <button
                                    onClick={fetchData}
                                    className="ml-1 h-8 w-8 rounded-xl flex items-center justify-center text-muted-foreground/40 hover:text-primary hover:bg-primary/10 transition-all border border-transparent hover:border-primary/20"
                                    title="Refresh"
                                >
                                    <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
                                </button>
                            </div>
                        </div>

                        <div className="hidden lg:block text-[10px] font-mono text-muted-foreground/40 uppercase tracking-[0.2em] font-black">
                            Manager Review Console
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Main Content Area ─────────────────────────── */}
            <div className="flex-1 min-h-0 overflow-hidden pt-2 lg:pt-4">
                <div className={cn(
                    "h-full rounded-[32px] overflow-hidden transition-all border flex flex-col",
                    isDark 
                        ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20" 
                        : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
                )}>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-32 gap-4">
                            <div className="h-10 w-10 rounded-full border-2 border-border border-t-indigo-500 animate-spin" />
                            <span className="text-[10px] font-mono text-muted-foreground/40 uppercase tracking-[0.3em]">Loading requests</span>
                        </div>
                    ) : filteredRequests.length === 0 ? (
                        /* Empty State */
                        <div className="flex flex-col items-center justify-center py-32 gap-6">
                            <div className="relative">
                                <div className="h-20 w-20 rounded-3xl bg-muted/40 border border-border flex items-center justify-center shadow-2xl">
                                    <ArrowLeftRight className="h-8 w-8 text-muted-foreground/20" />
                                </div>
                                <div className="absolute -inset-4 bg-primary/5 rounded-full blur-2xl animate-pulse" />
                            </div>
                            <div className="text-center">
                                <p className="text-sm font-black text-foreground/40 mb-1 uppercase tracking-widest">No {statusFilter === 'all' ? '' : statusFilter.replace('_', ' ').toLowerCase()} requests</p>
                                <p className="text-[11px] text-muted-foreground/40 font-mono font-black">Check back later or adjust your filters</p>
                            </div>
                        </div>
                    ) : (
                        /* Request Cards */
                        <div className="space-y-3">
                            {/* Select All (for pending) */}
                            {statusFilter === 'MANAGER_PENDING' && filteredRequests.length > 1 && (
                                <div className="flex items-center gap-3 px-4 py-2">
                                    <Checkbox
                                        checked={selectedIds.size === filteredRequests.length}
                                        onCheckedChange={handleSelectAll}
                                        className="border-border/50"
                                    />
                                    <span className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider">
                                        Select All ({filteredRequests.length})
                                    </span>
                                </div>
                            )}

                            <AnimatePresence mode="popLayout">
                                {filteredRequests.map((request, idx) => (
                                    <motion.div
                                        key={request.id}
                                        initial={{ opacity: 0, scale: 0.98 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.96 }}
                                        transition={{ delay: idx * 0.05, duration: 0.3, ease: "easeOut" }}
                                        className={cn(
                                            "group rounded-2xl md:rounded-[2.5rem] border transition-all duration-300 hover:shadow-2xl overflow-hidden bg-card/40 backdrop-blur-md",
                                            "hover:translate-y-[-2px] border-border shadow-sm",
                                            selectedIds.has(request.id) && "ring-2 ring-primary border-primary/40 shadow-primary/20"
                                        )}
                                    >

                                        <div className="flex flex-col lg:flex-row">
                                            {/* Left: Checkbox + State Badges */}
                                            {statusFilter === 'MANAGER_PENDING' && (
                                                <div className="flex lg:flex-col items-center justify-center gap-3 p-4 lg:px-5 lg:border-r border-border/50 bg-muted/5">
                                                    <Checkbox
                                                        checked={selectedIds.has(request.id)}
                                                        onCheckedChange={() => toggleSelection(request.id)}
                                                        className="border-border shadow-sm"
                                                    />
                                                    <div className="flex lg:flex-col gap-1">
                                                        <Badge variant="outline" className="text-[8px] text-primary/50 border-primary/10 font-mono px-1.5 py-0 bg-background/50">
                                                            {request.shiftStateId}
                                                        </Badge>
                                                        <Badge variant="outline" className="text-[8px] text-muted-foreground/30 border-border font-mono px-1.5 py-0">
                                                            {request.combinedStateId}
                                                        </Badge>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Center: Swap Comparison */}
                                            <div className="flex-1 flex flex-col sm:flex-row items-center gap-2 p-3">
                                                <ShiftPane data={request.requestor} label="REQUESTER" />
                                                <SwapDivider
                                                    hoursDiff={request.hoursDiff}
                                                    payDiff={request.payDiff}
                                                    compliance={request.complianceStatus}
                                                />
                                                <ShiftPane data={request.recipient} label="OFFERER" />
                                            </div>


                                            {/* Right: Action Panel */}
                                            <div className="flex flex-row lg:flex-col items-center justify-between gap-3 p-5 lg:pl-0 lg:border-l border-border/50 min-w-[180px] bg-muted/5">
                                                {/* Meta */}
                                                <div className="lg:flex-1 flex flex-col items-start lg:items-end gap-1.5 w-full">
                                                    <span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-widest font-black">
                                                        {format(parseISO(request.requestedAt), 'MMM d, h:mm a')}
                                                    </span>
                                                    {request.reason && (
                                                        <p className="text-[10px] text-foreground/50 line-clamp-2 lg:text-right leading-relaxed max-w-[160px] italic font-medium">
                                                            "{request.reason}"
                                                        </p>
                                                    )}
                                                    <div className="flex gap-1.5 flex-wrap">
                                                        {request.tags.map(tag => (
                                                            <Badge key={tag} variant="outline" className={cn(
                                                                "text-[8px] font-black font-mono px-1.5 py-0 border-border/50 bg-background/50",
                                                                getDeptAccent(tag)
                                                            )}>
                                                                {tag}
                                                            </Badge>
                                                        ))}
                                                        {request.priority && (() => {
                                                            const pc = PRIORITY_CONFIG[request.priority];
                                                            const PIcon = pc.icon;
                                                            return (
                                                                <span className={cn(
                                                                    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[8px] font-black font-mono uppercase tracking-wider",
                                                                    pc.badgeCls
                                                                )}>
                                                                    <PIcon className="h-2.5 w-2.5" />
                                                                    {pc.label}
                                                                </span>
                                                            );
                                                        })()}
                                                    </div>
                                                </div>

                                                {/* Actions */}
                                                {request.status === 'MANAGER_PENDING' ? (
                                                    <div className="flex flex-col gap-2 w-full">
                                                        {/* Re-check compliance */}
                                                        <Button
                                                            onClick={() => setComplianceApprovalTarget(request)}
                                                            size="sm"
                                                            variant="outline"
                                                            className="flex-1 min-h-[44px] h-9 rounded-xl border-border/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground text-[10px] font-black uppercase tracking-wider transition-all"
                                                        >
                                                            <ScanSearch className="h-3 w-3 mr-1.5" />
                                                            Check Compliance
                                                        </Button>
                                                        <Button
                                                            onClick={() => handleAction([request.id], 'rejected')}
                                                            size="sm"
                                                            className="flex-1 min-h-[44px] h-9 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-[10px] font-black uppercase tracking-wider transition-all"
                                                        >
                                                            <X className="h-3 w-3 mr-1.5" />
                                                            Reject
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <div className={cn(
                                                        "flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider border",
                                                        request.status === 'APPROVED'
                                                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                                            : request.status === 'REJECTED'
                                                                ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20"
                                                                : "bg-muted text-muted-foreground/50 border-border"
                                                    )}>
                                                        {request.status === 'APPROVED' && <CheckCircle className="h-3.5 w-3.5" />}
                                                        {request.status === 'REJECTED' && <XCircle className="h-3.5 w-3.5" />}
                                                        {request.status}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        </div>
                    )}
                </div>
            </div>
        </div>

            {/* ── BULK ACTION BAR ── */}
            <AnimatePresence>
                {selectedIds.size > 0 && (
                    <motion.div
                        initial={{ y: 80, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 80, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                        className="sticky bottom-24 md:bottom-4 z-20 backdrop-blur-xl border border-primary/20 shadow-2xl shadow-primary/10 rounded-[2rem] mx-4 md:mx-6"
                        style={{ background: 'hsl(var(--card) / 0.9)' }}
                    >
                        <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                                    <span className="text-[11px] font-black text-primary">{selectedIds.size}</span>
                                </div>
                                <span className="text-[11px] font-black text-foreground/50 uppercase tracking-widest">
                                    Requests Selected
                                </span>
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    onClick={() => handleAction(Array.from(selectedIds), 'rejected')}
                                    size="sm"
                                    className="h-9 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-[10px] font-black uppercase tracking-wider"
                                >
                                    <X className="h-3 w-3 mr-1.5" />
                                    Reject Batch
                                </Button>
                                <Button
                                    onClick={() => handleAction(Array.from(selectedIds), 'approved')}
                                    size="sm"
                                    className="h-9 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 text-[10px] font-black uppercase tracking-wider border-none"
                                >
                                    <Check className="h-3 w-3 mr-1.5" />
                                    Approve Batch
                                </Button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── COMPLIANCE APPROVAL MODAL (single-item approve) ── */}
            <AnimatePresence>
                {complianceApprovalTarget && (
                    <ManagerComplianceApprovalModal
                        isOpen={!!complianceApprovalTarget}
                        onClose={() => setComplianceApprovalTarget(null)}
                        onApprove={async () => {
                            const id = complianceApprovalTarget.id;
                            const previousState = [...swapRequests];
                            setSwapRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'APPROVED' } : r));
                            setComplianceApprovalTarget(null);
                            try {
                                await swapsApi.approveSwapRequest(id);
                                toast({ title: 'Approved', description: 'Swap request approved successfully.' });
                                fetchData();
                            } catch (error) {
                                setSwapRequests(previousState);
                                toast({
                                    title: 'Approval Failed',
                                    description: error instanceof Error ? error.message : 'Could not approve swap.',
                                    variant: 'destructive',
                                });
                            }
                            setSelectedIds(new Set());
                        }}
                        onReject={(reason?: string) => {
                            const id = complianceApprovalTarget.id;
                            setComplianceApprovalTarget(null);
                            setActionConfirm({ ids: [id], status: 'rejected', reason });
                        }}
                        swapId={complianceApprovalTarget.id}
                        requesterEmployeeId={complianceApprovalTarget.requesterEmployeeId}
                        requesterName={complianceApprovalTarget.requestor.employeeName}
                        requesterShiftId={complianceApprovalTarget.requesterShiftId}
                        offererEmployeeId={complianceApprovalTarget.offererEmployeeId}
                        offererName={complianceApprovalTarget.recipient?.employeeName ?? 'Offerer'}
                        offererShiftId={complianceApprovalTarget.offererShiftId}
                    />
                )}
            </AnimatePresence>

            {/* ── CONFIRMATION DIALOG ── */}
            <AnimatePresence>
                {actionConfirm && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4"
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                            className="relative max-w-md w-full rounded-[2.5rem] border border-border shadow-3xl overflow-hidden bg-card"
                        >
                            {/* Status stripe */}
                            <div className={cn(
                                "h-1.5",
                                actionConfirm.status === 'approved' ? "bg-emerald-500" : "bg-rose-500"
                            )} />

                            <div className="p-8">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className={cn(
                                        "h-12 w-12 rounded-2xl flex items-center justify-center border",
                                        actionConfirm.status === 'approved'
                                            ? "bg-emerald-500/10 border-emerald-500/20"
                                            : "bg-rose-500/10 border-rose-500/20"
                                    )}>
                                        <Gavel className={cn(
                                            "h-6 w-6",
                                            actionConfirm.status === 'approved' ? "text-emerald-500" : "text-rose-500"
                                        )} />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-black text-foreground tracking-tight">
                                            Confirm {actionConfirm.status === 'approved' ? 'Approval' : 'Rejection'}
                                        </h3>
                                        <p className="text-[11px] font-mono text-muted-foreground font-black uppercase tracking-widest">
                                            {actionConfirm.ids.length} request{actionConfirm.ids.length > 1 ? 's' : ''}
                                        </p>
                                    </div>
                                </div>

                                <p className="text-sm text-muted-foreground/80 mb-8 leading-relaxed font-medium">
                                    This action will {actionConfirm.status === 'approved' ? 'approve and execute' : 'reject'} the
                                    selected swap {actionConfirm.ids.length > 1 ? 'requests' : 'request'}. This cannot be undone.
                                </p>

                                <div className="flex justify-end gap-3">
                                    <Button
                                        variant="ghost"
                                        onClick={() => setActionConfirm(null)}
                                        className="rounded-xl text-muted-foreground hover:bg-muted font-black uppercase tracking-widest text-[10px]"
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        onClick={handleConfirmAction}
                                        className={cn(
                                            "rounded-xl text-primary-foreground text-[11px] font-black uppercase tracking-wider shadow-lg border-none h-11 px-6",
                                            actionConfirm.status === 'approved'
                                                ? "bg-primary hover:bg-primary/90 shadow-primary/20"
                                                : "bg-rose-600 hover:bg-rose-500 shadow-rose-500/20"
                                        )}

                                    >
                                        {actionConfirm.status === 'approved' ? 'Confirm Approval' : 'Confirm Rejection'}
                                    </Button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default ManagerSwapsPage;
