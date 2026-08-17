import { describe, expect, it } from 'vitest';
import { dbShiftToFrontend, frontendToDbGroups } from '../templates.types';
import type { Group } from '../templates.types';

/**
 * `day_of_week` has three-valued semantics that the client kept collapsing.
 *
 * apply_template_to_date_range_v2 stamps a template shift onto a date when
 * `day_of_week IS NULL OR day_of_week = <the day being stamped>`, so:
 *   - NULL  = "any day"  (stamps all seven)
 *   - 0     = Sunday     (stamps one)
 *
 * Coercing either into the other silently rewrites the schedule, and
 * save_template_full reads the `dayOfWeek` key back out, so an omitted key is
 * indistinguishable from an explicit wildcard. These tests pin all three.
 */

function makeGroup(shift: Partial<Parameters<typeof frontendToDbGroups>[0][number]['subGroups'][number]['shifts'][number]>): Group[] {
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
              startTime: '09:00',
              endTime: '17:00',
              paidBreakDuration: 0,
              unpaidBreakDuration: 30,
              skills: [],
              licenses: [],
              siteTags: [],
              eventTags: [],
              sortOrder: 0,
              ...shift,
            },
          ],
        },
      ],
    } as unknown as Group,
  ];
}

function firstMappedShift(groups: Group[]) {
  return frontendToDbGroups(groups)[0].subGroups[0].shifts[0];
}

describe('template dayOfWeek round-trip', () => {
  describe('frontendToDbGroups', () => {
    it('carries an explicit weekday through to the DB payload', () => {
      // Regression: the mapper omitted dayOfWeek entirely, so save_template_full
      // wrote NULL over every weekday and a Tue/Wed/Thu template became
      // an every-day one on the first save from the editor.
      expect(firstMappedShift(makeGroup({ dayOfWeek: 2 })).dayOfWeek).toBe(2);
    });

    it('preserves Sunday as 0 rather than dropping it as falsy', () => {
      expect(firstMappedShift(makeGroup({ dayOfWeek: 0 })).dayOfWeek).toBe(0);
    });

    it('sends null — the "any day" wildcard — when no weekday is set', () => {
      expect(firstMappedShift(makeGroup({ dayOfWeek: undefined })).dayOfWeek).toBeNull();
    });
  });

  describe('dbShiftToFrontend', () => {
    it('reads a missing weekday as null, not as Sunday', () => {
      // Regression: `?? 0` made every weekday-less shift claim to be Sunday.
      expect(dbShiftToFrontend({ start_time: '09:00', end_time: '17:00' }).dayOfWeek).toBeNull();
    });

    it('preserves an explicit Sunday', () => {
      expect(dbShiftToFrontend({ day_of_week: 0 }).dayOfWeek).toBe(0);
    });

    it('preserves an explicit weekday', () => {
      expect(dbShiftToFrontend({ day_of_week: 4 }).dayOfWeek).toBe(4);
    });

    it('accepts an explicit null wildcard from the database', () => {
      expect(dbShiftToFrontend({ day_of_week: null }).dayOfWeek).toBeNull();
    });
  });

  it('survives a full frontend -> db -> frontend round trip for every weekday', () => {
    for (const day of [0, 1, 2, 3, 4, 5, 6]) {
      const mapped = firstMappedShift(makeGroup({ dayOfWeek: day }));
      expect(dbShiftToFrontend(mapped).dayOfWeek).toBe(day);
    }
  });

  it('keeps the wildcard a wildcard across a round trip', () => {
    const mapped = firstMappedShift(makeGroup({ dayOfWeek: null }));
    expect(dbShiftToFrontend(mapped).dayOfWeek).toBeNull();
  });
});
