import React from 'react';
import { cn } from '@/modules/core/lib/utils';
import { AlertTriangle, Lock, Info } from 'lucide-react';
import { Input } from '@/modules/core/ui/primitives/input';
import { EmploymentTypeDropdown, STANDARD_EMPLOYMENT_TYPES } from '../../EmploymentTypeDropdown';
import { RemunerationLevelPicker, type RemunerationLevelRow } from '../RemunerationLevelPicker';
import { MAX_CONTRACTED_WEEKLY_HOURS } from '../../../../domain/contractHoursCeiling';
import {
    EXCLUSION_REASON_LABELS,
    PAY_BASIS_LABELS,
    formatBand,
    type EbaExclusionReason,
    type PayBasis,
    type PayIssue,
    type PayQuote,
    type RoleBand,
} from '../../../../domain/contractPayTerms';
import { FLEXIBLE_PT_ANNUAL_HOURS_MIN, FLEXIBLE_PT_ANNUAL_HOURS_MAX } from '../../../hooks/useContractForm';
import { FULL_TIME_WEEKLY_HOURS, type ContractClass, type HoursRule } from '../../../hooks/useContractWizardForm';

const PAY_BASIS_HINTS: Record<PayBasis, string> = {
    eba_level: 'Paid the EA rate for a level · Sch 2 §1',
    eba_security_annualised: 'Full-Time Security, L3–L6 · Sch 2 §2',
    salary: 'Outside the EA · cl 2.2',
};

const fieldLabel = 'text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 pl-1';

const fmtHours = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const CLASS_1_TYPES = STANDARD_EMPLOYMENT_TYPES
    .filter(t => t.id !== 'Casual')
    .map(t => t.id === 'Part-Time' ? { ...t, description: 'Under 38h/wk' } : t);

export interface Step3EmploymentTermsProps {
    contractClass: ContractClass | null;
    employment_status: string;
    contracted_weekly_hours: number;
    annual_guaranteed_hours: number;
    remuneration_level: number | '';
    remLevels: RemunerationLevelRow[];
    onEmploymentStatusChange: (status: string) => void;
    onHoursChange: (patch: { contracted_weekly_hours?: number; annual_guaranteed_hours?: number }) => void;
    onLevelChange: (level: number) => void;
    hoursRule: HoursRule | null;
    existingWeeklyHours: number;
    isCeilingExceeded: boolean;
    ceilingProposedTotal: number;
    mixedPermanentConflict: string | null;

    // ── Pay ──
    pay_basis: PayBasis;
    allowedPayBases: PayBasis[];
    onPayBasisChange: (basis: PayBasis) => void;
    band: RoleBand | null;
    /** Levels on offer (annualised Security: 3–6); undefined = all. */
    allowedLevels?: readonly number[];
    rateFor: (level: number) => string | null;
    quote: PayQuote | null;
    levelOutsideBand: boolean;
    level_note: string;
    onLevelNoteChange: (note: string) => void;
    annual_salary: number;
    onAnnualSalaryChange: (amount: number) => void;
    eba_exclusion_reason: EbaExclusionReason | '';
    onExclusionReasonChange: (reason: EbaExclusionReason) => void;
    payErrors: PayIssue[];
    payWarnings: PayIssue[];

    // ── cl 13 multi-hire ──
    isMultiHire: boolean;
    multi_hire_request_ref: string;
    onMultiHireRefChange: (ref: string) => void;
}

export const Step3EmploymentTerms: React.FC<Step3EmploymentTermsProps> = ({
    contractClass, employment_status, contracted_weekly_hours, annual_guaranteed_hours,
    remuneration_level, remLevels,
    onEmploymentStatusChange, onHoursChange, onLevelChange,
    hoursRule, existingWeeklyHours, isCeilingExceeded, ceilingProposedTotal, mixedPermanentConflict,
    pay_basis, allowedPayBases, onPayBasisChange, band, allowedLevels, rateFor, quote,
    levelOutsideBand, level_note, onLevelNoteChange,
    annual_salary, onAnnualSalaryChange, eba_exclusion_reason, onExclusionReasonChange,
    payErrors, payWarnings,
    isMultiHire, multi_hire_request_ref, onMultiHireRefChange,
}) => {
    const isCasual = contractClass === 2;
    const isFullTime = employment_status === 'Full-Time';
    const isFlexible = employment_status === 'Flexible Part-Time';
    const isRuleInvalid = !!hoursRule && !hoursRule.valid;

    return (
        <div className="max-w-xl mx-auto w-full space-y-6">
            <div className="text-center mb-1">
                <span className="text-[10px] font-black tracking-[0.25em] uppercase text-primary bg-primary/10 px-3.5 py-1 rounded-full border border-primary/20">
                    Employment & Compensation
                </span>
            </div>

            {/* Employment Type */}
            <div className="flex flex-col gap-1.5 w-full">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 pl-1">
                    Employment Type
                </span>
                {isCasual ? (
                    <div className="h-14 px-4 rounded-xl border border-border bg-muted/20 flex items-center text-sm font-semibold text-foreground">
                        Casual — Hourly / No min
                    </div>
                ) : (
                    <EmploymentTypeDropdown
                        value={employment_status}
                        onChange={onEmploymentStatusChange}
                        options={CLASS_1_TYPES}
                        widthClassName="w-full"
                        ariaLabel="Employment type"
                    />
                )}
            </div>

            {/* Contracted Hours & Cadence */}
            <div className="flex flex-col gap-1.5 w-full">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 pl-1">
                    Contracted Hours
                </span>
                {isCasual ? (
                    <div className="h-14 px-4 rounded-xl border border-border bg-muted/20 flex items-center text-sm font-semibold text-muted-foreground">
                        N/A — priced by Remuneration Level below
                    </div>
                ) : !employment_status ? (
                    <div className="h-14 px-4 rounded-xl border border-dashed border-border bg-muted/10 flex items-center text-sm text-muted-foreground">
                        Choose an employment type first
                    </div>
                ) : isFullTime ? (
                    <div className="flex items-center gap-3">
                        <div className="h-14 flex-1 px-4 rounded-xl border border-border bg-muted/20 flex items-center justify-between text-lg font-bold tabular-nums text-foreground">
                            {FULL_TIME_WEEKLY_HOURS}
                            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                <Lock className="w-3 h-3" /> Fixed · cl 12.2(b)
                            </span>
                        </div>
                        <span className="text-xs font-black px-3 py-2 rounded-full bg-primary/10 text-primary border border-primary/20 shrink-0">
                            /week
                        </span>
                    </div>
                ) : (
                    <div className="flex items-center gap-3">
                        <Input
                            type="number"
                            inputMode="decimal"
                            aria-label={`Contracted ${isFlexible ? 'annual' : 'weekly'} hours`}
                            min={isFlexible ? FLEXIBLE_PT_ANNUAL_HOURS_MIN : 0}
                            max={isFlexible ? FLEXIBLE_PT_ANNUAL_HOURS_MAX : MAX_CONTRACTED_WEEKLY_HOURS}
                            aria-invalid={isRuleInvalid || isCeilingExceeded}
                            value={isFlexible ? annual_guaranteed_hours : contracted_weekly_hours}
                            onChange={(e) => onHoursChange(isFlexible
                                ? { annual_guaranteed_hours: parseFloat(e.target.value) || 0 }
                                : { contracted_weekly_hours: parseFloat(e.target.value) || 0 })}
                            className={cn(
                                "h-14 flex-1 text-lg tabular-nums font-bold rounded-xl border bg-background text-foreground border-input",
                                "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                                "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:border-primary",
                                isRuleInvalid && "border-destructive/60",
                            )}
                        />
                        <span className="text-xs font-black px-3 py-2 rounded-full bg-primary/10 text-primary border border-primary/20 shrink-0">
                            {isFlexible ? '/year' : '/week'}
                        </span>
                    </div>
                )}
                {hoursRule && (
                    <span className="text-[11px] text-muted-foreground pl-1">
                        {hoursRule.label}: {hoursRule.limitText} h{hoursRule.cadence} ({hoursRule.clause})
                        {existingWeeklyHours > 0 && ` · already contracted ${fmtHours(existingWeeklyHours)}h/wk on other permanent contracts`}
                    </span>
                )}
            </div>

            {/* Pay basis — how this contract is paid */}
            <div className="flex flex-col gap-1.5 w-full">
                <span className={fieldLabel}>Pay</span>
                {allowedPayBases.length > 1 ? (
                    <div role="radiogroup" aria-label="Pay basis" className="grid grid-cols-2 gap-2">
                        {allowedPayBases.map(basis => (
                            <button
                                key={basis}
                                type="button"
                                role="radio"
                                aria-checked={pay_basis === basis}
                                onClick={() => onPayBasisChange(basis)}
                                className={cn(
                                    "min-h-14 px-4 py-2.5 rounded-xl border text-left transition-all",
                                    pay_basis === basis
                                        ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                                        : "border-border bg-background hover:bg-muted/40",
                                )}
                            >
                                <span className="block text-sm font-bold text-foreground">{PAY_BASIS_LABELS[basis]}</span>
                                <span className="block text-[11px] text-muted-foreground">{PAY_BASIS_HINTS[basis]}</span>
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className="min-h-14 px-4 py-2.5 rounded-xl border border-border bg-muted/20 flex flex-col justify-center">
                        <span className="text-sm font-semibold text-foreground">{PAY_BASIS_LABELS[pay_basis]}</span>
                        <span className="text-[11px] text-muted-foreground">
                            {isCasual
                                ? 'A casual is always paid at an EA level · Sch 2 §1'
                                : PAY_BASIS_HINTS[pay_basis]}
                        </span>
                    </div>
                )}
            </div>

            {pay_basis === 'salary' ? (
                <>
                    {/* Salary — outside the EA */}
                    <div className="flex flex-col gap-1.5 w-full">
                        <span className={fieldLabel}>Annual Salary</span>
                        <div className="flex items-center gap-3">
                            <Input
                                type="number"
                                inputMode="decimal"
                                min={0}
                                aria-label="Annual salary in dollars"
                                value={annual_salary > 0 ? annual_salary : ''}
                                onChange={(e) => onAnnualSalaryChange(parseFloat(e.target.value) || 0)}
                                placeholder="e.g. 95000"
                                className={cn(
                                    "h-14 flex-1 text-lg tabular-nums font-bold rounded-xl border bg-background text-foreground border-input",
                                    "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                                    "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:border-primary",
                                )}
                            />
                            <span className="text-xs font-black px-3 py-2 rounded-full bg-primary/10 text-primary border border-primary/20 shrink-0">
                                /year
                            </span>
                        </div>
                    </div>

                    <div className="flex flex-col gap-1.5 w-full">
                        <span className={fieldLabel}>Why it is outside the EA</span>
                        <div role="radiogroup" aria-label="Reason the contract is outside the EA" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {(Object.keys(EXCLUSION_REASON_LABELS) as EbaExclusionReason[]).map(reason => (
                                <button
                                    key={reason}
                                    type="button"
                                    role="radio"
                                    aria-checked={eba_exclusion_reason === reason}
                                    onClick={() => onExclusionReasonChange(reason)}
                                    className={cn(
                                        "min-h-11 px-4 py-2 rounded-xl border text-left text-sm font-semibold transition-all",
                                        eba_exclusion_reason === reason
                                            ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary/30"
                                            : "border-border bg-background text-muted-foreground hover:bg-muted/40",
                                    )}
                                >
                                    {EXCLUSION_REASON_LABELS[reason]}
                                </button>
                            ))}
                        </div>
                    </div>
                </>
            ) : (
                <div className="flex flex-col gap-1.5 w-full">
                    {/* Remuneration Level — independent of the role; the role's band is guidance */}
                    <RemunerationLevelPicker
                        value={remuneration_level}
                        onChange={onLevelChange}
                        levels={remLevels}
                        allowedLevels={allowedLevels}
                        band={band}
                        rateFor={rateFor}
                    />
                    <span className="text-[11px] text-muted-foreground pl-1">
                        {formatBand(band)
                            ? `This role's EA range: ${formatBand(band)} (Schedule 1). Another level is allowed with a note.`
                            : 'No EA range is set for this role — any level is allowed.'}
                    </span>
                    {levelOutsideBand && (
                        <div className="flex flex-col gap-1.5 mt-2">
                            <span className={fieldLabel}>Why this level</span>
                            <Input
                                aria-label="Why this level is outside the role's range"
                                value={level_note}
                                onChange={(e) => onLevelNoteChange(e.target.value)}
                                placeholder="e.g. Still completing the Level 6 competencies"
                                className="h-12 rounded-xl"
                            />
                        </div>
                    )}
                </div>
            )}

            {quote && (
                <div className="px-4 py-3 rounded-xl border border-border bg-muted/20 flex items-baseline justify-between gap-3">
                    <span className="text-lg font-bold tabular-nums text-foreground">{quote.headline}</span>
                    <span className="text-[11px] text-muted-foreground text-right">{quote.detail}</span>
                </div>
            )}

            {/* cl 13 — a casual engagement beside a permanent one */}
            {isMultiHire && (
                <div className="flex flex-col gap-1.5 w-full p-4 rounded-2xl border border-border bg-muted/20">
                    <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <Info className="w-4 h-4 text-primary shrink-0" />
                        Multi-hire engagement · cl 13
                    </span>
                    <span className="text-xs text-muted-foreground">
                        This person already holds a permanent contract, so this casual engagement is a multi-hire:
                        work outside their usual job, requested by them on a Request to Multi-Hire form.
                    </span>
                    <Input
                        aria-label="Request to Multi-Hire form reference"
                        value={multi_hire_request_ref}
                        onChange={(e) => onMultiHireRefChange(e.target.value)}
                        placeholder="Request to Multi-Hire reference"
                        className="h-12 rounded-xl mt-1"
                    />
                </div>
            )}

            {payWarnings.length > 0 && (
                <div className="p-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 flex items-start gap-3 text-amber-700 dark:text-amber-300 text-xs font-medium">
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                    <div className="space-y-1 text-left">
                        {payWarnings.map(w => <p key={w.message}>{w.message} <span className="opacity-70">({w.clause})</span></p>)}
                    </div>
                </div>
            )}

            {payErrors.length > 0 && (
                <div className="p-4 rounded-2xl border border-border bg-muted/20 text-xs text-muted-foreground">
                    <p className="font-bold text-foreground mb-1">Before you continue</p>
                    <ul className="space-y-0.5 list-disc list-inside">
                        {payErrors.map(e => <li key={e.message}>{e.message} <span className="opacity-70">({e.clause})</span></li>)}
                    </ul>
                </div>
            )}

            {(isRuleInvalid || isCeilingExceeded || mixedPermanentConflict) && (
                <div className="p-4 rounded-2xl border border-destructive/40 bg-destructive/10 flex items-center gap-3 text-destructive text-xs font-medium">
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                    <div className="space-y-0.5 text-left">
                        {isRuleInvalid && <p>{hoursRule!.message}</p>}
                        {isCeilingExceeded && (
                            <p>Combined contracted hours would total {fmtHours(ceilingProposedTotal)}h/week across this person's permanent contracts, over the {MAX_CONTRACTED_WEEKLY_HOURS}h weekly ceiling.</p>
                        )}
                        {mixedPermanentConflict && <p>{mixedPermanentConflict}</p>}
                    </div>
                </div>
            )}
        </div>
    );
};

export default Step3EmploymentTerms;
