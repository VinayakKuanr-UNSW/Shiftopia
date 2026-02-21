import React, { useState, useEffect, useMemo } from 'react';
import { Check, X, ChevronRight, ArrowLeftRight, Clock, CheckCircle, XCircle, Calendar, AlertTriangle } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Checkbox } from '@/modules/core/ui/primitives/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from '@/modules/core/ui/primitives/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/modules/core/ui/primitives/tooltip';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/modules/core/ui/primitives/select';
import { useToast } from '@/modules/core/hooks/use-toast';
import { format, differenceInHours, parseISO, parse } from 'date-fns';
import { cn } from '@/modules/core/lib/utils';
import { useAuth } from '@/platform/auth/useAuth';
import { swapsApi } from '../../api/swaps.api';

import { SwapRequestWithDetails, SwapStatus } from '../../model/swap.types';
import { useOrgSelection } from '@/modules/core/contexts/OrgSelectionContext';
import { ScopeFilterBanner } from '@/modules/core/ui/components/ScopeFilterBanner';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
// UI Types
// ... imports ...

/* ... */

/* ============================================================
   HELPER COMPONENTS
   ============================================================ */

interface SwapStatusPillsProps {
    activeStatus: string;
    counts: Record<string, number>;
    onStatusChange: (status: any) => void;
}

const StatusFilterPills: React.FC<SwapStatusPillsProps> = ({ activeStatus, counts, onStatusChange }) => {
    const statuses = [
        { id: 'MANAGER_PENDING', label: 'Pending Approval', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
        { id: 'OPEN', label: 'Pending Employee', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
        { id: 'APPROVED', label: 'Approved', color: 'bg-green-500/10 text-green-400 border-green-500/20' },
        { id: 'REJECTED', label: 'Rejected', color: 'bg-red-500/10 text-red-400 border-red-500/20' },
        { id: 'all', label: 'All Requests', color: 'bg-slate-500/10 text-slate-400 border-slate-500/20' }
    ];

    return (
        <div className="flex flex-wrap gap-2">
            {statuses.map(status => (
                <button
                    key={status.id}
                    onClick={() => onStatusChange(status.id)}
                    className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
                        activeStatus === status.id
                            ? status.color + " ring-1 ring-white/10"
                            : "bg-transparent border-white/5 text-white/50 hover:bg-white/5 hover:text-white/70"
                    )}
                >
                    {status.label}
                    <Badge className={cn(
                        "ml-1 h-5 min-w-[1.25rem] px-1 bg-black/20 text-[10px] flex items-center justify-center rounded-full",
                        activeStatus !== status.id && "bg-white/10 text-white/50"
                    )}>
                        {counts[status.id] || 0}
                    </Badge>
                </button>
            ))}
        </div>
    );
};

const EmployeeShiftCard: React.FC<{ data: any, label?: string, variant?: 'red' | 'green' | 'default' }> = ({ data, label, variant = 'default' }) => {
    if (!data) return <div className="p-4 bg-white/5 rounded-lg text-white/30 text-xs text-center border border-dashed border-white/10">No Offer Selected</div>;

    // Auto-detect role for UX
    const isRequester = label === 'REQUESTER';
    const borderColor = isRequester ? 'border-indigo-500/30' : 'border-emerald-500/30';
    const labelColor = isRequester ? 'text-indigo-400 bg-indigo-500/10' : 'text-emerald-400 bg-emerald-500/10';

    return (
        <div className={cn(
            "flex-1 bg-black/20 rounded-lg p-3 border relative overflow-hidden",
            borderColor,
            // variant === 'red' && "bg-red-500/5",
            // variant === 'green' && "bg-green-500/5"
        )}>
            {label && (
                <div className={cn("absolute top-0 right-0 px-2 py-0.5 text-[9px] font-bold uppercase rounded-bl-lg border-b border-l border-white/5", labelColor)}>
                    {label}
                </div>
            )}

            <div className="flex items-center gap-3 mb-3 mt-1">
                <div className="h-9 w-9 rounded-full bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center text-xs font-bold text-white border border-white/10">
                    <Avatar className="h-full w-full">
                        <AvatarImage src={data.avatar} />
                        <AvatarFallback>{data.employeeName?.charAt(0) || '?'}</AvatarFallback>
                    </Avatar>
                </div>
                <div>
                    <div className="text-sm font-medium text-white leading-tight">{data.employeeName}</div>
                    <div className="text-[10px] text-white/50 uppercase tracking-wider">{data.roleName}</div>
                </div>
            </div>

            <div className="space-y-2 bg-black/20 p-2 rounded border border-white/5">
                <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 text-white/70">
                        <Calendar className="h-3.5 w-3.5 opacity-50" />
                        <span className="font-mono opacity-80">{data.formattedDate || 'N/A'}</span>
                    </div>
                </div>
                <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 text-white/70">
                        <Clock className="h-3.5 w-3.5 opacity-50" />
                        <span className="font-mono opacity-80">{data.time}</span>
                    </div>
                    <Badge variant="outline" className="text-[10px] h-4 px-1 text-white/40 border-white/10">
                        {data.duration}
                    </Badge>
                </div>
                {/* Pay Rate Visibility - Optional */}
                {data.hourlyRate > 0 && (
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-white/5">
                        <span className="text-white/30 text-[10px]">EST. VALUE</span>
                        <span className="font-mono text-white/60">${(data.hourlyRate * data.durationNum).toFixed(2)}</span>
                    </div>
                )}
            </div>
        </div>
    );
};

const SwapArrow: React.FC<{ hoursDiff: number, payDiff: number, compliance: boolean | null }> = ({ hoursDiff, payDiff, compliance }) => {
    const hoursColor = hoursDiff > 0 ? 'text-green-400' : hoursDiff < 0 ? 'text-red-400' : 'text-white/30';
    const payColor = payDiff > 0 ? 'text-green-400' : payDiff < 0 ? 'text-red-400' : 'text-white/30';

    return (
        <div className="flex flex-col items-center justify-center px-4 z-10">
            <div className="text-[10px] font-mono mb-1 text-white/30">SWAP</div>
            <ArrowLeftRight className="h-5 w-5 text-white/50 mb-2" />

            <div className="flex flex-col gap-1 items-center">
                <Badge variant="outline" className={cn("text-[9px] h-4 px-1 border-white/10 font-mono", hoursColor)}>
                    {hoursDiff > 0 ? '+' : ''}{hoursDiff.toFixed(1)}h
                </Badge>
                {payDiff !== 0 && (
                    <Badge variant="outline" className={cn("text-[9px] h-4 px-1 border-white/10 font-mono", payColor)}>
                        {payDiff > 0 ? '+' : ''}${payDiff.toFixed(0)}
                    </Badge>
                )}
                {compliance !== null && (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger>
                                {compliance ?
                                    <CheckCircle className="h-3 w-3 text-green-500 mt-1" /> :
                                    <AlertTriangle className="h-3 w-3 text-amber-500 mt-1" />
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

const InfoPanel: React.FC<{ request: any, isPending: boolean, onApprove: () => void, onReject: () => void }> = ({ request, isPending, onApprove, onReject }) => {
    return (
        <div className="h-full flex flex-col justify-between">
            <div>
                <div className="flex justify-between items-start mb-2">
                    <h4 className="text-sm font-medium text-white">Request Details</h4>
                    <span className="text-xs text-white/30">{format(parseISO(request.requestedAt), 'MMM d, h:mm a')}</span>
                </div>
                <p className="text-xs text-white/60 mb-4 line-clamp-2">
                    {request.reason || "No reason provided."}
                </p>
                <div className="flex gap-2 mb-4">
                    {request.tags?.map((tag: string) => (
                        <Badge key={tag} variant="secondary" className="text-[10px] bg-white/5 text-white/50 border-white/10 hover:bg-white/10">
                            {tag}
                        </Badge>
                    ))}
                </div>
            </div>

            {isPending ? (
                <div className="flex gap-2">
                    <Button onClick={onReject} variant="outline" size="sm" className="flex-1 bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20">
                        <X className="h-3.5 w-3.5 mr-1.5" /> Reject
                    </Button>
                    <Button onClick={onApprove} size="sm" className="flex-1 bg-green-600 hover:bg-green-700 text-white shadow-lg shadow-green-900/20">
                        <Check className="h-3.5 w-3.5 mr-1.5" /> Approve
                    </Button>
                </div>
            ) : (
                <div className={cn(
                    "flex items-center justify-center p-2 rounded-lg text-xs font-medium border",
                    request.status === 'APPROVED'
                        ? "bg-green-500/10 text-green-400 border-green-500/20"
                        : "bg-red-500/10 text-red-400 border-red-500/20"
                )}>
                    {request.status === 'APPROVED' ? (
                        <><CheckCircle className="h-3.5 w-3.5 mr-2" /> Approved</>
                    ) : (
                        <><XCircle className="h-3.5 w-3.5 mr-2" /> Rejected</>
                    )}
                </div>
            )
            }
        </div >
    );
};

// UI Types
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
    // Computed Diffs
    hoursDiff: number;
    payDiff: number;
    compliancePassed: boolean | null;
    // State IDs (per skill_trades.md §2)
    shiftStateId: string; // S4, S9, S10
    combinedStateId: string; // C1-C7
}

// Mapper
const mapToUIModel = (apiData: SwapRequestWithDetails): SwapRequestManagement => {
    // Helper to calculate rate and value
    const getShiftValue = (shift?: any) => {
        const rate = shift?.roles?.remuneration_levels?.hourly_rate_min || 0;
        const netLength = shift?.netLength || 0; // minutes
        const durationHours = netLength / 60;
        return { rate, durationHours, value: rate * durationHours };
    };

    const reqVal = getShiftValue(apiData.originalShift);
    const recVal = getShiftValue(apiData.requestedShift);

    // Compliance
    // If trade target is set, find the offer that matches this trade
    const activeOffer = apiData.swap_offers?.find(o =>
        (o.offered_shift_id === apiData.offered_shift_id) ||
        (o.status === 'SELECTED')
    );
    const compliancePassed = activeOffer?.compliance_snapshot?.passed ?? null;

    // Diffs (Recipient - Requester) (e.g. if I get a longer shift, diff is +)
    // Wait, context:
    // Requester gives X, gets Y.
    // So for Requester, delta is Y - X.
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
        // Derive state IDs per skill_trades.md §2
        ...deriveStateIds(apiData.status),
    };
};

// Derive Combined State ID and Shift State from swap status (skill_trades.md §2)
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

    // Use scope filter values, falling back to OrgSelectionContext
    const currentOrgId = scope.org_ids[0] || orgSelection.organizationId;
    const currentDeptId = scope.dept_ids[0] || orgSelection.departmentId;
    const currentSubDeptId = scope.subdept_ids[0] || orgSelection.subDepartmentId;

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
        if (!currentOrgId) return; // Wait for org selection

        setIsLoading(true);
        try {
            // Pass organizationId from selection
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

    useEffect(() => {
        if (currentOrgId) {
            fetchData();
        }
        // Poll every 30s
        const interval = setInterval(() => {
            if (currentOrgId) fetchData();
        }, 30000);
        return () => clearInterval(interval);
    }, [statusFilter, currentOrgId, currentDeptId, currentSubDeptId]);

    // ==================== COMPUTED ====================
    const filteredRequests = swapRequests; // Already filtered by API request in this simple logic

    // Calculate counts (This needs separate API aggregation ideally, but for now filtering locally if we fetch all)
    // For this impl, assume counts are dynamic or hidden if not fetched
    const statusCounts = useMemo(() => {
        const counts: Record<string, number> = {
            pending: 0,
            pending_employee: 0,
            pending_manager: 0,
            approved: 0,
            rejected: 0,
            cancelled: 0,
            completed: 0,
            all: 0
        };
        // We only have the requested status loaded, so counts might be inaccurate unless we fetch all metadata
        // For prototype, just use length of current loaded if "all", else unknowns.
        // Let's hide counts for 'other' tabs to avoid confusion or fetch all one time.
        // Simple fallback:
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

        // Optimistic Update
        const previousState = [...swapRequests];
        setSwapRequests(prev => prev.map(r => ids.includes(r.id) ? { ...r, status: status === 'approved' ? 'APPROVED' : 'REJECTED' } : r));

        try {
            if (status === 'approved') {
                await Promise.all(ids.map(id => swapsApi.approveSwapRequest(id)));
            } else {
                await Promise.all(ids.map(id => swapsApi.rejectSwapRequest(id, 'Manager Action')));
            }

            toast({
                title: 'Success',
                description: `Request(s) ${status} successfully`,
            });

            // Refresh data
            fetchData();
        } catch (error) {
            console.error('Failed to approve swap:', error);
            // Revert on error
            setSwapRequests(previousState);
            toast({
                title: 'Operation Failed',
                description: error instanceof Error ? error.message : 'Could not complete the action. Please try again.',
                variant: 'destructive',
            });
        }

        setSelectedIds(new Set());
        setActionConfirm(null);
    };

    const toggleSelection = (id: string) => {
        // ... existing toggle logic ...
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
        <div className="flex flex-col h-full bg-[#0a0f1e] min-h-screen">
            {/* Header */}
            <div className="sticky top-0 z-20 bg-[#0d1424]/98 backdrop-blur-md border-b border-white/10 p-4 sm:p-6">

                <ScopeFilterBanner
                    mode="managerial"
                    onScopeChange={setScope}
                    hidden={isGammaLocked}
                    multiSelect={true}
                    className="mb-4"
                />
                <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
                    <StatusFilterPills
                        activeStatus={statusFilter}
                        counts={statusCounts}
                        onStatusChange={setStatusFilter}
                    />
                    <Button variant="outline" size="sm" onClick={fetchData} className="text-white border-white/20">
                        Refresh
                    </Button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                {isLoading ? (
                    <div className="text-white/50 text-center py-20">Loading requests...</div>
                ) : filteredRequests.length === 0 ? (
                    <div className="text-center py-20 text-white/50">
                        <ArrowLeftRight className="h-12 w-12 mx-auto mb-4 opacity-30" />
                        <p>No {statusFilter} requests found</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {filteredRequests.map(request => (
                            <div key={request.id} className="bg-[#0d1424] rounded-xl border border-white/10 p-4">
                                <div className="flex flex-col lg:flex-row gap-4">
                                    <div className="flex items-center gap-4">
                                        {statusFilter === 'MANAGER_PENDING' && (
                                            <Checkbox
                                                checked={selectedIds.has(request.id)}
                                                onCheckedChange={() => toggleSelection(request.id)}
                                                className="border-white/30"
                                            />
                                        )}
                                        {/* State ID Badges (per skill_trades.md §2) */}
                                        <div className="flex flex-col gap-1">
                                            <Badge variant="outline" className="text-[10px] text-cyan-400/70 border-cyan-500/20 font-mono">
                                                {request.shiftStateId}
                                            </Badge>
                                            <Badge variant="outline" className="text-[10px] text-white/30 border-white/10 font-mono">
                                                {request.combinedStateId}
                                            </Badge>
                                        </div>

                                        <EmployeeShiftCard data={request.requestor} label="REQUESTER" />
                                        <SwapArrow
                                            hoursDiff={request.hoursDiff}
                                            payDiff={request.payDiff}
                                            compliance={request.compliancePassed}
                                        />
                                        <EmployeeShiftCard data={request.recipient} label="OFFERER" />
                                    </div>
                                    <div className="flex-1 border-l border-white/10 pl-4">
                                        <InfoPanel
                                            request={request}
                                            isPending={request.status === 'MANAGER_PENDING'}
                                            onApprove={() => handleAction([request.id], 'approved')}
                                            onReject={() => handleAction([request.id], 'rejected')}
                                        />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Footer Actions */}
            {
                selectedIds.size > 0 && (
                    <div className="sticky bottom-0 z-20 bg-[#1a1f2e] border-t border-white/10 p-4 shadow-lg flex justify-between items-center">
                        <div className="text-white text-sm">{selectedIds.size} selected</div>
                        <div className="flex gap-2">
                            <Button variant="destructive" size="sm" onClick={() => handleAction(Array.from(selectedIds), 'rejected')}>Reject Selected</Button>
                            <Button className="bg-green-600 hover:bg-green-700" size="sm" onClick={() => handleAction(Array.from(selectedIds), 'approved')}>Approve Selected</Button>
                        </div>
                    </div>
                )
            }

            {/* Confirmation Dialog */}
            {
                actionConfirm && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                        <div className="bg-[#1a1f2e] border border-white/10 p-6 rounded-xl max-w-md w-full">
                            <h3 className="text-xl font-bold text-white mb-2">Confirm {actionConfirm.status === 'approved' ? 'Approval' : 'Rejection'}</h3>
                            <p className="text-white/70 mb-6">Are you sure you want to {actionConfirm.status} {actionConfirm.ids.length} request(s)?</p>
                            <div className="flex justify-end gap-3">
                                <Button variant="outline" onClick={() => setActionConfirm(null)}>Cancel</Button>
                                <Button
                                    className={actionConfirm.status === 'approved' ? 'bg-green-600' : 'bg-red-600'}
                                    onClick={handleConfirmAction}
                                >
                                    Confirm
                                </Button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default ManagerSwapsPage;
