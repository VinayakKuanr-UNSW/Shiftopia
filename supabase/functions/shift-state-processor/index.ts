import { createClient } from 'npm:@supabase/supabase-js@2.50.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl) throw new Error('[FATAL] Missing SUPABASE_URL');
if (!supabaseServiceKey) throw new Error('[FATAL] Missing SUPABASE_SERVICE_ROLE_KEY');

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const now = new Date();
    const logs: string[] = [];

    // ── Pass 1: Urgency escalation S5 → S6 at TTS ≤ 24h ──────────────────────
    // Legacy: shifts still stored as on_bidding_normal escalate to on_bidding_urgent.
    // New shifts use unified on_bidding; urgency is derived client-side from TTS.
    const { data: escalated, error: escalateError } = await supabase
      .from('shifts')
      .update({ bidding_status: 'on_bidding_urgent', updated_at: now.toISOString() })
      .eq('lifecycle_status', 'Published')
      .eq('bidding_status', 'on_bidding_normal')
      .lte(
        'start_at',
        new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      )
      .select('id');

    if (escalateError) {
      logs.push(`[WARN] Urgency escalation error: ${escalateError.message}`);
    } else {
      const count = escalated?.length ?? 0;
      if (count > 0) logs.push(`[INFO] Escalated ${count} shift(s) to on_bidding_urgent (legacy)`);
    }

    // ── Pass 2: Offer expiry S3 → S1 at TTS ≤ 4h ─────────────────────────────
    // Offered shifts (assignment_outcome='offered') revert to Draft+Unassigned.
    // DB trigger trg_offer_expired_notification fires per-row and notifies the employee.
    const { data: offersExpired, error: offerExpireError } = await supabase
      .from('shifts')
      .update({
        lifecycle_status:     'Draft',
        is_draft:             true,
        assignment_outcome:   null,
        assignment_status:    'unassigned',
        assigned_employee_id: null,
        assigned_at:          null,
        bidding_status:       'not_on_bidding',
        updated_at:           now.toISOString(),
      })
      .eq('lifecycle_status', 'Published')
      .eq('assignment_outcome', 'offered')
      .lte(
        'start_at',
        new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString(),
      )
      .select('id');

    if (offerExpireError) {
      logs.push(`[WARN] Offer expiry error: ${offerExpireError.message}`);
    } else {
      const count = offersExpired?.length ?? 0;
      if (count > 0) logs.push(`[INFO] Expired ${count} offer(s) → Draft+Unassigned (S1)`);
    }

    // ── Pass 3: Bidding expiry S5/S6 → S1 at TTS ≤ 4h ───────────────────────
    // Shifts on bidding (any status variant) with no winner revert to Draft+Unassigned.
    // DB trigger trg_bidding_expired_notification fires per-row and notifies the manager.
    const { data: biddingExpired, error: biddingExpireError } = await supabase
      .from('shifts')
      .update({
        lifecycle_status:  'Draft',
        is_draft:          true,
        bidding_status:    'not_on_bidding',
        assignment_status: 'unassigned',
        updated_at:        now.toISOString(),
      })
      .eq('lifecycle_status', 'Published')
      .in('bidding_status', ['on_bidding_normal', 'on_bidding_urgent', 'on_bidding'])
      .lte(
        'start_at',
        new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString(),
      )
      .select('id');

    if (biddingExpireError) {
      logs.push(`[WARN] Bidding expiry error: ${biddingExpireError.message}`);
    } else {
      const count = biddingExpired?.length ?? 0;
      if (count > 0) logs.push(`[INFO] Expired ${count} bidding shift(s) → Draft+Unassigned (S1)`);
    }

    // ── Pass 4: Swap expiry at TTS ≤ 4h ──────────────────────────────────────
    // OPEN / MANAGER_PENDING swaps whose linked shift starts within 4h are cancelled.
    // DB trigger trg_swap_expired_notification fires per-row and notifies the requester.
    const { data: expiredSwaps, error: swapExpireError } = await supabase
      .rpc('expire_locked_swaps') as any;

    if (swapExpireError) {
      logs.push(`[WARN] Swap expiry error: ${swapExpireError.message}`);
    } else {
      const count = (expiredSwaps as any[])?.length ?? 0;
      if (count > 0) logs.push(`[INFO] Expired ${count} swap request(s) → EXPIRED (TTS ≤ 4h)`);
    }

    const summary = {
      success:          true,
      timestamp:        now.toISOString(),
      updatedUrgency:   escalated?.length ?? 0,
      expiredOffers:    offersExpired?.length ?? 0,
      expiredBidding:   biddingExpired?.length ?? 0,
      expiredSwaps:     (expiredSwaps as any[])?.length ?? 0,
      logs,
    };

    console.log(JSON.stringify(summary));

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('shift-state-processor error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
