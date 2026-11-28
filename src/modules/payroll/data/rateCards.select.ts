/**
 * The PostgREST select the rate-admin screen reads cards with. Kept apart from
 * rateCards.api.ts (which imports the app's Supabase client) and free of path
 * aliases, so the HTTP integration suite can import the exact string and
 * prove every column it names exists — PostgREST reads one bad name as an error.
 */

import { RATE_CARD_LOADINGS_SELECT } from '../../rosters/domain/projections/utils/cost/loadings';

export const RATE_CARD_SELECT =
  'id, organization_id, code, name, currency, rule_set, valid_from, valid_to, status, derivation, published_at, '
  + 'notes, award_floor_checked_at, '
  + 'eba_rate(classification, employment_basis, ordinary_hourly_rate, paid_hourly_rate, is_manual_override, notes), '
  + 'eba_allowance(code, amount, unit, notes), '
  + 'eba_trainee_schedule(label, source, matrix), '
  + `pay_rate_card_loadings(${RATE_CARD_LOADINGS_SELECT})`;
