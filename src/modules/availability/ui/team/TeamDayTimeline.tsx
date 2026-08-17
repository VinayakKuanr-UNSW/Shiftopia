/**
 * TeamDayTimeline — the DAY view.
 *
 * A people × days grid collapses to a single useless column at a one-day span,
 * so Day swaps the composition instead of squeezing it: members down, hours
 * across, with the declared window and any assigned shift drawn as bars on the
 * same track. That is the view that answers "who can I still call for tonight".
 *
 * Bars are laid out as percentages of the visible hour window, which is derived
 * from the day's own data rather than fixed at 00–24 — a venue running 06:00 to
 * 23:00 should not spend a third of its width on empty night hours.
 */

import React from 'react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { normaliseInterval } from '../../domain/team-coverage';
import { CHROME, stateSoft } from './coverage-palette';
import {
    TEAM_DAY_STATE_LABELS,
    type TeamDayCell,
    type TeamMember,
} from '../../model/team-availability.types';

import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';

interface Props {
    members: ReadonlyArray<TeamMember>;
    /** yyyy-MM-dd — the single day being shown. */
    date: string;
    cells: Map<string, Map<string, TeamDayCell>>;
    onSelectMember?: (member: TeamMember) => void;
}

const NAME_COL = 180;
const ROW_H = 34;

const MemberContractsPopover: React.FC<{ member: TeamMember }> = ({ member }) => {
    const [open, setOpen] = React.useState(false);
    const contracts = member.contracts ?? [];
    const extraCount = contracts.length - 1;

    if (extraCount <= 0) return null;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        setOpen(!open);
                    }}
                    onMouseEnter={() => setOpen(true)}
                    onMouseLeave={() => setOpen(false)}
                    className="text-[9px] font-black uppercase tracking-wider px-1 py-0.2 rounded bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 shrink-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary ml-1"
                    aria-label={`View ${extraCount} additional contracts held by ${member.fullName}`}
                >
                    +{extraCount} more
                </button>
            </PopoverTrigger>
            <PopoverContent
                side="right"
                align="start"
                className="w-64 p-3 rounded-2xl border border-primary/20 shadow-2xl bg-popover/95 backdrop-blur-xl animate-in fade-in-50 zoom-in-95 duration-100 z-50 pointer-events-auto"
                onMouseEnter={() => setOpen(true)}
                onMouseLeave={() => setOpen(false)}
            >
                <div className="space-y-2">
                    <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
                        <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">
                            All Contracts ({contracts.length})
                        </span>
                        <span className="text-xs font-bold text-foreground truncate max-w-[120px]">
                            {member.fullName}
                        </span>
                    </div>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {contracts.map((c, i) => (
                            <div
                                key={i}
                                className="flex items-center justify-between gap-2 p-1.5 rounded-xl bg-muted/30 border border-border/20 text-xs"
                            >
                                <span className="font-bold text-foreground truncate">
                                    {c.roleName ?? 'No role'}
                                </span>
                                {c.employmentStatus && (
                                    <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-background text-muted-foreground border border-border/30 shrink-0">
                                        {c.employmentStatus}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
};

export const TeamDayTimeline: React.FC<Props> = ({ members, date, cells, onSelectMember }) => {
    const { isDark } = useTheme();

    // Fixed 00:00 to 24:00 (00:00) 24-hour day grid with 1-hour steps
    const fromHour = 0;
    const toHour = 24;
    const span = 24;
    const pct = (minutes: number) => (minutes / 60 / span) * 100;

    const hourTicks = React.useMemo(() => {
        const out: number[] = [];
        for (let h = 0; h <= 24; h += 1) out.push(h);
        return out;
    }, []);

    const gridline = isDark ? CHROME.gridline.dark : CHROME.gridline.light;

    if (members.length === 0) {
        return (
            <p className="text-xs font-semibold text-muted-foreground py-8 text-center">
                No team members match the current scope and filters.
            </p>
        );
    }

    return (
        <div className="px-1">
            <div className="flex items-baseline gap-2 mb-3 px-0.5">
                <h3 className="text-xs font-black uppercase tracking-[0.18em] text-foreground">
                    {format(parseISO(date), 'EEEE d MMMM')}
                </h3>
                <p className="text-[10px] font-semibold text-muted-foreground">
                    Declared windows and assigned shifts on one track
                </p>
            </div>

            {/* Hour axis */}
            <div className="flex items-end mb-1 pr-3" style={{ paddingLeft: NAME_COL }}>
                <div className="relative flex-1 h-4">
                    {hourTicks.map((h) => (
                        <span
                            key={h}
                            className="absolute text-[8px] font-black uppercase tracking-wider text-muted-foreground -translate-x-1/2"
                            style={{ left: `${pct(h * 60)}%` }}
                        >
                            {String(h % 24).padStart(2, '0')}
                        </span>
                    ))}
                </div>
            </div>

            <ul className="space-y-0.5">
                {members.map((member) => {
                    const cell = cells.get(member.profileId)?.get(date);
                    // Same tokens the grid uses, so switching Day → Week does not
                    // change what a colour means.
                    const soft = cell ? stateSoft(cell.state, isDark) : null;
                    const availSoft = stateSoft('available', isDark);
                    const shiftSoft = stateSoft('assigned', isDark);

                    return (
                        <li key={member.profileId} className="flex items-center pr-3">
                            <div style={{ width: NAME_COL, minWidth: NAME_COL }} className="pr-2">
                                <button
                                    type="button"
                                    onClick={() => onSelectMember?.(member)}
                                    className="text-left w-full rounded-lg px-1.5 py-1 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                >
                                    <span className="block text-[11px] font-bold text-foreground truncate">
                                        {member.fullName}
                                    </span>
                                     <span className="flex items-center gap-1 text-[9px] font-semibold text-muted-foreground truncate">
                                         <span className="truncate max-w-[80px]" title={member.roleName ?? 'No role'}>
                                             {member.roleName ?? 'No role'}
                                         </span>
                                         {member.employmentStatus && (
                                             <span className="text-[8px] font-black uppercase tracking-wider px-1 py-0.2 rounded bg-muted/80 text-muted-foreground shrink-0 border border-border/30">
                                                 {member.employmentStatus}
                                             </span>
                                         )}
                                         <MemberContractsPopover member={member} />
                                     </span>
                                </button>
                            </div>

                            <div
                                className="relative flex-1 rounded-md"
                                style={{ height: ROW_H, backgroundColor: `${gridline}55` }}
                            >
                                {/* Hour gridlines — recessive, behind the bars. */}
                                {hourTicks.map((h) => (
                                    <span
                                        key={h}
                                        className="absolute top-0 bottom-0 w-px"
                                        style={{ left: `${pct(h * 60)}%`, backgroundColor: gridline }}
                                        aria-hidden="true"
                                    />
                                ))}

                                {/* Declared availability */}
                                {cell?.windows.map((w, i) => {
                                    const { from, to } = normaliseInterval(w.start, w.end);
                                    return (
                                        <span
                                            key={`w-${i}`}
                                            className="absolute top-1.5 bottom-1.5 rounded-[4px]"
                                            style={{
                                                left: `${pct(from)}%`,
                                                width: `${pct(to) - pct(from)}%`,
                                                backgroundColor: availSoft.bg,
                                                border: `1px solid ${availSoft.border ?? 'transparent'}`,
                                            }}
                                            title={`Available ${w.start}–${w.end}`}
                                        />
                                    );
                                })}

                                {/* Assigned shifts sit on top, with a surface ring so an
                                    overlapping availability bar stays readable. */}
                                {cell?.shifts.map((s) => {
                                    const { from, to } = normaliseInterval(s.start, s.end);
                                    return (
                                        <span
                                            key={s.id}
                                            className="absolute top-[5px] bottom-[5px] rounded-[4px] flex items-center px-1.5 overflow-hidden"
                                            style={{
                                                left: `${pct(from)}%`,
                                                width: `${pct(to) - pct(from)}%`,
                                                backgroundColor: shiftSoft.mark,
                                                boxShadow: `0 0 0 2px ${isDark ? '#141c2e' : '#fcfcfd'}`,
                                            }}
                                            title={`Shift ${s.start}–${s.end}${s.roleName ? ` · ${s.roleName}` : ''}`}
                                        >
                                            <span className="text-[8px] font-black uppercase tracking-wider text-white truncate">
                                                {s.roleName ?? 'Shift'}
                                            </span>
                                        </span>
                                    );
                                })}

                                {/* States with no interval to draw get a word, not a blank row. */}
                                {cell && cell.windows.length === 0 && cell.shifts.length === 0 && (
                                    <span
                                        className={cn(
                                            'absolute inset-y-1.5 left-0 right-0 flex items-center justify-center gap-1.5 rounded-[4px] border text-[9px] font-black uppercase tracking-wider text-foreground',
                                            soft?.dashed && 'border-dashed',
                                        )}
                                        style={{
                                            backgroundColor: soft?.bg,
                                            borderColor: soft?.border ?? '#89878152',
                                        }}
                                    >
                                        {TEAM_DAY_STATE_LABELS[cell.state]}
                                    </span>
                                )}

                                <span className="sr-only">
                                    {`${member.fullName}: ${cell ? TEAM_DAY_STATE_LABELS[cell.state] : 'No data'}${
                                        cell?.windows.length
                                            ? `, available ${cell.windows.map((w) => `${w.start} to ${w.end}`).join(', ')}`
                                            : ''
                                    }${
                                        cell?.shifts.length
                                            ? `, assigned ${cell.shifts.map((s) => `${s.start} to ${s.end}`).join(', ')}`
                                            : ''
                                    }`}
                                </span>
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};

export default TeamDayTimeline;
