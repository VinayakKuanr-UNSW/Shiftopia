import React, { useCallback, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { OpenBidsView } from '../views/OpenBidsView';
import type { BidToggle, ToggleCounts } from '../views/OpenBidsView/types';
import { useAuth } from '@/platform/auth/useAuth';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { GroupBySelector } from '@/modules/core/ui/components/GroupBySelector';
import type { RowGroupBy } from '@/modules/core/lib/row-grouping';
import { OPEN_BIDS_GROUP_BY_OPTIONS } from '../views/OpenBidsView/open-bids-grouping';
import { Button } from '@/modules/core/ui/primitives/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';
import { Gavel, Flame, Clock, CheckCircle, CircleSlash, Zap, Loader2, Filter, ChevronDown, Check } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';


const BID_TOGGLE_TABS: { id: BidToggle; label: string; icon: typeof Flame; accent: string }[] = [
    { id: 'standard', label: 'Standard', icon: Clock,       accent: 'amber' },
    { id: 'urgent',   label: 'Urgent',   icon: Flame,       accent: 'rose' },
    { id: 'resolved', label: 'Resolved', icon: CheckCircle, accent: 'emerald' },
    { id: 'expired',  label: 'Expired',  icon: CircleSlash, accent: 'slate' },
];

const bidAccentMap: Record<string, { bg: string; text: string; ring: string }> = {
    amber:   { bg: 'bg-amber-500/10',   text: 'text-amber-600 dark:text-amber-400',     ring: 'ring-amber-500/20' },
    rose:    { bg: 'bg-rose-500/10',    text: 'text-rose-600 dark:text-rose-400',       ring: 'ring-rose-500/20' },
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', ring: 'ring-emerald-500/20' },
    slate:   { bg: 'bg-muted/50',       text: 'text-muted-foreground',                 ring: 'ring-border' },
};

export const ManagerBidsPage: React.FC = () => {
    const { activeContract, user } = useAuth();
    const { scope, setScope, isGammaLocked } = useScopeFilter('managerial');
    const { isDark } = useTheme();


    const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
    const [searchQuery, setSearchQuery] = useState('');
    const [groupBy, setGroupBy] = useState<RowGroupBy>('none');
    const [activeToggle, setActiveToggle] = useState<BidToggle>('urgent');
    const [counts, setCounts] = useState<ToggleCounts>({ standard: 0, urgent: 0, resolved: 0, expired: 0 });
    const [autoAssign, setAutoAssign] = useState<{ run: () => void; isRunning: boolean }>({ run: () => {}, isRunning: false });
    // Bids are inherently forward-looking — default to a window that includes
    // upcoming open shifts (matches the employee bids page: −7 → +30 days).
    const [startDate, setStartDate] = useState<Date>(() => {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        return d;
    });
    const [endDate, setEndDate]     = useState<Date>(() => {
        const d = new Date();
        d.setDate(d.getDate() + 30);
        return d;
    });

    const handleAutoAssignReady = useCallback((fn: { run: () => void; isRunning: boolean }) => {
        setAutoAssign(fn);
    }, []);

    if (!activeContract) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground/40 font-mono text-xs uppercase tracking-widest bg-background">
                Please select a manager certificate to view open bids.
            </div>
        );
    }

    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const activeTabInfo = BID_TOGGLE_TABS.find(t => t.id === activeToggle) || BID_TOGGLE_TABS[0];
    const ActiveTabIcon = activeTabInfo.icon;
    const activeColors = bidAccentMap[activeTabInfo.accent];

    const statusFilterDropdown = (
        <Popover open={isFilterOpen} onOpenChange={setIsFilterOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label={`Filter by status: ${activeTabInfo.label}`}
                    className={cn(
                        'relative flex items-center gap-2 h-9 px-3 rounded-xl border text-[11px] font-black uppercase tracking-wider transition-all duration-200 shrink-0',
                        activeColors.bg, activeColors.text, activeColors.ring,
                        isDark ? 'hover:bg-white/10' : 'hover:bg-slate-100'
                    )}
                >
                    <Filter className="h-3.5 w-3.5 shrink-0" />
                    <span className="hidden sm:inline">Status: {activeTabInfo.label}</span>
                    <span className="sm:hidden">{activeTabInfo.label}</span>
                    <span className={cn(
                        'min-w-[18px] h-[18px] rounded-full text-[9px] font-mono font-bold flex items-center justify-center px-1',
                        'bg-primary/20 text-inherit'
                    )}>
                        {counts[activeToggle]}
                    </span>
                    <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2 bg-popover border-border rounded-2xl shadow-2xl" align="end">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground/60 px-2 pt-1 pb-2">
                    Filter by Status
                </p>
                <div className="flex flex-col gap-1" role="radiogroup">
                    {BID_TOGGLE_TABS.map(tab => {
                        const isSelected = activeToggle === tab.id;
                        const TabIcon = tab.icon;
                        const colors = bidAccentMap[tab.accent];
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                role="radio"
                                aria-checked={isSelected}
                                onClick={() => {
                                    setActiveToggle(tab.id);
                                    setIsFilterOpen(false);
                                }}
                                className={cn(
                                    'flex items-center justify-between h-9 px-2.5 rounded-xl text-[12px] font-bold transition-all text-left',
                                    isSelected
                                        ? `${colors.bg} ${colors.text}`
                                        : 'text-foreground/80 hover:bg-muted/60'
                                )}
                            >
                                <div className="flex items-center gap-2">
                                    <span className={cn(
                                        'flex h-4 w-4 items-center justify-center rounded-full border shrink-0',
                                        isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
                                    )}>
                                        {isSelected && <Check className="h-2.5 w-2.5" />}
                                    </span>
                                    <TabIcon className="h-3.5 w-3.5" />
                                    <span>{tab.label}</span>
                                </div>
                                <span className={cn(
                                    'px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold',
                                    isSelected ? `${colors.bg} ${colors.text}` : 'bg-muted text-muted-foreground/50'
                                )}>
                                    {counts[tab.id]}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </PopoverContent>
        </Popover>
    );

    const autoAssignButton = (
        <Button
            onClick={autoAssign.run}
            disabled={autoAssign.isRunning}
            size="sm"
            variant="outline"
            className="h-9 px-3 text-[10px] font-black uppercase tracking-wider rounded-2xl border-border bg-muted/30 hover:bg-muted/50 text-foreground flex-shrink-0"
            title="Manually trigger a batch run of safe bid assignments right now"
        >
            {autoAssign.isRunning ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Assigning…</>
            ) : (
                <><Zap className="h-3.5 w-3.5 mr-1.5 text-amber-400" /> Run Batch</>
            )}
        </Button>
    );

    return (
        <div className="h-full flex flex-col overflow-hidden bg-background">
            {/* ── GOLD STANDARD HEADER (Title · Scope · Function Bar) ── */}
            <GoldStandardHeader
                title="Open Bids Manager"
                Icon={Gavel}
                mode="managerial"
                scope={scope}
                setScope={setScope}
                isGammaLocked={isGammaLocked}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                leftContent={<GroupBySelector value={groupBy} onChange={setGroupBy} options={OPEN_BIDS_GROUP_BY_OPTIONS} />}
                startDate={startDate}
                endDate={endDate}
                onDateChange={(start: Date, end: Date) => {
                    setStartDate(start);
                    setEndDate(end);
                }}
                functionBarChildren={
                    <div className="flex items-center gap-2 flex-shrink-0">

                        {autoAssignButton}
                        {statusFilterDropdown}
                    </div>
                }
            />

            {/* ── BODY ── */}
            <div className="flex-1 min-h-0 overflow-hidden px-4 lg:px-6 pb-4 lg:pb-6">
                <div className={cn(
                    "h-full rounded-[32px] overflow-hidden transition-all border flex flex-col",
                    isDark
                        ? "bg-[#1c2333]/40 border-white/5 shadow-2xl shadow-black/20"
                        : "bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"
                )}>
                    <OpenBidsView
                        organizationId={scope.org_ids[0] ?? null}
                        departmentId={scope.dept_ids[0] ?? null}
                        subDepartmentId={scope.subdept_ids[0] ?? null}
                        externalSearchQuery={searchQuery}
                        viewMode={viewMode}
                        groupBy={groupBy}
                        activeToggle={activeToggle}
                        onToggleChange={setActiveToggle}
                        onCountsChange={setCounts}
                        onAutoAssignReady={handleAutoAssignReady}
                        startDate={startDate}
                        endDate={endDate}
                    />
                </div>
            </div>
        </div>
    );
};

export default ManagerBidsPage;
