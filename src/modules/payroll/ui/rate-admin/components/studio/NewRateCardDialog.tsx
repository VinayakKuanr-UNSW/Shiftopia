/**
 * NewRateCardDialog — a new DRAFT card: blank (the agreement's default
 * loadings, no rates yet — e.g. a new organization's first card) or a copy of
 * any card of this organization, choosing what to bring and an optional
 * multiplier. Rolling the next period forward stays on Roll forward.
 */

import React, { useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Checkbox } from '@/modules/core/ui/primitives/checkbox';
import { Input } from '@/modules/core/ui/primitives/input';
import { copyRateCard, createRateCard, type RateCard } from '../../../../data/rateCards.api';
import { useDraftAction } from '../../../../state/useRateCards';
import { latestPublished, validateNewCard, type NewCardErrors, type NewCardForm } from '../../rateCardMath';
import { Field, ServerError, fieldClass, nativeSelectClass } from './shared';

interface Props {
  onOpenChange: (open: boolean) => void;
  cards: RateCard[];
  organizationId: string;
  onCreated: (cardId: string) => void;
}

const NewRateCardDialog: React.FC<Props> = ({ onOpenChange, cards, organizationId, onCreated }) => {
  const [form, setForm] = useState<NewCardForm>({
    mode: cards.length > 0 ? 'copy' : 'blank', sourceCardId: latestPublished(cards)?.id ?? cards[0]?.id ?? '',
    code: '', name: '', validFrom: '', notes: '', rates: true, allowances: true, trainee: true, multiplier: '1',
  });
  const [errors, setErrors] = useState<NewCardErrors>({});
  const { run, busy, error } = useDraftAction();
  const set = (k: keyof NewCardForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validateNewCard(form, cards);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    let id = '';
    const ok = await run(async () => {
      id = form.mode === 'blank'
        ? await createRateCard({ organizationId, code: form.code, name: form.name, validFrom: form.validFrom, notes: form.notes })
        : await copyRateCard({
          sourceCardId: form.sourceCardId, code: form.code, name: form.name, validFrom: form.validFrom,
          rates: form.rates, allowances: form.allowances, trainee: form.trainee, multiplier: Number(form.multiplier),
        });
    });
    if (ok) { onCreated(id); onOpenChange(false); }
  };

  const toggle = (k: 'rates' | 'allowances' | 'trainee', label: string) => (
    <label className="flex items-center gap-2 text-[13px]">
      <Checkbox checked={form[k]} aria-label={label} onCheckedChange={(v) => setForm((f) => ({ ...f, [k]: v === true }))} />
      {label}
    </label>
  );

  return (
    <Dialog open onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="text-[15px]">New rate card</DialogTitle>
          <DialogDescription className="text-[13px]">
            It starts as a draft: nothing is priced from it until you publish it.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="flex gap-4 text-[13px]" role="radiogroup" aria-label="Start from">
            {(['copy', 'blank'] as const).map((m) => (
              <label key={m} className="flex items-center gap-2">
                <input type="radio" name="rc-mode" value={m} checked={form.mode === m} disabled={m === 'copy' && cards.length === 0}
                  onChange={() => setForm((f) => ({ ...f, mode: m }))} />
                {m === 'copy' ? 'Copy a card' : 'Blank card'}
              </label>
            ))}
          </div>
          {form.mode === 'copy' && (
            <>
              <Field id="rc-new-source" label="Copy from" error={errors.sourceCardId}>
                <select id="rc-new-source" className={nativeSelectClass} value={form.sourceCardId} onChange={set('sourceCardId')}>
                  {cards.map((c) => <option key={c.id} value={c.id}>{c.code} ({c.status})</option>)}
                </select>
              </Field>
              <div className="flex flex-wrap gap-4">
                {toggle('rates', 'Rates')}{toggle('allowances', 'Allowances')}{toggle('trainee', 'Trainee schedule')}
              </div>
              <Field id="rc-new-mult" label="Multiplier" error={errors.multiplier} hint="Money figures × this; loadings are copied as they are.">
                <Input id="rc-new-mult" className={fieldClass} inputMode="decimal" value={form.multiplier} onChange={set('multiplier')} />
              </Field>
            </>
          )}
          <Field id="rc-new-code" label="Code" error={errors.code}>
            <Input id="rc-new-code" className={fieldClass} value={form.code} onChange={set('code')} placeholder="BCEC-EA-2026" />
          </Field>
          <Field id="rc-new-name" label="Name" error={errors.name}>
            <Input id="rc-new-name" className={fieldClass} value={form.name} onChange={set('name')} />
          </Field>
          <Field id="rc-new-from" label="Applies from" error={errors.validFrom}>
            <Input id="rc-new-from" type="date" className={fieldClass} value={form.validFrom} onChange={set('validFrom')} />
          </Field>
          {form.mode === 'blank' && (
            <Field id="rc-new-notes" label="Notes">
              <Input id="rc-new-notes" className={fieldClass} value={form.notes} onChange={set('notes')} placeholder="e.g. FWC approval reference" />
            </Field>
          )}
          <ServerError message={error} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create draft'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default NewRateCardDialog;
