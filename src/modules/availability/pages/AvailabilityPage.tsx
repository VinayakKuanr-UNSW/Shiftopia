import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { addMonths, subMonths } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Phone,
  Plus,
  CalendarCheck2,
  ArrowRight,
  ShieldCheck,
  Clock,
  FileText,
} from 'lucide-react';
import { useAvailability } from '../state/useAvailability';
import { useAvailabilityEditing } from '../state/useAvailabilityEditing';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Button } from '@/modules/core/ui/primitives/button';
import { Switch } from '@/modules/core/ui/primitives/switch';
import { useReserveListOptIn } from '@/modules/reserve-list/state/useReserveListOptIn';
import { format } from 'date-fns';
import { AvailabilityScreen } from '../ui/AvailabilityScreen';
import { pageVariants } from '@/modules/core/ui/motion/presets';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { useAvailabilityScope } from '../state/useAvailabilityScope';
import { AvailabilityScopePicker } from '../ui/header/AvailabilityScopePicker';
import { resolveComplianceBasis, type ContractBasis } from '../domain/contract-basis';
import { useAuth } from '@/platform/auth/useAuth';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { cn } from '@/modules/core/lib/utils';
import { formatEnvelopeDaysClause, formatEnvelopeTime } from '../ui/envelope-format';
import { ContractBasisBanner } from '../ui/header/ContractBasisBanner';
import { ExceptionsPanel } from '../ui/exceptions/ExceptionsPanel';

/**
 * The basis for someone holding NO Active contract. Computed once — it is a
 * constant, and rebuilding it per render would hand `ContractBasisBanner` a new
 * object identity on every pass.
 */
const NO_CONTRACT_BASIS: ContractBasis = resolveComplianceBasis([]);

type Breakpoint = 'mobile' | 'tablet' | 'desktop';

function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(() => {
    if (typeof window === 'undefined') return 'desktop';
    const width = window.innerWidth;
    if (width < 768) return 'mobile';
    if (width < 1024) return 'tablet';
    return 'desktop';
  });

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      if (width < 768) {
        setBreakpoint('mobile');
      } else if (width < 1024) {
        setBreakpoint('tablet');
      } else {
        setBreakpoint('desktop');
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return breakpoint;
}

export const AvailabilityPage: React.FC = () => {
  const breakpoint = useBreakpoint();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isDark } = useTheme();
  const { toast } = useToast();

  const [currentMonth, setCurrentMonth] = useState(new Date());

  // WHICH JOB is being declared for. One at a time: the same person can be
  // Full-Time in Security (availability contract-based, declaring refused) and
  // Casual in Set-up (silence means unavailable). There is no single answer
  // correct for both, which is why this replaced the old multi-select.
  const {
    scopes,
    selected: selectedScope,
    select: selectScope,
    isLoading: scopesLoading,
    isSingleScope,
  } = useAvailabilityScope(user?.id);

  // The SELECTED JOB is the page's basis — not a second read of the person.
  // Deriving it from one place is what stops the header, the editor and the
  // write guard disagreeing about the same employee.
  const contractBasis: ContractBasis = selectedScope ?? NO_CONTRACT_BASIS;
  const basisLoading = scopesLoading;

  // `isFullTime` IS `contractType === 'FT'` (domain/contract-basis.ts), so
  // testing both was one test written twice. While the scopes are still loading
  // it is false, which renders the declaration editor for a beat — the safe way
  // round, since the FT card is the one that asserts something.
  const isFullTime = !scopesLoading && contractBasis.isFullTime;

  // A full-timer has no rules and no slots to load, and neither does someone
  // with no job selected yet. Passing `enabled` rather than calling
  // conditionally keeps the hook order stable.
  const availabilityData = useAvailability({
    month: currentMonth,
    enabled: !isFullTime && !!selectedScope,
    subDepartmentId: selectedScope?.subDepartmentId ?? null,
  });
  const editingData = useAvailabilityEditing();
  const reserveListOptIn = useReserveListOptIn();

  const handlePrevMonth = () => setCurrentMonth((prev) => subMonths(prev, 1));
  const handleNextMonth = () => setCurrentMonth((prev) => addMonths(prev, 1));

  const handleReserveListToggle = async (checked: boolean) => {
    try {
      await reserveListOptIn.setOptIn(checked);
      toast({
        title: checked ? 'Reserve List: opted in' : 'Reserve List: opted out',
        description: checked
          ? 'You may now be contacted for emergency replacement shifts.'
          : 'You will no longer appear in emergency replacement searches.',
      });
    } catch {
      toast({
        title: 'Could not update Reserve List preference',
        description: 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleAddAvailability = () => {
    editingData.startCreate();
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      {/* ── GOLD STANDARD HEADER (Title · Scope · Function Bar) ── */}
      <GoldStandardHeader
        title="My Availabilities"
        Icon={CalendarDays}
        functionBar={
          <div className={cn(
            "flex flex-row items-center gap-2 w-full transition-all p-1.5 rounded-2xl overflow-hidden",
            isDark ? "bg-[#111827]/60" : "bg-slate-100"
          )}>
            <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto scrollbar-none py-0.5">
              {/* WHICH JOB. First in the bar because every control after it is
                  scoped by it — the month you are paging and the availability
                  you are adding both belong to the job named here. */}
              <AvailabilityScopePicker
                scopes={scopes}
                selected={selectedScope}
                onSelect={selectScope}
                isSingleScope={isSingleScope}
                isDark={isDark}
              />

              {scopes.length > 0 && (
                <div className="h-6 w-px bg-border/20 flex-shrink-0 mx-1" />
              )}

              {/* Month Navigation — a calendar control, so it goes where the
                  calendar goes. A full-timer has no month-scoped view below,
                  and paging a month that changes nothing on screen reads as a
                  broken control rather than an absent one. */}
              {!isFullTime && (
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handlePrevMonth}
                  className={cn(
                    "h-9 w-9 lg:h-11 lg:w-11 rounded-xl transition-all",
                    isDark ? "bg-[#111827]/60 text-muted-foreground hover:text-white" : "bg-white shadow-sm"
                  )}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                <div className={cn(
                  "h-9 lg:h-11 px-4 lg:px-6 rounded-xl flex items-center justify-center min-w-[120px] md:min-w-[180px]",
                  isDark ? "bg-[#111827]/60" : "bg-white shadow-sm"
                )}>
                  <span className="text-[10px] lg:text-[11px] font-black uppercase tracking-[0.2em] text-foreground">
                    {format(currentMonth, 'MMMM yyyy')}
                  </span>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleNextMonth}
                  className={cn(
                    "h-9 w-9 lg:h-11 lg:w-11 rounded-xl transition-all",
                    isDark ? "bg-[#111827]/60 text-muted-foreground hover:text-white" : "bg-white shadow-sm"
                  )}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              )}

              {/* Add Availability Button — only for Non-FT staff (Casuals / PT who declare availability) */}
              {!isFullTime && (
                <>
                  <div className="h-6 w-px bg-border/20 flex-shrink-0 mx-1" />
                  <Button
                    onClick={handleAddAvailability}
                    className={cn(
                      "flex-shrink-0 gap-2 h-9 lg:h-11 px-3 lg:px-6 rounded-xl font-black uppercase text-[9px] lg:text-[10px] tracking-wider transition-all shadow-sm",
                      isDark 
                        ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20" 
                        : "bg-indigo-50 text-indigo-700 border border-indigo-100 hover:bg-indigo-100"
                    )}
                  >
                    <Plus className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
                    <span className="hidden sm:inline">Add Availability</span>
                    <span className="sm:hidden text-[8px]">Add</span>
                  </Button>
                </>
              )}

              <div className="h-6 w-px bg-border/20 flex-shrink-0 mx-1" />

              {/* Reserve List opt-in. Kept for FT: an emergency replacement call
                  is a genuine choice they make, and independent of availability. */}
              <div
                className={cn(
                  "flex items-center gap-2 flex-shrink-0 h-9 lg:h-11 px-3 lg:px-4 rounded-xl transition-all",
                  isDark ? "bg-[#111827]/60" : "bg-white shadow-sm"
                )}
                title="When on, you may be contacted for emergency replacement shifts (starting within 4 hours)."
              >
                <Phone className={cn("h-3.5 w-3.5 lg:h-4 lg:w-4 flex-shrink-0", isDark ? "text-muted-foreground" : "text-slate-500")} />
                <span className="hidden sm:inline text-[9px] lg:text-[10px] font-black uppercase tracking-wider text-foreground whitespace-nowrap">
                  Reserve List
                </span>
                <Switch
                  checked={reserveListOptIn.optIn}
                  onCheckedChange={handleReserveListToggle}
                  disabled={reserveListOptIn.loading || reserveListOptIn.saving}
                  aria-label="Reserve List opt-in"
                />
              </div>
            </div>
          </div>
        }
      />

      {/* ── BODY ── */}
      <motion.div
        variants={pageVariants}
        initial="hidden"
        animate="show"
        className="flex-1 min-h-0 overflow-y-auto px-4 lg:px-6 pb-4 lg:pb-6 flex flex-col gap-4"
      >
        {/* NOT rendered for FT. Its OPT_OUT copy tells the reader that "anything
            you add BELOW narrows when you can be rostered … use it for one-off
            exceptions" — advice about a calendar and an exceptions panel that no
            longer exist on this page for them. The card below carries the same
            hours/leave facts in a form that matches what they can actually do. */}
        {!isFullTime && <ContractBasisBanner basis={contractBasis} loading={basisLoading} />}

        {isFullTime ? (
          /* ── FULL-TIME INFORMATIONAL STATE ── */
          <div className={cn(
            "rounded-3xl border p-6 md:p-8 flex flex-col gap-6 transition-all shadow-sm",
            isDark
              ? "bg-[#111827]/80 border-slate-800 text-slate-100"
              : "bg-white border-slate-200/80 text-slate-900"
          )}>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className={cn(
                  "p-3.5 rounded-2xl flex items-center justify-center flex-shrink-0",
                  isDark ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                )}>
                  <CalendarCheck2 className="h-7 w-7" />
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black uppercase tracking-widest text-emerald-500">
                      Contract-Obligation Model
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      Available by Default
                    </span>
                  </div>
                  <h2 className="text-xl md:text-2xl font-black tracking-tight">
                    Full-Time Availability
                    {selectedScope ? ` — ${selectedScope.subDepartmentName}` : ''}
                  </h2>
                  <p className={cn(
                    "text-sm leading-relaxed max-w-2xl",
                    isDark ? "text-slate-400" : "text-slate-600"
                  )}>
                    You hold this job on a Full Time contract ({contractBasis.contractedWeeklyHours ?? 38}h/week ordinary hours), so you are rostered
                    according to your contracted working arrangements and do not submit weekly availability for it.
                    {scopes.some((s) => s.canDeclare)
                      ? ' Your other jobs are declared separately — switch job above.'
                      : ' All rosterable blocks within your contractual envelope are available by default.'}
                  </p>
                </div>
              </div>

              <Button
                onClick={() => navigate('/my-leave')}
                className="flex items-center gap-2 h-11 px-5 rounded-2xl font-black uppercase text-xs tracking-wider bg-primary text-primary-foreground shadow-md hover:shadow-lg transition-all flex-shrink-0 self-start md:self-auto"
              >
                <FileText className="h-4 w-4" />
                <span>Go to Leave Management</span>
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <div className={cn(
                "p-4 rounded-2xl border flex flex-col gap-1.5",
                isDark ? "bg-slate-900/50 border-slate-800" : "bg-slate-50 border-slate-200/60"
              )}>
                <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  <Clock className="h-4 w-4 text-primary" />
                  Contracted Basis
                </div>
                <div className="text-lg font-black text-foreground">
                  {contractBasis.contractedWeeklyHours ?? 38} Hours / Week
                </div>
                <div className="text-xs text-muted-foreground">
                  Averaged over the 4-week roster cycle (ICC Sydney EBA cl 35).
                </div>
              </div>

              {/* The ordinary-hours envelope, when the contract sets one. NULL
                  span ends mean unrestricted, which is every contract in
                  production until one is explicitly opted in — so this states
                  which of the two it is rather than rendering a blank. */}
              <div className={cn(
                "p-4 rounded-2xl border flex flex-col gap-1.5",
                isDark ? "bg-slate-900/50 border-slate-800" : "bg-slate-50 border-slate-200/60"
              )}>
                <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  <Clock className="h-4 w-4 text-sky-500" />
                  Ordinary Hours
                </div>
                <div className="text-lg font-black text-foreground">
                  {contractBasis.envelope.isConfigured
                    ? `${formatEnvelopeTime(contractBasis.envelope.spanStart)}–${formatEnvelopeTime(contractBasis.envelope.spanEnd)}`
                    : 'Any rosterable time'}
                </div>
                <div className="text-xs text-muted-foreground">
                  {contractBasis.envelope.isConfigured
                    ? `Your contract limits rostering to this span${formatEnvelopeDaysClause(contractBasis.envelope.days)}.`
                    : 'Your contract sets no span limit; the EBA rules below still apply.'}
                </div>
              </div>

              <div className={cn(
                "p-4 rounded-2xl border flex flex-col gap-1.5",
                isDark ? "bg-slate-900/50 border-slate-800" : "bg-slate-50 border-slate-200/60"
              )}>
                <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  <ShieldCheck className="h-4 w-4 text-emerald-500" />
                  Unavailability Policy
                </div>
                <div className="text-lg font-black text-foreground">
                  Leave Management
                </div>
                <div className="text-xs text-muted-foreground">
                  Planned or unplanned time off must be submitted as Leave Requests.
                </div>
              </div>

              <div className={cn(
                "p-4 rounded-2xl border flex flex-col gap-1.5",
                isDark ? "bg-slate-900/50 border-slate-800" : "bg-slate-50 border-slate-200/60"
              )}>
                <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  <CalendarDays className="h-4 w-4 text-indigo-500" />
                  Roster Protections
                </div>
                <div className="text-lg font-black text-foreground">
                  EBA & Compliance
                </div>
                <div className="text-xs text-muted-foreground">
                  Paired days off, rest gaps, and rolling caps are automatically audited.
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ── CASUAL & PART-TIME AVAILABILITY SCREEN ── */
          <>
            {!basisLoading && contractBasis.availabilityMode === 'OPT_OUT' && user?.id && (
              <ExceptionsPanel
                profileId={user.id}
                subDepartmentId={selectedScope?.subDepartmentId ?? null}
              />
            )}

            <div className="flex-1 min-h-0">
              <AvailabilityScreen
                layout={breakpoint === 'desktop' ? 'desktop' : breakpoint === 'tablet' ? 'tablet' : 'mobile'}
                currentMonth={currentMonth}
                availabilityData={availabilityData}
                editingData={editingData}
              />
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
};

export default AvailabilityPage;
