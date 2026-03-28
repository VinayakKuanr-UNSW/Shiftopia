/**
 * OfferCard
 *
 * Displays a single PlanningOffer in the offer list shown to the initiator.
 *
 * BID: offerer name, avatar, role, dept, advisory compliance badge
 * SWAP: additionally shows the counter-shift (date, time, role, dept)
 *
 * The "Select" button triggers onSelect() and shows a spinner while in flight.
 */

import React from 'react';
import {
  Calendar,
  Clock,
  ArrowLeftRight,
  Briefcase,
  Building2,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { Button } from '@/modules/core/ui/primitives/button';
import { Avatar, AvatarFallback } from '@/modules/core/ui/primitives/avatar';
import type {
  PlanningOffer,
  PlanningRequestType,
  PlanningRequestStatus,
} from '@/modules/planning/unified/types';

// =============================================================================
// TYPES
// =============================================================================

interface OfferedShift {
  shift_date: string;
  start_time: string;
  end_time: string;
  role?: string;
  dept?: string;
}

interface OfferCardProps {
  offer: PlanningOffer;
  requestType: PlanningRequestType;
  requestStatus: PlanningRequestStatus;
  isInitiator: boolean;
  onSelect?: (offerId: string) => void;
  isSelectingOfferId?: string | null;
  offererName: string;
  offererAvatar?: string;
  offererRole?: string;
  offererDept?: string;
  offeredShift?: OfferedShift;
  advisoryCompliance?: 'PASS' | 'WARNING' | 'BLOCKING' | null;
}

// =============================================================================
// HELPERS
// =============================================================================

function getInitials(name: string): string {
  const parts = name.trim().split(' ');
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function formatShiftDate(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return dateStr;
  }
}

function formatTime(t: string): string {
  const [h, m] = (t || '00:00').split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const display = h % 12 || 12;
  return `${display}:${String(m || 0).padStart(2, '0')} ${period}`;
}

// =============================================================================
// ADVISORY COMPLIANCE BADGE
// =============================================================================

interface AdvisoryBadgeProps {
  compliance: 'PASS' | 'WARNING' | 'BLOCKING';
}

function AdvisoryBadge({ compliance }: AdvisoryBadgeProps) {
  switch (compliance) {
    case 'PASS':
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-2.5 w-2.5" />
          Compliant
        </span>
      );
    case 'WARNING':
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-2.5 w-2.5" />
          Warning
        </span>
      );
    case 'BLOCKING':
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/20 bg-rose-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-rose-600 dark:text-rose-400">
          <XCircle className="h-2.5 w-2.5" />
          Blocked
        </span>
      );
  }
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function OfferCard({
  offer,
  requestType,
  requestStatus,
  isInitiator,
  onSelect,
  isSelectingOfferId,
  offererName,
  offererAvatar,
  offererRole,
  offererDept,
  offeredShift,
  advisoryCompliance,
}: OfferCardProps) {
  const isSelectingThis = isSelectingOfferId === offer.id;
  const isAnySelecting = isSelectingOfferId !== null && isSelectingOfferId !== undefined;
  const canSelect = isInitiator && requestStatus === 'OPEN' && offer.status === 'SUBMITTED';

  // Determine avatar background based on name hash for visual variety
  const avatarColors = [
    'bg-indigo-600',
    'bg-emerald-600',
    'bg-violet-600',
    'bg-rose-600',
    'bg-sky-600',
  ];
  const colorIndex = offererName.charCodeAt(0) % avatarColors.length;
  const avatarBg = avatarColors[colorIndex];

  return (
    <div
      className={cn(
        'group relative rounded-2xl border bg-card transition-all duration-200',
        'hover:border-border/80 hover:shadow-md',
        offer.status === 'SELECTED'
          ? 'border-primary/30 bg-primary/5 ring-1 ring-primary/20'
          : 'border-border/50',
        isSelectingThis && 'opacity-80',
      )}
    >
      {/* Selected indicator stripe */}
      {offer.status === 'SELECTED' && (
        <div className="absolute left-0 top-0 h-full w-1 rounded-l-2xl bg-primary" />
      )}

      <div className="p-4">
        {/* ── Header: avatar + name + compliance badge ── */}
        <div className="flex items-start gap-3">
          <Avatar className="h-10 w-10 flex-shrink-0 ring-2 ring-border">
            {offererAvatar ? (
              <img src={offererAvatar} alt={offererName} className="h-full w-full rounded-full object-cover" />
            ) : null}
            <AvatarFallback
              className={cn(
                'text-[11px] font-black text-white',
                avatarBg,
              )}
            >
              {getInitials(offererName)}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-black text-foreground">
                {offererName}
              </span>
              {advisoryCompliance && (
                <AdvisoryBadge compliance={advisoryCompliance} />
              )}
              {offer.status === 'SELECTED' && (
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-primary">
                  <CheckCircle2 className="h-2.5 w-2.5" />
                  Selected
                </span>
              )}
            </div>

            {/* Role + dept */}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {offererRole && (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Briefcase className="h-3 w-3" />
                  {offererRole}
                </span>
              )}
              {offererDept && (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Building2 className="h-3 w-3" />
                  {offererDept}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── SWAP: counter-shift details ── */}
        {requestType === 'SWAP' && offeredShift && (
          <div className="mt-3">
            {/* Divider with swap icon */}
            <div className="mb-3 flex items-center gap-2">
              <div className="h-px flex-1 bg-border/50" />
              <div className="flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/50 px-2 py-0.5">
                <ArrowLeftRight className="h-3 w-3 text-muted-foreground/60" />
                <span className="text-[9px] font-black uppercase tracking-wider text-muted-foreground/60">
                  Offering
                </span>
              </div>
              <div className="h-px flex-1 bg-border/50" />
            </div>

            {/* Counter-shift info */}
            <div className="rounded-xl border border-border/50 bg-muted/30 p-3 space-y-1.5">
              <div className="flex items-center gap-2 text-[11px] text-foreground/80">
                <Calendar className="h-3.5 w-3.5 text-primary/60" />
                <span className="font-semibold">
                  {formatShiftDate(offeredShift.shift_date)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-foreground/80">
                <Clock className="h-3.5 w-3.5 text-primary/60" />
                <span className="font-mono text-[12px] font-bold">
                  {formatTime(offeredShift.start_time)} – {formatTime(offeredShift.end_time)}
                </span>
              </div>
              {offeredShift.role && (
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Briefcase className="h-3.5 w-3.5" />
                  {offeredShift.role}
                  {offeredShift.dept && (
                    <span className="text-muted-foreground/50">·</span>
                  )}
                  {offeredShift.dept && (
                    <span className="flex items-center gap-1">
                      <Building2 className="h-3 w-3" />
                      {offeredShift.dept}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Actions ── */}
        {canSelect && (
          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              onClick={() => onSelect?.(offer.id)}
              disabled={isAnySelecting}
              className={cn(
                'h-8 gap-2 rounded-lg px-4 text-[11px] font-black uppercase tracking-wider transition-all',
                advisoryCompliance === 'BLOCKING'
                  ? 'border border-rose-500/20 bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 dark:text-rose-400'
                  : 'bg-primary text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90',
              )}
            >
              {isSelectingThis ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Selecting…
                </>
              ) : (
                'Select Offer'
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default OfferCard;
