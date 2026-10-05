// ARCHIVED 2026-10-05 — verbatim copy of prod v6. NOT DEPLOYED. See ../README.md.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type RepeatType = "none" | "daily" | "weekly" | "fortnightly"

type AvailabilityRule = {
  id: string
  profile_id: string
  start_date: string
  start_time: string
  end_time: string
  repeat_type: RepeatType
  repeat_days: number[] | null
  repeat_end_date: string | null
}

const MAX_EXPANSION_DAYS = 90

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders })
  }

  // Log Auth Header to debug
  console.log("Authorization Header:", req.headers.get("Authorization"));

  const body = await req.json().catch(() => null)
  if (!body || !body.rule_id) {
    return new Response("Missing rule_id", { status: 400, headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )

  const { rule_id } = body

  // ----------------------------------------------------
  // 1. Fetch availability rule
  // ----------------------------------------------------

  const { data: rule, error: ruleError } = await supabase
    .from("availability_rules")
    .select("*")
    .eq("id", rule_id)
    .single<AvailabilityRule>()

  if (ruleError || !rule) {
    return new Response("Rule not found", { status: 404, headers: corsHeaders })
  }

  // ----------------------------------------------------
  // 2. Determine bounds
  // ----------------------------------------------------
  const startDate = new Date(rule.start_date)
  const endDate = rule.repeat_end_date
    ? new Date(rule.repeat_end_date)
    : new Date(startDate)

  const hardEnd = new Date()
  hardEnd.setDate(hardEnd.getDate() + MAX_EXPANSION_DAYS)

  const finalEnd = endDate < hardEnd ? endDate : hardEnd

  // ----------------------------------------------------
  // 3. Expand dates
  // ----------------------------------------------------

  const slots: any[] = []
  let cursor = new Date(startDate)

  const getDayOfWeek = (d: Date) => d.getDay()

  while (cursor <= finalEnd) {
    let include = false

    if (rule.repeat_type === "none") {
      include = cursor.toISOString().slice(0, 10) === rule.start_date
    }

    if (rule.repeat_type === "daily") {
      include = true
    }

    if (
      rule.repeat_type === "weekly" &&
      rule.repeat_days?.includes(getDayOfWeek(cursor))
    ) {
      include = true
    }

    if (
      rule.repeat_type === "fortnightly" &&
      rule.repeat_days?.includes(getDayOfWeek(cursor))
    ) {
        const diff = cursor.getTime() - startDate.getTime();
        const weeks = Math.floor(diff / (1000 * 60 * 60 * 24 * 7));
        include = weeks % 2 === 0
    }

    if (include) {
      slots.push({
        rule_id: rule.id,
        profile_id: rule.profile_id,
        slot_date: cursor.toISOString().slice(0, 10),
        start_time: rule.start_time,
        end_time: rule.end_time,
      })
    }

    cursor.setDate(cursor.getDate() + 1)
    if (rule.repeat_type === "none") break
  }

  // ----------------------------------------------------
  // 4. Bulk insert slots (idempotent)
  // ----------------------------------------------------

  if (slots.length > 0) {
    const { error: insertError } = await supabase
      .from("availability_slots")
      .insert(slots)

    if (insertError) {
      return new Response(insertError.message, { status: 500, headers: corsHeaders })
    }
  }

  return new Response(
    JSON.stringify({
      status: "ok",
      slots_created: slots.length,
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    }
  )
})
