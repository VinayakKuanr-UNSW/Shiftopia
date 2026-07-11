/**
 * CPI rate-increase projection + export (Phase-2 rate admin).
 *
 * The load-bearing property is PARITY: projecting a CPI increase over the DB
 * rate rows must round each value exactly the way the cost engine's
 * `applyCpiIncrease` does over the embedded RateSet — otherwise the migration
 * SQL this emits and the TS snippet it emits would disagree, breaking the DB ⇄
 * TS drift guard (rate-schedule-sync.test.ts) for the new row. This test builds
 * a DB-shaped set from RATE_SCHEDULE[0] and asserts the two projections match.
 */
import { describe, it, expect } from 'vitest';
import {
  projectCpiIncrease,
  toMigrationSql,
  toRateScheduleSnippet,
  projectTraineeCpiIncrease,
  toTraineeMigrationSql,
  toTraineeSnippet,
  cpiFactor,
  round2,
} from '../domain/cpiRateIncrease';
import type { EbaRateSet } from '../data/ebaRates.read.api';
import { TRAINEE_RATE_SCHEDULE } from '@/modules/rosters/domain/projections/utils/cost/trainee_matrix';
import {
  RATE_SCHEDULE,
  applyCpiIncrease,
} from '../../rosters/domain/projections/utils/cost/rate-schedule';

/** Build a DB-shaped EbaRateSet from the embedded RateSet[0] (the 2025 baseline). */
function baseSetFromEngine(): EbaRateSet {
  const rs = RATE_SCHEDULE[0];
  const rates: EbaRateSet['rates'] = [];
  for (const [cls, r] of Object.entries(rs.wageRates)) {
    rates.push({ classification: cls, employmentBasis: 'permanent', ordinaryHourlyRate: r.permanent, paidHourlyRate: r.permanent, source: 'EA2025 Schedule 2 §1' });
    rates.push({ classification: cls, employmentBasis: 'casual', ordinaryHourlyRate: r.permanent, paidHourlyRate: r.casual, source: 'EA2025 Schedule 2 §1' });
  }
  const levels = [3, 4, 5, 6] as const;
  for (const lvl of levels) {
    const paid = rs.security.annualisedHourly[`level${lvl}` as const];
    const ordinary = rs.security.ordinaryFromAnnualised[paid];
    rates.push({ classification: `SECURITY_LEVEL_${lvl}`, employmentBasis: 'annualised', ordinaryHourlyRate: ordinary, paidHourlyRate: paid, source: 'EA2025 Schedule 2 §2' });
  }
  const allowances: EbaRateSet['allowances'] = [
    { code: 'meal', amount: rs.allowances.meal, unit: 'per_occasion', source: null },
    { code: 'first_aid_per_hour', amount: rs.allowances.firstAidPerHour, unit: 'per_hour', source: null },
    { code: 'protein_spill', amount: rs.allowances.proteinSpill, unit: 'per_shift', source: null },
    { code: 'split_shift', amount: rs.allowances.splitShift, unit: 'per_shift', source: null },
  ];
  return { effectiveFrom: rs.effectiveFrom, rates, allowances };
}

describe('cpiFactor / round2', () => {
  it('applies CPI% + 0.5% per cl 25.1', () => {
    expect(cpiFactor(3.6)).toBeCloseTo(1.041, 10); // 3.6 + 0.5 = 4.1%
    expect(cpiFactor(0)).toBeCloseTo(1.005, 10);
  });
  it('rounds to cents', () => {
    expect(round2(25.65 * 1.041)).toBe(26.7);
    expect(round2(13.61 * 1.041)).toBe(14.17);
  });
});

describe('projectCpiIncrease — parity with the engine applyCpiIncrease', () => {
  const CPI = 3.6;
  const base = baseSetFromEngine();
  const projected = projectCpiIncrease({ base, cpiPercent: CPI, effectiveFrom: '2026-07-01' });
  const engine = applyCpiIncrease(RATE_SCHEDULE[0], CPI, '2026-07-01', 'test');

  it('projects wage PAID rates identically (permanent + casual)', () => {
    for (const [cls, r] of Object.entries(engine.wageRates)) {
      const perm = projected.rates.find((x) => x.classification === cls && x.employmentBasis === 'permanent')!;
      const cas = projected.rates.find((x) => x.classification === cls && x.employmentBasis === 'casual')!;
      expect(perm.paidHourlyRate).toBe(r.permanent);
      expect(cas.paidHourlyRate).toBe(r.casual);
      // casual ordinary (the de-loaded rate) tracks the permanent rate
      expect(cas.ordinaryHourlyRate).toBe(r.permanent);
    }
  });

  it('projects allowances identically', () => {
    const byCode = Object.fromEntries(projected.allowances.map((a) => [a.code, a.amount]));
    expect(byCode.meal).toBe(engine.allowances.meal);
    expect(byCode.first_aid_per_hour).toBe(engine.allowances.firstAidPerHour);
    expect(byCode.protein_spill).toBe(engine.allowances.proteinSpill);
    expect(byCode.split_shift).toBe(engine.allowances.splitShift);
  });

  it('projects security annualised + ordinary rates identically', () => {
    for (const lvl of [3, 4, 5, 6] as const) {
      const row = projected.rates.find((x) => x.classification === `SECURITY_LEVEL_${lvl}`)!;
      const paid = engine.security.annualisedHourly[`level${lvl}` as const];
      expect(row.paidHourlyRate).toBe(paid);
      expect(row.ordinaryHourlyRate).toBe(engine.security.ordinaryFromAnnualised[paid]);
    }
  });

  it('does not mutate the base set', () => {
    expect(base.rates.find((r) => r.classification === 'LEVEL_1' && r.employmentBasis === 'casual')!.paidHourlyRate).toBe(32.06);
  });
});

describe('toMigrationSql', () => {
  const base = baseSetFromEngine();
  const p = projectCpiIncrease({ base, cpiPercent: 3.6, effectiveFrom: '2026-07-01' });
  const sql = toMigrationSql(p);

  it('inserts into both tables with idempotent ON CONFLICT clauses', () => {
    expect(sql).toContain('INSERT INTO "public"."eba_rate"');
    expect(sql).toContain('INSERT INTO "public"."eba_allowance"');
    expect(sql).toContain('ON CONFLICT ("effective_from","classification","employment_basis") DO NOTHING');
    expect(sql).toContain('ON CONFLICT ("effective_from","code") DO NOTHING');
  });

  it('emits one VALUES row per rate and per allowance, money to 2dp', () => {
    // 20 rate rows (8 classifications × 2 + 4 security), 4 allowances
    const rateRows = (sql.match(/\('2026-07-01','[A-Z_0-9]+','(permanent|casual|annualised)'/g) ?? []).length;
    expect(rateRows).toBe(20);
    expect(sql).toContain("('2026-07-01','LEVEL_1','casual',26.70,33.37,");
    expect(sql).toContain("('2026-07-01','meal',14.17,'per_occasion',");
  });

  it('stamps the CPI provenance into every row source', () => {
    const src = "EA2025 cl 25.1 — 2026-07-01 increase (CPI 3.6% + 0.5%)";
    // header comment (1) + one source string per rate row (20) + allowance (4)
    expect(sql.split(src).length - 1).toBe(25);
  });
});

describe('toRateScheduleSnippet', () => {
  const base = baseSetFromEngine();
  const p = projectCpiIncrease({ base, cpiPercent: 3.6, effectiveFrom: '2026-07-01' });

  it('emits an applyCpiIncrease push referencing the base index and CPI%', () => {
    const snippet = toRateScheduleSnippet(p, 0);
    expect(snippet).toContain('RATE_SCHEDULE.push(applyCpiIncrease(');
    expect(snippet).toContain('RATE_SCHEDULE[0]');
    expect(snippet).toContain('3.6');
    expect(snippet).toContain("'2026-07-01'");
  });
});

describe('Schedule 5 trainee CPI projection + export', () => {
  const next = projectTraineeCpiIncrease(TRAINEE_RATE_SCHEDULE[0], 3.6, '2026-07-01');
  const f = 1 + (3.6 + 0.5) / 100;

  it('projects the trainee matrix by CPI% + 0.5% (matches the engine helper)', () => {
    expect(next.weeklyLevelA[10][0]).toBe(round2(420.8 * f));
    expect(next.hourlyLevelA[10][3]).toBe(round2(21.1 * f));
    expect(next.certIvUpliftPct).toBe(3.8); // structural, unchanged
  });

  it('emits a parseable JSONB migration INSERT that round-trips to the matrix', () => {
    const sql = toTraineeMigrationSql(next);
    expect(sql).toContain('INSERT INTO "public"."eba_trainee_schedule"');
    expect(sql).toContain('ON CONFLICT ("effective_from") DO NOTHING');
    const json = sql.match(/\$json\$([\s\S]*?)\$json\$/)![1];
    const parsed = JSON.parse(json);
    expect(parsed.hourlyLevelA['10'][3]).toBe(round2(21.1 * f));
  });

  it('emits a TS snippet targeting TRAINEE_RATE_SCHEDULE', () => {
    const snippet = toTraineeSnippet(next, 3.6, 0);
    expect(snippet).toContain('TRAINEE_RATE_SCHEDULE.push(applyTraineeCpiIncrease(');
    expect(snippet).toContain('TRAINEE_RATE_SCHEDULE[0]');
    expect(snippet).toContain("'2026-07-01'");
  });
});
