/**
 * Shift cost sandbox — one shift priced twice by the database's own engine
 * (fn_eba_estimate_shift_cost): on this draft and on the published card that
 * covers the same date, so the effect of every rate and loading edit shows
 * before anything is published. Each card prices with its own rate for the
 * chosen line.
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import {
  estimateShiftCost, getOrganizationJurisdiction, rateCardErrorMessage, type RateCard, type SandboxShift,
} from '../../../../data/rateCards.api';
import { classLabel } from '../BaseRatesSection';
import { Field, ServerError, fieldClass, money, nativeSelectClass } from './shared';

/** The published card whose period covers `date`, if any. */
export const publishedOn = (cards: readonly RateCard[], date: string) =>
  cards.find((c) => c.status === 'published' && c.validFrom <= date && (c.validTo === null || date <= c.validTo)) ?? null;

const lineRate = (card: RateCard, key: string) =>
  card.rates.find((r) => r.classification + '|' + r.employmentBasis === key)?.paidHourlyRate ?? null;

interface Result { draft: number | null; current: number | null; currentCode: string | null }

const CostSandbox: React.FC<{ card: RateCard; cards: RateCard[] }> = ({ card, cards }) => {
  const lines = card.rates.map((r) => ({ key: r.classification + '|' + r.employmentBasis, r }));
  const [line, setLine] = useState(lines.find((l) => l.r.employmentBasis === 'casual')?.key ?? lines[0]?.key ?? '');
  const [date, setDate] = useState(card.validFrom);
  const [start, setStart] = useState('09:00');
  const [hours, setHours] = useState('7');
  const [empType, setEmpType] = useState<'FT' | 'PT'>('FT');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const jurisdiction = useQuery({
    queryKey: ['organization-jurisdiction', card.organizationId],
    queryFn: () => getOrganizationJurisdiction(card.organizationId),
  });

  if (lines.length === 0) return <p className="text-[13px] text-muted-foreground">Add a rate to price a shift.</p>;
  const basis = line.split('|')[1];

  const price = async () => {
    setError(null);
    setResult(null);
    const minutes = Math.round(Number(hours) * 60);
    if (!(minutes > 0) || !/^\d{2}:\d{2}$/.test(start) || !date) { setError('Enter a date, a start time and hours greater than 0.'); return; }
    if (!jurisdiction.data) { setError('This organization has no public-holiday jurisdiction set, so shifts cannot be priced.'); return; }
    const current = publishedOn(cards.filter((c) => c.id !== card.id), date);
    const shift = (baseRate: number): SandboxShift => ({
      shiftDate: date, startTime: start, minutes, baseRate, employmentType: basis === 'casual' ? 'Casual' : empType,
    });
    setBusy(true);
    try {
      const draftRate = lineRate(card, line);
      const currentRate = current ? lineRate(current, line) : null;
      const [d, c] = await Promise.all([
        draftRate === null ? null : estimateShiftCost(card.id, jurisdiction.data, shift(draftRate)),
        current && currentRate !== null ? estimateShiftCost(current.id, jurisdiction.data, shift(currentRate)) : null,
      ]);
      setResult({ draft: d, current: c, currentCode: current?.code ?? null });
    } catch (err) {
      setError(rateCardErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const delta = result && result.draft !== null && result.current !== null ? result.draft - result.current : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Field id="rc-sb-line" label="Rate line">
          <select id="rc-sb-line" className={nativeSelectClass} value={line} onChange={(e) => setLine(e.target.value)}>
            {lines.map((l) => <option key={l.key} value={l.key}>{classLabel(l.r.classification)} · {l.r.employmentBasis}</option>)}
          </select>
        </Field>
        <Field id="rc-sb-date" label="Shift date"><Input id="rc-sb-date" type="date" className={fieldClass} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field id="rc-sb-start" label="Starts"><Input id="rc-sb-start" type="time" className={fieldClass} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field id="rc-sb-hours" label="Paid hours"><Input id="rc-sb-hours" className={fieldClass} inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
        {basis !== 'casual' && (
          <Field id="rc-sb-emp" label="Employment">
            <select id="rc-sb-emp" className={nativeSelectClass} value={empType} onChange={(e) => setEmpType(e.target.value as 'FT' | 'PT')}>
              <option value="FT">Full-time</option><option value="PT">Part-time</option>
            </select>
          </Field>
        )}
      </div>
      <div className="flex justify-end"><Button onClick={() => void price()} disabled={busy}>{busy ? 'Pricing…' : 'Price this shift'}</Button></div>
      <ServerError message={error} />
      {result && (
        <dl className="grid gap-3 md:grid-cols-3" aria-label="Sandbox result">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <dt className="text-[12px] text-muted-foreground">{card.code} (draft)</dt>
            <dd className="text-[16px] font-bold tabular-nums text-foreground">{result.draft === null ? 'Not priced' : money(result.draft)}</dd>
          </div>
          <div className="rounded-lg border border-border/60 p-3">
            <dt className="text-[12px] text-muted-foreground">{result.currentCode ? result.currentCode + ' (published)' : 'Published card'}</dt>
            <dd className="text-[16px] font-bold tabular-nums text-foreground">
              {result.currentCode === null ? 'None covers this date' : result.current === null ? 'Not priced' : money(result.current)}
            </dd>
          </div>
          <div className="rounded-lg border border-border/60 p-3">
            <dt className="text-[12px] text-muted-foreground">Difference</dt>
            <dd className="text-[16px] font-bold tabular-nums text-foreground">
              {delta === null ? '—' : (delta >= 0 ? '+' : '−') + money(Math.abs(delta))
                + (result.current ? ' (' + (delta >= 0 ? '+' : '') + ((delta / result.current) * 100).toFixed(2) + '%)' : '')}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
};

export default CostSandbox;
