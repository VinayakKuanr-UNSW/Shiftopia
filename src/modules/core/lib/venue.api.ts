import { supabase } from '@/platform/supabase/client';
import { setVenues, type Venue } from './venue';

/**
 * Fill the venue registry (`venue.ts`) from the organizations RLS lets the user
 * read (`is_org_member`). A failure keeps the previous registry, and so the
 * Sydney fallback, rather than blocking sign-in; it is logged, not swallowed.
 */
export async function loadVenues(): Promise<void> {
  const { data, error } = await supabase
    .from('organizations')
    .select('id, timezone, jurisdiction');
  if (error) {
    console.error('[venue] could not load organization timezones:', error.message);
    return;
  }
  setVenues((data ?? []) as unknown as Venue[]);
}
