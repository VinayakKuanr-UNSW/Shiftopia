import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
    Dialog,
    DialogContent,
    DialogOverlay,
    DialogTitle,
    DialogDescription,
} from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import {
    Loader2,
    CheckCircle2,
    AlertTriangle,
    XCircle,
    Cpu,
    ShieldCheck,
    Zap,
    Users,
    AlertCircle,
    WifiOff,
    Calendar,
    Activity,
    Scale,
    GripHorizontal,
    X,
    Download,
} from 'lucide-react';
import { 
    PieChart, 
    Pie, 
    Cell, 
    ResponsiveContainer, 
    Tooltip as RechartsTooltip 
} from 'recharts';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { format } from 'date-fns';
import { cn } from '@/modules/core/lib/utils';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';
import {
    autoSchedulerController,
    AutoSchedulerInputTooLargeError,
    OptimizerError,
} from '@/modules/scheduling';
import type {
    AutoSchedulerResult,
    ValidatedProposal,
    OptimizerHealth,
    ShiftMeta,
    EmployeeMeta,
} from '@/modules/scheduling';
import { motion, AnimatePresence } from 'framer-motion';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/modules/core/ui/primitives/tooltip";

// =============================================================================
// TYPES & PROPS
// =============================================================================

interface AutoSchedulerModalProps {
    open: boolean;
    onClose: () => void;
    shifts: ShiftMeta[];
    employees: EmployeeMeta[];
    onComplete: () => void;
}

type PipelinePhase = 'idle' | 'optimizing' | 'validating' | 'reviewing' | 'done';
const LEVEL_COLORS: Record<string, string> = {
    'L0': '#64748b', // Slate
    'L1': '#3b82f6', // Blue
    'L2': '#10b981', // Emerald
    'L3': '#f59e0b', // Amber
    'L4': '#ef4444', // Red
    'L5': '#8b5cf6', // Violet
    'L6': '#ec4899', // Pink
    'L7': '#f97316', // Orange
    'default': '#94a3b8'
};

const ROLE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

const getRoleColor = (roleName: string) => {
    const match = roleName.match(/\(L([0-7])\)/i);
    if (match) return LEVEL_COLORS[`L${match[1].toUpperCase()}`] || LEVEL_COLORS.default;
    
    // Fallback for names without L pattern
    let hash = 0;
    for (let i = 0; i < roleName.length; i++) {
        hash = roleName.charCodeAt(i) + ((hash << 5) - hash);
    }
    return ROLE_COLORS[Math.abs(hash) % ROLE_COLORS.length];
};

// =============================================================================
// SUB-COMPONENTS (PREMIUM DESIGN)
// =============================================================================



// =============================================================================
// MAIN MODAL
// =============================================================================

export function AutoSchedulerModal({
    open,
    onClose,
    shifts,
    employees,
    onComplete,
}: AutoSchedulerModalProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [health, setHealth] = useState<OptimizerHealth | null>(null);
    const [phase, setPhase] = useState<PipelinePhase>('idle');
    const [result, setResult] = useState<AutoSchedulerResult | null>(null);
    const [isCommitting, setIsCommitting] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [elapsedTime, setElapsedTime] = useState(0);
    const runAbortRef = useRef<AbortController | null>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    const ESTIMATED_TOTAL_SECONDS = 30; // Matches solver timeout

    // Timer for "Estimated Time Left"
    useEffect(() => {
        if (phase === 'optimizing') {
            setElapsedTime(0);
            timerRef.current = setInterval(() => {
                setElapsedTime(prev => prev + 1);
            }, 1000);
        } else {
            if (timerRef.current) clearInterval(timerRef.current);
            timerRef.current = null;
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [phase]);


    // Date Range Selection
    const defaultStart = useMemo(() => shifts.length > 0 ? [...shifts].sort((a, b) => a.shift_date.localeCompare(b.shift_date))[0].shift_date : '', [shifts]);
    const defaultEnd = useMemo(() => shifts.length > 0 ? [...shifts].sort((a, b) => b.shift_date.localeCompare(a.shift_date))[0].shift_date : '', [shifts]);

    const [startDate, setStartDate] = useState(defaultStart);
    const [endDate, setEndDate] = useState(defaultEnd);

    // Strategy & Tuning state
    const [fatigueWeight, setFatigueWeight] = useState(50);
    const [fairnessWeight, setFairnessWeight] = useState(50);
    const [costWeight, setCostWeight] = useState(50);
    const [coverageWeight, setCoverageWeight] = useState(100);
    const [relaxConstraints, setRelaxConstraints] = useState(false);

    const filteredShifts = useMemo(() => {
        if (!startDate || !endDate) return shifts;
        return shifts.filter(s => s.shift_date >= startDate && s.shift_date <= endDate);
    }, [shifts, startDate, endDate]);

    const preRunCapacity = useMemo(() => {
        if (filteredShifts.length === 0 || employees.length === 0) return null;
        return autoSchedulerController.capacityCheck(filteredShifts, employees);
    }, [filteredShifts, employees]);

    useEffect(() => {
        if (!open) return;
        setHealth(null);
        autoSchedulerController.checkHealth().then(setHealth);
    }, [open]);

    const handleRun = useCallback(async () => {
        if (filteredShifts.length === 0) return;
        runAbortRef.current?.abort();
        const ac = new AbortController();
        runAbortRef.current = ac;

        setResult(null);
        setPhase('optimizing');

        try {
            const schedResult = await autoSchedulerController.run({
                shifts: filteredShifts,
                employees,
                signal: ac.signal,
                timeLimitSeconds: ESTIMATED_TOTAL_SECONDS,
                strategy: {
                    fatigue_weight: fatigueWeight,
                    fairness_weight: fairnessWeight,
                    cost_weight: costWeight,
                    coverage_weight: coverageWeight,
                },
                constraints: {
                    relax_constraints: relaxConstraints,
                    min_rest_minutes: 600,
                }
            });
            if (ac.signal.aborted) return;
            setPhase('reviewing');
            setResult(schedResult);
        } catch (err: any) {
            if (ac.signal.aborted || err?.name === 'AbortError') {
                console.debug('[AutoScheduler] Run aborted by user');
                return;
            }
            setPhase('idle');
            toast({
                title: err instanceof AutoSchedulerInputTooLargeError ? 'Too much to optimize' : 'Optimization Failed',
                description: err?.message ?? 'Unexpected error',
                variant: 'destructive',
            });
        } finally {
            if (runAbortRef.current === ac) runAbortRef.current = null;
        }
    }, [filteredShifts, employees, toast]);

    const handleCancel = useCallback(() => {
        if (runAbortRef.current) {
            runAbortRef.current.abort();
            runAbortRef.current = null;
        }
        setPhase('idle');
        setResult(null);
        toast({
            title: 'Operation Cancelled',
            description: 'The optimization process was stopped.',
        });
    }, [toast]);

    const handleCommit = useCallback(async () => {
        if (!result) return;
        setIsCommitting(true);

        try {
            const commitResult = await autoSchedulerController.commit(result);
            if (commitResult.success || commitResult.totalCommitted > 0) {
                setPhase('done');
                toast({
                    title: 'Shifts Assigned',
                    description: `Successfully assigned ${commitResult.totalCommitted} shift(s).`,
                });
                queryClient.invalidateQueries({ queryKey: [shiftKeys.all[0]] });
                onComplete();
                handleClose();
            } else {
                toast({
                    title: 'Commit Failed',
                    description: 'No shifts were committed. Check compliance results.',
                    variant: 'destructive',
                });
            }
        } catch (err: any) {
            toast({ title: 'Error', description: err?.message ?? 'Failed to commit', variant: 'destructive' });
        } finally {
            setIsCommitting(false);
        }
    }, [result, queryClient, toast, onComplete]);

    const handleClose = () => {
        runAbortRef.current?.abort();
        runAbortRef.current = null;
        setResult(null);
        setPhase('idle');
        onClose();
    };

    const handleDownloadAudit = useCallback(() => {
        if (!result || !result.uncoveredAudit) return;
        setIsDownloading(true);

        try {
            const csvEscape = (v: string | number) => {
                const s = String(v ?? '');
                return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
            };

            const totalUncovered = result.uncoveredV8ShiftIds.length;
            const audited = result.uncoveredAudit.length;

            const lines = [
                'AUTOSCHEDULER AUDIT REPORT',
                `Generated: ${new Date().toLocaleString()}`,
                `Status: ${result.optimizerStatus}`,
                `Total Passing: ${result.passing}`,
                `Total Failing: ${result.failing}`,
                `Uncovered: ${totalUncovered}`,
                `Audited: ${audited}${audited < totalUncovered ? ` (capped — ${totalUncovered - audited} not detailed below)` : ''}`,
                '',
            ];

            if (result.capacityCheck) {
                const cc = result.capacityCheck;
                lines.push('--- CAPACITY PRE-CHECK ---');
                lines.push(`Status: ${cc.sufficient ? 'SUFFICIENT' : 'INSUFFICIENT'}`);
                lines.push(`Total Demand (min): ${cc.totalDemandMinutes}`);
                lines.push(`Total Supply (min): ${cc.totalSupplyMinutes}`);
                lines.push('Date,Shifts,Employees,Demand (min),Supply (min),Deficit (min),Sufficient');
                for (const day of cc.perDay) {
                    lines.push([
                        day.date, day.shiftCount, day.employeeCount, day.demandMinutes,
                        day.supplyMinutes, day.deficitMinutes, day.sufficient ? 'YES' : 'NO'
                    ].map(csvEscape).join(','));
                }
                lines.push('');
            }

            lines.push('--- UNCOVERED SHIFT ANALYSIS ---');
            lines.push('Shift Date,Time,Rejection Summary');

            for (const audit of result.uncoveredAudit) {
                const summary = Object.entries(audit.rejectionSummary)
                    .map(([type, count]) => `${type}: ${count}`)
                    .join(' | ');
                lines.push([
                    audit.shiftDate, `${audit.startTime}-${audit.endTime}`, summary || 'No reasons recorded'
                ].map(csvEscape).join(','));
            }

            lines.push('', '--- EMPLOYEE REJECTION DETAILS ---');
            lines.push('Shift Date,Time,Employee,Status,Violations');

            for (const audit of result.uncoveredAudit) {
                for (const detail of audit.employeeDetails) {
                    const violations = detail.violations.map(v => v.description).join('; ');
                    lines.push([
                        audit.shiftDate, `${audit.startTime}-${audit.endTime}`,
                        detail.employeeName, detail.status, violations
                    ].map(csvEscape).join(','));
                }
            }

            const blob = new Blob(['\ufeff', lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.setAttribute('download', `Autoscheduler_Audit_Report_${new Date().toISOString().split('T')[0]}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Failed to generate report', err);
        } finally {
            setIsDownloading(false);
        }
    }, [result]);

    const { totals, employeeGroups } = useMemo(() => {
        if (!result) return { totals: { cost: 0, fatigue: 0, fairness: 0 }, employeeGroups: [] };
        
        const map = new Map<string, { name: string; proposals: ValidatedProposal[] }>();
        let totalCost = 0;
        let totalFatigue = 0;
        let totalUtilization = 0;
        let proposalCount = 0;

        for (const p of result.proposals) {
            if (!map.has(p.employeeId)) map.set(p.employeeId, { name: p.employeeName, proposals: [] });
            map.get(p.employeeId)!.proposals.push(p);
            totalCost += p.optimizerCost || 0;
            if (p.fatigueScore != null) {
                totalFatigue += p.fatigueScore;
                proposalCount++;
            }
            if (p.utilization != null) {
                totalUtilization += p.utilization;
            }
        }

        const groups = Array.from(map.entries()).map(([id, { name, proposals }]) => {
            const levelDist: Record<string, number> = {};
            proposals.forEach(p => {
                const match = p.roleName?.match(/\(L([0-7])\)/i);
                const level = match ? `L${match[1].toUpperCase()}` : 'Other';
                levelDist[level] = (levelDist[level] ?? 0) + 1;
            });

            // Sort by level name (L0, L1, ...)
            const sortedDist = Object.entries(levelDist)
                .map(([name, value]) => ({ name, value }))
                .sort((a, b) => a.name.localeCompare(b.name));

            return { 
                id, 
                name, 
                proposals,
                roleDistribution: sortedDist,
                totalCost: proposals.reduce((acc, p) => acc + (p.optimizerCost || 0), 0),
                avgFatigue: proposals.length > 0 ? proposals.reduce((acc, p) => acc + (p.fatigueScore || 0), 0) / proposals.length : 0,
                utilization: proposals[0]?.utilization || 0
            };
        });

        const aggregateFairness = groups.length > 0 
            ? groups.reduce((acc, g) => acc + g.utilization, 0) / groups.length 
            : 0;

        return {
            totals: {
                cost: totalCost,
                fatigue: proposalCount > 0 ? totalFatigue / proposalCount : 0,
                fairness: aggregateFairness
            },
            employeeGroups: groups
        };
    }, [result]);

    return (
        <Dialog open={open} onOpenChange={o => !o && handleClose()}>
            <DialogOverlay className="bg-slate-950/80 backdrop-blur-2xl" />
            <DialogContent className="max-w-[95vw] xl:max-w-[1400px] h-[min(900px,90vh)] p-0 overflow-hidden bg-[#070a0f] border-white/10 rounded-[2.5rem] shadow-[0_50px_100px_-20px_rgba(0,0,0,0.8)] text-white ring-1 ring-white/20 flex flex-row">
                
                {/* ── LEFT SIDEBAR: CONTROL & METRICS ─────────────────────────── */}
                <div className="w-[320px] flex-shrink-0 border-r border-white/5 bg-[#0f141f]/30 flex flex-col p-8 overflow-y-auto">
                    {/* Brand/Identity */}
                    <div className="flex items-center gap-3 mb-10">
                        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shadow-lg shadow-primary/20">
                            <Cpu className="h-5 w-5" strokeWidth={2} />
                        </div>
                        <div className="flex flex-col">
                            <DialogTitle className="text-lg font-black tracking-tight text-white leading-tight">Auto-Schedule</DialogTitle>
                            <DialogDescription className="sr-only">Evaluate and audit shift assignments generated by the V8 optimizer.</DialogDescription>
                            <div className="flex items-center gap-1.5 mt-0.5">
                                {!health ? (
                                    <span className="text-[8px] font-bold text-white/20 uppercase tracking-widest animate-pulse">Syncing...</span>
                                ) : health.available ? (
                                    <span className="text-[8px] font-bold text-emerald-500 uppercase tracking-widest flex items-center gap-1">
                                        <div className="h-1 w-1 rounded-full bg-emerald-500" /> V8.0 Active
                                    </span>
                                ) : (
                                    <span className="text-[8px] font-bold text-red-500 uppercase tracking-widest">Offline</span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Pipeline Progress (Vertical) */}
                    <div className="space-y-6 mb-12">
                        <div className="text-[9px] font-black uppercase tracking-[0.2em] text-white/20 mb-4">Pipeline Status</div>
                        {[
                            { id: 'optimizing', label: 'Optimization', icon: Cpu, active: phase === 'optimizing', done: ['validating', 'reviewing', 'done'].includes(phase) },
                            { id: 'validating', label: 'Compliance', icon: ShieldCheck, active: phase === 'validating', done: ['reviewing', 'done'].includes(phase) },
                            { id: 'reviewing',  label: 'Review & Audit', icon: Users, active: phase === 'reviewing', done: phase === 'done' },
                        ].map((step, idx, arr) => (
                            <div key={step.id} className="relative flex items-center gap-4">
                                {idx < arr.length - 1 && (
                                    <div className={cn("absolute left-4 top-8 w-px h-6 bg-white/5", step.done && "bg-emerald-500/20")} />
                                )}
                                <div className={cn(
                                    "h-8 w-8 rounded-lg flex items-center justify-center transition-all",
                                    step.done ? "bg-emerald-500/20 text-emerald-500" :
                                    step.active ? "bg-primary/20 text-primary animate-pulse ring-2 ring-primary/20" :
                                    "bg-white/5 text-white/20"
                                )}>
                                    {step.active ? <Loader2 className="h-4 w-4 animate-spin" /> : <step.icon className="h-4 w-4" />}
                                </div>
                                <span className={cn("text-[10px] font-bold uppercase tracking-widest", step.active ? "text-white" : "text-white/40")}>{step.label}</span>
                            </div>
                        ))}
                    </div>

                    <div className="space-y-6">
                        <div className="text-[9px] font-black uppercase tracking-[0.2em] text-white/20">Active Window</div>
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <Label className="text-[8px] font-black uppercase tracking-widest text-white/40 ml-1">Range Start</Label>
                                <Input 
                                    type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                                    className="h-10 bg-white/[0.02] border-white/5 rounded-xl text-xs font-bold focus:ring-primary/20"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-[8px] font-black uppercase tracking-widest text-white/40 ml-1">Range End</Label>
                                <Input 
                                    type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                                    className="h-10 bg-white/[0.02] border-white/5 rounded-xl text-xs font-bold focus:ring-primary/20"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Tuning Sidebar */}
                    <div className="space-y-6 mt-8">
                        <div className="text-[9px] font-black uppercase tracking-[0.2em] text-white/20">Optimization Strategy</div>
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <div className="flex justify-between items-center px-1">
                                    <Label className="text-[8px] font-black uppercase tracking-widest text-white/40">Fatigue Bias</Label>
                                    <span className="text-[10px] font-bold text-primary">{fatigueWeight}%</span>
                                </div>
                                <input 
                                    type="range" min="0" max="100" value={fatigueWeight} 
                                    onChange={e => setFatigueWeight(parseInt(e.target.value))}
                                    className="w-full h-1 bg-white/5 rounded-lg appearance-none cursor-pointer accent-primary"
                                />
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between items-center px-1">
                                    <Label className="text-[8px] font-black uppercase tracking-widest text-white/40">Fairness Bias</Label>
                                    <span className="text-[10px] font-bold text-primary">{fairnessWeight}%</span>
                                </div>
                                <input 
                                    type="range" min="0" max="100" value={fairnessWeight} 
                                    onChange={e => setFairnessWeight(parseInt(e.target.value))}
                                    className="w-full h-1 bg-white/5 rounded-lg appearance-none cursor-pointer accent-primary"
                                />
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between items-center px-1">
                                    <Label className="text-[8px] font-black uppercase tracking-widest text-white/40">Cost Sensitivity</Label>
                                    <span className="text-[10px] font-bold text-primary">{costWeight}%</span>
                                </div>
                                <input 
                                    type="range" min="0" max="100" value={costWeight} 
                                    onChange={e => setCostWeight(parseInt(e.target.value))}
                                    className="w-full h-1 bg-white/5 rounded-lg appearance-none cursor-pointer accent-primary"
                                />
                            </div>
                            
                            <div className="pt-4 flex items-center justify-between px-1">
                                <div className="flex flex-col gap-0.5">
                                    <Label className="text-[8px] font-black uppercase tracking-widest text-white/40">Relax Blockers</Label>
                                    <span className="text-[7px] text-white/20 uppercase font-bold">Soften Overlaps</span>
                                </div>
                                <button 
                                    onClick={() => setRelaxConstraints(!relaxConstraints)}
                                    className={cn(
                                        "h-5 w-9 rounded-full transition-all relative flex items-center px-1",
                                        relaxConstraints ? "bg-emerald-500" : "bg-white/10"
                                    )}
                                >
                                    <div className={cn(
                                        "h-3 w-3 rounded-full bg-white transition-all",
                                        relaxConstraints ? "ml-4" : "ml-0"
                                    )} />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Quick Metrics Section (Only visible after run) */}
                    {result && (
                        <div className="mt-auto pt-8 border-t border-white/5 space-y-4">
                            <div className="text-[9px] font-black uppercase tracking-[0.2em] text-white/20">Solution Health</div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10 flex flex-col">
                                    <span className="text-[8px] font-black text-emerald-500/60 uppercase">Passing</span>
                                    <span className="text-lg font-black text-emerald-400">{result.passing}</span>
                                </div>
                                <div className="p-3 rounded-xl bg-red-500/5 border border-red-500/10 flex flex-col">
                                    <span className="text-[8px] font-black text-red-500/60 uppercase">Failing</span>
                                    <span className="text-lg font-black text-red-400">{result.failing}</span>
                                </div>
                            </div>
                            <div className="p-3 rounded-xl bg-primary/5 border border-primary/10 flex items-center justify-between">
                                <div className="flex flex-col">
                                    <span className="text-[8px] font-black text-primary/60 uppercase">Fairness</span>
                                    <span className="text-lg font-black text-primary">{totals.fairness.toFixed(0)}%</span>
                                </div>
                                <Zap className="h-5 w-5 text-primary/30" />
                            </div>
                        </div>
                    )}
                </div>

                {/* ── RIGHT CANVAS: CONTENT & RESULTS ─────────────────────────── */}
                <div className="flex-1 flex flex-col bg-[#070a0f] relative overflow-hidden">
                    
                    {/* Toolbar / Actions Header */}
                    <div className="h-16 px-8 flex items-center justify-between border-b border-white/5 bg-white/[0.01]">
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/5">
                                <Calendar className="h-3 w-3 text-white/40" />
                                <span className="text-[10px] font-bold text-white/60 tracking-tight">
                                    {filteredShifts.length} Shifts · {employees.length} Staff
                                </span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {result && (
                                <Button onClick={handleDownloadAudit} variant="outline" className="h-8 gap-2 rounded-lg bg-white/5 border-white/10 text-white/60 hover:text-white hover:bg-white/10 transition-all">
                                    <Download className="h-3.5 w-3.5" />
                                    <span className="text-[10px] font-bold uppercase tracking-widest">Audit Report</span>
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* Scrollable Canvas Area */}
                    <ScrollArea className="flex-1">
                        <div className="p-8">
                            <AnimatePresence mode="wait">
                                {phase === 'idle' && (
                                    <motion.div 
                                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                                        className="max-w-3xl mx-auto space-y-8 py-12"
                                    >
                                        <div className="flex flex-col items-center text-center gap-4 mb-12">
                                            <div className="h-20 w-20 rounded-3xl bg-primary/10 flex items-center justify-center text-primary shadow-2xl shadow-primary/20 mb-4">
                                                <Cpu className="h-10 w-10" />
                                            </div>
                                            <h3 className="text-3xl font-black tracking-tight text-white">Ready to Optimize</h3>
                                            <p className="text-white/40 max-w-sm text-sm leading-relaxed">
                                                The CP-SAT solver will evaluate billions of combinations to find the highest-fairness, lowest-fatigue roster possible.
                                            </p>
                                        </div>

                                        {preRunCapacity && preRunCapacity.deficitDays.length > 0 ? (
                                            <div className="p-8 rounded-[2rem] bg-amber-500/10 border border-amber-500/20 space-y-4">
                                                <div className="flex items-center gap-3">
                                                    <AlertTriangle className="h-6 w-6 text-amber-500" />
                                                    <span className="text-lg font-black text-amber-400">Demand Warning</span>
                                                </div>
                                                <p className="text-sm text-white/60 leading-relaxed">
                                                    Detected capacity shortages on <span className="text-amber-400 font-bold">{preRunCapacity.deficitDays.length} days</span>. This means some shifts will remain uncovered regardless of assignment strategy.
                                                </p>
                                            </div>
                                        ) : (
                                            <div className="p-8 rounded-[2rem] bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-6">
                                                <div className="h-12 w-12 rounded-2xl bg-emerald-500/20 flex items-center justify-center text-emerald-500 flex-shrink-0">
                                                    <CheckCircle2 className="h-6 w-6" />
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-lg font-black text-emerald-400">Optimal Supply Found</span>
                                                    <span className="text-xs text-white/40">Total workforce minutes satisfy current shift demand.</span>
                                                </div>
                                            </div>
                                        )}
                                    </motion.div>
                                )}

                                {phase === 'optimizing' && (
                                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-24 flex flex-col items-center gap-8 max-w-xl mx-auto">
                                        <div className="relative">
                                            <div className="h-32 w-32 rounded-full border-2 border-primary/20 animate-ping absolute" />
                                            <div className="h-32 w-32 rounded-[2.5rem] bg-primary/10 flex items-center justify-center text-primary relative shadow-2xl shadow-primary/20">
                                                <Cpu className="h-12 w-12 animate-pulse" />
                                            </div>
                                        </div>
                                        <div className="text-center space-y-4 w-full">
                                            <div className="space-y-2">
                                                <p className="text-2xl font-black tracking-tight">Computing Optimal Set</p>
                                                <p className="text-sm text-white/40 font-mono tracking-widest uppercase">Solving Constraint Logic...</p>
                                            </div>
                                            
                                            {/* Progress Bar & Est. Time */}
                                            <div className="space-y-3 pt-4">
                                                <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden border border-white/5">
                                                    <motion.div 
                                                        className="h-full bg-primary shadow-[0_0_15px_rgba(59,130,246,0.5)]"
                                                        initial={{ width: 0 }}
                                                        animate={{ 
                                                            width: elapsedTime < ESTIMATED_TOTAL_SECONDS 
                                                                ? `${(elapsedTime / ESTIMATED_TOTAL_SECONDS) * 100}%` 
                                                                : "98%" 
                                                        }}
                                                        transition={{ duration: 1, ease: "linear" }}
                                                    />
                                                </div>
                                                <div className="flex justify-between items-center px-1">
                                                    <span className="text-[10px] font-bold text-white/20 uppercase tracking-widest">Elapsed: {elapsedTime}s</span>
                                                    <span className="text-[10px] font-black text-primary uppercase tracking-widest animate-pulse">
                                                        {elapsedTime < ESTIMATED_TOTAL_SECONDS 
                                                            ? `Est. ${ESTIMATED_TOTAL_SECONDS - elapsedTime}s Left`
                                                            : "Almost there... Wrapping up"}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </motion.div>
                                )}

                                {['reviewing', 'done'].includes(phase) && result && (
                                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-12">
                                        
                                        {/* Result Stats Grid (Visual Excellence) */}
                                        <div className="grid grid-cols-4 gap-4">
                                            <div className="p-6 rounded-[2rem] bg-white/[0.02] border border-white/5 flex flex-col gap-1 shadow-lg">
                                                <span className="text-[9px] font-black uppercase text-white/20 tracking-widest mb-1">Total Cost</span>
                                                <span className="text-3xl font-black text-blue-400 tracking-tighter">${totals.cost.toLocaleString('en-AU', { maximumFractionDigits: 0 })}</span>
                                            </div>
                                            <div className="p-6 rounded-[2rem] bg-white/[0.02] border border-white/5 flex flex-col gap-1 shadow-lg">
                                                <span className="text-[9px] font-black uppercase text-white/20 tracking-widest mb-1">Avg Fatigue</span>
                                                <span className="text-3xl font-black text-amber-400 tracking-tighter">{totals.fatigue.toFixed(1)}</span>
                                            </div>
                                            <div className="p-6 rounded-[2rem] bg-white/[0.02] border border-white/5 flex flex-col gap-1 shadow-lg">
                                                <span className="text-[9px] font-black uppercase text-white/20 tracking-widest mb-1">Uncovered</span>
                                                <span className="text-3xl font-black text-white/40 tracking-tighter">{result.uncoveredV8ShiftIds.length}</span>
                                            </div>
                                            <div className="p-6 rounded-[2rem] bg-white/[0.02] border border-white/5 flex flex-col gap-1 shadow-lg">
                                                <span className="text-[9px] font-black uppercase text-white/20 tracking-widest mb-1">Success Rate</span>
                                                <span className="text-3xl font-black text-emerald-400 tracking-tighter">{((result.passing / result.totalProposals) * 100 || 0).toFixed(0)}%</span>
                                            </div>
                                        </div>

                                        {/* Physical Capacity Alert (Explains uncovered shifts) */}
                                        {result.capacityCheck && !result.capacityCheck.sufficient && (
                                            <div className="p-8 rounded-[2.5rem] bg-amber-500/5 border border-amber-500/20 flex items-start gap-6 shadow-2xl">
                                                <div className="h-14 w-14 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0 mt-1">
                                                    <AlertTriangle className="h-8 w-8" />
                                                </div>
                                                <div className="flex flex-col gap-2">
                                                    <span className="text-xl font-black text-amber-400 tracking-tight uppercase">Labor Deficit Detected</span>
                                                    <p className="text-white/60 leading-relaxed text-sm">
                                                        Your workforce is short by <span className="text-amber-400 font-bold">{(result.capacityCheck.deficitDays.reduce((a, d) => a + d.deficitMinutes, 0) / 60).toFixed(0)} hours</span> for this period. 
                                                        Even with perfect optimization, <span className="text-white font-bold">{result.uncoveredV8ShiftIds.length} shifts</span> cannot be covered because there are physically more shift hours than staff hours available.
                                                    </p>
                                                    <div className="flex items-center gap-4 mt-2">
                                                        <div className="flex flex-col">
                                                            <span className="text-[8px] font-black uppercase text-white/30 tracking-widest">Total Demand</span>
                                                            <span className="text-xs font-bold">{(result.capacityCheck.totalDemandMinutes / 60).toFixed(0)}h</span>
                                                        </div>
                                                        <div className="h-4 w-px bg-white/5" />
                                                        <div className="flex flex-col">
                                                            <span className="text-[8px] font-black uppercase text-white/30 tracking-widest">Total Supply</span>
                                                            <span className="text-xs font-bold">{(result.capacityCheck.totalSupplyMinutes / 60).toFixed(0)}h</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Employee Results Cards */}
                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                            {employeeGroups.map(group => (
                                                <div key={group.id} className="group p-6 rounded-[2.5rem] bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] hover:border-primary/40 transition-all duration-500 shadow-xl">
                                                    <div className="flex items-center justify-between mb-8">
                                                        <div className="flex items-center gap-4">
                                                            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-white/10 to-white/5 border border-white/10 flex items-center justify-center font-black text-sm uppercase text-primary">
                                                                {group.name.split(' ').map(n => n[0]).join('')}
                                                            </div>
                                                            <div className="flex flex-col">
                                                                <span className="text-lg font-black tracking-tight">{group.name}</span>
                                                                <div className="flex items-center gap-2 mt-1">
                                                                    <Badge className="bg-emerald-500/10 text-emerald-400 text-[8px] font-black uppercase tracking-widest border-none">UTIL {group.utilization.toFixed(0)}%</Badge>
                                                                    <Badge className="bg-white/5 text-white/30 text-[8px] font-black uppercase tracking-widest border-none">{group.proposals.length} SHIFTS</Badge>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="text-right">
                                                            <div className="text-xl font-black tracking-tight text-white/80">${group.totalCost.toLocaleString('en-AU')}</div>
                                                            <div className="text-[9px] font-black uppercase text-white/20 tracking-widest">Est. Cost</div>
                                                        </div>
                                                    </div>

                                                    {/* Role Distribution Chart (Improved Layout) */}
                                                    <div className="flex items-center gap-10 mb-8 p-8 rounded-[2.5rem] bg-black/40 border border-white/5 shadow-inner">
                                                        <div className="h-40 w-40 shrink-0 relative">
                                                            <ResponsiveContainer width="100%" height="100%">
                                                                <PieChart>
                                                                    <Pie
                                                                        data={group.roleDistribution}
                                                                        innerRadius={45}
                                                                        outerRadius={65}
                                                                        paddingAngle={4}
                                                                        dataKey="value"
                                                                        stroke="rgba(255,255,255,0.05)"
                                                                        strokeWidth={1}
                                                                    >
                                                                        {group.roleDistribution.map((entry, index) => (
                                                                            <Cell key={`cell-${index}`} fill={LEVEL_COLORS[entry.name] || LEVEL_COLORS.default} />
                                                                        ))}
                                                                    </Pie>
                                                                    <RechartsTooltip 
                                                                        contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '12px', fontSize: '10px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)' }}
                                                                        itemStyle={{ color: '#fff', fontWeight: 'bold' }}
                                                                        cursor={{ fill: 'rgba(255,255,255,0.1)' }}
                                                                    />
                                                                </PieChart>
                                                            </ResponsiveContainer>
                                                            {/* Center Stat */}
                                                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                                                <span className="text-[10px] font-black text-white/20 uppercase tracking-widest leading-none">Total</span>
                                                                <span className="text-sm font-black text-white/80">{group.proposals.length}</span>
                                                            </div>
                                                        </div>
                                                        <div className="flex-1 flex flex-col gap-2 max-h-32 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-white/10">
                                                            {group.roleDistribution.map((rd, idx) => (
                                                                <div key={rd.name} className="flex items-center justify-between group/item py-0.5">
                                                                    <div className="flex items-center gap-2.5">
                                                                        <div className="h-2 w-2 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)]" style={{ backgroundColor: LEVEL_COLORS[rd.name] || LEVEL_COLORS.default }} />
                                                                        <span className="text-[11px] font-bold text-white/60 group-hover/item:text-white transition-colors truncate max-w-[120px]">{rd.name}</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-[10px] font-black text-white/40">{rd.value}</span>
                                                                        <span className="text-[8px] font-medium text-white/10">({((rd.value / group.proposals.length) * 100).toFixed(0)}%)</span>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    <div className="space-y-3">
                                                        {group.proposals.map(p => (
                                                            <div key={p.shiftId} className="flex flex-col p-3 rounded-2xl bg-black/20 border border-white/5 gap-2">
                                                                <div className="flex items-center justify-between">
                                                                    <div className="flex items-center gap-3">
                                                                        <div className={cn(
                                                                            "h-6 w-6 rounded-lg flex items-center justify-center",
                                                                            p.complianceStatus === 'PASS' ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                                                                        )}>
                                                                            {p.complianceStatus === 'PASS' ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                                                                        </div>
                                                                        <div className="flex flex-col">
                                                                            <div className="flex items-center gap-2">
                                                                                <span className="text-[8px] font-black uppercase text-white/30 tracking-widest">{format(new Date(p.shiftDate), 'EEE dd MMM')}</span>
                                                                                {p.roleName && <Badge variant="outline" className="h-3.5 px-1.5 text-[7px] border-white/5 bg-white/5 text-white/40 uppercase font-black">{p.roleName}</Badge>}
                                                                            </div>
                                                                            <span className="text-xs font-bold">{p.startTime} – {p.endTime}</span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                {p.violations.length > 0 && (
                                                                    <div className="px-2 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 space-y-1">
                                                                        {p.violations.map((v, i) => (
                                                                            <div key={i} className="flex items-start gap-2 text-[10px] text-red-400/80 leading-tight">
                                                                                <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                                                                                <span>{v.description}</span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}

                                            {/* Coverage Gaps Card */}
                                            {result.uncoveredAudit && result.uncoveredAudit.length > 0 && (
                                                <div className="p-6 rounded-[2.5rem] bg-amber-500/5 border border-amber-500/10 shadow-xl">
                                                    <div className="flex items-center gap-4 mb-8">
                                                        <div className="h-12 w-12 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500">
                                                            <AlertTriangle className="h-6 w-6" />
                                                        </div>
                                                        <div className="flex flex-col">
                                                            <span className="text-lg font-black tracking-tight text-amber-400">Coverage Gaps</span>
                                                            <span className="text-[8px] font-black uppercase text-amber-500/40 tracking-widest">{result.uncoveredV8ShiftIds.length} Unstaffed Shifts</span>
                                                        </div>
                                                    </div>
                                                    
                                                    <div className="space-y-4">
                                                        {result.uncoveredAudit.slice(0, 5).map(audit => (
                                                            <div key={audit.shiftId} className="p-4 rounded-2xl bg-black/20 border border-white/5 space-y-3">
                                                                <div className="flex items-center justify-between">
                                                                    <div className="flex flex-col">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="text-[8px] font-black uppercase text-white/30 tracking-widest">{format(new Date(audit.shiftDate), 'EEE dd MMM')}</span>
                                                                            {audit.roleName && <Badge variant="outline" className="h-3.5 px-1.5 text-[7px] border-white/5 bg-white/5 text-white/40 uppercase font-black">{audit.roleName}</Badge>}
                                                                        </div>
                                                                        <span className="text-xs font-bold">{audit.startTime} – {audit.endTime}</span>
                                                                    </div>
                                                                    <Badge variant="outline" className="text-[8px] border-amber-500/20 text-amber-400">UNRESOLVED</Badge>
                                                                </div>
                                                                <div className="pt-2 border-t border-white/5">
                                                                    <p className="text-[9px] font-black uppercase text-white/20 mb-2 tracking-widest">Primary Blockers</p>
                                                                    <div className="flex flex-wrap gap-1.5">
                                                                        {Object.entries(audit.rejectionSummary).map(([reason, count]) => (
                                                                            <TooltipProvider key={reason}>
                                                                                <Tooltip>
                                                                                    <TooltipTrigger asChild>
                                                                                        <div className="px-2 py-1 rounded-md bg-white/5 text-[9px] text-white/60 border border-white/5 cursor-help hover:bg-white/10 transition-colors">
                                                                                            {reason}: {count} staff
                                                                                        </div>
                                                                                    </TooltipTrigger>
                                                                                    <TooltipContent className="bg-zinc-900 border-white/10 p-3 max-w-xs shadow-2xl">
                                                                                        <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1">{reason}</p>
                                                                                        <p className="text-[11px] text-white/80 leading-relaxed">
                                                                                            {reason === 'CAPACITY_CONFLICT' 
                                                                                                ? "The optimizer assigned this staff member to a different shift at the same time to maximize overall roster efficiency."
                                                                                                : reason === 'OPTIMIZER_TRADEOFF'
                                                                                                ? "The solver prioritized other shifts to satisfy complex labor rules or cost targets."
                                                                                                : "Multiple staff were rejected due to compliance rules (rest gaps, weekly hours, or role mismatch)."}
                                                                                        </p>
                                                                                    </TooltipContent>
                                                                                </Tooltip>
                                                                            </TooltipProvider>
                                                                        ))}
                                                                        {Object.keys(audit.rejectionSummary).length === 0 && (
                                                                            <span className="text-[10px] text-white/20 italic">No specific reasons provided by solver</span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                        {result.uncoveredV8ShiftIds.length > 5 && (
                                                            <p className="text-center text-[9px] font-black uppercase text-white/20 tracking-widest py-2">
                                                                + {result.uncoveredV8ShiftIds.length - 5} more gaps (See full audit CSV)
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </ScrollArea>

                    {/* ACTION DECK: FLOATING FOOTER */}
                    <div className="p-8 flex justify-center bg-gradient-to-t from-[#070a0f] to-transparent pt-12">
                        <div className="bg-[#0f141f]/80 backdrop-blur-2xl rounded-full p-2 border border-white/10 flex items-center gap-2 shadow-2xl shadow-black/80 ring-1 ring-white/10">
                            {phase === 'idle' && (
                                <Button 
                                    onClick={handleRun}
                                    disabled={!health?.available || filteredShifts.length === 0}
                                    className="rounded-full px-10 h-14 bg-primary hover:bg-primary/90 text-white font-black uppercase tracking-widest text-[10px] gap-3 shadow-lg shadow-primary/30 group"
                                >
                                    <Zap className="h-4 w-4 fill-current group-hover:scale-125 transition-transform" />
                                    Compute Optimal Solution
                                </Button>
                            )}
                            {phase === 'optimizing' && (
                                <Button 
                                    onClick={handleCancel}
                                    variant="destructive"
                                    className="rounded-full px-10 h-14 bg-red-500/20 hover:bg-red-500/30 text-red-500 border border-red-500/20 font-black uppercase tracking-widest text-[10px] gap-3 shadow-lg shadow-red-500/10 group"
                                >
                                    <XCircle className="h-4 w-4" />
                                    Cancel Optimization
                                </Button>
                            )}
                            {['reviewing', 'done'].includes(phase) && (
                                <>
                                    <Button 
                                        onClick={handleRun}
                                        variant="ghost"
                                        className="rounded-full h-14 px-6 text-white/40 hover:text-white hover:bg-white/5 font-black uppercase tracking-widest text-[10px]"
                                    >
                                        Re-Optimise
                                    </Button>
                                    <Button 
                                        onClick={handleCommit}
                                        disabled={isCommitting || result?.passing === 0}
                                        className="rounded-full px-10 h-14 bg-emerald-500 hover:bg-emerald-600 text-white font-black uppercase tracking-widest text-[10px] gap-3 shadow-lg shadow-emerald-500/30"
                                    >
                                        {isCommitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                                        Apply {result?.passing} Assignments
                                    </Button>
                                </>
                            )}
                            {phase !== 'idle' && phase !== 'done' && (
                                <Button 
                                    onClick={handleClose}
                                    variant="ghost"
                                    className="rounded-full h-14 px-6 text-white/40 hover:text-white hover:bg-white/5 font-black uppercase tracking-widest text-[10px]"
                                >
                                    Cancel
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

const RefreshCw = ({ className }: { className?: string }) => (
    <svg 
        xmlns="http://www.w3.org/2000/svg" 
        width="24" 
        height="24" 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke="currentColor" 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round" 
        className={className}
    >
        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
        <path d="M3 21v-5h5" />
    </svg>
);
