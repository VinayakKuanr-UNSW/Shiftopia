import React from 'react';
import { cn } from '@/modules/core/lib/utils';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { AlertTriangle, Calendar, Clock } from 'lucide-react';
import { format, parseISO, startOfWeek, addDays, getISOWeek, differenceInDays } from 'date-fns';

// =============================================================================
// STUDENT VISA VIZ (Weekly Bars)
// =============================================================================

interface StudentVisaVizProps {
    data: {
        weeks: {
            weekStartDate: string;
            currentHours: number;
            newHours: number;
            totalHours: number;
            limit: number;
        }[];
    };
    limit?: number;
}

export const StudentVisaViz: React.FC<StudentVisaVizProps> = ({ data, limit = 48 }) => {
    // If no data, return null or empty state
    if (!data?.weeks) return null;

    // Handle data format mismatch (Engine returns object, UI expected array)
    const weeksList = Array.isArray(data.weeks)
        ? data.weeks
        : Object.entries(data.weeks).map(([key, val]: [string, any]) => {
            // Parse ISO week string "2026-W05" to get a rough start date for display
            // Or just use the date range string provided by engine
            return {
                weekKey: key,
                weekStartDate: key, // We'll handle display below
                currentHours: 0, // Engine doesn't split per week yet
                newHours: 0,
                totalHours: val.hours || 0,
                limit: limit / 2, // Approx limit per week? Or just show total. 
                // Actually rule is 48h per FORTNIGHT. Showing per-week 24h limit is misleading.
                // But let's stick to showing usage.
                displayDate: val.dates // "14 Oct - 20 Oct"
            };
        });

    if (weeksList.length === 0) return null;

    return (
        <div className="space-y-3 pt-2">
            <div className="grid gap-4">
                {weeksList.map((week, idx) => {
                    const isOverLimit = week.totalHours > 24; // Arbitrary warning for single week > 24h? 
                    // Actually, let's just show the usage bar.

                    return (
                        <div key={idx} className="space-y-1">
                            <div className="flex justify-between text-xs">
                                <span className="text-white/60">
                                    {week.displayDate ? `Week: ${week.displayDate}` : week.weekKey}
                                </span>
                                <span className="text-white/80 font-mono font-medium">
                                    {week.totalHours.toFixed(1)}h
                                </span>
                            </div>

                            <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden flex relative">
                                <div
                                    className={cn(
                                        "h-full transition-all duration-500",
                                        "bg-purple-500"
                                    )}
                                    style={{ width: `${Math.min(100, (week.totalHours / 48) * 100)}%` }} // Scale against 48h max?
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="text-xs text-white/40 italic">
                * Chart shows weekly breakdown. 48h limit applies to any 2 consecutive weeks.
            </div>
        </div>
    );
};

// =============================================================================
// DAILY HOURS VIZ (Multi-Day Bars)
// =============================================================================

interface DailyHoursVizProps {
    // Single day data (legacy format)
    data?: {
        date?: string;
        target_date?: string;
        existingHours?: number;
        existing_hours?: number;
        newHours?: number;
        candidate_hours?: number;
        limit: number;
    };
    // Multi-day aggregated data (new format) 
    dailyData?: Map<string, { existing: number; candidate: number; limit: number }>;
}

export const DailyHoursViz: React.FC<DailyHoursVizProps> = ({ data, dailyData }) => {
    // Convert to array of days for rendering
    const days: { date: string; existing: number; candidate: number; limit: number }[] = [];

    if (dailyData && dailyData.size > 0) {
        // Use multi-day data
        dailyData.forEach((value, key) => {
            days.push({
                date: key,
                existing: value.existing,
                candidate: value.candidate,
                limit: value.limit
            });
        });
        // Sort by date
        days.sort((a, b) => a.date.localeCompare(b.date));
    } else if (data) {
        // Fallback to single day data
        const dateStr = data.date || data.target_date;
        if (dateStr) {
            days.push({
                date: dateStr,
                existing: data.existingHours ?? data.existing_hours ?? 0,
                candidate: data.newHours ?? data.candidate_hours ?? 0,
                limit: data.limit || 12
            });
        }
    }

    if (days.length === 0) return null;

    return (
        <div className="space-y-3 pt-2">
            {days.map((day, idx) => {
                const total = day.existing + day.candidate;
                const isOver = total > day.limit;
                const existingPct = Math.min(100, (day.existing / (day.limit + 2)) * 100);
                const newPct = Math.min(100, (day.candidate / (day.limit + 2)) * 100);

                let formattedDate = day.date;
                try {
                    formattedDate = format(parseISO(day.date), 'EEE, MMM d');
                } catch (e) {
                    // Fallback if date parse fails
                }

                return (
                    <div key={day.date} className="space-y-1">
                        <div className="flex justify-between text-xs">
                            <span className="text-white/60">
                                {formattedDate}
                            </span>
                            <span className={cn(
                                "font-mono font-medium",
                                isOver ? "text-red-400" : "text-white/80"
                            )}>
                                {total.toFixed(1)}h / {day.limit}h
                            </span>
                        </div>

                        <div className="h-3 w-full bg-slate-800 rounded-md overflow-hidden flex relative">
                            {/* Limit line */}
                            <div
                                className="absolute top-0 bottom-0 w-0.5 bg-red-500/50 z-10"
                                style={{ left: `${(day.limit / (day.limit + 2)) * 100}%` }}
                                title="Limit"
                            />

                            {/* Existing */}
                            <div
                                className="h-full bg-slate-600"
                                style={{ width: `${existingPct}%` }}
                                title={`Existing: ${day.existing.toFixed(1)}h`}
                            />

                            {/* Candidate */}
                            <div
                                className={cn(
                                    "h-full relative",
                                    isOver ? "bg-red-500/80" : "bg-purple-500"
                                )}
                                style={{ width: `${newPct}%` }}
                                title={`Candidate: ${day.candidate.toFixed(1)}h`}
                            />
                        </div>
                    </div>
                );
            })}

            {/* Legend - only show once at the bottom */}
            <div className="flex gap-4 text-[10px] text-white/50 pt-1">
                <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-slate-600" />
                    Existing
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-purple-500" />
                    Candidate Shift
                </div>
            </div>
        </div>
    );
};

// =============================================================================
// SHIFT LENGTH VIZ (Individual Shift Bars)
// Shows each shift with its duration as Xh/12h
// =============================================================================

interface ShiftLengthVizProps {
    data?: {
        shifts_list?: { time: string; net_hours: number; date?: string }[];
        limit?: number;
    };
    // Aggregated from multiple shifts
    aggregatedShifts?: { date: string; time: string; net_hours: number }[];
}

export const ShiftLengthViz: React.FC<ShiftLengthVizProps> = ({ data, aggregatedShifts }) => {
    const limit = data?.limit || 12;

    // Use aggregated if available, otherwise extract from data
    let shifts: { date: string; time: string; net_hours: number }[] = [];

    if (aggregatedShifts && aggregatedShifts.length > 0) {
        shifts = aggregatedShifts;
    } else if (data?.shifts_list) {
        shifts = data.shifts_list.map(s => ({
            date: s.date || '',
            time: s.time,
            net_hours: s.net_hours
        }));
    }

    if (shifts.length === 0) return null;

    // Sort by date
    shifts.sort((a, b) => a.date.localeCompare(b.date));

    return (
        <div className="space-y-2 pt-2">
            {shifts.map((shift, idx) => {
                const isOver = shift.net_hours > limit;
                const pct = Math.min(100, (shift.net_hours / limit) * 100);

                let formattedDate = shift.date;
                try {
                    if (shift.date) {
                        formattedDate = format(parseISO(shift.date), 'EEE, MMM d');
                    }
                } catch (e) { }

                return (
                    <div key={`${shift.date}-${idx}`} className="space-y-1">
                        <div className="flex justify-between items-center text-xs">
                            <span className="text-white/70">
                                {formattedDate}: <span className="text-white/50">{shift.time}</span>
                            </span>
                            <span className={cn(
                                "font-mono font-medium",
                                isOver ? "text-red-400" : "text-white/80"
                            )}>
                                {shift.net_hours.toFixed(1)}h / {limit}h
                            </span>
                        </div>
                        <div className="h-2.5 w-full bg-slate-800 rounded-full overflow-hidden relative">
                            {/* Limit line at 100% */}
                            <div
                                className="absolute right-0 top-0 bottom-0 w-0.5 bg-red-500/40 z-10"
                                title="12h limit"
                            />
                            <div
                                className={cn(
                                    "h-full rounded-full transition-all",
                                    isOver ? "bg-red-500" : "bg-emerald-500"
                                )}
                                style={{ width: `${pct}%` }}
                            />
                        </div>
                    </div>
                );
            })}

            <div className="flex gap-4 text-[10px] text-white/40 pt-1">
                <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    Within Limit
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                    Exceeds Limit
                </div>
            </div>
        </div>
    );
};

// =============================================================================
// REST PERIOD VIZ (Day-by-Day Rest Impact)
// Shows rest gaps before/after each candidate shift
// =============================================================================

interface RestImpact {
    date: string;
    shift_time: string;
    rest_before_hours: number | null;
    rest_before_from?: string; // "Feb 1 @ 22:00"
    rest_after_hours: number | null;
    rest_after_to?: string; // "Feb 3 @ 06:00"
    limit: number;
}

interface RestPeriodVizProps {
    data?: {
        prev_day_gap_hours?: number | null;
        next_day_gap_hours?: number | null;
        target_date?: string;
        limit?: number;
    };
    // Aggregated from multiple shifts
    restImpacts?: RestImpact[];
}

export const RestPeriodViz: React.FC<RestPeriodVizProps> = ({ data, restImpacts }) => {
    const limit = data?.limit || 8;

    // Build impacts array
    let impacts: RestImpact[] = [];

    if (restImpacts && restImpacts.length > 0) {
        impacts = restImpacts;
    } else if (data) {
        impacts = [{
            date: data.target_date || '',
            shift_time: '',
            rest_before_hours: data.prev_day_gap_hours ?? null,
            rest_after_hours: data.next_day_gap_hours ?? null,
            limit: limit
        }];
    }

    if (impacts.length === 0) return null;

    // Sort by date
    impacts.sort((a, b) => a.date.localeCompare(b.date));

    return (
        <div className="space-y-3 pt-2">
            {impacts.map((impact, idx) => {
                const beforeViolation = impact.rest_before_hours !== null && impact.rest_before_hours < limit;
                const afterViolation = impact.rest_after_hours !== null && impact.rest_after_hours < limit;

                let formattedDate = impact.date;
                try {
                    if (impact.date) {
                        formattedDate = format(parseISO(impact.date), 'EEE, MMM d');
                    }
                } catch (e) { }

                return (
                    <div key={`${impact.date}-${idx}`} className="bg-slate-900/50 rounded-lg p-3 border border-white/10">
                        <div className="text-xs font-medium text-white/80 mb-2">
                            {formattedDate} {impact.shift_time && <span className="text-white/50">({impact.shift_time})</span>}
                        </div>

                        <div className="space-y-1.5 text-xs">
                            {/* Rest Before */}
                            <div className="flex items-center gap-2">
                                <span className="text-white/40 w-20">← Before:</span>
                                {impact.rest_before_hours !== null ? (
                                    <>
                                        <span className={cn(
                                            "font-mono font-medium",
                                            beforeViolation ? "text-red-400" : "text-emerald-400"
                                        )}>
                                            {impact.rest_before_hours.toFixed(1)}h
                                        </span>
                                        {beforeViolation ? (
                                            <span className="text-red-400 text-[10px]">⚠️ &lt; {limit}h</span>
                                        ) : (
                                            <span className="text-emerald-400 text-[10px]">✓</span>
                                        )}
                                        {impact.rest_before_from && (
                                            <span className="text-white/30 text-[10px]">from {impact.rest_before_from}</span>
                                        )}
                                    </>
                                ) : (
                                    <span className="text-white/30">No previous shift</span>
                                )}
                            </div>

                            {/* Rest After */}
                            <div className="flex items-center gap-2">
                                <span className="text-white/40 w-20">→ After:</span>
                                {impact.rest_after_hours !== null ? (
                                    <>
                                        <span className={cn(
                                            "font-mono font-medium",
                                            afterViolation ? "text-red-400" : "text-emerald-400"
                                        )}>
                                            {impact.rest_after_hours.toFixed(1)}h
                                        </span>
                                        {afterViolation ? (
                                            <span className="text-red-400 text-[10px]">⚠️ &lt; {limit}h</span>
                                        ) : (
                                            <span className="text-emerald-400 text-[10px]">✓</span>
                                        )}
                                        {impact.rest_after_to && (
                                            <span className="text-white/30 text-[10px]">to {impact.rest_after_to}</span>
                                        )}
                                    </>
                                ) : (
                                    <span className="text-white/30">No next shift</span>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}

            <div className="text-[10px] text-white/40 italic">
                * Minimum required rest between consecutive days is {limit} hours
            </div>
        </div>
    );
};

// =============================================================================
// STREAK VIZ (Calendar Strip)
// Shows consecutive working days in a horizontal strip
// =============================================================================

interface StreakVizProps {
    data: {
        streak_days?: number;
        streak_start?: string;
        streak_end?: string;
        all_working_dates?: string[];
        limit?: number;
        // Legacy format
        streakDays?: string[];
    };
}

export const StreakViz: React.FC<StreakVizProps> = ({ data }) => {
    // Support both new and legacy data formats
    const limit = data.limit || 12;

    // Get streak days array
    let streakDays: string[] = [];
    if (data.all_working_dates && data.all_working_dates.length > 0) {
        streakDays = data.all_working_dates;
    } else if (data.streakDays && data.streakDays.length > 0) {
        streakDays = data.streakDays;
    } else if (data.streak_start && data.streak_end) {
        // Generate dates from start to end
        let current = parseISO(data.streak_start);
        const end = parseISO(data.streak_end);
        while (current <= end) {
            streakDays.push(format(current, 'yyyy-MM-dd'));
            current = addDays(current, 1);
        }
    }

    if (streakDays.length === 0) return null;

    // Sort dates
    streakDays.sort((a, b) => a.localeCompare(b));

    const start = parseISO(streakDays[0]);
    const end = parseISO(streakDays[streakDays.length - 1]);
    const count = streakDays.length;
    const isOver = count > limit;

    return (
        <div className="pt-2">
            <div className="bg-slate-900/50 rounded-lg p-3 border border-white/10">
                <div className="flex items-center gap-3 mb-3">
                    <div className={cn(
                        "px-2 py-1 rounded text-xs font-bold",
                        isOver ? "bg-red-500/20 text-red-400" : "bg-emerald-500/20 text-emerald-400"
                    )}>
                        {count} Consecutive Days
                    </div>
                    <span className="text-xs text-white/60">
                        ({format(start, 'MMM d')} — {format(end, 'MMM d')})
                    </span>
                </div>

                <div className="flex gap-1 overflow-x-auto pb-2">
                    {streakDays.map((dateStr, idx) => {
                        const isViolationDay = idx >= limit;
                        return (
                            <div key={dateStr} className="flex flex-col items-center gap-1 min-w-[24px]">
                                <div className={cn(
                                    "w-6 h-6 rounded flex items-center justify-center text-[10px] font-medium border",
                                    isViolationDay
                                        ? "bg-red-500/20 border-red-500/50 text-red-200"
                                        : "bg-slate-700 border-slate-600 text-white"
                                )}>
                                    {format(parseISO(dateStr), 'd')}
                                </div>
                                <span className="text-[9px] text-white/30 uppercase">
                                    {format(parseISO(dateStr), 'EEEEE')}
                                </span>
                            </div>
                        );
                    })}
                </div>
                {isOver && (
                    <div className="text-[10px] text-red-400 flex items-center gap-1 mt-1">
                        <AlertTriangle className="h-3 w-3" />
                        Maximum is {limit} consecutive days
                    </div>
                )}
            </div>
        </div>
    );
};
