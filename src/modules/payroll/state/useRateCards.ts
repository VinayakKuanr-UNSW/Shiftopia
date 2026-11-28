/**
 * useRateCards — the active organization's rate cards (drafts included for
 * payroll.manage holders) and the roll-forward / publish / discard actions.
 *
 * Publishing changes which rates price a period, so it also refreshes the
 * published schedules the rest of the rate-admin screen reads
 * (`eba-rate-schedule`, `eba-trainee-schedule`, see useEbaRates).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/platform/auth/useAuth';
import { allowsPayrollManageIn } from '@/platform/auth/accessSuites';
import {
  discardRateCard, listRateCards, publishRateCard, rollRateCardForward,
  type RateCard, type RollForwardInput,
} from '../data/rateCards.api';

export const RATE_CARDS_KEY = 'rate-cards';

export function useRateCards() {
  const { user, accessScope } = useAuth();
  const organizationId = accessScope?.organizationId ?? null;
  const queryClient = useQueryClient();

  const query = useQuery<RateCard[]>({
    queryKey: [RATE_CARDS_KEY, organizationId],
    queryFn: () => listRateCards(organizationId),
    enabled: organizationId !== null,
  });

  const refresh = (keys: string[]) =>
    Promise.all(keys.map((k) => queryClient.invalidateQueries({ queryKey: [k] })));

  const rollForward = useMutation({
    mutationFn: (input: RollForwardInput) => rollRateCardForward(input),
    onSuccess: () => refresh([RATE_CARDS_KEY]),
  });
  const publish = useMutation({
    mutationFn: (cardId: string) => publishRateCard(cardId),
    onSuccess: () => refresh([RATE_CARDS_KEY, 'eba-rate-schedule', 'eba-trainee-schedule']),
  });
  const discard = useMutation({
    mutationFn: (cardId: string) => discardRateCard(cardId),
    onSuccess: () => refresh([RATE_CARDS_KEY]),
  });

  return {
    cards: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    canManage: allowsPayrollManageIn(user?.certificates, organizationId),
    rollForward,
    publish,
    discard,
  };
}
