// src/types/templates.ts
// Complete TypeScript types for Templates module - Production Ready

/* ============================================================
   BASE TYPES
   ============================================================ */

export type TemplateStatus = 'draft' | 'published' | 'archived';

/* ============================================================
      DATABASE TYPES (snake_case - matches Supabase)
      ============================================================ */

export interface DbRosterTemplate {
  id: string;
  name: string;
  description: string | null;
  status: TemplateStatus;
  organization_id: string;
  department_id: string;
  sub_department_id: string;
  published_month: string | null;
  published_at: string | null;
  published_by: string | null;
  start_date: string | null;
  end_date: string | null;
  created_by: string | null;
  last_edited_by: string | null;
  version: number;
  applied_count: number;
  created_at: string;
  updated_at: string;
  is_base_template?: boolean;
  is_active?: boolean;
}

export interface DbTemplateGroup {
  id: string;
  template_id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface DbTemplateSubgroup {
  id: string;
  group_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface DbTemplateShift {
  id: string;
  subgroup_id: string;
  name: string | null;
  role_id: string | null;
  role_name: string | null;
  remuneration_level_id: string | null;
  remuneration_level: string | null;
  start_time: string;
  end_time: string;
  paid_break_minutes: number;
  unpaid_break_minutes: number;
  net_length_hours: number | null;
  required_skills: string[];
  required_licenses: string[];
  site_tags: string[];
  event_tags: string[];
  notes: string | null;
  sort_order: number;
  assigned_employee_id: string | null;
  assigned_employee_name: string | null;
  created_at: string;
  updated_at: string;
  day_of_week: number;
}

export interface DbTemplateSnapshot {
  id: string;
  template_id: string;
  snapshot_data: any;
  published_for_month: string | null;
  start_date: string;
  end_date: string;
  published_at: string;
  published_by: string | null;
  template_version: number;
}

/* ============================================================
      FRONTEND TYPES (camelCase)
      ============================================================ */

export interface TemplateShift {
  id: string | number;
  name?: string;
  roleId?: string;
  roleName?: string;
  remunerationLevelId?: string;
  remunerationLevel?: string;
  startTime: string;
  endTime: string;
  netLength?: number;
  paidBreakDuration: number;
  unpaidBreakDuration: number;
  requiredStaff?: number;
  skills: string[];
  licenses: string[];
  siteTags: string[];
  eventTags: string[];
  notes?: string;
  sortOrder: number;
  // Employee assignment
  assignedEmployeeId?: string | null;
  assignedEmployeeName?: string | null;
  dayOfWeek?: number;
}

export interface SubGroup {
  id: string | number;
  name: string;
  description?: string;
  shifts: TemplateShift[];
  sortOrder: number;
}

export interface Group {
  id: string | number;
  name: string;
  description?: string;
  color: string;
  icon?: string;
  subGroups: SubGroup[];
  sortOrder: number;
}

export interface DateRange {
  start: Date;
  end: Date;
}

export interface Template {
  id: string | number;
  name: string;
  description?: string;
  status: TemplateStatus;
  organizationId: string;
  departmentId: string;
  subDepartmentId: string;
  organizationName?: string;
  departmentName?: string;
  subDepartmentName?: string;
  publishedMonth?: string;
  publishedAt?: string;
  publishedBy?: string;
  startDate?: string;
  endDate?: string;
  createdBy?: string;
  lastEditedBy?: string;
  version: number;
  appliedCount: number;
  createdAt: string;
  updatedAt: string;
  isBaseTemplate?: boolean;
  isActive?: boolean;
  groups: Group[];
}

export interface TemplateBatch {
  id: string;
  templateId: string;
  startDate: string;
  endDate: string;
  source: 'templates_page' | 'roster_modal';
  appliedBy: string;
  appliedByName?: string;
  appliedAt: string;
}

export interface TemplateConflict {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

/* ============================================================
      INPUT TYPES
      ============================================================ */

export interface CreateTemplateInput {
  name: string;
  description?: string;
  organizationId: string;
  departmentId: string;
  subDepartmentId: string;
  month?: string; // YYYY-MM
}

export interface UpdateTemplateInput {
  name?: string;
  description?: string;
}

export interface SaveTemplateInput {
  templateId: string;
  expectedVersion: number;
  name: string;
  description?: string;
  groups: Group[];
}

export interface PublishTemplateInput {
  templateId: string;
  expectedVersion: number;
  startDate: Date;
  endDate: Date;
  forceOverride?: boolean;
}

/* ============================================================
      RPC RESPONSE TYPES
      ============================================================ */

export interface SaveTemplateResult {
  success: boolean;
  new_version: number | null;
  error_message: string | null;
}

export interface PublishTemplateResult {
  success: boolean;
  new_version: number | null;
  error_message: string | null;
  conflicts: TemplateConflict[] | null;
}

export interface VersionCheckResult {
  version_match: boolean;
  current_version: number | null;
  last_edited_by: string | null;
  last_edited_at: string | null;
}

export interface NameValidationResult {
  is_valid: boolean;
  error_message: string | null;
}

/* ============================================================
      VALIDATION TYPES
      ============================================================ */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/* ============================================================
      CONVERSION FUNCTIONS
      ============================================================ */

export function dbShiftToFrontend(dbShift: any): TemplateShift {
  return {
    id: dbShift.id,
    name: dbShift.name || undefined,
    roleId: dbShift.roleId || dbShift.role_id || undefined,
    roleName: dbShift.roleName || dbShift.role_name || undefined,
    remunerationLevelId:
      dbShift.remunerationLevelId || dbShift.remuneration_level_id || undefined,
    remunerationLevel:
      dbShift.remunerationLevel || dbShift.remuneration_level || undefined,
    startTime: dbShift.startTime || dbShift.start_time || '09:00',
    endTime: dbShift.endTime || dbShift.end_time || '17:00',
    netLength:
      dbShift.netLength ||
      dbShift.net_length_hours ||
      dbShift.net_length ||
      undefined,
    paidBreakDuration:
      dbShift.paidBreakDuration ??
      dbShift.paid_break_minutes ??
      dbShift.paid_break_duration ??
      0,
    unpaidBreakDuration:
      dbShift.unpaidBreakDuration ??
      dbShift.unpaid_break_minutes ??
      dbShift.unpaid_break_duration ??
      0,
    skills: dbShift.skills || dbShift.required_skills || [],
    licenses: dbShift.licenses || dbShift.required_licenses || [],
    siteTags: dbShift.siteTags || dbShift.site_tags || [],
    eventTags: dbShift.eventTags || dbShift.event_tags || [],
    notes: dbShift.notes || undefined,
    sortOrder: dbShift.sortOrder ?? dbShift.sort_order ?? 0,
    // Employee assignment
    assignedEmployeeId: dbShift.assignedEmployeeId || dbShift.assigned_employee_id || null,
    assignedEmployeeName: dbShift.assignedEmployeeName || dbShift.assigned_employee_name || null,
    dayOfWeek: dbShift.dayOfWeek ?? dbShift.day_of_week ?? 0,
  };
}

export function dbSubgroupToFrontend(dbSubgroup: any): SubGroup {
  const shifts = Array.isArray(dbSubgroup.shifts) ? dbSubgroup.shifts : [];
  return {
    id: dbSubgroup.id,
    name: dbSubgroup.name,
    description: dbSubgroup.description || undefined,
    shifts: shifts
      .map(dbShiftToFrontend)
      .sort((a, b) => a.sortOrder - b.sortOrder),
    sortOrder: dbSubgroup.sortOrder ?? dbSubgroup.sort_order ?? 0,
  };
}

export function dbGroupToFrontend(dbGroup: any): Group {
  const subGroups = Array.isArray(dbGroup.subGroups) ? dbGroup.subGroups : [];
  return {
    id: dbGroup.id,
    name: dbGroup.name,
    description: dbGroup.description || undefined,
    color: dbGroup.color || '#3b82f6',
    icon: dbGroup.icon || undefined,
    subGroups: subGroups
      .map(dbSubgroupToFrontend)
      .sort((a, b) => a.sortOrder - b.sortOrder),
    sortOrder: dbGroup.sortOrder ?? dbGroup.sort_order ?? 0,
  };
}

export function dbTemplateToFrontend(dbTemplate: any): Template {
  if (!dbTemplate) {
    throw new Error('Cannot convert null template');
  }

  const groups = Array.isArray(dbTemplate.groups) ? dbTemplate.groups : [];

  return {
    id: dbTemplate.id,
    name: dbTemplate.name,
    description: dbTemplate.description || undefined,
    status: dbTemplate.status || 'draft',
    organizationId:
      dbTemplate.organization_id || dbTemplate.organizationId || '',
    departmentId: dbTemplate.department_id || dbTemplate.departmentId || '',
    subDepartmentId: dbTemplate.sub_department_id || dbTemplate.subDepartmentId || '',
    organizationName: dbTemplate.organization_name || dbTemplate.organizationName || undefined,
    departmentName: dbTemplate.department_name || dbTemplate.departmentName || undefined,
    subDepartmentName: dbTemplate.sub_department_name || dbTemplate.subDepartmentName || undefined,
    publishedMonth:
      dbTemplate.published_month || dbTemplate.publishedMonth || undefined,
    publishedAt: dbTemplate.published_at || dbTemplate.publishedAt || undefined,
    publishedBy: dbTemplate.published_by || dbTemplate.publishedBy || undefined,
    startDate: dbTemplate.start_date || dbTemplate.startDate || undefined,
    endDate: dbTemplate.end_date || dbTemplate.endDate || undefined,
    createdBy: dbTemplate.created_by || dbTemplate.createdBy || undefined,
    lastEditedBy:
      dbTemplate.last_edited_by || dbTemplate.lastEditedBy || undefined,
    version: dbTemplate.version ?? 1,
    appliedCount: dbTemplate.applied_count ?? 0,
    isBaseTemplate: dbTemplate.is_base_template || dbTemplate.isBaseTemplate || false,
    isActive: dbTemplate.is_active || dbTemplate.isActive || false,
    createdAt:
      dbTemplate.created_at || dbTemplate.createdAt || new Date().toISOString(),
    updatedAt:
      dbTemplate.updated_at || dbTemplate.updatedAt || new Date().toISOString(),
    groups: groups
      .map(dbGroupToFrontend)
      .sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

export function frontendToDbGroups(groups: Group[]): any[] {
  return groups.map((g, gIdx) => ({
    id: String(g.id).startsWith('temp-') ? g.id : g.id,
    name: g.name,
    description: g.description || null,
    color: g.color,
    icon: g.icon || null,
    sortOrder: gIdx,
    subGroups: g.subGroups.map((sg, sgIdx) => ({
      id: String(sg.id).startsWith('temp-') ? sg.id : sg.id,
      name: sg.name,
      description: sg.description || null,
      sortOrder: sgIdx,
      shifts: sg.shifts.map((sh, shIdx) => ({
        id: String(sh.id).startsWith('temp-') ? sh.id : sh.id,
        name: sh.name || null,
        roleId: sh.roleId || null,
        roleName: sh.roleName || null,
        remunerationLevelId: sh.remunerationLevelId || null,
        remunerationLevel: sh.remunerationLevel || null,
        startTime: sh.startTime,
        endTime: sh.endTime,
        paidBreakDuration: sh.paidBreakDuration || 0,
        unpaidBreakDuration: sh.unpaidBreakDuration || 0,
        skills: sh.skills || [],
        licenses: sh.licenses || [],
        siteTags: sh.siteTags || [],
        eventTags: sh.eventTags || [],
        notes: sh.notes || null,
        sortOrder: shIdx,
        // Employee assignment
        assignedEmployeeId: sh.assignedEmployeeId || null,
        assignedEmployeeName: sh.assignedEmployeeName || null,
      })),
    })),
  }));
}

/* ============================================================
      VALIDATION FUNCTIONS
      ============================================================ */

export function validateTemplateName(name: string): ValidationResult {
  const errors: string[] = [];
  const trimmed = (name || '').trim();

  if (!trimmed) {
    errors.push('Template name is required');
  } else if (trimmed.length < 3) {
    errors.push('Template name must be at least 3 characters');
  } else if (trimmed.length > 100) {
    errors.push('Template name must be less than 100 characters');
  }

  if (/[<>"'\\]/.test(trimmed)) {
    errors.push('Template name contains invalid characters');
  }

  return { valid: errors.length === 0, errors };
}

export function validateShift(shift: Partial<TemplateShift>): ValidationResult {
  const errors: string[] = [];

  if (
    !shift.startTime ||
    !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(shift.startTime)
  ) {
    errors.push('Valid start time is required (HH:MM)');
  }

  if (
    !shift.endTime ||
    !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(shift.endTime)
  ) {
    errors.push('Valid end time is required (HH:MM)');
  }

  if (
    shift.paidBreakDuration !== undefined &&
    (shift.paidBreakDuration < 0 || shift.paidBreakDuration > 480)
  ) {
    errors.push('Paid break must be between 0 and 480 minutes');
  }

  if (
    shift.unpaidBreakDuration !== undefined &&
    (shift.unpaidBreakDuration < 0 || shift.unpaidBreakDuration > 480)
  ) {
    errors.push('Unpaid break must be between 0 and 480 minutes');
  }

  return { valid: errors.length === 0, errors };
}

export function validateDateRange(start: Date, end: Date): ValidationResult {
  const errors: string[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (!(start instanceof Date) || isNaN(start.getTime())) {
    errors.push('Invalid start date');
  }

  if (!(end instanceof Date) || isNaN(end.getTime())) {
    errors.push('Invalid end date');
  }

  if (start && end && start > end) {
    errors.push('Start date must be before end date');
  }

  if (start && start < today) {
    errors.push('Start date cannot be in the past');
  }

  if (start && end) {
    const daysDiff = Math.ceil(
      (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysDiff > 365) {
      errors.push('Date range cannot exceed 1 year');
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateTemplateForPublish(
  template: Template
): ValidationResult {
  const errors: string[] = [];
  const requiredGroups = ['Convention Centre', 'Exhibition Centre', 'Theatre'];

  if (!template.name || template.name.trim().length === 0) {
    errors.push('Template must have a name');
  }

  if (template.status === 'published') {
    errors.push('Template is already published');
  }

  if (template.groups.length !== 3) {
    errors.push('Template must have exactly 3 groups');
  }

  const templateGroupNames = template.groups.map((g) => g.name);
  for (const required of requiredGroups) {
    if (!templateGroupNames.includes(required)) {
      errors.push(`Missing required group: ${required}`);
    }
  }

  for (const group of template.groups) {
    if (group.subGroups.length === 0) {
      errors.push(`Group "${group.name}" must have at least one subgroup`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/* ============================================================
      UTILITY FUNCTIONS
      ============================================================ */

// NOTE: sanitizeString and sanitizeTemplateName have been moved to utils/template-sanitizer.ts
// Re-export for backward compatibility
export { sanitizeString, sanitizeTemplateName } from '../utils/template-sanitizer';

export function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id
  );
}

export function isValidTime(time: string): boolean {
  return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time);
}

export function formatTimeDisplay(time: string): string {
  if (!time) return '--:--';
  if (time.includes('AM') || time.includes('PM')) return time;

  const [hours, minutes] = time.split(':').map(Number);
  if (isNaN(hours) || isNaN(minutes)) return time;

  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
}

export function calculateNetHours(
  startTime: string,
  endTime: string,
  unpaidBreakMinutes: number = 0
): number {
  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);

  if (isNaN(startH) || isNaN(startM) || isNaN(endH) || isNaN(endM)) {
    return 0;
  }

  let startMins = startH * 60 + startM;
  let endMins = endH * 60 + endM;

  if (endMins <= startMins) {
    endMins += 24 * 60;
  }

  const totalMins = endMins - startMins;
  const netMins = totalMins - (unpaidBreakMinutes || 0);

  return Math.round((netMins / 60) * 100) / 100;
}

export function formatDateForDb(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// NOTE: generateTempId and isTempId have been moved to utils/id-generator.ts
// Re-export for backward compatibility
export { generateTempId, isTempId } from '../utils/id-generator';

export function areTemplatesEqual(a: Template, b: Template): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function getTemplateStats(template: Template): {
  groupCount: number;
  subgroupCount: number;
  shiftCount: number;
} {
  const groupCount = template.groups.length;
  const subgroupCount = template.groups.reduce(
    (sum, g) => sum + g.subGroups.length,
    0
  );
  const shiftCount = template.groups.reduce(
    (sum, g) => sum + g.subGroups.reduce((s, sg) => s + sg.shifts.length, 0),
    0
  );
  return { groupCount, subgroupCount, shiftCount };
}
