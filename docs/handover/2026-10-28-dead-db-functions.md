# Dead database functions: drop proposal (2026-10-28)

**Status: APPLIED 2026-10-28** as `supabase/migrations/20261028055110_drop_dead_functions.sql`, after re-checking that nothing depended on any of them. The held-back list below is still present.

## How "dead" was established

A function is listed only if all of these hold on the live Supabase database (read-only queries, 2026-10-28):

1. No trigger uses it (`pg_trigger`, every schema).
2. No other `public`/`hr` function body mentions its name. This matters because PL/pgSQL bodies are not dependency-tracked: a drop would succeed and the caller would fail at runtime.
3. No RLS policy, view, materialised view, column default, CHECK constraint or `cron.job` command mentions it.
4. No reference by name anywhere in `src/` (excluding generated types), live edge functions, `optimizer-service/`, `ml/`, `scripts/`, `e2e/`, `tests/`, `supabase/tests/` or `.github/`. No RPC name in the code is assembled at runtime.

## Held back (not in the SQL below)

| Function(s) | Why kept |
|---|---|
| `get_toil_balances`, `get_toil_lots`, `toil_adjust`, `toil_request_payout` | The TOIL app half was never committed; the DB half is deliberate. |
| `hr.reconcile_contract_access`, `user_has_delta_access` | Used by the `supabase/tests/access_matrix` SQL suite. |
| `can_change_certificate`, `can_grant_certificate`, `can_write_contract` | Written 2026-10-15 (access suites). Recent, so probably unfinished rather than abandoned. |
| `sm_require_template_create_in` | Written 2026-10-17 (template integrity). Same reason. |
| `delete_user_entirely` | Admin-only tool (no API grant), touched 2026-10-26. |
| `sm_finalize_planning_request` + tables `planning_requests`, `planning_offers` | The tables are empty and the client code was deleted in the sweep, but live `get_employee_shift_window` (swap-counterparty branch) and `can_act_on_planning_request` still read the tables. Drop them together with that branch, not before. |

## Exposure today

About 30 of these are executable by `anon` (none SECURITY DEFINER). About 55 are SECURITY DEFINER and executable by `authenticated`, among them `bulk_publish_shifts`, `sm_bulk_emergency_assign`, `sm_bulk_manager_cancel`, `toggle_roster_lock_for_range`, `delete_template_shifts_cascade`, `publish_template_range` and `unpublish_shift`. Several bypass `sm_apply_shift_op`. That is the main reason to drop them, rather than just tidiness.

## SQL (105 signatures, 99 names)

Plain `DROP FUNCTION` without `CASCADE` refuses if anything still depends on a function, so a missed dependent fails loudly instead of being dropped with it.

```sql
DROP FUNCTION public._can_manage_shifts();
DROP FUNCTION public.accept_swap_offer(p_offer_id uuid);
DROP FUNCTION public.acknowledge_broadcast(broadcast_uuid uuid, employee_uuid uuid);
DROP FUNCTION public.approve_swap_request(request_id uuid);
DROP FUNCTION public.assert_all_states(p_shift_ids uuid[], p_allowed_states text[]);
DROP FUNCTION public.assert_no_invalid_states();
DROP FUNCTION public.assert_shift_state(p_shift_id uuid, p_expected_state text);
DROP FUNCTION public.assign_employee_to_shift(p_roster_shift_id uuid, p_employee_id uuid, p_user_id uuid);
DROP FUNCTION public.assign_shift_rpc(p_shift_id uuid, p_employee_id uuid);
DROP FUNCTION public.auth_can_manage_rosters();
DROP FUNCTION public.bid_on_shift_rpc(p_shift_id uuid, p_employee_id uuid, p_priority integer);
DROP FUNCTION public.bulk_publish_shifts(p_shift_ids uuid[], p_actor_id uuid);
DROP FUNCTION public.caller_access_ceiling(p_org_id uuid);
DROP FUNCTION public.can_edit_roster_shift(p_roster_shift_id uuid);
DROP FUNCTION public.categorize_cancellation(p_cancelled_at timestamp with time zone, p_shift_start timestamp with time zone);
DROP FUNCTION public.check_shift_compliance(p_roster_shift_id uuid, p_employee_id uuid);
DROP FUNCTION public.check_shift_compliance(p_roster_shift_id uuid, p_employee_id uuid, p_role_id_override uuid, p_skill_ids_override uuid[], p_license_ids_override uuid[]);
DROP FUNCTION public.check_state_invariants();
DROP FUNCTION public.compute_prediction_outcomes(p_slice_minutes integer, p_only_event_id text);
DROP FUNCTION public.create_profile_for_user(p_user_id uuid, p_first_name text, p_last_name text, p_system_role system_role, p_employment_type employment_type);
DROP FUNCTION public.create_swap_rpc(p_requester_shift_id uuid, p_requester_id uuid, p_swap_type text, p_reason text);
DROP FUNCTION public.debug_states(p_shift_ids uuid[]);
DROP FUNCTION public.decline_shift_offer(p_shift_id uuid, p_employee_id uuid);
DROP FUNCTION public.delete_roster_subgroup(p_subgroup_id uuid);
DROP FUNCTION public.delete_template_shifts_cascade(p_template_id uuid);
DROP FUNCTION public.employee_cancel_shift(p_shift_id uuid, p_employee_id uuid, p_reason text);
DROP FUNCTION public.expire_locked_swaps();
DROP FUNCTION public.fn_bump_bid_policy_version();
DROP FUNCTION public.fn_bump_swap_policy_version();
DROP FUNCTION public.fn_bump_timesheet_policy_version();
DROP FUNCTION public.fn_calculate_performance_flag(p_reliability_score numeric, p_no_show_rate numeric, p_late_cancel_rate numeric);
DROP FUNCTION public.fn_calculate_performance_flag(p_reliability_score numeric, p_no_show_rate numeric, p_late_cancel_rate numeric, p_assigned_count integer);
DROP FUNCTION public.fn_get_shift_lock_statuses(p_shift_ids uuid[]);
DROP FUNCTION public.fn_swap_audit_immutable();
DROP FUNCTION public.get_eligible_employees_for_shift(p_shift_id uuid);
DROP FUNCTION public.get_my_department_ids();
DROP FUNCTION public.get_my_role();
DROP FUNCTION public.get_or_create_roster_day(p_organization_id uuid, p_date date, p_user_id uuid);
DROP FUNCTION public.get_performance_trends(p_employee_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_interval text);
DROP FUNCTION public.get_publish_target_state(p_has_assignment boolean, p_is_confirmed boolean, p_hours_until_start numeric);
DROP FUNCTION public.get_roster_day_publish_status(p_roster_day_id uuid);
DROP FUNCTION public.get_roster_day_shifts(p_roster_day_id uuid);
DROP FUNCTION public.get_roster_days_in_range(p_organization_id uuid, p_department_id uuid, p_sub_department_id uuid, p_start_date date, p_end_date date);
DROP FUNCTION public.get_roster_days_in_range(p_organization_id uuid, p_start_date date, p_end_date date);
DROP FUNCTION public.get_roster_shift_state(p_lifecycle text, p_has_assignment boolean, p_assignment_confirmed boolean);
DROP FUNCTION public.get_shift_flags(p_shift_id uuid);
DROP FUNCTION public.get_template_conflicts(p_template_id uuid, p_start_date date, p_end_date date);
DROP FUNCTION public.get_user_access_levels();
DROP FUNCTION public.get_user_access_levels(_user_id uuid);
DROP FUNCTION public.get_user_department_ids();
DROP FUNCTION public.get_user_role();
DROP FUNCTION public.has_permission(_user_id uuid, _target_sub_dept_id uuid, _required_level text);
DROP FUNCTION public.is_valid_uuid(str text);
DROP FUNCTION public.log_compliance_check(p_employee_id uuid, p_action_type text, p_shift_id uuid, p_candidate_shift jsonb, p_results jsonb, p_passed boolean);
DROP FUNCTION public.mark_broadcast_read(broadcast_uuid uuid, employee_uuid uuid);
DROP FUNCTION public.mark_shift_no_show(p_shift_id uuid);
DROP FUNCTION public.prevent_published_modification();
DROP FUNCTION public.process_shift_time_transitions();
DROP FUNCTION public.protect_fixed_roster_groups();
DROP FUNCTION public.protect_published_roster_shift();
DROP FUNCTION public.publish_template_range(p_template_id uuid, p_start_date date, p_end_date date, p_user_id uuid, p_force_override boolean);
DROP FUNCTION public.publish_template_range(p_template_id uuid, p_start_date date, p_end_date date, p_user_id uuid, p_force_override boolean, p_expected_version integer);
DROP FUNCTION public.push_shift_to_bidding_on_cancel(p_shift_id uuid, p_reason text);
DROP FUNCTION public.refresh_employee_performance_metrics(p_employee_id uuid);
DROP FUNCTION public.refresh_performance_snapshots();
DROP FUNCTION public.reject_shift_offer(p_shift_id uuid, p_employee_id uuid, p_reason text);
DROP FUNCTION public.reject_swap_request(request_id uuid, reason text);
DROP FUNCTION public.rename_roster_subgroup(p_subgroup_id uuid, p_new_name text);
DROP FUNCTION public.request_shift_trade(p_shift_id uuid, p_employee_id uuid);
DROP FUNCTION public.request_trade(p_shift_id uuid, p_target_employee_id uuid, p_actor_id uuid);
DROP FUNCTION public.resolve_changes_jsonb(p_changes jsonb);
DROP FUNCTION public.roster_update_timestamp();
DROP FUNCTION public.rpc_shift_coverage_stats(p_org_id uuid, p_date_from date, p_date_to date);
DROP FUNCTION public.safe_uuid(str text);
DROP FUNCTION public.seed_fixed_roster_groups();
DROP FUNCTION public.seed_fixed_template_groups();
DROP FUNCTION public.set_batch_id(batch_id uuid);
DROP FUNCTION public.set_roster_day_status(p_roster_day_id uuid, p_status roster_day_status, p_user_id uuid);
DROP FUNCTION public.sm_bulk_close_bidding(p_shift_ids uuid[], p_reason text, p_actor_id uuid);
DROP FUNCTION public.sm_bulk_emergency_assign(p_assignments jsonb, p_actor_id uuid);
DROP FUNCTION public.sm_bulk_manager_cancel(p_shift_ids uuid[], p_reason text, p_actor_id uuid);
DROP FUNCTION public.sm_cancel_shift(p_shift_id uuid, p_user_id uuid, p_reason text);
DROP FUNCTION public.sm_cancel_trade_request(p_shift_id uuid, p_user_id uuid, p_reason text);
DROP FUNCTION public.sm_clear_template_application(p_roster_id uuid, p_template_id uuid, p_user_id uuid);
DROP FUNCTION public.sm_complete_shift(p_shift_id uuid, p_user_id uuid);
DROP FUNCTION public.sm_employee_cancel(p_shift_id uuid, p_employee_id uuid);
DROP FUNCTION public.sm_employee_cancel(p_shift_id uuid, p_employee_id uuid, p_reason text);
DROP FUNCTION public.sm_expire_trade(p_shift_id uuid, p_user_id uuid);
DROP FUNCTION public.sm_mark_no_show(p_shift_id uuid, p_user_id uuid, p_reason text);
DROP FUNCTION public.sm_reject_trade(p_shift_id uuid, p_user_id uuid, p_reason text);
DROP FUNCTION public.state_machine_regression_snapshot_v3();
DROP FUNCTION public.toggle_roster_lock_for_range(p_org_id uuid, p_dept_id uuid, p_sub_dept_id uuid, p_start_date date, p_end_date date, p_lock_status boolean);
DROP FUNCTION public.trg_shift_assigned();
DROP FUNCTION public.trg_shift_cancelled();
DROP FUNCTION public.trigger_set_timestamp();
DROP FUNCTION public.unpublish_roster_day(p_roster_day_id uuid, p_unpublished_by_user_id uuid, p_reason text);
DROP FUNCTION public.unpublish_shift(p_shift_id uuid);
DROP FUNCTION public.update_shift_lifecycle_status();
DROP FUNCTION public.update_shift_templates_updated_at();
DROP FUNCTION public.user_has_any_contract(_user_id uuid);
DROP FUNCTION public.validate_rest_period(p_employee_id uuid, p_shift_date date, p_start_time time without time zone, p_end_time time without time zone, p_minimum_hours integer);
DROP FUNCTION public.validate_roster_shift_for_publish(p_roster_shift_id uuid);
DROP FUNCTION public.validate_shift_swap(p_swap_request_id uuid, p_employee_id uuid, p_shift_id uuid);
DROP FUNCTION public.validate_shift_transition(p_shift_id uuid, p_event_code text, p_allowed_states text[]);
DROP FUNCTION public.withdraw_shift_from_bidding(p_shift_id uuid, p_actor_id uuid);
```

After applying: regenerate `src/platform/supabase/types.ts` (or drop the matching `Functions` entries) and re-run `scripts/graphify/refresh.sh`.
