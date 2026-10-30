import React, { useCallback, useState } from 'react';
import { OpenBidsView } from '../views/OpenBidsView';
import type { BidToggle, ToggleCounts } from '../views/OpenBidsView/types';
import { useAuth } from '@/platform/auth/useAuth';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { PageLayout } from '@/modules/core/ui/layout/PageLayout';
import type { RowGroupBy } from '@/modules/core/lib/row-grouping';
import { Gavel } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { surface } from '@/modules/core/ui/layout/pageTokens';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { soleOrgId, soleDeptId, soleSubDeptId } from '@/platform/auth/scope-narrowing';
import { OpenBidsFunctionBar } from '../components/OpenBidsFunctionBar';
import { computeRange, type ViewType, type DateRange } from '@/modules/rosters/domain/view-range';

const ManagerBidsPage: React.FC = () => {
    const { activeContract, hasPermission } = useAuth();
    // Delta and epsilon see every open bid in scope but assign none (access suites).
    const canEdit = hasPermission('managerial-write');
    const { scope, setScope, isGammaLocked } = useScopeFilter('managerial');

    const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
    const [groupBy, setGroupBy] = useState<RowGroupBy>('none');
    const [activeToggle, setActiveToggle] = useState<BidToggle>('urgent');
    const [counts, setCounts] = useState<ToggleCounts>({ standard: 0, urgent: 0, resolved: 0, expired: 0 });
    const [autoAssign, setAutoAssign] = useState<{ run: () => void; isRunning: boolean }>({ run: () => {}, isRunning: false });

    // Period / Date navigation: defaults to current month (matches forward-looking open bids)
    const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
    const [viewType, setViewType] = useState<ViewType>('month');
    const [startDate, setStartDate] = useState<Date>(() => computeRange(new Date(), 'month').start);
    const [endDate, setEndDate] = useState<Date>(() => computeRange(new Date(), 'month').end);

    const handleDateChange = useCallback((date: Date, newRange?: DateRange) => {
        setSelectedDate(date);
        const r = newRange ?? computeRange(date, viewType);
        setStartDate(r.start);
        setEndDate(r.end);
    }, [viewType]);

    const handleViewTypeChange = useCallback((newView: ViewType) => {
        setViewType(newView);
        const r = computeRange(selectedDate, newView);
        setStartDate(r.start);
        setEndDate(r.end);
    }, [selectedDate]);

    const handleAutoAssignReady = useCallback((fn: { run: () => void; isRunning: boolean }) => {
        setAutoAssign(fn);
    }, []);

    if (!activeContract) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground/40 font-mono text-[11px] uppercase tracking-widest bg-background">
                Please select a manager certificate to view open bids.
            </div>
        );
    }

    return (
        <PageLayout>
            {/* Ambient glow */}
            <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-primary/[0.05] blur-[150px] rounded-full pointer-events-none" />

            {/* ── GOLD STANDARD HEADER (Title · Scope · Function Bar) ── */}
            <GoldStandardHeader
                title="Open Bids Manager"
                Icon={Gavel}
                mode="managerial"
                scope={scope}
                setScope={setScope}
                isGammaLocked={isGammaLocked}
                functionBar={
                    <OpenBidsFunctionBar
                        viewMode={viewMode}
                        onViewModeChange={setViewMode}
                        selectedDate={selectedDate}
                        viewType={viewType}
                        onDateChange={handleDateChange}
                        onViewTypeChange={handleViewTypeChange}
                        onRangeChange={(r) => {
                            setStartDate(r.start);
                            setEndDate(r.end);
                        }}
                        groupBy={groupBy}
                        onGroupByChange={setGroupBy}
                        activeToggle={activeToggle}
                        onToggleChange={setActiveToggle}
                        counts={counts}
                        onRunBatch={autoAssign.run}
                        isBatchRunning={autoAssign.isRunning}
                        canRunBatch={canEdit}
                        compactOnMobile
                    />
                }
            />

            {/* ── ROW 3: CONTENT AREA ───────────────────────────────────────── */}
            <div className="flex-1 min-h-0 overflow-hidden">
                <div className={cn(
                    "h-full overflow-hidden flex flex-col",
                    surface.bodyCard
                )}>
                    {/* Narrow only when the selection is unambiguous: an
                        ORG-scoped manager has all 11 departments selected by
                        default, and `dept_ids[0]` filtered their bids to one
                        arbitrary department. */}
                    <OpenBidsView
                        organizationId={soleOrgId(scope)}
                        departmentId={soleDeptId(scope)}
                        subDepartmentId={soleSubDeptId(scope)}
                        viewMode={viewMode}
                        groupBy={groupBy}
                        activeToggle={activeToggle}
                        onToggleChange={setActiveToggle}
                        onCountsChange={setCounts}
                        onAutoAssignReady={handleAutoAssignReady}
                        readOnly={!canEdit}
                        startDate={startDate}
                        endDate={endDate}
                    />
                </div>
            </div>
        </PageLayout>
    );
};

export default ManagerBidsPage;
