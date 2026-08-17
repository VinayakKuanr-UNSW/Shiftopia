/**
 * TeamCoverageSummary — the five-concept KPI row.
 *
 * Exactly five tiles, one per concept: Required · Available · Assigned · Gap ·
 * Unset. Anything else that wants space here (the required-source, the expiry
 * count) is a qualifier, not a headline, and belongs in a badge or the banner —
 * a stat tile whose value is a word rather than a number is a form mismatch.
 *
 * `Unset` earns its tile deliberately. It rolls into "unavailable" everywhere
 * else in the app, and separating it is the whole point — a gap you can close by
 * chasing a declaration is a different job from one you cannot.
 */

import React from 'react';
import {
    AlertTriangle,
    CalendarClock,
    CheckCircle2,
    HelpCircle,
    UserCheck,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { STATUS, type StatusRole } from './coverage-palette';
import {
    REQUIRED_SOURCE_LABELS,
    type TeamAvailabilitySummary,
} from '../../model/team-availability.types';

interface TileProps {
    label: string;
    value: string;
    caption: string;
    Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
    status?: StatusRole;
}

const Tile: React.FC<TileProps> = ({ label, value, caption, Icon, status }) => {
    const { isDark } = useTheme();
    const tint = status ? STATUS[status] : undefined;

    return (
        <div
            className={cn(
                'rounded-2xl border p-4 transition-all duration-200 shadow-sm hover:shadow-md flex flex-col justify-between',
                isDark
                    ? 'bg-[#111827]/80 border-white/5 hover:border-primary/30'
                    : 'bg-white/90 border-slate-200/80 hover:border-primary/30',
            )}
        >
            <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/80 truncate">
                    {label}
                </span>
                <div
                    className={cn(
                        'p-2 rounded-xl shrink-0 flex items-center justify-center transition-colors',
                        status
                            ? 'bg-muted/40'
                            : 'bg-primary/10 text-primary dark:bg-primary/20 ring-1 ring-primary/20',
                    )}
                >
                    <Icon className="h-4 w-4 shrink-0" style={tint ? { color: tint } : undefined} />
                </div>
            </div>
            <div>
                <p
                    className="text-2xl lg:text-3xl font-black leading-none tracking-tight tabular-nums text-foreground"
                    style={tint ? { color: tint } : undefined}
                >
                    {value}
                </p>
                <p className="mt-2 text-[10px] font-semibold leading-tight text-muted-foreground line-clamp-2">
                    {caption}
                </p>
            </div>
        </div>
    );
};

interface Props {
    summary: TeamAvailabilitySummary;
    className?: string;
}

export const TeamCoverageSummary: React.FC<Props> = ({ summary, className }) => {
    const { isDark } = useTheme();
    const {
        memberCount,
        requiredHours,
        assignedHours,
        declaredCount,
        unsetCount,
        avgWeekdayAvailable,
        avgWeekendAvailable,
        gapHours,
        shortfallHours,
        shortfallDays,
        requiredSource,
    } = summary;

    const weekendDrop =
        avgWeekdayAvailable > 0
            ? Math.round((1 - avgWeekendAvailable / avgWeekdayAvailable) * 100)
            : 0;
    const coverPct =
        requiredHours > 0 ? Math.round((assignedHours / requiredHours) * 100) : 100;

    return (
        <div className={className}>
            {/* Source Badge Ribbon */}
            <div className="flex items-center justify-between gap-2 mb-2 px-1">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">
                        Required from
                    </span>
                    <span
                        className={cn(
                            'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-black uppercase tracking-wider border shadow-2xs',
                            isDark ? 'bg-[#111827] border-white/10' : 'bg-slate-100 border-slate-200',
                        )}
                        style={requiredSource === 'shifts' ? { color: STATUS.warning } : undefined}
                    >
                        <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                        {REQUIRED_SOURCE_LABELS[requiredSource]}
                    </span>
                    {requiredSource === 'shifts' && (
                        <span className="text-[10px] font-medium text-muted-foreground hidden sm:inline">
                            · Forecast demand not yet available
                        </span>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <Tile
                    label="Required"
                    value={`${requiredHours}h`}
                    caption="Staffed-hours needed"
                    Icon={CalendarClock}
                />
                <Tile
                    label="Available"
                    value={`${avgWeekdayAvailable} / ${avgWeekendAvailable}`}
                    caption={
                        weekendDrop > 0
                            ? `Mean weekday vs weekend (${weekendDrop}% drop)`
                            : 'Mean available per day'
                    }
                    Icon={CheckCircle2}
                    status={weekendDrop >= 25 ? 'serious' : undefined}
                />
                <Tile
                    label="Assigned"
                    value={`${assignedHours}h`}
                    caption={`${coverPct}% rostered · ${declaredCount}/${memberCount} declared`}
                    Icon={UserCheck}
                />
                <Tile
                    label="Gap"
                    value={gapHours === 0 ? 'None' : `${gapHours}h`}
                    caption={
                        shortfallHours > 0
                            ? `${shortfallHours}h unfillable across ${shortfallDays}d`
                            : 'All gaps coverable'
                    }
                    Icon={AlertTriangle}
                    status={shortfallHours > 0 ? 'critical' : gapHours > 0 ? 'warning' : 'good'}
                />
                <Tile
                    label="Not declared"
                    value={String(unsetCount)}
                    caption="No availability on file"
                    Icon={HelpCircle}
                    status={unsetCount > 0 ? 'serious' : 'good'}
                />
            </div>
        </div>
    );
};

export default TeamCoverageSummary;
