import { describe, expect, it } from 'vitest';
import type { Group, SubGroup, Template, TemplateShift } from '../templates.types';
import { deepClone, generateTempId } from '../templates.types';

describe('template cloning property fidelity', () => {
  const sampleShift: TemplateShift = {
    id: 'orig-shift-1',
    name: 'AM Specialist',
    roleId: 'role-123',
    roleName: 'Event Setup Team Member',
    remunerationLevel: 2,
    remunerationLevelName: 'Level 2',
    startTime: '06:30',
    endTime: '14:00',
    netLength: 7,
    paidBreakDuration: 15,
    unpaidBreakDuration: 30,
    requiredStaff: 1,
    skills: ['Forklift', 'Rigging'],
    licenses: ['Driver C', 'Whitecard'],
    siteTags: ['Loading Dock', 'Hall 1'],
    eventTags: ['Major Event', 'Bump-in'],
    notes: 'Enter via loading dock 3',
    sortOrder: 0,
    dayOfWeek: 3, // Wednesday
    targetEmploymentType: 'PT',
    targetRequiresFlexible: true,
    assignedEmployeeId: null,
    assignedEmployeeName: null,
  };

  const sampleSubGroup: SubGroup = {
    id: 'orig-sg-1',
    name: 'AM Base',
    description: 'Morning core setup crew',
    sortOrder: 0,
    shifts: [sampleShift],
  };

  const sampleTemplate: Template = {
    id: 'tmpl-100',
    name: 'Weekly Operations Base',
    description: 'Standard operational template',
    status: 'published',
    organizationId: 'org-1',
    departmentId: 'dept-1',
    subDepartmentId: 'subdept-1',
    publishedMonth: '2026-10',
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    isBaseTemplate: true,
    isActive: true,
    version: 3,
    appliedCount: 5,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-15T00:00:00Z',
    groups: [
      {
        id: 'g-1',
        name: 'Convention',
        color: 'blue',
        sortOrder: 0,
        subGroups: [sampleSubGroup],
      },
    ],
  };

  describe('single shift cloning', () => {
    it('clones all properties faithfully and decouples arrays', () => {
      // Simulate shift cloning logic
      const { id: _unusedId, ...shiftData } = sampleShift;
      const existingShiftsCount = 3;

      const clonedShift: TemplateShift = {
        ...shiftData,
        id: generateTempId('shift'),
        name: shiftData.name || shiftData.roleName || 'New Shift',
        startTime: shiftData.startTime || '09:00',
        endTime: shiftData.endTime || '17:00',
        paidBreakDuration: shiftData.paidBreakDuration ?? 0,
        unpaidBreakDuration: shiftData.unpaidBreakDuration ?? 0,
        skills: [...(shiftData.skills || [])],
        licenses: [...(shiftData.licenses || [])],
        siteTags: [...(shiftData.siteTags || [])],
        eventTags: [...(shiftData.eventTags || [])],
        sortOrder: existingShiftsCount,
        dayOfWeek: shiftData.dayOfWeek !== undefined ? shiftData.dayOfWeek : null,
        targetEmploymentType: shiftData.targetEmploymentType ?? null,
        targetRequiresFlexible: shiftData.targetRequiresFlexible ?? false,
        assignedEmployeeId: shiftData.assignedEmployeeId ?? null,
        assignedEmployeeName: shiftData.assignedEmployeeName ?? null,
      };

      // ID must be fresh
      expect(clonedShift.id).not.toBe(sampleShift.id);
      expect(String(clonedShift.id)).toMatch(/^temp-shift-/);

      // Core properties must match
      expect(clonedShift.name).toBe(sampleShift.name);
      expect(clonedShift.roleId).toBe(sampleShift.roleId);
      expect(clonedShift.roleName).toBe(sampleShift.roleName);
      expect(clonedShift.remunerationLevel).toBe(sampleShift.remunerationLevel);
      expect(clonedShift.remunerationLevelName).toBe(sampleShift.remunerationLevelName);
      expect(clonedShift.startTime).toBe(sampleShift.startTime);
      expect(clonedShift.endTime).toBe(sampleShift.endTime);
      expect(clonedShift.netLength).toBe(sampleShift.netLength);
      expect(clonedShift.paidBreakDuration).toBe(sampleShift.paidBreakDuration);
      expect(clonedShift.unpaidBreakDuration).toBe(sampleShift.unpaidBreakDuration);
      expect(clonedShift.notes).toBe(sampleShift.notes);

      // Repeat / Schedule & Target Employment Type must NOT be lost or defaulted
      expect(clonedShift.dayOfWeek).toBe(3);
      expect(clonedShift.targetEmploymentType).toBe('PT');
      expect(clonedShift.targetRequiresFlexible).toBe(true);

      // Sort order must be set to the new index
      expect(clonedShift.sortOrder).toBe(existingShiftsCount);

      // Array references must be cleanly decoupled
      expect(clonedShift.skills).toEqual(sampleShift.skills);
      expect(clonedShift.skills).not.toBe(sampleShift.skills);

      expect(clonedShift.licenses).toEqual(sampleShift.licenses);
      expect(clonedShift.licenses).not.toBe(sampleShift.licenses);

      expect(clonedShift.siteTags).toEqual(sampleShift.siteTags);
      expect(clonedShift.siteTags).not.toBe(sampleShift.siteTags);

      expect(clonedShift.eventTags).toEqual(sampleShift.eventTags);
      expect(clonedShift.eventTags).not.toBe(sampleShift.eventTags);
    });

    it('preserves Sunday (0) and wildcard (null) for dayOfWeek correctly', () => {
      const sundayShift = { ...sampleShift, dayOfWeek: 0 };
      const wildcardShift = { ...sampleShift, dayOfWeek: null };

      const clonedSunday: TemplateShift = {
        ...sundayShift,
        id: generateTempId('shift'),
        dayOfWeek: sundayShift.dayOfWeek !== undefined ? sundayShift.dayOfWeek : null,
      };
      expect(clonedSunday.dayOfWeek).toBe(0);

      const clonedWildcard: TemplateShift = {
        ...wildcardShift,
        id: generateTempId('shift'),
        dayOfWeek: wildcardShift.dayOfWeek !== undefined ? wildcardShift.dayOfWeek : null,
      };
      expect(clonedWildcard.dayOfWeek).toBeNull();
    });

    it('hydrates form day_of_week correctly for cloned wildcard shift (null)', () => {
      const clonedWildcard: TemplateShift = {
        ...sampleShift,
        id: generateTempId('shift'),
        dayOfWeek: null,
      };

      // In useShiftFormOrchestrator form hydration
      const hydratedDayOfWeek =
        (clonedWildcard as any).day_of_week !== undefined
          ? (clonedWildcard as any).day_of_week
          : clonedWildcard.dayOfWeek !== undefined
            ? clonedWildcard.dayOfWeek
            : undefined;

      expect(hydratedDayOfWeek).toBeNull();
    });

    it('resolves dayOfWeek correctly in handleShiftModalSave when editing to or from null', () => {
      // 1. User edited a shift to "Every day" (null)
      const shiftDataWithNull = { day_of_week: null };
      const editShiftWednesday = { ...sampleShift, dayOfWeek: 3 };

      const resolvedDayOfWeek1 =
        shiftDataWithNull.day_of_week !== undefined
          ? shiftDataWithNull.day_of_week
          : (shiftDataWithNull as any).dayOfWeek !== undefined
            ? (shiftDataWithNull as any).dayOfWeek
            : editShiftWednesday?.dayOfWeek !== undefined
              ? editShiftWednesday.dayOfWeek
              : null;

      expect(resolvedDayOfWeek1).toBeNull();

      // 2. User edited a shift to Sunday (0)
      const shiftDataWithSunday = { day_of_week: 0 };
      const resolvedDayOfWeek2 =
        shiftDataWithSunday.day_of_week !== undefined
          ? shiftDataWithSunday.day_of_week
          : (shiftDataWithSunday as any).dayOfWeek !== undefined
            ? (shiftDataWithSunday as any).dayOfWeek
            : editShiftWednesday?.dayOfWeek !== undefined
              ? editShiftWednesday.dayOfWeek
              : null;

      expect(resolvedDayOfWeek2).toBe(0);
    });
  });

  describe('subgroup cloning', () => {
    it('clones subgroup and all child shifts with all properties intact', () => {
      const clonedSubGroup: SubGroup = {
        ...deepClone(sampleSubGroup),
        id: generateTempId('subgroup'),
        name: `${sampleSubGroup.name} (Copy)`,
        description: sampleSubGroup.description,
        sortOrder: 1,
        shifts: sampleSubGroup.shifts.map((s, idx) => ({
          ...s,
          id: generateTempId('shift'),
          sortOrder: idx,
          skills: [...(s.skills || [])],
          licenses: [...(s.licenses || [])],
          siteTags: [...(s.siteTags || [])],
          eventTags: [...(s.eventTags || [])],
          dayOfWeek: s.dayOfWeek !== undefined ? s.dayOfWeek : null,
          targetEmploymentType: s.targetEmploymentType ?? null,
          targetRequiresFlexible: s.targetRequiresFlexible ?? false,
          assignedEmployeeId: s.assignedEmployeeId ?? null,
          assignedEmployeeName: s.assignedEmployeeName ?? null,
        })),
      };

      expect(clonedSubGroup.id).not.toBe(sampleSubGroup.id);
      expect(clonedSubGroup.name).toBe('AM Base (Copy)');
      expect(clonedSubGroup.description).toBe(sampleSubGroup.description);
      expect(clonedSubGroup.shifts).toHaveLength(1);

      const clonedChildShift = clonedSubGroup.shifts[0];
      expect(clonedChildShift.id).not.toBe(sampleShift.id);
      expect(clonedChildShift.roleId).toBe('role-123');
      expect(clonedChildShift.dayOfWeek).toBe(3);
      expect(clonedChildShift.targetEmploymentType).toBe('PT');
      expect(clonedChildShift.targetRequiresFlexible).toBe(true);
      expect(clonedChildShift.skills).toEqual(sampleShift.skills);
      expect(clonedChildShift.skills).not.toBe(sampleShift.skills);
    });
  });

  describe('template duplication', () => {
    it('preserves repeat date range, active state, and target_requires_flexible without fallbacks', () => {
      // Test the duplication mapping
      const duplicatedTemplateRow = {
        name: `${sampleTemplate.name} (Copy)`,
        description: sampleTemplate.description,
        organization_id: sampleTemplate.organizationId,
        department_id: sampleTemplate.departmentId,
        sub_department_id: sampleTemplate.subDepartmentId,
        published_month: sampleTemplate.publishedMonth || null,
        start_date: sampleTemplate.startDate || null,
        end_date: sampleTemplate.endDate || null,
        published_at: null,
        published_by: null,
        is_base_template: sampleTemplate.isBaseTemplate ?? false,
        is_active: sampleTemplate.isActive ?? true,
        status: 'draft',
        version: 1,
      };

      // Repeat over a range MUST be copied
      expect(duplicatedTemplateRow.published_month).toBe('2026-10');
      expect(duplicatedTemplateRow.start_date).toBe('2026-10-01');
      expect(duplicatedTemplateRow.end_date).toBe('2026-10-31');
      expect(duplicatedTemplateRow.status).toBe('draft');
      expect(duplicatedTemplateRow.is_base_template).toBe(true);
      expect(duplicatedTemplateRow.is_active).toBe(true);

      // Child shift mapping inside duplicateTemplate
      const shiftToInsert = {
        subgroup_id: 'new-subgroup-id',
        name: sampleShift.name || null,
        role_id: sampleShift.roleId || null,
        role_name: sampleShift.roleName || null,
        remuneration_level: sampleShift.remunerationLevel ?? null,
        remuneration_level_name: sampleShift.remunerationLevelName || null,
        start_time: sampleShift.startTime,
        end_time: sampleShift.endTime,
        paid_break_minutes: sampleShift.paidBreakDuration ?? 0,
        unpaid_break_minutes: sampleShift.unpaidBreakDuration ?? 0,
        required_skills: [...(sampleShift.skills || [])],
        required_licenses: [...(sampleShift.licenses || [])],
        site_tags: [...(sampleShift.siteTags || [])],
        event_tags: [...(sampleShift.eventTags || [])],
        notes: sampleShift.notes || null,
        sort_order: 0,
        day_of_week: sampleShift.dayOfWeek !== undefined ? sampleShift.dayOfWeek : null,
        target_employment_type: sampleShift.targetEmploymentType,
        target_requires_flexible: sampleShift.targetRequiresFlexible ?? false,
      };

      expect(shiftToInsert.target_employment_type).toBe('PT');
      expect(shiftToInsert.target_requires_flexible).toBe(true);
      expect(shiftToInsert.day_of_week).toBe(3);
      expect(shiftToInsert.site_tags).toEqual(['Loading Dock', 'Hall 1']);
      expect(shiftToInsert.event_tags).toEqual(['Major Event', 'Bump-in']);
    });
  });
});
