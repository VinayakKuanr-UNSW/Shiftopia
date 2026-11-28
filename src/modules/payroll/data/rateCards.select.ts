/**
 * The PostgREST select the rate-admin screen reads cards with. Kept apart from
 * rateCards.api.ts (which imports the app's Supabase client) and free of path
 * aliases, so the HTTP integration suite can import the exact string and
 * prove every column it names exists — PostgREST reads one bad name as an error.
 */

import { RATE_CARD_LOADINGS_SELECT } from '../../rosters/domain/projections/utils/cost/loadings';

export const RATE_CARD_SELECT =
  'id, code, name, valid_from, valid_to, status, derivation, published_at, '
  + 'eba_rate(classification, employment_basis, ordinary_hourly_rate, paid_hourly_rate), '
  + 'eba_allowance(code, amount, unit), '
  + `pay_rate_card_loadings(${RATE_CARD_LOADINGS_SELECT})`;
