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
    startOfWeek,
    endOfWeek,
    addWeeks,
    addMonths,
} from 'date-fns';
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
        const weekOpts = { weekStartsOn: 1 as const };
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
                    start: startOfWeek(selectedDate, weekOpts),
                    end: endOfWeek(selectedDate, weekOpts),
                };
            case 'next-week':
                return {
                    start: startOfWeek(addWeeks(selectedDate, 1), weekOpts),
                    end: endOfWeek(addWeeks(selectedDate, 1), weekOpts),
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
            <DialogContent className="sm:max-w-[480px] bg-background border-border text-foreground shadow-2xl p-0 overflow-hidden ring-1 ring-border rounded-[2rem]">
                <form onSubmit={handleSubmit}>
                    {/* Header */}
                    <div className="relative p-8 pb-6 border-b border-border bg-muted/20">
                        <div className="absolute top-6 right-6 opacity-10">
                            <FolderPlus className="h-20 w-20 text-primary" />
                        </div>
                        <DialogTitle className="text-xl font-bold flex items-center gap-2">
                            <FolderPlus className="h-5 w-5 text-primary" />
                            Add Roster Subgroup
                        </DialogTitle>
                        <DialogDescription className="text-xs text-muted-foreground mt-2">
                            Create a new subgroup for managing shifts and assignments.
                        </DialogDescription>
                    </div>

                    {/* Body */}
                    <div className="p-8 space-y-6">
                        {/* Group Selector */}
                        <div className="space-y-2">
                            <Label className="text-[10px] uppercase font-black tracking-[0.15em] text-muted-foreground/75 flex items-center gap-2">
                                <Sparkles className="h-3.5 w-3.5" />
                                Target Group
                            </Label>
                            <Select value={groupExternalId} onValueChange={setGroupExternalId}>
                                <SelectTrigger className="bg-muted/50 border-border rounded-xl h-10">
                                    <SelectValue placeholder="Select group..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {GROUP_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Period Selector */}
                        <div className="space-y-3">
                            <Label className="text-[10px] uppercase font-black tracking-[0.15em] text-muted-foreground/75 flex items-center gap-2">
                                <CalendarRange className="h-3.5 w-3.5" />
                                Roster Period
                            </Label>
                            <Select value={preset} onValueChange={(val: any) => setPreset(val)}>
                                <SelectTrigger className="bg-muted/50 border-border rounded-xl h-10">
                                    <SelectValue placeholder="Select period..." />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="current-month">Current Month ({format(selectedDate, 'MMMM yyyy')})</SelectItem>
                                    <SelectItem value="next-month">Next Month ({format(addMonths(selectedDate, 1), 'MMMM yyyy')})</SelectItem>
                                    <SelectItem value="this-week">This Week</SelectItem>
                                    <SelectItem value="next-week">Next Week</SelectItem>
                                    <SelectItem value="custom">Custom Range...</SelectItem>
                                </SelectContent>
                            </Select>

                            {preset === 'custom' ? (
                                <div className="flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
                                    <input
                                        type="date"
                                        value={customStart}
                                        onChange={(e) => setCustomStart(e.target.value)}
                                        className="flex-1 h-9 rounded-lg border border-border bg-muted/50 px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                    <input
                                        type="date"
                                        value={customEnd}
                                        onChange={(e) => setCustomEnd(e.target.value)}
                                        className="flex-1 h-9 rounded-lg border border-border bg-muted/50 px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
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
                            <Label className="text-[10px] uppercase font-black tracking-[0.15em] text-muted-foreground/75">
                                Subgroup Name
                            </Label>
                            <Input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g. Morning Shift, Logistics Team"
                                className="bg-muted/50 border-border rounded-xl h-10"
                                maxLength={50}
                                required
                            />
                        </div>
                    </div>

                    {/* Footer */}
                    <DialogFooter className="bg-muted/30 border-t border-border p-6 flex-col sm:flex-row gap-3">
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => onOpenChange(false)}
                            disabled={addSubGroupMutation.isPending}
                            className="h-11 px-6 rounded-xl text-xs font-black uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-muted"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={!canSubmit}
                            className="flex-1 sm:flex-none h-11 px-8 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 font-black text-xs uppercase tracking-[0.15em] transition-all active:scale-95"
                        >
                            {addSubGroupMutation.isPending ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Adding...
                                </>
                            ) : (
                                <>
                                    <FolderPlus className="mr-2 h-4 w-4" />
                                    Add Subgroup
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};
