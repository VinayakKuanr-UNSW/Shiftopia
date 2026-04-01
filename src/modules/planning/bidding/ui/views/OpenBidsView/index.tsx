// src/modules/planning/bidding/ui/views/OpenBidsView/index.tsx

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, addDays, subDays } from 'date-fns';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/platform/realtime/client';
import { shiftKeys } from '@/modules/rosters/api/queryKeys';
import { cn } from '@/modules/core/lib/utils';
import {
  Search, Flame, Clock, CheckCircle, Loader2, Inbox,
  Users, Zap, ShieldCheck, ShieldAlert, Shield,
  CircleCheck, CircleX, TriangleAlert, ChevronDown, ChevronRight,
  Sparkles, UserCheck as LucideUserCheck, History,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import { Input } from '@/modules/core/ui/primitives/input';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Avatar, AvatarFallback } from '@/modules/core/ui/primitives/avatar';
import { Separator } from '@/modules/core/ui/primitives/separator';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import {
  runHardValidation,
  ComplianceCheckInput,
  ShiftTimeRange,
} from '@/modules/compliance';
import { evaluateCompliance } from '@/modules/compliance/v2';
import type { ComplianceInputV2, RuleHitV2 } from '@/modules/compliance/v2/types';
import { fetchEmployeeContextV2 } from '@/modules/compliance/employee-context';
import { validateCompliance } from '@/modules/rosters/services/compliance.service';
import { SharedShiftCard } from '@/modules/planning/ui/components/SharedShiftCard';
import type { ShiftUrgency } from '@/modules/rosters/domain/bidding-urgency';
import { calculateTimeRemaining, formatTimeRemaining } from './utils';
import type { BidToggle, ManagerBidShift, EmployeeBid, ToggleCounts, IterationHistoryEntry } from './types';
import { useManagerBidShifts } from './useOpenShifts';
import { useShiftBids } from './useShiftBids';
import { useTimeTicker } from './useTimeTicker';
import { getAvailabilitySlots } from '@/modules/availability/api/availability.api';
import { checkAvailabilityOnly } from '@/modules/compliance/v2/eligibility';
import { CompliancePanel } from '@/modules/compliance/ui/CompliancePanel';
import { classifyBuckets, getBucketSummary } from '@/modules/compliance/ui/bucket-map';
import type { UseCompliancePanelReturn, PanelStatus, PanelResult } from '@/modules/compliance/ui/useCompliancePanel';

// =============================================================================
// GROUP COLOR SYSTEM — venue-inherited theming
// All class strings are written statically so Tailwind can scan them.
// =============================================================================

type GroupVariant = 'convention' | 'exhibition' | 'theatre' | 'default';

const GROUP_THEME: Record<GroupVariant, {
  bar: string;       // left stripe color
  tint: string;      // subtle card bg
  ring: string;      // focus ring
  text: string;      // accent text
  boost: string;     // Boost CTA bg + text
  badge: string;     // group badge
  dot: string;       // selection dot fill
}> = {
  convention: {
    bar:   'bg-blue-500',
    tint:  'bg-blue-500/[0.05]',
    ring:  'ring-blue-500/30',
    text:  'text-blue-600 dark:text-blue-400',
    boost: 'bg-blue-500 hover:bg-blue-600 text-white shadow-blue-500/25',
    badge: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20',
    dot:   'bg-blue-500',
  },
  exhibition: {
    bar:   'bg-emerald-500',
    tint:  'bg-emerald-500/[0.05]',
    ring:  'ring-emerald-500/30',
    text:  'text-emerald-600 dark:text-emerald-400',
    boost: 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/25',
    badge: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
    dot:   'bg-emerald-500',
  },
  theatre: {
    bar:   'bg-rose-500',
    tint:  'bg-rose-500/[0.05]',
    ring:  'ring-rose-500/30',
    text:  'text-rose-600 dark:text-rose-400',
    boost: 'bg-rose-500 hover:bg-rose-600 text-white shadow-rose-500/25',
    badge: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20',
    dot:   'bg-rose-500',
  },
  default: {
    bar:   'bg-violet-500',
    tint:  'bg-violet-500/[0.05]',
    ring:  'ring-violet-500/30',
    text:  'text-violet-600 dark:text-violet-400',
    boost: 'bg-violet-500 hover:bg-violet-600 text-white shadow-violet-500/25',
    badge: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20',
    dot:   'bg-violet-500',
  },
};

function getGroupVariant(groupType?: string | null, dept?: string): GroupVariant {
  const d = (dept || '').toLowerCase();
  const g = (groupType || '').toLowerCase();
  if (g.includes('convention') || d.includes('convention')) return 'convention';
  if (g.includes('exhibition') || d.includes('exhibition')) return 'exhibition';
  if (g.includes('theatre') || g.includes('theater') || d.includes('theatre') || d.includes('theater')) return 'theatre';
  return 'default';
}

// =============================================================================
// HELPERS
// =============================================================================

function formatTimeLeft(deadline: string): { label: string; colorCls: string; isUrgent: boolean } {
  const tr = calculateTimeRemaining(deadline);
  if (tr.isExpired) return { label: 'EXPIRED', colorCls: 'text-rose-600 dark:text-rose-400', isUrgent: true };
  const totalHours = tr.hours;
  if (totalHours === 0) return { label: `${tr.minutes}m`, colorCls: 'text-rose-600 dark:text-rose-400', isUrgent: true };
  if (totalHours < 2) return { label: `${totalHours}h ${tr.minutes}m`, colorCls: 'text-rose-600 dark:text-rose-400', isUrgent: true };
  const days = Math.floor(totalHours / 24);
  const label = days > 0 ? `${days}d ${totalHours % 24}h` : `${totalHours}h ${tr.minutes}m`;
  return { label, colorCls: 'text-amber-600 dark:text-amber-400', isUrgent: false };
}

function getInitials(name: string): string {
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
}

// =============================================================================
// useBidsCompliancePanel — custom hook wrapping DB-fetch compliance for bids
// =============================================================================

function useBidsCompliancePanel(
  selectedBid: EmployeeBid | null,
  expandedShift: ReturnType<typeof useManagerBidShifts>['shifts'][number] | null,
  toastFn: ReturnType<typeof useToast>['toast'],
): UseCompliancePanelReturn {
  const [status, setStatus]   = useState<PanelStatus>('idle');
  const [result, setResult]   = useState<PanelResult | null>(null);
  const [error,  setError]    = useState<string | null>(null);
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false);
  const runningRef = useRef(false);

  // Reset when selection changes
  useEffect(() => {
    setStatus('idle');
    setResult(null);
    setError(null);
    setWarningsAcknowledged(false);
  }, [selectedBid?.id, expandedShift?.id]);

  const run = useCallback(async () => {
    if (!selectedBid || !expandedShift || runningRef.current) return;
    runningRef.current = true;
    setStatus('running');
    setError(null);
    setWarningsAcknowledged(false);

    try {
      const shiftDate = new Date(expandedShift.date);
      const LOOKBACK_DAYS  = 30;
      const LOOKAHEAD_DAYS = 14;
      const startDate = format(subDays(shiftDate, LOOKBACK_DAYS),  'yyyy-MM-dd');
      const endDate   = format(addDays(shiftDate, LOOKAHEAD_DAYS), 'yyyy-MM-dd');

      // Fetch existing shifts
      const { data: existingRaw } = await supabase
        .from('shifts')
        .select('id, start_time, end_time, shift_date, unpaid_break_minutes')
        .eq('assigned_employee_id', selectedBid.employeeId)
        .gte('shift_date', startDate)
        .lte('shift_date', endDate)
        .is('deleted_at', null)
        .eq('is_cancelled', false);

      const existingShifts = (existingRaw || [])
        .filter((s: any) => s.id !== expandedShift.id)
        .map((s: any, idx: number) => ({
          shift_id:                s.id || `s-${idx}`,
          shift_date:              s.shift_date,
          start_time:              (s.start_time || '').replace(/:\d{2}$/, ''),
          end_time:                (s.end_time   || '').replace(/:\d{2}$/, ''),
          role_id:                 '',
          required_qualifications: [],
          is_ordinary_hours:       true,
          break_minutes:           s.unpaid_break_minutes || 0,
          unpaid_break_minutes:    s.unpaid_break_minutes || 0,
        }));

      // Fetch real employee context (contracted role_ids, qualifications, visa flag)
      const employeeCtx = await fetchEmployeeContextV2(selectedBid.employeeId);

      // Build v2 input
      const v2Input: ComplianceInputV2 = {
        employee_id: selectedBid.employeeId,
        employee_context: employeeCtx,
        existing_shifts: existingShifts,
        candidate_changes: {
          add_shifts: [{
            shift_id:                expandedShift.id,
            shift_date:              expandedShift.date,
            start_time:              expandedShift.startTime,
            end_time:                expandedShift.endTime,
            role_id:                 expandedShift.roleId || '',
            organization_id:         expandedShift.organizationId,
            department_id:           expandedShift.departmentId,
            sub_department_id:       expandedShift.subDepartmentId,
            required_qualifications: [],
            is_ordinary_hours:       true,
            break_minutes:           0,
            unpaid_break_minutes:    expandedShift.unpaidBreak || 0,
          }],
          remove_shifts: [],
        },
        mode:           'SIMULATED',
        operation_type: 'BID',
        stage:          'DRAFT',
      };

      // Run v2 engine
      const v2Result = evaluateCompliance(v2Input);
      const allHits: RuleHitV2[] = [...v2Result.rule_hits];

      // Server-side qual/eligibility check → convert to RuleHitV2
      try {
        const _toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
        const _sMin = _toMin(expandedShift.startTime);
        const _eMin = _toMin(expandedShift.endTime);
        const _dur  = _eMin > _sMin ? _eMin - _sMin : _eMin + 1440 - _sMin;
        const _net  = Math.max(1, _dur - (expandedShift.unpaidBreak || 0));

        const bucketAResult = await validateCompliance({
          employeeId:       selectedBid.employeeId,
          shiftDate:        expandedShift.date,
          startTime:        expandedShift.startTime + ':00',
          endTime:          expandedShift.endTime   + ':00',
          netLengthMinutes: _net,
          shiftId:          expandedShift.id,
          excludeShiftId:   expandedShift.id,
        });

        (bucketAResult.qualificationViolations ?? []).forEach((v: any) => {
          allHits.push({
            rule_id:          'R11_QUALIFICATIONS',
            severity:         'BLOCKING',
            message:          v.message || 'Missing required qualification.',
            resolution_hint:  'Employee must hold all required qualifications.',
            affected_shifts:  [expandedShift.id],
          } as RuleHitV2);
        });

        (bucketAResult.violations || []).filter((v: string) =>
          v.toLowerCase().includes('contract') || v.toLowerCase().includes('role')
        ).forEach((v: string) => {
          allHits.push({
            rule_id:         'R10_ROLE_CONTRACT_MATCH',
            severity:        'BLOCKING',
            message:         v,
            resolution_hint: 'Ensure employee is contracted for the required role.',
            affected_shifts: [expandedShift.id],
          } as RuleHitV2);
        });

        (bucketAResult.warnings || []).filter((w: string) =>
          w.toLowerCase().includes('availability') || w.toLowerCase().includes('locked')
        ).forEach((w: string) => {
          allHits.push({
            rule_id:         'R_AVAILABILITY_MATCH',
            severity:        'WARNING',
            message:         w,
            resolution_hint: '',
            affected_shifts: [expandedShift.id],
          } as RuleHitV2);
        });
      } catch { /* server check optional */ }

      // Availability check
      if (!allHits.some(h => h.rule_id === 'R_AVAILABILITY_MATCH')) {
        try {
          const slots = await getAvailabilitySlots(selectedBid.employeeId, expandedShift.date, expandedShift.date);
          const avRes = checkAvailabilityOnly(
            {
              shift_id:    expandedShift.id,
              employee_id: selectedBid.employeeId,
              shift_date:  expandedShift.date,
              start_time:  expandedShift.startTime + ':00',
              end_time:    expandedShift.endTime   + ':00',
            } as any,
            { declared_slots: slots, assigned_shifts: [] },
            'BID'
          );
          if (!avRes.eligible || avRes.advisories.length > 0) {
            const msg = avRes.reasons[0] || avRes.advisories[0] || 'Outside declared availability.';
            allHits.push({
              rule_id:         'R_AVAILABILITY_MATCH',
              severity:        avRes.eligible ? 'WARNING' : 'BLOCKING',
              message:         msg,
              resolution_hint: '',
              affected_shifts: [expandedShift.id],
            } as RuleHitV2);
          }
        } catch { /* availability check optional */ }
      }

      const buckets = classifyBuckets(allHits);
      const summary  = getBucketSummary(buckets);

      setResult({
        buckets,
        summary,
        evaluatedAt: new Date(),
        rawResult:   v2Result,
      });
      setStatus('results');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Compliance check failed');
      setStatus('error');
    } finally {
      runningRef.current = false;
    }
  }, [selectedBid, expandedShift, toastFn]);

  const canProceed =
    status === 'results' &&
    result !== null &&
    result.buckets.A.length   === 0 &&
    result.summary.systemFails === 0 &&
    (result.buckets.B.length  === 0 || warningsAcknowledged);

  return {
    status,
    result,
    error,
    warningsAcknowledged,
    canProceed,
    run,
    acknowledgeWarnings: setWarningsAcknowledged,
    markStale: () => setStatus(prev => prev === 'results' ? 'stale' : prev),
    reset: () => { setStatus('idle'); setResult(null); setError(null); setWarningsAcknowledged(false); },
  };
}

// =============================================================================
// BIDDER ROW — selection dot drives Compliance Engine
// =============================================================================

interface BidderRowProps {
  bid: EmployeeBid;
  index: number;
  isSelected: boolean;
  isWinner: boolean;
  groupVariant: GroupVariant;
  onSelect: () => void;
}

const BidderRow: React.FC<BidderRowProps> = ({ bid, index, isSelected, isWinner, groupVariant, onSelect }) => {
  const theme = GROUP_THEME[groupVariant];

  return (
    <motion.button
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, delay: index * 0.04, ease: [0.23, 1, 0.32, 1] }}
      onClick={onSelect}
      className={cn(
        'w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl transition-colors text-left group/bid relative overflow-hidden',
        isSelected
          ? `bg-white/[0.06] ring-1 ${theme.ring}`
          : 'hover:bg-white/[0.03]',
        isWinner && 'opacity-50 pointer-events-none',
      )}
    >
      {/* Selected left bar */}
      {isSelected && (
        <motion.div
          layoutId="bidder-bar"
          className={cn('absolute left-0 top-2 bottom-2 w-[3px] rounded-full', theme.bar)}
          transition={{ type: 'spring', stiffness: 500, damping: 40 }}
        />
      )}

      {/* Avatar */}
      <Avatar className="h-7 w-7 shrink-0 border border-white/[0.08]">
        <AvatarFallback className={cn(
          'text-[9px] font-black tracking-tight',
          isWinner
            ? 'bg-emerald-500/20 text-emerald-400'
            : isSelected
            ? 'bg-primary/20 text-primary'
            : 'bg-white/[0.04] text-white/30',
        )}>
          {getInitials(bid.employeeName)}
        </AvatarFallback>
      </Avatar>

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <span className={cn(
          'text-[12px] font-semibold leading-none block truncate transition-colors',
          isSelected ? 'text-white' : 'text-white/55'
        )}>
          {bid.employeeName}
        </span>
        <div className="flex items-center gap-1.5 mt-1">
          <span className="text-[9px] font-mono text-white/20 uppercase tracking-wider">{bid.employmentType}</span>
          {bid.fatigueRisk === 'high' && (
            <span className="text-[8px] font-black text-rose-500/70 bg-rose-500/10 px-1 rounded leading-none py-0.5">FATIGUE</span>
          )}
        </div>
      </div>

      {/* Right badge */}
      {isWinner ? (
        <CheckCircle className="h-3.5 w-3.5 text-emerald-500/60 shrink-0" />
      ) : isSelected ? (
        <motion.div
          animate={{ scale: [1, 1.4, 1] }}
          transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
          className={cn('h-1.5 w-1.5 rounded-full', theme.dot)}
        />
      ) : null}
    </motion.button>
  );
};

// =============================================================================
// ROLE CARD — debit card design with venue-inherited theming
// =============================================================================

interface RoleCardProps {
  shift: ManagerBidShift;
  isSelected: boolean;
  onSelect: () => void;
}

const RoleCard: React.FC<RoleCardProps> = ({
  shift, isSelected, onSelect,
}) => {
  const groupVariant = getGroupVariant(shift.groupType, shift.department);
  const isResolved = shift.toggle === 'resolved';

  useTimeTicker(1000);
  const timeRemaining = calculateTimeRemaining(shift.biddingDeadline || shift.date);
  const timerLabel = formatTimeRemaining(timeRemaining);

  const urgency: ShiftUrgency = shift.toggle === 'urgent' ? 'urgent' : 'normal';

  const netLength = (() => {
    const toMin = (t: string) => { const [h, m] = (t || '00:00').split(':').map(Number); return h * 60 + (m || 0); };
    let gross = toMin(shift.endTime) - toMin(shift.startTime);
    if (gross < 0) gross += 1440;
    return Math.max(1, gross - shift.unpaidBreak);
  })();

  return (
    <SharedShiftCard
      organization={shift.organization}
      department={shift.department}
      subGroup={shift.subDepartment}
      role={shift.role}
      shiftDate={shift.dayLabel}
      startTime={shift.startTime}
      endTime={shift.endTime}
      netLength={netLength}
      paidBreak={shift.paidBreak}
      unpaidBreak={shift.unpaidBreak}
      urgency={urgency}
      groupVariant={groupVariant}
      timerText={!isResolved ? (timeRemaining.isExpired ? 'CLOSED' : `${timerLabel} left`) : undefined}
      isExpired={!isResolved && timeRemaining.isExpired}
      onClick={onSelect}
      className={cn(
        isSelected && 'ring-2 ring-primary/40',
        isResolved && 'opacity-40',
      )}
      statusIcons={
        <div className="col-span-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Users className="h-3 w-3 text-muted-foreground/40" />
            <span className="text-[10px] font-bold tabular-nums text-muted-foreground/60">
              {shift.bidCount} {shift.bidCount === 1 ? 'bid' : 'bids'}
            </span>
            {(shift.biddingIteration ?? 1) > 1 && (
              <span className="text-[8px] font-black px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20 leading-none uppercase tracking-wider font-mono">
                ITR {shift.biddingIteration}
              </span>
            )}
          </div>
          {isResolved && (
            <span className="text-[8px] font-black px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 leading-none uppercase tracking-wider">Filled</span>
          )}
        </div>
      }
    />
  );
};

// ===================================
// PANE HELPERS
// ===================================

const PaneHeader: React.FC<{ title: string; subtitle?: string; icon?: React.ReactNode; count?: number; accentClass?: string }> = ({ title, subtitle, icon, count, accentClass }) => (
  <div className="shrink-0 px-5 pt-5 pb-4 border-b border-white/[0.05] flex items-center justify-between">
    <div className="flex items-center gap-2.5">
      {icon && (
        <div className={cn('shrink-0', accentClass ?? 'text-white/20')}>
          {icon}
        </div>
      )}
      <div>
        <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/40 block leading-none">{title}</span>
        {subtitle && <span className="text-[9px] text-white/20 mt-1.5 block leading-none font-mono truncate max-w-[160px]">{subtitle}</span>}
      </div>
    </div>
    {count !== undefined && (
      <span className="text-[11px] font-bold tabular-nums text-white/25">
        {count}
      </span>
    )}
  </div>
);

// Toggle Chip Helper

interface ToggleChipProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
  activeClass: string;
}

const ToggleChip: React.FC<ToggleChipProps> = ({ active, onClick, icon, label, count, activeClass }) => (
  <button
    onClick={onClick}
    className={cn(
      'relative px-3.5 py-1.5 rounded-xl text-[11px] font-semibold uppercase tracking-wider transition-colors duration-150 flex items-center gap-2 border',
      active
        ? activeClass
        : 'text-white/25 border-transparent hover:text-white/50 hover:bg-white/[0.03]',
    )}
  >
    {icon}
    {label}
    <span className={cn(
      'text-[10px] font-bold tabular-nums min-w-[18px] text-center',
      active ? 'opacity-80' : 'text-white/20',
    )}>
      {count}
    </span>
  </button>
);

// =============================================================================
// MAIN VIEW
// =============================================================================

interface OpenBidsViewProps {
  organizationId?: string | null;
  departmentId?: string | null;
  subDepartmentId?: string | null;
}

export const OpenBidsView: React.FC<OpenBidsViewProps> = ({
  organizationId,
  departmentId,
  subDepartmentId,
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Updates countdown timers every 10 seconds
  useTimeTicker(10000);

  // ── State ──────────────────────────────────────────────────────────────────
  const [activeToggle, setActiveToggle] = useState<BidToggle>('urgent');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedShiftId, setExpandedShiftId] = useState<string | null>(null);
  const [selectedBid, setSelectedBid] = useState<EmployeeBid | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);
  const [isAutoAssigning, setIsAutoAssigning] = useState(false);

  // ── Data ───────────────────────────────────────────────────────────────────
  const { shifts, isLoading } = useManagerBidShifts({
    organizationId: organizationId ?? undefined,
    departmentId: departmentId ?? undefined,
    subDepartmentId: subDepartmentId ?? undefined,
  });

  const { bids, iterationHistory, currentIteration: shiftCurrentIteration, isLoading: isLoadingBids } = useShiftBids(expandedShiftId);

  // ── Derived ────────────────────────────────────────────────────────────────
  const expandedShift = useMemo(
    () => shifts.find(s => s.id === expandedShiftId) ?? null,
    [shifts, expandedShiftId],
  );

  const counts: ToggleCounts = useMemo(() => ({
    urgent:   shifts.filter(s => s.toggle === 'urgent').length,
    normal:   shifts.filter(s => s.toggle === 'normal').length,
    resolved: shifts.filter(s => s.toggle === 'resolved').length,
  }), [shifts]);

  const filteredShifts = useMemo(() => {
    let result = shifts.filter(s => s.toggle === activeToggle);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(s =>
        s.role.toLowerCase().includes(q) ||
        s.department.toLowerCase().includes(q) ||
        s.subDepartment.toLowerCase().includes(q),
      );
    }
    return result;
  }, [shifts, activeToggle, searchQuery]);

  // ── Compliance Panel ───────────────────────────────────────────────────────
  const bidsPanel = useBidsCompliancePanel(selectedBid, expandedShift, toast);

  // Derived from bidsPanel.result for Intelligence pane
  const blockingIssues = bidsPanel.result?.buckets.A ?? [];
  const warningIssues  = bidsPanel.result?.buckets.B ?? [];

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleExpand = useCallback((shiftId: string) => {
    setExpandedShiftId(prev => {
      const next = prev === shiftId ? null : shiftId;
      if (next !== prev) {
        setSelectedBid(null);
      }
      return next;
    });
  }, []);

  const handleSelectBid = useCallback((bid: EmployeeBid) => {
    setSelectedBid(prev => prev?.id === bid.id ? null : bid);
  }, []);

  const handleAssign = useCallback(async () => {
    if (
      !selectedBid || !expandedShiftId ||
      !bidsPanel.canProceed || isAssigning
    ) return;

    setIsAssigning(true);
    try {
      const { error } = await (supabase as any).rpc('sm_select_bid_winner', {
        p_shift_id:  expandedShiftId,
        p_winner_id: selectedBid.employeeId,
        p_user_id:   (await supabase.auth.getUser()).data.user?.id,
      });
      if (error) throw error;

      toast({ title: 'Shift Assigned', description: `Assigned to ${selectedBid.employeeName}.` });
      queryClient.invalidateQueries({ queryKey: shiftKeys.managerBidShifts(organizationId || '') });
      queryClient.invalidateQueries({ queryKey: shiftKeys.bids(expandedShiftId) });
      setSelectedBid(null);
      bidsPanel.reset();
    } catch (err: any) {
      toast({ title: 'Assignment Failed', description: err.message || 'Failed to assign.', variant: 'destructive' });
    } finally {
      setIsAssigning(false);
    }
  }, [selectedBid, expandedShiftId, bidsPanel, isAssigning, toast, queryClient, organizationId]);


  const handleAutoAssign = useCallback(async () => {
    // All unfilled open shifts (urgent + normal) with at least one bid.
    // Sort chronologically so streak/window rules see assignments accumulate in
    // order — processing out-of-order lets MAX_CONSECUTIVE_DAYS be fooled by
    // short isolated fragments that never individually breach the 20-day limit.
    const urgentShifts = shifts
      .filter(s => s.toggle !== 'resolved' && s.bidCount > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (urgentShifts.length === 0) {
      toast({ title: 'No Eligible Shifts', description: 'No open shifts with active bids.' });
      return;
    }

    setIsAutoAssigning(true);
    let assigned = 0, skipped = 0, failed = 0;
    const userId = (await supabase.auth.getUser()).data.user?.id;

    // Cache student-visa enforcement flag per employee to avoid redundant DB calls.
    // Keyed by employee_id → has_restricted_work_limit from employee_licenses.
    const visaFlagCache = new Map<string, boolean>();
    const getVisaFlag = async (employeeId: string): Promise<boolean> => {
      if (visaFlagCache.has(employeeId)) return visaFlagCache.get(employeeId)!;
      const { data } = await supabase
        .from('employee_licenses')
        .select('has_restricted_work_limit')
        .eq('employee_id', employeeId)
        .eq('license_type', 'WorkRights')
        .maybeSingle();
      const flag = data?.has_restricted_work_limit ?? false;
      visaFlagCache.set(employeeId, flag);
      return flag;
    };

    for (const shift of urgentShifts) {
      try {
        // Fetch ALL pending bids in FIFO order; try each until one passes compliance
        const { data: allBids } = await supabase
          .from('shift_bids')
          .select('id, employee_id')
          .eq('shift_id', shift.id)
          .eq('status', 'pending')
          .order('created_at', { ascending: true });

        if (!allBids || allBids.length === 0) { skipped++; continue; }

        // D-30: covers D-27 lookback for WORKING_DAYS_CAP / AVG_FOUR_WEEK_CYCLE,
        // plus one extra day for cross-midnight shifts (MIN_REST_GAP / NO_OVERLAP).
        // D+14: catches next-shift rest-gap.
        const shiftDate = new Date(shift.date);
        const AA_LOOKBACK  = 30;
        const AA_LOOKAHEAD = 14;
        const startDate = format(subDays(shiftDate, AA_LOOKBACK),  'yyyy-MM-dd');
        const endDate   = format(addDays(shiftDate, AA_LOOKAHEAD), 'yyyy-MM-dd');

        let winnerBid: { id: string; employee_id: string } | null = null;

        for (const bid of allBids) {
          const { data: existingRaw } = await supabase
            .from('shifts')
            .select('id, start_time, end_time, shift_date, unpaid_break_minutes')
            .eq('assigned_employee_id', bid.employee_id)
            .gte('shift_date', startDate)
            .lte('shift_date', endDate)
            .is('deleted_at', null)
            .eq('is_cancelled', false);

          const existingShifts: ShiftTimeRange[] = (existingRaw || [])
            .filter((s: any) => s.id !== shift.id)
            .map((s: any) => ({
              shift_date:           s.shift_date,
              start_time:           s.start_time,
              end_time:             s.end_time,
              unpaid_break_minutes: s.unpaid_break_minutes || 0,
            }));

          // Fetch the student-visa enforcement flag for this bidder.
          // This makes STUDENT_VISA_48H blocking (not just a warning) when the
          // employee has has_restricted_work_limit = true on their WorkRights license.
          const studentVisaEnforcement = await getVisaFlag(bid.employee_id);

          const input: ComplianceCheckInput = {
            employee_id:              bid.employee_id,
            action_type:              'bid',
            shifts_window_days:       AA_LOOKBACK + AA_LOOKAHEAD, // enables MAX_CONSECUTIVE_DAYS F11 guard
            student_visa_enforcement: studentVisaEnforcement,
            candidate_shift: {
              shift_date:           shift.date,
              start_time:           shift.startTime + ':00',
              end_time:             shift.endTime   + ':00',
              unpaid_break_minutes: shift.unpaidBreak || 0,
            },
            existing_shifts: existingShifts,
          };

          const hv = runHardValidation({
            shift_date:      input.candidate_shift.shift_date,
            start_time:      input.candidate_shift.start_time,
            end_time:        input.candidate_shift.end_time,
            employee_id:     input.employee_id,
            existing_shifts: input.existing_shifts,
            current_time:    new Date(),
            is_template:     false,
          });

          let hasBlocker = !hv.passed;
          if (!hasBlocker) {
            const autoEmployeeCtx = await fetchEmployeeContextV2(input.employee_id);
            const v2AutoInput: ComplianceInputV2 = {
              employee_id: input.employee_id,
              employee_context: autoEmployeeCtx,
              existing_shifts: existingShifts.map((s, idx) => ({
                shift_id:                (s as any).shift_id || `s-${idx}`,
                shift_date:              s.shift_date,
                start_time:              (s.start_time || '').replace(/:\d{2}$/, ''),
                end_time:                (s.end_time   || '').replace(/:\d{2}$/, ''),
                role_id:                 '',
                required_qualifications: [],
                is_ordinary_hours:       true,
                break_minutes:           s.unpaid_break_minutes || 0,
                unpaid_break_minutes:    s.unpaid_break_minutes || 0,
              })),
              candidate_changes: {
                add_shifts: [{
                  shift_id:                shift.id,
                  shift_date:              shift.date,
                  start_time:              shift.startTime,
                  end_time:                shift.endTime,
                  role_id:                 shift.roleId || '',
                  organization_id:         shift.organizationId,
                  department_id:           shift.departmentId,
                  sub_department_id:       shift.subDepartmentId,
                  required_qualifications: [],
                  is_ordinary_hours:       true,
                  break_minutes:           0,
                  unpaid_break_minutes:    shift.unpaidBreak || 0,
                }],
                remove_shifts: [],
              },
              mode:           'SIMULATED',
              operation_type: 'BID',
              stage:          'DRAFT',
            };
            const v2AutoResult = evaluateCompliance(v2AutoInput);
            hasBlocker = v2AutoResult.rule_hits.some(h => h.severity === 'BLOCKING');
          }

          if (!hasBlocker) {
            winnerBid = bid;
            break; // first compliance-clear bidder wins
          }
        }

        if (!winnerBid) { skipped++; continue; }

        // Assign the compliance-clear winner
        const { error } = await (supabase as any).rpc('sm_select_bid_winner', {
          p_shift_id:  shift.id,
          p_winner_id: winnerBid.employee_id,
          p_user_id:   userId,
        });

        if (error) { failed++; } else { assigned++; }
      } catch {
        failed++;
      }
    }

    setIsAutoAssigning(false);
    queryClient.invalidateQueries({ queryKey: shiftKeys.managerBidShifts(organizationId || '') });
    toast({
      title:       'Auto-Assign Complete',
      description: `${assigned} assigned · ${skipped} skipped · ${failed} failed`,
    });
  }, [shifts, toast, queryClient, organizationId]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex flex-col h-[calc(100vh-64px)] bg-background select-none text-foreground overflow-hidden">

      {/* ─── FUNCTION BAR ─────────────────────────────────────────────── */}
      <div className="shrink-0 h-14 border-b border-border/60 flex items-center px-6 gap-4 bg-card/40 backdrop-blur-xl">
        <div className="relative group/search">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40 group-focus-within/search:text-primary transition-colors" />
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search roles…"
            className="w-60 h-9 bg-muted/30 border-border/50 pl-9 text-[13px] placeholder:text-muted-foreground/30 focus-visible:ring-1 focus-visible:ring-primary/30 rounded-xl"
          />
        </div>

        <Separator orientation="vertical" className="h-5 bg-border/40" />

        <div className="flex items-center gap-1 p-0.5 bg-muted/20 rounded-xl border border-border/40">
          <ToggleChip active={activeToggle === 'urgent'} onClick={() => setActiveToggle('urgent')} icon={<Flame className="h-3 w-3" />} label="Urgent" count={counts.urgent} activeClass="bg-rose-500/10 text-rose-400 border-rose-500/20" />
          <ToggleChip active={activeToggle === 'normal'} onClick={() => setActiveToggle('normal')} icon={<Clock className="h-3 w-3" />} label="Normal" count={counts.normal} activeClass="bg-amber-500/10 text-amber-400 border-amber-500/20" />
          <ToggleChip active={activeToggle === 'resolved'} onClick={() => setActiveToggle('resolved')} icon={<CheckCircle className="h-3 w-3" />} label="Resolved" count={counts.resolved} activeClass="bg-emerald-500/10 text-emerald-400 border-emerald-500/20" />
        </div>

        <div className="flex-1" />

        <Button
          onClick={handleAutoAssign}
          disabled={isAutoAssigning}
          size="sm"
          className="h-9 px-5 text-[11px] font-semibold uppercase tracking-wider rounded-xl shadow-lg shadow-primary/15"
        >
          <AnimatePresence mode="wait" initial={false}>
            {isAutoAssigning ? (
              <motion.span key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Assigning…
              </motion.span>
            ) : (
              <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
                <Zap className="h-3.5 w-3.5" /> Auto-Assign Safe Bids
              </motion.span>
            )}
          </AnimatePresence>
        </Button>
      </div>

      {/* ─── 4-PANE SYSTEM ────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden divide-x divide-border/40">

        {/* ── Pane 1: Open Roles ─────────────────────────────────────── */}
        <div className="w-[22%] min-w-[240px] max-w-[300px] flex flex-col bg-card/20">
          <PaneHeader
            title="Open Roles"
            subtitle={`${activeToggle} · ${filteredShifts.length} shifts`}
            icon={<Inbox className="h-3.5 w-3.5" />}
            count={filteredShifts.length}
          />
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-2">
              <AnimatePresence mode="wait">
                {isLoading ? (
                  <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-20 flex flex-col items-center gap-3 text-muted-foreground/30">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="text-[10px] uppercase tracking-widest font-semibold">Loading…</span>
                  </motion.div>
                ) : filteredShifts.length === 0 ? (
                  <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-20 flex flex-col items-center gap-3 text-muted-foreground/20">
                    <Inbox className="h-6 w-6" />
                    <p className="text-[10px] uppercase tracking-widest font-semibold">No roles</p>
                  </motion.div>
                ) : (
                  <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
                    {filteredShifts.map((s) => (
                      <RoleCard
                        key={s.id}
                        shift={s}
                        isSelected={expandedShiftId === s.id}
                        onSelect={() => handleExpand(s.id)}
                      />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </ScrollArea>
        </div>

        {/* ── Pane 2: Bidders ────────────────────────────────────────── */}
        <div className="w-[18%] min-w-[200px] max-w-[260px] flex flex-col bg-card/10">
          <PaneHeader
            title="Bidders"
            subtitle={expandedShift?.role ?? 'Select a role'}
            icon={<Users className="h-3.5 w-3.5" />}
            count={expandedShift ? bids.length : undefined}
          />
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-1">
              <AnimatePresence mode="wait">
                {!expandedShift ? (
                  <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-20 flex flex-col items-center gap-3 text-muted-foreground/20">
                    <ChevronRight className="h-5 w-5" />
                    <p className="text-[10px] uppercase tracking-widest font-semibold text-center">Select a role</p>
                  </motion.div>
                ) : isLoadingBids ? (
                  <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-20 flex justify-center text-muted-foreground/20">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </motion.div>
                ) : bids.length === 0 ? (
                  <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-20 flex flex-col items-center gap-3 text-muted-foreground/20">
                    <Users className="h-5 w-5" />
                    <p className="text-[10px] uppercase tracking-widest font-semibold">No bids yet</p>
                  </motion.div>
                ) : (
                  <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-1">
                    {bids.map((bid, i) => (
                      <BidderRow
                        key={bid.id}
                        bid={bid}
                        index={i}
                        isSelected={selectedBid?.id === bid.id}
                        isWinner={expandedShift.assignedEmployeeId === bid.employeeId || (!expandedShift.assignedEmployeeId && bid.isWinner)}
                        groupVariant={getGroupVariant(expandedShift.groupType, expandedShift.department)}
                        onSelect={() => handleSelectBid(bid)}
                      />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── ITERATION HISTORY — all past ITRs ── */}
              {iterationHistory.length > 0 && (
                <div className="mt-4 border-t border-white/[0.05] pt-4">
                  <div className="flex items-center gap-2 px-1 mb-3">
                    <History className="h-3 w-3 text-white/20" />
                    <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/25">
                      Past Iterations
                    </span>
                  </div>
                  <div className="space-y-3">
                    {iterationHistory.map(entry => (
                      <div key={entry.iteration} className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[9px] font-black font-mono uppercase tracking-widest text-white/30 bg-white/5 px-2 py-0.5 rounded-md">
                            ITR {entry.iteration}
                          </span>
                          <span className="text-[9px] text-white/20 font-mono">
                            {entry.bids.length} {entry.bids.length === 1 ? 'bid' : 'bids'}
                          </span>
                        </div>
                        {entry.bids.length === 0 ? (
                          <p className="text-[9px] text-white/15 font-mono">No bids received</p>
                        ) : (
                          <div className="space-y-1">
                            {entry.bids.map((b, i) => (
                              <div key={i} className="flex items-center justify-between">
                                <span className="text-[10px] text-white/40 truncate">{b.employeeName}</span>
                                <span className={cn(
                                  'text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded',
                                  b.status === 'accepted' ? 'bg-emerald-500/15 text-emerald-400' :
                                  b.status === 'rejected' ? 'bg-red-500/15 text-red-400' :
                                  b.status === 'withdrawn' ? 'bg-slate-500/15 text-slate-400' :
                                  'bg-white/5 text-white/25'
                                )}>
                                  {b.status}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* ── Pane 3: Compliance Audit ────────────────────────────────── */}
        <div className="flex-1 flex flex-col bg-card/5 min-w-0">
          <PaneHeader
            title="Compliance Audit"
            subtitle={selectedBid ? selectedBid.employeeName : 'Select a bidder'}
            icon={<Shield className="h-3.5 w-3.5" />}
            accentClass="text-primary/50"
          />

          <div className="flex-1 flex flex-col overflow-hidden">
            <AnimatePresence mode="wait">
              {!selectedBid ? (
                <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground/15">
                  <Sparkles className="h-8 w-8" />
                  <div className="text-center">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em]">Engine Standby</p>
                    <p className="text-[9px] mt-1 font-mono">Select a candidate to run the audit</p>
                  </div>
                </motion.div>
              ) : (
                <motion.div key="panel" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 overflow-hidden">
                  <ScrollArea className="h-full">
                    <div className="p-4">
                      <CompliancePanel hook={bidsPanel} className="flex-1" />
                    </div>
                  </ScrollArea>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Action Footer ─── */}
          <div className="shrink-0 p-4 border-t border-border/40 space-y-2 bg-card/30 backdrop-blur-sm">
            {bidsPanel.status === 'idle' || bidsPanel.status === 'error' ? (
              <Button
                onClick={bidsPanel.run}
                disabled={!selectedBid}
                className="w-full h-10 text-[11px] font-semibold uppercase tracking-wider rounded-xl shadow-md shadow-primary/10"
              >
                <ShieldCheck className="h-4 w-4 mr-2" />
                Run Compliance
              </Button>
            ) : bidsPanel.status === 'running' ? (
              <Button disabled className="w-full h-10 rounded-xl text-[11px] font-semibold uppercase tracking-wider">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Analyzing…
              </Button>
            ) : !bidsPanel.canProceed ? (
              <>
                <Button disabled className="w-full h-10 rounded-xl text-[11px] font-semibold uppercase tracking-wider opacity-30 cursor-not-allowed border border-border/50 bg-transparent">
                  <CircleX className="h-4 w-4 mr-2" /> Blocked
                </Button>
                <Button variant="ghost" onClick={bidsPanel.run} className="w-full h-8 text-[9px] text-muted-foreground/40 hover:text-muted-foreground uppercase tracking-wider font-semibold">
                  Re-run Audit
                </Button>
              </>
            ) : (
              <>
                <motion.div whileTap={{ scale: 0.98 }}>
                  <Button
                    onClick={handleAssign}
                    disabled={isAssigning}
                    className={cn(
                      'w-full h-10 rounded-xl text-[11px] font-semibold uppercase tracking-wider shadow-lg',
                      (bidsPanel.result?.buckets.B.length ?? 0) > 0
                        ? 'bg-amber-500 text-amber-950 hover:bg-amber-400 shadow-amber-500/20'
                        : 'bg-emerald-500 text-white hover:bg-emerald-400 shadow-emerald-500/20',
                    )}
                  >
                    {isAssigning
                      ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      : <LucideUserCheck className="h-4 w-4 mr-2" />}
                    {(bidsPanel.result?.buckets.B.length ?? 0) > 0 ? 'Override & Assign' : 'Assign Role'}
                  </Button>
                </motion.div>
                <Button variant="ghost" onClick={bidsPanel.run} className="w-full h-8 text-[9px] text-muted-foreground/40 hover:text-muted-foreground uppercase tracking-wider font-semibold">
                  Re-run Audit
                </Button>
              </>
            )}
          </div>
        </div>

        {/* ── Pane 4: Intelligence & Actions ─────────────────────────── */}
        <div className="w-[22%] min-w-[240px] max-w-[300px] flex flex-col bg-card/20">
          <PaneHeader
            title="Intelligence"
            subtitle="Recommendations & actions"
            icon={<Sparkles className="h-3.5 w-3.5" />}
            accentClass="text-violet-400/50"
          />

          <div className="flex-1 flex flex-col overflow-hidden">
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-3">
                <AnimatePresence mode="wait">
                  {!selectedBid ? (
                    <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-20 flex flex-col items-center gap-3 text-muted-foreground/20">
                      <Zap className="h-5 w-5" />
                      <p className="text-[10px] uppercase tracking-widest font-semibold text-center">No candidate<br/>selected</p>
                    </motion.div>
                  ) : bidsPanel.status === 'idle' || bidsPanel.status === 'running' ? (
                    <motion.div key="prerun" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4 pt-2">
                      {/* Context card */}
                      <div className="rounded-2xl border border-border/50 bg-muted/10 overflow-hidden">
                        <div className="px-3.5 py-2.5 border-b border-border/40">
                          <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/40">Candidate</p>
                        </div>
                        <div className="p-3.5 space-y-2.5">
                          {[
                            ['Employee', selectedBid.employeeName],
                            ['Role', expandedShift?.role ?? '—'],
                            ['Shift', expandedShift ? `${expandedShift.startTime} – ${expandedShift.endTime}` : '—'],
                            ['Date', expandedShift?.dayLabel ?? '—'],
                          ].map(([k, v]) => (
                            <div key={k} className="flex justify-between items-baseline gap-2">
                              <span className="text-[9px] font-medium text-muted-foreground/40 uppercase tracking-wider shrink-0">{k}</span>
                              <span className="text-[10px] font-semibold text-foreground/60 truncate text-right">{v}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
                      {/* Summary label */}
                      <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/40 px-0.5">
                        {(blockingIssues.length + warningIssues.length) > 0
                          ? `${blockingIssues.length} blocker${blockingIssues.length !== 1 ? 's' : ''} · ${warningIssues.length} warning${warningIssues.length !== 1 ? 's' : ''}`
                          : 'All checks passed'}
                      </p>

                      {/* Issue cards — blockers */}
                      {blockingIssues.map((hit, i) => (
                        <motion.div
                          key={`${hit.rule_id}-${i}`}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.06, ease: [0.23, 1, 0.32, 1] }}
                          className="rounded-2xl border overflow-hidden border-rose-500/20 bg-rose-500/[0.04]"
                        >
                          <div className="px-3.5 py-2 border-b border-white/[0.04] flex items-center gap-2">
                            <CircleX className="h-3 w-3 text-rose-400 shrink-0" />
                            <span className="text-[10px] font-semibold text-rose-400">
                              {hit.rule_id.replace(/_/g, ' ')}
                            </span>
                          </div>
                          <div className="px-3.5 py-2.5">
                            <p className="text-[9px] text-muted-foreground/50 leading-relaxed">{hit.message}</p>
                            {hit.resolution_hint && (
                              <p className="text-[9px] text-foreground/50 leading-relaxed mt-1.5 border-t border-white/[0.04] pt-1.5">
                                {hit.resolution_hint}
                              </p>
                            )}
                          </div>
                        </motion.div>
                      ))}

                      {/* Issue cards — warnings */}
                      {warningIssues.map((hit, i) => (
                        <motion.div
                          key={`${hit.rule_id}-w-${i}`}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: (blockingIssues.length + i) * 0.06, ease: [0.23, 1, 0.32, 1] }}
                          className="rounded-2xl border overflow-hidden border-amber-500/20 bg-amber-500/[0.04]"
                        >
                          <div className="px-3.5 py-2 border-b border-white/[0.04] flex items-center gap-2">
                            <TriangleAlert className="h-3 w-3 text-amber-400 shrink-0" />
                            <span className="text-[10px] font-semibold text-amber-400">
                              {hit.rule_id.replace(/_/g, ' ')}
                            </span>
                          </div>
                          <div className="px-3.5 py-2.5">
                            <p className="text-[9px] text-muted-foreground/50 leading-relaxed">{hit.message}</p>
                            {hit.resolution_hint && (
                              <p className="text-[9px] text-foreground/50 leading-relaxed mt-1.5 border-t border-white/[0.04] pt-1.5">
                                {hit.resolution_hint}
                              </p>
                            )}
                          </div>
                        </motion.div>
                      ))}

                      {/* All clear */}
                      {blockingIssues.length === 0 && warningIssues.length === 0 && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.97 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="py-10 flex flex-col items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04]"
                        >
                          <ShieldCheck className="h-7 w-7 text-emerald-400/50" />
                          <div className="text-center">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400/70">All Clear</p>
                            <p className="text-[9px] text-muted-foreground/30 mt-1 font-mono">
                              {bidsPanel.result?.summary.passed ?? 0} checks passed
                            </p>
                          </div>
                        </motion.div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </ScrollArea>
          </div>
        </div>

      </div>
    </div>
  </TooltipProvider>
);
};

export default OpenBidsView;
