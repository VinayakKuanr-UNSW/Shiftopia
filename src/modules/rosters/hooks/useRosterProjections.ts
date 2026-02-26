/**
 * useRosterProjections — the single memoised projection hook
 *
 * Call this once in the roster page component.  Pass it the raw server data;
 * it applies active filters, runs the active mode's projector, and returns
 * the fully-typed projection plus overall stats.
 *
 * Architecture:
 *  - Filters are applied first (pure, O(n)) so projectors never see stale data.
 *  - Only the ACTIVE mode's projector runs on each render.  The other three
 *    return null, eliminating wasted computation for invisible views.
 *  - `stats` is always computed from the FILTERED shift set so the header
 *    counters are consistent with whatever is on screen.
 *  - Every useMemo dependency is either a stable primitive or a referentially-
 *    stable array from a TanStack Query cache (no inline object construction).
 *
 * Usage:
 *   const { group, people, events, roles, stats, activeMode } =
 *     useRosterProjections({ shifts, employees, roles, levels, events, rosterStructures });
 */

import { useMemo } from 'react';
import { useRosterStore }  from '../state/useRosterStore';
import { applyAdvancedFilters } from '../domain/projections/utils/filters';
import { projectGroup }  from '../domain/projections/projectors/group.projector';
import { projectPeople } from '../domain/projections/projectors/people.projector';
import { projectEvents } from '../domain/projections/projectors/events.projector';
import { projectRoles }  from '../domain/projections/projectors/roles.projector';
import { buildStats }    from '../domain/projections/projectors/shared';
import type { ProjectionInput, ProjectionResult } from '../domain/projections/types';

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useRosterProjections(input: ProjectionInput): ProjectionResult {
  // ── Store subscriptions (granular — never pull the whole store) ─────────────
  const activeMode      = useRosterStore(s => s.activeMode);
  const advancedFilters = useRosterStore(s => s.advancedFilters);

  const {
    shifts           = [],
    employees        = [],
    roles            = [],
    levels           = [],
    events           = [],
    rosterStructures = [],
  } = input;

  // ── 1. Filter ──────────────────────────────────────────────────────────────
  // Returns original reference unchanged when no filters are active (zero alloc).
  const filteredShifts = useMemo(
    () => applyAdvancedFilters(shifts, advancedFilters),
    [shifts, advancedFilters],
  );

  // ── 2. Top-level stats (always computed, shown in header regardless of mode) ─
  const stats = useMemo(
    () => buildStats(filteredShifts),
    [filteredShifts],
  );

  // ── 3. Mode-specific projections (lazy — only the active mode runs) ────────

  const group = useMemo(
    () => activeMode === 'group'
      ? projectGroup(filteredShifts, { rosterStructures })
      : null,
    // rosterStructures is stable from useRosterStructure (TanStack cache ref)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredShifts, activeMode, rosterStructures],
  );

  const people = useMemo(
    () => activeMode === 'people'
      ? projectPeople(filteredShifts, { employees })
      : null,
    [filteredShifts, activeMode, employees],
  );

  const eventsProjection = useMemo(
    () => activeMode === 'events'
      ? projectEvents(filteredShifts, { events })
      : null,
    [filteredShifts, activeMode, events],
  );

  const rolesProjection = useMemo(
    () => activeMode === 'roles'
      ? projectRoles(filteredShifts, { roles, levels })
      : null,
    [filteredShifts, activeMode, roles, levels],
  );

  // ── 4. Assemble result ────────────────────────────────────────────────────
  return {
    activeMode,
    group,
    people,
    events: eventsProjection,
    roles:  rolesProjection,
    stats,
  };
}
