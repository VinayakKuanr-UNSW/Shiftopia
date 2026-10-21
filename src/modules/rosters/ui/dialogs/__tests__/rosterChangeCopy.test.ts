import { describe, expect, it } from 'vitest';
import {
  describeSubgroupClone,
  describeSubgroupDeletion,
  describeSubgroupRename,
  describeTemplateStacking,
  describeTemplateUndo,
  formatRange,
} from '../rosterChangeCopy';
import type {
  SubgroupDeletion,
  TemplateApplicationPreview,
  TemplateUndo,
} from '../../../api/rosterSubgroups.api';

const deletion = (over: Partial<SubgroupDeletion> = {}): SubgroupDeletion => ({
  fromDate: '2026-12-02', toDate: '2026-12-06', days: 3, shiftsDeleted: 5, assigned: 0, published: 0,
  shiftsKept: 0, daysKept: 0, pastDays: 0, pastShifts: 0, ...over,
});

describe('formatRange', () => {
  it('shows one day once and a span as a range', () => {
    expect(formatRange('2026-12-02', '2026-12-02')).toBe('Wed 2 Dec');
    expect(formatRange('2026-12-02', '2026-12-06')).toBe('Wed 2 Dec – Sun 6 Dec');
  });
});

describe('describeSubgroupDeletion', () => {
  it('says what goes and labels the button with the count', () => {
    const s = describeSubgroupDeletion(deletion(), 'AM Base');
    expect(s.lines[0]).toBe('5 shifts will be permanently deleted from 3 days (Wed 2 Dec – Sun 6 Dec).');
    expect(s.confirmLabel).toBe('Delete 5 shifts');
    expect(s.blocked).toBeNull();
    expect(s.needsAcknowledgement).toBe(false);
  });

  it('says started shifts and earlier days stay', () => {
    const s = describeSubgroupDeletion(deletion({ shiftsKept: 2, daysKept: 1, pastDays: 2, pastShifts: 4 }), 'AM Base');
    expect(s.lines).toContain('2 shifts have already started and stay, so “AM Base” stays on 1 day.');
    expect(s.lines).toContain('2 earlier days in view are not changed (4 shifts kept as history).');
  });

  it('asks for an acknowledgement when staff are assigned or the shifts are published', () => {
    const s = describeSubgroupDeletion(deletion({ assigned: 2, published: 3 }), 'AM Base');
    expect(s.warnings).toEqual([
      '2 shifts are assigned to staff. They lose them and are not notified.',
      '3 shifts are published, so staff can already see them.',
    ]);
    expect(s.needsAcknowledgement).toBe(true);
  });

  it('blocks when the sub-group is only on earlier days', () => {
    const s = describeSubgroupDeletion(deletion({ days: 0, shiftsDeleted: 0, pastDays: 1, pastShifts: 1 }), 'AM Base');
    expect(s.blocked).toMatch(/nothing to delete/);
    expect(s.lines[0]).toMatch(/only on earlier days/);
  });

  it('offers to remove an empty sub-group without talking about shifts', () => {
    const s = describeSubgroupDeletion(deletion({ shiftsDeleted: 0 }), 'AM Base');
    expect(s.confirmLabel).toBe('Remove sub-group');
  });
});

describe('describeSubgroupRename', () => {
  const rename = { fromDate: '2026-12-02', toDate: '2026-12-03', days: 2, shifts: 4, pastDays: 1, conflicts: [] as string[] };

  it('blocks a name that already exists on some day, naming the day', () => {
    const s = describeSubgroupRename({ ...rename, conflicts: ['2026-12-03'] }, 'AM Base', 'PM Base');
    expect(s.blocked).toBe('This group already has a sub-group called “PM Base” on Thu 3 Dec. Pick another name.');
  });

  it('says how many days and shifts move, and that earlier days keep the old name', () => {
    const s = describeSubgroupRename(rename, 'AM Base', 'PM Base');
    expect(s.lines).toEqual([
      'Renames “AM Base” to “PM Base” on 2 days (Wed 2 Dec – Thu 3 Dec), moving 4 shifts with it.',
      '1 earlier day in view keeps the name “AM Base”.',
    ]);
  });
});

describe('describeSubgroupClone', () => {
  it('reports copies, skipped started shifts and untouched earlier days', () => {
    const s = describeSubgroupClone(
      { fromDate: '2026-12-02', toDate: '2026-12-02', days: 1, shiftsCopied: 3, shiftsSkipped: 1, pastDays: 2, conflicts: [] },
      'AM Base', 'AM Base 2',
    );
    expect(s.lines).toEqual([
      'Creates “AM Base 2” on 1 day (Wed 2 Dec) with 3 shifts copied as unassigned drafts.',
      '1 shift has already started and is not copied.',
      '2 earlier days in view are not copied.',
    ]);
    expect(s.confirmLabel).toBe('Clone with 3 shifts');
  });
});

describe('describeTemplateStacking', () => {
  const preview = (over: Partial<TemplateApplicationPreview> = {}): TemplateApplicationPreview => ({
    fromDate: '2026-12-02', toDate: '2026-12-06', existingTemplates: [], manualShifts: 0,
    wouldCreate: 10, alreadyApplied: 0, duplicates: 0, ...over,
  });

  it('applies without asking when the days are empty', () => {
    expect(describeTemplateStacking(preview(), 'Weekend').needsConfirmation).toBe(false);
  });

  it('names what is already there and says nothing is replaced', () => {
    const s = describeTemplateStacking(preview({
      existingTemplates: [{ templateId: 't1', name: 'Weekday', shifts: 12, firstDate: '2026-12-02', lastDate: '2026-12-04', isThisTemplate: false }],
      manualShifts: 2,
      duplicates: 3,
    }), 'Weekend');
    expect(s.needsConfirmation).toBe(true);
    expect(s.lines).toEqual([
      '“Weekday” already has 12 shifts here (Wed 2 Dec – Fri 4 Dec).',
      '2 shifts were added by hand.',
      '“Weekend” adds up to 10 shifts on top. Nothing already there is replaced or removed.',
    ]);
    expect(s.warnings).toEqual(['3 new shifts duplicate one already here: same sub-group, same times, same role.']);
    expect(s.confirmLabel).toBe('Add on top');
  });

  it('asks before re-applying the same template, and says its shifts are skipped', () => {
    const s = describeTemplateStacking(preview({
      existingTemplates: [{ templateId: 't2', name: 'Weekend', shifts: 10, firstDate: '2026-12-05', lastDate: '2026-12-06', isThisTemplate: true }],
      wouldCreate: 0,
      alreadyApplied: 10,
    }), 'Weekend');
    expect(s.needsConfirmation).toBe(true);
    expect(s.lines).toContain('“Weekend” has nothing new to add on these days.');
    expect(s.lines).toContain('10 of its shifts are already here from an earlier apply and will be skipped.');
  });
});

describe('describeTemplateUndo', () => {
  const undo = (over: Partial<TemplateUndo> = {}): TemplateUndo => ({
    batchId: 'b', templateId: 't', startDate: '2026-12-02', endDate: '2026-12-06',
    shiftsDeleted: 8, assigned: 0, published: 0, shiftsKept: 0, ...over,
  });

  it('removes only this application, and says other sources are untouched', () => {
    const s = describeTemplateUndo(undo({ shiftsKept: 2 }));
    expect(s.lines).toEqual([
      'Removes the 8 shifts this application created (Wed 2 Dec – Sun 6 Dec), and any sub-groups that leaves empty.',
      'Shifts from other templates and shifts added by hand are not touched.',
      '2 shifts have already started and stay.',
    ]);
    expect(s.confirmLabel).toBe('Remove 8 shifts');
  });

  it('needs an acknowledgement when assigned shifts would go', () => {
    expect(describeTemplateUndo(undo({ assigned: 1 })).needsAcknowledgement).toBe(true);
  });

  it('blocks when every shift has already started', () => {
    const s = describeTemplateUndo(undo({ shiftsDeleted: 0, shiftsKept: 8 }));
    expect(s.blocked).toBe('There is nothing left to remove from this application.');
    expect(s.lines).toEqual(['All 8 shifts from this application have already started, so they stay.']);
  });
});
