/**
 * RateCardPeriods — the Versions tab: the organization's rate cards as
 * periods, newest first. Drafts appear only for payroll.manage holders (the
 * database returns them to nobody else); so do New card, Roll forward, Edit
 * (the Rate Card Studio), Publish and Discard. The database decides every
 * action — this only offers them.
 */

import React, { useState } from 'react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Button } from '@/modules/core/ui/primitives/button';
import { cn } from '@/modules/core/lib/utils';
import { useRateCards } from '../../../state/useRateCards';
import type { RateCard } from '../../../data/rateCards.api';
import { sourceCardOf } from '../rateCardMath';
import DraftReview, { formatDate } from './DraftReview';
import RollForwardDialog from './RollForwardDialog';
import DraftEditor from './studio/DraftEditor';
import NewRateCardDialog from './studio/NewRateCardDialog';

const period = (c: RateCard) => `${formatDate(c.validFrom)} – ${c.validTo ? formatDate(c.validTo) : 'open'}`;

/** The published, open-ended card that publishing `draft` would close. */
const closedBy = (draft: RateCard, cards: RateCard[]) =>
  cards.find((c) => c.status === 'published' && c.validTo === null && c.validFrom < draft.validFrom) ?? null;

const RateCardPeriods: React.FC = () => {
  const { cards, isLoading, error, refetch, canManage, organizationId, rollForward, publish, discard } = useRateCards();
  const [rollOpen, setRollOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const newestFirst = [...cards].sort((a, b) => b.validFrom.localeCompare(a.validFrom));

  return (
    <div
      className="rounded-xl border border-border/60 bg-card/40 backdrop-blur-sm p-6 shadow-sm"
      role="region"
      aria-label="Rate card periods"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <h3 className="text-[14px] font-bold text-foreground">Rate cards by period</h3>
          <p className="text-[13px] text-muted-foreground mt-1">
            One card per period. A shift is priced from the published card whose period covers its date.
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setNewOpen(true)}>New card…</Button>
            <Button onClick={() => setRollOpen(true)} disabled={cards.length === 0}>Roll forward…</Button>
          </div>
        )}
      </div>

      {isLoading && <p className="text-[13px] text-muted-foreground">Loading rate cards…</p>}

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
          <p className="text-[13px] text-destructive">The rate cards could not be read.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
        </div>
      )}

      {!isLoading && !error && cards.length === 0 && (
        <p className="text-[13px] text-muted-foreground">This organization has no rate card, so its shifts are not priced.</p>
      )}

      <ul className="space-y-3" aria-label="Rate cards">
        {newestFirst.map((card) => {
          const isDraft = card.status === 'draft';
          const open = reviewing === card.id;
          return (
            <li
              key={card.id}
              className={cn(
                'rounded-lg border p-4',
                isDraft ? 'border-amber-500/30 bg-amber-500/5' : 'border-border/60 bg-background/40',
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-[13px] font-bold text-foreground">{card.code}</span>
                    <Badge variant={isDraft ? 'warning' : 'success'} className="uppercase tracking-wider">
                      {isDraft ? 'Draft' : 'Published'}
                    </Badge>
                  </div>
                  <p className="text-[13px] text-foreground">{card.name}</p>
                  <p className="text-[13px] text-muted-foreground">
                    {period(card)}
                    {' · '}
                    {card.rates.length} rate{card.rates.length !== 1 ? 's' : ''} · {card.allowances.length} allowance{card.allowances.length !== 1 ? 's' : ''}
                  </p>
                  {card.derivation && (
                    <p className="text-[12px] text-muted-foreground">Derived from {card.derivation}</p>
                  )}
                </div>
                {isDraft && (
                  <div className="flex flex-wrap gap-2">
                    {canManage && (
                      <Button variant="outline" size="sm" aria-expanded={editing === card.id}
                        onClick={() => setEditing(editing === card.id ? null : card.id)}>
                        {editing === card.id ? 'Close editor' : 'Edit'}
                      </Button>
                    )}
                    <Button variant="outline" size="sm" aria-expanded={open} onClick={() => setReviewing(open ? null : card.id)}>
                      {open ? 'Hide review' : 'Review'}
                    </Button>
                  </div>
                )}
              </div>

              {isDraft && canManage && editing === card.id && <DraftEditor card={card} cards={cards} />}

              {isDraft && open && (
                <DraftReview
                  draft={card}
                  source={sourceCardOf(card, cards)}
                  closes={closedBy(card, cards)}
                  canManage={canManage}
                  onPublish={(id) => publish.mutateAsync(id)}
                  onDiscard={(id) => discard.mutateAsync(id)}
                />
              )}
            </li>
          );
        })}
      </ul>

      {newOpen && organizationId && (
        <NewRateCardDialog
          onOpenChange={setNewOpen}
          cards={cards}
          organizationId={organizationId}
          onCreated={(id) => setEditing(id)}
        />
      )}

      {rollOpen && (
        <RollForwardDialog
          open
          onOpenChange={setRollOpen}
          cards={cards}
          onSubmit={async (input) => {
            const id = await rollForward.mutateAsync(input);
            setReviewing(id);
          }}
        />
      )}
    </div>
  );
};

export default RateCardPeriods;
