/**
 * compliance-display.tsx
 *
 * Shared compliance display utilities and components (Bucketed Table Layout).
 * Used by ManagerSwaps.page.tsx and any other detailed compliance views.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    CheckCircle2,
    XCircle,
    AlertTriangle,
    Circle,
    Shield,
    Calendar,
    Clock,
    Layers,
    Moon,
    Zap,
    TimerIcon,
    FileCheck,
    BadgeCheck,
    ChevronDown,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { ConstraintViolation } from '@/modules/compliance';

// =============================================================================
// TYPES
// =============================================================================

export type Bucket = 'A' | 'B' | 'C' | 'D';

export interface GroupedConstraint {
    id: string;
    name: string;
    bucket: Bucket;
    requesterResult: ConstraintViolation | undefined;
    offererResult: ConstraintViolation | undefined;
    rowStatus: 'pass' | 'fail' | 'warning' | 'pending';
    blocking: boolean;
}

// =============================================================================
// BUCKET META
// =============================================================================

export const BUCKET_META: Record<Bucket, { label: string; color: string; dot: string }> = {
    A: { label: 'BLOCKERS', color: 'text-rose-500',    dot: 'bg-rose-500 animate-pulse' },
    B: { label: 'WARNINGS', color: 'text-amber-500',   dot: 'bg-amber-500' },
    C: { label: 'PASSED',   color: 'text-emerald-500', dot: 'bg-emerald-500' },
    D: { label: 'SYSTEM',   color: 'text-blue-500',    dot: 'bg-blue-500' },
};

// =============================================================================
// HELPERS (pure functions)
// =============================================================================

export function getBucket(id: string, status: string, blocking: boolean): Bucket {
    if (['ROLE_CONTRACT_MATCH', 'QUALIFICATION_MATCH', 'QUALIFICATION_EXPIRY'].includes(id)) return 'A';
    if (status === 'fail' && blocking) return 'B';
    if (status === 'fail' || status === 'warning') return 'B';
    return 'C';
}

export function overallRowStatus(
    req?: ConstraintViolation,
    off?: ConstraintViolation
): 'pass' | 'fail' | 'warning' | 'pending' {
    const s = [req?.status, off?.status].filter(Boolean) as string[];
    if (s.includes('fail')) return 'fail';
    if (s.includes('warning')) return 'warning';
    if (s.includes('pass')) return 'pass';
    return 'pending';
}

export function groupConstraints(
    allResults: ConstraintViolation[],
    requesterId: string,
    offererId: string
): GroupedConstraint[] {
    const map = new Map<string, { name: string; req?: ConstraintViolation; off?: ConstraintViolation }>();
    for (const r of allResults) {
        if (!map.has(r.constraint_id)) map.set(r.constraint_id, { name: r.constraint_name });
        const entry = map.get(r.constraint_id)!;
        if (r.employee_id === requesterId) entry.req = r;
        else if (r.employee_id === offererId) entry.off = r;
    }
    return Array.from(map.entries()).map(([id, { name, req, off }]) => {
        const rowStatus = overallRowStatus(req, off);
        const blocking = (req?.blocking || off?.blocking) ?? false;
        return {
            id,
            name,
            bucket: getBucket(id, rowStatus, blocking),
            requesterResult: req,
            offererResult: off,
            rowStatus,
            blocking,
        };
    });
}

export function groupByBucket(grouped: GroupedConstraint[]): Record<Bucket, GroupedConstraint[]> {
    const b: Record<Bucket, GroupedConstraint[]> = { A: [], B: [], C: [], D: [] };
    for (const g of grouped) b[g.bucket].push(g);
    return b;
}

// =============================================================================
// QUALIFICATION FILTER HELPERS
// =============================================================================

export const QUAL_FILTERS: Record<string, (v: any) => boolean> = {
    ROLE_CONTRACT_MATCH:  v => v.type === 'ROLE_MISMATCH',
    QUALIFICATION_MATCH:  v => v.type === 'SKILL_MISSING' || v.type === 'LICENSE_MISSING',
    QUALIFICATION_EXPIRY: v => v.type === 'SKILL_EXPIRED'  || v.type === 'LICENSE_EXPIRED',
};

export const QUAL_NAMES: Record<string, string> = {
    ROLE_CONTRACT_MATCH:  'Role Contract Match',
    QUALIFICATION_MATCH:  'Qualification & Certification',
    QUALIFICATION_EXPIRY: 'Qualification Expiry',
};

// =============================================================================
// UI COMPONENTS
// =============================================================================

export function constraintIcon(id: string) {
    switch (id) {
        case 'NO_OVERLAP': return <Layers className="h-4 w-4" />;
        case 'MAX_DAILY_HOURS': return <Clock className="h-4 w-4" />;
        case 'MIN_REST_GAP': return <Moon className="h-4 w-4" />;
        case 'STUDENT_VISA_48H': return <Zap className="h-4 w-4" />;
        case 'WORKING_DAYS_CAP': return <Calendar className="h-4 w-4" />;
        case 'AVG_FOUR_WEEK_CYCLE': return <TimerIcon className="h-4 w-4" />;
        case 'ROLE_CONTRACT_MATCH': return <FileCheck className="h-4 w-4" />;
        case 'QUALIFICATION_MATCH':
        case 'QUALIFICATION_EXPIRY': return <BadgeCheck className="h-4 w-4" />;
        default: return <Shield className="h-4 w-4" />;
    }
}

export function StatusIcon({ status, size = 4 }: { status: string; size?: number }) {
    const cls = `h-${size} w-${size}`;
    if (status === 'pass')    return <CheckCircle2 className={cn(cls, 'text-emerald-500')} />;
    if (status === 'fail')    return <XCircle      className={cn(cls, 'text-rose-500')} />;
    if (status === 'warning') return <AlertTriangle className={cn(cls, 'text-amber-500')} />;
    return <Circle className={cn(cls, 'text-muted-foreground/30')} />;
}

export function StatusBadge({ status, label }: { status: string; label: string }) {
    const cls = status === 'pass'    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' :
                status === 'fail'    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20' :
                status === 'warning' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' :
                                      'bg-muted/50 text-muted-foreground/40 border-border';
    return (
        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[9px] font-black uppercase tracking-wider', cls)}>
            {label}
        </span>
    );
}

export function NumberPill({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
    return (
        <div className={cn('px-2 py-1 rounded-md border text-center flex-1', highlight ? 'bg-rose-500/5 border-rose-500/20' : 'bg-muted/50 border-border')}>
            <div className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/50">{label}</div>
            <div className={cn('text-xs font-black', highlight ? 'text-rose-500' : 'text-foreground')}>{value}</div>
        </div>
    );
}

export function ConstraintDetailPanel({ violation }: { violation: ConstraintViolation }) {
    const calc = violation.calculation as Record<string, any>;
    const id = violation.constraint_id;

    if (violation.status === 'pass') {
        return (
            <div className="flex items-center gap-2 p-3 bg-emerald-500/5 rounded-lg border border-emerald-500/20 text-xs text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                {violation.details || 'All checks passed.'}
            </div>
        );
    }

    if (id === 'AVG_FOUR_WEEK_CYCLE') {
        const weeklyLimit = calc.weekly_limit ?? 38;
        type CycleEntry = { weeks: number; total_hours: number; limit: number; average_weekly_hours: number; status: string };
        const cycles: CycleEntry[] = calc.all_cycles ?? [{
            weeks: calc.cycle_weeks ?? 4,
            total_hours: calc.total_hours ?? 0,
            limit: calc.limit ?? 0,
            average_weekly_hours: calc.average_weekly_hours ?? 0,
            status: violation.status,
        }];
        return (
            <div className="space-y-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">
                    Rolling window check · max {weeklyLimit}h/wk avg
                </div>
                {cycles.map(c => {
                    const isFail = c.status === 'fail';
                    return (
                        <div key={c.weeks} className={cn('p-3 rounded-lg border', isFail ? 'bg-rose-500/5 border-rose-500/20' : 'bg-muted/30 border-border')}>
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">{c.weeks}-Week window</span>
                                {isFail && <span className="text-[9px] font-black px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-500 border border-rose-500/20 uppercase tracking-widest">EXCEEDS LIMIT</span>}
                            </div>
                            <div className="flex items-baseline gap-3">
                                <span className={cn('text-2xl font-black', isFail ? 'text-rose-500' : 'text-foreground')}>{c.total_hours.toFixed(1)}h</span>
                                <span className="text-xs text-muted-foreground/50">avg {c.average_weekly_hours.toFixed(1)}h/wk · limit {c.limit}h ({weeklyLimit}h/wk × {c.weeks}wk)</span>
                            </div>
                            <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div className={cn('h-full rounded-full', isFail ? 'bg-rose-500' : 'bg-emerald-500')}
                                    style={{ width: `${Math.min((c.total_hours / Math.max(c.limit, 1)) * 100, 100)}%` }} />
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    }

    if (id === 'STUDENT_VISA_48H') {
        const limit = calc.limit ?? 48;
        const isEnforced = calc.enforcement_enabled ?? false;
        const hasWeeks = calc.weeks && typeof calc.weeks === 'object' && !Array.isArray(calc.weeks);
        const weeksData = hasWeeks ? calc.weeks as Record<string, { hours: number; dates: string }> : {};
        const weekKeys = Object.keys(weeksData).sort();
        const windows: Array<{ weeks: string[]; hours: number; status: string }> = calc.windows_evaluated ?? [];
        const violations: Array<{ weeks: string[]; hours: number }> = calc.violations ?? [];
        const violatingWeeks = new Set<string>(violations.flatMap(v => v.weeks));
        const worstWindow = windows.reduce((best, w) => w.hours > (best?.hours ?? 0) ? w : best, windows[0]);

        return (
            <div className="space-y-3">
                <div className={cn('flex items-center gap-2 p-3 rounded-lg border text-xs',
                    isEnforced ? 'bg-rose-500/5 border-rose-500/20 text-rose-700 dark:text-rose-300' : 'bg-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-300')}>
                    <Zap className="h-4 w-4 shrink-0" />
                    <span>
                        <strong>Limit: {limit}h / fortnight</strong>
                        {isEnforced
                            ? ' — Enforcement ON (blocking)'
                            : ' — Enforcement OFF (warning only)'}
                    </span>
                </div>

                {worstWindow && (
                    <div className={cn('p-3 rounded-lg border', violation.status === 'fail' ? 'bg-rose-500/10 border-rose-500/30' : 'bg-amber-500/10 border-amber-500/30')}>
                        <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50 mb-1">Peak fortnight</div>
                        <div className="flex items-baseline gap-2">
                            <span className={cn('text-2xl font-black', violation.status === 'fail' ? 'text-rose-500' : 'text-amber-500')}>
                                {worstWindow.hours.toFixed(1)}h
                            </span>
                            <span className="text-xs text-muted-foreground/60">of {limit}h limit</span>
                            {worstWindow.hours > limit && (
                                <span className="text-[9px] font-black px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-500 border border-rose-500/20 uppercase tracking-widest ml-2">
                                    +{(worstWindow.hours - limit).toFixed(1)}h over
                                </span>
                            )}
                        </div>
                        <div className="text-[10px] text-muted-foreground/50 mt-0.5">
                            {worstWindow.weeks.join(' + ')}
                        </div>
                    </div>
                )}

                {weekKeys.length > 0 && (
                    <div className="space-y-1.5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40 px-1">Weekly breakdown</div>
                        {weekKeys.map(wk => {
                            const w = weeksData[wk];
                            const isViolating = violatingWeeks.has(wk);
                            return (
                                <div key={wk} className="flex items-center gap-3">
                                    <div className="w-20 shrink-0">
                                        <div className={cn('text-[10px] font-black', isViolating ? 'text-rose-500' : 'text-muted-foreground')}>
                                            {wk.split('-W').pop() ? `W${wk.split('-W').pop()}` : wk}
                                        </div>
                                        <div className="text-[9px] text-muted-foreground/40">{w.dates}</div>
                                    </div>
                                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                        <div className={cn('h-full rounded-full', isViolating ? 'bg-rose-500' : 'bg-muted-foreground/30')}
                                            style={{ width: `${Math.min((w.hours / Math.max(limit, w.hours)) * 100, 100)}%` }} />
                                    </div>
                                    <span className={cn('w-10 text-right text-xs font-black', isViolating ? 'text-rose-500' : 'text-foreground')}>{w.hours}h</span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    }

    if (id === 'MAX_DAILY_HOURS') {
        const existing = calc.existing_hours ?? 0;
        const candidate = calc.candidate_hours ?? 0;
        const total = calc.total_hours ?? 0;
        const limit = calc.limit ?? 10;
        return (
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">Daily projection (limit: {limit}h)</span>
                </div>
                <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
                        <span className="w-24">Existing shifts</span>
                        <span className="font-black text-foreground">{existing.toFixed(1)}h</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
                        <span className="w-24">Received shift</span>
                        <span className="font-black text-foreground">+{candidate.toFixed(1)}h</span>
                    </div>
                    <div className={cn('flex items-center gap-2 text-xs font-black', total > limit ? 'text-rose-500' : 'text-emerald-500')}>
                        <span className="w-24">Total projected</span>
                        <span className="text-lg">{total.toFixed(1)}h</span>
                        {total > limit && <span className="text-[9px] ml-1">(+{(total - limit).toFixed(1)}h over)</span>}
                    </div>
                </div>
                <div className="h-3 bg-muted rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full', total > limit ? 'bg-rose-500' : 'bg-emerald-500')}
                        style={{ width: `${Math.min((total / Math.max(limit, 1)) * 100, 100)}%` }} />
                </div>
            </div>
        );
    }

    if (id === 'MIN_REST_GAP') {
        const prev = calc.prev_day_gap_hours as number | null;
        const next = calc.next_day_gap_hours as number | null;
        const limit = calc.limit ?? 10;
        return (
            <div className="space-y-2">
                <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">Min rest gap: {limit}h required</div>
                <div className="grid grid-cols-2 gap-2">
                    {[{ label: 'Before shift', val: prev }, { label: 'After shift', val: next }].map(({ label, val }) => {
                        const fail = val != null && val < limit;
                        return (
                            <div key={label} className={cn('p-3 rounded-lg border text-center', fail ? 'bg-rose-500/5 border-rose-500/20' : val != null ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-muted/30 border-border')}>
                                <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 mb-1">{label}</div>
                                {val != null
                                    ? <div className={cn('text-xl font-black', fail ? 'text-rose-500' : 'text-emerald-500')}>{val.toFixed(1)}h</div>
                                    : <div className="text-muted-foreground/30 text-sm">–</div>}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    if (id === 'WORKING_DAYS_CAP') {
        const days = calc.days_worked ?? 0;
        const limit = calc.limit ?? 20;
        const period = calc.period_days ?? 28;
        return (
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">Working days in last {period} days</span>
                </div>
                <div className={cn('text-3xl font-black', violation.status === 'fail' ? 'text-rose-500' : 'text-foreground')}>
                    {days}<span className="text-sm font-bold text-muted-foreground/40 ml-1">/ {limit} max</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full', violation.status === 'fail' ? 'bg-rose-500' : 'bg-emerald-500')}
                        style={{ width: `${Math.min((days / Math.max(limit, 1)) * 100, 100)}%` }} />
                </div>
            </div>
        );
    }

    if (id === 'NO_OVERLAP') {
        return (
            <div className="p-3 bg-rose-500/5 border border-rose-500/20 rounded-lg flex items-start gap-2 text-xs text-rose-700 dark:text-rose-300">
                <Layers className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{violation.details || 'Schedule conflict detected. These shifts overlap in time.'}</span>
            </div>
        );
    }

    if (['ROLE_CONTRACT_MATCH', 'QUALIFICATION_MATCH', 'QUALIFICATION_EXPIRY'].includes(id)) {
        const qViolations = (calc.violations as any[]) ?? [];
        return (
            <div className="space-y-2">
                {qViolations.length > 0
                    ? qViolations.map((v: any, i: number) => (
                        <div key={i} className={cn('flex items-start gap-2 p-3 rounded-lg border text-xs',
                            v.type?.includes('EXPIRED') ? 'bg-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-300' : 'bg-rose-500/5 border-rose-500/20 text-rose-700 dark:text-rose-300')}>
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span>{v.message}</span>
                        </div>
                    ))
                    : <div className="text-xs text-muted-foreground italic">{violation.details}</div>
                }
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {violation.summary && (
                <p className="text-xs text-muted-foreground leading-relaxed">{violation.summary}</p>
            )}
            {violation.details && violation.details !== violation.summary && (
                <p className="text-xs text-muted-foreground/70 italic leading-relaxed">{violation.details}</p>
            )}
            <div className="flex flex-wrap gap-2 mt-2">
                {typeof calc.existing_hours === 'number' && <NumberPill label="Current" value={`${calc.existing_hours.toFixed(1)}h`} />}
                {typeof calc.candidate_hours === 'number' && <NumberPill label="Added" value={`+${calc.candidate_hours.toFixed(1)}h`} />}
                {typeof calc.total_hours === 'number' && <NumberPill label="After" value={`${calc.total_hours.toFixed(1)}h`} highlight={violation.status === 'fail'} />}
                {typeof calc.limit === 'number' && <NumberPill label="Limit" value={`${calc.limit}h`} />}
                {typeof calc.average_weekly_hours === 'number' && <NumberPill label="Avg/wk" value={`${calc.average_weekly_hours.toFixed(1)}h`} highlight={violation.status === 'fail'} />}
            </div>
        </div>
    );
}

export function ConstraintRow({ constraint, requesterName, offererName }: {
    constraint: GroupedConstraint;
    requesterName: string;
    offererName: string;
}) {
    const [expanded, setExpanded] = useState(
        constraint.rowStatus === 'fail' || constraint.rowStatus === 'warning'
    );

    const borderCls = constraint.rowStatus === 'fail'    ? 'border-rose-500/20 bg-rose-500/5' :
                      constraint.rowStatus === 'warning' ? 'border-amber-500/20 bg-amber-500/5' :
                                                           'border-border bg-card/30';

    const hasDetails = constraint.requesterResult || constraint.offererResult;

    return (
        <div className={cn('rounded-xl border transition-all duration-200', borderCls)}>
            <button
                onClick={() => hasDetails && setExpanded(e => !e)}
                className={cn('w-full flex items-center gap-3 px-4 py-3 text-left', !hasDetails && 'cursor-default')}
            >
                <div className={cn('h-8 w-8 rounded-lg flex items-center justify-center border shrink-0',
                    constraint.rowStatus === 'fail' ? 'bg-rose-500/10 border-rose-500/20 text-rose-500' :
                    constraint.rowStatus === 'warning' ? 'bg-amber-500/10 border-amber-500/20 text-amber-500' :
                    constraint.rowStatus === 'pass' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' :
                    'bg-muted border-border text-muted-foreground/40')}>
                    {constraint.rowStatus === 'pass' ? <CheckCircle2 className="h-4 w-4" /> : constraintIcon(constraint.id)}
                </div>
                <span className="flex-1 text-[12px] font-bold text-foreground text-left">{constraint.name}</span>
                <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-mono text-muted-foreground/40 uppercase">{requesterName.split(' ')[0]}</span>
                        <StatusBadge status={constraint.requesterResult?.status ?? 'pending'}
                            label={constraint.requesterResult ? constraint.requesterResult.status : '—'} />
                    </div>
                    <span className="text-muted-foreground/20 text-[10px]">·</span>
                    <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-mono text-muted-foreground/40 uppercase">{offererName.split(' ')[0]}</span>
                        <StatusBadge status={constraint.offererResult?.status ?? 'pending'}
                            label={constraint.offererResult ? constraint.offererResult.status : '—'} />
                    </div>
                    {hasDetails && <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground/30 transition-transform', expanded && 'rotate-180')} />}
                </div>
            </button>

            <AnimatePresence>
                {expanded && hasDetails && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                        <div className="border-t border-border/30 px-4 pb-4 pt-3 space-y-4">
                            {[
                                { label: requesterName, result: constraint.requesterResult },
                                { label: offererName,   result: constraint.offererResult },
                            ].map(({ label, result }) => result && result.status !== 'pass' && (
                                <div key={label}>
                                    <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40 mb-1.5">[{label}]</div>
                                    <ConstraintDetailPanel violation={result} />
                                </div>
                            ))}
                            {constraint.rowStatus === 'pass' && constraint.requesterResult && (
                                <ConstraintDetailPanel violation={constraint.requesterResult} />
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

export function BucketSection({ bucket, constraints, requesterName, offererName }: {
    bucket: Bucket;
    constraints: GroupedConstraint[];
    requesterName: string;
    offererName: string;
}) {
    if (constraints.length === 0) return null;
    const meta = BUCKET_META[bucket];
    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2 px-1">
                <div className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
                <span className={cn('text-[9px] font-black uppercase tracking-[0.2em]', meta.color)}>
                    Bucket {bucket} — {meta.label}
                </span>
                <div className="h-px flex-1 bg-gradient-to-r from-border/50 to-transparent" />
            </div>
            {constraints.map(c => (
                <ConstraintRow key={c.id} constraint={c} requesterName={requesterName} offererName={offererName} />
            ))}
        </div>
    );
}
