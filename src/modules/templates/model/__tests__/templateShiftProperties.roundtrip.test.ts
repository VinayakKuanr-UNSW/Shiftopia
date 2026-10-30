import { describe, expect, it } from 'vitest';
import { dbShiftToFrontend, frontendToDbGroups } from '../templates.types';
import type { Group, TemplateShift } from '../templates.types';

/**
 * A template shift is demand, not a person: it has no employee, so nothing
 * person-scoped (assignment, labour compliance) belongs to it. What it does
 * have must survive a load and a save — copying a template, a sub-group or a
 * shift is only as good as the save that follows it.
 *
 * The break window did not survive either way: v_template_full returns
 * breakStart/breakEnd, but dbShiftToFrontend never read them, and
 * frontendToDbGroups never sent them, so save_template_full wrote
 * NULLIF(<missing>, '') = NULL. Every save erased the template's meal break.
 */

function groupsWith(shift: Partial<TemplateShift>): Group[] {
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

const saved = (shift: Partial<TemplateShift>) => frontendToDbGroups(groupsWith(shift))[0].subGroups[0].shifts[0];

describe('template shift break window', () => {
  it('is read from the view', () => {
    const s = dbShiftToFrontend({ id: 's1', breakStart: '13:00', breakEnd: '13:30' });
    expect(s.breakStart).toBe('13:00');
    expect(s.breakEnd).toBe('13:30');
  });

  it('is sent on save', () => {
    expect(saved({ breakStart: '13:00', breakEnd: '13:30' })).toMatchObject({ breakStart: '13:00', breakEnd: '13:30' });
  });

  it('survives a load and a save unchanged', () => {
    const loaded = dbShiftToFrontend({ id: 's1', startTime: '09:00', endTime: '17:00', breakStart: '13:00', breakEnd: '13:30' });
    expect(saved(loaded)).toMatchObject({ breakStart: '13:00', breakEnd: '13:30' });
  });

  it('stays null when the shift has none', () => {
    expect(saved({})).toMatchObject({ breakStart: null, breakEnd: null });
  });
});

describe('template shift has no employee', () => {
  it('drops an employee a legacy row still carries', () => {
    const s = dbShiftToFrontend({ id: 's1', assigned_employee_id: 'e1', assigned_employee_name: 'Someone' });
    expect(s).not.toHaveProperty('assignedEmployeeId');
    expect(s).not.toHaveProperty('assignedEmployeeName');
  });

  it('never sends one on save', () => {
    const payload = saved({});
    expect(payload).not.toHaveProperty('assignedEmployeeId');
    expect(payload).not.toHaveProperty('assignedEmployeeName');
  });

  it('has no employee field in its type', () => {
    // Compile-time: tsc fails while TemplateShift still declares the field.
    type HasEmployee = 'assignedEmployeeId' extends keyof TemplateShift ? true : false;
    const hasEmployee: HasEmployee = false;
    expect(hasEmployee).toBe(false);
  });
});
