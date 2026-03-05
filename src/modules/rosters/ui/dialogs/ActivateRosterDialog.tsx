import React, { useMemo } from 'react';
import { format, eachDayOfInterval, isSameDay, startOfDay } from 'date-fns';
import { getSydneyToday } from '@/modules/core/lib/date.utils';
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

        const today = getSydneyToday();
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

        // Calculate the effective range from the days we actually want to inject
        // This ensures we don't accidentally ask the backend to create rosters for filtered-out past dates
        // just because they fall within the selected view range.
        const sortedInjectDates = [...daysToInject].sort((a, b) => a.getTime() - b.getTime());
        const effectiveStartDate = sortedInjectDates[0];
        const effectiveEndDate = sortedInjectDates[sortedInjectDates.length - 1];

        try {
            await activateMutation.mutateAsync({
                organizationId,
                departmentId,
                subDepartmentId: subDepartmentId || null,
                startDate: format(effectiveStartDate, 'yyyy-MM-dd'),
                endDate: format(effectiveEndDate, 'yyyy-MM-dd'),
            });
            onOpenChange(false);
        } catch (err) {
            // Error handled by mutation toast
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[550px] bg-background border-border text-foreground shadow-2xl p-0 overflow-hidden ring-1 ring-border rounded-[2rem]">
                <div className="p-0 overflow-y-auto max-h-[85vh] custom-scrollbar">
                    {/* Premium Header */}
                    <div className="p-8 pb-6 space-y-4 bg-muted/30 border-b border-border">
                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <DialogTitle className="text-2xl font-black tracking-tighter">
                                    Activate Roster
                                </DialogTitle>
                                <DialogDescription className="text-xs font-medium text-muted-foreground/70">
                                    Initialize monthly shift boundaries and capacity.
                                </DialogDescription>
                            </div>
                            <div className="px-4 py-2 rounded-2xl bg-primary/10 border border-primary/20 flex flex-col items-center">
                                <span className="text-[10px] font-black uppercase tracking-widest text-primary/60 leading-none mb-1">Target Period</span>
                                <span className="text-sm font-bold text-primary">
                                    {format(startDate, 'MMMM yyyy')}
                                </span>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 p-3 rounded-xl bg-background/50 border border-border/50 text-xs font-bold text-muted-foreground shadow-sm">
                            <span className="opacity-60">{orgName}</span>
                            <ChevronRight className="h-3 w-3 opacity-30" />
                            <span className="opacity-60">{deptName}</span>
                            {subDeptName && (
                                <>
                                    <ChevronRight className="h-3 w-3 opacity-30" />
                                    <span className="text-primary/80">{subDeptName}</span>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="p-8 pt-6 space-y-8">

                        {isErrorChecks ? (
                            <div className="flex flex-col items-center justify-center py-12 space-y-4 px-6 text-center">
                                <AlertCircle className="h-10 w-10 text-red-500/80" />
                                <div className="space-y-1">
                                    <p className="text-sm font-semibold">Failed to fetch roster status</p>
                                    <p className="text-[11px] text-muted-foreground">{(checkError as any)?.message || 'An unexpected error occurred while checking existing rosters.'}</p>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => window.location.reload()}
                                    className="mt-2 border-border hover:bg-muted"
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
                                <p className="text-sm font-medium text-muted-foreground animate-pulse">Scanning month boundaries...</p>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {/* Summary Cards */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-5 rounded-[1.5rem] bg-card border border-border space-y-4 shadow-sm relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity">
                                            <Hash className="h-10 w-10" />
                                        </div>
                                        <div className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]">
                                            Capacity
                                        </div>
                                        <div className="space-y-3">
                                            <div className="flex justify-between items-center">
                                                <span className="text-xs font-semibold text-muted-foreground/60">Total Horizon</span>
                                                <span className="text-lg font-bold">{allDates.length}d</span>
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <span className="text-xs font-semibold text-emerald-500/70">Currently Active</span>
                                                <Badge variant="outline" className="bg-emerald-500/10 border-emerald-500/20 text-emerald-600 font-mono">
                                                    {daysActive.length}d
                                                </Badge>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="p-5 rounded-[1.5rem] bg-card border border-border space-y-4 shadow-sm relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity">
                                            <AlertCircle className="h-10 w-10" />
                                        </div>
                                        <div className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]">
                                            Distribution
                                        </div>
                                        <div className="space-y-3">
                                            <div className="flex justify-between items-center">
                                                <span className="text-xs font-semibold text-amber-500/70">To Initialize</span>
                                                <Badge variant="outline" className="bg-amber-500/10 border-amber-500/20 text-amber-600 font-mono">
                                                    {daysToInject.length}d
                                                </Badge>
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <span className="text-xs font-semibold text-muted-foreground/60">Past Bound</span>
                                                <span className="text-lg font-bold text-muted-foreground">{daysToSkip.length}d</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Formal Calendar Grid Visualization */}
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between px-1">
                                        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/80">Visual Mapping</h4>
                                        <div className="flex items-center gap-4">
                                            <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-emerald-600/80">
                                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                                Active
                                            </div>
                                            <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-primary/80">
                                                <div className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(var(--primary),0.5)]" />
                                                Inject
                                            </div>
                                            <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-muted-foreground/40">
                                                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
                                                Skip
                                            </div>
                                        </div>
                                    </div>

                                    <div className="p-6 rounded-[2rem] bg-muted/40 border border-border shadow-inner">
                                        {/* Calendar Headers */}
                                        <div className="grid grid-cols-7 mb-4 border-b border-border/50 pb-3">
                                            {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((day, i) => (
                                                <div key={i} className="text-center text-[9px] font-black text-muted-foreground/50 tracking-widest">
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
                                                            "aspect-square rounded-2xl flex flex-col items-center justify-center transition-all duration-300 relative group border",
                                                            isActive && "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 shadow-[0_0_15px_-5px_rgba(16,185,129,0.1)]",
                                                            isToInject && "bg-primary text-primary-foreground shadow-[0_10px_20px_-5px_rgba(var(--primary),0.3)] scale-110 z-10 border-primary",
                                                            isSkipped && "bg-muted/10 text-muted-foreground/30 border-border/50 opacity-40 cursor-not-allowed"
                                                        )}
                                                        title={format(date, 'EEEE, MMM d, yyyy')}
                                                    >
                                                        <span className={cn(
                                                            "text-[10px] font-black leading-none",
                                                            isActive ? "text-emerald-700" : isToInject ? "text-primary-foreground" : isSkipped ? "text-muted-foreground/30" : "text-foreground"
                                                        )}>
                                                            {format(date, 'd')}
                                                        </span>

                                                        {/* Tooltip hint on hover */}
                                                        <div className="absolute -top-10 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-popover text-popover-foreground text-[10px] font-black uppercase tracking-widest rounded-xl opacity-0 group-hover:opacity-100 transition-all scale-95 group-hover:scale-100 pointer-events-none z-50 shadow-2xl border border-border">
                                                            {isActive ? 'Active' : isToInject ? 'Inject' : 'Skip'}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>

                                {daysToSkip.length > 0 && (
                                    <div className="flex items-start gap-3 p-4 rounded-2xl bg-red-500/5 border border-red-500/10 shadow-sm">
                                        <div className="p-1.5 rounded-lg bg-red-500/10">
                                            <Ban className="h-3.5 w-3.5 text-red-500/50" />
                                        </div>
                                        <p className="text-[11px] text-muted-foreground/80 leading-relaxed font-bold">
                                            <span className="text-red-500 uppercase tracking-tighter mr-2">Policy:</span> {daysToSkip.length} dates are in the past and cannot be initialized. They will remain as placeholders in the monthly plan.
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <DialogFooter className="bg-muted/30 border-t border-border p-6 gap-3 sm:gap-0">
                        <Button
                            variant="ghost"
                            onClick={() => onOpenChange(false)}
                            className="h-12 px-6 rounded-xl text-xs font-black uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                        >
                            Cancel
                        </Button>
                        {!isLoadingChecks && daysToInject.length > 0 && (
                            <Button
                                onClick={handleActivate}
                                disabled={activateMutation.isPending}
                                className="h-12 px-8 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 font-black text-xs uppercase tracking-[0.2em] transition-all active:scale-95"
                            >
                                {activateMutation.isPending ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin text-white" />
                                ) : (
                                    <Zap className="mr-2 h-4 w-4 fill-current text-primary-foreground" />
                                )}
                                Initialize {daysToInject.length} Periods
                            </Button>
                        )}
                        {!isLoadingChecks && daysToInject.length === 0 && (
                            <Button
                                disabled
                                className="h-12 px-8 rounded-xl bg-muted text-muted-foreground/50 border border-border font-black text-xs uppercase tracking-widest"
                            >
                                No Active Dates to Initialize
                            </Button>
                        )}
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default ActivateRosterDialog;
