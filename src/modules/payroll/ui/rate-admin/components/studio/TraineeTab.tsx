/**
 * Apprentices & trainees — Schedule 4 apprentice rates as this card's own
 * Level 4 and Level 1 rates make them (nothing to edit: they move with the
 * rates), and the Schedule 5 trainee matrix, which can be taken from another
 * card. Schedule 6's SWS minimum lives on the Loadings tab.
 */

import React, { useState } from 'react';
import { Button } from '@/modules/core/ui/primitives/button';
import { updateRateCardTraineeSchedule, type RateCard } from '../../../../data/rateCards.api';
import { useDraftAction } from '../../../../state/useRateCards';
import { apprenticeRates } from '../../rateCardMath';
import { Field, ServerError, money, nativeSelectClass } from './shared';

const TraineeTab: React.FC<{ card: RateCard; cards: RateCard[] }> = ({ card, cards }) => {
  const [from, setFrom] = useState('');
  const { run, busy, error } = useDraftAction();
  const apprentices = apprenticeRates(card);
  const sources = cards.filter((c) => c.id !== card.id && c.trainee);
  const source = sources.find((c) => c.id === from);

  return (
    <div className="space-y-6">
      <section aria-label="Schedule 4 apprentices" className="space-y-2">
        <h4 className="text-[13px] font-bold text-foreground">Apprentices (Schedule 4)</h4>
        {apprentices.length === 0
          ? <p className="text-[13px] text-muted-foreground">Add Level 4 and Level 1 permanent rates to see apprentice rates.</p>
          : (
            <ul className="grid gap-1.5 md:grid-cols-2">
              {apprentices.map((a) => (
                <li key={a.label} className="flex justify-between gap-3 rounded-md border border-border/60 px-3 py-2 text-[13px]">
                  <span className="text-muted-foreground">{a.label}</span>
                  <span className="tabular-nums font-semibold text-foreground">{money(a.hourly)}/hr</span>
                </li>
              ))}
            </ul>
          )}
      </section>

      <section aria-label="Schedule 5 trainees" className="space-y-3">
        <h4 className="text-[13px] font-bold text-foreground">Trainees (Schedule 5)</h4>
        <p className="text-[13px] text-muted-foreground">
          {card.trainee ? 'Trainee schedule: ' + (card.trainee.label ?? 'untitled') + (card.trainee.source ? ' (' + card.trainee.source + ')' : '') : 'No trainee schedule on this card.'}
        </p>
        {sources.length > 0 && (
          <div className="flex flex-wrap items-end gap-2">
            <Field id="rc-trainee-from" label="Take the trainee schedule from">
              <select id="rc-trainee-from" className={nativeSelectClass + ' w-[260px]'} value={from} onChange={(e) => setFrom(e.target.value)}>
                <option value="">Choose a card…</option>
                {sources.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
              </select>
            </Field>
            <Button variant="outline" disabled={busy || !source}
              onClick={() => source?.trainee && void run(() => updateRateCardTraineeSchedule(card.id, { ...source.trainee!, label: card.name }))}>
              Use this schedule
            </Button>
          </div>
        )}
        <ServerError message={error} />
      </section>
    </div>
  );
};

export default TraineeTab;
