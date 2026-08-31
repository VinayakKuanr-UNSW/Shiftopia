/**
 * Writing a designed pattern into the template tables.
 *
 * There is no new storage here. A baseline pattern IS a `roster_templates` row
 * with `template_shifts` beneath it — the same thing the template editor makes,
 * the same thing `apply_template_to_date_range_v2` reads. This is a shortcut
 * into that shape, not a parallel model, which is why Baseline FT never needed
 * a `baseline_ft_patterns` table.
 *
 * The one thing it does that hand-building does not is set `day_of_week` on
 * every row, and derive the day length from the contract instead of asking for
 * it. Those are the two omissions that produced a production template called
 * "Baseline FT" holding 8.0h days against a 38h contract.
 */

import { supabase } from '@/platform/supabase/client';
import { validatePattern } from '../domain/patternValidator';
import type { DesignedSlot } from '../domain/patternDesigner';
import type { Finding, IsoWeekday } from '../domain/types';

export interface CreatePatternInput {
    organizationId: string;
    departmentId: string;
    subDepartmentId: string;
    name: string;
    slots: readonly DesignedSlot[];
    /** Checked against, so the write cannot produce something Generate refuses. */
    contractedWeeklyHours: number;
    cycleWeeks: 1 | 2 | 3 | 4;
    roleId: string;
}

export interface CreatePatternResult {
    templateId: string | null;
    findings: Finding[];
}

/**
 * ISO (1 = Monday … 7 = Sunday) → stored (0 = Sunday … 6 = Saturday).
 *
 * The inverse of the conversion in `baselineFt.loaders.ts#loadPattern`. Two
 * encodings for one fact is where an off-by-one hides, so both directions are
 * one-liners next to a comment saying which way they go, and the correspondence
 * is asserted in `templateDayOfWeek.test.ts`.
 */
export function isoToStoredWeekday(iso: IsoWeekday): number {
    return iso === 7 ? 0 : iso;
}

/**
 * Create a template from a designed pattern.
 *
 * Validates BEFORE writing. The designer and the validator are separate
 * readings of the same clauses, so running the gate here means a pattern that
 * reaches the database is one Generate will accept — rather than one the author
 * discovers is unusable on the next screen.
 */
export async function createBaselinePattern(
    input: CreatePatternInput,
): Promise<CreatePatternResult> {
    const findings: Finding[] = [];

    if (input.slots.length === 0) {
        findings.push({
            severity: 'BLOCKING',
            code: 'BFT_CREATE_NO_SLOTS',
            plain: 'There is nothing to save — design the pattern first.',
            overridable: false,
        });
        return { templateId: null, findings };
    }

    // Gate first, against the SAME validator Generate will run.
    const gate = validatePattern(
        {
            templateId: 'pending',
            subDepartmentId: input.subDepartmentId,
            slots: input.slots.map((s, i) => ({
                templateShiftId: `pending-${i}`,
                dayOfWeek: s.dayOfWeek,
                startTime: s.startTime,
                endTime: s.endTime,
                unpaidBreakMinutes: s.unpaidBreakMinutes,
                paidBreakMinutes: s.paidBreakMinutes,
                netMinutes: s.netMinutes,
                roleId: s.roleId,
                sortOrder: s.sortOrder,
            })),
        },
        {
            contractedWeeklyHours: input.contractedWeeklyHours,
            cycleWeeks: input.cycleWeeks,
            roleId: input.roleId,
        },
    );
    findings.push(...gate);
    if (gate.some(f => f.severity === 'BLOCKING')) {
        return { templateId: null, findings };
    }

    // 1. The template. `organization_id` is NOT NULL — note that
    //    `templatesService.createTemplate` omits it, which is why this writes
    //    the row directly rather than going through that helper.
    const { data: tpl, error: tplErr } = await supabase
        .from('roster_templates')
        .insert({
            name: input.name,
            description: 'Full-time baseline pattern',
            organization_id: input.organizationId,
            department_id: input.departmentId,
            sub_department_id: input.subDepartmentId,
            status: 'draft',
            is_active: true,
            created_from: 'baseline_ft',
        } as never)
        .select('id')
        .single();

    if (tplErr || !tpl) {
        findings.push({
            severity: 'BLOCKING',
            code: 'BFT_CREATE_TEMPLATE_FAILED',
            // The database's own words. Swallowing them is how a CHECK
            // violation reached the user as a bare "could not be saved" with
            // the actual cause -- an unrecognised `created_from` -- only
            // visible as a 400 in the network tab.
            plain: tplErr?.message
                ? `The pattern could not be saved: ${tplErr.message}`
                : 'The pattern could not be saved.',
            overridable: false,
            calculation: { error: tplErr?.message, code: (tplErr as { code?: string } | null)?.code },
        });
        return { templateId: null, findings };
    }

    const templateId = String((tpl as { id: string }).id);

    // 2. One group and one subgroup. A baseline is a flat list of weekly
    //    shifts; the group/subgroup layer exists for roster organisation and is
    //    given the minimum shape the schema requires rather than invented
    //    structure the author did not ask for.
    const { data: group, error: gErr } = await supabase
        .from('template_groups')
        .insert({ template_id: templateId, name: 'Baseline', sort_order: 0 } as never)
        .select('id')
        .single();

    if (gErr || !group) {
        findings.push({
            severity: 'BLOCKING',
            code: 'BFT_CREATE_GROUP_FAILED',
            plain: 'The pattern was created but its group could not be saved.',
            overridable: false,
            calculation: { error: gErr?.message, template_id: templateId },
        });
        return { templateId, findings };
    }

    const { data: subgroup, error: sgErr } = await supabase
        .from('template_subgroups')
        .insert({
            group_id: String((group as { id: string }).id),
            name: 'Full-Time',
            sort_order: 0,
        } as never)
        .select('id')
        .single();

    if (sgErr || !subgroup) {
        findings.push({
            severity: 'BLOCKING',
            code: 'BFT_CREATE_SUBGROUP_FAILED',
            plain: 'The pattern was created but its subgroup could not be saved.',
            overridable: false,
            calculation: { error: sgErr?.message, template_id: templateId },
        });
        return { templateId, findings };
    }

    // 3. The shifts. `target_employment_type` is NOT NULL on `template_shifts`
    //    with no default AND no inheriting trigger — unlike `shifts`, where one
    //    exists. Omitting it is a 23502, which is exactly how template saving
    //    broke for a fortnight once the column became mandatory.
    const rows = input.slots.map((s, i) => ({
        subgroup_id: String((subgroup as { id: string }).id),
        name: 'Baseline shift',
        role_id: s.roleId,
        start_time: s.startTime,
        end_time: s.endTime,
        unpaid_break_minutes: s.unpaidBreakMinutes,
        paid_break_minutes: s.paidBreakMinutes,
        // The whole point. Every production row was null, which the apply RPC
        // reads as "every day".
        day_of_week: isoToStoredWeekday(s.dayOfWeek),
        sort_order: i,
        target_employment_type: 'FT',
        target_requires_flexible: false,
    }));

    const { error: shiftsErr } = await supabase
        .from('template_shifts')
        .insert(rows as never);

    if (shiftsErr) {
        findings.push({
            severity: 'BLOCKING',
            code: 'BFT_CREATE_SHIFTS_FAILED',
            plain: 'The pattern was created but its shifts could not be saved.',
            overridable: false,
            calculation: { error: shiftsErr.message, template_id: templateId },
        });
        return { templateId, findings };
    }

    return { templateId, findings };
}
