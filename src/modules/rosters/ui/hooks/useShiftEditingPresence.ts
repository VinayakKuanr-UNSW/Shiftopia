/**
 * useShiftEditingPresence — ADVISORY "another manager is editing this shift"
 * presence layer (Google-Docs-style avatars) on top of Supabase Realtime.
 *
 * ⚠️ ADVISORY ONLY. This NEVER blocks or gates writes. The server-side version
 * CAS is the real concurrency guarantee. Presence is purely a courtesy hint so a
 * manager can see when a colleague is poking at the same shift. Dropped packets,
 * disconnects, or a missing actor must degrade gracefully (no-op, never throw).
 *
 * Channel:  `roster:${departmentId}:${shiftDate}` — one channel per visible
 *           department/date grid. Presence is keyed by actorId (so a manager
 *           open in two tabs collapses to one presence entry per shift intent).
 *
 * Tracked payload shape (per presence key = actorId):
 *   { shiftId, actorId, name, opIntent }
 *
 * On presence `sync`, we rebuild `editorsByShift` (Record<shiftId, ShiftEditor[]>)
 * EXCLUDING the local actor — you only ever want to see OTHERS editing.
 */



// ============================================================================
// TYPES
// ============================================================================

export interface ShiftEditor {
  actorId: string;
  name: string;
  opIntent?: string;
}




// ============================================================================
// HOOK
// ============================================================================

