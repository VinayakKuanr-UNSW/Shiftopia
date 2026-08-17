import { describe, expect, it } from 'vitest';
import { dbShiftToFrontend, frontendToDbGroups } from '../templates.types';
import type { Group, TemplateShift } from '../templates.types';

/**
 * `template_shifts.target_employment_type` is NOT NULL with NO DEFAULT.
 *
 * 20260806120000 made it mandatory — correctly, because a shift with no target
 * was being priced off an `|| 'Casual'` guess. But neither `save_template_full`
 * nor the client payload was updated to carry it, so from that migration onward
 * **every attempt to add a template shift 400'd**:
 *
 *   null value in column "target_employment_type" of relation "template_shifts"
 *   violates not-null constraint
 *
 * It went unnoticed for days because nothing added a template shift in between.
 * These tests pin the client half of the fix; the RPC half is
 * 20260813000400_save_template_full_employment_target.sql.
 */

function makeGroup(shift: Partial<TemplateShift>): Group[] {
  return [
    {
      id: 'g1',
      name: 'Convention',
      color: 'blue',
      subGroups: [
        {
          id: 'sg1',
          name: 'General',
          shifts: [
            {
              id: 's1',
              startTime: '08:00',
              endTime: '16:06',
              paidBreakDuration: 0,
              unpaidBreakDuration: 30,
              skills: [],
              licenses: [],
              siteTags: [],
              eventTags: [],
              sortOrder: 0,
              ...shift,
            } as TemplateShift,
          ],
          sortOrder: 0,
        },
      ],
      sortOrder: 0,
    },
  ];
}

const firstShift = (groups: Group[]) => frontendToDbGroups(groups)[0].subGroups[0].shifts[0];

describe('frontendToDbGroups — target_employment_type', () => {
  it('carries the key the RPC reads', () => {
    // save_template_full reads `v_shift->>'targetEmploymentType'`. An omitted
    // key is indistinguishable from an explicit null, and the insert fails.
    expect(firstShift(makeGroup({ targetEmploymentType: 'FT' })))
      .toHaveProperty('targetEmploymentType', 'FT');
  });

  it.each(['FT', 'PT', 'Casual'] as const)('passes %s through unchanged', (target) => {
    expect(firstShift(makeGroup({ targetEmploymentType: target })).targetEmploymentType)
      .toBe(target);
  });

  it('sends null rather than inventing a target when one is missing', () => {
    // Deliberate: a defaulted 'Casual' here would make the save succeed and
    // reintroduce exactly the guess the NOT NULL constraint exists to stop.
    // Failing loudly is the correct outcome.
    expect(firstShift(makeGroup({})).targetEmploymentType).toBeNull();
  });

  it('carries targetRequiresFlexible, defaulting to false', () => {
    expect(firstShift(makeGroup({ targetEmploymentType: 'FT' })).targetRequiresFlexible)
      .toBe(false);
    expect(firstShift(makeGroup({ targetEmploymentType: 'PT', targetRequiresFlexible: true })).targetRequiresFlexible)
      .toBe(true);
  });
});

describe('dbShiftToFrontend — target_employment_type', () => {
  const base = {
    id: 's1',
    start_time: '08:00:00',
    end_time: '16:06:00',
    paid_break_minutes: 0,
    unpaid_break_minutes: 30,
    sort_order: 0,
  };

  it('reads the snake_case column', () => {
    expect(dbShiftToFrontend({ ...base, target_employment_type: 'FT' } as any).targetEmploymentType)
      .toBe('FT');
  });

  it('accepts an already-camelCased payload', () => {
    expect(dbShiftToFrontend({ ...base, targetEmploymentType: 'PT' } as any).targetEmploymentType)
      .toBe('PT');
  });

  it('survives a round trip without losing the target', () => {
    const fromDb = dbShiftToFrontend({ ...base, target_employment_type: 'Casual' } as any);
    expect(firstShift(makeGroup(fromDb)).targetEmploymentType).toBe('Casual');
  });
});
