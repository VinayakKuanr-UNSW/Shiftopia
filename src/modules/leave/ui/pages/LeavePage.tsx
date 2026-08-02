/**
 * LeavePage — tab-based leave management UI.
 *
 * Tabs:
 *   1. Balances  — card grid of leave balances with accrual + projection
 *   2. Requests  — table of the employee's leave requests
 *   3. Request   — new leave request form
 *   4. Approvals — (managers only) pending requests for their department
 *
 * Uses the PageLayout shell. Dark-first, glassmorphic design language.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Palmtree,
  Calendar,
  Clock,
  Send,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Plus,
  ChevronRight,
  FileText,
  Loader2,
  UserMinus,
} from 'lucide-react';
import { useAuth } from '@/platform/auth/useAuth';
import { PageLayout } from '@/modules/core/ui/layout/PageLayout';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import type {
  LeaveBalance,
  LeaveRequest,
  LeaveTypeCode,
  CreateLeaveRequestInput,
} from '../../model/leave.types';
import { LEAVE_TYPE_LABELS } from '../../model/leave.types';
import {
  getLeavePolicies,
  projectBalance,
  isCertificateRequired,
  computeCertificateAdjacency,
  BALANCE_TRACKED_TYPES,
} from '../../domain/leave-policy';
import {
  getLeaveBalances,
  getLeaveRequests,
  getTeamLeaveRequests,
  createLeaveRequest,
  approveLeaveRequest,
  rejectLeaveRequest,
  cancelLeaveRequest,
  unassignConflictingShifts,
  isFullTimeSecurityEmployee,
} from '../../api/leave.api';
import type { LeavePolicy } from '../../model/leave.types';
import { formatLeaveConflictWarning } from '../../domain/leave-conflicts';
import { useRealtimeInvalidate } from '@/platform/supabase/hooks/useRealtimeInvalidate';

type Tab = 'balances' | 'requests' | 'new' | 'approvals';

interface LeavePageProps {
  /** Pre-select a tab (used by the manager route). */
  tab?: Tab;
}

// ── Status badge colours ────────────────────────────────────────────────────
const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20',
  approved: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  rejected: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20',
  cancelled: 'bg-slate-500/15 text-slate-500 dark:text-slate-400 border-slate-500/20',
};

// ── Balance card gradient colours per leave type ────────────────────────────
const BALANCE_GRADIENTS: Partial<Record<LeaveTypeCode, string>> = {
  annual: 'from-sky-500/20 to-blue-600/10',
  personal: 'from-rose-500/20 to-pink-600/10',
  fdv: 'from-violet-500/20 to-purple-600/10',
  long_service: 'from-amber-500/20 to-orange-600/10',
  supporting_carer: 'from-teal-500/20 to-cyan-600/10',
};

const LeavePage: React.FC<LeavePageProps> = ({ tab: initialTab }) => {
  const { user, hasPermission } = useAuth();
  const isManager = hasPermission('management');
  const [activeTab, setActiveTab] = useState<Tab>(initialTab ?? 'balances');

  // Data state
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [myRequests, setMyRequests] = useState<LeaveRequest[]>([]);
  const [teamRequests, setTeamRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  // Sch 3 §8.2/8.3 — Full-Time Security accrues 210h annual / 84h personal,
  // not the general 152h/76h (audit H-9). Resolved once per load, mirroring
  // the same condition the DB accrual function uses.
  const [isFtSecurity, setIsFtSecurity] = useState(false);
  const policies = useMemo(() => getLeavePolicies(isFtSecurity), [isFtSecurity]);
  /**
   * Post-approval roster-conflict state: the warning copy plus the shift IDs
   * still rostered inside the approved leave range, so the manager can unassign
   * them in one click. `null` = nothing to show.
   */
  const [approvalConflict, setApprovalConflict] = useState<
    { text: string; shiftIds: string[] } | null
  >(null);
  /** True while the one-click batch unassign is in flight. */
  const [unassigning, setUnassigning] = useState(false);
  /** Result copy after a batch unassign (success or partial-success summary). */
  const [unassignResult, setUnassignResult] = useState<string | null>(null);
  /** Error copy for approve/reject/cancel actions (previously swallowed). */
  const [actionError, setActionError] = useState<string | null>(null);

  // New request form state
  const [formType, setFormType] = useState<LeaveTypeCode>('annual');
  const [formStart, setFormStart] = useState('');
  const [formEnd, setFormEnd] = useState('');
  const [formHours, setFormHours] = useState<number>(0);
  const [formReason, setFormReason] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState(false);

  const employeeId = user?.id ?? '';

  const loadData = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    try {
      const [bals, reqs, team, ftSecurity] = await Promise.all([
        getLeaveBalances(employeeId),
        getLeaveRequests(employeeId),
        isManager ? getTeamLeaveRequests({ status: 'pending' }) : Promise.resolve([]),
        isFullTimeSecurityEmployee(employeeId),
      ]);
      setBalances(bals);
      setMyRequests(reqs);
      setTeamRequests(team);
      setIsFtSecurity(ftSecurity);
    } catch (e) {
      console.error('[LeavePage] loadData error:', e);
    } finally {
      setLoading(false);
    }
  }, [employeeId, isManager]);

  useEffect(() => { loadData(); }, [loadData]);

  // Realtime: reload balances/requests (and, for managers, team requests) live
  // when leave rows change — Leave previously had no polling at all. RLS-scoped,
  // so a manager only wakes on leave they are allowed to see.
  useRealtimeInvalidate(
    `leave-rt-${employeeId}`,
    ['leave_requests', 'leave_balances'],
    loadData,
    !!employeeId,
  );

  // Auto-calculate hours from date range (7.6h/day × working days)
  useEffect(() => {
    if (formStart && formEnd) {
      const start = new Date(formStart + 'T00:00:00');
      const end = new Date(formEnd + 'T00:00:00');
      if (start <= end) {
        let days = 0;
        const cur = new Date(start);
        while (cur <= end) {
          const dow = cur.getDay();
          if (dow !== 0 && dow !== 6) days++;
          cur.setDate(cur.getDate() + 1);
        }
        setFormHours(Math.round(days * 7.6 * 10) / 10);
      }
    }
  }, [formStart, formEnd]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSubmitting(true);
    setFormError(null);
    setFormSuccess(false);

    const input: CreateLeaveRequestInput = {
      leaveType: formType,
      startDate: formStart,
      endDate: formEnd,
      requestedHours: formHours,
      reason: formReason || undefined,
    };

    const result = await createLeaveRequest(employeeId, input);
    if (result.error) {
      setFormError(result.error);
    } else {
      setFormSuccess(true);
      setFormStart('');
      setFormEnd('');
      setFormHours(0);
      setFormReason('');
      loadData();
    }
    setFormSubmitting(false);
  };

  const handleApprove = async (requestId: string) => {
    setApprovalConflict(null);
    setUnassignResult(null);
    setActionError(null);
    const result = await approveLeaveRequest(requestId, employeeId);
    if (result.error) {
      setActionError(result.error);
    } else {
      // Approval succeeded — surface any shifts still rostered inside the leave
      // range so the manager can unassign them in one click (otherwise the
      // employee is later falsely marked No-Show).
      const conflicts = result.data?.conflictingShifts ?? [];
      const text = formatLeaveConflictWarning(conflicts);
      setApprovalConflict(text ? { text, shiftIds: conflicts.map((c) => c.shiftId) } : null);
    }
    loadData();
  };

  const handleUnassignConflicts = async (shiftIds: string[]) => {
    setUnassigning(true);
    setUnassignResult(null);
    const result = await unassignConflictingShifts(shiftIds);
    setUnassigning(false);
    if (result.error) {
      setUnassignResult(`Unassign failed: ${result.error}`);
      return;
    }
    const { attempted, succeeded } = result.data!;
    setApprovalConflict(null);
    setUnassignResult(
      succeeded === attempted
        ? `Unassigned ${succeeded} shift${succeeded === 1 ? '' : 's'} — now re-offer them from the roster.`
        : `Unassigned ${succeeded} of ${attempted} — the rest changed since approval; check the roster.`,
    );
    loadData();
  };

  const handleReject = async (requestId: string) => {
    setActionError(null);
    const result = await rejectLeaveRequest(requestId, employeeId, 'Declined by manager');
    if (result.error) setActionError(result.error);
    loadData();
  };

  const handleCancel = async (requestId: string) => {
    setActionError(null);
    const result = await cancelLeaveRequest(requestId);
    if (result.error) setActionError(result.error);
    loadData();
  };

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'balances', label: 'Balances', icon: <Palmtree className="h-4 w-4" /> },
    { key: 'requests', label: 'My Requests', icon: <FileText className="h-4 w-4" /> },
    { key: 'new', label: 'New Request', icon: <Plus className="h-4 w-4" /> },
    ...(isManager
      ? [{ key: 'approvals' as Tab, label: 'Approvals', icon: <CheckCircle2 className="h-4 w-4" /> }]
      : []),
  ];

  const pendingCount = teamRequests.filter((r) => r.status === 'pending').length;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      <GoldStandardHeader
        title="Leave"
        Icon={Palmtree}
        functionBar={
          <div className="flex gap-1 rounded-2xl bg-slate-100/80 p-1 dark:bg-white/5 w-full">
            {tabs.map(({ key, label, icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`
                  relative flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all
                  ${activeTab === key
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-white/10 dark:text-white'
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                  }
                `}
              >
                {icon}
                {label}
                {key === 'approvals' && pendingCount > 0 && (
                  <span className="ml-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                    {pendingCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        }
      />

      <PageLayout.Body className="mx-4 lg:mx-6 mb-4 lg:mb-6">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : (
          <>
            {actionError && (
              <div className="mb-3 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/5 p-3">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
                <p className="flex-1 text-xs text-red-600 dark:text-red-400">{actionError}</p>
                <button
                  onClick={() => setActionError(null)}
                  className="rounded-lg p-0.5 text-red-500/70 transition-colors hover:text-red-600 dark:hover:text-red-400"
                  title="Dismiss"
                >
                  <XCircle className="h-4 w-4" />
                </button>
              </div>
            )}
            {activeTab === 'balances' && (
              <BalancesView balances={balances} requests={myRequests} policies={policies} />
            )}
            {activeTab === 'requests' && (
              <RequestsView requests={myRequests} onCancel={handleCancel} />
            )}
            {activeTab === 'new' && (
              <NewRequestForm
                formType={formType}
                setFormType={setFormType}
                formStart={formStart}
                setFormStart={setFormStart}
                formEnd={formEnd}
                setFormEnd={setFormEnd}
                formHours={formHours}
                setFormHours={setFormHours}
                formReason={formReason}
                setFormReason={setFormReason}
                formError={formError}
                formSuccess={formSuccess}
                formSubmitting={formSubmitting}
                onSubmit={handleSubmit}
                balances={balances}
                policies={policies}
              />
            )}
            {activeTab === 'approvals' && isManager && (
              <ApprovalsView
                requests={teamRequests}
                onApprove={handleApprove}
                onReject={handleReject}
                warning={approvalConflict?.text ?? null}
                conflictShiftIds={approvalConflict?.shiftIds ?? []}
                onUnassignConflicts={handleUnassignConflicts}
                unassigning={unassigning}
                unassignResult={unassignResult}
                onDismissWarning={() => {
                  setApprovalConflict(null);
                  setUnassignResult(null);
                }}
              />
            )}
          </>
        )}
      </PageLayout.Body>
    </div>
  );
};

// ── Balances View ────────────────────────────────────────────────────────────
const BalancesView: React.FC<{
  balances: LeaveBalance[];
  requests: LeaveRequest[];
  policies: Record<LeaveTypeCode, LeavePolicy>;
}> = ({ balances, requests, policies }) => {
  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {BALANCE_TRACKED_TYPES.map((type) => {
        const bal = balances.find((b) => b.leaveType === type);
        const policy = policies[type];
        const gradient = BALANCE_GRADIENTS[type] ?? 'from-slate-500/20 to-slate-600/10';
        const projected = bal
          ? projectBalance(bal, requests, today, bal.asOfDate, policies)
          : 0;

        return (
          <div
            key={type}
            className={`
              rounded-2xl border border-white/10 bg-gradient-to-br ${gradient}
              p-5 transition-all hover:scale-[1.02] hover:shadow-lg
              dark:border-white/5
            `}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {LEAVE_TYPE_LABELS[type]}
                </p>
                <p className="mt-1 text-3xl font-bold text-slate-900 dark:text-white">
                  {bal ? Math.round(projected * 10) / 10 : '—'}
                  <span className="ml-1 text-sm font-normal text-slate-500 dark:text-slate-400">hrs</span>
                </p>
                {bal && Math.abs(projected - bal.balanceHours) > 0.1 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                    Includes pending ({Math.round(bal.balanceHours * 10) / 10}h base)
                  </p>
                )}
              </div>
              <Clock className="h-5 w-5 text-slate-400 dark:text-slate-500" />
            </div>

            <div className="mt-4 space-y-1">
              {policy.accrualRateHoursPerYear != null && (
                <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>Accrual rate</span>
                  <span>{policy.accrualRateHoursPerYear}h / year</span>
                </div>
              )}
              <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Used</span>
                <span>{bal ? Math.round(bal.usedHours * 10) / 10 : 0}h</span>
              </div>
              {policy.maxBalanceHours != null && (
                <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>Cap</span>
                  <span>{policy.maxBalanceHours}h</span>
                </div>
              )}
            </div>

            <p className="mt-3 text-[10px] text-slate-400 dark:text-slate-500">
              {policy.clause}
            </p>
          </div>
        );
      })}
    </div>
  );
};

// ── Requests View ────────────────────────────────────────────────────────────
const RequestsView: React.FC<{
  requests: LeaveRequest[];
  onCancel: (id: string) => void;
}> = ({ requests, onCancel }) => {
  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500">
        <FileText className="mb-3 h-12 w-12" />
        <p className="text-sm">No leave requests yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {requests.map((req) => (
        <div
          key={req.id}
          className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/50 p-4 transition-all dark:border-white/5 dark:bg-white/5"
        >
          <div className="flex items-center gap-4">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 dark:bg-white/10">
              <Calendar className="h-5 w-5 text-slate-600 dark:text-slate-300" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-white">
                {LEAVE_TYPE_LABELS[req.leaveType] ?? req.leaveType}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {req.startDate} → {req.endDate} · {req.requestedHours}h
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${STATUS_STYLES[req.status] ?? ''}`}
            >
              {req.status}
            </span>
            {req.status === 'pending' && (
              <button
                onClick={() => onCancel(req.id)}
                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                title="Cancel request"
              >
                <XCircle className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

// ── New Request Form ─────────────────────────────────────────────────────────
const NewRequestForm: React.FC<{
  formType: LeaveTypeCode;
  setFormType: (t: LeaveTypeCode) => void;
  formStart: string;
  setFormStart: (s: string) => void;
  formEnd: string;
  setFormEnd: (s: string) => void;
  formHours: number;
  setFormHours: (h: number) => void;
  formReason: string;
  setFormReason: (r: string) => void;
  formError: string | null;
  formSuccess: boolean;
  formSubmitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
  balances: LeaveBalance[];
  policies: Record<LeaveTypeCode, LeavePolicy>;
}> = ({
  formType, setFormType,
  formStart, setFormStart,
  formEnd, setFormEnd,
  formHours, setFormHours,
  formReason, setFormReason,
  formError, formSuccess, formSubmitting,
  onSubmit, balances, policies,
}) => {
  const policy = policies[formType];
  const balance = balances.find((b) => b.leaveType === formType);
  const certRequired = formStart && formEnd
    ? isCertificateRequired(formType, daysBetween(formStart, formEnd), computeCertificateAdjacency(formStart, formEnd))
    : false;

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-lg space-y-6">
      {/* Leave type */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
          Leave Type
        </label>
        <select
          value={formType}
          onChange={(e) => setFormType(e.target.value as LeaveTypeCode)}
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-white"
        >
          {Object.entries(LEAVE_TYPE_LABELS).map(([code, label]) => (
            <option key={code} value={code}>{label}</option>
          ))}
        </select>
        {policy && (
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            {policy.description}
          </p>
        )}
      </div>

      {/* Date range */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
            Start Date
          </label>
          <input
            type="date"
            value={formStart}
            onChange={(e) => setFormStart(e.target.value)}
            required
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-white"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
            End Date
          </label>
          <input
            type="date"
            value={formEnd}
            min={formStart}
            onChange={(e) => setFormEnd(e.target.value)}
            required
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-white"
          />
        </div>
      </div>

      {/* Hours (auto-calculated, editable) */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
          Hours
        </label>
        <input
          type="number"
          value={formHours}
          onChange={(e) => setFormHours(Number(e.target.value))}
          min={0}
          step={0.1}
          required
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-white"
        />
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          Auto-calculated from weekdays (7.6h/day). Adjust if needed.
        </p>
      </div>

      {/* Balance info */}
      {balance && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
          <p className="text-xs text-emerald-700 dark:text-emerald-400">
            Available: <strong>{Math.round(balance.balanceHours * 10) / 10}h</strong>
            {formHours > balance.balanceHours && (
              <span className="ml-2 text-red-500">
                ⚠ Insufficient balance ({(formHours - balance.balanceHours).toFixed(1)}h short)
              </span>
            )}
          </p>
        </div>
      )}

      {/* Certificate notice */}
      {certRequired && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
          <p className="text-xs text-amber-700 dark:text-amber-400">
            A medical certificate is required for {LEAVE_TYPE_LABELS[formType]} exceeding {policy?.certificateThresholdDays} consecutive days (NES s107).
          </p>
        </div>
      )}

      {/* Reason */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
          Reason (optional)
        </label>
        <textarea
          value={formReason}
          onChange={(e) => setFormReason(e.target.value)}
          rows={3}
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-white"
          placeholder="Brief reason for leave..."
        />
      </div>

      {/* Error / Success */}
      {formError && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-600 dark:text-red-400">
          {formError}
        </div>
      )}
      {formSuccess && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-600 dark:text-emerald-400">
          ✓ Leave request submitted successfully
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={formSubmitting || !formStart || !formEnd || formHours <= 0}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Send className="h-4 w-4" />
        {formSubmitting ? 'Submitting…' : 'Submit Request'}
      </button>
    </form>
  );
};

// ── Approvals View ───────────────────────────────────────────────────────────
const ApprovalsView: React.FC<{
  requests: LeaveRequest[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  /** Post-approval roster-conflict warning (null = nothing to show). */
  warning?: string | null;
  /** Shift IDs still rostered inside the approved leave (drives the unassign button). */
  conflictShiftIds?: string[];
  /** One-click batch unassign of the conflicting shifts through the audited gateway. */
  onUnassignConflicts?: (shiftIds: string[]) => void;
  /** True while the batch unassign is in flight. */
  unassigning?: boolean;
  /** Result copy after an unassign attempt (null = nothing to show). */
  unassignResult?: string | null;
  onDismissWarning?: () => void;
}> = ({
  requests,
  onApprove,
  onReject,
  warning,
  conflictShiftIds = [],
  onUnassignConflicts,
  unassigning = false,
  unassignResult,
  onDismissWarning,
}) => {
  const pending = requests.filter((r) => r.status === 'pending');

  const warningBanner = warning ? (
    <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
      <div className="flex-1 space-y-2">
        <p className="text-xs text-amber-700 dark:text-amber-400">{warning}</p>
        {conflictShiftIds.length > 0 && onUnassignConflicts && (
          <button
            onClick={() => onUnassignConflicts(conflictShiftIds)}
            disabled={unassigning}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-700 transition-all hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-60 dark:text-amber-300"
          >
            {unassigning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <UserMinus className="h-3.5 w-3.5" />
            )}
            {unassigning
              ? 'Unassigning…'
              : `Unassign ${conflictShiftIds.length} shift${conflictShiftIds.length === 1 ? '' : 's'}`}
          </button>
        )}
      </div>
      {onDismissWarning && (
        <button
          onClick={onDismissWarning}
          className="rounded-lg p-0.5 text-amber-500/70 transition-colors hover:text-amber-600 dark:hover:text-amber-300"
          title="Dismiss"
        >
          <XCircle className="h-4 w-4" />
        </button>
      )}
    </div>
  ) : unassignResult ? (
    <div className="flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
      <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
      <p className="flex-1 text-xs text-emerald-700 dark:text-emerald-400">{unassignResult}</p>
      {onDismissWarning && (
        <button
          onClick={onDismissWarning}
          className="rounded-lg p-0.5 text-emerald-500/70 transition-colors hover:text-emerald-600 dark:hover:text-emerald-300"
          title="Dismiss"
        >
          <XCircle className="h-4 w-4" />
        </button>
      )}
    </div>
  ) : null;

  if (pending.length === 0) {
    return (
      <div className="space-y-3">
        {warningBanner}
        <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500">
          <CheckCircle2 className="mb-3 h-12 w-12" />
          <p className="text-sm">No pending leave requests</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {warningBanner}
      {pending.map((req) => (
        <div
          key={req.id}
          className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/50 p-4 transition-all dark:border-white/5 dark:bg-white/5"
        >
          <div className="flex items-center gap-4">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-100 dark:bg-amber-500/10">
              <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-white">
                {LEAVE_TYPE_LABELS[req.leaveType] ?? req.leaveType}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {req.startDate} → {req.endDate} · {req.requestedHours}h
              </p>
              {req.reason && (
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  "{req.reason}"
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onApprove(req.id)}
              className="flex items-center gap-1 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-600 transition-all hover:bg-emerald-500/20 dark:text-emerald-400"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Approve
            </button>
            <button
              onClick={() => onReject(req.id)}
              className="flex items-center gap-1 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-600 transition-all hover:bg-red-500/20 dark:text-red-400"
            >
              <XCircle className="h-3.5 w-3.5" />
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

/** Count working days between two YYYY-MM-DD dates (inclusive). */
function daysBetween(start: string, end: string): number {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  let days = 0;
  const cur = new Date(s);
  while (cur <= e) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) days++;
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

export default LeavePage;
