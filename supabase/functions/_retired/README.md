# Retired edge functions

Verbatim copies of edge functions that ran in production but were never in
this repository, archived on 2026-10-05 before each was replaced by a stub
that returns **410 Gone** (with `verify_jwt` on). They are kept for history
only — nothing here is deployed, and `supabase functions deploy` ignores this
folder's `_`-prefixed name.

| Function | Last prod version | Why it was retired |
|---|---|---|
| `autoschedule-simulate` | v45 | No authentication (`verify_jwt` off), service role. Returned staff names and the roster snapshot hash for any organisation and created an `autoschedule_sessions` row. |
| `autoschedule-save-draft` | v5 | No authentication, service role. |
| `autoschedule-commit` | v7 | No authentication, service role. Wrote assignments straight into `shifts`, bypassing `sm_apply_shift_op`, the shift FSM and every compliance check. With `simulate` it let anyone on the internet auto-assign every open shift in any organisation. |
| `autoschedule-baseline` | v5 | No authentication, service role. Returned roster counts and per-employee hours for any organisation. No caller. |
| `expand-availability-slots` | v6 | No authentication, service role. Inserted `availability_slots` for any rule id, and logged the raw `Authorization` header (user tokens) to the function logs. No caller. |
| `shift-state-processor` | v8 | `verify_jwt` on, but the anon key passes it, and the service role did the writes. Unscheduled: cron runs `sm_run_state_processor()` in SQL instead (migration 20260713000200 already called this function "fully redundant"). Also dead: its first query selected `final_call_sent_at`, dropped 2026-06-19, so every call 500'd. Had it worked it would have bypassed `sm_apply_shift_op`. |
| `shift-lifecycle-updater` | v6 | Same exposure. Unscheduled and uncalled: cron runs `sm_handle_auto_clock_out()` / `process_shift_timers()`. Its no-show pass wrote `shifts` directly and ignored approved leave, so any holder of the anon key could mark staff on approved leave as no-shows. `index.ts` is prod v6; `repo-version.ts` is the repo's drifted copy, which also auto-approved timesheets. |

`shift-state-processor/index.ts` and `shift-lifecycle-updater/repo-version.ts`
were moved here from `supabase/functions/` so they cannot be redeployed by a
blanket `supabase functions deploy`.

The edge-function autoscheduler had no UI entry point: `AutoScheduleModal` was
imported nowhere in this app or the almond fork. The production autoscheduler
is the Python optimizer service. See migration
`20261005071543_close_edge_function_attack_surface.sql`, which also closed the
`autoschedule_sessions` / `autoschedule_assignments` tables (their RLS allowed
any signed-in user to write the `simulation_result` that `commit` trusted).

Note: `simulate`'s `cost.ts` carries two known pay bugs fixed elsewhere —
hard-coded hourly rates keyed by legacy level UUIDs, and `hd.isHoliday()`
treating observances (e.g. Mother's Day) as public holidays.
