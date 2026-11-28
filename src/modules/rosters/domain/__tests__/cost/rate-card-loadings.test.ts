/**
 * rate-card-loadings.test.ts — DB seed ⇄ TS loadings drift guard + custom card
 * loadings verification across both client engines (`standard.ts`, `security.ts`)
 * and `min-engagement-floor.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ICC_SYDNEY_EA_LOADINGS,
  mapDbLoadingsRow,
  type RateCardLoadings,
} from '../../projections/utils/cost/loadings';
import { estimateDetailedShiftCost as estimateStandard } from '../../projections/utils/cost/standard';
import { estimateDetailedShiftCost as estimateSecurity } from '../../projections/utils/cost/security';
import { resolvePaymentMinEngagementMinutes } from '../../projections/utils/cost/min-engagement-floor';
import { buildAwardContext } from '../../projections/utils/cost/award-context';

const REPO_ROOT = resolve(__dirname, '../../../../../..');

/** Parse every `public.pay_rate_card_loadings` JSON payload out of reference.sql. */
function parseSeedLoadings(): Array<Record<string, unknown>> {
  const seed = readFileSync(resolve(REPO_ROOT, 'supabase/seeds/reference.sql'), 'utf8');
  const rows: Array<Record<string, unknown>> = [];
  const re =
    /^INSERT INTO public\.pay_rate_card_loadings .*?jsonb_populate_record\(NULL::public\.pay_rate_card_loadings, '(.*)'\) ON CONFLICT DO NOTHING;$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(seed)) !== null) {
    rows.push(JSON.parse(m[1].replace(/''/g, "'")));
  }
  return rows;
}

const CUSTOM_LOADINGS: RateCardLoadings = {
  ...ICC_SYDNEY_EA_LOADINGS,
  saturdayLoading: 0.40,
  nightLoadingMonThu: 0.30,
  annualLeaveLoading: 0.20,
  overtimeFirstHours: 2,
  overtimeFirstMultiplier: 1.75,
  overtimeAfterMultiplier: 2.25,
  overtimePublicHolidayMultiplier: 3.0,
  ordinaryDailyCapHours: 10,
  securityOrdinaryCapHours: 10,
  minEngagementMinutes: 240,
  minEngagementSundayMinutes: 300,
  minEngagementPublicHolidayMinutes: 300,
  minEngagementTrainingMinutes: 150,
  higherDutiesMinHours: 5,
  mealAllowanceTriggerHours: 1.5,
};

describe('pay_rate_card_loadings — DB seed ⇄ TS drift guard', () => {
  it('ICC_SYDNEY_EA_LOADINGS matches every seeded ICC card row in reference.sql', () => {
    const rows = parseSeedLoadings();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(mapDbLoadingsRow(row)).toEqual(ICC_SYDNEY_EA_LOADINGS);
    }
  });
});

describe('client engines read numeric loadings from the rate card', () => {
  it('standard.ts prices Saturday penalty, night, min engagement, higher duties, OT, PH OT and meal from card loadings', () => {
    // Same scenarios as supabase/tests/pay/02_rate_card_loadings.sql (exact SQL ⇄ TS parity):
    // a) Casual Saturday 7h at $34.64/h (ord $27.712): +25% vs +40%
    const satIcc = estimateStandard({
      shift_date: '2027-07-10', start_time: '07:00', end_time: '14:00',
      netMinutes: 420, scheduled_length_minutes: 420, rate: 34.64,
      employmentType: 'Casual', is_overnight: false, is_cancelled: false,
    });
    const satCustom = estimateStandard({
      shift_date: '2027-07-10', start_time: '07:00', end_time: '14:00',
      netMinutes: 420, scheduled_length_minutes: 420, rate: 34.64,
      employmentType: 'Casual', is_overnight: false, is_cancelled: false,
      loadings: CUSTOM_LOADINGS,
    });
    expect(satIcc.totalCost).toBe(290.98);
    expect(satCustom.totalCost).toBe(320.07); // 7 * 27.712 * (1.25 + 0.40) = 320.0736

    // b) FT Mon-Thu night 22:00-05:30 (7.5h) at $32.39/h: +20% vs +30%
    const nigIcc = estimateStandard({
      shift_date: '2027-07-06', start_time: '22:00', end_time: '05:30',
      netMinutes: 450, scheduled_length_minutes: 450, rate: 32.39,
      employmentType: 'Full-Time', is_overnight: true, is_cancelled: false,
    });
    const nigCustom = estimateStandard({
      shift_date: '2027-07-06', start_time: '22:00', end_time: '05:30',
      netMinutes: 450, scheduled_length_minutes: 450, rate: 32.39,
      employmentType: 'Full-Time', is_overnight: true, is_cancelled: false,
      loadings: CUSTOM_LOADINGS,
    });
    expect(nigIcc.totalCost).toBe(291.51);    // 7.5 * 32.39 * 1.20
    expect(nigCustom.totalCost).toBe(315.8);  // 7.5 * 32.39 * 1.30 = 315.8025

    // c) Short Casual weekday 1h at $34.64/h: 3h floor vs 4h floor
    const minIcc = estimateStandard({
      shift_date: '2027-07-06', start_time: '09:00', end_time: '10:00',
      netMinutes: 60, scheduled_length_minutes: 60, rate: 34.64,
      employmentType: 'Casual', is_overnight: false, is_cancelled: false,
    });
    const minCustom = estimateStandard({
      shift_date: '2027-07-06', start_time: '09:00', end_time: '10:00',
      netMinutes: 60, scheduled_length_minutes: 60, rate: 34.64,
      employmentType: 'Casual', is_overnight: false, is_cancelled: false,
      loadings: CUSTOM_LOADINGS,
    });
    expect(minIcc.totalCost).toBe(103.92);    // 3 * 34.64
    expect(minCustom.totalCost).toBe(138.56); // 4 * 34.64

    // d) Higher duties 3h casual weekday (L4 -> L6 $43.12/h): 4h floor vs 5h floor
    const hdIcc = estimateStandard({
      shift_date: '2027-07-06', start_time: '09:00', end_time: '12:00',
      netMinutes: 180, scheduled_length_minutes: 180, rate: null,
      classificationLevel: 'LEVEL_4', higherDutiesLevel: 'LEVEL_6',
      employmentType: 'Casual', is_overnight: false, is_cancelled: false,
    });
    const hdCustom = estimateStandard({
      shift_date: '2027-07-06', start_time: '09:00', end_time: '12:00',
      netMinutes: 180, scheduled_length_minutes: 180, rate: null,
      classificationLevel: 'LEVEL_4', higherDutiesLevel: 'LEVEL_6',
      employmentType: 'Casual', is_overnight: false, is_cancelled: false,
      loadings: CUSTOM_LOADINGS,
    });
    expect(hdIcc.totalCost).toBe(172.48);     // 4 * 43.12
    expect(hdCustom.totalCost).toBe(215.6);   // 5 * 43.12

    // e) FT weekday 11h worked vs 8h scheduled (3h OT) at $32.39/h:
    //    ICC: 8*32.39 + 3*1.5*32.39 + 14.30 = 419.175 -> 419.18
    //    Custom: 8*32.39 + (2*1.75 + 1*2.25)*32.39 + 14.30 = 459.6625 -> 459.66
    const otIcc = estimateStandard({
      shift_date: '2027-07-06', start_time: '08:00', end_time: '19:00',
      netMinutes: 660, scheduled_length_minutes: 480, rate: 32.39,
      employmentType: 'Full-Time', is_overnight: false, is_cancelled: false,
    });
    const otCustom = estimateStandard({
      shift_date: '2027-07-06', start_time: '08:00', end_time: '19:00',
      netMinutes: 660, scheduled_length_minutes: 480, rate: 32.39,
      employmentType: 'Full-Time', is_overnight: false, is_cancelled: false,
      loadings: CUSTOM_LOADINGS,
    });
    expect(otIcc.totalCost).toBe(419.18);
    expect(otCustom.totalCost).toBe(459.66);

    // f) FT Public Holiday (2027-10-04 NSW Labour Day) 9.5h vs 8h scheduled (1.5h OT):
    //    ICC: 8*32.39*2.5 + 1.5*32.39*2.5 = 769.2625 -> 769.26 (no meal: 1.5 < 2.0)
    //    Custom: 8*32.39*2.5 + 1.5*32.39*3.0 + 14.30 = 807.855
    //    (IEEE-754 represents 807.855*100 as 80785.49999999999 -> 807.85; SQL NUMERIC rounds to 807.86)
    const phIcc = estimateStandard({
      shift_date: '2027-10-04', start_time: '08:00', end_time: '17:30',
      netMinutes: 570, scheduled_length_minutes: 480, rate: 32.39,
      employmentType: 'Full-Time', is_overnight: false, is_cancelled: false,
    });
    const phCustom = estimateStandard({
      shift_date: '2027-10-04', start_time: '08:00', end_time: '17:30',
      netMinutes: 570, scheduled_length_minutes: 480, rate: 32.39,
      employmentType: 'Full-Time', is_overnight: false, is_cancelled: false,
      loadings: CUSTOM_LOADINGS,
    });
    expect(phIcc.totalCost).toBe(769.26);
    expect(phCustom.totalCost).toBe(807.85);

    // g) Annual leave loading: 17.5% vs 20%
    const leaveIcc = estimateStandard({
      shift_date: '2027-07-06', start_time: '08:00', end_time: '16:00',
      netMinutes: 480, scheduled_length_minutes: 480, rate: 32.39,
      employmentType: 'Full-Time', is_overnight: false, is_cancelled: false,
      isAnnualLeave: true,
    });
    const leaveCustom = estimateStandard({
      shift_date: '2027-07-06', start_time: '08:00', end_time: '16:00',
      netMinutes: 480, scheduled_length_minutes: 480, rate: 32.39,
      employmentType: 'Full-Time', is_overnight: false, is_cancelled: false,
      isAnnualLeave: true,
      loadings: CUSTOM_LOADINGS,
    });
    expect(leaveIcc.totalCost).toBe(304.47);   // 8 * 32.39 * 1.175
    expect(leaveCustom.totalCost).toBe(310.94); // 8 * 32.39 * 1.20
  });

  it('security.ts reads securityOrdinaryCapHours, overtime tiers, penalties and higherDutiesMinHours from loadings', () => {
    // Annualised FT Security L4 ($36.39/h, ord $30.26/h) 12h shift:
    // ICC cap 12h: 12 * 36.39 = 436.68
    // Custom cap 10h + 2h OT at 1.75x: 10 * 36.39 + 2 * 30.26 * 1.75 = 363.90 + 105.91 = 469.81
    const secIcc = estimateSecurity({
      shift_date: '2027-07-06', start_time: '07:00', end_time: '19:00',
      netMinutes: 720, scheduled_length_minutes: 720, rate: 36.39,
      employmentType: 'Full-Time', isSecurityRole: true, is_overnight: false, is_cancelled: false,
    });
    const secCustom = estimateSecurity({
      shift_date: '2027-07-06', start_time: '07:00', end_time: '19:00',
      netMinutes: 720, scheduled_length_minutes: 720, rate: 36.39,
      employmentType: 'Full-Time', isSecurityRole: true, is_overnight: false, is_cancelled: false,
      loadings: CUSTOM_LOADINGS,
    });
    expect(secIcc.totalCost).toBe(436.68);
    expect(secCustom.totalCost).toBe(469.81);
  });

  it('propagates AwardContext.loadings and lets options.loadings override it', () => {
    const ctx = buildAwardContext(['2027-07-10'], CUSTOM_LOADINGS);
    const viaCtx = estimateStandard({
      shift_date: '2027-07-10', start_time: '07:00', end_time: '14:00',
      netMinutes: 420, scheduled_length_minutes: 420, rate: 34.64,
      employmentType: 'Casual', is_overnight: false, is_cancelled: false,
    }, ctx);
    expect(viaCtx.totalCost).toBe(320.07);

    const overridden = estimateStandard({
      shift_date: '2027-07-10', start_time: '07:00', end_time: '14:00',
      netMinutes: 420, scheduled_length_minutes: 420, rate: 34.64,
      employmentType: 'Casual', is_overnight: false, is_cancelled: false,
      loadings: ICC_SYDNEY_EA_LOADINGS,
    }, ctx);
    expect(overridden.totalCost).toBe(290.98);
  });

  it('min-engagement-floor uses custom engagement minutes from loadings', () => {
    expect(resolvePaymentMinEngagementMinutes({
      employmentType: 'Casual', isTraining: true, loadings: CUSTOM_LOADINGS,
    })).toBe(150);
    expect(resolvePaymentMinEngagementMinutes({
      employmentType: 'Casual', isSunday: true, loadings: CUSTOM_LOADINGS,
    })).toBe(300);
    expect(resolvePaymentMinEngagementMinutes({
      employmentType: 'Part-Time', isPublicHoliday: true, loadings: CUSTOM_LOADINGS,
    })).toBe(300);
    expect(resolvePaymentMinEngagementMinutes({
      employmentType: 'Casual', loadings: CUSTOM_LOADINGS,
    })).toBe(240);
  });
});
