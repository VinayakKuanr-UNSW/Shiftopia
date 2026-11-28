/**
 * RollForwardDialog — makes the next period's card as a DRAFT through
 * roll_rate_card_forward: every rate, allowance and trainee figure of the
 * source × the multiplier, rounded to cents. Nothing is priced from it until
 * it is published. The parent mounts it only while open, so each opening
 * starts from a fresh form (default source: the latest published card).
 */

import React, { useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { cn } from '@/modules/core/lib/utils';
import { rateCardErrorMessage, type RateCard, type RollForwardInput } from '../../../data/rateCards.api';
import {
  iccCl251Multiplier, latestPublished, validateRollForward,
  type RollForwardErrors, type RollForwardForm,
} from '../rateCardMath';

interface RollForwardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cards: RateCard[];
  onSubmit: (input: RollForwardInput) => Promise<unknown>;
}

const emptyForm = (cards: RateCard[]): RollForwardForm => ({
  sourceCardId: latestPublished(cards)?.id ?? '',
  code: '',
  name: '',
  validFrom: '',
  multiplier: '',
});

const fieldClass = 'h-[44px] md:h-[36px] text-[13px]';

const FieldError: React.FC<{ id: string; message?: string }> = ({ id, message }) =>
  message ? <p id={id} className="text-[12px] text-destructive">{message}</p> : null;

const RollForwardDialog: React.FC<RollForwardDialogProps> = ({ open, onOpenChange, cards, onSubmit }) => {
  const [form, setForm] = useState<RollForwardForm>(() => emptyForm(cards));
  const [cpi, setCpi] = useState('');
  const [errors, setErrors] = useState<RollForwardErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (field: keyof RollForwardForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const applyCpi = () => {
    const value = Number(cpi);
    if (cpi.trim() === '' || !Number.isFinite(value)) {
      setErrors((e) => ({ ...e, multiplier: 'Enter the CPI change as a percentage, e.g. 3.7.' }));
      return;
    }
    setForm((f) => ({ ...f, multiplier: String(iccCl251Multiplier(value)) }));
    setErrors((e) => ({ ...e, multiplier: undefined }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validateRollForward(form, cards);
    setErrors(found);
    setServerError(null);
    if (Object.keys(found).length > 0) return;
    setSubmitting(true);
    try {
      await onSubmit({
        sourceCardId: form.sourceCardId,
        code: form.code,
        name: form.name,
        validFrom: form.validFrom,
        multiplier: Number(form.multiplier),
      });
      onOpenChange(false);
    } catch (err) {
      setServerError(rateCardErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const published = cards.filter((c) => c.status === 'published');
  const m = Number(form.multiplier);
  const preview = form.multiplier.trim() !== '' && Number.isFinite(m) && m > 0
    ? `${m >= 1 ? '+' : ''}${(Math.round((m - 1) * 10000) / 100).toFixed(2)}% on every rate and allowance`
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Roll a card forward</DialogTitle>
          <DialogDescription className="text-[13px]">
            Makes a draft card for the next period: every rate, allowance and trainee figure of the source
            × the multiplier, rounded to cents. Nothing is priced from it until you publish it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} noValidate className="space-y-4" aria-label="Roll forward">
          <div className="space-y-1.5">
            <Label htmlFor="rf-source" className="text-[13px] font-semibold">Source card</Label>
            <select
              id="rf-source"
              value={form.sourceCardId}
              onChange={set('sourceCardId')}
              aria-invalid={!!errors.sourceCardId}
              aria-describedby="rf-source-error"
              className={cn(
                'flex w-full rounded-md border border-input bg-background px-3 text-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', fieldClass,
              )}
            >
              <option value="">Choose a card…</option>
              {published.map((c) => (
                <option key={c.id} value={c.id}>{c.code} — from {c.validFrom}</option>
              ))}
            </select>
            <FieldError id="rf-source-error" message={errors.sourceCardId} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="rf-code" className="text-[13px] font-semibold">Code</Label>
              <Input id="rf-code" value={form.code} onChange={set('code')} placeholder="ICC-EA-2027-28"
                aria-invalid={!!errors.code} aria-describedby="rf-code-error" className={fieldClass} />
              <FieldError id="rf-code-error" message={errors.code} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rf-valid-from" className="text-[13px] font-semibold">Applies from</Label>
              <Input id="rf-valid-from" type="date" value={form.validFrom} onChange={set('validFrom')}
                aria-invalid={!!errors.validFrom} aria-describedby="rf-valid-from-error" className={fieldClass} />
              <FieldError id="rf-valid-from-error" message={errors.validFrom} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rf-name" className="text-[13px] font-semibold">Name</Label>
            <Input id="rf-name" value={form.name} onChange={set('name')} placeholder="ICC Sydney Enterprise Agreement 2027–28"
              aria-invalid={!!errors.name} aria-describedby="rf-name-error" className={fieldClass} />
            <FieldError id="rf-name-error" message={errors.name} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rf-multiplier" className="text-[13px] font-semibold">Multiplier</Label>
            <Input id="rf-multiplier" inputMode="decimal" value={form.multiplier} onChange={set('multiplier')} placeholder="1.042"
              aria-invalid={!!errors.multiplier} aria-describedby="rf-multiplier-error rf-multiplier-preview" className={fieldClass} />
            <FieldError id="rf-multiplier-error" message={errors.multiplier} />
            {preview && <p id="rf-multiplier-preview" className="text-[12px] text-muted-foreground">{preview}</p>}
          </div>

          {/* Optional helper: one agreement's indexation rule, labelled as such. */}
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2">
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">ICC Sydney EA cl 25.1</span> — rates rise by CPI plus
              0.5 percentage points: multiplier = 1 + (CPI + 0.5) / 100. This is that agreement's rule; other
              agreements index differently.
            </p>
            <div className="flex items-end gap-2">
              <div className="space-y-1 flex-1">
                <Label htmlFor="rf-cpi" className="text-[12px] font-semibold text-muted-foreground">CPI change (%)</Label>
                <Input id="rf-cpi" inputMode="decimal" value={cpi} onChange={(e) => setCpi(e.target.value)} placeholder="3.7" className={fieldClass} />
              </div>
              <Button type="button" variant="outline" onClick={applyCpi}>Use cl 25.1</Button>
            </div>
          </div>

          {serverError && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
              {serverError}
            </p>
          )}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
            <Button type="submit" disabled={submitting}>{submitting ? 'Creating draft…' : 'Create draft'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default RollForwardDialog;
