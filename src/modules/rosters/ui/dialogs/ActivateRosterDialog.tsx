import React, { useMemo } from 'react';
import { format, eachDayOfInterval, isSameDay, startOfDay } from 'date-fns';
import { Button } from '@/modules/core/ui/primitives/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/modules/core/ui/primitives/dialog';
import {
    useRostersLookup,
    useOrganizations,
    useDepartments,
    useSubDepartments
} from '@/modules/rosters/state/useRosterShifts';
import { useActivateRoster } from '@/modules/rosters/state/useRosterMutations';
import { Loader2, AlertCircle, CheckCircle2, ChevronRight, Hash, Clock, Ban, Zap } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { Badge } from '@/modules/core/ui/primitives/badge';

interface ActivateRosterDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    organizationId: string;
    departmentId: string;
    subDepartmentId?: string | null;
    startDate: Date;
    endDate: Date;
}

export const ActivateRosterDialog: React.FC<ActivateRosterDialogProps> = ({
    open,
    onOpenChange,
    organizationId,
    departmentId,
    subDepartmentId,
    startDate,
    endDate,
}) => {
    // 1. Data Lookups for breadcrumbs
    const { data: organizations = [] } = useOrganizations();
    const { data: departments = [] } = useDepartments(organizationId);
    const { data: subDepartments = [] } = useSubDepartments(departmentId);

    const orgName = organizations.find(o => o.id === organizationId)?.name || '...';
    const deptName = departments.find(d => d.id === departmentId)?.name || '...';
    const subDeptName = subDepartmentId ? subDepartments.find(s => s.id === subDepartmentId)?.name : null;

    // 2. Roster Lookup
    const {
        data: existingRosters = [],
        isLoading: isLoadingChecks,
        isError: isErrorChecks,
        error: checkError
    } = useRostersLookup(
        organizationId,
        {
            departmentIds: [departmentId],
            subDepartmentIds: subDepartmentId ? [subDepartmentId] : [],
        }
    );

    const activateMutation = useActivateRoster();

    // 3. Logic: Categorize Dates
    const { daysActive, daysToInject, daysToSkip, allDates } = useMemo(() => {
        if (isLoadingChecks) return { daysActive: [], daysToInject: [], daysToSkip: [], allDates: [] };

        const today = startOfDay(new Date());
        const totalDates = eachDayOfInterval({ start: startDate, end: endDate });

        const active: Date[] = [];
        const toInject: Date[] = [];
        const toSkip: Date[] = [];

        totalDates.forEach(date => {
            const dateStr = format(date, 'yyyy-MM-dd');
            const exists = existingRosters.some((r: any) => r.start_date === dateStr);

            if (exists) {
                active.push(date);
            } else {
                if (date < today) {
                    toSkip.push(date); // Past dates cannot be injected
                } else {
                    toInject.push(date);
                }
            }
        });

        return { daysActive: active, daysToInject: toInject, daysToSkip: toSkip, allDates: totalDates };
    }, [startDate, endDate, existingRosters, isLoadingChecks]);

    const handleActivate = async () => {
        if (daysToInject.length === 0) return;
        try {
            await activateMutation.mutateAsync({
                organizationId,
                departmentId,
                subDepartmentId: subDepartmentId || null,
                startDate: format(startDate, 'yyyy-MM-dd'),
                endDate: format(endDate, 'yyyy-MM-dd'),
            });
            onOpenChange(false);
        } catch (err) {
            // Error handled by mutation toast
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[550px] bg-[#0c1015]/95 backdrop-blur-2xl border-white/10 text-white shadow-2xl p-0 overflow-hidden ring-1 ring-white/10">
                <div className="p-6 space-y-6">
                    <DialogHeader className="space-y-3">
                        <div className="flex items-center justify-between">
                            <DialogTitle className="text-xl font-semibold tracking-tight">
                                Activate Monthly Roster
                            </DialogTitle>
                            <Badge variant="outline" className="bg-primary/10 border-primary/20 text-primary px-2 font-mono">
                                {format(startDate, 'MMMM yyyy')}
                            </Badge>
                        </div>

                        <div className="flex items-center gap-2 text-sm text-gray-400 font-medium">
                            <span className="text-gray-300">{orgName}</span>
                            <ChevronRight className="h-3.5 w-3.5 text-gray-600" />
                            <span className="text-gray-300">{deptName}</span>
                            {subDeptName && (
                                <>
                                    <ChevronRight className="h-3.5 w-3.5 text-gray-600" />
                                    <span className="text-primary/80">{subDeptName}</span>
                                </>
                            )}
                        </div>
                    </DialogHeader>

                    {isErrorChecks ? (
                        <div className="flex flex-col items-center justify-center py-12 space-y-4 px-6 text-center">
                            <AlertCircle className="h-10 w-10 text-red-500/80" />
                            <div className="space-y-1">
                                <p className="text-sm font-semibold text-white">Failed to fetch roster status</p>
                                <p className="text-[11px] text-gray-400">{(checkError as any)?.message || 'An unexpected error occurred while checking existing rosters.'}</p>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => window.location.reload()}
                                className="mt-2 border-white/10 hover:bg-white/5"
                            >
                                Retry Connection
                            </Button>
                        </div>
                    ) : isLoadingChecks ? (
                        <div className="flex flex-col items-center justify-center py-12 space-y-4">
                            <div className="relative">
                                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                                <div className="absolute inset-0 blur-xl bg-primary/20 scale-150 animate-pulse" />
                            </div>
                            <p className="text-sm font-medium text-gray-400 animate-pulse">Scanning month boundaries...</p>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {/* Summary Cards */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/5 space-y-2">
                                    <div className="flex items-center justify-between text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        <span>Capacity</span>
                                        <Hash className="h-3.5 w-3.5" />
                                    </div>
                                    <div className="space-y-1">
                                        <div className="flex justify-between items-baseline">
                                            <span className="text-sm text-gray-400">Total Days</span>
                                            <span className="text-xl font-semibold">{allDates.length}</span>
                                        </div>
                                        <div className="flex justify-between items-baseline">
                                            <span className="text-sm text-emerald-400/80">Days Active</span>
                                            <span className="text-xl font-semibold text-emerald-400 font-mono">{daysActive.length}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/5 space-y-2">
                                    <div className="flex items-center justify-between text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        <span>Missing Data</span>
                                        <AlertCircle className="h-3.5 w-3.5" />
                                    </div>
                                    <div className="space-y-1">
                                        <div className="flex justify-between items-baseline">
                                            <span className="text-sm text-amber-400/80">To Inject</span>
                                            <span className="text-xl font-semibold text-amber-400 font-mono">{daysToInject.length}</span>
                                        </div>
                                        <div className="flex justify-between items-baseline">
                                            <span className="text-sm text-gray-500">To Skip (Past)</span>
                                            <span className="text-xl font-semibold text-gray-500 font-mono">{daysToSkip.length}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Formal Calendar Grid Visualization */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between px-1 text-[10px] uppercase font-bold tracking-widest text-gray-500">
                                    <h4>Monthly Roster Coverage</h4>
                                    <div className="flex items-center gap-3 tracking-tighter">
                                        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500" /> Active</div>
                                        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-primary shadow-glow-sm" /> To Inject</div>
                                        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-gray-700" /> Skipped</div>
                                    </div>
                                </div>

                                <div className="p-4 rounded-2xl bg-black/40 border border-white/5 ring-1 ring-inset ring-white/5">
                                    {/* Calendar Headers */}
                                    <div className="grid grid-cols-7 mb-2 border-b border-white/5 pb-2">
                                        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, i) => (
                                            <div key={i} className="text-center text-[10px] font-bold text-gray-600">
                                                {day}
                                            </div>
                                        ))}
                                    </div>

                                    <div className="grid grid-cols-7 gap-y-3 gap-x-2">
                                        {/* Padding for first week alignment (Mon start) */}
                                        {Array.from({ length: (startDate.getDay() + 6) % 7 }).map((_, i) => (
                                            <div key={`pad-${i}`} className="aspect-square" />
                                        ))}

                                        {allDates.map((date, i) => {
                                            const isActive = daysActive.some(d => isSameDay(d, date));
                                            const isToInject = daysToInject.some(d => isSameDay(d, date));
                                            const isSkipped = daysToSkip.some(d => isSameDay(d, date));

                                            return (
                                                <div
                                                    key={i}
                                                    className={cn(
                                                        "aspect-square rounded-full flex flex-col items-center justify-center transition-all duration-300 relative group",
                                                        isActive && "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
                                                        isToInject && "bg-primary text-white shadow-glow-sm scale-110 z-10",
                                                        isSkipped && "bg-gray-800/30 text-gray-600 border border-white/5 opacity-40 cursor-not-allowed"
                                                    )}
                                                    title={format(date, 'EEEE, MMM d, yyyy')}
                                                >
                                                    <span className="text-[10px] font-bold leading-none">{format(date, 'd')}</span>

                                                    {/* Tooltip hint on hover */}
                                                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-800 text-white text-[9px] rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 shadow-xl border border-white/10">
                                                        {isActive ? 'Active' : isToInject ? 'Injecting' : 'Skipped'}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>

                            {daysToSkip.length > 0 && (
                                <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/5 border border-red-500/10">
                                    <Ban className="h-4 w-4 text-red-500/50 mt-0.5 flex-shrink-0" />
                                    <p className="text-[11px] text-gray-400 leading-relaxed font-medium">
                                        <span className="text-red-400/80">Validation Rule:</span> {daysToSkip.length} dates are in the past and cannot be injected. They will remain as placeholders.
                                    </p>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <DialogFooter className="bg-white/[0.02] border-t border-white/5 p-4 py-3 gap-2 sm:gap-0">
                    <Button
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        className="text-gray-400 hover:text-white hover:bg-white/5 border border-transparent hover:border-white/10"
                    >
                        Cancel
                    </Button>
                    {!isLoadingChecks && daysToInject.length > 0 && (
                        <Button
                            onClick={handleActivate}
                            disabled={activateMutation.isPending}
                            className="bg-primary hover:bg-primary/90 text-white shadow-glow font-semibold px-6"
                        >
                            {activateMutation.isPending ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Zap className="mr-2 h-4 w-4 fill-current text-white/50" />
                            )}
                            Inject {daysToInject.length} Roster Days
                        </Button>
                    )}
                    {!isLoadingChecks && daysToInject.length === 0 && (
                        <Button
                            disabled
                            className="bg-gray-800 text-gray-500 border border-white/5 px-6"
                        >
                            No Active Dates to Inject
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default ActivateRosterDialog;
