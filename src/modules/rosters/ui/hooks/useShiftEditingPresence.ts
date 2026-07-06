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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '@/platform/supabase/client';

// ============================================================================
// TYPES
// ============================================================================

export interface ShiftEditor {
  actorId: string;
  name: string;
  opIntent?: string;
}

/** What a single client tracks into presence for one shift it is editing. */
interface PresenceMeta {
  shiftId: string;
  actorId: string;
  name: string;
  opIntent?: string;
}

interface UseShiftEditingPresenceArgs {
  departmentId: string;
  shiftDate: string;
  actor: { id: string; name: string } | null;
}

interface UseShiftEditingPresenceResult {
  editorsByShift: Record<string, ShiftEditor[]>;
  setEditing: (shiftId: string, opIntent?: string) => void;
  clearEditing: (shiftId: string) => void;
}

// ============================================================================
// HOOK
// ============================================================================

export function useShiftEditingPresence(
  args: UseShiftEditingPresenceArgs,
): UseShiftEditingPresenceResult {
  const { departmentId, shiftDate, actor } = args;
  const actorId = actor?.id ?? null;
  const actorName = actor?.name ?? '';

  const [editorsByShift, setEditorsByShift] = useState<Record<string, ShiftEditor[]>>({});

  const channelRef = useRef<RealtimeChannel | null>(null);
  // Local map of shiftId → meta currently being tracked by THIS client, so we
  // can re-track the full set whenever it changes (presence.track replaces the
  // payload for our key wholesale, and one actor may edit >1 shift across tabs).
  const trackedRef = useRef<Map<string, PresenceMeta>>(new Map());
  // Keep the latest identity in a ref so the track helpers stay stable and
  // don't need to be recreated (which would tear the channel down) on rename.
  const actorRef = useRef<{ id: string; name: string } | null>(actor);
  actorRef.current = actor;

  const channelReadyRef = useRef(false);

  // ── Rebuild editorsByShift from the raw presence state, excluding self ──────
  const rebuild = useCallback(() => {
    const channel = channelRef.current;
    if (!channel) return;

    const selfId = actorRef.current?.id ?? null;
    const next: Record<string, ShiftEditor[]> = {};

    try {
      // presenceState() → Record<presenceKey, PresenceMeta[]>. Model the meta
      // shape narrowly; the runtime adds bookkeeping fields we ignore.
      const state = channel.presenceState<PresenceMeta>();

      for (const key of Object.keys(state)) {
        const entries = state[key];
        if (!Array.isArray(entries)) continue;

        for (const entry of entries) {
          if (!entry || typeof entry.shiftId !== 'string') continue;
          // Exclude the local actor — only surface OTHERS.
          if (selfId && entry.actorId === selfId) continue;

          const editor: ShiftEditor = {
            actorId: entry.actorId,
            name: entry.name,
            opIntent: entry.opIntent,
          };

          const list = next[entry.shiftId] ?? (next[entry.shiftId] = []);
          // De-dupe by actorId (same manager in two tabs on the same shift).
          if (!list.some((e) => e.actorId === editor.actorId)) {
            list.push(editor);
          }
        }
      }
    } catch {
      // Realtime occasionally hands us a partial/garbled state on a dropped
      // packet. Advisory only — swallow and keep the last good map.
      return;
    }

    setEditorsByShift(next);
  }, []);

  // ── Push the current tracked set into presence (replaces our key's payload) ──
  // Supabase presence stores a single payload per key, so when a client edits
  // more than one shift we track the MOST RECENT intent. (In practice a manager
  // edits one shift at a time; multi-shift collapses to the latest.)
  const pushTracked = useCallback(() => {
    const channel = channelRef.current;
    const id = actorRef.current?.id;
    if (!channel || !channelReadyRef.current || !id) return;

    const tracked = trackedRef.current;
    if (tracked.size === 0) {
      void channel.untrack().catch(() => {/* advisory: ignore */});
      return;
    }

    // Most recently inserted entry wins as the broadcast payload.
    let latest: PresenceMeta | undefined;
    for (const meta of tracked.values()) latest = meta;
    if (!latest) return;

    void channel.track(latest).catch(() => {/* advisory: ignore */});
  }, []);

  const setEditing = useCallback(
    (shiftId: string, opIntent?: string) => {
      const id = actorRef.current?.id;
      const name = actorRef.current?.name ?? '';
      if (!id || !shiftId) return; // no-op when actor is null

      // Re-insert to make this the latest entry (Map preserves insertion order).
      trackedRef.current.delete(shiftId);
      trackedRef.current.set(shiftId, { shiftId, actorId: id, name, opIntent });
      pushTracked();
    },
    [pushTracked],
  );

  const clearEditing = useCallback(
    (shiftId: string) => {
      if (!shiftId) return;
      trackedRef.current.delete(shiftId);
      pushTracked();
    },
    [pushTracked],
  );

  // ── Join / leave the channel ────────────────────────────────────────────────
  useEffect(() => {
    // Guard: no actor, or missing scope → don't open a channel at all.
    if (!actorId || !departmentId || !shiftDate) {
      setEditorsByShift({});
      return;
    }

    let cancelled = false;
    const channelName = `roster:${departmentId}:${shiftDate}`;

    const channel = supabase.channel(channelName, {
      config: { presence: { key: actorId } },
    });

    channelRef.current = channel;
    channelReadyRef.current = false;

    channel
      .on('presence', { event: 'sync' }, () => {
        if (!cancelled) rebuild();
      })
      .on('presence', { event: 'join' }, () => {
        if (!cancelled) rebuild();
      })
      .on('presence', { event: 'leave' }, () => {
        if (!cancelled) rebuild();
      })
      .subscribe((status) => {
        if (cancelled) return;
        if (status === 'SUBSCRIBED') {
          channelReadyRef.current = true;
          // Flush anything that was requested before we were ready.
          pushTracked();
          rebuild();
        }
      });

    return () => {
      cancelled = true;
      channelReadyRef.current = false;
      channelRef.current = null;
      trackedRef.current.clear();
      // removeChannel both untracks presence and unsubscribes.
      try {
        void supabase.removeChannel(channel);
      } catch {
        /* advisory: ignore teardown errors */
      }
    };
    // actorName intentionally excluded — a rename should NOT recreate the
    // channel; actorRef keeps the latest name for subsequent track() calls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorId, departmentId, shiftDate, rebuild, pushTracked]);

  return useMemo(
    () => ({ editorsByShift, setEditing, clearEditing }),
    [editorsByShift, setEditing, clearEditing],
  );
}
