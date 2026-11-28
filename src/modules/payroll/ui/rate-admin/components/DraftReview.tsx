/**
 * DraftReview — a draft card's lines against the card it was rolled from
 * (old → new, % change; loadings only where they changed), then Publish or
 * Discard, each behind a confirm.
 *
 * Publishing is the step with consequences: the open-ended card before it now
 * ends the day before the draft starts, and every shift from that date is
 * priced from the new rates as soon as it is published — including shifts
 * already worked when the date is in the past (costs are computed when read).
 */

import React, { useMemo, useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/modules/core/ui/primitives/alert-dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/modules/core/ui/primitives/table';
import { cn } from '@/modules/core/lib/utils';
import { rateCardErrorMessage, type RateCard } from '../../../data/rateCards.api';
import {
  LOADING_FIELDS, compareAllowances, compareLoadings, compareRates, formatLoading, type LineChange,
} from '../rateCardMath';
import { CLASS_RANK, classLabel } from './BaseRatesSection';

interface DraftReviewProps {
  draft: RateCard;
  source: RateCard | null;
  /** The published, open-ended card that publishing will close, if any. */
  closes: RateCard | null;
  canManage: boolean;
  onPublish: (cardId: string) => Promise<unknown>;
  onDiscard: (cardId: string) => Promise<unknown>;
}

const money = (n: number) => `$${n.toFixed(2)}`;

export const formatDate = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

/** The day before an ISO date, as an ISO date (calendar arithmetic, no time zone). */
export const dayBefore = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
};

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const ChangeCell: React.FC<{ change: LineChange }> = ({ change }) => (
  <>
    <TableCell className="text-[13px] tabular-nums text-muted-foreground">
      {change.oldValue == null ? '—' : money(change.oldValue)}
    </TableCell>
    <TableCell className="text-[13px] tabular-nums font-semibold text-foreground">{money(change.newValue)}</TableCell>
    <TableCell className={cn(
      'text-[13px] tabular-nums text-right',
      change.changePct == null ? 'text-muted-foreground'
        : change.changePct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400',
    )}>
      {change.changePct == null ? 'new' : `${change.changePct >= 0 ? '+' : ''}${change.changePct.toFixed(2)}%`}
    </TableCell>
  </>
);

type Pending = 'publish' | 'discard' | null;

const DraftReview: React.FC<DraftReviewProps> = ({ draft, source, closes, canManage, onPublish, onDiscard }) => {
  const [confirm, setConfirm] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rates = useMemo(
    () => compareRates(draft, source).sort((a, b) =>
      (CLASS_RANK[a.classification!] ?? 99) - (CLASS_RANK[b.classification!] ?? 99)
      || a.basis!.localeCompare(b.basis!)),
    [draft, source],
  );
  const allowances = useMemo(
    () => compareAllowances(draft, source).sort((a, b) => a.key.localeCompare(b.key)),
    [draft, source],
  );
  const loadings = useMemo(() => compareLoadings(draft, source), [draft, source]);
  const backdated = draft.validFrom <= localToday();

  const run = async (e: React.MouseEvent) => {
    e.preventDefault(); // keep the dialog open until the server answers
    const action = confirm;
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      await (action === 'publish' ? onPublish(draft.id) : onDiscard(draft.id));
      setConfirm(null);
    } catch (err) {
      setError(rateCardErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 space-y-5 border-t border-border/40 pt-4" aria-label={`Review draft ${draft.code}`} role="region">
      <p className="text-[13px] text-muted-foreground">
        {source
          ? <>Compared with <span className="font-semibold text-foreground">{source.code}</span>. Trainee and apprentice figures are scaled by the same multiplier.</>
          : 'No source card to compare with.'}
      </p>

      <div className="rounded-lg border border-border/60 overflow-x-auto">
        <Table aria-label="Rate changes">
          <TableHeader>
            <TableRow>
              <TableHead className="text-[12px]">Classification</TableHead>
              <TableHead className="text-[12px]">Basis</TableHead>
              <TableHead className="text-[12px]">Paid / hr was</TableHead>
              <TableHead className="text-[12px]">Now</TableHead>
              <TableHead className="text-[12px] text-right">Change</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rates.map((r) => (
              <TableRow key={r.key}>
                <TableCell className="text-[13px] font-medium">{classLabel(r.classification!)}</TableCell>
                <TableCell className="text-[13px] capitalize text-muted-foreground">{r.basis}</TableCell>
                <ChangeCell change={r} />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {allowances.length > 0 && (
        <div className="rounded-lg border border-border/60 overflow-x-auto">
          <Table aria-label="Allowance changes">
            <TableHeader>
              <TableRow>
                <TableHead className="text-[12px]">Allowance</TableHead>
                <TableHead className="text-[12px]">Unit</TableHead>
                <TableHead className="text-[12px]">Was</TableHead>
                <TableHead className="text-[12px]">Now</TableHead>
                <TableHead className="text-[12px] text-right">Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allowances.map((a) => (
                <TableRow key={a.key}>
                  <TableCell className="text-[13px] font-medium">{a.code!.replace(/_/g, ' ')}</TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">{a.unit!.replace(/_/g, ' ')}</TableCell>
                  <ChangeCell change={a} />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {!draft.loadings ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-700 dark:text-amber-300">
          {draft.code} has no loadings, so it cannot be published.
        </p>
      ) : loadings.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          All {LOADING_FIELDS.length} loadings and rules are unchanged from {source?.code}.
        </p>
      ) : (
        <div className="rounded-lg border border-border/60 overflow-x-auto">
          <Table aria-label="Loading changes">
            <TableHeader>
              <TableRow>
                <TableHead className="text-[12px]">Loading or rule</TableHead>
                <TableHead className="text-[12px]">Was</TableHead>
                <TableHead className="text-[12px]">Now</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadings.map((l) => (
                <TableRow key={l.key}>
                  <TableCell className="text-[13px] font-medium">{l.label}</TableCell>
                  <TableCell className="text-[13px] tabular-nums text-muted-foreground">
                    {l.oldValue == null ? '—' : formatLoading(l.unit, l.oldValue)}
                  </TableCell>
                  <TableCell className="text-[13px] tabular-nums font-semibold text-foreground">
                    {formatLoading(l.unit, l.newValue)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {canManage && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => { setError(null); setConfirm('discard'); }}>Discard draft</Button>
          <Button onClick={() => { setError(null); setConfirm('publish'); }}>Publish…</Button>
        </div>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(o) => { if (!o && !busy) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[15px]">
              {confirm === 'publish' ? `Publish ${draft.code}?` : `Discard ${draft.code}?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              {confirm === 'publish' ? (
                <div className="space-y-2 text-[13px] text-muted-foreground">
                  <p>
                    These rates will price every shift from <span className="font-semibold text-foreground">{formatDate(draft.validFrom)}</span>,
                    open-ended until a later card is published.
                  </p>
                  {closes && (
                    <p>
                      <span className="font-semibold text-foreground">{closes.code}</span> will end on{' '}
                      <span className="font-semibold text-foreground">{formatDate(dayBefore(draft.validFrom))}</span>.
                    </p>
                  )}
                  {backdated && (
                    <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-300">
                      The start date is not in the future: shifts from {formatDate(draft.validFrom)} that are already
                      rostered or worked are repriced at the new rates.
                    </p>
                  )}
                  <p>A published card cannot be discarded.</p>
                </div>
              ) : (
                <p className="text-[13px] text-muted-foreground">
                  The draft and all its lines are deleted. Nothing was priced from it.
                </p>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={run}
              disabled={busy}
              className={confirm === 'discard' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
            >
              {busy ? 'Working…' : confirm === 'publish' ? 'Publish' : 'Discard'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default DraftReview;
