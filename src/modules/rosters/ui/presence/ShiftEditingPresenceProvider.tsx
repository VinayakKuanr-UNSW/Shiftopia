/**
 * ShiftEditingPresenceProvider — grid-level multi-channel presence manager.
 *
 * ⚠️ ADVISORY ONLY. Like {@link useShiftEditingPresence}, this NEVER gates writes
 * — the server-side version CAS in `sm_apply_shift_op` is the real concurrency
 * guarantee. This is a Google-Docs-style "someone else is editing this shift"
 * courtesy hint.
 *
 * Why a provider (vs. the single-scope hook): a roster grid shows a WEEK × one or
 * more departments at once, i.e. many `(department, date)` scopes simultaneously.
 * Each scope is one Supabase Realtime channel (`roster:{dept}:{date}`). Mounting
 * the single-channel hook per card would double-track presence for cards sharing a
 * scope. This provider instead opens ONE ref-counted channel per visible scope and
 * aggregates `editorsByShift` across all of them. Cards consume via
 * {@link useShiftPresence}, which registers/unregisters its scope on mount/unmount.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '@/platform/supabase/client';
import { useAuth } from '@/platform/auth/useAuth';
import type { ShiftEditor } from '../hooks/useShiftEditingPresence';

// ============================================================================
// TYPES
// ============================================================================

/** Presence payload one client tracks per shift it is editing (within a scope). */
interface PresenceMeta {
  shiftId: string;
  actorId: string;
  name: string;
  opIntent?: string;
}

/** One open Realtime channel for a `dept:date` scope, ref-counted by consumers. */
interface ScopeEntry {
  channel: RealtimeChannel;
  refCount: number;
  ready: boolean;
  /** shiftId → meta this client is currently broadcasting in this scope. */
  tracked: Map<string, PresenceMeta>;
}

interface PresenceContextValue {
  editorsByShift: Record<string, ShiftEditor[]>;
  register: (scopeKey: string) => void;
  unregister: (scopeKey: string) => void;
  setEditing: (scopeKey: string, shiftId: string, opIntent?: string) => void;
  clearEditing: (scopeKey: string, shiftId: string) => void;
  enabled: boolean;
}

const EMPTY_EDITORS: ShiftEditor[] = [];
const PresenceContext = createContext<PresenceContextValue | null>(null);

/** `${departmentId}:${shiftDate}` → the Realtime channel topic suffix. */
export function presenceScopeKey(departmentId: string, shiftDate: string): string {
  return `${departmentId}:${shiftDate}`;
}

// ============================================================================
// PROVIDER
// ============================================================================

export function ShiftEditingPresenceProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const actorId = user?.id ?? null;
  const actorName = user?.name ?? user?.email ?? 'Manager';
  const enabled = Boolean(actorId);

  const scopesRef = useRef<Map<string, ScopeEntry>>(new Map());
  const [editorsByShift, setEditorsByShift] = useState<Record<string, ShiftEditor[]>>({});

  // Keep the latest identity in a ref so the callbacks stay stable (a rename must
  // not recreate channels).
  const actorRef = useRef<{ id: string | null; name: string }>({ id: actorId, name: actorName });
  actorRef.current = { id: actorId, name: actorName };

  // ── Aggregate editorsByShift across EVERY open scope, excluding self ─────────
  const rebuild = useCallback(() => {
    const selfId = actorRef.current.id;
    const next: Record<string, ShiftEditor[]> = {};

    for (const entry of scopesRef.current.values()) {
      let state: Record<string, PresenceMeta[]>;
      try {
        state = entry.channel.presenceState<PresenceMeta>();
      } catch {
        // Advisory: a dropped packet can hand us a garbled state — skip this scope.
        continue;
      }

      for (const key of Object.keys(state)) {
        const metas = state[key];
        if (!Array.isArray(metas)) continue;
        for (const meta of metas) {
          if (!meta || typeof meta.shiftId !== 'string') continue;
          if (selfId && meta.actorId === selfId) continue; // only surface OTHERS
          const list = next[meta.shiftId] ?? (next[meta.shiftId] = []);
          if (!list.some((e) => e.actorId === meta.actorId)) {
            list.push({ actorId: meta.actorId, name: meta.name, opIntent: meta.opIntent });
          }
        }
      }
    }

    setEditorsByShift(next);
  }, []);

  // ── Broadcast this client's latest tracked intent for a scope ────────────────
  const pushScope = useCallback((scopeKey: string) => {
    const entry = scopesRef.current.get(scopeKey);
    const id = actorRef.current.id;
    if (!entry || !entry.ready || !id) return;

    if (entry.tracked.size === 0) {
      void entry.channel.untrack().catch(() => {/* advisory */});
      return;
    }
    // Most-recently-inserted entry wins (Map preserves insertion order).
    let latest: PresenceMeta | undefined;
    for (const meta of entry.tracked.values()) latest = meta;
    if (latest) void entry.channel.track(latest).catch(() => {/* advisory */});
  }, []);

  const register = useCallback((scopeKey: string) => {
    const id = actorRef.current.id;
    if (!id) return;

    const existing = scopesRef.current.get(scopeKey);
    if (existing) {
      existing.refCount += 1;
      return;
    }

    const channel = supabase.channel(`roster:${scopeKey}`, {
      config: { presence: { key: id } },
    });
    const entry: ScopeEntry = { channel, refCount: 1, ready: false, tracked: new Map() };
    scopesRef.current.set(scopeKey, entry);

    channel
      .on('presence', { event: 'sync' }, () => rebuild())
      .on('presence', { event: 'join' }, () => rebuild())
      .on('presence', { event: 'leave' }, () => rebuild())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          entry.ready = true;
          pushScope(scopeKey);
          rebuild();
        }
      });
  }, [rebuild, pushScope]);

  const unregister = useCallback((scopeKey: string) => {
    const entry = scopesRef.current.get(scopeKey);
    if (!entry) return;
    entry.refCount -= 1;
    if (entry.refCount > 0) return;

    scopesRef.current.delete(scopeKey);
    try {
      void supabase.removeChannel(entry.channel);
    } catch {/* advisory */}
    rebuild();
  }, [rebuild]);

  const setEditing = useCallback((scopeKey: string, shiftId: string, opIntent?: string) => {
    const entry = scopesRef.current.get(scopeKey);
    const id = actorRef.current.id;
    if (!entry || !id || !shiftId) return;
    entry.tracked.delete(shiftId);
    entry.tracked.set(shiftId, { shiftId, actorId: id, name: actorRef.current.name, opIntent });
    pushScope(scopeKey);
  }, [pushScope]);

  const clearEditing = useCallback((scopeKey: string, shiftId: string) => {
    const entry = scopesRef.current.get(scopeKey);
    if (!entry) return;
    entry.tracked.delete(shiftId);
    pushScope(scopeKey);
  }, [pushScope]);

  // Tear down every channel on provider unmount.
  useEffect(() => {
    const scopes = scopesRef.current;
    return () => {
      for (const entry of scopes.values()) {
        try {
          void supabase.removeChannel(entry.channel);
        } catch {/* advisory */}
      }
      scopes.clear();
    };
  }, []);

  const value = useMemo<PresenceContextValue>(
    () => ({ editorsByShift, register, unregister, setEditing, clearEditing, enabled }),
    [editorsByShift, register, unregister, setEditing, clearEditing, enabled],
  );

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

// ============================================================================
// CONSUMER HOOK
// ============================================================================

interface UseShiftPresenceResult {
  editors: ShiftEditor[];
  setEditing: (opIntent?: string) => void;
  clearEditing: () => void;
}

/**
 * Subscribe a single shift card to advisory editing presence. Registers the
 * card's `(department, date)` scope on mount (ref-counted; channels are shared
 * across cards in the same scope) and returns the OTHER managers editing this
 * shift. No-ops safely when there is no provider/actor (e.g. outside the planner).
 */
export function useShiftPresence(
  departmentId?: string | null,
  shiftDate?: string | null,
  shiftId?: string | null,
): UseShiftPresenceResult {
  const ctx = useContext(PresenceContext);
  const scopeKey =
    departmentId && shiftDate ? presenceScopeKey(departmentId, shiftDate) : null;

  const register = ctx?.register;
  const unregister = ctx?.unregister;
  const clearEditingCtx = ctx?.clearEditing;
  const setEditingCtx = ctx?.setEditing;
  const enabled = ctx?.enabled;

  useEffect(() => {
    if (!enabled || !register || !unregister || !scopeKey) return;
    register(scopeKey);
    return () => {
      // Stop broadcasting an edit intent for this shift when the card unmounts,
      // then release the scope (ref-counted; the channel closes at zero).
      if (shiftId && clearEditingCtx) {
        clearEditingCtx(scopeKey, shiftId);
      }
      unregister(scopeKey);
    };
  }, [enabled, register, unregister, clearEditingCtx, scopeKey, shiftId]);

  const editors =
    ctx && shiftId ? ctx.editorsByShift[shiftId] ?? EMPTY_EDITORS : EMPTY_EDITORS;

  const setEditing = useCallback(
    (opIntent?: string) => {
      if (setEditingCtx && scopeKey && shiftId) {
        setEditingCtx(scopeKey, shiftId, opIntent);
      }
    },
    [setEditingCtx, scopeKey, shiftId],
  );

  const clearEditing = useCallback(() => {
    if (clearEditingCtx && scopeKey && shiftId) {
      clearEditingCtx(scopeKey, shiftId);
    }
  }, [clearEditingCtx, scopeKey, shiftId]);

  return { editors, setEditing, clearEditing };
}
