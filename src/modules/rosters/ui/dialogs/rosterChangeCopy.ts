/**
 * What the confirmation dialogs say, built from the dry-run counts the database
 * returns (see api/rosterSubgroups.api.ts). Pure, so each sentence is tested.
 *
 * Every summary answers the same three questions: what changes, what stays the
 * same, and whether anyone already relies on what is about to go.
 */

import { format, parseISO } from 'date-fns';
import type {
  SubgroupClone,
  SubgroupDeletion,
  SubgroupRename,
  TemplateApplicationPreview,
  TemplateUndo,
} from '../../api/rosterSubgroups.api';

export interface ChangeSummary {
  /** What will happen, in order. */
  lines: string[];
  /** Things a manager should weigh before confirming. */
  warnings: string[];
  /** Set when the action cannot go ahead; the dialog shows it instead of a confirm button. */
  blocked: string | null;
  /** Confirming requires ticking an acknowledgement (shifts staff already rely on). */
  needsAcknowledgement: boolean;
  confirmLabel: string;
}

const formatDay = (iso: string) => format(parseISO(iso), 'EEE d MMM');

export function formatRange(fromIso: string, toIso: string): string {
  return fromIso === toIso ? formatDay(fromIso) : `${formatDay(fromIso)} – ${formatDay(toIso)}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function listDays(isoDates: string[]): string {
  const shown = isoDates.slice(0, 3).map(formatDay).join(', ');
  return isoDates.length > 3 ? `${shown} and ${plural(isoDates.length - 3, 'more day')}` : shown;
}

/** Shifts that staff already rely on: assigned to someone, or published. */
function reliedOnWarnings(assigned: number, published: number): string[] {
  const warnings: string[] = [];
  if (assigned > 0) {
    warnings.push(`${plural(assigned, 'shift is', 'shifts are')} assigned to staff. They lose ${assigned === 1 ? 'it' : 'them'} and are not notified.`);
  }
  if (published > 0) {
    warnings.push(`${plural(published, 'shift is', 'shifts are')} published, so staff can already see ${published === 1 ? 'it' : 'them'}.`);
  }
  return warnings;
}

export function describeSubgroupDeletion(d: SubgroupDeletion, name: string): ChangeSummary {
  const lines: string[] = [];
  const range = formatRange(d.fromDate, d.toDate);

  if (d.days === 0) {
    return {
      lines: d.pastDays > 0
        ? [`“${name}” is only on earlier days in this range. Days before today are not changed.`]
        : [],
      warnings: [],
      blocked: `“${name}” is not on any day from today in this range, so there is nothing to delete.`,
      needsAcknowledgement: false,
      confirmLabel: 'Delete',
    };
  }

  lines.push(
    d.shiftsDeleted > 0
      ? `${plural(d.shiftsDeleted, 'shift')} will be permanently deleted from ${plural(d.days, 'day')} (${range}).`
      : `“${name}” has no shifts to delete, so it is just removed from ${plural(d.days, 'day')} (${range}).`,
  );
  if (d.shiftsKept > 0) {
    lines.push(
      `${plural(d.shiftsKept, 'shift has', 'shifts have')} already started and ${d.shiftsKept === 1 ? 'stays' : 'stay'}, so “${name}” stays on ${plural(d.daysKept, 'day')}.`,
    );
  }
  if (d.pastDays > 0) {
    lines.push(
      `${plural(d.pastDays, 'earlier day')} in view ${d.pastDays === 1 ? 'is' : 'are'} not changed` +
      (d.pastShifts > 0 ? ` (${plural(d.pastShifts, 'shift')} kept as history).` : '.'),
    );
  }

  const warnings = reliedOnWarnings(d.assigned, d.published);
  return {
    lines,
    warnings,
    blocked: null,
    needsAcknowledgement: warnings.length > 0,
    confirmLabel: d.shiftsDeleted > 0 ? `Delete ${plural(d.shiftsDeleted, 'shift')}` : 'Remove sub-group',
  };
}

export function describeSubgroupRename(r: SubgroupRename, oldName: string, newName: string): ChangeSummary {
  const base = { warnings: [], needsAcknowledgement: false, confirmLabel: 'Rename' };

  if (r.conflicts.length > 0) {
    return {
      ...base,
      lines: [],
      blocked: `This group already has a sub-group called “${newName}” on ${listDays(r.conflicts)}. Pick another name.`,
    };
  }
  if (r.days === 0) {
    return {
      ...base,
      lines: r.pastDays > 0 ? [`Days before today keep the name “${oldName}”.`] : [],
      blocked: `“${oldName}” is not on any day from today in this range, so there is nothing to rename.`,
    };
  }

  const lines = [
    `Renames “${oldName}” to “${newName}” on ${plural(r.days, 'day')} (${formatRange(r.fromDate, r.toDate)})` +
    (r.shifts > 0 ? `, moving ${plural(r.shifts, 'shift')} with it.` : '.'),
  ];
  if (r.pastDays > 0) {
    lines.push(`${plural(r.pastDays, 'earlier day')} in view ${r.pastDays === 1 ? 'keeps' : 'keep'} the name “${oldName}”.`);
  }
  return { ...base, lines, blocked: null };
}

export function describeSubgroupClone(c: SubgroupClone, sourceName: string, newName: string): ChangeSummary {
  const base = { warnings: [], needsAcknowledgement: false, confirmLabel: 'Clone' };

  if (c.conflicts.length > 0) {
    return {
      ...base,
      lines: [],
      blocked: `This group already has a sub-group called “${newName}” on ${listDays(c.conflicts)}. Pick another name.`,
    };
  }
  if (c.days === 0) {
    return {
      ...base,
      lines: [],
      blocked: `“${sourceName}” is not on any day from today in this range, so there is nothing to clone.`,
    };
  }

  const lines = [
    `Creates “${newName}” on ${plural(c.days, 'day')} (${formatRange(c.fromDate, c.toDate)})` +
    (c.shiftsCopied > 0 ? ` with ${plural(c.shiftsCopied, 'shift')} copied as unassigned drafts.` : ', with no shifts to copy.'),
  ];
  if (c.shiftsSkipped > 0) {
    lines.push(`${plural(c.shiftsSkipped, 'shift has', 'shifts have')} already started and ${c.shiftsSkipped === 1 ? 'is' : 'are'} not copied.`);
  }
  if (c.pastDays > 0) {
    lines.push(`${plural(c.pastDays, 'earlier day')} in view ${c.pastDays === 1 ? 'is' : 'are'} not copied.`);
  }
  return {
    ...base,
    lines,
    blocked: null,
    confirmLabel: c.shiftsCopied > 0 ? `Clone with ${plural(c.shiftsCopied, 'shift')}` : 'Clone',
  };
}

/**
 * Applying a template adds on top of whatever is already there; nothing is
 * replaced. `needsConfirmation` is false only when the days are empty.
 */
export function describeTemplateStacking(
  p: TemplateApplicationPreview,
  templateName: string,
): ChangeSummary & { needsConfirmation: boolean } {
  const others = p.existingTemplates.filter(t => !t.isThisTemplate);
  const needsConfirmation = others.length > 0 || p.manualShifts > 0 || p.alreadyApplied > 0;
  const lines: string[] = [];

  for (const t of others) {
    lines.push(`“${t.name}” already has ${plural(t.shifts, 'shift')} here (${formatRange(t.firstDate, t.lastDate)}).`);
  }
  if (p.manualShifts > 0) {
    lines.push(`${plural(p.manualShifts, 'shift was', 'shifts were')} added by hand.`);
  }
  lines.push(
    p.wouldCreate > 0
      ? `“${templateName}” adds up to ${plural(p.wouldCreate, 'shift')} on top. Nothing already there is replaced or removed.`
      : `“${templateName}” has nothing new to add on these days.`,
  );
  if (p.alreadyApplied > 0) {
    lines.push(`${plural(p.alreadyApplied, 'of its shifts is', 'of its shifts are')} already here from an earlier apply and will be skipped.`);
  }

  const warnings: string[] = [];
  if (p.duplicates > 0) {
    warnings.push(
      `${plural(p.duplicates, 'new shift duplicates', 'new shifts duplicate')} one already here: same sub-group, same times, same role.`,
    );
  }

  return {
    lines,
    warnings,
    blocked: null,
    needsAcknowledgement: false,
    needsConfirmation,
    confirmLabel: p.wouldCreate > 0 ? 'Add on top' : 'Apply anyway',
  };
}

export function describeTemplateUndo(u: TemplateUndo): ChangeSummary {
  const range = formatRange(u.startDate, u.endDate);

  if (u.shiftsDeleted === 0) {
    return {
      lines: u.shiftsKept > 0
        ? [`All ${plural(u.shiftsKept, 'shift')} from this application have already started, so they stay.`]
        : [],
      warnings: [],
      blocked: 'There is nothing left to remove from this application.',
      needsAcknowledgement: false,
      confirmLabel: 'Undo',
    };
  }

  const lines = [
    `Removes the ${plural(u.shiftsDeleted, 'shift')} this application created (${range}), and any sub-groups that leaves empty.`,
    'Shifts from other templates and shifts added by hand are not touched.',
  ];
  if (u.shiftsKept > 0) {
    lines.push(`${plural(u.shiftsKept, 'shift has', 'shifts have')} already started and ${u.shiftsKept === 1 ? 'stays' : 'stay'}.`);
  }

  const warnings = reliedOnWarnings(u.assigned, u.published);
  return {
    lines,
    warnings,
    blocked: null,
    needsAcknowledgement: warnings.length > 0,
    confirmLabel: `Remove ${plural(u.shiftsDeleted, 'shift')}`,
  };
}
