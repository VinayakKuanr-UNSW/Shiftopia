/**
 * Allowances — a draft's eba_allowance lines (cl 28: meal, first aid per hour,
 * protein spill, split shift, or any other code). Edit in place, add, remove.
 */

import React, { useState } from 'react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/modules/core/ui/primitives/table';
import {
  deleteRateCardItems, upsertRateCardAllowances, type AllowanceLineInput, type RateCard, type RateCardAllowance,
} from '../../../../data/rateCards.api';
import { useDraftAction } from '../../../../state/useRateCards';
import { Field, ServerError, cellInputClass, fieldClass, nativeSelectClass } from './shared';

const UNITS = ['per_occasion', 'per_hour', 'per_shift'] as const;
type Edit = Partial<{ amount: string; unit: string; notes: string }>;
const label = (code: string) => code.replace(/_/g, ' ');

const AllowancesTab: React.FC<{ card: RateCard }> = ({ card }) => {
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [adding, setAdding] = useState({ code: '', amount: '', unit: 'per_occasion' });
  const [localError, setLocalError] = useState<string | null>(null);
  const { run, busy, error } = useDraftAction();
  const rows = [...card.allowances].sort((a, b) => a.code.localeCompare(b.code));
  const value = (a: RateCardAllowance) => {
    const e = edits[a.code] ?? {};
    return { amount: e.amount ?? String(a.amount), unit: e.unit ?? a.unit, notes: e.notes ?? a.notes ?? '' };
  };
  const edit = (a: RateCardAllowance, patch: Edit) => setEdits((all) => ({ ...all, [a.code]: { ...all[a.code], ...patch } }));
  const dirty = rows.filter((a) => edits[a.code] !== undefined);

  const toLine = (code: string, amount: string, unit: string, notes?: string): AllowanceLineInput | null => {
    const n = Number(amount);
    return amount.trim() !== '' && Number.isFinite(n) && n > 0 ? { code, amount: n, unit, ...(notes !== undefined ? { notes: notes.trim() || null } : {}) } : null;
  };

  const save = async () => {
    setLocalError(null);
    const lines = dirty.map((a) => { const v = value(a); return toLine(a.code, v.amount, v.unit, v.notes); });
    if (lines.some((l) => l === null)) { setLocalError('Amounts must be greater than 0.'); return; }
    if (await run(() => upsertRateCardAllowances(card.id, lines as AllowanceLineInput[]))) setEdits({});
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    const code = adding.code.trim().toLowerCase();
    const line = toLine(code, adding.amount, adding.unit);
    if (!/^[a-z][a-z0-9_]*$/.test(code) || !line) { setLocalError('Enter a code like meal and an amount greater than 0.'); return; }
    if (await run(() => upsertRateCardAllowances(card.id, [line]))) setAdding({ code: '', amount: '', unit: 'per_occasion' });
  };

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border/60 overflow-x-auto">
        <Table aria-label="Allowances">
          <TableHeader>
            <TableRow>
              <TableHead className="text-[12px]">Allowance</TableHead>
              <TableHead className="text-[12px]">Amount</TableHead>
              <TableHead className="text-[12px]">Unit</TableHead>
              <TableHead className="text-[12px]">Note</TableHead>
              <TableHead className="text-[12px] text-right"><span className="sr-only">Remove</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => {
              const v = value(a);
              return (
                <TableRow key={a.code} className={edits[a.code] ? 'bg-amber-500/5' : undefined}>
                  <TableCell className="text-[13px] font-medium capitalize">{label(a.code)}</TableCell>
                  <TableCell>
                    <Input aria-label={label(a.code) + ' amount'} className={cellInputClass} inputMode="decimal" value={v.amount}
                      onChange={(e) => edit(a, { amount: e.target.value })} />
                  </TableCell>
                  <TableCell>
                    <select aria-label={label(a.code) + ' unit'} className={nativeSelectClass + ' w-[150px]'} value={v.unit}
                      onChange={(e) => edit(a, { unit: e.target.value })}>
                      {UNITS.map((u) => <option key={u} value={u}>{label(u)}</option>)}
                    </select>
                  </TableCell>
                  <TableCell>
                    <Input aria-label={label(a.code) + ' note'} className="h-[36px] text-[13px]" value={v.notes}
                      onChange={(e) => edit(a, { notes: e.target.value })} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" disabled={busy} aria-label={'Remove ' + label(a.code)}
                      onClick={() => void run(() => deleteRateCardItems(card.id, [], [a.code]))}>Remove</Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-[13px] text-muted-foreground">No allowances yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <ServerError message={localError ?? error} />
      <div className="flex justify-end">
        <Button disabled={busy || dirty.length === 0} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save ' + dirty.length + ' change' + (dirty.length === 1 ? '' : 's')}
        </Button>
      </div>
      <form onSubmit={add} className="flex flex-wrap items-end gap-2 rounded-lg border border-border/60 p-3" aria-label="Add an allowance">
        <Field id="rc-add-allow-code" label="Code">
          <Input id="rc-add-allow-code" className={fieldClass + ' w-[180px]'} value={adding.code} placeholder="meal"
            onChange={(e) => setAdding((a) => ({ ...a, code: e.target.value }))} />
        </Field>
        <Field id="rc-add-allow-amount" label="Amount">
          <Input id="rc-add-allow-amount" className={fieldClass + ' w-[110px]'} inputMode="decimal" value={adding.amount}
            onChange={(e) => setAdding((a) => ({ ...a, amount: e.target.value }))} />
        </Field>
        <Field id="rc-add-allow-unit" label="Unit">
          <select id="rc-add-allow-unit" className={nativeSelectClass + ' w-[150px]'} value={adding.unit}
            onChange={(e) => setAdding((a) => ({ ...a, unit: e.target.value }))}>
            {UNITS.map((u) => <option key={u} value={u}>{label(u)}</option>)}
          </select>
        </Field>
        <Button type="submit" variant="outline" disabled={busy}>Add allowance</Button>
      </form>
    </div>
  );
};

export default AllowancesTab;
