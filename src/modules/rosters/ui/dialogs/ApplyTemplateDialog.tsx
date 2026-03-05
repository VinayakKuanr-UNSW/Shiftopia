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
            className="group relative bg-muted/30 border border-border rounded-2xl p-4 hover:bg-muted/50 transition-all shadow-sm"
        >
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                    <div className="h-7 w-7 rounded-full bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                        <User className="h-3.5 w-3.5 text-blue-600" />
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[11px] font-black text-foreground leading-none">{batch.appliedByName || 'System'}</span>
                        <span className="text-[9px] text-muted-foreground font-medium uppercase tracking-tighter mt-1">
                            {format(new Date(batch.appliedAt), 'MMM d, HH:mm')}
                        </span>
                    </div>
                </div>
            </div>

            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono bg-muted/50 px-2 py-1 rounded-md border border-border">
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
                            ? "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 border border-amber-500/30"
                            : "text-muted-foreground hover:text-red-500 hover:bg-red-500/10 border border-transparent"
                    )}
                >
                    {undo.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin text-primary" />
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
                className="sm:max-w-[1040px] h-[720px] max-h-[85vh] bg-background border border-border p-0 overflow-hidden shadow-2xl flex flex-col rounded-[2.5rem] [&>button]:hidden z-[150]"
            >
                <VisuallyHidden>
                    <DialogTitle>Apply Template to Roster</DialogTitle>
                    <DialogDescription>
                        Select a template sequence from the library, configure the date range, and inject it into your roster.
                    </DialogDescription>
                </VisuallyHidden>

                <div className="flex flex-1 h-full min-h-0">

                    {/* LEFT PANE: LIBRARY */}
                    <div className="w-[280px] border-r border-border flex flex-col bg-muted/30">
                        <div className="p-10 pb-8">
                            <div className="flex items-center gap-4 mb-10">
                                <div className="h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-sm">
                                    <Layers className="h-5 w-5 text-primary" />
                                </div>
                                <div className="flex flex-col">
                                    <h2 className="text-lg font-black text-foreground tracking-tight leading-none">Library</h2>
                                    <p className="text-[9px] text-muted-foreground uppercase font-black tracking-[0.15em] mt-1.5">
                                        Published Assets
                                    </p>
                                </div>
                            </div>

                            <div className="relative group">
                                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50 group-focus-within:text-primary transition-colors" />
                                <Input
                                    placeholder="Search sequences..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="bg-background border-border pl-10 text-xs h-10 focus:ring-1 focus:ring-primary/40 rounded-xl placeholder:text-muted-foreground/40 font-medium"
                                />
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto px-5 pb-8 space-y-2.5 custom-scrollbar">
                            {isLoadingTemplates ? (
                                <div className="flex flex-col items-center justify-center py-24 gap-4 opacity-50">
                                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Indexing...</span>
                                </div>
                            ) : filteredTemplates.length === 0 ? (
                                <div className="text-center py-24">
                                    <div className="h-12 w-12 rounded-full border border-dashed border-border flex items-center justify-center mx-auto mb-4 scale-75 opacity-20">
                                        <Search className="h-6 w-6" />
                                    </div>
                                    <p className="text-[11px] text-muted-foreground font-bold uppercase tracking-widest">No Matches</p>
                                </div>
                            ) : (
                                filteredTemplates.map((t) => (
                                    <button
                                        key={t.id}
                                        onClick={() => setSelectedId(t.id)}
                                        className={cn(
                                            "w-full text-left p-4 rounded-2xl border transition-all flex items-center justify-between group relative overflow-hidden active:scale-[0.98]",
                                            selectedId === t.id
                                                ? "bg-primary/5 border-primary/40 shadow-sm"
                                                : "bg-card border-border hover:border-border/80 hover:bg-muted/50"
                                        )}
                                    >
                                        <div className="flex items-center gap-4 relative z-10">
                                            <div className={cn(
                                                "h-10 w-10 rounded-xl flex items-center justify-center border transition-all shadow-sm",
                                                selectedId === t.id
                                                    ? "bg-primary border-primary text-primary-foreground"
                                                    : "bg-muted border-border text-muted-foreground group-hover:text-foreground"
                                            )}>
                                                <CopyPlus className="h-4.5 w-4.5" />
                                            </div>
                                            <div>
                                                <div className={cn(
                                                    "text-[14px] font-black tracking-tight transition-colors",
                                                    selectedId === t.id ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
                                                )}>{t.name}</div>
                                                <div className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-widest mt-0.5">
                                                    {t.applied_count ?? 0} Uses
                                                </div>
                                            </div>
                                        </div>
                                        <ChevronRight className={cn(
                                            "h-4 w-4 transition-all duration-300",
                                            selectedId === t.id ? "text-primary translate-x-1 opacity-100" : "text-muted-foreground/30 opacity-0 group-hover:opacity-100"
                                        )} />
                                    </button>
                                ))
                            )}
                        </div>
                    </div>

                    {/* MIDDLE PANE: EDITOR */}
                    <div className="flex-1 flex flex-col bg-background relative overflow-hidden">

                        {/* Static background flare */}
                        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/5 blur-[120px] rounded-full pointer-events-none opacity-50" />
                        <div className="absolute bottom-[-5%] right-[-5%] w-[30%] h-[30%] bg-indigo-500/5 blur-[100px] rounded-full pointer-events-none opacity-50" />

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
                                            <div className="inline-flex items-center gap-2 mb-6 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 shadow-inner">
                                                <Sparkles className="h-3 w-3 text-primary" />
                                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">
                                                    Injection Sequence
                                                </span>
                                            </div>
                                            <h2 className="text-3xl font-black text-foreground tracking-tighter leading-none mb-4">
                                                {selectedTemplate.name}
                                            </h2>
                                            <p className="text-sm text-muted-foreground font-medium leading-relaxed max-w-[400px] mx-auto opacity-70">
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
                                                            className="flex items-center gap-3 p-4 bg-red-500/5 border border-red-500/20 rounded-2xl text-red-600"
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
                                                            <div className="h-2 w-2 rounded-full bg-primary animate-pulse shadow-[0_0_10px_rgba(var(--primary),0.8)]" />
                                                            <span className="text-[11px] font-bold text-muted-foreground">
                                                                Ready to inject <span className="text-foreground text-xs px-1.5 py-0.5 bg-muted rounded-md border border-border mx-0.5">{daysCount}</span> shifts instances
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
                                                    className="h-16 px-8 rounded-[1.5rem] font-black text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                                                >
                                                    Cancel
                                                </Button>
                                                <Button
                                                    onClick={handleApply}
                                                    disabled={!selectedId || applyTemplate.isPending || !isRangeValid || !isFullyActivated}
                                                    className={cn(
                                                        "flex-1 h-16 rounded-[1.5rem] font-black text-md uppercase tracking-[0.2em] transition-all relative overflow-hidden active:scale-[0.97]",
                                                        !selectedId || !isFullyActivated
                                                            ? "bg-muted text-muted-foreground cursor-not-allowed border-border"
                                                            : "bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 border-b-4 border-primary/20"
                                                    )}
                                                >
                                                    {applyTemplate.isPending ? (
                                                        <div className="flex items-center gap-3">
                                                            <Loader2 className="h-5 w-5 animate-spin" />
                                                            <span>Executing...</span>
                                                        </div>
                                                    ) : !selectedId ? (
                                                        "Select Template"
                                                    ) : !isFullyActivated ? (
                                                        "Roster Activation Required"
                                                    ) : (
                                                        <div className="flex items-center gap-3">
                                                            <span>Inject Sequence</span>
                                                            <Check className="h-5 w-5" />
                                                        </div>
                                                    )}
                                                </Button>
                                            </div>

                                            <div className="flex items-center gap-4 px-2 opacity-50 hover:opacity-100 transition-opacity">
                                                <Info className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                                <p className="text-[10px] font-bold text-muted-foreground leading-relaxed uppercase tracking-widest">
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
                                    <div className="h-32 w-32 rounded-[2.5rem] bg-muted border border-border flex items-center justify-center mb-10 shadow-sm">
                                        <Layers className="h-12 w-12 text-muted-foreground/30 animate-pulse" />
                                    </div>
                                    <h3 className="text-2xl font-black text-foreground mb-3 tracking-tighter">System Idle</h3>
                                    <p className="text-sm text-muted-foreground max-w-[280px] font-medium leading-relaxed opacity-70">
                                        Select an distribution asset from the library to configure deployment.
                                    </p>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* RIGHT PANE: HISTORY */}
                    <div className="w-[300px] border-l border-border flex flex-col bg-muted/30">
                        <div className="p-10 pb-8">
                            <div className="flex items-center justify-between mb-10">
                                <div className="flex items-center gap-4">
                                    <div className="h-10 w-10 rounded-2xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
                                        <History className="h-5 w-5 text-amber-600" />
                                    </div>
                                    <h2 className="text-md font-black text-foreground tracking-tight leading-none uppercase tracking-widest text-xs opacity-80">History</h2>
                                </div>
                                <Badge variant="outline" className="text-[9px] font-black border-border bg-background text-muted-foreground px-2 py-0.5 rounded-full">
                                    {history.length} LOGS
                                </Badge>
                            </div>

                            <Separator className="bg-border" />
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
                                <div className="py-24 text-center border-2 border-dashed border-muted rounded-[2rem] flex flex-col items-center justify-center overflow-hidden relative">
                                    <div className="absolute inset-0 bg-muted/5" />
                                    <p className="text-[10px] uppercase font-black tracking-widest text-muted-foreground/40 relative z-10 italic">No usage records</p>
                                </div>
                            ) : (
                                history.map(batch => (
                                    <HistoryItem key={batch.id} batch={batch} />
                                ))
                            )}
                        </div>

                        {/* Visual Footer for Right Pane */}
                        <div className="p-8 pt-4 border-t border-border bg-muted/50">
                            <div className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/10">
                                <div className="flex gap-3">
                                    <Info className="h-3.5 w-3.5 text-amber-600/60 flex-shrink-0 mt-0.5" />
                                    <p className="text-[10px] font-bold text-muted-foreground/60 leading-tight uppercase tracking-tight">
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
