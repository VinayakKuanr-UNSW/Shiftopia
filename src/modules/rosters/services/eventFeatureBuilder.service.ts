/**
 * Demand Engine L1 — Event feature builder.
 *
 * Reads a venueops_events row plus the L1 columns added in migration
 * 20260502000010 and produces an EventFeatureForRules suitable for the L3
 * rule engine.
 *
 * Slice window:
 *   - slice_idx is 0..47 on a 30-min, midnight-anchored grid.
 *   - The active window is [start - bump_in, end + bump_out], clipped to one
 *     calendar day. Events that cross midnight are clipped at 23:30 (Sydney
 *     local) — multi-day events are handled per-date by the caller.
 */

import { fromZonedTime } from 'date-fns-tz';
import type { EventFeatureForRules } from '../domain/ruleEngine.types';

const ICC_TIMEZONE = 'Australia/Sydney';
const SLICES_PER_DAY = 48;
const MINUTES_PER_SLICE = 30;

export interface VenueopsEventL1Row {
    event_id: string;
    name: string;
    start_date_time: string;
    end_date_time: string;
    estimated_total_attendance: number;
    event_type_name: string | null;
    venue_names: string | null;
    /** Phase-1-D columns; nullable for legacy rows. */
    service_type: 'buffet' | 'plated' | 'cocktail' | 'none' | null;
    alcohol: boolean | null;
    bump_in_min: number | null;
    bump_out_min: number | null;
    layout_complexity: 'simple' | 'standard' | 'complex' | null;
}

/**
 * Build an EventFeatureForRules from a venueops row.
 *
 * @param row    The L1-extended venueops_events row.
 * @param onDate ISO date (YYYY-MM-DD) — slices are computed in Sydney-local
 *               time on this date. Multi-day events should call this once per
 *               date with the same row.
 */
export function buildEventFeature(
    row: VenueopsEventL1Row,
    onDate: string,
): EventFeatureForRules {
    const startMs = new Date(row.start_date_time).getTime();
    const endMs = new Date(row.end_date_time).getTime();
    const bumpInMin = Math.max(0, row.bump_in_min ?? 0);
    const bumpOutMin = Math.max(0, row.bump_out_min ?? 0);

    // Effective window with bump-in/bump-out
    const effStartMs = startMs - bumpInMin * 60_000;
    const effEndMs = endMs + bumpOutMin * 60_000;

    const dayStartMs = fromZonedTime(`${onDate}T00:00:00`, ICC_TIMEZONE).getTime();
    const dayEndMs = dayStartMs + SLICES_PER_DAY * MINUTES_PER_SLICE * 60_000;

    // Clip to the calendar date in Sydney-local time.
    const clippedStartMs = Math.max(effStartMs, dayStartMs);
    const clippedEndMs = Math.min(effEndMs, dayEndMs - 1);

    // Map to slice indices. If the clipped window is empty (event ends before
    // dayStart or starts after dayEnd), produce an empty range; the rule
    // executor will then emit zero cells, which the caller filters out.
    let firstSlice = 0;
    let lastSlice = -1;
    if (clippedStartMs <= clippedEndMs) {
        firstSlice = msToSliceIdx(clippedStartMs, dayStartMs);
        lastSlice = msToSliceIdx(clippedEndMs, dayStartMs);
    }

    return {
        event_id: row.event_id,
        event_type: row.event_type_name,
        pax: row.estimated_total_attendance ?? 0,
        start_iso: row.start_date_time,
        end_iso: row.end_date_time,
        duration_min: Math.max(0, Math.round((endMs - startMs) / 60_000)),
        service_type: row.service_type,
        alcohol: row.alcohol ?? false,
        room_count: deriveRoomCount(row.venue_names),
        // No source field yet — TODO once data audit lands; rules can still
        // gate via room_count for now.
        total_sqm: 0,
        bump_in_min: bumpInMin,
        bump_out_min: bumpOutMin,
        layout_complexity: row.layout_complexity,
        first_slice_idx: firstSlice,
        last_slice_idx: lastSlice,
    };
}

function msToSliceIdx(ms: number, dayStartMs: number): number {
    const sliceMs = MINUTES_PER_SLICE * 60_000;
    const idx = Math.floor((ms - dayStartMs) / sliceMs);
    return Math.max(0, Math.min(SLICES_PER_DAY - 1, idx));
}

/** Count unique venues from a semicolon-separated venue_names string. */
export function deriveRoomCount(venueNames: string | null): number {
    if (!venueNames) return 1;
    const rooms = venueNames
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
    return Math.max(1, rooms.length);
}
