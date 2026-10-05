import React, { useMemo, useState } from 'react';
import {
  ShieldAlert,
  AlertTriangle,
  Clock,
  FileText,
  Scale,
  Award,
  CalendarCheck,
  Search,
  Cpu,
  Info,
  SlidersHorizontal,
  Lock,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  X,
  Target,
  Sparkles,
  Zap,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Input } from '@/modules/core/ui/primitives/input';
import { Button } from '@/modules/core/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/modules/core/ui/primitives/dialog';
import { RULE_REGISTRY } from '@/modules/compliance/registry/rules';
import type { RuleSpec, RuleCategory, RuleTier } from '@/modules/compliance/registry/types';
import { ComplianceArchitectureDiagram } from './ComplianceArchitectureDiagram';

export interface TechnicalRuleData {
  id: string;
  name: string;
  category: RuleCategory;
  tier: RuleTier;
  layer: string;
  employment: RuleSpec['employment'];
  authority: RuleSpec['authority'];
  hc: string | null;
  sc: string | null;
  formula: string;
  description: string;
  evaluation: string;
  inputs: string[];
  threshold: string;
  window: string;
  exceptions?: string;
  knownGap?: string;
  outcome: string;
  solverRef: string;
}

// ── MACRO CP-SAT SOLVER CONSTRAINTS (HC-1, HC-6, HC-7, SC-1..6) ──
const SOLVER_MACRO_CONSTRAINTS: TechnicalRuleData[] = [
  {
    id: 'SOLVER_HC_1_COVERAGE',
    name: 'Shift Coverage Requirement',
    category: 'STRUCTURE',
    tier: 'BLOCKING',
    layer: 'SOLVER',
    employment: 'ALL',
    authority: { source: 'operational', clauses: [], instrument: 'Demand Fulfillment' },
    hc: 'HC-1',
    sc: null,
    formula: 'Σ_{e ∈ Eligible(s)} x[e, s] + uncovered[s] = 1 ∀ s ∈ Shifts',
    description: 'Every shift demand in the roster horizon must be assigned to exactly one qualified worker or explicitly accounted for as uncovered.',
    evaluation: 'The CP-SAT solver generates binary decision variables x[e,s] for all pre-qualified employee-shift pairs and enforces exact unity coverage per shift slot.',
    inputs: ['x[e, s] candidate assignment variables', 'uncovered[s] slack variable', 'shifts table'],
    threshold: '100% exact single coverage',
    window: 'Full planning horizon',
    outcome: 'Hard solver constraint; uncovered shifts incur heavy objective penalty ($10,000 × priority).',
    solverRef: 'optimizer-service/model_builder.py:_add_coverage (HC-1)',
  },
  {
    id: 'SOLVER_HC_6_TIME_CAPACITY',
    name: 'Time-Coupled Pool Capacity',
    category: 'STRUCTURE',
    tier: 'BLOCKING',
    layer: 'SOLVER',
    employment: 'ALL',
    authority: { source: 'operational', clauses: [], instrument: 'Capacity Ceiling' },
    hc: 'HC-6',
    sc: null,
    formula: 'Σ_{s ∈ Active(t)} x[e, s] ≤ PoolCapacity(Role, t) ∀ time slices t',
    description: 'Bounds concurrent workforce allocations across overlapping operational shifts so total active workers never exceed physical pool capacity.',
    evaluation: 'Constructs cumulative resource profiles across time intervals to prevent over-subscription of specialty department pools.',
    inputs: ['Active shift time intervals', 'Role capacity pools'],
    threshold: 'Physical pool limit',
    window: 'Concurrent time slices',
    outcome: 'Hard blocking solver capacity constraint.',
    solverRef: 'optimizer-service/model_builder.py:_add_time_coupled_capacity_constraints (HC-6)',
  },
  {
    id: 'SOLVER_HC_7_MIN_CONTRACT',
    name: 'Minimum Contract Utilization',
    category: 'CONTRACT',
    tier: 'BLOCKING',
    layer: 'SOLVER',
    employment: ['FT', 'PT'],
    authority: { source: 'eba', clauses: ['cl 12.3(a)', 'cl 35.1(a)'] },
    hc: 'HC-7',
    sc: null,
    formula: 'Σ_{s} duration(s) · x[e, s] ≥ MinContractedHours(e) ∀ FT/PT e',
    description: 'Guarantees that Full-Time (38h/w) and Part-Time permanent personnel meet their minimum contracted hours quota over the roster horizon.',
    evaluation: 'Aggregates solved shift minutes per permanent employee and asserts lower bound against the contracted baseline.',
    inputs: ['employee.contracted_hours', 'assigned shift durations', 'contract_type ∈ {FT, PT}'],
    threshold: '38h/week for FT; contracted baseline for PT',
    window: 'Weekly roster cycle',
    outcome: 'Hard blocking constraint; solver prioritizes permanent staff to hit contract baseline before casuals.',
    solverRef: 'optimizer-service/model_builder.py:_add_min_contract_hours (HC-7)',
  },
  {
    id: 'SOLVER_SC_1_PREFERENCE',
    name: 'Worker Shift Preference Matching',
    category: 'AVAILABILITY',
    tier: 'WARNING',
    layer: 'SOLVER',
    employment: 'ALL',
    authority: { source: 'policy', clauses: [], instrument: 'Preference Matching' },
    hc: null,
    sc: 'SC-1',
    formula: 'Minimize: Σ -($5.00) · x[e, s] ∀ (e, s) ∈ PreferredSlots',
    description: 'Incentivizes assigning employees to shifts aligning with their declared preferred working hours.',
    evaluation: 'Applies an objective reward (-$5.00) for each assigned shift that falls within the worker opted-in availability window.',
    inputs: ['employee_availability preferences', 'shift datetime'],
    threshold: 'Preference alignment',
    window: 'Per assignment',
    outcome: 'Soft objective discount.',
    solverRef: 'optimizer-service/model_builder.py:SC-1 (Preference Bonus)',
  },
  {
    id: 'SOLVER_SC_2_UNAVAILABILITY',
    name: 'Unavailability Avoidance Penalty',
    category: 'AVAILABILITY',
    tier: 'WARNING',
    layer: 'SOLVER',
    employment: 'ALL',
    authority: { source: 'policy', clauses: [], instrument: 'Unavailability Avoidance' },
    hc: null,
    sc: 'SC-2',
    formula: 'Minimize: Σ +($50.00) · x[e, s] ∀ (e, s) ∈ UnavailableSlots',
    description: 'Penalizes assigning shifts during employee declared unavailable slots unless required for coverage.',
    evaluation: 'Adds a +$50.00 penalty term to the solver objective function when an assignment infringes on a non-hard unavailable window.',
    inputs: ['employee_unavailability blocks', 'shift datetime'],
    threshold: '0 conflicts preferred',
    window: 'Per assignment',
    outcome: 'Soft objective penalty.',
    solverRef: 'optimizer-service/model_builder.py:SC-2 (Unavailability Penalty)',
  },
  {
    id: 'SOLVER_SC_3_UNCOVERED',
    name: 'Uncovered Shift Penalty',
    category: 'STRUCTURE',
    tier: 'WARNING',
    layer: 'SOLVER',
    employment: 'ALL',
    authority: { source: 'operational', clauses: [], instrument: 'Coverage Target' },
    hc: null,
    sc: 'SC-3',
    formula: 'Minimize: Σ +($10,000 × Priority(s)) · uncovered[s]',
    description: 'High-priority soft penalty driving the solver to achieve 100% coverage before optimizing lower tier objectives.',
    evaluation: 'Assigns $10,000 cost per uncovered shift (multiplied by operational priority 1-10) in Tier-2 objective.',
    inputs: ['uncovered[s] slack variables', 'shift.priority'],
    threshold: '0 uncovered shifts',
    window: 'Full planning horizon',
    outcome: 'Lexicographic Tier-2 objective term.',
    solverRef: 'optimizer-service/model_builder.py:SC-3 (Uncovered Penalty)',
  },
  {
    id: 'SOLVER_SC_4_FAIRNESS',
    name: 'Workload Fairness & Equity',
    category: 'CONTRACT',
    tier: 'WARNING',
    layer: 'SOLVER',
    employment: 'ALL',
    authority: { source: 'policy', clauses: [], instrument: 'Workload Balance' },
    hc: null,
    sc: 'SC-4',
    formula: 'Minimize: +$0.10 · Σ |AllocatedMinutes(e) - TargetMinutes(e)|',
    description: 'Balances shift and hour distribution fairly among employees within the same skill classification and contract tier.',
    evaluation: 'Minimizes L1 variance of allocated hours across peers in Tier-4 objective.',
    inputs: ['Peer group hours ledger', 'target hours distribution'],
    threshold: 'Minimal variance',
    window: 'Roster cycle',
    outcome: 'Soft objective fairness penalty.',
    solverRef: 'optimizer-service/model_builder.py:SC-4 (Fairness Ledger)',
  },
  {
    id: 'SOLVER_SC_5_OVERTIME',
    name: 'Overtime & Premium Penalty',
    category: 'CONTRACT',
    tier: 'WARNING',
    layer: 'SOLVER',
    employment: 'ALL',
    authority: { source: 'eba', clauses: ['cl 38.1'] },
    hc: null,
    sc: 'SC-5',
    formula: 'Minimize: OvertimeCost = BaseRate × 1.50 (first 2h) + BaseRate × 2.00 (>2h)',
    description: 'Cost optimization term penalizing assignments that trigger EBA overtime penalty rates when regular-rate candidates are available.',
    evaluation: 'Computes progressive penalty rates for hours exceeding daily (12h) or weekly (38h/42h) boundaries.',
    inputs: ['Cumulative employee hours', 'award rate tables'],
    threshold: 'Ordinary hours boundary',
    window: 'Weekly / Cycle boundary',
    outcome: 'Soft objective cost term.',
    solverRef: 'optimizer-service/model_builder.py:SC-5 (Overtime Cost)',
  },
  {
    id: 'SOLVER_SC_6_CONTINUITY',
    name: 'Shift Continuity Bonus',
    category: 'STRUCTURE',
    tier: 'WARNING',
    layer: 'SOLVER',
    employment: 'ALL',
    authority: { source: 'policy', clauses: [], instrument: 'Operational Continuity' },
    hc: null,
    sc: 'SC-6',
    formula: 'Minimize: Σ -($2.00) · (x[e, s1] ∧ x[e, s2]) ∀ adjacent slots',
    description: 'Rewards assigning the same employee across consecutive time blocks on the same event or zone.',
    evaluation: 'Applies a bonus (-$2.00) for contiguous multi-slot assignments to reduce handover overhead.',
    inputs: ['Adjacent shift slots', 'location/zone match'],
    threshold: 'Contiguous assignment',
    window: 'Consecutive shift slots',
    outcome: 'Soft objective bonus.',
    solverRef: 'optimizer-service/model_builder.py:SC-6 (Continuity Bonus)',
  },
];

// Technical specifications for all 22 Labour Rules and 12 Shape Rules
const TECHNICAL_RULE_DETAILS: Record<string, Partial<TechnicalRuleData>> = {
  // Shape rules
  SHAPE_MIN_ENGAGEMENT: {
    hc: 'HC-8',
    sc: null,
    formula: 'duration_net(shift) ≥ 3.0h (standard) / 4.0h (Sun/PH) / 2.0h (training)',
    evaluation: 'Enforces minimum engagement floor at shift creation time under EBA cl 12.3(e), 12.4(c), 12.5(c). Rejects standalone shifts below threshold.',
    inputs: ['shift.start_time', 'shift.end_time', 'shift.unpaid_break_minutes', 'is_sunday', 'is_public_holiday'],
    threshold: '3.0h standard / 4.0h Sunday & PH / 2.0h training',
    window: 'Single shift',
    outcome: 'Hard blocking shape rejection on shift creation / edit.',
    solverRef: 'optimizer-service/model_builder.py:_add_min_engagement (HC-8)',
  },
  SHAPE_MAX_DURATION: {
    hc: null,
    sc: null,
    formula: 'duration_net(shift) ≤ 12.0h',
    evaluation: 'Single shift duration ceiling. Rejects shifts exceeding 12 net ordinary working hours.',
    inputs: ['shift.duration_minutes'],
    threshold: '12.0 net hours (720 min)',
    window: 'Single shift',
    outcome: 'Hard blocking shape rejection.',
    solverRef: 'src/modules/compliance/shape/rules/max-duration.ts',
  },
  SHAPE_MEAL_BREAK: {
    hc: null,
    sc: null,
    formula: 'duration_net(shift) > 5.0h ⇒ has_meal_break ≥ 30m',
    evaluation: 'Mandates an attached meal break of at least 30 minutes for any single shift longer than 5 hours (unpaid for standard staff, paid for Security).',
    inputs: ['shift.duration_minutes', 'shift.unpaid_break_minutes', 'is_security_role'],
    threshold: '5.0h worked, 30 min break',
    window: 'Single shift',
    outcome: 'Hard blocking shape rejection.',
    solverRef: 'src/modules/compliance/shape/rules/meal-break.ts',
  },
  // V8 Labour rules
  V8_NO_OVERLAP: {
    hc: 'HC-2',
    sc: null,
    formula: '[start_A, end_A) ∩ [start_B, end_B) = ∅ ∀ shifts A ≠ B',
    evaluation: 'Enforces interval exclusivity on candidate shifts assigned to an employee identity. The solver verifies that no two assigned time intervals intersect on the timeline.',
    inputs: ['IntervalVar(shift_A)', 'IntervalVar(shift_B)', 'employee_id'],
    threshold: '0 minutes allowable overlap',
    window: 'Full roster planning horizon',
    outcome: 'Hard blocking rejection; CAS version write rejected on conflict.',
    solverRef: 'optimizer-service/model_builder.py:HC-2 (No Overlap)',
  },
  V8_LEAVE_CONFLICT: {
    hc: 'HC-5 (eligibility)',
    sc: null,
    formula: 'shift.date ∉ approved_leave_intervals(employee)',
    evaluation: 'Filters solver candidate domain D(s) to disqualify any employee with approved annual, personal, or public holiday leave intersecting the shift window.',
    inputs: ['shifts.start_time', 'shifts.end_time', 'leave_requests.status == APPROVED'],
    threshold: 'Binary conflict (0 tolerance)',
    window: 'Shift duration vs approved leave span',
    outcome: 'Hard blocking rejection; employee domain pruned during candidate generation.',
    solverRef: 'optimizer-service/model_builder.py:HC-5 (Leave Eligibility)',
  },
  V8_QUALIFICATIONS: {
    hc: 'HC-5',
    sc: null,
    formula: 'shift.required_skills ⊆ employee.active_qualifications',
    evaluation: 'Evaluates required skill subsets. An employee is eligible for assignment if and only if their active credential ledger contains all competencies demanded by the shift role.',
    inputs: ['shift.skill_requirements', 'employee_qualifications.skill_id'],
    threshold: '100% required skill containment',
    window: 'At shift start timestamp',
    outcome: 'Hard blocking rejection during pre-assignment validation.',
    solverRef: 'optimizer-service/model_builder.py:HC-5 (Skill Containment)',
  },
  V8_QUALIFICATION_EXPIRED: {
    hc: 'HC-5',
    sc: null,
    formula: '∀ q ∈ required_quals: q.expires_at > shift.start_time',
    evaluation: 'Verifies qualification expiration timestamps against shift start datetime. Stale or expired certifications disqualify the candidate employee.',
    inputs: ['employee_qualifications.valid_until', 'shift.start_time'],
    threshold: 'valid_until > shift.start_time',
    window: 'Point-in-time at shift commencement',
    outcome: 'Hard blocking rejection.',
    solverRef: 'optimizer-service/model_builder.py:HC-5 (Expiry Validation)',
  },
  V8_EMPLOYMENT_TARGET: {
    hc: 'HC-5c',
    sc: null,
    formula: 'normalize(employee.contract) == normalize(shift.target_type)',
    evaluation: 'Hard contract-type partition. Shifts designated for specific employment modes (e.g. Casual, Full-Time, Flexi-PT) reject cross-contract assignments with zero fallback.',
    inputs: ['employee.employment_type', 'shifts.target_employment_type'],
    threshold: 'Exact contract type match',
    window: 'Per assignment',
    outcome: 'Hard blocking pre-mutation failure.',
    solverRef: 'optimizer-service/model_builder.py:HC-5c (Employment Isolation)',
  },
  V8_MIN_REST_GAP: {
    hc: 'HC-3',
    sc: null,
    formula: 'shift_B.start - shift_A.end ≥ 10h (or 8h with waiver/multi-hire)',
    evaluation: 'Evaluates recovery intervals between consecutive work periods across day boundaries. Computes elapsed rest and blocks candidate assignments below threshold.',
    inputs: ['shift_A.end_time', 'shift_B.start_time', 'employee.has_8h_agreement', 'shift_A.is_multi_hire'],
    threshold: '600 min (10h standard); 480 min (8h reduced)',
    window: 'Consecutive cross-day shift pairs',
    exceptions: 'Reduced to 8 hours under formal written waiver or following a multi-hire engagement (cl 13.1(f)).',
    outcome: 'Hard blocking rejection on insufficient rest recovery.',
    solverRef: 'optimizer-service/model_builder.py:HC-3 (Inter-Shift Rest)',
  },
  V8_MAX_DAILY_HOURS: {
    hc: 'HC-4',
    sc: null,
    formula: 'Σ qualifying_work_duration(employee, calendar_day) ≤ 12.0h',
    evaluation: 'Aggregates net ordinary worked minutes across all shifts assigned to the employee within a single calendar day boundary (00:00 to 24:00).',
    inputs: ['shift.duration_minutes', 'shift.unpaid_break_minutes', 'calendar_day boundary'],
    threshold: '720 minutes (12.0 net hours)',
    window: 'Single calendar day (00:00 - 24:00)',
    outcome: 'Hard blocking rejection if daily total exceeds 12.0h.',
    solverRef: 'optimizer-service/model_builder.py:HC-4 (Daily Work Cap)',
  },
  V8_SPLIT_SHIFT_SPREAD: {
    hc: 'HC-9',
    sc: null,
    formula: '(last_end - first_start) - Σ unpaid_breaks ≤ 12.0h',
    evaluation: 'Measures the net daily spread from initial clock-in to final clock-out minus unpaid break durations for part-time and flexible part-time employees.',
    inputs: ['shift_1.start_time', 'shift_2.end_time', 'shift breaks', 'employee.contract_type ∈ {PT, FPT}'],
    threshold: '720 minutes net span (12.0 hours)',
    window: 'Same calendar day',
    outcome: 'Hard blocking rejection.',
    solverRef: 'optimizer-service/model_builder.py:HC-9 (Split Shift Spread)',
  },
  V8_CASUAL_SECURITY_SPREAD: {
    hc: 'HC-9',
    sc: null,
    formula: '(last_end - first_start)_gross ≤ 12.0h',
    evaluation: 'Evaluates the gross elapsed span across two shifts in one day for casual event security staff. Measured gross because Schedule 3 mandates paid meal breaks.',
    inputs: ['shift_1.start_time', 'shift_2.end_time', 'is_security_role == true', 'contract == CASUAL'],
    threshold: '720 minutes gross span (12.0 hours)',
    window: 'Same calendar day',
    outcome: 'Hard blocking rejection.',
    solverRef: 'optimizer-service/model_builder.py:HC-9 (Casual Security Spread)',
  },
  V8_CASUAL_SECURITY_ENGAGEMENT: {
    hc: 'HC-13',
    sc: null,
    formula: '∀ s ∈ daily_shifts(casual_security): duration(s) ≥ 3.0h',
    evaluation: 'Where a casual event security employee works two shifts in one calendar day, each discrete engagement must satisfy the 3-hour minimum engagement floor.',
    inputs: ['shift.duration_minutes', 'is_security_role == true', 'daily_shift_count ≥ 2'],
    threshold: '180 minutes per engagement (3.0 hours)',
    window: 'Same calendar day',
    outcome: 'Hard blocking rejection if either shift is under 3h.',
    solverRef: 'optimizer-service/model_builder.py:HC-13 (Engagement Floor)',
  },
  V8_SPLIT_SHIFT: {
    hc: null,
    sc: 'SC-SplitGap',
    formula: '(shift_2.start - shift_1.end) ≤ 3.0h',
    evaluation: 'Advisory guardrail limiting the idle break interval between two parts of a split shift. Emits a warning when the gap exceeds 3 hours.',
    inputs: ['shift_1.end_time', 'shift_2.start_time', 'contract ∈ {PT, FPT}'],
    threshold: '180 minutes (3.0 hours gap)',
    window: 'Same calendar day',
    outcome: 'Advisory warning; supervisor review recommended.',
    solverRef: 'optimizer-service/model_builder.py:SC-SplitGap (Advisory)',
  },
  V8_MULTI_HIRE_ELIGIBILITY: {
    hc: null,
    sc: 'SC-MultiHire',
    formula: 'duration ≥ 3h (or 2h if within 1h of finish) ∧ post_break ≥ 8h',
    evaluation: 'Audits multi-hire secondary role engagements across distinct operational classifications, verifying minimum duration and mandatory 8-hour post-engagement rest.',
    inputs: ['shift.shift_type == MULTI_HIRE', 'shift.duration_minutes', 'subsequent_shift.start_time'],
    threshold: '3h / 2h floor and 8h rest recovery',
    window: 'Consecutive engagement sequence',
    outcome: 'Advisory warning emitted on contract divergence.',
    solverRef: 'optimizer-service/model_builder.py:SC-MultiHire (Advisory)',
  },
  V8_MAX_DAILY_ENGAGEMENTS: {
    hc: 'HC-4c',
    sc: null,
    formula: 'count(shifts(casual, calendar_day)) ≤ 2',
    evaluation: 'Hard statutory limit capping casual employees at a maximum of 2 distinct work engagements within any single calendar day.',
    inputs: ['shifts assigned per calendar day', 'employee.contract_type == CASUAL'],
    threshold: '2 engagements maximum per calendar day',
    window: 'Calendar day (00:00 - 24:00)',
    outcome: 'Hard blocking rejection on third candidate assignment.',
    solverRef: 'optimizer-service/model_builder.py:HC-4c (Max Engagements)',
  },
  V8_DAILY_MEAL_BREAK: {
    hc: 'HC-13',
    sc: null,
    formula: 'Σ duration(shifts) > 5.0h ⇒ has_meal_break ≥ 30m',
    evaluation: 'Audits multi-part working days. When cumulative worked time exceeds 5 hours, an unpaid/paid break of at least 30 minutes (or qualifying inter-shift gap) is mandatory.',
    inputs: ['cumulative worked minutes', 'shift break duration', 'inter-shift gap'],
    threshold: '5.0 hours cumulative work, 30 min break',
    window: 'Same calendar day',
    outcome: 'Hard blocking rejection.',
    solverRef: 'optimizer-service/model_builder.py:HC-13 (Daily Meal Break)',
  },
  V8_20_IN_28: {
    hc: 'HC-4b',
    sc: null,
    formula: 'count(worked_days in rolling 28d) ≤ 20',
    evaluation: 'Enforces maximum allowable workdays in any rolling 28-day window, ensuring every employee receives at least 8 rest days per 4-week cycle.',
    inputs: ['worked day indicator array', 'rolling 28-day temporal window'],
    threshold: '20 worked days maximum (≥ 8 days off)',
    window: 'Rolling 28-day window',
    outcome: 'Hard blocking error on 21st worked day.',
    solverRef: 'optimizer-service/model_builder.py:HC-4b (20 in 28)',
  },
  V8_STREAK_LIMIT: {
    hc: 'HC-4 (streak)',
    sc: null,
    formula: 'consecutive_worked_days(FPT) ≤ 10',
    evaluation: 'Fatigue safeguard bounding continuous work streaks. Flexible part-time staff may work at most 10 consecutive calendar days without a full day off.',
    inputs: ['consecutive worked days sequence', 'employee.contract == FPT'],
    threshold: '10 consecutive calendar days',
    window: 'Daily roster sequence',
    outcome: 'Hard blocking rejection on 11th consecutive day.',
    solverRef: 'optimizer-service/model_builder.py:HC-4 (Streak Limit)',
  },
  V8_STUDENT_VISA_LIMIT: {
    hc: 'HC-12',
    sc: null,
    formula: 'Σ duration(fortnightly_cycle) ≤ 48.0h',
    evaluation: 'Statutory compliance constraint enforcing Migration Act condition 8105. Student visa holders are strictly limited to 48 hours worked per fortnight.',
    inputs: ['shift durations', 'fortnightly cycle boundary', 'employee.visa_condition == 8105'],
    threshold: '2880 minutes (48.0 hours / fortnight)',
    window: 'Fortnightly pay cycle (14 days)',
    outcome: 'Hard blocking legal violation.',
    solverRef: 'optimizer-service/model_builder.py:HC-12 (Visa Condition 8105)',
  },
  V8_ORD_HOURS_AVG: {
    hc: 'HC-4',
    sc: null,
    formula: 'mean_weekly_hours ≤ 38h (4w cycle) / 42h (8w security cycle)',
    evaluation: 'Averages ordinary weekly hours over a multi-week reference cycle (38h/w over 4 weeks for general staff; 42h/w over 8 weeks for Schedule 3 security).',
    inputs: ['weekly hours totals', 'cycle length (4w / 8w)', 'is_security_role'],
    threshold: '38h / week (general), 42h / week (security)',
    window: '4-week reference cycle (general), 8-week cycle (security)',
    outcome: 'Hard blocking rejection on cycle cap breach.',
    solverRef: 'optimizer-service/model_builder.py:HC-4 (Ordinary Averaging)',
  },
  V8_ORD_HOURS_CONTRACTED: {
    hc: null,
    sc: 'SC-OverContract',
    formula: 'hours_worked > contract_hours ⇒ written_consent_required',
    evaluation: 'Flags rostered hours exceeding a part-timer agreed pattern. Warns that overtime/extra hours require explicit written employee agreement.',
    inputs: ['employee.contracted_hours', 'rostered_hours_total'],
    threshold: 'Base contracted hours allocation',
    window: 'Weekly roster cycle',
    outcome: 'Advisory warning for manager review.',
    solverRef: 'optimizer-service/model_builder.py:SC-OverContract (Advisory)',
  },
  V8_ORD_HOURS_PEAK: {
    hc: null,
    sc: 'SC-PeakHours',
    formula: 'single_week_hours > 44.0h ∧ cycle_average ≤ 38.0h',
    evaluation: 'Variance guardrail flagging excessive single-week loading spikes even when the multi-week cycle average technically complies with EBA caps.',
    inputs: ['weekly ordinary hours array'],
    threshold: '44.0 hours single-week spike threshold',
    window: 'Single calendar week',
    outcome: 'Advisory warning on fatigue risk.',
    solverRef: 'optimizer-service/model_builder.py:SC-PeakHours (Advisory)',
  },
  V8_FT_DAYS_OFF: {
    hc: null,
    sc: 'SC-DaysOff',
    formula: 'paired_consecutive_days_off(FT) ≥ 2 per week average',
    evaluation: 'Evaluates distribution of days off for full-time personnel, aiming for paired (2 consecutive) rest days per work week. Exempt for security on even-time rosters.',
    inputs: ['days off sequence', 'employee.contract == FT', 'is_security_role == false'],
    threshold: '2 consecutive days off per week average',
    window: '4-week roster work cycle',
    exceptions: 'Exempt for full-time security staff working Schedule 3 even-time rosters.',
    outcome: 'Advisory warning.',
    solverRef: 'optimizer-service/model_builder.py:SC-DaysOff (Advisory)',
  },
  V8_AVAILABILITY_CONFLICT: {
    hc: 'HC-5d/5e',
    sc: 'SC-Availability',
    formula: 'shift ⊆ employee.availability ∧ shift ∩ employee.unavailability = ∅',
    evaluation: 'Evaluates declared staff availability envelopes and unavailability blocks. CP-SAT soft tier minimizes unaligned assignments; V8 issues advisory warnings.',
    inputs: ['employee_availability_slots', 'employee_unavailability_slots', 'shift interval'],
    threshold: 'Exact slot alignment',
    window: 'Shift duration',
    outcome: 'Advisory warning and solver objective penalty.',
    solverRef: 'optimizer-service/model_builder.py:HC-5d/5e & SC-Availability',
  },
};

type RuleViewFilter = 'V8_LABOUR' | 'SHAPE' | 'SOLVER_MACRO' | 'ALL';

type SortField =
  | 'name'
  | 'id'
  | 'category'
  | 'tier'
  | 'hc'
  | 'sc'
  | 'authority'
  | 'scope'
  | 'layer';

type SortDirection = 'asc' | 'desc';

interface V8RulesTableProps {
  className?: string;
  onSelectRule?: (ruleId: string) => void;
}

const CATEGORY_CONFIG: Record<
  RuleCategory,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badgeBg: string;
  }
> = {
  TIME: {
    label: 'Time & Rest',
    icon: Clock,
    badgeBg: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25',
  },
  CONTRACT: {
    label: 'Contract & Hours',
    icon: FileText,
    badgeBg: 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/25',
  },
  LEGAL: {
    label: 'Legal & Statutory',
    icon: Scale,
    badgeBg: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25',
  },
  SKILL: {
    label: 'Skills & Quals',
    icon: Award,
    badgeBg: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25',
  },
  AVAILABILITY: {
    label: 'Availability',
    icon: CalendarCheck,
    badgeBg: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25',
  },
  STRUCTURE: {
    label: 'Structure',
    icon: Lock,
    badgeBg: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/25',
  },
};

function formatEmploymentScope(scope: RuleSpec['employment']): string {
  if (scope === 'ALL') return 'All Staff';
  if (Array.isArray(scope)) {
    return scope
      .map((s) => {
        switch (s) {
          case 'FT':
            return 'Full-Time';
          case 'PT':
            return 'Part-Time';
          case 'FPT':
            return 'Flexi-PT';
          case 'CASUAL':
            return 'Casual';
          default:
            return s;
        }
      })
      .join(', ');
  }
  return String(scope);
}

function formatAuthority(auth: RuleSpec['authority']): string {
  if (auth.source === 'eba') {
    return auth.clauses.length > 0 ? `EBA ${auth.clauses.join(', ')}` : 'EBA';
  }
  if (auth.source === 'statute') {
    return auth.instrument || 'Migration Act 1958';
  }
  if (auth.source === 'policy') {
    return auth.instrument || 'Policy Guideline';
  }
  return auth.instrument || 'Operational';
}

function parseHcNumber(hc: string | null): number {
  if (!hc) return 9999;
  const match = hc.match(/HC-(\d+)([a-z])?/i);
  if (!match) return 999;
  const num = parseInt(match[1], 10);
  const suffix = match[2] ? match[2].charCodeAt(0) * 0.01 : 0;
  return num + suffix;
}

export const V8RulesTable: React.FC<V8RulesTableProps> = ({
  className,
  onSelectRule,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewFilter, setViewFilter] = useState<RuleViewFilter>('V8_LABOUR');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [activeInspectorRule, setActiveInspectorRule] = useState<TechnicalRuleData | null>(null);

  // Combine All Registered Rules + Solver Macro Constraints
  const allTechnicalRules = useMemo<TechnicalRuleData[]>(() => {
    const registryRules: TechnicalRuleData[] = Object.values(RULE_REGISTRY).map((rule) => {
      const details = TECHNICAL_RULE_DETAILS[rule.id] || {};
      return {
        id: rule.id,
        name: rule.name,
        category: rule.category,
        tier: rule.tier,
        layer: rule.layer,
        employment: rule.employment,
        authority: rule.authority,
        hc: details.hc !== undefined ? details.hc : rule.engines.solver,
        sc: details.sc || null,
        formula: details.formula || rule.description,
        description: rule.description,
        evaluation: details.evaluation || rule.description,
        inputs: details.inputs || ['shifts', 'employee_id'],
        threshold: details.threshold || 'Standard',
        window: details.window || 'Roster Period',
        exceptions: details.exceptions,
        knownGap: rule.knownGap,
        outcome: details.outcome || (rule.tier === 'BLOCKING' ? 'Hard blocking rejection' : 'Advisory warning'),
        solverRef: details.solverRef || `optimizer-service/model_builder.py:${rule.engines.solver || 'Advisory'}`,
      };
    });

    return [...registryRules, ...SOLVER_MACRO_CONSTRAINTS];
  }, []);

  // Filter rules by view category & search query
  const filteredRules = useMemo(() => {
    return allTechnicalRules.filter((rule) => {
      // Layer view filtering
      if (viewFilter === 'V8_LABOUR' && rule.layer !== 'LABOUR') return false;
      if (viewFilter === 'SHAPE' && rule.layer !== 'SHAPE') return false;
      if (viewFilter === 'SOLVER_MACRO' && rule.layer !== 'SOLVER') return false;

      // Search query filtering
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = rule.name.toLowerCase().includes(q);
        const matchesId = rule.id.toLowerCase().includes(q);
        const matchesHc = rule.hc?.toLowerCase().includes(q) ?? false;
        const matchesSc = rule.sc?.toLowerCase().includes(q) ?? false;
        const matchesAuthority = formatAuthority(rule.authority).toLowerCase().includes(q);
        const matchesDesc = rule.description.toLowerCase().includes(q);
        const matchesFormula = rule.formula.toLowerCase().includes(q);
        return (
          matchesName ||
          matchesId ||
          matchesHc ||
          matchesSc ||
          matchesAuthority ||
          matchesDesc ||
          matchesFormula
        );
      }
      return true;
    });
  }, [allTechnicalRules, viewFilter, searchQuery]);

  // Sort rules
  const sortedRules = useMemo(() => {
    return [...filteredRules].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'id':
          comparison = a.id.localeCompare(b.id);
          break;
        case 'category':
          comparison = a.category.localeCompare(b.category);
          break;
        case 'tier':
          comparison = a.tier.localeCompare(b.tier);
          break;
        case 'hc':
          comparison = parseHcNumber(a.hc) - parseHcNumber(b.hc);
          break;
        case 'sc':
          comparison = (a.sc || 'zzz').localeCompare(b.sc || 'zzz');
          break;
        case 'authority':
          comparison = formatAuthority(a.authority).localeCompare(formatAuthority(b.authority));
          break;
        case 'scope':
          comparison = formatEmploymentScope(a.employment).localeCompare(
            formatEmploymentScope(b.employment),
          );
          break;
        case 'layer':
          comparison = a.layer.localeCompare(b.layer);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredRules, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const v8LabourCount = allTechnicalRules.filter((r) => r.layer === 'LABOUR').length;
  const shapeCount = allTechnicalRules.filter((r) => r.layer === 'SHAPE').length;
  const solverMacroCount = allTechnicalRules.filter((r) => r.layer === 'SOLVER').length;

  return (
    <div className={cn('space-y-6', className)}>
      {/* ── INTERACTIVE ARCHITECTURE DIAGRAM ── */}
      <ComplianceArchitectureDiagram />

      {/* ── TECHNICAL SEARCH & SCOPE HEADER ── */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Layer Scope Switcher */}
        <div className="flex items-center rounded-xl bg-muted/60 dark:bg-slate-800/80 p-1 border border-border/40 max-w-fit shadow-xs">
          <button
            onClick={() => setViewFilter('V8_LABOUR')}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs sm:text-[13px] font-bold transition-all',
              viewFilter === 'V8_LABOUR'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            V8 Labour Rules ({v8LabourCount})
          </button>
          <button
            onClick={() => setViewFilter('SHAPE')}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs sm:text-[13px] font-bold transition-all',
              viewFilter === 'SHAPE'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Shift Shape Gate ({shapeCount})
          </button>
          <button
            onClick={() => setViewFilter('SOLVER_MACRO')}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs sm:text-[13px] font-bold transition-all',
              viewFilter === 'SOLVER_MACRO'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            CP-SAT Solver Model ({solverMacroCount})
          </button>
          <button
            onClick={() => setViewFilter('ALL')}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs sm:text-[13px] font-bold transition-all',
              viewFilter === 'ALL'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            All ({allTechnicalRules.length})
          </button>
        </div>

        {/* Search Field */}
        <div className="relative flex-1 max-w-md md:ml-auto">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by rule name, ID, HC (e.g. HC-4), clause, formula..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 pr-9 bg-card dark:bg-[#161d2d]/95 border-border/70 text-[13.5px] h-10 rounded-xl focus-visible:ring-2 focus-visible:ring-primary shadow-xs font-medium"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── TECHNICAL DATA TABLE ── */}
      <div className="rounded-2xl border border-border/70 dark:border-white/10 bg-card dark:bg-[#161d2d]/95 overflow-hidden shadow-sm">
        {sortedRules.length === 0 ? (
          <div className="p-12 text-center">
            <SlidersHorizontal className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
            <h3 className="text-base font-bold text-foreground">No compliance rules match your filter</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Try adjusting your search query or resetting the layer filter.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSearchQuery('')}
              className="mt-5 text-sm font-medium"
            >
              Clear Search
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[1100px]">
              {/* Sticky Table Header */}
              <thead className="sticky top-0 z-20 bg-muted/60 dark:bg-slate-800/90 backdrop-blur border-b border-border/70 dark:border-white/10 text-xs font-bold uppercase tracking-wider text-muted-foreground select-none">
                <tr>
                  {/* Rule Name Column (Sticky left) */}
                  <th
                    onClick={() => handleSort('name')}
                    className="sticky left-0 z-30 bg-muted/90 dark:bg-slate-800/95 py-3.5 px-4 cursor-pointer hover:text-foreground transition-colors min-w-[240px]"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Rule</span>
                      {sortField === 'name' ? (
                        sortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-primary" /> : <ArrowDown className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                      )}
                    </div>
                  </th>

                  {/* Rule ID Column */}
                  <th
                    onClick={() => handleSort('id')}
                    className="py-3.5 px-3.5 cursor-pointer hover:text-foreground transition-colors min-w-[180px]"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Rule ID</span>
                      {sortField === 'id' ? (
                        sortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-primary" /> : <ArrowDown className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                      )}
                    </div>
                  </th>

                  {/* Category Column */}
                  <th
                    onClick={() => handleSort('category')}
                    className="py-3.5 px-3 cursor-pointer hover:text-foreground transition-colors min-w-[150px]"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Category</span>
                      {sortField === 'category' ? (
                        sortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-primary" /> : <ArrowDown className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                      )}
                    </div>
                  </th>

                  {/* Status Column */}
                  <th
                    onClick={() => handleSort('tier')}
                    className="py-3.5 px-3 cursor-pointer hover:text-foreground transition-colors min-w-[130px]"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Status</span>
                      {sortField === 'tier' ? (
                        sortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-primary" /> : <ArrowDown className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                      )}
                    </div>
                  </th>

                  {/* HC Column */}
                  <th
                    onClick={() => handleSort('hc')}
                    className="py-3.5 px-3 cursor-pointer hover:text-foreground transition-colors min-w-[110px]"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>HC</span>
                      {sortField === 'hc' ? (
                        sortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-primary" /> : <ArrowDown className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                      )}
                    </div>
                  </th>

                  {/* SC Column */}
                  <th
                    onClick={() => handleSort('sc')}
                    className="py-3.5 px-3 cursor-pointer hover:text-foreground transition-colors min-w-[130px]"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>SC</span>
                      {sortField === 'sc' ? (
                        sortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-primary" /> : <ArrowDown className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                      )}
                    </div>
                  </th>

                  {/* Authority Column */}
                  <th
                    onClick={() => handleSort('authority')}
                    className="py-3.5 px-3.5 cursor-pointer hover:text-foreground transition-colors min-w-[180px]"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Authority</span>
                      {sortField === 'authority' ? (
                        sortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-primary" /> : <ArrowDown className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                      )}
                    </div>
                  </th>

                  {/* Scope Column */}
                  <th
                    onClick={() => handleSort('scope')}
                    className="py-3.5 px-3 cursor-pointer hover:text-foreground transition-colors min-w-[130px]"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Scope</span>
                      {sortField === 'scope' ? (
                        sortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-primary" /> : <ArrowDown className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                      )}
                    </div>
                  </th>

                  {/* Layer Column */}
                  <th
                    onClick={() => handleSort('layer')}
                    className="py-3.5 px-3 cursor-pointer hover:text-foreground transition-colors min-w-[100px]"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Layer</span>
                      {sortField === 'layer' ? (
                        sortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-primary" /> : <ArrowDown className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                      )}
                    </div>
                  </th>

                  {/* Solver Interpretation Column */}
                  <th className="py-3.5 px-4 min-w-[320px]">
                    <span>Solver Interpretation</span>
                  </th>
                </tr>
              </thead>

              {/* Table Body */}
              <tbody className="divide-y divide-border/60 dark:divide-white/10 text-[14px]">
                {sortedRules.map((rule) => {
                  const catConfig = CATEGORY_CONFIG[rule.category] || CATEGORY_CONFIG.TIME;
                  const CatIcon = catConfig.icon;
                  const isBlocking = rule.tier === 'BLOCKING';

                  return (
                    <tr
                      key={rule.id}
                      onClick={() => {
                        setActiveInspectorRule(rule);
                        onSelectRule?.(rule.id);
                      }}
                      className="group hover:bg-muted/40 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                    >
                      {/* 1. Rule Name + ⓘ Inspector button (Sticky left) */}
                      <td className="sticky left-0 z-10 bg-card/95 dark:bg-[#161d2d]/95 group-hover:bg-muted/80 dark:group-hover:bg-slate-800/90 py-3.5 px-4 border-r border-border/40 shadow-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-foreground group-hover:text-primary transition-colors">
                            {rule.name}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveInspectorRule(rule);
                            }}
                            title="Inspect solver technical specification"
                            className="text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-md p-1 transition-colors"
                          >
                            <Info className="h-4 w-4" />
                          </button>
                        </div>
                      </td>

                      {/* 2. Rule ID */}
                      <td className="py-3.5 px-3.5">
                        <code className="font-mono text-[12.5px] font-medium text-foreground/80 bg-muted/60 dark:bg-slate-800/80 px-2 py-0.5 rounded border border-border/40 whitespace-nowrap">
                          {rule.id}
                        </code>
                      </td>

                      {/* 3. Category */}
                      <td className="py-3.5 px-3">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-semibold border whitespace-nowrap',
                            catConfig.badgeBg,
                          )}
                        >
                          <CatIcon className="h-3.5 w-3.5" />
                          {catConfig.label}
                        </span>
                      </td>

                      {/* 4. Status */}
                      <td className="py-3.5 px-3">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-bold border tracking-wide uppercase whitespace-nowrap',
                            isBlocking
                              ? 'bg-rose-500/15 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/30'
                              : 'bg-amber-500/15 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30',
                          )}
                        >
                          {isBlocking ? (
                            <>
                              <ShieldAlert className="h-3 w-3" />
                              BLOCKING
                            </>
                          ) : (
                            <>
                              <AlertTriangle className="h-3 w-3" />
                              WARNING
                            </>
                          )}
                        </span>
                      </td>

                      {/* 5. HC */}
                      <td className="py-3.5 px-3 font-mono">
                        {rule.hc ? (
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveInspectorRule(rule);
                            }}
                            className="inline-flex items-center gap-1 text-[12.5px] font-bold text-sky-700 dark:text-sky-300 bg-sky-500/10 dark:bg-sky-950/40 px-2 py-0.5 rounded border border-sky-500/25 hover:bg-sky-500/20 transition-colors whitespace-nowrap"
                          >
                            <Cpu className="h-3 w-3" />
                            {rule.hc}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50 text-xs">—</span>
                        )}
                      </td>

                      {/* 6. SC */}
                      <td className="py-3.5 px-3 font-mono">
                        {rule.sc ? (
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveInspectorRule(rule);
                            }}
                            className="inline-flex items-center gap-1 text-[12px] font-semibold text-purple-700 dark:text-purple-300 bg-purple-500/10 dark:bg-purple-950/40 px-2 py-0.5 rounded border border-purple-500/25 hover:bg-purple-500/20 transition-colors whitespace-nowrap"
                          >
                            {rule.sc}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50 text-xs">—</span>
                        )}
                      </td>

                      {/* 7. Authority */}
                      <td className="py-3.5 px-3.5 text-[13px] font-medium text-foreground/90">
                        {formatAuthority(rule.authority)}
                      </td>

                      {/* 8. Scope */}
                      <td className="py-3.5 px-3 text-[13px] font-medium text-foreground/80 whitespace-nowrap">
                        {formatEmploymentScope(rule.employment)}
                      </td>

                      {/* 9. Layer */}
                      <td className="py-3.5 px-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                        <Badge variant="outline" className="font-mono text-[11px] py-0 px-2">
                          {rule.layer}
                        </Badge>
                      </td>

                      {/* 10. Solver Interpretation */}
                      <td className="py-3.5 px-4 font-mono text-[12.5px] text-foreground/80 leading-relaxed">
                        <code className="text-foreground/90 bg-muted/40 dark:bg-slate-900/60 px-2 py-1 rounded border border-border/40 block max-w-fit truncate">
                          {rule.formula}
                        </code>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── RICH TECHNICAL RULE INSPECTOR MODAL ── */}
      <Dialog
        open={Boolean(activeInspectorRule)}
        onOpenChange={(open) => !open && setActiveInspectorRule(null)}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-6 sm:p-8 rounded-2xl">
          {activeInspectorRule && (
            <div className="space-y-6">
              {/* Header Title & Badges */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-semibold border',
                        CATEGORY_CONFIG[activeInspectorRule.category]?.badgeBg,
                      )}
                    >
                      {activeInspectorRule.category}
                    </span>
                    <code className="font-mono text-[13px] font-bold text-foreground bg-muted px-2 py-0.5 rounded border border-border/40">
                      {activeInspectorRule.id}
                    </code>
                  </div>

                  {/* Status Badge */}
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-bold border tracking-wide uppercase',
                      activeInspectorRule.tier === 'BLOCKING'
                        ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30'
                        : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
                    )}
                  >
                    {activeInspectorRule.tier === 'BLOCKING' ? (
                      <>
                        <ShieldAlert className="h-3.5 w-3.5" />
                        Hard Constraint (Blocking)
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Advisory / Soft Constraint (Warning)
                      </>
                    )}
                  </span>
                </div>

                <DialogTitle className="text-xl sm:text-2xl font-extrabold tracking-tight text-foreground">
                  {activeInspectorRule.name}
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground mt-1">
                  Canonical Solver Constraint & Compliance Specification
                </DialogDescription>
              </div>

              {/* Mathematical Constraint Box */}
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-primary">
                  Mathematical Constraint Expression
                </span>
                <pre className="font-mono text-sm sm:text-[14.5px] font-bold text-foreground bg-background/80 p-3 rounded-lg border border-border/60 overflow-x-auto whitespace-pre-wrap">
                  {activeInspectorRule.formula}
                </pre>
              </div>

              {/* Technical Definition & Evaluation */}
              <div className="space-y-4 text-[14px]">
                <div className="space-y-1">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Operational Definition
                  </h4>
                  <p className="text-foreground/90 leading-relaxed font-normal">
                    {activeInspectorRule.description}
                  </p>
                </div>

                <div className="space-y-1">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Solver Evaluation Procedure
                  </h4>
                  <p className="text-foreground/90 leading-relaxed font-normal">
                    {activeInspectorRule.evaluation}
                  </p>
                </div>
              </div>

              {/* Technical Parameters Matrix */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl border border-border/70 dark:border-white/10 bg-muted/20 p-4 text-[13px]">
                <div>
                  <span className="text-xs font-semibold text-muted-foreground block">
                    Evaluation Threshold
                  </span>
                  <span className="font-semibold text-foreground font-mono">
                    {activeInspectorRule.threshold}
                  </span>
                </div>

                <div>
                  <span className="text-xs font-semibold text-muted-foreground block">
                    Temporal Window
                  </span>
                  <span className="font-semibold text-foreground">
                    {activeInspectorRule.window}
                  </span>
                </div>

                <div>
                  <span className="text-xs font-semibold text-muted-foreground block">
                    Legal / EBA Authority
                  </span>
                  <span className="font-semibold text-foreground">
                    {formatAuthority(activeInspectorRule.authority)}
                  </span>
                </div>

                <div>
                  <span className="text-xs font-semibold text-muted-foreground block">
                    Employee Scope
                  </span>
                  <span className="font-semibold text-foreground">
                    {formatEmploymentScope(activeInspectorRule.employment)}
                  </span>
                </div>

                <div>
                  <span className="text-xs font-semibold text-muted-foreground block">
                    CP-SAT Solver Mapping
                  </span>
                  <span className="font-mono font-bold text-sky-600 dark:text-sky-400">
                    {activeInspectorRule.hc || 'None (Advisory Layer)'}
                  </span>
                </div>

                <div>
                  <span className="text-xs font-semibold text-muted-foreground block">
                    Soft Constraint ID
                  </span>
                  <span className="font-mono font-bold text-purple-600 dark:text-purple-400">
                    {activeInspectorRule.sc || '—'}
                  </span>
                </div>
              </div>

              {/* Input Variables */}
              <div className="space-y-1.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Evaluation Inputs & Variables
                </h4>
                <div className="flex flex-wrap gap-2">
                  {activeInspectorRule.inputs.map((inp, idx) => (
                    <code
                      key={idx}
                      className="font-mono text-xs bg-muted/60 px-2 py-1 rounded border border-border/50 text-foreground"
                    >
                      {inp}
                    </code>
                  ))}
                </div>
              </div>

              {/* Known Gap or Exceptions */}
              {activeInspectorRule.knownGap && (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/25 p-3.5 flex items-start gap-2.5">
                  <Info className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-1 text-xs text-amber-800 dark:text-amber-200">
                    <span className="font-bold block">Recorded Implementation Nuance:</span>
                    <p className="leading-relaxed">{activeInspectorRule.knownGap}</p>
                  </div>
                </div>
              )}

              {/* Solver Source Reference */}
              <div className="pt-3 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground font-mono">
                <span>Source: {activeInspectorRule.solverRef}</span>
                <span>Engine Layer: {activeInspectorRule.layer}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default V8RulesTable;
