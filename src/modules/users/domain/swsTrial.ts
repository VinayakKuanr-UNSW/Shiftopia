/**
 * SWS 12-week trial period (Schedule 6 §1.10, audit M-3).
 *
 * A Supported Wage System trial period is capped at 12 weeks. Before this fix
 * the cap was only a UI text label (`AddContractDialog.tsx`) — nothing
 * computed elapsed weeks or flagged an overrun, and `sws_trial_start_date`
 * was persisted but never actually editable in the form.
 */

const TRIAL_CAP_WEEKS = 12;
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

export interface SwsTrialInput {
  isSws: boolean | null | undefined;
  isSwsTrial: boolean | null | undefined;
  swsTrialStartDate: string | null | undefined; // YYYY-MM-DD
}

export interface SwsTrialStatus {
  /** True only when this is an active SWS trial (not a permanent SWS rate). */
  onTrial: boolean;
  /** Whole weeks elapsed since the trial started, as of `asOf`. */
  weeksElapsed: number;
  /** The date the 12-week cap is reached. Null when no start date is set. */
  capReachedOn: Date | null;
  /** True once the trial has run 12 weeks or longer (Sch 6 §1.10). */
  overrun: boolean;
}

/** Resolve SWS trial-period status for a single contract. Pure — pass `asOf` in tests. */
export function getSwsTrialStatus(input: SwsTrialInput, asOf: Date = new Date()): SwsTrialStatus {
  const onTrial = !!input.isSws && !!input.isSwsTrial;
  if (!onTrial || !input.swsTrialStartDate) {
    return { onTrial, weeksElapsed: 0, capReachedOn: null, overrun: false };
  }

  const start = new Date(input.swsTrialStartDate + 'T00:00:00');
  if (Number.isNaN(start.getTime())) {
    return { onTrial, weeksElapsed: 0, capReachedOn: null, overrun: false };
  }

  const capReachedOn = new Date(start.getTime() + TRIAL_CAP_WEEKS * MS_PER_WEEK);
  const weeksElapsed = Math.max(0, Math.floor((asOf.getTime() - start.getTime()) / MS_PER_WEEK));

  return {
    onTrial,
    weeksElapsed,
    capReachedOn,
    overrun: asOf >= capReachedOn,
  };
}
