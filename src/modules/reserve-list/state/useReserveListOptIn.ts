/**
 * Employee opt-in toggle for Reserve List — "are you willing to receive
 * emergency replacement requests?" OFF by default; never appears in a
 * Reserve List search until switched ON (see
 * docs/investigations/2026-07-21_reserve-list-audit-and-implementation-plan.md §8).
 *
 * Stored at `profiles.preferences.reserve_list.opt_in` — reusing the existing
 * jsonb preferences column (already defaults to `{"notifications": {...}}`)
 * rather than adding a new table/column.
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/platform/supabase/client';
import { requireUser } from '@/platform/supabase/rpc/client';

interface ProfilePreferences {
  reserve_list?: { opt_in?: boolean };
  [key: string]: unknown;
}

export function useReserveListOptIn() {
  const [optIn, setOptInState] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const user = await requireUser();
      const { data, error } = await supabase
        .from('profiles')
        .select('preferences')
        .eq('id', user.id)
        .single();
      if (error) throw error;
      const preferences = (data?.preferences ?? {}) as ProfilePreferences;
      setOptInState(preferences.reserve_list?.opt_in === true);
    } catch (e) {
      console.error('[useReserveListOptIn] Failed to load preference:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setOptIn = useCallback(async (value: boolean) => {
    setSaving(true);
    const previous = optIn;
    setOptInState(value); // optimistic
    try {
      const user = await requireUser();
      const { data, error: fetchError } = await supabase
        .from('profiles')
        .select('preferences')
        .eq('id', user.id)
        .single();
      if (fetchError) throw fetchError;

      const preferences = (data?.preferences ?? {}) as ProfilePreferences;
      const nextPreferences: ProfilePreferences = {
        ...preferences,
        reserve_list: { ...preferences.reserve_list, opt_in: value },
      };

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ preferences: nextPreferences })
        .eq('id', user.id);
      if (updateError) throw updateError;
    } catch (e) {
      console.error('[useReserveListOptIn] Failed to save preference:', e);
      setOptInState(previous); // roll back optimistic update
      throw e;
    } finally {
      setSaving(false);
    }
  }, [optIn]);

  return { optIn, setOptIn, loading, saving };
}
