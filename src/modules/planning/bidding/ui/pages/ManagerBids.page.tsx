import React, { useCallback, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { OpenBidsView } from '../views/OpenBidsView';
import type { BidToggle, ToggleCounts } from '../views/OpenBidsView/types';
import { useAuth } from '@/platform/auth/useAuth';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { Button } from '@/modules/core/ui/primitives/button';
import { Gavel, Flame, Clock, CheckCircle, CircleSlash, Zap, Loader2 } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { AutoPilotControl } from '@/modules/core/autopilot';
import { createBidAutoPilotAdapter } from '../../api/bidAutoPilot.api';

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

    const bidOrgId = scope.org_ids[0] ?? null;
    const autoPilotAdapter = useMemo(
        () => (bidOrgId ? createBidAutoPilotAdapter({ organizationId: bidOrgId, userId: user?.id }) : null),
        [bidOrgId, user?.id],
    );

    const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
    const [searchQuery, setSearchQuery] = useState('');
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

    const toggleChips = (
        <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-muted/30 border border-border flex-nowrap overflow-x-auto scrollbar-hide">
            {BID_TOGGLE_TABS.map(tab => {
                const isActive = activeToggle === tab.id;
                const colors = bidAccentMap[tab.accent];
                const TabIcon = tab.icon;
                return (
                    <button
                        key={tab.id}
                        onClick={() => setActiveToggle(tab.id)}
                        className={cn(
                            'relative flex items-center gap-2 px-3.5 py-2 rounded-xl text-[11px] font-black transition-all duration-300',
                            isActive
                                ? `${colors.bg} ${colors.text} shadow-sm`
                                : 'text-muted-foreground/50 hover:text-foreground hover:bg-muted/50'
                        )}
                    >
                        <TabIcon className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">{tab.label}</span>
                        <span className={cn(
                            'min-w-[18px] h-[18px] rounded-full text-[9px] font-black flex items-center justify-center px-1',
                            isActive ? `${colors.bg} ${colors.text} ring-1 ${colors.ring}` : 'bg-muted text-muted-foreground/40'
                        )}>
                            {counts[tab.id]}
                        </span>
                        {isActive && (
                            <motion.div
                                layoutId="activeBidTab"
                                className={`absolute inset-0 rounded-xl ring-1 ${colors.ring}`}
                                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                            />
                        )}
                    </button>
                );
            })}
        </div>
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
                startDate={startDate}
                endDate={endDate}
                onDateChange={(start: Date, end: Date) => {
                    setStartDate(start);
                    setEndDate(end);
                }}
                functionBarChildren={
                    <div className="flex items-center gap-2 flex-shrink-0">
                        {autoPilotAdapter && <AutoPilotControl adapter={autoPilotAdapter} />}
                        {autoAssignButton}
                        {toggleChips}
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
