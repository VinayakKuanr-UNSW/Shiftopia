/**
 * Loadings & rules — the card's pay_rate_card_loadings: penalty and night
 * loadings (cl 41, 43), overtime (cl 42), minimum engagements (cl 12, 56.2),
 * caps, higher duties (cl 29), leave loading (cl 44.7) and the SWS minimum
 * (Sch 6). Percentages are typed as percent (25 = 25%). The database's CHECKs
 * are the bounds; it refuses anything outside them.
 */

import React, { useState } from 'react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import type { RateCardLoadings } from '@/modules/rosters/domain/projections/utils/cost/loadings';
import { updateRateCardLoadings, type RateCard } from '../../../../data/rateCards.api';
import { useDraftAction } from '../../../../state/useRateCards';
import { LOADING_FIELDS, inputToLoading, loadingToInput } from '../../rateCardMath';
import { Field, ServerError, fieldClass } from './shared';

const SUFFIX = { percent: '%', multiplier: '×', hours: 'h', minutes: 'min', dollars: '$' } as const;

const LoadingsTab: React.FC<{ card: RateCard }> = ({ card }) => {
  const [edits, setEdits] = useState<Partial<Record<keyof RateCardLoadings, string>>>({});
  const [localError, setLocalError] = useState<string | null>(null);
  const { run, busy, error } = useDraftAction();
  const loadings = card.loadings;
  if (!loadings) return <ServerError message="This card has no loadings, so it cannot be published." />;

  const dirtyKeys = Object.keys(edits) as Array<keyof RateCardLoadings>;
  const save = async () => {
    setLocalError(null);
    const patch: Partial<RateCardLoadings> = {};
    for (const key of dirtyKeys) {
      const field = LOADING_FIELDS.find((f) => f.key === key)!;
      const v = inputToLoading(field.unit, edits[key] ?? '');
      if (v === null) { setLocalError(field.label + ': enter a number of 0 or more.'); return; }
      patch[key] = v;
    }
    if (await run(() => updateRateCardLoadings(card.id, patch))) setEdits({});
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {LOADING_FIELDS.map((f) => (
          <Field key={f.key} id={'rc-l-' + f.key} label={f.label + ' (' + SUFFIX[f.unit] + ')'}>
            <Input id={'rc-l-' + f.key} className={fieldClass + (edits[f.key] !== undefined ? ' border-amber-500/60' : '')}
              inputMode="decimal" value={edits[f.key] ?? loadingToInput(f.unit, loadings[f.key])}
              onChange={(e) => setEdits((all) => ({ ...all, [f.key]: e.target.value }))} />
          </Field>
        ))}
      </div>
      <ServerError message={localError ?? error} />
      <div className="flex justify-end">
        <Button disabled={busy || dirtyKeys.length === 0} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save ' + dirtyKeys.length + ' change' + (dirtyKeys.length === 1 ? '' : 's')}
        </Button>
      </div>
    </div>
  );
};

export default LoadingsTab;
