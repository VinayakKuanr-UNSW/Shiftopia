import { useMemo, useState, useEffect, useRef } from 'react';
import { useRosterStore } from '../state/useRosterStore';
import { applyAdvancedFilters } from '../domain/projections/utils/filters';
import { buildStats } from '../domain/projections/projectors/shared';
import type { 
  ProjectionInput, 
  ProjectionResult, 
  PeopleProjection, 
  ProjectedEmployee, 
  GroupProjection, 
  EventsProjection, 
  RolesProjection 
} from '../domain/projections/types';
import { ProjectionWorkerPool } from '../domain/projections/worker/projection.worker.pool';
import { 
  shiftsToDTO, 
  employeesToDTO, 
  filtersToDTO, 
  rolesToDTO, 
  levelsToDTO, 
  eventsToDTO, 
  rosterStructuresToDTO 
} from '../domain/projections/worker/mappers';
import type { ProjectionResult as WorkerResult, ProjectedShiftResult } from '../domain/projections/worker/protocol';

export function useRosterProjections(input: ProjectionInput): ProjectionResult {
  const activeMode = useRosterStore(s => s.activeMode);
  const advancedFilters = useRosterStore(s => s.advancedFilters);

  const {
    shifts = [],
    employees = [],
    roles = [],
    levels = [],
    events = [],
    rosterStructures = [],
  } = input;

  // ── Synchronous fallback (initial load) ──
  const filteredShifts = useMemo(
    () => applyAdvancedFilters(shifts, advancedFilters),
    [shifts, advancedFilters],
  );

  const syncStats = useMemo(
    () => buildStats(filteredShifts),
    [filteredShifts],
  );

  // ── Worker Pool Setup ──
  const poolRef = useRef<ProjectionWorkerPool | null>(null);
  if (!poolRef.current) {
    poolRef.current = new ProjectionWorkerPool({ poolSize: 4, debounceMs: 50 });
  }

  // ── Asynchronous State (for Worker-powered modes) ──
  const [workerPeople, setWorkerPeople] = useState<PeopleProjection | null>(null);
  const [workerGroup, setWorkerGroup] = useState<GroupProjection | null>(null);
  const [workerEvents, setWorkerEvents] = useState<EventsProjection | null>(null);
  const [workerRoles, setWorkerRoles] = useState<RolesProjection | null>(null);
  const [workerStats, setWorkerStats] = useState(syncStats);

  useEffect(() => {
    if (shifts.length === 0) {
      setWorkerPeople(null);
      setWorkerGroup(null);
      setWorkerEvents(null);
      setWorkerRoles(null);
      setWorkerStats(syncStats);
      return;
    }

    const pool = poolRef.current;
    if (!pool) return;

    // 1. Convert to DTOs
    const shiftDTOs = shiftsToDTO(shifts);
    const filterDTOs = filtersToDTO(advancedFilters);
    
    // We only construct the DTOs needed for the active mode to save main thread time
    let employeeDTOs: any[] = [];
    let roleDTOs: any[] = [];
    let levelDTOs: any[] = [];
    let eventDTOs: any[] = [];
    let rosterStructureDTOs: any[] = [];

    if (activeMode === 'people') employeeDTOs = employeesToDTO(employees);
    if (activeMode === 'roles') {
      roleDTOs = rolesToDTO(roles);
      levelDTOs = levelsToDTO(levels);
    }
    if (activeMode === 'events') eventDTOs = eventsToDTO(events);
    if (activeMode === 'group') rosterStructureDTOs = rosterStructuresToDTO(rosterStructures);

    // 2. Setup callback
    pool.onResult = (result: WorkerResult) => {
      // Create an O(1) lookup map for fast re-hydration
      const shiftMap = new Map(shifts.map(s => [s.id, s]));

      // Helper to map shift DTOs back to full shift entities
      const mapShifts = (dtoShifts: ProjectedShiftResult[]) => {
        return dtoShifts.map(ps => {
          return { ...ps, raw: shiftMap.get(ps.id) };
        });
      };

      // 3. Map DTOs back to UI format by attaching .raw
      if (result.people && activeMode === 'people') {
        const peopleResult = result.people as PeopleProjection;
        const mappedEmployees: ProjectedEmployee[] = peopleResult.employees.map(emp => {
          const newShifts: Record<string, any[]> = {};
          for (const [date, psArray] of Object.entries(emp.shifts)) {
            newShifts[date] = mapShifts(psArray as unknown as ProjectedShiftResult[]);
          }
          return { ...emp, shifts: newShifts };
        });
        setWorkerPeople({ ...peopleResult, employees: mappedEmployees });
      }

      if (result.group && activeMode === 'group') {
        const groupResult = result.group as GroupProjection;
        const mappedGroups = groupResult.groups.map(g => {
          const mappedSubGroups = g.subGroups.map(sg => {
            const newShifts: Record<string, any[]> = {};
            for (const [date, psArray] of Object.entries(sg.shiftsByDate)) {
              newShifts[date] = mapShifts(psArray as unknown as ProjectedShiftResult[]);
            }
            return { ...sg, shiftsByDate: newShifts };
          });
          return { ...g, subGroups: mappedSubGroups };
        });
        setWorkerGroup({ ...groupResult, groups: mappedGroups });
      }

      if (result.events && activeMode === 'events') {
        const eventsResult = result.events as EventsProjection;
        const mappedEvents = eventsResult.events.map(ev => {
          return { ...ev, shifts: mapShifts(ev.shifts as unknown as ProjectedShiftResult[]) as any };
        });
        setWorkerEvents({ ...eventsResult, events: mappedEvents });
      }

      if (result.roles && activeMode === 'roles') {
        const rolesResult = result.roles as RolesProjection;
        const mappedLevels = rolesResult.levels.map(lvl => {
          const mappedRoles = lvl.roles.map(r => {
            const newShifts: Record<string, any[]> = {};
            for (const [date, psArray] of Object.entries(r.shiftsByDate)) {
              newShifts[date] = mapShifts(psArray as unknown as ProjectedShiftResult[]);
            }
            return { ...r, shiftsByDate: newShifts };
          });
          return { ...lvl, roles: mappedRoles };
        });
        const mappedUnassigned = rolesResult.unassignedRoles.map(r => {
          const newShifts: Record<string, any[]> = {};
          for (const [date, psArray] of Object.entries(r.shiftsByDate)) {
            newShifts[date] = mapShifts(psArray as unknown as ProjectedShiftResult[]);
          }
          return { ...r, shiftsByDate: newShifts };
        });
        setWorkerRoles({ ...rolesResult, levels: mappedLevels, unassignedRoles: mappedUnassigned });
      }

      // Map worker stats back to UI format
      setWorkerStats({
        totalShifts: result.stats.totalShifts,
        assignedShifts: result.stats.assignedShifts,
        openShifts: result.stats.openShifts,
        publishedShifts: result.stats.publishedShifts,
        totalNetMinutes: result.stats.totalNetMinutes,
        estimatedCost: result.stats.estimatedCost,
        costBreakdown: result.stats.costBreakdown,
      });
    };

    // 4. Dispatch
    pool.requestProjection({
      mode: activeMode,
      shifts: shiftDTOs,
      employees: employeeDTOs,
      roles: roleDTOs,
      levels: levelDTOs,
      events: eventDTOs,
      rosterStructures: rosterStructureDTOs,
      filters: filterDTOs,
      nowIso: new Date().toISOString(),
    });

  }, [shifts, employees, roles, levels, events, rosterStructures, advancedFilters, activeMode]);

  // Clean up pool on unmount
  useEffect(() => {
    return () => {
      poolRef.current?.dispose();
      poolRef.current = null;
    };
  }, []);

  return {
    activeMode,
    group: activeMode === 'group' ? workerGroup : null,
    people: activeMode === 'people' ? workerPeople : null,
    events: activeMode === 'events' ? workerEvents : null,
    roles: activeMode === 'roles' ? workerRoles : null,
    stats: workerStats,
  };
}
