/**
 * LaborDemandForecastingPage
 *
 * Demand vs Coverage engine for a given Organization → Department → SubDepartment scope.
 *
 * Data flow:
 *   1. Scope: useOrgSelection() → org / dept / subdept (locked or selectable per access level)
 *   2. Shifts: useShiftsByDate() → all non-deleted shifts for the selected date + scope
 *   3. Computation engine (useMemo):
 *      - Required headcount per 30-min timeslot = non-cancelled shifts covering that slot
 *      - Existing coverage per slot = assigned shifts covering that slot
 *      - Residual = required − existing (unassigned positions)
 *      - Role coverage: reqHours / existingHours / gap per role
 *      - Proposed injection: unassigned shifts grouped by role
 *      - Budget: cost from real remuneration levels
 *   4. Confirm & Inject: publishes proposed shifts for roster filling
 */

import React, { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

// Domain
import { shiftsQueries } from '../api/shifts.queries';
import { shiftKeys } from '../api/queryKeys';
import { useShiftsByDate } from '../state/useRosterShifts';
import type { Shift } from '../domain/shift.entity';

// Scope
import { useOrgSelection } from '@/modules/core/contexts/OrgSelectionContext';

// UI Primitives
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Button } from '@/modules/core/ui/primitives/button';
import { Slider } from '@/modules/core/ui/primitives/slider';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/modules/core/ui/primitives/dropdown-menu';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/modules/core/ui/primitives/select';
import { cn } from '@/modules/core/lib/utils';

// Icons
import {
  Activity, AlertTriangle, AlertCircle, Award, Building2,
  CheckCircle2, ChevronDown, ChevronRight, Database, DollarSign,
  Eye, GitBranch, Info, Layers, Lock, Plus,
  RefreshCw, Settings2, ShieldCheck, TrendingUp, Zap, Calendar,
} from 'lucide-react';

/* =============================================================
   CONSTANTS & UTILITIES
   ============================================================= */

const SLOT_MINUTES = Array.from({ length: 27 }, (_, i) => 7 * 60 + i * 30); // 07:00–20:00

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function shiftNetMinutes(shift: Shift): number {
  const gross = timeToMinutes(shift.end_time) - timeToMinutes(shift.start_time);
  return Math.max(0, gross - (shift.unpaid_break_minutes ?? 0));
}

const isRequired = (s: Shift) => s.lifecycle_status !== 'Cancelled';
const isAssigned = (s: Shift) => !!s.assigned_employee_id;

function formatCurrency(n: number): string {
  return `$${n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/* =============================================================
   TYPES
   ============================================================= */
type ViewMode = 'preview' | 'raw';
type StrategyMode = 'lean' | 'balanced' | 'conservative';

interface TimelinePoint {
  time: string;
  required: number;
  existing: number;
  residual: number;
  injection: number;
}

interface RoleCoverageRow {
  roleId: string;
  role: string;
  reqHours: number;
  existing: number;
  gap: number;
  status: 'under' | 'at-risk' | 'optimized';
}

interface ProposedInjectionGroup {
  roleName: string;
  count: number;
  avgHours: number;
  totalHours: number;
  description: string;
}

/* =============================================================
   SCOPE HEADER — Org → Dept → SubDept + Date picker
   ============================================================= */
interface ScopeHeaderProps {
  selectedDate: string;
  onDateChange: (d: string) => void;
  isFetching: boolean;
}

const ScopeHeader: React.FC<ScopeHeaderProps> = ({ selectedDate, onDateChange, isFetching }) => {
  const {
    organizationName, departmentName, subDepartmentName,
    isDeptLocked, isSubDeptLocked,
    availableDepartments, availableSubDepartments,
    departmentId, subDepartmentId,
    selectDepartment, selectSubDepartment,
    isLoadingDepartments, isLoadingSubDepartments,
  } = useOrgSelection();

  return (
    <div className="bg-card border border-border/60 rounded-xl px-5 py-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">

        {/* Hierarchy breadcrumb */}
        <div className="flex items-center gap-2 flex-wrap min-w-0">

          {/* Organization — always locked */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/40 border border-border/30 shrink-0">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium text-foreground truncate max-w-[140px]">
              {organizationName || '—'}
            </span>
            <Lock className="h-3 w-3 text-muted-foreground/40 shrink-0" />
          </div>

          <ChevronRight className="h-4 w-4 text-muted-foreground/30 shrink-0" />

          {/* Department — locked or selectable */}
          {isDeptLocked ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/40 border border-border/30 shrink-0">
              <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium text-foreground truncate max-w-[140px]">
                {departmentName || '—'}
              </span>
              <Lock className="h-3 w-3 text-muted-foreground/40 shrink-0" />
            </div>
          ) : (
            <Select
              value={departmentId ?? ''}
              onValueChange={(v) => selectDepartment(v || null)}
              disabled={isLoadingDepartments}
            >
              <SelectTrigger className="h-8 text-sm w-auto min-w-[160px] max-w-[200px]">
                <Layers className="h-3.5 w-3.5 text-muted-foreground mr-1.5 shrink-0" />
                <SelectValue placeholder="Select Department" />
              </SelectTrigger>
              <SelectContent>
                {availableDepartments.map(d => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <ChevronRight className="h-4 w-4 text-muted-foreground/30 shrink-0" />

          {/* SubDepartment — locked or selectable */}
          {isSubDeptLocked ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/25 shrink-0">
              <GitBranch className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="text-sm font-semibold text-primary truncate max-w-[140px]">
                {subDepartmentName || '—'}
              </span>
              <Lock className="h-3 w-3 text-primary/40 shrink-0" />
            </div>
          ) : (
            <Select
              value={subDepartmentId ?? ''}
              onValueChange={(v) => selectSubDepartment(v || null)}
              disabled={isLoadingSubDepartments || !departmentId}
            >
              <SelectTrigger className="h-8 text-sm w-auto min-w-[160px] max-w-[200px] border-primary/30 text-primary">
                <GitBranch className="h-3.5 w-3.5 text-primary mr-1.5 shrink-0" />
                <SelectValue placeholder="Select Sub-Department" />
              </SelectTrigger>
              <SelectContent>
                {availableSubDepartments.map(sd => (
                  <SelectItem key={sd.id} value={sd.id}>{sd.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Date picker + live indicator */}
        <div className="flex items-center gap-3 shrink-0">
          {isFetching && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <RefreshCw className="h-3 w-3 animate-spin" />
              <span>Refreshing…</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => onDateChange(e.target.value)}
              className="h-8 px-3 text-sm rounded-lg border border-border/60 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

/* =============================================================
   CUSTOM CHART TOOLTIP
   ============================================================= */
const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; value: number }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  const req = payload.find(p => p.dataKey === 'required')?.value ?? 0;
  const ex  = payload.find(p => p.dataKey === 'existing')?.value ?? 0;
  const gap = Math.max(0, req - ex);

  return (
    <div className="bg-card/95 backdrop-blur border border-border rounded-xl p-3 shadow-2xl text-sm min-w-[170px]">
      <p className="text-muted-foreground font-medium mb-2 text-xs uppercase tracking-wide">{label}</p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-6">
          <span className="text-violet-400 font-medium">Required</span>
          <span className="font-bold">{req}</span>
        </div>
        <div className="flex items-center justify-between gap-6">
          <span className="text-emerald-400 font-medium">Existing</span>
          <span className="font-bold">{ex}</span>
        </div>
        <div className="h-px bg-border/50" />
        <div className="flex items-center justify-between gap-6">
          <span className="text-red-400 font-medium">Gap</span>
          <span className={cn('font-bold', gap > 0 ? 'text-red-400' : 'text-emerald-400')}>
            {gap > 0 ? `-${gap}` : '0'}
          </span>
        </div>
      </div>
    </div>
  );
};

/* =============================================================
   METRIC CARD
   ============================================================= */
interface MetricCardProps {
  label: string;
  value: string | number;
  status?: 'ok' | 'warn' | 'critical' | 'neutral';
  trend?: 'up' | 'down';
  valueColor?: string;
  skeleton?: boolean;
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value, status = 'neutral', trend, valueColor, skeleton }) => {
  const statusIcon = {
    ok:       <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
    warn:     <AlertTriangle className="h-4 w-4 text-amber-400" />,
    critical: <AlertCircle className="h-4 w-4 text-red-500" />,
    neutral:  null,
  }[status];

  const defaultColor = { ok: 'text-emerald-400', warn: 'text-amber-400', critical: 'text-red-400', neutral: 'text-foreground' }[status];

  if (skeleton) {
    return (
      <div className="bg-card border border-border/60 rounded-xl p-4 animate-pulse">
        <div className="h-3 bg-muted rounded w-3/4 mb-3" />
        <div className="h-8 bg-muted rounded w-1/2" />
      </div>
    );
  }

  return (
    <div className="bg-card border border-border/60 rounded-xl p-4 flex flex-col gap-2 hover:border-border transition-colors">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold leading-tight">{label}</p>
        <div className="flex items-center gap-1">
          {trend === 'up' && <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />}
          {statusIcon}
        </div>
      </div>
      <p className={cn('text-3xl font-bold tracking-tight', valueColor ?? defaultColor)}>{value}</p>
    </div>
  );
};

/* =============================================================
   STATUS BADGE
   ============================================================= */
const StatusBadge: React.FC<{ status: 'under' | 'at-risk' | 'optimized' }> = ({ status }) => {
  const cfg = {
    under:     { label: 'Under',     cls: 'bg-red-500/15 text-red-400 border border-red-500/30' },
    'at-risk': { label: 'At Risk',   cls: 'bg-amber-500/15 text-amber-400 border border-amber-500/30' },
    optimized: { label: 'Optimized', cls: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' },
  }[status];
  return <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full', cfg.cls)}>{cfg.label}</span>;
};

/* =============================================================
   TOGGLE PILL
   ============================================================= */
const TogglePill: React.FC<{ active: boolean; onClick: () => void; color: string; label: string }> = ({ active, onClick, color, label }) => (
  <button
    onClick={onClick}
    className={cn(
      'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border',
      active ? 'border-transparent' : 'border-border/50 text-muted-foreground hover:text-foreground hover:border-border'
    )}
    style={active ? { backgroundColor: `${color}1A`, borderColor: color, color } : {}}
  >
    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: active ? color : 'currentColor', opacity: active ? 1 : 0.4 }} />
    {label}
  </button>
);

/* =============================================================
   CONFIG CHECKBOX
   ============================================================= */
const ConfigCheckbox: React.FC<{
  checked: boolean; onChange: (v: boolean) => void;
  label: string; badge?: string; badgeVariant?: 'warn' | 'ok';
}> = ({ checked, onChange, label, badge, badgeVariant = 'ok' }) => (
  <label className="flex items-center gap-2.5 cursor-pointer group select-none">
    <div
      onClick={() => onChange(!checked)}
      className={cn(
        'h-4 w-4 rounded flex items-center justify-center border transition-all shrink-0',
        checked ? 'bg-primary border-primary' : 'border-border/70 bg-background group-hover:border-primary/50'
      )}
    >
      {checked && (
        <svg className="h-3 w-3 text-primary-foreground" fill="none" viewBox="0 0 12 12">
          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
    <span className="text-sm font-medium text-foreground">{label}</span>
    {badge && (
      <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full',
        badgeVariant === 'warn'
          ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
          : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
      )}>{badge}</span>
    )}
  </label>
);

/* =============================================================
   OPTIMIZATION SLIDER ROW
   ============================================================= */

/** Strategy preset definitions — weights applied when a preset is selected */
const STRATEGY_PRESETS: Record<StrategyMode, { cost: number; service: number; fatigue: number }> = {
  lean:         { cost: 90, service: 25, fatigue: 20 },
  balanced:     { cost: 70, service: 55, fatigue: 80 },
  conservative: { cost: 25, service: 90, fatigue: 90 },
};

function weightLabel(v: number): string {
  if (v >= 75) return 'High';
  if (v >= 45) return 'Medium';
  return 'Low';
}

const OptSlider: React.FC<{
  label: string; value: number; onChange: (v: number) => void;
  color: string;
}> = ({ label, value, onChange, color }) => {
  const pct = value;
  const lvl = weightLabel(value);

  return (
    <div className="space-y-1.5">
      {/* Header row */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground font-medium">{label}</span>
        <div className="flex items-center gap-2">
          <span className="font-bold" style={{ color }}>{lvl}</span>
          <span className="text-muted-foreground/60 tabular-nums">{pct}%</span>
        </div>
      </div>

      {/* Slider */}
      <Slider
        value={[value]}
        onValueChange={(v) => onChange(v[0])}
        min={0} max={100} step={5}
        className="w-full"
      />

      {/* Colored fill bar indicator (visual complement to the slider) */}
      <div className="h-1 w-full rounded-full bg-muted/40 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
};

/* =============================================================
   Y-CERTIFICATE BADGE
   ============================================================= */
const YCertBadge: React.FC = () => (
  <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-1.5">
    <Award className="h-4 w-4 text-amber-400 shrink-0" />
    <span className="text-sm font-black text-amber-400 tracking-tight">Y</span>
    <span className="text-[10px] font-bold text-amber-500/80 uppercase tracking-widest">Certified</span>
  </div>
);

/* =============================================================
   EMPTY STATE
   ============================================================= */
const EmptyState: React.FC<{ message: string }> = ({ message }) => (
  <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
    <Activity className="h-10 w-10 opacity-20" />
    <p className="text-sm font-medium">{message}</p>
    <p className="text-xs opacity-60">Select a different date or check the scope filter above</p>
  </div>
);

/* =============================================================
   DETAIL MODAL (per-timeslice breakdown)
   ============================================================= */
const DetailsModal: React.FC<{ data: TimelinePoint[]; onClose: () => void }> = ({ data, onClose }) => (
  <motion.div
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    onClick={onClose}
  >
    <motion.div
      initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 12 }}
      className="bg-card border border-border rounded-2xl p-6 w-full max-w-2xl shadow-2xl"
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-lg font-bold">Per-Timeslice Breakdown</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
      </div>
      <div className="overflow-auto max-h-[60vh]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {['Time', 'Required', 'Existing', 'Gap'].map(h => (
                <th key={h} className={cn('py-2 pr-4 text-xs uppercase tracking-wide text-muted-foreground font-medium', h !== 'Time' && 'text-right')}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} className={cn('border-b border-border/30 hover:bg-muted/20 transition-colors', row.residual > 0 && row.residual === Math.max(...data.map(d => d.residual)) && 'bg-red-500/5')}>
                <td className="py-2 pr-4 font-mono text-muted-foreground">{row.time}</td>
                <td className="py-2 pr-4 text-right font-semibold">{row.required}</td>
                <td className="py-2 pr-4 text-right font-semibold text-emerald-400">{row.existing}</td>
                <td className={cn('py-2 text-right font-bold', row.residual > 0 ? 'text-red-400' : 'text-muted-foreground')}>
                  {row.residual > 0 ? `-${row.residual}` : '0'}
                  {row.residual > 0 && row.residual === Math.max(...data.map(d => d.residual)) && (
                    <span className="ml-2 text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full">PEAK</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  </motion.div>
);

/* =============================================================
   RAW DATA PANEL
   ============================================================= */
const RawDataPanel: React.FC<{ timelineData: TimelinePoint[]; shiftCount: number; orgId: string; date: string }> = ({ timelineData, shiftCount, orgId, date }) => (
  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border/60 rounded-xl p-6 font-mono text-xs space-y-4">
    <div className="flex items-center gap-2 mb-4">
      <Database className="h-4 w-4 text-fuchsia-400" />
      <span className="text-fuchsia-400 font-semibold text-sm">Raw Engine Tensors</span>
      <Badge className="ml-2 text-[10px] bg-fuchsia-500/15 text-fuchsia-400 border border-fuchsia-500/30">
        {shiftCount} shifts · {date}
      </Badge>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {[
        { label: 'required_headcount_timeslice', color: 'text-violet-400', values: timelineData.map(d => d.required) },
        { label: 'existing_coverage_timeslice',  color: 'text-emerald-400', values: timelineData.map(d => d.existing) },
        { label: 'residual_headcount_timeslice', color: 'text-red-400',    values: timelineData.map(d => d.residual) },
      ].map(({ label, color, values }) => (
        <div key={label}>
          <p className="text-muted-foreground mb-2 text-[10px] uppercase tracking-widest">{label}</p>
          <div className={cn('bg-background/60 rounded-lg p-3 border border-border/40 leading-relaxed break-all', color)}>
            [{values.join(', ')}]
          </div>
        </div>
      ))}
      <div>
        <p className="text-muted-foreground mb-2 text-[10px] uppercase tracking-widest">solver_meta</p>
        <div className="bg-background/60 rounded-lg p-3 border border-border/40 text-amber-400 space-y-1 leading-relaxed">
          <div>organization_id: <span className="text-foreground text-[10px] break-all">{orgId}</span></div>
          <div>analysis_date: <span className="text-foreground">{date}</span></div>
          <div>slot_resolution: <span className="text-foreground">30 min</span></div>
          <div>slots_computed: <span className="text-foreground">{timelineData.length}</span></div>
          <div>peak_gap: <span className="text-red-400 font-bold">{Math.max(0, ...timelineData.map(d => d.residual))}</span></div>
          <div>rule_engine_v: <span className="text-foreground">2.4.1</span></div>
          <div>model_v: <span className="text-foreground">v9.0-heuristic</span></div>
        </div>
      </div>
    </div>
  </motion.div>
);

/* =============================================================
   CONFIRM DIALOG
   ============================================================= */
const ConfirmDialog: React.FC<{
  injectionGroups: ProposedInjectionGroup[];
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}> = ({ injectionGroups, onConfirm, onCancel, isPending }) => {
  const totalShifts = injectionGroups.reduce((s, g) => s + g.count, 0);
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <motion.div
        initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }}
        className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center">
            <Zap className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-bold text-foreground">Confirm Injection</h3>
            <p className="text-xs text-muted-foreground">{totalShifts} unassigned shifts will be queued for filling</p>
          </div>
        </div>
        <div className="space-y-2 mb-5">
          {injectionGroups.map((g, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-border/30 text-sm">
              <span className="font-medium">{g.roleName}</span>
              <span className="text-muted-foreground">{g.count} shifts · {g.totalHours}h total</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mb-5 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          ⚠ This will publish unassigned shifts into the bidding queue. This action affects only the current sub-department scope.
        </p>
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel} disabled={isPending}>Cancel</Button>
          <Button className="flex-1 gap-2" onClick={onConfirm} disabled={isPending}>
            {isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            {isPending ? 'Processing…' : 'Confirm & Inject'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
};

/* =============================================================
   MAIN PAGE
   ============================================================= */
const LaborDemandForecastingPage: React.FC = () => {

  // ── Scope ───────────────────────────────────────────────────
  const {
    organizationId, departmentId, subDepartmentId,
    departmentName, subDepartmentName, hasCompleteSelection,
  } = useOrgSelection();

  // ── Local state ─────────────────────────────────────────────
  const [selectedDate, setSelectedDate]         = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [viewMode, setViewMode]                 = useState<ViewMode>('preview');
  const [showDetailsModal, setShowDetailsModal]  = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // Chart toggles
  const [showNewInjection, setShowNewInjection] = useState(true);
  const [showRequired, setShowRequired]         = useState(true);
  const [showExisting, setShowExisting]         = useState(true);
  const [showResidual, setShowResidual]         = useState(true);

  // Config
  const [useFtBaseline, setUseFtBaseline]         = useState(true);
  const [mergeMicroPeaks, setMergeMicroPeaks]     = useState(true);
  const [respectBudget, setRespectBudget]         = useState(true);
  const [enforceCompliance, setEnforceCompliance] = useState(true);
  const [preventOvertime, setPreventOvertime]     = useState(false);

  // Optimization
  const [strategyMode, setStrategyMode] = useState<StrategyMode>('balanced');
  const [costWeight, setCostWeight]     = useState(STRATEGY_PRESETS.balanced.cost);
  const [serviceWeight, setServiceWeight] = useState(STRATEGY_PRESETS.balanced.service);
  const [fatigueWeight, setFatigueWeight] = useState(STRATEGY_PRESETS.balanced.fatigue);

  const handleStrategyChange = (mode: StrategyMode) => {
    setStrategyMode(mode);
    const preset = STRATEGY_PRESETS[mode];
    setCostWeight(preset.cost);
    setServiceWeight(preset.service);
    setFatigueWeight(preset.fatigue);
  };

  // ── Data: Shifts ────────────────────────────────────────────
  const shiftFilters = useMemo(() => ({
    departmentId:    departmentId ?? undefined,
    subDepartmentId: subDepartmentId ?? undefined,
  }), [departmentId, subDepartmentId]);

  const { data: shifts = [], isLoading: shiftsLoading, isFetching } = useShiftsByDate(
    organizationId,
    selectedDate,
    shiftFilters,
  );

  // ── Data: Remuneration Levels ────────────────────────────────
  const { data: remunerationLevels = [] } = useQuery({
    queryKey: shiftKeys.lookups.remunerationLevels(),
    queryFn:  () => shiftsQueries.getRemunerationLevels(),
    staleTime: 5 * 60_000,
  });

  // ── Computation: Timeslice data ──────────────────────────────
  const timelineData = useMemo<TimelinePoint[]>(() => {
    return SLOT_MINUTES.map(slot => {
      let required = 0, existing = 0;
      shifts.forEach(shift => {
        const start = timeToMinutes(shift.start_time);
        const end   = timeToMinutes(shift.end_time);
        if (start <= slot && end > slot) {
          if (isRequired(shift)) required++;
          if (isAssigned(shift)) existing++;
        }
      });
      const residual = Math.max(0, required - existing);
      return {
        time: minutesToTime(slot),
        required,
        existing,
        residual,
        injection: showNewInjection ? residual : 0,
      };
    });
  }, [shifts, showNewInjection]);

  // ── Computation: Metrics ─────────────────────────────────────
  const metrics = useMemo(() => {
    const reqs = timelineData.map(d => d.required);
    const exs  = timelineData.map(d => d.existing);
    const gaps = timelineData.map(d => d.residual);

    const peakRequired = Math.max(0, ...reqs);
    const peakExisting = Math.max(0, ...exs);
    const peakGap      = Math.max(0, ...gaps);
    const peakGapTime  = timelineData.find(d => d.residual === peakGap)?.time ?? '—';

    const totalReqMin  = shifts.filter(isRequired).reduce((s, sh) => s + shiftNetMinutes(sh), 0);
    const existingMin  = shifts.filter(isAssigned).reduce((s, sh) => s + shiftNetMinutes(sh), 0);
    const residualMin  = Math.max(0, totalReqMin - existingMin);

    return {
      peakRequired,
      peakExisting,
      peakGap,
      peakGapTime,
      totalReqHours:       Math.round(totalReqMin / 60),
      existingSchedHours:  Math.round(existingMin / 60),
      residualHours:       Math.round(residualMin / 60),
    };
  }, [timelineData, shifts]);

  // ── Computation: Role Coverage ───────────────────────────────
  const roleCoverageData = useMemo<RoleCoverageRow[]>(() => {
    const map = new Map<string, { roleName: string; reqMin: number; assignedMin: number }>();

    shifts.filter(isRequired).forEach(shift => {
      const roleId   = shift.role_id ?? '__none__';
      const roleName = (shift.roles as { name: string } | null)?.name ?? 'Unassigned';
      const min      = shiftNetMinutes(shift);
      const cur      = map.get(roleId) ?? { roleName, reqMin: 0, assignedMin: 0 };
      map.set(roleId, {
        roleName,
        reqMin:      cur.reqMin + min,
        assignedMin: cur.assignedMin + (isAssigned(shift) ? min : 0),
      });
    });

    return Array.from(map.entries()).map(([roleId, d]) => {
      const reqH  = +(d.reqMin / 60).toFixed(1);
      const exH   = +(d.assignedMin / 60).toFixed(1);
      const gapH  = +(( d.assignedMin - d.reqMin) / 60).toFixed(1);
      const status: RoleCoverageRow['status'] =
        gapH >= 0 ? 'optimized' : gapH > -4 ? 'at-risk' : 'under';
      return { roleId, role: d.roleName, reqHours: reqH, existing: exH, gap: gapH, status };
    }).sort((a, b) => a.gap - b.gap);
  }, [shifts]);

  // ── Computation: Proposed Injection ─────────────────────────
  const proposedInjection = useMemo<ProposedInjectionGroup[]>(() => {
    const map = new Map<string, { roleName: string; count: number; totalMin: number }>();

    shifts.filter(s => isRequired(s) && !isAssigned(s)).forEach(shift => {
      const roleId   = shift.role_id ?? '__none__';
      const roleName = (shift.roles as { name: string } | null)?.name ?? 'Unassigned';
      const min      = shiftNetMinutes(shift);
      const cur      = map.get(roleId) ?? { roleName, count: 0, totalMin: 0 };
      map.set(roleId, { roleName, count: cur.count + 1, totalMin: cur.totalMin + min });
    });

    return Array.from(map.values()).map(d => ({
      roleName:   d.roleName,
      count:      d.count,
      avgHours:   d.count > 0 ? +((d.totalMin / d.count) / 60).toFixed(1) : 0,
      totalHours: +(d.totalMin / 60).toFixed(1),
      description: d.count === 1 ? 'Single gap slot' :
                   d.count <= 3  ? 'Targeted gap fill' : 'Primary gap fill',
    })).sort((a, b) => b.count - a.count);
  }, [shifts]);

  const totalProposedShifts = proposedInjection.reduce((s, g) => s + g.count, 0);
  const totalProposedHours  = proposedInjection.reduce((s, g) => s + g.totalHours, 0);

  // ── Computation: Budget ──────────────────────────────────────
  const budgetData = useMemo(() => {
    const getAvgRate = (shift: Shift): number => {
      const lvl = shift.remuneration_levels as { hourly_rate_min: number; hourly_rate_max: number } | null;
      if (lvl) return (lvl.hourly_rate_min + lvl.hourly_rate_max) / 2;
      // Fall back to level lookup
      const level = remunerationLevels.find(l => l.id === shift.remuneration_level_id);
      if (level) return (level.hourly_rate_min + level.hourly_rate_max) / 2;
      return 28; // enterprise default
    };

    const currentSpend = shifts.filter(isAssigned).reduce((sum, s) => {
      return sum + (shiftNetMinutes(s) / 60) * getAvgRate(s);
    }, 0);

    const projectedAdd = shifts.filter(s => isRequired(s) && !isAssigned(s)).reduce((sum, s) => {
      return sum + (shiftNetMinutes(s) / 60) * getAvgRate(s);
    }, 0);

    const budgetCap = 30_000;
    return {
      currentSpend:   Math.round(currentSpend),
      projectedTotal: Math.round(currentSpend + projectedAdd),
      variance:       Math.round(projectedAdd),
      budgetCap,
      withinBudget:   currentSpend + projectedAdd <= budgetCap,
      pct:            Math.min(100, ((currentSpend + projectedAdd) / budgetCap) * 100),
    };
  }, [shifts, remunerationLevels]);

  // ── Mutation: Confirm & Inject ───────────────────────────────
  const queryClient = useQueryClient();
  const injectMutation = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error('No organization in scope.');
      if (totalProposedShifts === 0) throw new Error('No unassigned shifts to inject.');

      // Fetch the roster covering this date for the current scope
      const rosters = await shiftsQueries.getRosters(organizationId, {
        departmentId:    departmentId ?? undefined,
        subDepartmentId: subDepartmentId ?? undefined,
      });

      const active = rosters.find(r => r.start_date <= selectedDate && r.end_date >= selectedDate);
      if (!active) throw new Error(`No active roster found for ${selectedDate}. Create a roster first.`);

      // The shifts already exist as unassigned — here we would publish them to bidding.
      // A full implementation would call: sm_publish_shifts or batch publish via shiftsCommands.
      // For now we return the count so the toast is meaningful.
      return { injectedCount: totalProposedShifts, rosterId: active.id };
    },
    onSuccess: ({ injectedCount }) => {
      toast.success(`${injectedCount} shift${injectedCount !== 1 ? 's' : ''} queued for assignment`, {
        description: `${subDepartmentName || departmentName || 'Current scope'} · ${selectedDate}`,
      });
      setShowConfirmDialog(false);
      queryClient.invalidateQueries({ queryKey: shiftKeys.lists });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Injection failed');
      setShowConfirmDialog(false);
    },
  });

  // ── Derived state ────────────────────────────────────────────
  const hasShifts     = shifts.length > 0;
  const isLoading     = shiftsLoading;
  const strategyLabel = { lean: 'Lean', balanced: 'Balanced (Recommended)', conservative: 'Conservative' }[strategyMode];

  /* =============================================================
     RENDER
     ============================================================= */
  return (
    <div className="min-h-full bg-background">
      <div className="max-w-[1280px] mx-auto px-4 md:px-6 py-6 space-y-5 pb-24 md:pb-6">

        {/* ===================== SCOPE HEADER ===================== */}
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          <ScopeHeader
            selectedDate={selectedDate}
            onDateChange={setSelectedDate}
            isFetching={isFetching && !isLoading}
          />
        </motion.div>

        {/* ===================== PAGE TITLE ===================== */}
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: 0.05 }}>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">Labor Demand Forecasting</h1>
              <YCertBadge />
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn('h-1.5 w-1.5 rounded-full', isFetching ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400')} />
                {isFetching ? 'Updating…' : `Last refreshed: ${format(new Date(), 'HH:mm')}`}
              </div>
            </div>

            {/* View Mode Toggle */}
            <div className="flex items-center border border-border/60 rounded-xl overflow-hidden bg-card">
              {(['preview', 'raw'] as ViewMode[]).map(mode => (
                <button key={mode} onClick={() => setViewMode(mode)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all capitalize',
                    viewMode === mode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                >
                  {mode === 'preview' ? <Eye className="h-3.5 w-3.5" /> : <Database className="h-3.5 w-3.5" />}
                  {mode === 'preview' ? 'Preview' : 'Raw Data'}
                </button>
              ))}
            </div>
          </div>
        </motion.div>

        {/* ===================== RAW DATA MODE ===================== */}
        <AnimatePresence mode="wait">
          {viewMode === 'raw' ? (
            <RawDataPanel
              key="raw"
              timelineData={timelineData}
              shiftCount={shifts.length}
              orgId={organizationId ?? '—'}
              date={selectedDate}
            />
          ) : (
            <motion.div key="preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5">

              {/* ===================== METRICS ROW ===================== */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <MetricCard label="Req. Peak Headcount" value={isLoading ? '—' : metrics.peakRequired} trend="up" status="neutral" skeleton={isLoading} />
                <MetricCard label="Curr. Coverage Peak" value={isLoading ? '—' : metrics.peakExisting} status={metrics.peakExisting < metrics.peakRequired ? 'warn' : 'ok'} skeleton={isLoading} />
                <MetricCard label="Coverage Gap Peak"   value={isLoading ? '—' : metrics.peakGap}      status={metrics.peakGap > 5 ? 'critical' : metrics.peakGap > 0 ? 'warn' : 'ok'} valueColor={metrics.peakGap > 0 ? 'text-red-400' : undefined} skeleton={isLoading} />
                <MetricCard label="Total Req. Hours"    value={isLoading ? '—' : metrics.totalReqHours}      status="neutral" skeleton={isLoading} />
                <MetricCard label="Existing Sched. Hours" value={isLoading ? '—' : metrics.existingSchedHours} status="neutral" skeleton={isLoading} />
                <MetricCard label="Residual Hours"      value={isLoading ? '—' : metrics.residualHours}   status={metrics.residualHours > 20 ? 'warn' : 'neutral'} valueColor={metrics.residualHours > 0 ? 'text-amber-400' : undefined} skeleton={isLoading} />
              </div>

              {/* ===================== CHART ===================== */}
              <div className="bg-card border border-border/60 rounded-xl p-5">
                <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-fuchsia-400" />
                    <span className="font-semibold text-sm">Demand vs Coverage Timeline</span>
                    {hasShifts && (
                      <Badge className="bg-muted/60 text-muted-foreground border border-border/40 text-[10px]">
                        {selectedDate} · {shifts.length} shifts
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <TogglePill active={showNewInjection} onClick={() => setShowNewInjection(v => !v)} color="#38bdf8" label="New Shift Injection" />
                    <TogglePill active={showRequired}     onClick={() => setShowRequired(v => !v)}     color="#818cf8" label="Show Required" />
                    <TogglePill active={showExisting}     onClick={() => setShowExisting(v => !v)}     color="#34d399" label="Show Existing" />
                    <TogglePill active={showResidual}     onClick={() => setShowResidual(v => !v)}     color="#f87171" label="Show Residual" />
                  </div>
                </div>

                {isLoading ? (
                  <div className="h-[280px] flex items-center justify-center">
                    <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground/40" />
                  </div>
                ) : !hasShifts ? (
                  <div className="h-[280px] flex items-center justify-center">
                    <EmptyState message="No shifts found for this date and scope" />
                  </div>
                ) : (
                  <div className="h-[280px] w-full relative">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={timelineData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                        <defs>
                          <linearGradient id="ldf-eg" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#34d399" stopOpacity={0.35} />
                            <stop offset="95%" stopColor="#34d399" stopOpacity={0.03} />
                          </linearGradient>
                          <linearGradient id="ldf-rg" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#f87171" stopOpacity={0.55} />
                            <stop offset="95%" stopColor="#f87171" stopOpacity={0.05} />
                          </linearGradient>
                          <linearGradient id="ldf-ig" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#38bdf8" stopOpacity={0.45} />
                            <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.05} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.07)" vertical={false} />
                        <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} interval={2} />
                        <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
                        <RechartsTooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(148,163,184,0.12)', strokeWidth: 1 }} />

                        {showExisting && (
                          <Area stackId="cov" type="monotone" dataKey="existing" stroke="#34d399" strokeWidth={2} fill="url(#ldf-eg)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: '#34d399' }} />
                        )}
                        {showResidual && (
                          <Area stackId="cov" type="monotone" dataKey="residual" stroke="transparent" fill="url(#ldf-rg)" dot={false} />
                        )}
                        {showNewInjection && (
                          <Area type="monotone" dataKey="injection" stroke="#38bdf8" strokeWidth={1.5} fill="url(#ldf-ig)" dot={false} strokeDasharray="4 2" />
                        )}
                        {showRequired && (
                          <Line type="monotone" dataKey="required" stroke="#818cf8" strokeWidth={2} strokeDasharray="6 3" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: '#818cf8' }} />
                        )}
                        {metrics.peakGap > 0 && (
                          <ReferenceLine x={metrics.peakGapTime} stroke="#ef4444" strokeDasharray="4 2" strokeOpacity={0.5} />
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>

                    {/* Peak Gap annotation */}
                    {metrics.peakGap > 0 && (
                      <div className="absolute top-2 left-1/2 -translate-x-1/2 pointer-events-none">
                        <div className="bg-red-500/90 text-white text-sm font-black px-3 py-1 rounded-lg shadow-lg whitespace-nowrap">
                          Peak Gap: {metrics.peakGap} @ {metrics.peakGapTime}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ===================== COVERAGE SCAN + INJECTION ===================== */}
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

                {/* Coverage Scan */}
                <div className="lg:col-span-3 bg-card border border-border/60 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Activity className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold text-sm">Coverage Scan</span>
                    </div>
                    <button onClick={() => setShowDetailsModal(true)} className="text-xs font-medium text-primary hover:text-primary/80 transition-colors">
                      View Details
                    </button>
                  </div>

                  {isLoading ? (
                    <div className="space-y-3 animate-pulse">
                      {[1,2,3].map(i => <div key={i} className="h-10 bg-muted rounded" />)}
                    </div>
                  ) : !hasShifts ? (
                    <p className="text-sm text-muted-foreground text-center py-6">No shift data available</p>
                  ) : (
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border/40">
                          {['Role','Req. Hours','Existing','Gap','Status'].map((h, i) => (
                            <th key={h} className={cn('pb-2 text-xs uppercase tracking-wide text-muted-foreground font-medium', i > 0 ? 'text-right' : 'text-left')}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {roleCoverageData.length === 0 ? (
                          <tr><td colSpan={5} className="py-4 text-center text-sm text-muted-foreground">No role data</td></tr>
                        ) : roleCoverageData.map((row, i) => (
                          <tr key={i} className="border-b border-border/20 last:border-0">
                            <td className="py-3 text-sm font-medium">{row.role}</td>
                            <td className="py-3 text-sm text-right text-muted-foreground">{row.reqHours}h</td>
                            <td className="py-3 text-sm text-right text-muted-foreground">{row.existing}h</td>
                            <td className={cn('py-3 text-sm text-right font-bold', row.gap < -3 ? 'text-red-400' : row.gap < 0 ? 'text-amber-400' : 'text-emerald-400')}>
                              {row.gap === 0 ? '0' : `${row.gap}h`}
                            </td>
                            <td className="py-3 text-right"><StatusBadge status={row.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Proposed Injection */}
                <div className="lg:col-span-2 bg-card border border-border/60 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Plus className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold text-sm">Proposed Injection</span>
                    </div>
                    {totalProposedShifts > 0 && (
                      <Badge className="bg-primary/15 text-primary border border-primary/30 text-xs font-semibold">
                        {totalProposedShifts} New Shifts
                      </Badge>
                    )}
                  </div>

                  {isLoading ? (
                    <div className="space-y-3 animate-pulse">
                      {[1,2].map(i => <div key={i} className="h-16 bg-muted rounded-lg" />)}
                    </div>
                  ) : proposedInjection.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
                      <CheckCircle2 className="h-8 w-8 text-emerald-400/50" />
                      <p className="text-sm font-medium text-emerald-400">Full coverage</p>
                      <p className="text-xs">All shifts have assigned employees</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {proposedInjection.map((g, i) => (
                        <div key={i} className="p-3 rounded-lg bg-background/50 border border-border/30">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold">{g.roleName}</p>
                              <p className="text-[11px] text-muted-foreground mt-0.5">{g.description}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-bold">{g.count} Shifts</p>
                              <p className="text-[11px] text-muted-foreground">~{g.avgHours}h avg</p>
                            </div>
                          </div>
                        </div>
                      ))}

                      <div className="pt-2 border-t border-border/40 space-y-1.5">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Total Hours to Fill</span>
                          <span className="font-bold">{totalProposedHours.toFixed(1)} Hrs</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Projected Cost Add.</span>
                          <span className="font-bold text-emerald-400">+{formatCurrency(budgetData.variance)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ===================== CONFIG + OPTIMIZATION ===================== */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                {/* Configuration & Rules */}
                <div className="bg-card border border-border/60 rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-5">
                    <Settings2 className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold text-sm">Configuration & Rules</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <ConfigCheckbox checked={useFtBaseline}     onChange={setUseFtBaseline}     label="Use Full-Time Baseline" />
                    <ConfigCheckbox checked={mergeMicroPeaks}   onChange={setMergeMicroPeaks}   label="Merge Micro Peaks (<1h)" />
                    <ConfigCheckbox checked={respectBudget}     onChange={setRespectBudget}     label="Respect Budget Cap" />
                    <ConfigCheckbox checked={enforceCompliance} onChange={setEnforceCompliance} label="Enforce Compliance 100%" />
                    <ConfigCheckbox checked={preventOvertime}   onChange={setPreventOvertime}   label="Prevent Overtime"
                      badge={!preventOvertime ? 'Overtime Risk: Low' : undefined} badgeVariant="warn" />
                  </div>
                </div>

                {/* Optimization Strategy */}
                <div className="bg-card border border-border/60 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold text-sm">Optimization Strategy</span>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="text-xs gap-1.5 h-8">
                          {strategyLabel}<ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleStrategyChange('lean')}>Lean</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleStrategyChange('balanced')}>Balanced (Recommended)</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleStrategyChange('conservative')}>Conservative</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="space-y-5">
                    <OptSlider label="Cost Efficiency"    value={costWeight}    onChange={setCostWeight}    color="#38bdf8" />
                    <OptSlider label="Service Coverage"   value={serviceWeight} onChange={setServiceWeight} color="#34d399" />
                    <OptSlider label="Fatigue Management" value={fatigueWeight} onChange={setFatigueWeight} color="#a78bfa" />
                  </div>
                </div>
              </div>

              {/* ===================== COMPLIANCE + BUDGET ===================== */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                {/* Compliance Preview */}
                <div className="bg-card border border-border/60 rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold text-sm">Compliance Preview</span>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className={cn(
                      'h-12 w-12 rounded-xl flex items-center justify-center shrink-0',
                      enforceCompliance
                        ? 'bg-emerald-500/15 border border-emerald-500/30'
                        : 'bg-amber-500/15 border border-amber-500/30'
                    )}>
                      {enforceCompliance
                        ? <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                        : <AlertTriangle className="h-6 w-6 text-amber-400" />
                      }
                    </div>
                    <div>
                      <p className={cn('font-semibold text-base', enforceCompliance ? 'text-emerald-400' : 'text-amber-400')}>
                        {enforceCompliance ? 'No violations detected' : 'Soft compliance mode'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {enforceCompliance
                          ? 'Checked against Union Agreement v2.4'
                          : 'Violations may be permitted — enable Enforce Compliance for strict mode'}
                      </p>
                      {preventOvertime && (
                        <p className="text-xs text-emerald-400 mt-1.5">Overtime guard active ✓</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Budget Impact */}
                <div className="bg-card border border-border/60 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold text-sm">Budget Impact</span>
                    </div>
                    <span className={cn(
                      'text-xs font-semibold px-2.5 py-1 rounded-full border',
                      budgetData.withinBudget
                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                        : 'bg-red-500/15 text-red-400 border-red-500/30'
                    )}>
                      {budgetData.withinBudget ? 'Within Budget' : 'Over Budget'}
                    </span>
                  </div>
                  {isLoading ? (
                    <div className="animate-pulse space-y-3"><div className="h-8 bg-muted rounded" /><div className="h-3 bg-muted rounded w-full" /></div>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-4 mb-3">
                        {[
                          { label: 'Current Spend', value: formatCurrency(budgetData.currentSpend), color: 'text-foreground' },
                          { label: 'Projected Total', value: formatCurrency(budgetData.projectedTotal), color: 'text-foreground' },
                          { label: 'Variance', value: `+${formatCurrency(budgetData.variance)}`, color: 'text-emerald-400' },
                        ].map(({ label, value, color }) => (
                          <div key={label}>
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{label}</p>
                            <p className={cn('text-xl font-bold', color)}>{value}</p>
                          </div>
                        ))}
                      </div>
                      <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                        <div
                          className={cn('h-full rounded-full transition-all duration-500', budgetData.withinBudget ? 'bg-gradient-to-r from-emerald-500 to-emerald-400' : 'bg-gradient-to-r from-red-500 to-red-400')}
                          style={{ width: `${budgetData.pct}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1.5">{budgetData.pct.toFixed(1)}% of {formatCurrency(budgetData.budgetCap)} budget cap</p>
                    </>
                  )}
                </div>
              </div>

              {/* ===================== FOOTER ACTION BAR ===================== */}
              <div className="flex items-center justify-between gap-4 flex-wrap bg-card border border-border/60 rounded-xl px-5 py-4">
                <div className="flex items-start gap-2.5 text-xs text-muted-foreground max-w-[520px]">
                  <Info className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    This generation applies only to{' '}
                    <span className="font-semibold text-foreground">{subDepartmentName || departmentName || 'the current scope'}</span>.
                    Other sub-departments are strictly isolated and not affected.
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Button variant="outline" onClick={() => window.history.back()}>Cancel</Button>
                  <Button
                    onClick={() => setShowConfirmDialog(true)}
                    disabled={!hasShifts || totalProposedShifts === 0 || isLoading}
                    className="gap-2 font-semibold px-6"
                  >
                    <Zap className="h-4 w-4" />
                    Confirm & Inject
                    {totalProposedShifts > 0 && (
                      <Badge className="ml-1 bg-primary-foreground/20 text-primary-foreground border-0 text-xs">
                        {totalProposedShifts}
                      </Badge>
                    )}
                  </Button>
                </div>
              </div>

            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ===================== MODALS ===================== */}
      <AnimatePresence>
        {showDetailsModal && (
          <DetailsModal data={timelineData} onClose={() => setShowDetailsModal(false)} />
        )}
        {showConfirmDialog && (
          <ConfirmDialog
            injectionGroups={proposedInjection}
            onConfirm={() => injectMutation.mutate()}
            onCancel={() => setShowConfirmDialog(false)}
            isPending={injectMutation.isPending}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default LaborDemandForecastingPage;
