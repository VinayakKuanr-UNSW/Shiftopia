import React, { useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription
} from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { useTemplates } from '@/modules/rosters/state/useRosterShifts';
import { useApplyTemplate, useClearTemplate } from '../../state/useRosterMutations';
import { useTemplateHistory } from '@/modules/templates/hooks/queries/useTemplateQueries';
import { format, isWithinInterval, startOfMonth, endOfMonth, differenceInDays, parseISO } from 'date-fns';
import { Check, CopyPlus, Info, AlertTriangle, Loader2, Trash2, History, User, Calendar as CalendarIcon, RotateCcw } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { useAuth } from '@/platform/auth/useAuth';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { Switch } from '@/modules/core/ui/primitives/switch';
import { motion, AnimatePresence } from 'framer-motion';

interface ApplyTemplateDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    organizationId: string;
    departmentId: string;
    subDepartmentId: string | null;
    selectedDate: Date;
    appliedTemplateIds: string[];
    rosterId: string | null;
}

import { useUndoTemplateBatch } from '@/modules/templates/hooks/queries/useTemplateQueries';

const UndoButton: React.FC<{ batchId: string }> = ({ batchId }) => {
    const undo = useUndoTemplateBatch();
    const [confirming, setConfirming] = useState(false);

    const handleUndo = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirming) {
            setConfirming(true);
            setTimeout(() => setConfirming(false), 3000);
            return;
        }
        await undo.mutateAsync({ batchId });
    };

    return (
        <Button
            variant="ghost"
            size="icon"
            className={cn(
                "h-6 w-6 rounded-md transition-all",
                confirming
                    ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 hover:text-amber-300"
                    : "text-slate-600 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover/item:opacity-100"
            )}
            onClick={handleUndo}
            disabled={undo.isPending}
        >
            {undo.isPending ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : confirming ? (
                <RotateCcw className="h-2.5 w-2.5" />
            ) : (
                <RotateCcw className="h-2.5 w-2.5" />
            )}
        </Button>
    );
};

const HistoryList: React.FC<{ templateId: string }> = ({ templateId }) => {
    const { data: history = [], isLoading } = useTemplateHistory(templateId);

    if (isLoading) {
        return (
            <div className="flex items-center gap-2 py-4 pl-12 text-[10px] text-slate-500">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Loading history...</span>
            </div>
        );
    }

    if (history.length === 0) {
        return (
            <div className="py-3 pl-12 text-[10px] text-slate-600 italic">
                No previous applications recorded.
            </div>
        );
    }

    return (
        <div className="mt-3 pl-12 space-y-2 border-l border-white/5 ml-4">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <History className="h-3 w-3" />
                Application History
            </div>
            <div className="max-h-[120px] overflow-y-auto pr-2 space-y-2 custom-scrollbar">
                {history.map((batch) => (
                    <div key={batch.id} className="bg-white/[0.02] border border-white/5 rounded-lg p-2.5 relative group/item hover:bg-white/[0.04] transition-colors">
                        <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                                <div className="h-4.5 w-4.5 rounded-full bg-slate-800 flex items-center justify-center border border-white/10 flex-shrink-0">
                                    <User className="h-2.5 w-2.5 text-slate-400" />
                                </div>
                                <span className="text-[10px] font-bold text-slate-300">
                                    {batch.appliedByName || 'Unknown User'}
                                </span>
                            </div>
                            <span className="text-[9px] text-slate-500 font-medium">
                                {format(new Date(batch.appliedAt), 'MMM d, h:mm a')}
                            </span>
                        </div>
                        <div className="flex items-center justify-between">
                            <div className="text-[10px] text-slate-400 flex items-center gap-1.5 pl-0.5">
                                <CalendarIcon className="h-3 w-3 opacity-40" />
                                <span className="font-medium">{format(new Date(batch.startDate), 'MMM d')}</span>
                                <span className="opacity-30">→</span>
                                <span className="font-medium">{format(new Date(batch.endDate), 'MMM d')}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-[8px] h-4 px-1.5 py-0 leading-none bg-white/5 border-white/10 text-slate-500 font-bold uppercase tracking-tighter">
                                    {batch.source === 'templates_page' ? 'Direct' : 'Modal'}
                                </Badge>
                                <UndoButton batchId={batch.id} />
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export const ApplyTemplateDialog: React.FC<ApplyTemplateDialogProps> = ({
    isOpen,
    onOpenChange,
    organizationId,
    departmentId,
    subDepartmentId,
    selectedDate,
    appliedTemplateIds,
    rosterId
}) => {
    const { user } = useAuth();
    const { data: templates = [], isLoading: isLoadingTemplates } = useTemplates(
        subDepartmentId || undefined,
        departmentId || undefined
    );
    const applyTemplate = useApplyTemplate();
    const clearTemplate = useClearTemplate();
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const [startDate, setStartDate] = useState<string>(format(selectedDate, 'yyyy-MM-dd'));
    const [endDate, setEndDate] = useState<string>(format(selectedDate, 'yyyy-MM-dd'));
    const [forceStack, setForceStack] = useState(false);

    const monthStart = startOfMonth(selectedDate);
    const monthEnd = endOfMonth(selectedDate);

    const parsedStart = parseISO(startDate);
    const parsedEnd = parseISO(endDate);

    const isRangeValid = parsedStart <= parsedEnd;
    const isWithinMonth =
        isWithinInterval(parsedStart, { start: monthStart, end: monthEnd }) &&
        isWithinInterval(parsedEnd, { start: monthStart, end: monthEnd });

    const daysCount = isRangeValid ? differenceInDays(parsedEnd, parsedStart) + 1 : 0;

    const error = !isRangeValid ? "End date cannot be before start date" :
        !isWithinMonth ? `Dates must be within ${format(selectedDate, 'MMMM yyyy')}` :
            null;

    const handleApply = async () => {
        if (!selectedId || !user || !isRangeValid || !isWithinMonth) return;

        await applyTemplate.mutateAsync({
            templateId: selectedId,
            startDate,
            endDate,
            userId: user.id,
            forceStack,
            source: 'roster_modal'
        });

        onOpenChange(false);
        setSelectedId(null);
    };

    const handleUnapply = async (tId: string) => {
        if (!rosterId || !user) return;
        await clearTemplate.mutateAsync({
            rosterId,
            templateId: tId,
            userId: user.id
        });
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-hidden flex flex-col bg-slate-950 border-white/10 text-white p-0">
                <DialogHeader className="p-6 pb-0">
                    <div className="flex items-center gap-3 mb-1">
                        <div className="h-10 w-10 rounded-xl bg-blue-500/20 flex items-center justify-center border border-blue-500/30">
                            <CopyPlus className="h-5 w-5 text-blue-400" />
                        </div>
                        <div>
                            <DialogTitle className="text-xl font-bold tracking-tight text-white">Apply Template</DialogTitle>
                            <DialogDescription className="text-slate-400 text-sm">
                                Apply template shifts across a custom date range
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 custom-scrollbar">
                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 flex gap-3 text-xs text-blue-200/80 leading-relaxed">
                        <Info className="h-4 w-4 text-blue-400 flex-shrink-0" />
                        <p>
                            Applying a template will <strong>append</strong> its defined shifts to the current day.
                            Existing shifts and structure will be preserved.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <Label htmlFor="start-date" className="text-[11px] font-bold text-slate-400 uppercase tracking-tight">Start Date</Label>
                                    <Input
                                        id="start-date"
                                        type="date"
                                        value={startDate}
                                        onChange={(e) => setStartDate(e.target.value)}
                                        className="bg-white/5 border-white/10 text-xs h-10 focus:ring-blue-500/50 rounded-xl"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="end-date" className="text-[11px] font-bold text-slate-400 uppercase tracking-tight">End Date</Label>
                                    <Input
                                        id="end-date"
                                        type="date"
                                        value={endDate}
                                        onChange={(e) => setEndDate(e.target.value)}
                                        className="bg-white/5 border-white/10 text-xs h-10 focus:ring-blue-500/50 rounded-xl"
                                    />
                                </div>
                            </div>

                            {daysCount > 0 && !error && (
                                <div className="flex items-center gap-2 px-1">
                                    <Check className="h-3 w-3 text-emerald-400" />
                                    <span className="text-[11px] font-medium text-slate-300">Applying to {daysCount} {daysCount === 1 ? 'day' : 'days'}</span>
                                </div>
                            )}

                            {error && (
                                <div className="flex items-center gap-1.5 px-1 text-[11px] text-red-400 font-medium bg-red-500/5 border border-red-500/10 p-2 rounded-lg">
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                    {error}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
                        <div className="space-y-0.5">
                            <Label htmlFor="stack-shifts" className="text-sm font-semibold text-white/90">Stack Shifts</Label>
                            <p className="text-[11px] text-slate-400">Inject shifts even if they already exist</p>
                        </div>
                        <Switch
                            id="stack-shifts"
                            checked={forceStack}
                            onCheckedChange={setForceStack}
                            className="data-[state=checked]:bg-blue-600"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 pl-1">
                            Available Templates
                        </label>

                        <div className="space-y-2.5 pr-1">
                            <AnimatePresence mode="popLayout">
                                {isLoadingTemplates ? (
                                    <motion.div
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        className="flex flex-col items-center justify-center py-10 text-slate-500 gap-2"
                                    >
                                        <Loader2 className="h-6 w-6 animate-spin" />
                                        <span className="text-xs">Gathering available templates...</span>
                                    </motion.div>
                                ) : templates.length === 0 ? (
                                    <motion.div
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="text-center py-8 border border-dashed border-white/10 rounded-xl text-slate-500 text-sm"
                                    >
                                        No templates found for this department.
                                    </motion.div>
                                ) : (
                                    templates.map((t, index) => {
                                        const isApplied = appliedTemplateIds.includes(t.id);
                                        const isSelected = selectedId === t.id;

                                        return (
                                            <div key={t.id} className="space-y-1">
                                                <motion.div
                                                    initial={{ opacity: 0, x: -10 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    transition={{ delay: index * 0.05 }}
                                                    onClick={() => setSelectedId(isSelected ? null : t.id)}
                                                    className={cn(
                                                        "w-full text-left p-3.5 rounded-2xl border transition-all flex items-center justify-between group relative overflow-hidden cursor-pointer",
                                                        isSelected
                                                            ? "bg-blue-500/10 border-blue-500/40 ring-1 ring-blue-500/20 shadow-lg shadow-blue-500/5"
                                                            : "bg-white/5 border-white/5 hover:border-white/20 hover:bg-white/10"
                                                    )}
                                                >
                                                    {/* Selection Glow */}
                                                    {isSelected && (
                                                        <motion.div
                                                            layoutId="glow"
                                                            className="absolute inset-0 bg-blue-500/5 pointer-events-none"
                                                        />
                                                    )}

                                                    <div className="flex items-center gap-3.5 relative z-10 w-full">
                                                        <div className={cn(
                                                            "h-9 w-9 rounded-xl flex items-center justify-center border transition-all shadow-inner",
                                                            isSelected
                                                                ? "bg-blue-600 border-blue-400 text-white shadow-blue-500/20"
                                                                : "bg-slate-800 border-white/5 text-slate-400 group-hover:border-white/10 group-hover:text-slate-300"
                                                        )}>
                                                            <CopyPlus className="h-4.5 w-4.5" />
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2">
                                                                <div className="text-sm font-bold tracking-tight text-white/95 truncate">{t.name}</div>
                                                                {t.appliedCount > 0 && (
                                                                    <Badge variant="secondary" className="bg-slate-800 text-slate-400 border-white/5 text-[8px] h-4 px-1.5 flex items-center gap-1 font-bold">
                                                                        <History className="h-2.5 w-2.5" />
                                                                        {t.appliedCount}
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                            <div className="text-[10px] font-medium text-slate-500 uppercase tracking-widest truncate">{t.description || 'Standard Sequence'}</div>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-2 relative z-10">
                                                        {isApplied && (
                                                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[9px] font-bold uppercase tracking-wider h-5 px-1.5">
                                                                Active
                                                            </Badge>
                                                        )}
                                                        <div
                                                            className={cn(
                                                                "h-8 w-8 rounded-lg transition-all flex items-center justify-center",
                                                                isSelected
                                                                    ? "bg-blue-500/20 text-blue-400"
                                                                    : "text-slate-500 hover:text-white hover:bg-white/10"
                                                            )}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setSelectedId(isSelected ? null : t.id);
                                                            }}
                                                        >
                                                            <History className={cn("h-4 w-4", isSelected && "animate-pulse")} />
                                                        </div>
                                                    </div>
                                                </motion.div>

                                                {isSelected && (
                                                    <motion.div
                                                        initial={{ opacity: 0, height: 0 }}
                                                        animate={{ opacity: 1, height: 'auto' }}
                                                        exit={{ opacity: 0, height: 0 }}
                                                        className="overflow-hidden"
                                                    >
                                                        <HistoryList templateId={t.id.toString()} />
                                                    </motion.div>
                                                )}
                                            </div>
                                        );
                                    })
                                )}
                            </AnimatePresence>
                        </div>
                    </div>

                    {selectedId && !forceStack && (
                        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 flex gap-3 text-xs text-amber-200/80 leading-relaxed animate-in fade-in slide-in-from-top-2">
                            <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0" />
                            <p>
                                Shifts that already exist in this range from this template will be skipped to prevent duplicates.
                                <strong>Enable "Stack Shifts"</strong> to inject them anyway.
                            </p>
                        </div>
                    )}

                    {selectedId && forceStack && (
                        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 flex gap-3 text-xs text-blue-200/80 leading-relaxed animate-in fade-in slide-in-from-top-2">
                            <Info className="h-4 w-4 text-blue-400 flex-shrink-0" />
                            <p>
                                <strong>Stacking Enabled</strong>: Duplicate shifts will be created if they already exist in the target range.
                            </p>
                        </div>
                    )}
                </div>

                <DialogFooter className="p-6 border-t border-white/10 flex sm:justify-between items-center gap-4 bg-slate-900/50">
                    <Button
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        className="text-slate-400 hover:text-white"
                        disabled={applyTemplate.isPending}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleApply}
                        disabled={!selectedId || applyTemplate.isPending || !!error}
                        className={cn(
                            "min-w[(140px)] rounded-2xl h-11 font-bold text-sm transition-all shadow-lg",
                            !selectedId || !!error
                                ? "bg-slate-800 text-slate-500 cursor-not-allowed border-white/5"
                                : "bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/20 active:scale-95"
                        )}
                    >
                        {applyTemplate.isPending ? (
                            <div className="flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span>Processing...</span>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2">
                                <span>Apply to Roster</span>
                                <Check className="h-4 w-4 opacity-70" />
                            </div>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
