/**
 * Time off in lieu, for Gross Pay — the two things the TOIL ledger
 * (`toil_ledger`, modules/toil) contributes to a pay period:
 *
 *   PAYOUTS   `payout` (asked for), `expiry_payout` (not taken within 6 months)
 *             and `termination_payout` (no salaried contract any more) — each
 *             becomes a `toil_payout` earnings line in the period it is
 *             effective, priced hour for hour at the contract's salary hourly
 *             equivalent (decision 2026-10-10; a contract no longer salaried is
 *             priced at its permanent level rate).
 *   EARNED    `accrual` + `weekly_topup` effective in the period — the "time in
 *             lieu" hours shown against a salaried person's period. Hours only.
 *
 * TOIL TAKEN is not here: it is leave (`leave_type = 'toil'`) and is priced by
 * `leaveGrossPay.ts` like any other leave day.
 *
 * Reads are RLS-scoped to people the viewer may see (leave.view /
 * timesheet.approve in scope). A failed read prices no TOIL and says so in the
 * console rather than failing the whole pay run.
 */
import { supabase } from '@/platform/supabase/client';
import { resolveRateSet } from '../../rosters/domain/projections/utils/cost/rate-schedule';
import { toilPayoutHourlyRate } from '@/modules/toil/domain/toil-rules';
import type { GrossPayShiftInput } from '../domain/computeShiftGrossPay';

export interface ToilFetchBounds {
    periodStart: string;
    periodEnd: string;
    orgIds?: string[];
    deptIds?: string[];
    subDeptIds?: string[];
}

export interface ToilPeriodFacts {
    /** One input per payout entry — `computeShiftGrossPay` prices it as a `toil_payout` line. */
    payoutInputs: GrossPayShiftInput[];
    /** Hours earned in the period, per employee (net of corrections). */
    accruedHoursByEmployee: Map<string, number>;
}

const PAYOUT_WORDING: Record<string, string> = {
    payout: 'Time in lieu paid out (on request)',
    expiry_payout: 'Time in lieu paid out (not taken within 6 months)',
    termination_payout: 'Time in lieu paid out (salaried contract ended)',
};

/** The permanent ordinary rate of a level on a date (Level 0 is the trainee rate). */
function permanentLevelRate(level: number | null, onDate: string): number | null {
    if (level == null) return null;
    const key = level === 0 ? 'TRAINEE' : `LEVEL_${level}`;
    const rates = (resolveRateSet(onDate).wageRates as Record<string, { permanent: number } | undefined>)[key];
    return rates?.permanent ?? null;
}

export function payoutInputFromEntry(
    entry: { id: string; employee_id: string; entry_type: string; minutes: number; effective_date: string },
    contract: {
        pay_basis?: string | null;
        annual_salary?: number | string | null;
        contracted_weekly_hours?: number | string | null;
        employment_status?: string | null;
        remuneration_level?: number | null;
    } | undefined,
): GrossPayShiftInput {
    const date = String(entry.effective_date).slice(0, 10);
    const rate = toilPayoutHourlyRate({
        payBasis: contract?.pay_basis ?? null,
        annualSalary: contract?.annual_salary != null ? Number(contract.annual_salary) : null,
        contractedWeeklyHours: contract?.contracted_weekly_hours != null ? Number(contract.contracted_weekly_hours) : null,
        employmentStatus: contract?.employment_status ?? null,
        permanentLevelRate: permanentLevelRate(contract?.remuneration_level ?? null, date),
    });
    return {
        shiftId: `toil-payout:${entry.id}`,
        employeeId: entry.employee_id,
        shiftDate: date,
        netMinutes: Math.abs(Number(entry.minutes) || 0),
        rate,
        hoursSource: 'actual',
        isToilPayout: true,
        toilPayoutDescription: PAYOUT_WORDING[entry.entry_type] ?? PAYOUT_WORDING.payout,
    };
}

export async function getToilPeriodFacts(bounds: ToilFetchBounds): Promise<ToilPeriodFacts> {
    const empty: ToilPeriodFacts = { payoutInputs: [], accruedHoursByEmployee: new Map() };
    const { data: entries, error } = await (supabase as any)
        .from('toil_ledger')
        .select('id, employee_id, user_contract_id, entry_type, minutes, effective_date')
        .in('entry_type', ['accrual', 'weekly_topup', 'payout', 'expiry_payout', 'termination_payout'])
        .gte('effective_date', bounds.periodStart)
        .lte('effective_date', bounds.periodEnd);
    if (error) {
        console.error('[toilGrossPay] toil_ledger query error:', error);
        return empty;
    }
    if (!entries || entries.length === 0) return empty;

    // Scope and price from the contract each entry was booked against.
    const contractIds = Array.from(new Set(entries.map((e: any) => e.user_contract_id).filter(Boolean)));
    const { data: contracts, error: cErr } = await (supabase as any)
        .from('user_contracts')
        .select('id, organization_id, department_id, sub_department_id, pay_basis, annual_salary, contracted_weekly_hours, employment_status, remuneration_level')
        .in('id', contractIds);
    if (cErr) {
        console.error('[toilGrossPay] user_contracts query error:', cErr);
        return empty;
    }
    const byId = new Map<string, any>((contracts ?? []).map((c: any) => [c.id, c]));
    const inScope = (c: any): boolean => {
        if (!c) return false;
        if (bounds.subDeptIds?.length) return bounds.subDeptIds.includes(c.sub_department_id);
        if (bounds.deptIds?.length) return bounds.deptIds.includes(c.department_id);
        if (bounds.orgIds?.length) return bounds.orgIds.includes(c.organization_id);
        return true;
    };

    const out: ToilPeriodFacts = { payoutInputs: [], accruedHoursByEmployee: new Map() };
    for (const e of entries as any[]) {
        const contract = byId.get(e.user_contract_id);
        if (!inScope(contract)) continue;
        if (e.entry_type === 'accrual' || e.entry_type === 'weekly_topup') {
            out.accruedHoursByEmployee.set(
                e.employee_id,
                (out.accruedHoursByEmployee.get(e.employee_id) ?? 0) + Number(e.minutes) / 60,
            );
        } else {
            out.payoutInputs.push(payoutInputFromEntry(e, contract));
        }
    }
    return out;
}
