# TOIL — time off in lieu

Code: [`src/modules/toil/`](../../../src/modules/toil/). Database: migrations
`20261010082231_toil_ledger.sql` and `20261010082717_toil_fmt_hours.sql`, both applied to production on 2026-10-10.

## Who earns TOIL

Only **salaried class-1 contracts** earn TOIL: Full-Time, Part-Time or Flexible Part-Time, paid by salary (`pay_basis = 'salary'`) on the shift's date.

| Contract | TOIL? | Why |
|---|---|---|
| Salaried FT / PT | **Yes** | Outside the EBA (cl 2.2). TOIL is how they are compensated for extra hours (decision 2026-10-08). |
| FT / PT / fPT on an EBA level | No | The ICC EBA 2025 has **no TOIL clause**. Its overtime is paid at 150% then 200% (cl 42.2), at the next pay date (cl 42.4), and the pay engine already does this. |
| FT Security, annualised | No | Sch 3 §4.2 pays its overtime too. |
| Casual (class 2) | No | Its hours come under the EBA and are paid. |

Eligibility is judged on **the contract the shift is linked to** (`shifts.user_contract_id`), not on the person.

Example: Kurry Admin holds a salaried FT EIS Specialist contract and a casual Event Setup Team Leader contract. Only shifts linked to the FT contract count. A casual shift on the same day neither earns TOIL nor counts towards the 7.6h.

The only way to give TOIL to someone on an EBA level is an individual flexibility arrangement under cl 18. It must leave them better off overall, which hour-for-hour TOIL in place of 150% pay does not. This is not built.

## How TOIL is earned

Both rules run over **approved** timesheets only, using **billable net** time.

Billable net is the same rule Gross Pay pays from (`timesheets/domain/billable-time.ts`):
- the manager-entered time, otherwise the clock time snapped to the nearest 15 minutes;
- minus the unpaid break;
- with no minimum-engagement top-up.

| Rule | Per | Formula |
|---|---|---|
| **Daily** | person-day | `max(0, Σ billable net − 7.6h)`. Two eligible shifts on one day are added together first. |
| **Weekly** | ISO week, Mon–Sun | `max(0, worked − required − the week's daily TOIL)`. `required` is 38h for FT, or contracted hours for PT. It is lowered by approved leave of any type (the hours spread over the request's weekdays) and by weekday public holidays not already covered by leave. |

The weekly rule picks up hours the daily rule can't see, such as a sixth-day shift: 5 × 7.6h + a 6h Saturday banks 6h.

Hours count hour for hour. Accrual is booked as:
- daily accruals on the work date;
- weekly top-ups on the Sunday that ends the week.

## How TOIL is used and paid out

| Event | Ledger entry | Notes |
|---|---|---|
| TOIL leave approved | `taken` (−) | `leave_requests.leave_type = 'toil'`. **It can't be taken before it is earned.** A request beyond what's available (balance − other pending TOIL) is refused, and so is an approval beyond the balance. Annual and personal leave, by contrast, may go negative. |
| TOIL leave revoked / rejected / hours changed | `taken_reversal` (+) or a further `taken` | Booked automatically by a trigger. |
| Employee asks for a payout | `payout` (−) | Available at any time, with no approval step: the employer must pay on request. A leave approver in scope can also pay out on the employee's behalf. |
| Not taken within 6 months | `expiry_payout` (−) | Run by the nightly job at 15:45 UTC. Taking TOIL uses the oldest hours first (FIFO), so expiry is per earned day or week. |
| No eligible contract any more | `termination_payout` (−) | Run by the nightly job: the whole balance is paid out. |
| Manual correction | `adjustment` (±) | Leave approvers only, never for their own TOIL. A reason is required, and the balance can't go below 0. |

Gross Pay prices payouts at the salary's hourly equivalent (`annual_salary / 52 / weekly hours`). If the contract is no longer salaried, it uses the permanent level rate instead.

Taking TOIL changes nothing on a salaried person's pay: it shows as a "Time in lieu taken" line, and the Salary line shrinks by the same amount.

TOIL for part of a day (for example, leaving 2h early) does **not** remove the rostered shift when it's approved. The approval message tells the manager to shorten the shift if the finish time changes.

## Data model

`public.toil_ledger` is **append-only**: a trigger refuses UPDATE, DELETE and TRUNCATE. Each entry:
- holds signed **minutes**, so the balance is a plain sum;
- links to its contract and leave request with `ON DELETE RESTRICT`. Deleting a sub-department cascades to its contracts, and that must not erase pay records.

A contract with TOIL history therefore can't be deleted. The Contracts section explains this when someone tries.

Accrual is computed **in the database**, by triggers on `timesheets`, `shifts` and `leave_requests`. It isn't done in the app because several paths approve timesheets (single, bulk, the leftover `sm_timesheet_auto_decide`), and a rule held in one caller is skipped by the others.

Each trigger recomputes the affected day and week, then writes the difference between the correct total and what has already been booked. Recomputing is therefore idempotent, and corrections appear as entries of their own.

| Object | Purpose |
|---|---|
| `internal.toil_billable_net_minutes` | SQL port of the billable rule. Pinned to the TypeScript by `toil/__tests__/billable-net-parity.test.ts`, using goldens captured from production. |
| `internal.toil_recompute_day` / `_week` | The two accrual rules. |
| `internal.trg_toil_leave_guard` | Refuses a TOIL request without a salaried contract or without enough hours. |
| `public.get_toil_balances(uuid[])` | Balance, held, available, totals and next expiry for each person. People the caller may not see are skipped. |
| `public.get_toil_lots(uuid)` | What is left of each earned day or week, and its expiry date. |
| `public.toil_request_payout`, `public.toil_adjust` | The only two direct writes. Both are guarded. |
| `public.toil_process_expiries()` | The nightly job. It can't be called by app users. |

**Who can see what.** Employees can read their own ledger. Anyone with `leave.view` or `timesheet.approve` in scope can read others'. There is no client write policy at all.

## Screens

Screens show hours only. Money appears on Gross Pay and nowhere else.

- **My Leave**: a TOIL card showing balance, held and available hours, and the next hours due to expire. "Request" takes TOIL; hours can be edited for part of a day, and a request is blocked past what's available. "History" opens the TOIL ledger, where the employee can ask for a payout.
- **Leave Approvals**: a TOIL column in the Grid. Review blocks approval past the balance. An employee's ledger opens their TOIL history, with Pay out and Adjust.
- **Timesheets**: a "+0.4h TOIL" badge on approved rows whose day earned TOIL under the daily rule.
- **Gross Pay**: `toil_taken` and `toil_payout` lines. The "time in lieu" hours for a period come from the ledger, replacing the old worked − contracted figure.
- **Contract wizard**: a salaried contract states that extra hours become TOIL, not overtime pay.

## Fixed alongside

- **Unpaid break dropped on approval.** A timesheet row created by approval never copied the shift's unpaid break. The column defaults to 0, so Gross Pay paid the break as worked time. The row now copies the shift's break. Test: `timesheets/api/__tests__/updateTimesheetEntry.unpaid-break.test.ts`.
- **Wrong contract for leave pay.** Leave pricing picked arbitrarily between two contracts that started on the same day. For someone with a permanent and a casual contract, landing on the casual one priced every leave day at $0. It now prefers the permanent contract (`pickLeaveContracts`).
- **Public holiday paid twice for salaried staff.** A public holiday inside a salaried person's approved leave was paid on top of the full salary. A week of annual leave with one holiday paid $2,192.30 instead of $1,826.92. `buildPublicHolidayInputs` now carries the pay basis, so the day is paid inside the salary.

## Known limits

- The weekly rule counts **ISO weeks**, not the contract's 1–4-week ordinary-hours cycle.
- Expiry pays out hours even when a pending TOIL request would have used them.
- Accrual follows the contract's effective-dated pay terms. However, an `employment_status` changed in place (which isn't effective-dated) doesn't re-run old days.
- There is no in-app way to end a contract (give it an end date). Until there is, a termination payout happens only when an administrator ends the contract in the database.
