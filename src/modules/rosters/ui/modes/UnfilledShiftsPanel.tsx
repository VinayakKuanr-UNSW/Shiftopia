import React, { useState, useMemo } from 'react';
import { useDrag } from 'react-dnd';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { format } from 'date-fns';
import { cn } from '@/modules/core/lib/utils';
import {
  Search,
  Users,
  AlertCircle,
  Loader2,
  CheckCircle2,
  UserRound,
  Clock,
} from 'lucide-react';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useRosterStore } from '@/modules/rosters/state/useRosterStore';
import { useRosterUI } from '@/modules/rosters/contexts/RosterUIContext';
import { useContractedStaff } from '@/modules/rosters/state/useRosterShifts';
import type { ContractedStaffMember } from '@/modules/rosters/services/eligibility.service';
import { DND_UNFILLED_SHIFT, DND_EMPLOYEE_TYPE, type EmployeeDragItem } from './people-mode.types';
import { canDragShift } from '@/modules/rosters/utils/dnd.utils';

/* ── Types ──────────────────────────────────────────────────────────────────── */

export interface UnfilledShift {
  id: string;
  title: string;
  role: string;
  department?: string;
  date: string;   // yyyy-MM-dd
  start: string;  // HH:MM
  end: string;    // HH:MM
  // DnD-required fields (populated by RostersPlannerPage)
  isDraft?: boolean;
  isPublished?: boolean;
}

interface UnfilledShiftsPanelProps {
  unfilledShifts: UnfilledShift[];
  onPickShift?: (shift: UnfilledShift) => void;
  /** @deprecated use the self-contained panel — width is now fixed at w-80 */
  width?: string;
}

/* ── Role colour palette (derived from code string — no color column in DB) ──── */
const ROLE_PALETTE = [
  'bg-blue-500/20 text-blue-700 dark:text-blue-300',
  'bg-violet-500/20 text-violet-700 dark:text-violet-300',
  'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
  'bg-amber-500/20 text-amber-700 dark:text-amber-300',
  'bg-rose-500/20 text-rose-700 dark:text-rose-300',
  'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300',
  'bg-orange-500/20 text-orange-700 dark:text-orange-300',
  'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300',
];

function roleColorClass(seed: string | null): string {
  if (!seed) return ROLE_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return ROLE_PALETTE[Math.abs(hash) % ROLE_PALETTE.length];
}

/* ── Staff Card (Group / Roles Mode) ─────────────────────────────────────────── */

const StaffCard: React.FC<{ member: ContractedStaffMember }> = ({ member }) => {
  const initials = `${member.first_name?.[0] ?? ''}${member.last_name?.[0] ?? ''}`.toUpperCase();
  const roleColor = roleColorClass(member.role_code ?? member.role_name);

  const [{ isDragging }, drag] = useDrag<EmployeeDragItem, void, { isDragging: boolean }>(
    () => ({
      type: DND_EMPLOYEE_TYPE,
      item: {
        employeeId: member.id,
        employeeName: `${member.first_name} ${member.last_name}`,
        roleName: member.role_name,
      },
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    }),
    [member.id, member.first_name, member.last_name, member.role_name],
  );

  return (
    <div
      ref={drag}
      className={cn(
        'flex items-center gap-3 p-2.5 rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-white/[0.03] hover:bg-slate-50 dark:hover:bg-white/[0.06] transition-all cursor-grab',
        isDragging && 'opacity-50 cursor-grabbing',
      )}
    >
      {/* Avatar */}
      <div className={cn('h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 border border-current/10', roleColor)}>
        {initials ? (
          <span className="text-[11px] font-black leading-none">
            {initials}
          </span>
        ) : (
          <UserRound className="h-3.5 w-3.5" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-slate-800 dark:text-white truncate">
          {member.first_name} {member.last_name}
        </div>
        {member.role_name ? (
          <div className="text-[11px] text-slate-500 dark:text-white/50 truncate mt-0.5">
            {member.role_name}
          </div>
        ) : (
          <div className="text-[11px] text-slate-400 dark:text-white/30 truncate mt-0.5 italic">
            No role assigned
          </div>
        )}
      </div>

      {/* Role code badge */}
      {member.role_code && (
        <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0', roleColor)}>
          {member.role_code}
        </span>
      )}
    </div>
  );
};

/* ── Shift Card (People / other modes) ──────────────────────────────────────── */

const DEPT_COLORS: Record<string, string> = {
  Convention: 'bg-blue-500',
  Exhibition: 'bg-emerald-500',
  Theatre: 'bg-rose-500',
};

const ShiftCard: React.FC<{ shift: UnfilledShift; onClick: () => void; disabled?: boolean }> = ({ shift, onClick, disabled }) => {
  const dateObj = new Date(`${shift.date}T00:00:00`);
  const barColor = DEPT_COLORS[shift.department ?? ''] ?? 'bg-amber-400';

  const [sh, sm] = shift.start.split(':').map(Number);
  const [eh, em] = shift.end.split(':').map(Number);
  const hrs = ((eh * 60 + em) - (sh * 60 + sm)) / 60;
  const hoursLabel = hrs > 0 ? `${hrs % 1 === 0 ? hrs : hrs.toFixed(1)}h` : '';

  const isDnDModeActive = useRosterStore(s => s.isDnDModeActive);
  const [{ isDragging }, dragRef] = useDrag({
    type: DND_UNFILLED_SHIFT,
    item: () => shift,
    canDrag: () => canDragShift({
      lifecycle_status: shift.isPublished ? 'Published' : 'Draft',
      is_cancelled: false, // Unfilled shifts aren't cancelled yet
    }, isDnDModeActive),
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
    }),
  }, [shift, isDnDModeActive]);

  return (
    <div
      ref={dragRef}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      className={cn(
        'flex items-stretch rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-white/[0.03] hover:bg-slate-50 dark:hover:bg-white/[0.06] active:scale-[0.98] transition-all cursor-grab overflow-hidden',
        isDragging && 'opacity-50 cursor-grabbing',
      )}
    >
      {/* Left colour bar */}
      <div className={cn('w-1.5 flex-shrink-0', barColor)} />

      <div className="flex-1 p-2.5 min-w-0">
        {/* Role */}
        <div className="text-xs font-semibold text-slate-800 dark:text-white truncate">
          {shift.role}
        </div>
        {/* Title / subgroup — only if distinct */}
        {shift.title && shift.title !== shift.role && (
          <div className="text-[11px] text-slate-500 dark:text-white/50 truncate mt-0.5">
            {shift.title}
          </div>
        )}
        {/* Time */}
        <div className="flex items-center gap-1.5 mt-1.5">
          <Clock className="h-3 w-3 text-slate-400 dark:text-white/30 flex-shrink-0" />
          <span className="text-[11px] text-slate-500 dark:text-white/60">
            {shift.start} – {shift.end}
            {hoursLabel && (
              <span className="ml-1.5 text-slate-400 dark:text-white/40">{hoursLabel}</span>
            )}
          </span>
        </div>
        {/* Date */}
        <div className="text-[10px] text-slate-400 dark:text-white/40 mt-1">
          {format(dateObj, 'EEE, MMM d')}
        </div>
      </div>
    </div>
  );
};

/* ── Main Panel ──────────────────────────────────────────────────────────────── */

export const UnfilledShiftsPanel: React.FC<UnfilledShiftsPanelProps> = ({
  unfilledShifts,
  onPickShift,
}) => {
  const {
    activeMode,
    selectedOrganizationId,
    selectedDepartmentId,
    selectedSubDepartmentId,
  } = useRosterUI();

  const [search, setSearch] = useState('');
  // Show contracted staff in group + roles modes; show unfilled shifts in people mode
  const showStaff = activeMode === 'group' || activeMode === 'roles';

  /* ── Staff panel (group + roles modes) ────────────────────────── */
  const { data: staff = [], isLoading: staffLoading } = useContractedStaff(
    selectedOrganizationId ?? undefined,
    selectedDepartmentId ?? undefined,
    selectedSubDepartmentId ?? undefined,
  );

  const filteredStaff = useMemo(() => {
    if (!search.trim()) return staff;
    const q = search.toLowerCase();
    return staff.filter(
      (m) =>
        `${m.first_name} ${m.last_name}`.toLowerCase().includes(q) ||
        m.role_name?.toLowerCase().includes(q),
    );
  }, [staff, search]);

  /* ── People / other modes: unfilled shifts ───────────────────── */
  const filteredShifts = useMemo(() => {
    if (!search.trim()) return unfilledShifts;
    const q = search.toLowerCase();
    return unfilledShifts.filter(
      (s) =>
        s.role.toLowerCase().includes(q) ||
        s.title.toLowerCase().includes(q) ||
        (s.department ?? '').toLowerCase().includes(q),
    );
  }, [unfilledShifts, search]);

  const count = showStaff ? filteredStaff.length : filteredShifts.length;

  return (
    <div className="w-80 h-full flex flex-col bg-slate-50/80 dark:bg-slate-950/40 backdrop-blur-2xl border-l border-slate-200 dark:border-white/[0.08] shadow-[-8px_0_32px_rgba(0,0,0,0.1)]">

      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-slate-200 dark:border-white/[0.06]">
        <div className="flex items-center gap-2">
          {showStaff ? (
            <Users className="h-4 w-4 text-blue-500 dark:text-blue-400" />
          ) : (
            <AlertCircle className="h-4 w-4 text-amber-500" />
          )}
          <h3 className="text-sm font-bold text-slate-800 dark:text-white tracking-tight">
            {showStaff ? 'Contracted Staff' : 'Unfilled Shifts'}
          </h3>
          <span className="ml-auto text-[11px] font-semibold text-slate-400 dark:text-white/40 bg-slate-200 dark:bg-white/[0.06] px-2 py-0.5 rounded-full">
            {count}
          </span>
        </div>
        <p className="text-[11px] text-slate-400 dark:text-white/40 mt-1">
          {showStaff
            ? 'Active position contracts in scope'
            : 'Drag or click a shift to assign it'}
        </p>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-slate-200 dark:border-white/[0.06]">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 dark:text-white/30 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={showStaff ? 'Search staff or role…' : 'Search shifts…'}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-white dark:bg-white/[0.05] border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/80 placeholder-slate-400 dark:placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-1.5">

          {/* GROUP MODE: contracted staff list */}
          {showStaff && (
            <>
              {staffLoading && (
                <div className="flex items-center justify-center gap-2 py-12 text-slate-400 dark:text-white/40">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-xs">Loading staff…</span>
                </div>
              )}
              {!staffLoading && filteredStaff.length === 0 && (
                <div className="flex flex-col items-center py-12 gap-3">
                  <Users className="h-8 w-8 text-slate-300 dark:text-white/20" />
                  <p className="text-xs text-slate-400 dark:text-white/40 text-center">
                    {search
                      ? 'No staff match your search'
                      : 'No contracted staff in this scope'}
                  </p>
                </div>
              )}
              {!staffLoading &&
                filteredStaff.map((member, i) => (
                  <div 
                    key={member.id} 
                    style={{ animationDelay: `${i * 30}ms` }}
                    className="animate-in fade-in slide-in-from-right-4 fill-mode-both duration-300"
                  >
                    <StaffCard member={member} />
                  </div>
                ))}
            </>
          )}

          {/* PEOPLE / OTHER MODES: unfilled shifts */}
          {!showStaff && (
            <>
              {filteredShifts.length === 0 && (
                <div className="flex flex-col items-center py-12 gap-3">
                  <CheckCircle2 className="h-8 w-8 text-emerald-400 dark:text-emerald-500/40" />
                  <p className="text-xs text-slate-400 dark:text-white/40 text-center">
                    {search ? 'No matching shifts' : 'All shifts are filled'}
                  </p>
                </div>
              )}
              {filteredShifts.map((s, i) => (
                <div 
                  key={s.id} 
                  style={{ animationDelay: `${i * 30}ms` }}
                  className="animate-in fade-in slide-in-from-right-4 fill-mode-both duration-300"
                >
                  <ShiftCard shift={s} onClick={() => onPickShift?.(s)} />
                </div>
              ))}
            </>
          )}

        </div>
      </ScrollArea>
    </div>
  );
};

export default UnfilledShiftsPanel;
