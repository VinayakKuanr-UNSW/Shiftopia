import React, { useState, useMemo } from 'react';
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Label } from '@/modules/core/ui/primitives/label';
import { Input } from '@/modules/core/ui/primitives/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/modules/core/ui/primitives/select';
import { Badge } from '@/modules/core/ui/primitives/badge';
import {
    Loader2,
    FolderPlus,
    CalendarRange,
    ChevronRight,
    Sparkles,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import {
    format,
    startOfMonth,
    endOfMonth,
    addWeeks,
    addMonths,
} from 'date-fns';
import { startOfWeekAU, endOfWeekAU } from '@/modules/core/lib/date/week';
import { useAddSubGroupRange } from '@/modules/rosters/state/useRosterMutations';

interface CentralAddSubGroupDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    organizationId: string;
    departmentId: string;
    subDepartmentId: string | null;
    selectedDate: Date;
}

type PeriodPreset = 'current-month' | 'next-month' | 'this-week' | 'next-week' | 'custom';

const GROUP_OPTIONS = [
    { value: 'convention_centre', label: 'Convention Centre' },
    { value: 'exhibition_centre', label: 'Exhibition Centre' },
    { value: 'theatre', label: 'Theatre' },
    { value: 'the_cutaway', label: 'The Cutaway' },
];

export const CentralAddSubGroupDialog: React.FC<CentralAddSubGroupDialogProps> = ({
    open,
    onOpenChange,
    organizationId,
    departmentId,
    subDepartmentId,
    selectedDate,
}) => {
    const addSubGroupMutation = useAddSubGroupRange();

    // Form states
    const [groupExternalId, setGroupExternalId] = useState<string>('convention_centre');
    const [preset, setPreset] = useState<PeriodPreset>('current-month');
    const [customStart, setCustomStart] = useState<string>(format(startOfMonth(selectedDate), 'yyyy-MM-dd'));
    const [customEnd, setCustomEnd] = useState<string>(format(endOfMonth(selectedDate), 'yyyy-MM-dd'));
    const [name, setName] = useState<string>('');

    // Roster period calculations
    const computedRange = useMemo(() => {
        switch (preset) {
            case 'current-month':
                return {
                    start: startOfMonth(selectedDate),
                    end: endOfMonth(selectedDate),
                };
            case 'next-month':
                return {
                    start: startOfMonth(addMonths(selectedDate, 1)),
                    end: endOfMonth(addMonths(selectedDate, 1)),
                };
            case 'this-week':
                return {
                    start: startOfWeekAU(selectedDate),
                    end: endOfWeekAU(selectedDate),
                };
            case 'next-week':
                return {
                    start: startOfWeekAU(addWeeks(selectedDate, 1)),
                    end: endOfWeekAU(addWeeks(selectedDate, 1)),
                };
            case 'custom':
            default:
                return {
                    start: new Date(customStart),
                    end: new Date(customEnd),
                };
        }
    }, [preset, selectedDate, customStart, customEnd]);

    const formattedRangeLabel = useMemo(() => {
        try {
            return `${format(computedRange.start, 'd MMM yyyy')} – ${format(computedRange.end, 'd MMM yyyy')}`;
        } catch {
            return '';
        }
    }, [computedRange]);

    const canSubmit = name.trim().length > 0 && !addSubGroupMutation.isPending;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;

        try {
            const startDateStr = format(computedRange.start, 'yyyy-MM-dd');
            const endDateStr = format(computedRange.end, 'yyyy-MM-dd');

            await addSubGroupMutation.mutateAsync({
                organizationId,
                departmentId,
                subDepartmentId,
                groupExternalId,
                name: name.trim(),
                startDate: startDateStr,
                endDate: endDateStr,
            });

            onOpenChange(false);
            setName('');
        } catch (err) {
            // Error toast handled by mutation
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent 
                className="w-[calc(100vw-2rem)] sm:max-w-[480px] p-0 overflow-hidden rounded-2xl sm:rounded-[2rem] border border-border bg-background text-foreground shadow-2xl backdrop-blur-xl ring-1 ring-border/50 max-h-[calc(100dvh-3rem)] flex flex-col"
                aria-describedby="central-add-subgroup-description"
            >
                <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-y-auto" noValidate>
                    {/* Header */}
                    <div className="relative p-6 sm:p-8 pb-5 border-b border-border bg-muted/20">
                        <div className="absolute top-6 right-6 opacity-10 pointer-events-none">
                            <FolderPlus className="h-16 w-16 sm:h-20 sm:w-20 text-primary" aria-hidden="true" />
                        </div>
                        <DialogTitle className="text-lg sm:text-xl font-bold flex items-center gap-2 text-foreground">
                            <FolderPlus className="h-5 w-5 text-primary" aria-hidden="true" />
                            Add Roster Subgroup
                        </DialogTitle>
                        <DialogDescription id="central-add-subgroup-description" className="text-xs text-muted-foreground mt-1 leading-relaxed">
                            Create a new subgroup for managing shifts and assignments.
                        </DialogDescription>
                    </div>

                    {/* Body */}
                    <div className="p-6 sm:p-8 space-y-5 flex-1">
                        {/* Group Selector */}
                        <div className="space-y-2">
                            <Label 
                                htmlFor="target-group-select"
                                className="text-[10px] uppercase font-black tracking-[0.15em] text-muted-foreground flex items-center gap-2"
                            >
                                <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                                Target Group
                            </Label>
                            <Select value={groupExternalId} onValueChange={setGroupExternalId}>
                                <SelectTrigger 
                                    id="target-group-select"
                                    className="bg-muted/50 border-border rounded-xl h-11 text-foreground"
                                    aria-label="Select target group"
                                >
                                    <SelectValue placeholder="Select group..." />
                                </SelectTrigger>
                                <SelectContent className="bg-popover border-border text-popover-foreground shadow-xl rounded-xl">
                                    {GROUP_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value} className="cursor-pointer py-2.5">
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Period Selector */}
                        <div className="space-y-3">
                            <Label 
                                htmlFor="roster-period-select"
                                className="text-[10px] uppercase font-black tracking-[0.15em] text-muted-foreground flex items-center gap-2"
                            >
                                <CalendarRange className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                                Roster Period
                            </Label>
                            <Select value={preset} onValueChange={(val: any) => setPreset(val)}>
                                <SelectTrigger 
                                    id="roster-period-select"
                                    className="bg-muted/50 border-border rounded-xl h-11 text-foreground"
                                    aria-label="Select roster period"
                                >
                                    <SelectValue placeholder="Select period..." />
                                </SelectTrigger>
                                <SelectContent className="bg-popover border-border text-popover-foreground shadow-xl rounded-xl">
                                    <SelectItem value="current-month" className="cursor-pointer py-2.5">Current Month ({format(selectedDate, 'MMMM yyyy')})</SelectItem>
                                    <SelectItem value="next-month" className="cursor-pointer py-2.5">Next Month ({format(addMonths(selectedDate, 1), 'MMMM yyyy')})</SelectItem>
                                    <SelectItem value="this-week" className="cursor-pointer py-2.5">This Week</SelectItem>
                                    <SelectItem value="next-week" className="cursor-pointer py-2.5">Next Week</SelectItem>
                                    <SelectItem value="custom" className="cursor-pointer py-2.5">Custom Range...</SelectItem>
                                </SelectContent>
                            </Select>

                            {preset === 'custom' ? (
                                <div className="flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-300">
                                    <input
                                        type="date"
                                        value={customStart}
                                        onChange={(e) => setCustomStart(e.target.value)}
                                        aria-label="Start date"
                                        className="flex-1 h-10 rounded-lg border border-border bg-muted/50 px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                                    <input
                                        type="date"
                                        value={customEnd}
                                        onChange={(e) => setCustomEnd(e.target.value)}
                                        aria-label="End date"
                                        className="flex-1 h-10 rounded-lg border border-border bg-muted/50 px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                </div>
                            ) : (
                                <div className="text-[11px] text-muted-foreground font-semibold px-1">
                                    Range: <span className="text-foreground">{formattedRangeLabel}</span>
                                </div>
                            )}
                        </div>

                        {/* Subgroup Name */}
                        <div className="space-y-2">
                            <Label 
                                htmlFor="central-subgroup-name-input"
                                className="text-[10px] uppercase font-black tracking-[0.15em] text-muted-foreground flex items-center justify-between"
                            >
                                <span>Subgroup Name <span className="text-destructive">*</span></span>
                                <span className="text-[10px] font-normal tracking-normal text-muted-foreground">{name.length}/50</span>
                            </Label>
                            <Input
                                id="central-subgroup-name-input"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g. Morning Shift, Logistics Team"
                                className="bg-muted/50 border-border rounded-xl h-11 text-base sm:text-sm text-foreground placeholder:text-muted-foreground/60"
                                maxLength={50}
                                required
                                aria-required="true"
                            />
                        </div>
                    </div>

                    {/* Footer */}
                    <DialogFooter className="bg-muted/30 border-t border-border p-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5">
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => onOpenChange(false)}
                            disabled={addSubGroupMutation.isPending}
                            className="w-full sm:w-auto h-11 px-6 rounded-xl text-xs font-black uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-muted"
                            aria-label="Cancel and close dialog"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={!canSubmit}
                            className="w-full sm:w-auto h-11 px-8 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 font-black text-xs uppercase tracking-[0.15em] transition-all active:scale-95 flex items-center justify-center gap-2"
                            aria-label={addSubGroupMutation.isPending ? "Adding subgroup..." : "Add Subgroup"}
                            aria-busy={addSubGroupMutation.isPending}
                        >
                            {addSubGroupMutation.isPending ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                    <span>Adding...</span>
                                    <span className="sr-only">Adding subgroup, please wait...</span>
                                </>
                            ) : (
                                <>
                                    <FolderPlus className="h-4 w-4" aria-hidden="true" />
                                    <span>Add Subgroup</span>
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};
