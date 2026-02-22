import React, { useState, useMemo } from 'react';
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
} from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { useTemplates } from '@/modules/rosters/state/useRosterShifts';
import { useApplyTemplate } from '@/modules/rosters/state/useRosterMutations';
import { useTemplateHistory, useUndoTemplateBatch } from '@/modules/templates/hooks/queries/useTemplateQueries';
import { useRostersByDateRange } from '@/modules/rosters/state/useEnhancedRosters';
import { format, isWithinInterval, startOfMonth, endOfMonth, differenceInDays, parseISO, addDays } from 'date-fns';
import {
    Check,
    CopyPlus,
    Info,
    AlertTriangle,
    Loader2,
    History,
    User,
    Calendar as CalendarIcon,
    RotateCcw,
    LayoutGrid,
    ChevronRight,
    ArrowRight,
    Search,
    Clock,
    X,
    Layers,
    Sparkles
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { useAuth } from '@/platform/auth/useAuth';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { motion, AnimatePresence } from 'framer-motion';
import { Separator } from '@/modules/core/ui/primitives/separator';
import { toast } from 'sonner';

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

const HistoryItem: React.FC<{ batch: any }> = ({ batch }) => {
    const undo = useUndoTemplateBatch();
    const [isConfirming, setIsConfirming] = useState(false);

    const handleUndo = async () => {
        if (!isConfirming) {
            setIsConfirming(true);
            setTimeout(() => setIsConfirming(false), 3000);
            return;
        }
        try {
            await undo.mutateAsync({ batchId: batch.id });
            toast.success('Sequence reversed successfully');
        } catch (err) {
            toast.error('Failed to undo application');
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="group relative bg-white/[0.02] border border-white/5 rounded-2xl p-4 hover:bg-white/[0.04] transition-all"
        >
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                    <div className="h-7 w-7 rounded-full bg-gradient-to-br from-blue-500/20 to-indigo-500/20 flex items-center justify-center border border-blue-500/30">
                        <User className="h-3.5 w-3.5 text-blue-400" />
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[11px] font-bold text-slate-200 leading-none">{batch.appliedByName || 'System'}</span>
                        <span className="text-[9px] text-slate-500 font-medium uppercase tracking-tighter mt-1">
                            {format(new Date(batch.appliedAt), 'MMM d, HH:mm')}
                        </span>
                    </div>
                </div>
            </div>

            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono bg-black/40 px-2 py-1 rounded-md border border-white/5">
                    <CalendarIcon className="h-3 w-3 opacity-50" />
                    <span>{format(new Date(batch.startDate), 'MM/dd')}</span>
                    <ArrowRight className="h-2.5 w-2.5 opacity-30 px-0.5" />
                    <span>{format(new Date(batch.endDate), 'MM/dd')}</span>
                </div>

                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleUndo}
                    disabled={undo.isPending}
                    className={cn(
                        "h-8 px-3 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                        isConfirming
                            ? "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border border-amber-500/30"
                            : "text-slate-500 hover:text-red-400 hover:bg-red-500/10 border border-transparent"
                    )}
                >
                    {undo.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                        <div className="flex items-center gap-1.5">
                            <RotateCcw className="h-3 w-3" />
                            <span>{isConfirming ? 'Confirm?' : 'Undo'}</span>
                        </div>
                    )}
                </Button>
            </div>
        </motion.div>
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
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    const [startDate, setStartDate] = useState<string>(format(selectedDate, 'yyyy-MM-dd'));
    const [endDate, setEndDate] = useState<string>(format(selectedDate, 'yyyy-MM-dd'));

    const parsedStart = useMemo(() => parseISO(startDate), [startDate]);
    const parsedEnd = useMemo(() => parseISO(endDate), [endDate]);

    const isRangeValid = useMemo(() => parsedStart <= parsedEnd, [parsedStart, parsedEnd]);
    const daysCount = useMemo(() => isRangeValid ? differenceInDays(parsedEnd, parsedStart) + 1 : 0, [isRangeValid, parsedStart, parsedEnd]);

    const { data: existingRostersByRange = [] } = useRostersByDateRange(
        startDate,
        endDate,
        departmentId || ''
    );

    const { data: history = [], isLoading: isLoadingHistory } = useTemplateHistory(selectedId || undefined);

    const activatedDays = useMemo(() => new Set(existingRostersByRange?.map(r => r.startDate)), [existingRostersByRange]);
    const isFullyActivated = useMemo(() => {
        if (!isRangeValid || daysCount <= 0) return false;
        return Array.from({ length: daysCount }).every((_, i) => {
            const d = format(addDays(parsedStart, i), 'yyyy-MM-dd');
            return activatedDays.has(d);
        });
    }, [isRangeValid, daysCount, parsedStart, activatedDays]);

    const isRangeOverMonth = daysCount > 31;
    const error = !isRangeValid ? "End date precedes start date" :
        !isFullyActivated ? "Range contains unactivated rosters" : null;

    const filteredTemplates = useMemo(() =>
        templates.filter(t =>
            t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            t.description?.toLowerCase().includes(searchQuery.toLowerCase())
        ), [templates, searchQuery]
    );

    const handleApply = async () => {
        if (!selectedId || !user || !isRangeValid) return;

        try {
            await applyTemplate.mutateAsync({
                templateId: selectedId,
                startDate,
                endDate,
                userId: user.id,
                source: 'roster_modal',
                targetDepartmentId: departmentId || undefined,
                targetSubDepartmentId: subDepartmentId || undefined
            });
            toast.success('Template sequence injected successfully');
            onOpenChange(false);
            setSelectedId(null);
        } catch (err) {
            toast.error('Failed to apply template');
        }
    };

    const selectedTemplate = templates.find(t => t.id === selectedId);

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent
                className="sm:max-w-[1040px] h-[720px] max-h-[85vh] bg-[#0A0C0E] border border-white/10 p-0 overflow-hidden shadow-[0_0_80px_-15px_rgba(0,0,0,0.8)] flex flex-col rounded-[2.5rem] [&>button]:hidden z-[150]"
            >
                <VisuallyHidden>
                    <DialogTitle>Apply Template to Roster</DialogTitle>
                    <DialogDescription>
                        Select a template sequence from the library, configure the date range, and inject it into your roster.
                    </DialogDescription>
                </VisuallyHidden>

                <div className="flex flex-1 h-full min-h-0">

                    {/* LEFT PANE: LIBRARY */}
                    <div className="w-[280px] border-r border-white/5 flex flex-col bg-[#0D0F12]">
                        <div className="p-10 pb-8">
                            <div className="flex items-center gap-4 mb-10">
                                <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-blue-600/20 to-blue-400/10 flex items-center justify-center border border-blue-500/20 shadow-lg shadow-blue-500/5">
                                    <Layers className="h-5 w-5 text-blue-400" />
                                </div>
                                <div className="flex flex-col">
                                    <h2 className="text-lg font-black text-white tracking-tight leading-none">Library</h2>
                                    <p className="text-[9px] text-slate-500 uppercase font-black tracking-[0.15em] mt-1.5 opacity-60">
                                        Published Assets
                                    </p>
                                </div>
                            </div>

                            <div className="relative group">
                                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-600 group-focus-within:text-blue-400 transition-colors" />
                                <Input
                                    placeholder="Search sequences..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="bg-black/40 border-white/10 pl-10 text-xs h-10 focus:ring-1 focus:ring-blue-500/40 rounded-xl placeholder:text-slate-700 font-medium"
                                />
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto px-5 pb-8 space-y-2.5 custom-scrollbar">
                            {isLoadingTemplates ? (
                                <div className="flex flex-col items-center justify-center py-24 gap-4 opacity-50">
                                    <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Indexing...</span>
                                </div>
                            ) : filteredTemplates.length === 0 ? (
                                <div className="text-center py-24">
                                    <div className="h-12 w-12 rounded-full border border-dashed border-white/10 flex items-center justify-center mx-auto mb-4 scale-75 opacity-20">
                                        <Search className="h-6 w-6" />
                                    </div>
                                    <p className="text-[11px] text-slate-600 font-bold uppercase tracking-widest">No Matches</p>
                                </div>
                            ) : (
                                filteredTemplates.map((t) => (
                                    <button
                                        key={t.id}
                                        onClick={() => setSelectedId(t.id)}
                                        className={cn(
                                            "w-full text-left p-4 rounded-2xl border transition-all flex items-center justify-between group relative overflow-hidden active:scale-[0.98]",
                                            selectedId === t.id
                                                ? "bg-blue-600/10 border-blue-500/40 shadow-[0_0_20px_-5px_rgba(59,130,246,0.2)]"
                                                : "bg-[#121418] border-white/5 hover:border-white/10 hover:bg-[#16191D]"
                                        )}
                                    >
                                        <div className="flex items-center gap-4 relative z-10">
                                            <div className={cn(
                                                "h-10 w-10 rounded-xl flex items-center justify-center border transition-all shadow-sm",
                                                selectedId === t.id
                                                    ? "bg-blue-600 border-blue-400 text-white"
                                                    : "bg-black/40 border-white/5 text-slate-500 group-hover:text-slate-300"
                                            )}>
                                                <CopyPlus className="h-4.5 w-4.5" />
                                            </div>
                                            <div>
                                                <div className={cn(
                                                    "text-[14px] font-black tracking-tight transition-colors",
                                                    selectedId === t.id ? "text-white" : "text-slate-400 group-hover:text-slate-200"
                                                )}>{t.name}</div>
                                                <div className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mt-0.5">
                                                    {t.appliedCount ?? 0} Uses
                                                </div>
                                            </div>
                                        </div>
                                        <ChevronRight className={cn(
                                            "h-4 w-4 transition-all duration-300",
                                            selectedId === t.id ? "text-blue-400 translate-x-1 opacity-100" : "text-slate-800 opacity-0 group-hover:opacity-100"
                                        )} />
                                    </button>
                                ))
                            )}
                        </div>
                    </div>

                    {/* MIDDLE PANE: EDITOR */}
                    <div className="flex-1 flex flex-col bg-[#0A0C0E] relative overflow-hidden">

                        {/* Static background flare */}
                        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/5 blur-[120px] rounded-full pointer-events-none" />
                        <div className="absolute bottom-[-5%] right-[-5%] w-[30%] h-[30%] bg-indigo-600/5 blur-[100px] rounded-full pointer-events-none" />

                        <AnimatePresence mode="wait">
                            {selectedTemplate ? (
                                <motion.div
                                    key={selectedTemplate.id}
                                    initial={{ opacity: 0, scale: 0.98, y: 10 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.98, y: -10 }}
                                    transition={{ duration: 0.3, ease: "easeOut" }}
                                    className="flex-1 flex flex-col p-10 relative z-10"
                                >
                                    <div className="max-w-[480px] mx-auto w-full flex flex-col h-full">
                                        {/* Selection Header */}
                                        <div className="mb-12 text-center">
                                            <div className="inline-flex items-center gap-2 mb-6 px-4 py-1.5 rounded-full bg-blue-600/10 border border-blue-500/20 shadow-inner shadow-blue-500/5">
                                                <Sparkles className="h-3 w-3 text-blue-400" />
                                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-400">
                                                    Injection Sequence
                                                </span>
                                            </div>
                                            <h2 className="text-3xl font-black text-white tracking-tighter leading-none mb-4">
                                                {selectedTemplate.name}
                                            </h2>
                                            <p className="text-sm text-slate-500 font-medium leading-relaxed max-w-[400px] mx-auto">
                                                {selectedTemplate.description || 'Professional workforce distribution pattern calibrated for this department.'}
                                            </p>
                                        </div>

                                        <div className="flex-1 flex flex-col justify-center gap-10">
                                            {/* Date Config */}
                                            <div className="space-y-6 bg-white/[0.02] border border-white/5 p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden group">
                                                {/* Card inner flare */}
                                                <div className="absolute top-0 right-0 w-20 h-20 bg-blue-500/5 blur-3xl rounded-full" />

                                                <div className="flex items-center gap-2.5 opacity-60">
                                                    <Clock className="h-4 w-4 text-blue-400" />
                                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-200">Execution Range</span>
                                                </div>

                                                <div className="grid grid-cols-2 gap-8 relative z-10">
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Start Point</Label>
                                                        <Input
                                                            type="date"
                                                            value={startDate}
                                                            onChange={(e) => setStartDate(e.target.value)}
                                                            className="bg-black/60 border-white/5 text-white focus:ring-blue-500/40 rounded-2xl font-mono text-sm h-12 shadow-inner px-4"
                                                        />
                                                    </div>
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">End Point</Label>
                                                        <Input
                                                            type="date"
                                                            value={endDate}
                                                            onChange={(e) => setEndDate(e.target.value)}
                                                            className="bg-black/60 border-white/5 text-white focus:ring-blue-500/40 rounded-2xl font-mono text-sm h-12 shadow-inner px-4"
                                                        />
                                                    </div>
                                                </div>

                                                <AnimatePresence>
                                                    {error ? (
                                                        <motion.div
                                                            initial={{ height: 0, opacity: 0 }}
                                                            animate={{ height: "auto", opacity: 1 }}
                                                            exit={{ height: 0, opacity: 0 }}
                                                            className="flex items-center gap-3 p-4 bg-red-500/5 border border-red-500/20 rounded-2xl text-red-500"
                                                        >
                                                            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                                                            <span className="text-[11px] font-black uppercase tracking-tight">{error}</span>
                                                        </motion.div>
                                                    ) : (
                                                        <motion.div
                                                            initial={{ opacity: 0 }}
                                                            animate={{ opacity: 1 }}
                                                            className="flex items-center gap-3 px-2 py-1"
                                                        >
                                                            <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.8)]" />
                                                            <span className="text-[11px] font-bold text-slate-400">
                                                                Ready to inject <span className="text-white text-xs px-1.5 py-0.5 bg-white/5 rounded-md border border-white/5 mx-0.5">{daysCount}</span> shifts instances
                                                            </span>
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>
                                            </div>

                                            {/* Action Button */}
                                            <div className="flex items-center gap-4">
                                                <Button
                                                    variant="ghost"
                                                    onClick={() => onOpenChange(false)}
                                                    className="h-16 px-8 rounded-[1.5rem] font-black text-xs uppercase tracking-widest text-slate-500 hover:text-white hover:bg-white/5 transition-all"
                                                >
                                                    Cancel
                                                </Button>
                                                <Button
                                                    onClick={handleApply}
                                                    disabled={!selectedId || applyTemplate.isPending || !isRangeValid || !isFullyActivated}
                                                    className={cn(
                                                        "flex-1 h-16 rounded-[1.5rem] font-black text-md uppercase tracking-[0.2em] transition-all relative overflow-hidden active:scale-[0.97]",
                                                        !selectedId || !isFullyActivated
                                                            ? "bg-[#1A1D21] text-slate-700 cursor-not-allowed border-white/5"
                                                            : "bg-blue-600 hover:bg-blue-500 text-white shadow-[0_20px_40px_-10px_rgba(37,99,235,0.3)] border-b-4 border-blue-800"
                                                    )}
                                                >
                                                    {applyTemplate.isPending ? (
                                                        <div className="flex items-center gap-3">
                                                            <Loader2 className="h-5 w-5 animate-spin" />
                                                            <span>Executing...</span>
                                                        </div>
                                                    ) : !selectedId ? (
                                                        "Select Template to Continue"
                                                    ) : !isFullyActivated ? (
                                                        "Roster Activation Required"
                                                    ) : (
                                                        <div className="flex items-center gap-3">
                                                            <span>Inject</span>
                                                            <Check className="h-5 w-5" />
                                                        </div>
                                                    )}
                                                </Button>
                                            </div>

                                            <div className="flex items-center gap-4 px-2 opacity-40 hover:opacity-100 transition-opacity">
                                                <Info className="h-4 w-4 text-slate-400 flex-shrink-0" />
                                                <p className="text-[10px] font-semibold text-slate-500 leading-relaxed uppercase tracking-widest">
                                                    Injecting will append shifts to existing data for the selected range.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                            ) : (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className="h-full flex flex-col items-center justify-center text-center p-12"
                                >
                                    <div className="h-32 w-32 rounded-[2.5rem] bg-gradient-to-br from-white/[0.03] to-white/[0.01] border border-white/5 flex items-center justify-center mb-10 shadow-2xl">
                                        <Layers className="h-12 w-12 text-slate-700 animate-pulse" />
                                    </div>
                                    <h3 className="text-2xl font-black text-white mb-3 tracking-tighter">System Idle</h3>
                                    <p className="text-sm text-slate-500 max-w-[280px] font-medium leading-relaxed">
                                        Select an distribution asset from the library to configure deployment.
                                    </p>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* RIGHT PANE: HISTORY */}
                    <div className="w-[300px] border-l border-white/5 flex flex-col bg-[#0D0F12]">
                        <div className="p-10 pb-8">
                            <div className="flex items-center justify-between mb-10">
                                <div className="flex items-center gap-4">
                                    <div className="h-10 w-10 rounded-2xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
                                        <History className="h-5 w-5 text-amber-500" />
                                    </div>
                                    <h2 className="text-md font-black text-white tracking-tight leading-none uppercase tracking-widest text-xs opacity-80">History</h2>
                                </div>
                                <Badge variant="outline" className="text-[9px] font-black border-white/5 bg-white/[0.03] text-slate-500 px-2 py-0.5 rounded-full">
                                    {history.length} LOGS
                                </Badge>
                            </div>

                            <Separator className="bg-white/5" />
                        </div>

                        <div className="flex-1 overflow-y-auto px-8 pb-10 space-y-5 custom-scrollbar">
                            {!selectedId ? (
                                <div className="h-full flex flex-col items-center justify-center opacity-10 py-20">
                                    <Clock className="h-10 w-10 mb-4" />
                                    <span className="text-[10px] font-black uppercase tracking-widest">Select Item</span>
                                </div>
                            ) : isLoadingHistory ? (
                                <div className="py-24 text-center opacity-30">
                                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-4" />
                                    <span className="text-[10px] uppercase font-black tracking-widest">Reading logs...</span>
                                </div>
                            ) : history.length === 0 ? (
                                <div className="py-24 text-center border-2 border-dashed border-white/[0.02] rounded-[2rem] flex flex-col items-center justify-center overflow-hidden relative">
                                    <div className="absolute inset-0 bg-gradient-to-b from-transparent to-white/[0.01]" />
                                    <p className="text-[10px] uppercase font-black tracking-widest text-slate-700 relative z-10 italic">No usage records</p>
                                </div>
                            ) : (
                                history.map(batch => (
                                    <HistoryItem key={batch.id} batch={batch} />
                                ))
                            )}
                        </div>

                        {/* Visual Footer for Right Pane */}
                        <div className="p-8 pt-4 border-t border-white/5 bg-black/20">
                            <div className="p-4 rounded-2xl bg-amber-500/[0.02] border border-amber-500/5">
                                <div className="flex gap-3">
                                    <Info className="h-3.5 w-3.5 text-amber-500/40 flex-shrink-0 mt-0.5" />
                                    <p className="text-[10px] font-bold text-slate-600 leading-tight uppercase tracking-tight">
                                        Undo operations will selectively remove shifts created in the specific batch.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            </DialogContent>
        </Dialog>
    );
};
