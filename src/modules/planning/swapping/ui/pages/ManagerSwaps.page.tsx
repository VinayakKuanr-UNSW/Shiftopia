import React, { useState, useEffect, useMemo } from 'react';
import { Check, X, ChevronRight, ArrowLeftRight, Clock, CheckCircle, XCircle, Calendar, AlertTriangle, Shield, Gavel, RefreshCw } from 'lucide-react';
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
import { useOrgSelection } from '@/modules/core/contexts/OrgSelectionContext';
import { ScopeFilterBanner } from '@/modules/core/ui/components/ScopeFilterBanner';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';

/* ============================================================
   DESIGN TOKENS
   ============================================================ */

const CANVAS = '#080B12';
const SURFACE = '#0D1118';
const SURFACE_RAISED = '#121820';
const BORDER_SUBTLE = 'rgba(255,255,255,0.06)';

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

// Department-coded gradient cards
function getCardGradient(dept?: string | null): string {
    const d = (dept || '').toLowerCase();
    if (d.includes('convention')) return 'from-blue-900/30 via-blue-950/20 to-transparent border-blue-500/15 hover:border-blue-400/30';
    if (d.includes('exhibition')) return 'from-emerald-900/30 via-emerald-950/20 to-transparent border-emerald-500/15 hover:border-emerald-400/30';
    if (d.includes('theatre')) return 'from-rose-900/30 via-rose-950/20 to-transparent border-rose-500/15 hover:border-rose-400/30';
    return 'from-slate-800/30 via-slate-900/20 to-transparent border-white/8 hover:border-white/15';
}

function getDeptAccent(dept?: string | null): string {
    const d = (dept || '').toLowerCase();
    if (d.includes('convention')) return 'text-blue-400';
    if (d.includes('exhibition')) return 'text-emerald-400';
    if (d.includes('theatre')) return 'text-rose-400';
    return 'text-slate-400';
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
    amber: { bg: 'bg-amber-500/10', text: 'text-amber-400', ring: 'ring-amber-500/20', glow: 'shadow-amber-500/20' },
    blue: { bg: 'bg-blue-500/10', text: 'text-blue-400', ring: 'ring-blue-500/20', glow: 'shadow-blue-500/20' },
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', ring: 'ring-emerald-500/20', glow: 'shadow-emerald-500/20' },
    red: { bg: 'bg-red-500/10', text: 'text-red-400', ring: 'ring-red-500/20', glow: 'shadow-red-500/20' },
    slate: { bg: 'bg-slate-500/10', text: 'text-slate-400', ring: 'ring-slate-500/20', glow: 'shadow-slate-500/20' },
};

/* ============================================================
   EMPLOYEE SHIFT PANE (within card)
   ============================================================ */

const ShiftPane: React.FC<{ data: any; label: string }> = ({ data, label }) => {
    if (!data) {
        return (
            <div className="flex-1 min-w-[200px] rounded-2xl border border-dashed border-white/8 p-5 flex flex-col items-center justify-center gap-2">
                <div className="h-10 w-10 rounded-full bg-white/[0.03] flex items-center justify-center">
                    <ArrowLeftRight className="h-4 w-4 text-white/15" />
                </div>
                <span className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-white/20">Open Market</span>
            </div>
        );
    }

    const isRequester = label === 'REQUESTER';

    return (
        <div className="flex-1 min-w-[200px]">
            {/* Label */}
            <div className="flex items-center gap-2 mb-3">
                <div className={cn(
                    "h-1 w-6 rounded-full",
                    isRequester ? "bg-indigo-500" : "bg-emerald-500"
                )} />
                <span className={cn(
                    "text-[9px] font-mono font-black uppercase tracking-[0.25em]",
                    isRequester ? "text-indigo-400/70" : "text-emerald-400/70"
                )}>
                    {label}
                </span>
            </div>

            {/* Employee Row */}
            <div className="flex items-center gap-3 mb-4">
                <Avatar className="h-9 w-9 ring-1 ring-white/10">
                    <AvatarImage src={data.avatar} />
                    <AvatarFallback className={cn(
                        "text-[10px] font-black",
                        isRequester
                            ? "bg-gradient-to-br from-indigo-600 to-indigo-800 text-white"
                            : "bg-gradient-to-br from-emerald-600 to-emerald-800 text-white"
                    )}>
                        {getInitials(data.employeeName || '?')}
                    </AvatarFallback>
                </Avatar>
                <div>
                    <div className="text-[13px] font-bold text-white leading-tight tracking-tight">{data.employeeName}</div>
                    <div className="text-[10px] text-white/35 font-mono uppercase tracking-wider">{data.roleName}</div>
                </div>
            </div>

            {/* Shift Details */}
            <div className="bg-black/30 rounded-xl p-3 border border-white/[0.04] space-y-2">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[11px] text-white/60">
                        <Calendar className="h-3 w-3 opacity-50" />
                        <span className="font-mono font-medium">{data.formattedDate || 'N/A'}</span>
                    </div>
                </div>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[11px] text-white/60">
                        <Clock className="h-3 w-3 opacity-50" />
                        <span className="font-mono font-medium">{data.time}</span>
                    </div>
                    <span className="text-[10px] font-mono text-white/25 bg-white/[0.03] px-2 py-0.5 rounded-md">{data.duration}</span>
                </div>
                {data.hourlyRate > 0 && (
                    <div className="flex items-center justify-between pt-1.5 border-t border-white/[0.04]">
                        <span className="text-[9px] font-mono text-white/20 uppercase tracking-wider">Value</span>
                        <span className="text-[11px] font-mono font-bold text-white/50">${(data.hourlyRate * data.durationNum).toFixed(0)}</span>
                    </div>
                )}
            </div>
        </div>
    );
};

/* ============================================================
   SWAP ARROW (center divider)
   ============================================================ */

const SwapDivider: React.FC<{ hoursDiff: number; payDiff: number; compliance: boolean | null }> = ({ hoursDiff, payDiff, compliance }) => {
    const hoursColor = hoursDiff > 0 ? 'text-emerald-400' : hoursDiff < 0 ? 'text-red-400' : 'text-white/20';
    const payColor = payDiff > 0 ? 'text-emerald-400' : payDiff < 0 ? 'text-red-400' : 'text-white/20';

    return (
        <div className="flex flex-col items-center justify-center px-5 py-2 gap-2 flex-shrink-0">
            <div className="h-8 w-8 rounded-full bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
                <ArrowLeftRight className="h-3.5 w-3.5 text-white/30" />
            </div>
            <div className="flex flex-col items-center gap-1">
                <span className={cn("text-[10px] font-mono font-bold", hoursColor)}>
                    {hoursDiff > 0 ? '+' : ''}{hoursDiff.toFixed(1)}h
                </span>
                {payDiff !== 0 && (
                    <span className={cn("text-[10px] font-mono font-bold", payColor)}>
                        {payDiff > 0 ? '+' : ''}${payDiff.toFixed(0)}
                    </span>
                )}
                {compliance !== null && (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger>
                                {compliance
                                    ? <CheckCircle className="h-3 w-3 text-emerald-500" />
                                    : <AlertTriangle className="h-3 w-3 text-amber-500" />
                                }
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>{compliance ? 'Compliance Passed' : 'Compliance Warnings'}</p>
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
    } | null;
    status: SwapStatus;
    reason: string;
    requestedAt: string;
    tags: string[];
    hoursDiff: number;
    payDiff: number;
    compliancePassed: boolean | null;
    shiftStateId: string;
    combinedStateId: string;
    deptName: string;
}

const mapToUIModel = (apiData: SwapRequestWithDetails): SwapRequestManagement => {
    const getShiftValue = (shift?: any) => {
        const rate = shift?.roles?.remuneration_levels?.hourly_rate_min || 0;
        const netLength = shift?.netLength || 0;
        const durationHours = netLength / 60;
        return { rate, durationHours, value: rate * durationHours };
    };

    const reqVal = getShiftValue(apiData.originalShift);
    const recVal = getShiftValue(apiData.requestedShift);

    const activeOffer = apiData.swap_offers?.find(o =>
        (o.offered_shift_id === apiData.offered_shift_id) ||
        (o.status === 'SELECTED')
    );
    const compliancePassed = activeOffer?.compliance_snapshot?.passed ?? null;

    const hoursDiff = apiData.requestedShift ? (recVal.durationHours - reqVal.durationHours) : -reqVal.durationHours;
    const payDiff = apiData.requestedShift ? (recVal.value - reqVal.value) : -reqVal.value;

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
        },
        recipient: apiData.requestedShift ? {
            employeeName: apiData.targetEmployee?.fullName || 'Open Swap',
            roleName: apiData.requestedShift?.roles?.name || 'Any Role',
            date: apiData.requestedShift?.shiftDate || '',
            formattedDate: apiData.requestedShift?.shiftDate ? format(parse(apiData.requestedShift.shiftDate, 'yyyy-MM-dd', new Date()), 'EEE, MMM d') : '',
            time: `${apiData.requestedShift?.startTime} - ${apiData.requestedShift?.endTime}`,
            duration: `${recVal.durationHours.toFixed(1)}h`,
            durationNum: recVal.durationHours,
            hourlyRate: recVal.rate,
            avatar: apiData.targetEmployee?.avatarUrl,
        } : null,
        status: apiData.status as any,
        reason: apiData.reason || '',
        requestedAt: apiData.created_at,
        tags: [apiData.originalShift?.departments?.name || 'General'],
        hoursDiff,
        payDiff,
        compliancePassed,
        deptName: apiData.originalShift?.departments?.name || 'General',
        ...deriveStateIds(apiData.status),
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
    const orgSelection = useOrgSelection();
    const { scope, setScope, scopeKey, isGammaLocked } = useScopeFilter('managerial');

    const currentOrgId = scope.org_ids[0] || orgSelection.organizationId;
    const currentDeptId = scope.dept_ids.length === 1 ? scope.dept_ids[0] : undefined;
    const currentSubDeptId = scope.subdept_ids.length === 1 ? scope.subdept_ids[0] : undefined;

    // ==================== STATE ====================
    const [statusFilter, setStatusFilter] = useState<SwapStatus | 'all'>('MANAGER_PENDING');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [actionConfirm, setActionConfirm] = useState<{
        ids: string[];
        status: 'approved' | 'rejected';
    } | null>(null);
    const [swapRequests, setSwapRequests] = useState<SwapRequestManagement[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // ==================== DATA FETCHING ====================
    const fetchData = async () => {
        if (!currentOrgId) return;

        setIsLoading(true);
        try {
            const apiData = await swapsApi.fetchSwapRequests({
                status: statusFilter === 'all' ? undefined : statusFilter,
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
    const filteredRequests = swapRequests;

    const statusCounts = useMemo(() => {
        const counts: Record<string, number> = {
            MANAGER_PENDING: 0, OPEN: 0, APPROVED: 0, REJECTED: 0, all: 0
        };
        if (statusFilter === 'all') {
            swapRequests.forEach(r => {
                if (counts[r.status] !== undefined) counts[r.status]++;
            });
            counts.all = swapRequests.length;
        } else {
            counts[statusFilter] = swapRequests.length;
        }
        return counts;
    }, [swapRequests, statusFilter]);

    // ==================== HANDLERS ====================
    const handleAction = (ids: string[], status: 'approved' | 'rejected') => {
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
                await Promise.all(ids.map(id => swapsApi.rejectSwapRequest(id, 'Manager Action')));
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
        <div className="flex flex-col h-full min-h-screen" style={{ background: `linear-gradient(180deg, ${CANVAS} 0%, #0A0E16 50%, ${CANVAS} 100%)` }}>
            {/* Ambient glow */}
            <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-indigo-600/[0.03] blur-[150px] rounded-full pointer-events-none" />

            {/* ── HEADER ── */}
            <div className="sticky top-0 z-50 backdrop-blur-xl border-b" style={{ borderColor: BORDER_SUBTLE, background: `${SURFACE}ee` }}>
                <div className="max-w-[1400px] mx-auto px-6 py-5">
                    {/* Scope Filter */}
                    <ScopeFilterBanner
                        mode="managerial"
                        onScopeChange={setScope}
                        hidden={isGammaLocked}
                        multiSelect={false}
                        className="mb-5"
                    />

                    {/* Title + Status Tabs */}
                    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-black text-white tracking-tight leading-none mb-1">
                                Swap Requests
                            </h1>
                            <p className="text-[11px] font-mono text-white/25 uppercase tracking-[0.2em]">
                                Manager Review Console
                            </p>
                        </div>

                        {/* Status Tabs */}
                        <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-white/[0.02] border border-white/[0.04]">
                            {STATUS_TABS.map(tab => {
                                const isActive = statusFilter === tab.id;
                                const colors = accentMap[tab.accent];
                                const TabIcon = tab.icon;
                                return (
                                    <button
                                        key={tab.id}
                                        onClick={() => setStatusFilter(tab.id as any)}
                                        className={cn(
                                            "relative flex items-center gap-2 px-3.5 py-2 rounded-xl text-[11px] font-bold transition-all duration-300",
                                            isActive
                                                ? `${colors.bg} ${colors.text} shadow-lg ${colors.glow}`
                                                : "text-white/30 hover:text-white/50 hover:bg-white/[0.03]"
                                        )}
                                    >
                                        <TabIcon className="h-3.5 w-3.5" />
                                        <span className="hidden sm:inline">{tab.label}</span>
                                        <span className={cn(
                                            "min-w-[18px] h-[18px] rounded-full text-[9px] font-black flex items-center justify-center px-1",
                                            isActive ? `${colors.bg} ${colors.text} ring-1 ${colors.ring}` : "bg-white/5 text-white/20"
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
                                className="ml-1 h-8 w-8 rounded-xl flex items-center justify-center text-white/20 hover:text-white/50 hover:bg-white/[0.03] transition-all"
                                title="Refresh"
                            >
                                <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── CONTENT ── */}
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-[1400px] mx-auto px-6 py-6">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-32 gap-4">
                            <div className="h-10 w-10 rounded-full border-2 border-white/10 border-t-indigo-500 animate-spin" />
                            <span className="text-[10px] font-mono text-white/20 uppercase tracking-[0.3em]">Loading requests</span>
                        </div>
                    ) : filteredRequests.length === 0 ? (
                        /* Empty State */
                        <div className="flex flex-col items-center justify-center py-32 gap-6">
                            <div className="relative">
                                <div className="h-20 w-20 rounded-3xl bg-white/[0.02] border border-white/[0.06] flex items-center justify-center">
                                    <ArrowLeftRight className="h-8 w-8 text-white/10" />
                                </div>
                                <div className="absolute -inset-4 bg-indigo-500/5 rounded-full blur-2xl animate-pulse" />
                            </div>
                            <div className="text-center">
                                <p className="text-sm font-bold text-white/30 mb-1">No {statusFilter === 'all' ? '' : statusFilter.replace('_', ' ').toLowerCase()} requests</p>
                                <p className="text-[11px] text-white/15 font-mono">Check back later or adjust your filters</p>
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
                                        className="border-white/20"
                                    />
                                    <span className="text-[10px] font-mono text-white/30 uppercase tracking-wider">
                                        Select All ({filteredRequests.length})
                                    </span>
                                </div>
                            )}

                            <AnimatePresence mode="popLayout">
                                {filteredRequests.map((request, idx) => (
                                    <motion.div
                                        key={request.id}
                                        initial={{ opacity: 0, y: 12 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.96 }}
                                        transition={{ delay: idx * 0.05, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                                        className={cn(
                                            "group rounded-2xl border bg-gradient-to-r backdrop-blur-sm transition-all duration-300 hover:shadow-xl overflow-hidden",
                                            getCardGradient(request.deptName),
                                            getDeptGlow(request.deptName),
                                            selectedIds.has(request.id) && "ring-1 ring-indigo-500/30"
                                        )}
                                    >
                                        <div className="flex flex-col lg:flex-row">
                                            {/* Left: Checkbox + State Badges */}
                                            {statusFilter === 'MANAGER_PENDING' && (
                                                <div className="flex lg:flex-col items-center justify-center gap-3 p-4 lg:px-5 lg:border-r border-white/[0.04]">
                                                    <Checkbox
                                                        checked={selectedIds.has(request.id)}
                                                        onCheckedChange={() => toggleSelection(request.id)}
                                                        className="border-white/20 data-[state=checked]:bg-indigo-600 data-[state=checked]:border-indigo-600"
                                                    />
                                                    <div className="flex lg:flex-col gap-1">
                                                        <Badge variant="outline" className="text-[8px] text-cyan-400/50 border-cyan-500/15 font-mono px-1.5 py-0">
                                                            {request.shiftStateId}
                                                        </Badge>
                                                        <Badge variant="outline" className="text-[8px] text-white/20 border-white/8 font-mono px-1.5 py-0">
                                                            {request.combinedStateId}
                                                        </Badge>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Center: Swap Comparison */}
                                            <div className="flex-1 flex flex-col sm:flex-row items-stretch gap-0 p-5">
                                                <ShiftPane data={request.requestor} label="REQUESTER" />
                                                <SwapDivider
                                                    hoursDiff={request.hoursDiff}
                                                    payDiff={request.payDiff}
                                                    compliance={request.compliancePassed}
                                                />
                                                <ShiftPane data={request.recipient} label="OFFERER" />
                                            </div>

                                            {/* Right: Action Panel */}
                                            <div className="flex flex-row lg:flex-col items-center justify-between gap-3 p-5 lg:pl-0 lg:border-l border-white/[0.04] min-w-[180px]">
                                                {/* Meta */}
                                                <div className="lg:flex-1 flex flex-col items-start lg:items-end gap-1.5 w-full">
                                                    <span className="text-[9px] font-mono text-white/20 uppercase tracking-wider">
                                                        {format(parseISO(request.requestedAt), 'MMM d, h:mm a')}
                                                    </span>
                                                    {request.reason && (
                                                        <p className="text-[10px] text-white/30 line-clamp-2 lg:text-right leading-relaxed max-w-[160px]">
                                                            "{request.reason}"
                                                        </p>
                                                    )}
                                                    <div className="flex gap-1.5 flex-wrap">
                                                        {request.tags.map(tag => (
                                                            <Badge key={tag} variant="outline" className={cn(
                                                                "text-[8px] font-mono px-1.5 py-0 border-white/8",
                                                                getDeptAccent(tag)
                                                            )}>
                                                                {tag}
                                                            </Badge>
                                                        ))}
                                                    </div>
                                                </div>

                                                {/* Actions */}
                                                {request.status === 'MANAGER_PENDING' ? (
                                                    <div className="flex lg:flex-col gap-2 w-full">
                                                        <Button
                                                            onClick={() => handleAction([request.id], 'rejected')}
                                                            size="sm"
                                                            className="flex-1 h-9 rounded-xl bg-red-500/8 hover:bg-red-500/15 text-red-400 border border-red-500/15 hover:border-red-500/30 text-[10px] font-bold uppercase tracking-wider transition-all"
                                                        >
                                                            <X className="h-3 w-3 mr-1.5" />
                                                            Reject
                                                        </Button>
                                                        <Button
                                                            onClick={() => handleAction([request.id], 'approved')}
                                                            size="sm"
                                                            className="flex-1 h-9 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/30 text-[10px] font-bold uppercase tracking-wider transition-all"
                                                        >
                                                            <Check className="h-3 w-3 mr-1.5" />
                                                            Approve
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <div className={cn(
                                                        "flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider border",
                                                        request.status === 'APPROVED'
                                                            ? "bg-emerald-500/8 text-emerald-400 border-emerald-500/15"
                                                            : request.status === 'REJECTED'
                                                                ? "bg-red-500/8 text-red-400 border-red-500/15"
                                                                : "bg-white/5 text-white/30 border-white/8"
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

            {/* ── BULK ACTION BAR ── */}
            <AnimatePresence>
                {selectedIds.size > 0 && (
                    <motion.div
                        initial={{ y: 80, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 80, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                        className="sticky bottom-0 z-20 backdrop-blur-xl border-t shadow-2xl shadow-black/50"
                        style={{ borderColor: BORDER_SUBTLE, background: `${SURFACE_RAISED}f0` }}
                    >
                        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                                    <span className="text-[11px] font-black text-indigo-400">{selectedIds.size}</span>
                                </div>
                                <span className="text-[11px] font-mono text-white/40 uppercase tracking-wider">
                                    Selected
                                </span>
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    onClick={() => handleAction(Array.from(selectedIds), 'rejected')}
                                    size="sm"
                                    className="h-9 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-[10px] font-bold uppercase tracking-wider"
                                >
                                    <X className="h-3 w-3 mr-1.5" />
                                    Reject Selected
                                </Button>
                                <Button
                                    onClick={() => handleAction(Array.from(selectedIds), 'approved')}
                                    size="sm"
                                    className="h-9 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/30 text-[10px] font-bold uppercase tracking-wider"
                                >
                                    <Check className="h-3 w-3 mr-1.5" />
                                    Approve Selected
                                </Button>
                            </div>
                        </div>
                    </motion.div>
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
                            className="relative max-w-md w-full rounded-3xl border overflow-hidden"
                            style={{ background: SURFACE_RAISED, borderColor: BORDER_SUBTLE }}
                        >
                            {/* Status stripe */}
                            <div className={cn(
                                "h-1",
                                actionConfirm.status === 'approved' ? "bg-emerald-500" : "bg-red-500"
                            )} />

                            <div className="p-8">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className={cn(
                                        "h-10 w-10 rounded-xl flex items-center justify-center border",
                                        actionConfirm.status === 'approved'
                                            ? "bg-emerald-500/10 border-emerald-500/20"
                                            : "bg-red-500/10 border-red-500/20"
                                    )}>
                                        <Gavel className={cn(
                                            "h-5 w-5",
                                            actionConfirm.status === 'approved' ? "text-emerald-400" : "text-red-400"
                                        )} />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-black text-white tracking-tight">
                                            Confirm {actionConfirm.status === 'approved' ? 'Approval' : 'Rejection'}
                                        </h3>
                                        <p className="text-[11px] font-mono text-white/30 uppercase tracking-wider">
                                            {actionConfirm.ids.length} request{actionConfirm.ids.length > 1 ? 's' : ''}
                                        </p>
                                    </div>
                                </div>

                                <p className="text-sm text-white/50 mb-8 leading-relaxed">
                                    This action will {actionConfirm.status === 'approved' ? 'approve and execute' : 'reject'} the
                                    selected swap {actionConfirm.ids.length > 1 ? 'requests' : 'request'}. This cannot be undone.
                                </p>

                                <div className="flex justify-end gap-3">
                                    <Button
                                        variant="outline"
                                        onClick={() => setActionConfirm(null)}
                                        className="rounded-xl text-white/60 border-white/10 hover:bg-white/5 text-[11px] font-bold uppercase tracking-wider"
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        onClick={handleConfirmAction}
                                        className={cn(
                                            "rounded-xl text-white text-[11px] font-bold uppercase tracking-wider shadow-lg",
                                            actionConfirm.status === 'approved'
                                                ? "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/30"
                                                : "bg-red-600 hover:bg-red-500 shadow-red-900/30"
                                        )}
                                    >
                                        {actionConfirm.status === 'approved' ? 'Approve' : 'Reject'}
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
