/**
 * Details — a draft's code, name, currency, period and notes, and the cl 25.3
 * check (rates must sit at least 2% above the prevailing Award). Saved with
 * update_rate_card_meta; a published card cannot change (the database locks it).
 */

import React, { useState } from 'react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Checkbox } from '@/modules/core/ui/primitives/checkbox';
import { Input } from '@/modules/core/ui/primitives/input';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { updateRateCardMeta, type RateCard } from '../../../../data/rateCards.api';
import { useDraftAction } from '../../../../state/useRateCards';
import { Field, ServerError, fieldClass } from './shared';

const DetailsTab: React.FC<{ card: RateCard }> = ({ card }) => {
  const [form, setForm] = useState({
    code: card.code, name: card.name, currency: card.currency,
    validFrom: card.validFrom, validTo: card.validTo ?? '', notes: card.notes ?? '',
    awardFloorChecked: card.awardFloorCheckedAt !== null,
  });
  const { run, busy, error } = useDraftAction();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    void run(() => updateRateCardMeta(card.id, {
      code: form.code, name: form.name, currency: form.currency.toUpperCase(),
      validFrom: form.validFrom, validTo: form.validTo || null, notes: form.notes || null,
      awardFloorChecked: form.awardFloorChecked,
    }));
  };

  return (
    <form onSubmit={save} className="space-y-4" aria-label="Card details">
      <div className="grid gap-4 md:grid-cols-2">
        <Field id="rc-code" label="Code"><Input id="rc-code" className={fieldClass} value={form.code} onChange={set('code')} /></Field>
        <Field id="rc-name" label="Name"><Input id="rc-name" className={fieldClass} value={form.name} onChange={set('name')} /></Field>
        <Field id="rc-currency" label="Currency"><Input id="rc-currency" className={fieldClass} value={form.currency} onChange={set('currency')} maxLength={3} /></Field>
        <Field id="rc-rule-set" label="Rule set" hint="How loadings combine (cl 41.4 maximum, cl 43 night rule). Fixed per agreement.">
          <Input id="rc-rule-set" className={fieldClass} value={card.ruleSet} disabled />
        </Field>
        <Field id="rc-from" label="Applies from"><Input id="rc-from" type="date" className={fieldClass} value={form.validFrom} onChange={set('validFrom')} /></Field>
        <Field id="rc-to" label="Applies until" hint="Leave empty: open-ended until a later card is published.">
          <Input id="rc-to" type="date" className={fieldClass} value={form.validTo} onChange={set('validTo')} />
        </Field>
      </div>
      <Field id="rc-notes" label="Notes" hint="e.g. the FWC approval reference.">
        <Textarea id="rc-notes" className="text-[13px]" value={form.notes} onChange={set('notes')} rows={2} />
      </Field>
      <label className="flex items-start gap-3 rounded-lg border border-border/60 p-3 text-[13px]">
        <Checkbox
          checked={form.awardFloorChecked}
          onCheckedChange={(v) => setForm((f) => ({ ...f, awardFloorChecked: v === true }))}
          aria-label="Award floor checked"
        />
        <span>
          <span className="font-semibold text-foreground">Award floor checked (cl 25.3)</span>
          <span className="block text-muted-foreground">
            Every rate on this card is at least 2% above the Amusement, Events and Recreation Award rate in force.
            {card.awardFloorCheckedAt && ' Confirmed ' + new Date(card.awardFloorCheckedAt).toLocaleDateString('en-AU') + '.'}
          </span>
        </span>
      </label>
      <ServerError message={error} />
      <div className="flex justify-end"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save details'}</Button></div>
    </form>
  );
};

export default DetailsTab;
