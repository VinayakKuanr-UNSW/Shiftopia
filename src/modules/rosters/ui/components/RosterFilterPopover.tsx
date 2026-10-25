import React, { useState, useEffect } from 'react';
import { Filter, Check, RotateCcw } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Label } from '@/modules/core/ui/primitives/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/modules/core/ui/primitives/select';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/modules/core/ui/primitives/popover';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import { useRosterUI, type AdvancedFilters } from '@/modules/rosters/contexts/RosterUIContext';
import { cn } from '@/modules/core/lib/utils';

export const RosterFilterPopover: React.FC = () => {
    const {
        advancedFilters,
        setAdvancedFilters,
        hasActiveFilters,
    } = useRosterUI();

    const [isOpen, setIsOpen] = useState(false);
    const [draftFilters, setDraftFilters] = useState<AdvancedFilters>(advancedFilters);

    // Sync draft filters whenever popover opens
    useEffect(() => {
        if (isOpen) {
            setDraftFilters(advancedFilters);
        }
    }, [isOpen, advancedFilters]);

    const handleDraftChange = (key: keyof AdvancedFilters, value: string) => {
        setDraftFilters((prev) => ({
            ...prev,
            [key]: value === 'all' ? (key === 'stateId' ? null : 'all') : value,
        }));
    };

    const handleReset = () => {
        setDraftFilters((prev) => ({
            ...prev,
            stateId: null,
            lifecycleStatus: 'all',
            assignmentStatus: 'all',
            assignmentOutcome: 'all',
            biddingStatus: 'all',
            tradingStatus: 'all',
        }));
    };

    const handleApply = () => {
        setAdvancedFilters(draftFilters);
        setIsOpen(false);
    };

    // Counts committed filters for the trigger badge
    const committedActiveCount = [
        advancedFilters.stateId,
        advancedFilters.lifecycleStatus !== 'all',
        advancedFilters.assignmentStatus !== 'all',
        advancedFilters.assignmentOutcome !== 'all',
        advancedFilters.biddingStatus !== 'all',
        advancedFilters.tradingStatus !== 'all',
        advancedFilters.roleId,
        advancedFilters.skillIds.length > 0,
        advancedFilters.complianceStatus !== 'all',
        advancedFilters.searchQuery.trim() !== '',
    ].filter(Boolean).length;

    // Counts draft filters for the header indicator and reset enablement
    const draftActiveCount = [
        draftFilters.stateId,
        draftFilters.lifecycleStatus !== 'all',
        draftFilters.assignmentStatus !== 'all',
        draftFilters.assignmentOutcome !== 'all',
        draftFilters.biddingStatus !== 'all',
        draftFilters.tradingStatus !== 'all',
    ].filter(Boolean).length;

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <TooltipProvider delayDuration={200}>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <PopoverTrigger asChild>
                            <button
                                type="button"
                                aria-label={`Roster filters${committedActiveCount > 0 ? `, ${committedActiveCount} active` : ''}`}
                                aria-pressed={hasActiveFilters}
                                className={cn(
                                    "h-10 w-10 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950 relative",
                                    hasActiveFilters
                                        ? "bg-amber-500/20 text-amber-700 dark:text-amber-300 font-bold border border-amber-500/30"
                                        : "text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/20"
                                )}
                            >
                                <Filter className="h-5 w-5" />
                                {committedActiveCount > 0 && (
                                    <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-orange-500 text-[11px] font-bold text-white shadow-sm pointer-events-none">
                                        {committedActiveCount > 9 ? '9+' : committedActiveCount}
                                    </span>
                                )}
                            </button>
                        </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent
                        side="bottom"
                        className="text-[11px] uppercase font-extrabold tracking-wider bg-slate-900 border border-slate-700 text-white shadow-xl px-2.5 py-1 rounded-md"
                    >
                        {committedActiveCount > 0 ? `Roster filters (${committedActiveCount} active)` : 'Roster filters'}
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>

            <PopoverContent
                className="w-80 sm:w-88 p-0 bg-white dark:bg-[#1a2333] rounded-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3)] border border-slate-200 dark:border-white/10 overflow-hidden z-50 animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-200"
                align="end"
                sideOffset={8}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-white/[0.02]">
                    <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
                            <Filter className="h-4 w-4" />
                        </div>
                        <div>
                            <h4 className="font-bold text-[13px] text-slate-800 dark:text-foreground leading-none">Filters</h4>
                            <p className="text-[11px] text-muted-foreground mt-0.5">Filter shifts across the roster</p>
                        </div>
                    </div>
                    {draftActiveCount > 0 && (
                        <span className="text-[11px] font-bold font-mono px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400">
                            {draftActiveCount} active
                        </span>
                    )}
                </div>

                {/* Filter Options */}
                <div className="p-4 space-y-3.5 max-h-[60vh] overflow-y-auto scrollbar-none">
                    {/* State ID (S1-S15) */}
                    <div className="space-y-1.5">
                        <Label htmlFor="stateId" className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                            State ID
                        </Label>
                        <Select
                            value={draftFilters.stateId || 'all'}
                            onValueChange={(v) => handleDraftChange('stateId', v)}
                        >
                            <SelectTrigger
                                id="stateId"
                                className="w-full h-11 px-3.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100/70 dark:bg-white/[0.04] text-[11px] font-semibold text-foreground hover:border-primary/40 focus:ring-2 focus:ring-primary focus:border-transparent transition-all shadow-none"
                            >
                                <SelectValue placeholder="All States" />
                            </SelectTrigger>
                            <SelectContent
                                position="popper"
                                className="bg-white dark:bg-[#1a2333] rounded-2xl border border-slate-200 dark:border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.25)] p-1.5 max-h-60 z-[60]"
                            >
                                <SelectItem value="all" className="rounded-xl py-2 pl-8 pr-3 text-[11px] font-medium cursor-pointer transition-colors focus:bg-primary focus:text-primary-foreground hover:bg-slate-100 dark:hover:bg-white/5">
                                    All States
                                </SelectItem>
                                {Array.from({ length: 15 }, (_, i) => `S${i + 1}`).map((id) => (
                                    <SelectItem key={id} value={id} className="rounded-xl py-2 pl-8 pr-3 text-[11px] font-medium cursor-pointer transition-colors focus:bg-primary focus:text-primary-foreground hover:bg-slate-100 dark:hover:bg-white/5">
                                        {id}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Lifecycle Status */}
                    <div className="space-y-1.5">
                        <Label htmlFor="lifecycle" className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                            Lifecycle
                        </Label>
                        <Select
                            value={draftFilters.lifecycleStatus}
                            onValueChange={(v) => handleDraftChange('lifecycleStatus', v)}
                        >
                            <SelectTrigger
                                id="lifecycle"
                                className="w-full h-11 px-3.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100/70 dark:bg-white/[0.04] text-[11px] font-semibold text-foreground hover:border-primary/40 focus:ring-2 focus:ring-primary focus:border-transparent transition-all shadow-none"
                            >
                                <SelectValue placeholder="All Lifecycles" />
                            </SelectTrigger>
                            <SelectContent
                                position="popper"
                                className="bg-white dark:bg-[#1a2333] rounded-2xl border border-slate-200 dark:border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.25)] p-1.5 max-h-60 z-[60]"
                            >
                                <SelectItem value="all" className="rounded-xl py-2 pl-8 pr-3 text-[11px] font-medium cursor-pointer transition-colors focus:bg-primary focus:text-primary-foreground hover:bg-slate-100 dark:hover:bg-white/5">
                                    All
                                </SelectItem>
                                <SelectItem value="draft" className="rounded-xl py-2 pl-8 pr-3 text-[11px] font-medium cursor-pointer transition-colors focus:bg-primary focus:text-primary-foreground hover:bg-slate-100 dark:hover:bg-white/5">
                                    Draft
                                </SelectItem>
                                <SelectItem value="published" className="rounded-xl py-2 pl-8 pr-3 text-[11px] font-medium cursor-pointer transition-colors focus:bg-primary focus:text-primary-foreground hover:bg-slate-100 dark:hover:bg-white/5">
                                    Published
                                </SelectItem>
                                <SelectItem value="cancelled" className="rounded-xl py-2 pl-8 pr-3 text-[11px] font-medium cursor-pointer transition-colors focus:bg-primary focus:text-primary-foreground hover:bg-slate-100 dark:hover:bg-white/5">
                                    Cancelled
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Assignment Status */}
                    <div className="space-y-1.5">
                        <Label htmlFor="assignment" className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                            Assignment
                        </Label>
                        <Select
                            value={draftFilters.assignmentStatus}
                            onValueChange={(v) => handleDraftChange('assignmentStatus', v)}
                        >
                            <SelectTrigger
                                id="assignment"
                                className="w-full h-11 px-3.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100/70 dark:bg-white/[0.04] text-[11px] font-semibold text-foreground hover:border-primary/40 focus:ring-2 focus:ring-primary focus:border-transparent transition-all shadow-none"
                            >
                                <SelectValue placeholder="All Assignments" />
                            </SelectTrigger>
                            <SelectContent
                                position="popper"
                                className="bg-white dark:bg-[#1a2333] rounded-2xl border border-slate-200 dark:border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.25)] p-1.5 max-h-60 z-[60]"
                            >
                                <SelectItem value="all" className="rounded-xl py-2 pl-8 pr-3 text-[11px] font-medium cursor-pointer transition-colors focus:bg-primary focus:text-primary-foreground hover:bg-slate-100 dark:hover:bg-white/5">
                                    All
                                </SelectItem>
                                <SelectItem value="unassigned" className="rounded-xl py-2 pl-8 pr-3 text-[11px] font-medium cursor-pointer transition-colors focus:bg-primary focus:text-primary-foreground hover:bg-slate-100 dark:hover:bg-white/5">
                                    Unassigned
                                </SelectItem>
                                <SelectItem value="assigned" className="rounded-xl py-2 pl-8 pr-3 text-[11px] font-medium cursor-pointer transition-colors focus:bg-primary focus:text-primary-foreground hover:bg-slate-100 dark:hover:bg-white/5">
                                    Assigned
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Assignment Outcome */}
                    <div className="space-y-1.5">
                        <Label htmlFor="outcome" className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                            Outcome
                        </Label>
                        <Select
                            value={draftFilters.assignmentOutcome}
                            onValueChange={(v) => handleDraftChange('assignmentOutcome', v)}
                        >
                            <SelectTrigger
                                id="outcome"
                                className="w-full h-11 px-3.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100/70 dark:bg-white/[0.04] text-[11px] font-semibold text-foreground hover:border-primary/40 focus:ring-2 focus:ring-primary focus:border-transparent transition-all shadow-none"
                            >
                                <SelectValue placeholder="All Outcomes" />
                            </SelectTrigger>
                            <SelectContent
                                position="popper"
                                className="bg-white dark:bg-[#1a2333] rounded-2xl border border-slate-200 dark:border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.25)] p-1.5 max-h-60 z-[60]"
                            >
                                <SelectItem value="all" className="rounded-xl py-2 pl-8 pr-3 text-[11px] font-medium cursor-pointer transition-colors focus:bg-primary focus:text-primary-foreground hover:bg-slate-100 dark:hover:bg-white/5">
                                    All
                                </SelectItem>
                                <SelectItem value="none" className="rounded-xl py-2 pl-8 pr-3 text-[11px] font-medium cursor-pointer transition-colors focus:bg-primary focus:text-primary-foreground hover:bg-slate-100 dark:hover:bg-white/5">
                                    None
                                </SelectItem>
                                <SelectItem value="pending" className="rounded-xl py-2 pl-8 pr-3 text-[11px] font-medium cursor-pointer transition-colors focus:bg-primary focus:text-primary-foreground hover:bg-slate-100 dark:hover:bg-white/5">
                                    Pending
                                </SelectItem>
                                <SelectItem value="offered" className="rounded-xl py-2 pl-8 pr-3 text-[11px] font-medium cursor-pointer transition-colors focus:bg-primary focus:text-primary-foreground hover:bg-slate-100 dark:hover:bg-white/5">
                                    Offered
                                </SelectItem>
                                <SelectItem value="confirmed" className="rounded-xl py-2 pl-8 pr-3 text-[11px] font-medium cursor-pointer transition-colors focus:bg-primary focus:text-primary-foreground hover:bg-slate-100 dark:hover:bg-white/5">
                                    Confirmed
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Bidding Status */}
                    <div className="space-y-1.5">
                        <Label htmlFor="bidding" className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                            Bidding
                        </Label>
                        <Select
                            value={draftFilters.biddingStatus}
                            onValueChange={(v) => handleDraftChange('biddingStatus', v)}
                        >
                            <SelectTrigger
                                id="bidding"
                                className="w-full h-11 px-3.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100/70 dark:bg-white/[0.04] text-[11px] font-semibold text-foreground hover:border-primary/40 focus:ring-2 focus:ring-primary focus:border-transparent transition-all shadow-none"
                            >
                                <SelectValue placeholder="All Bidding" />
                            </SelectTrigger>
                            <SelectContent
                                position="popper"
                                className="bg-white dark:bg-[#1a2333] rounded-2xl border border-slate-200 dark:border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.25)] p-1.5 max-h-60 z-[60]"
                            >
                                <SelectItem value="all" className="rounded-xl py-2 pl-8 pr-3 text-[11px] font-medium cursor-pointer transition-colors focus:bg-primary focus:text-primary-foreground hover:bg-slate-100 dark:hover:bg-white/5">
                                    All
                                </SelectItem>
                                <SelectItem value="not_on_bidding" className="rounded-xl py-2 pl-8 pr-3 text-[11px] font-medium cursor-pointer transition-colors focus:bg-primary focus:text-primary-foreground hover:bg-slate-100 dark:hover:bg-white/5">
                                    Not on Bidding
                                </SelectItem>
                                <SelectItem value="on_bidding" className="rounded-xl py-2 pl-8 pr-3 text-[11px] font-medium cursor-pointer transition-colors focus:bg-primary focus:text-primary-foreground hover:bg-slate-100 dark:hover:bg-white/5">
                                    On Bidding
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Trading Status */}
                    <div className="space-y-1.5">
                        <Label htmlFor="trading" className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                            Trading
                        </Label>
                        <Select
                            value={draftFilters.tradingStatus}
                            onValueChange={(v) => handleDraftChange('tradingStatus', v)}
                        >
                            <SelectTrigger
                                id="trading"
                                className="w-full h-11 px-3.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100/70 dark:bg-white/[0.04] text-[11px] font-semibold text-foreground hover:border-primary/40 focus:ring-2 focus:ring-primary focus:border-transparent transition-all shadow-none"
                            >
                                <SelectValue placeholder="All Trading" />
                            </SelectTrigger>
                            <SelectContent
                                position="popper"
                                className="bg-white dark:bg-[#1a2333] rounded-2xl border border-slate-200 dark:border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.25)] p-1.5 max-h-60 z-[60]"
                            >
                                <SelectItem value="all" className="rounded-xl py-2 pl-8 pr-3 text-[11px] font-medium cursor-pointer transition-colors focus:bg-primary focus:text-primary-foreground hover:bg-slate-100 dark:hover:bg-white/5">
                                    All
                                </SelectItem>
                                <SelectItem value="none" className="rounded-xl py-2 pl-8 pr-3 text-[11px] font-medium cursor-pointer transition-colors focus:bg-primary focus:text-primary-foreground hover:bg-slate-100 dark:hover:bg-white/5">
                                    No Trade
                                </SelectItem>
                                <SelectItem value="requested" className="rounded-xl py-2 pl-8 pr-3 text-[11px] font-medium cursor-pointer transition-colors focus:bg-primary focus:text-primary-foreground hover:bg-slate-100 dark:hover:bg-white/5">
                                    Trade Requested
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* Footer with Reset and Apply */}
                <div className="p-3 bg-slate-50/80 dark:bg-muted/20 border-t border-slate-200 dark:border-white/10 flex items-center justify-between">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleReset}
                        disabled={draftActiveCount === 0}
                        className="h-9 px-3 rounded-xl text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-slate-200/50 dark:hover:bg-white/10 disabled:opacity-40 transition-all"
                    >
                        <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                        Reset
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        onClick={handleApply}
                        className="h-9 px-4 rounded-xl text-[11px] font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-md active:scale-95 transition-all flex items-center gap-1.5"
                    >
                        <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                        Apply
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
};

export default RosterFilterPopover;
