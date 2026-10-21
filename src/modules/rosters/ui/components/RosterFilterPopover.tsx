import React from 'react';
import { Filter, X, Check } from 'lucide-react';
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
import { useRosterUI } from '@/modules/rosters/contexts/RosterUIContext';
import { cn } from '@/modules/core/lib/utils';

export const RosterFilterPopover: React.FC = () => {
    const {
        advancedFilters,
        setAdvancedFilters,
        resetAdvancedFilters,
        hasActiveFilters,
    } = useRosterUI();

    const handleFilterChange = (key: keyof typeof advancedFilters, value: string) => {
        setAdvancedFilters({ [key]: value === 'all' ? (key === 'stateId' ? null : 'all') : value });
    };

    // Counts every field selectHasActiveFilters checks, so the badge and the
    // pressed state agree (role, skills, compliance and search used to be left
    // out: the button showed "active" with no number).
    const activeCount = [
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

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label={`Roster filters${activeCount > 0 ? `, ${activeCount} active` : ''}`}
                    aria-pressed={hasActiveFilters}
                    className={cn(
                        "h-9 w-9 min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] sm:h-9 sm:w-9 flex items-center justify-center rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950 relative",
                        hasActiveFilters
                            ? "bg-slate-200 dark:bg-white/20 text-slate-900 dark:text-white font-bold shadow-sm"
                            : "text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10"
                    )}
                >
                    <Filter className="h-4 w-4" />
                    {activeCount > 0 && (
                        <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-orange-500 text-[8px] font-bold text-white shadow-sm pointer-events-none">
                            {activeCount > 9 ? '9+' : activeCount}
                        </span>
                    )}
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-4 bg-background/95 backdrop-blur-md border-border/50" align="end">
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h4 className="font-medium leading-none">Filters</h4>
                        {hasActiveFilters && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={resetAdvancedFilters}
                                className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
                            >
                                Reset
                            </Button>
                        )}
                    </div>

                    <div className="grid gap-4">
                        {/* State ID (S1-S15) */}
                        <div className="grid gap-2">
                            <Label htmlFor="stateId">State ID</Label>
                            <Select
                                value={advancedFilters.stateId || 'all'}
                                onValueChange={(v) => startTransition(() => handleFilterChange('stateId', (v === 'all' ? null : v) as any))}
                            >
                                <SelectTrigger id="stateId">
                                    <SelectValue placeholder="All States" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All States</SelectItem>
                                    {Array.from({ length: 15 }, (_, i) => `S${i + 1}`).map((id) => (
                                        <SelectItem key={id} value={id}>
                                            {id}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Lifecycle Status */}
                        <div className="grid gap-2">
                            <Label htmlFor="lifecycle">Lifecycle</Label>
                            <Select
                                value={advancedFilters.lifecycleStatus}
                                onValueChange={(v) => handleFilterChange('lifecycleStatus', v)}
                            >
                                <SelectTrigger id="lifecycle">
                                    <SelectValue placeholder="All Lifecycles" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All</SelectItem>
                                    <SelectItem value="draft">Draft</SelectItem>
                                    <SelectItem value="published">Published</SelectItem>
                                    <SelectItem value="cancelled">Cancelled</SelectItem>
                                    <SelectItem value="completed">Completed</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Assignment Status */}
                        <div className="grid gap-2">
                            <Label htmlFor="assignment">Assignment</Label>
                            <Select
                                value={advancedFilters.assignmentStatus}
                                onValueChange={(v) => handleFilterChange('assignmentStatus', v)}
                            >
                                <SelectTrigger id="assignment">
                                    <SelectValue placeholder="All Assignments" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All</SelectItem>
                                    <SelectItem value="unassigned">Unassigned</SelectItem>
                                    <SelectItem value="assigned">Assigned</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Assignment Outcome */}
                        <div className="grid gap-2">
                            <Label htmlFor="outcome">Outcome</Label>
                            <Select
                                value={advancedFilters.assignmentOutcome}
                                onValueChange={(v) => handleFilterChange('assignmentOutcome', v)}
                            >
                                <SelectTrigger id="outcome">
                                    <SelectValue placeholder="All Outcomes" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All</SelectItem>
                                    <SelectItem value="none">None</SelectItem>
                                    <SelectItem value="pending">Pending</SelectItem>
                                    <SelectItem value="offered">Offered</SelectItem>
                                    <SelectItem value="confirmed">Confirmed</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Bidding Status */}
                        <div className="grid gap-2">
                            <Label htmlFor="bidding">Bidding</Label>
                            <Select
                                value={advancedFilters.biddingStatus}
                                onValueChange={(v) => handleFilterChange('biddingStatus', v)}
                            >
                                <SelectTrigger id="bidding">
                                    <SelectValue placeholder="All Bidding" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All</SelectItem>
                                    <SelectItem value="not_on_bidding">Not on Bidding</SelectItem>
                                    <SelectItem value="on_bidding">On Bidding</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Trading Status */}
                        <div className="grid gap-2">
                            <Label htmlFor="trading">Trading</Label>
                            <Select
                                value={advancedFilters.tradingStatus}
                                onValueChange={(v) => handleFilterChange('tradingStatus', v)}
                            >
                                <SelectTrigger id="trading">
                                    <SelectValue placeholder="All Trading" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All</SelectItem>
                                    <SelectItem value="none">No Trade</SelectItem>
                                    <SelectItem value="requested">Trade Requested</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
};

// Start transition helper
function startTransition(callback: () => void) {
    callback();
}
