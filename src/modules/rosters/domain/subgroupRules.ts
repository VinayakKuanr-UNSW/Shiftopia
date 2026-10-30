/**
 * Sub-group rules shared by the roster and the template editor.
 *
 * A template sub-group reaches a roster only by NAME: applying a template reuses
 * the roster sub-group with the same name in the same group, or creates one. So
 * the name is the key, compared trimmed and case-insensitively, as the database
 * does (unique index on (group, lower(name)) since 20261017111129).
 *
 * Office has exactly one sub-group, Administration, on rosters and templates
 * alike. The database refuses any other name and any direct delete; these
 * helpers let the UI not offer those actions in the first place.
 */

const OFFICE_GROUP_TYPE = 'office' as const;
export const OFFICE_SUBGROUP_NAME = 'Administration';

/**
 * A group's key from its external id or its display name:
 * 'office', 'Office' and ' The Cutaway ' become 'office' and 'the_cutaway'.
 * Matches the normalisation in apply_template_to_date_range_v2.
 */
export function groupKeyOf(nameOrType: string | null | undefined): string {
  return (nameOrType ?? '').trim().toLowerCase().replace(/\s+/g, '_');
}

/** Office's single sub-group cannot be added to, renamed, cloned or deleted. */
export function hasFixedSubgroup(nameOrType: string | null | undefined): boolean {
  return groupKeyOf(nameOrType) === OFFICE_GROUP_TYPE;
}
