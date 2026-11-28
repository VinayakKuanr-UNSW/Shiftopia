/**
 * Base rates — a draft's eba_rate lines, grouped as Schedule 2 groups them
 * (§1 general team members, §2 full-time security annualised). Edit a line
 * in place; a casual line's paid rate follows cl 12.5(b), ordinary × (1 +
 * casual loading), unless it is marked Manual. Select lines to raise or lower
 * them by a percentage, add or remove lines, or copy lines from another card.
 * Only unsaved changes are kept here, layered over the card.
 */

import React, { useMemo, useState } from 'react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Button } from '@/modules/core/ui/primitives/button';
import { Checkbox } from '@/modules/core/ui/primitives/checkbox';
import { Input } from '@/modules/core/ui/primitives/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/modules/core/ui/primitives/table';
import {
  bulkAdjustRateCardRates, copyRateCardItems, deleteRateCardItems, upsertRateCardRates,
  type EmploymentBasis, type RateCard, type RateCardRate, type RateLineInput,
} from '../../../../data/rateCards.api';
import { useDraftAction } from '../../../../state/useRateCards';
import { casualPaid, percentToMultiplier } from '../../rateCardMath';
import { CLASS_RANK, classLabel } from '../BaseRatesSection';
import { Field, ServerError, cellInputClass, fieldClass, money, nativeSelectClass } from './shared';

type Edit = Partial<{ ordinary: string; paid: string; override: boolean; notes: string }>;
const keyOf = (r: Pick<RateCardRate, 'classification' | 'employmentBasis'>) => r.classification + '|' + r.employmentBasis;
const isSecurity = (c: string) => c.startsWith('SECURITY_');
const positive = (s: string) => { const n = Number(s); return s.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null; };

interface RatesTabProps { card: RateCard; cards: RateCard[] }

const RatesTab: React.FC<RatesTabProps> = ({ card, cards }) => {
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pct, setPct] = useState('');
  const [adding, setAdding] = useState({ classification: '', basis: 'permanent' as EmploymentBasis, ordinary: '', paid: '' });
  const [copyFrom, setCopyFrom] = useState('');
  const [copyClasses, setCopyClasses] = useState<Set<string>>(new Set());
  const [localError, setLocalError] = useState<string | null>(null);
  const { run, busy, error } = useDraftAction();
  const casual = card.loadings?.casualLoading ?? null;

  const rows = useMemo(() => [...card.rates].sort((a, b) =>
    (CLASS_RANK[a.classification] ?? 99) - (CLASS_RANK[b.classification] ?? 99)
    || a.employmentBasis.localeCompare(b.employmentBasis)), [card.rates]);

  const value = (r: RateCardRate) => {
    const e = edits[keyOf(r)] ?? {};
    const ordinary = e.ordinary ?? String(r.ordinaryHourlyRate);
    const override = e.override ?? r.isManualOverride;
    const formula = r.employmentBasis === 'casual' && !override;
    const ord = Number(ordinary);
    const paid = formula
      ? (casual !== null && Number.isFinite(ord) ? casualPaid(ord, casual).toFixed(2) : '')
      : e.paid ?? String(r.paidHourlyRate);
    return { ordinary, paid, override, formula, notes: e.notes ?? r.notes ?? '' };
  };
  const edit = (r: RateCardRate, patch: Edit) =>
    setEdits((all) => ({ ...all, [keyOf(r)]: { ...all[keyOf(r)], ...patch } }));

  const dirty = rows.filter((r) => edits[keyOf(r)] !== undefined);

  const save = async () => {
    setLocalError(null);
    const lines: RateLineInput[] = [];
    for (const r of dirty) {
      const v = value(r);
      const ordinary = positive(v.ordinary);
      const paid = v.formula ? undefined : positive(v.paid);
      if (ordinary === null || paid === null) {
        setLocalError(classLabel(r.classification) + ' ' + r.employmentBasis + ': rates must be greater than 0.');
        return;
      }
      lines.push({
        classification: r.classification,
        employmentBasis: r.employmentBasis as EmploymentBasis,
        ordinaryHourlyRate: ordinary,
        ...(paid !== undefined ? { paidHourlyRate: paid } : {}),
        ...(r.employmentBasis === 'casual' ? { isManualOverride: v.override } : {}),
        notes: v.notes.trim() || null,
      });
    }
    if (await run(() => upsertRateCardRates(card.id, lines))) setEdits({});
  };

  const selectedClasses = [...new Set(rows.filter((r) => selected.has(keyOf(r))).map((r) => r.classification))];
  const multiplier = percentToMultiplier(pct);
  const adjust = async () => {
    if (multiplier === null || selectedClasses.length === 0) return;
    if (await run(() => bulkAdjustRateCardRates(card.id, selectedClasses, multiplier))) { setSelected(new Set()); setPct(''); }
  };

  const remove = (r: RateCardRate) => run(() => deleteRateCardItems(card.id, [r]));

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    const cls = adding.classification.trim().toUpperCase();
    const ordinary = positive(adding.ordinary);
    const paid = adding.paid.trim() === '' ? undefined : positive(adding.paid);
    if (!/^[A-Z][A-Z0-9_]*$/.test(cls) || ordinary === null || paid === null) {
      setLocalError('Enter a classification like LEVEL_8 and rates greater than 0.');
      return;
    }
    const line: RateLineInput = { classification: cls, employmentBasis: adding.basis, ordinaryHourlyRate: ordinary, ...(paid !== undefined ? { paidHourlyRate: paid } : {}) };
    if (await run(() => upsertRateCardRates(card.id, [line]))) setAdding({ classification: '', basis: 'permanent', ordinary: '', paid: '' });
  };

  const sources = cards.filter((c) => c.id !== card.id);
  const source = sources.find((c) => c.id === copyFrom);
  const sourceClasses = source ? [...new Set(source.rates.map((r) => r.classification))].sort((a, b) => (CLASS_RANK[a] ?? 99) - (CLASS_RANK[b] ?? 99)) : [];
  const copy = async () => {
    if (!source || copyClasses.size === 0) return;
    if (await run(() => copyRateCardItems(card.id, source.id, [...copyClasses]))) setCopyClasses(new Set());
  };

  let lastGroup: boolean | null = null;
  return (
    <div className="space-y-5">
      {casual === null && <ServerError message="This card has no loadings, so casual rates cannot be derived." />}
      <div className="rounded-lg border border-border/60 overflow-x-auto">
        <Table aria-label="Base rates">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[44px]"><span className="sr-only">Select</span></TableHead>
              <TableHead className="text-[12px]">Classification</TableHead>
              <TableHead className="text-[12px]">Basis</TableHead>
              <TableHead className="text-[12px]">Ordinary / hr</TableHead>
              <TableHead className="text-[12px]">Paid / hr</TableHead>
              <TableHead className="text-[12px]">Note</TableHead>
              <TableHead className="text-[12px] text-right"><span className="sr-only">Remove</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const v = value(r);
              const k = keyOf(r);
              const label = classLabel(r.classification) + ' ' + r.employmentBasis;
              const header = lastGroup !== isSecurity(r.classification);
              lastGroup = isSecurity(r.classification);
              return (
                <React.Fragment key={k}>
                  {header && (
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell colSpan={7} className="text-[12px] font-bold text-foreground">
                        {isSecurity(r.classification) ? 'Full-time security, annualised (Sch 2 §2)' : 'General team members (Sch 2 §1)'}
                      </TableCell>
                    </TableRow>
                  )}
                  <TableRow data-dirty={edits[k] ? 'true' : undefined} className={edits[k] ? 'bg-amber-500/5' : undefined}>
                    <TableCell>
                      <Checkbox aria-label={'Select ' + label} checked={selected.has(k)}
                        onCheckedChange={(c) => setSelected((s) => { const n = new Set(s); if (c) n.add(k); else n.delete(k); return n; })} />
                    </TableCell>
                    <TableCell className="text-[13px] font-medium">{classLabel(r.classification)}</TableCell>
                    <TableCell className="text-[13px] capitalize text-muted-foreground">{r.employmentBasis}</TableCell>
                    <TableCell>
                      <Input aria-label={label + ' ordinary rate'} className={cellInputClass} inputMode="decimal" value={v.ordinary}
                        onChange={(e) => edit(r, { ordinary: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {v.formula
                          ? <span className="text-[13px] tabular-nums text-muted-foreground" aria-label={label + ' paid rate'}>{v.paid ? money(Number(v.paid)) : '—'}</span>
                          : <Input aria-label={label + ' paid rate'} className={cellInputClass} inputMode="decimal" value={v.paid}
                              onChange={(e) => edit(r, { paid: e.target.value })} />}
                        {r.employmentBasis === 'casual' && (
                          <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                            <Checkbox aria-label={label + ' manual rate'} checked={v.override}
                              onCheckedChange={(c) => edit(r, { override: c === true, ...(c === true ? { paid: v.paid } : {}) })} />
                            Manual
                          </label>
                        )}
                        {v.override && <Badge variant="warning" className="text-[11px]">Manual</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Input aria-label={label + ' note'} className="h-[36px] text-[13px]" value={v.notes}
                        onChange={(e) => edit(r, { notes: e.target.value })} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void remove(r)} aria-label={'Remove ' + label}>Remove</Button>
                    </TableCell>
                  </TableRow>
                </React.Fragment>
              );
            })}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-[13px] text-muted-foreground">No rates yet. Add a line below or copy lines from another card.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <ServerError message={localError ?? error} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <Field id="rc-bulk-pct" label={'Adjust ' + selectedClasses.length + ' selected classification(s) by %'}
            hint="Every basis of each selected classification; casual lines on the formula follow.">
            <Input id="rc-bulk-pct" className={fieldClass + ' w-[120px]'} inputMode="decimal" value={pct}
              onChange={(e) => setPct(e.target.value)} placeholder="e.g. 4.2" />
          </Field>
          <Button variant="outline" disabled={busy || multiplier === null || selectedClasses.length === 0} onClick={() => void adjust()}>Apply</Button>
        </div>
        <Button disabled={busy || dirty.length === 0} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save ' + dirty.length + ' change' + (dirty.length === 1 ? '' : 's')}
        </Button>
      </div>

      <form onSubmit={add} className="flex flex-wrap items-end gap-2 rounded-lg border border-border/60 p-3" aria-label="Add a rate">
        <Field id="rc-add-class" label="Classification">
          <Input id="rc-add-class" className={fieldClass + ' w-[160px]'} value={adding.classification} placeholder="LEVEL_8"
            onChange={(e) => setAdding((a) => ({ ...a, classification: e.target.value }))} />
        </Field>
        <Field id="rc-add-basis" label="Basis">
          <select id="rc-add-basis" className={nativeSelectClass + ' w-[140px]'} value={adding.basis}
            onChange={(e) => setAdding((a) => ({ ...a, basis: e.target.value as EmploymentBasis }))}>
            <option value="permanent">permanent</option><option value="casual">casual</option><option value="annualised">annualised</option>
          </select>
        </Field>
        <Field id="rc-add-ord" label="Ordinary / hr">
          <Input id="rc-add-ord" className={fieldClass + ' w-[110px]'} inputMode="decimal" value={adding.ordinary}
            onChange={(e) => setAdding((a) => ({ ...a, ordinary: e.target.value }))} />
        </Field>
        <Field id="rc-add-paid" label="Paid / hr (optional)">
          <Input id="rc-add-paid" className={fieldClass + ' w-[110px]'} inputMode="decimal" value={adding.paid}
            onChange={(e) => setAdding((a) => ({ ...a, paid: e.target.value }))} />
        </Field>
        <Button type="submit" variant="outline" disabled={busy}>Add rate</Button>
      </form>

      {sources.length > 0 && (
        <div className="space-y-3 rounded-lg border border-border/60 p-3" role="group" aria-label="Copy lines">
          <Field id="rc-copy-from" label="Copy rates from another card">
            <select id="rc-copy-from" className={nativeSelectClass} value={copyFrom}
              onChange={(e) => { setCopyFrom(e.target.value); setCopyClasses(new Set()); }}>
              <option value="">Choose a card…</option>
              {sources.map((c) => <option key={c.id} value={c.id}>{c.code} ({c.status})</option>)}
            </select>
          </Field>
          {source && (
            <div className="flex flex-wrap gap-3">
              {sourceClasses.map((c) => (
                <label key={c} className="flex items-center gap-1.5 text-[13px]">
                  <Checkbox aria-label={'Copy ' + classLabel(c)} checked={copyClasses.has(c)}
                    onCheckedChange={(v) => setCopyClasses((s) => { const n = new Set(s); if (v) n.add(c); else n.delete(c); return n; })} />
                  {classLabel(c)}
                </label>
              ))}
            </div>
          )}
          <Button variant="outline" disabled={busy || !source || copyClasses.size === 0} onClick={() => void copy()}>
            Copy {copyClasses.size} classification{copyClasses.size === 1 ? '' : 's'}
          </Button>
        </div>
      )}
    </div>
  );
};

export default RatesTab;
