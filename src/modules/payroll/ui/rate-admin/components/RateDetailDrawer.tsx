/**
 * RateDetailDrawer — right-side sheet showing classification rate breakdown.
 *
 * Opens when a user clicks a row in the base rates table. Shows a read-only
 * breakdown of all rate components for that classification, with EBA clause
 * references via tooltips.
 *
 * The penalty/overtime figures MIRROR the roster cost engine
 * (`utils/cost/standard.ts` + `security.ts`) — same clauses, same multipliers,
 * split by employment basis:
 *   • Weekend/PH (cl 41): FT/PT +25/50/150% → 125/150/250%; casual carries the
 *     extra 25% loading → 150/175/275%.
 *   • Overtime (cl 42.2): 150% for the first three hours, 200% after — priced on
 *     the DE-LOADED ordinary rate, so casual OT equals FT/PT OT (the 25% loading
 *     is not compounded on overtime).
 *   • Night allowance (cl 43): a day-of-conclusion loading (FT/PT +20/25/50%,
 *     casual +45/50/75%), NOT cumulative with the weekend/PH penalty (cl 41.4) —
 *     so it is shown as a note, not a single dollar figure.
 *   • Security (Schedule 3): the annualised salary is paid in lieu of penalties
 *     and night allowances (§4.1(b)); only overtime is paid on top (§4.2).
 */

import React from 'react';
import {
  DollarSign, Sun, Moon, CalendarDays, Clock, Award, Info, Lock,
} from 'lucide-react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/modules/core/ui/primitives/sheet';
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from '@/modules/core/ui/primitives/tooltip';
import { cn } from '@/modules/core/lib/utils';

const money = (n: number) => `$${n.toFixed(2)}`;
const pct = (m: number) => `${Math.round(m * 100)}%`;

export interface ClassificationDetail {
  classification: string;
  classLabel: string;
  ordinary?: number;
  permanent?: number;
  casual?: number;
  annualised?: number;
  effectiveFrom: string;
}

interface RateDetailDrawerProps {
  detail: ClassificationDetail | null;
  open: boolean;
  onClose: () => void;
}

interface RateLineProps {
  icon: React.ElementType;
  label: string;
  value: string | null;
  clause?: string;
  description?: string;
  accent?: string;
}

const RateLine: React.FC<RateLineProps> = ({ icon: Icon, label, value, clause, description, accent }) => (
  <div className="flex items-center justify-between py-4 border-b border-border/40 last:border-0">
    <div className="flex items-center gap-3">
      <div className={cn('rounded-lg p-2 bg-muted/60')}>
        <Icon className={cn('h-4 w-4', accent ?? 'text-muted-foreground')} aria-hidden="true" />
      </div>
      <div>
        <div className="flex items-center gap-2">
          <span className="text-base text-foreground font-semibold">{label}</span>
          {clause && description && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-full p-0.5"
                    aria-label={`Detailed information for ${label}`}
                  >
                    <Info className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs text-sm p-3">
                  <p className="font-bold mb-1">{clause}</p>
                  <p className="text-muted-foreground text-xs leading-relaxed">{description}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        {clause && <p className="text-xs text-muted-foreground font-medium mt-0.5">{clause}</p>}
      </div>
    </div>
    <span className={cn(
      'text-base font-extrabold tabular-nums',
      value ? 'text-foreground' : 'text-muted-foreground',
    )}>
      {value ?? '—'}
    </span>
  </div>
);

// ── penalty table cell: dollar (bold) + multiplier (muted) ────────────────────
const RateCell: React.FC<{ ordinary: number; mult: number }> = ({ ordinary, mult }) => (
  <td className="text-right py-3 px-4">
    <span className="block text-sm font-extrabold tabular-nums text-foreground">{money(ordinary * mult)}</span>
    <span className="block text-[11px] text-muted-foreground tabular-nums font-medium">{pct(mult)}</span>
  </td>
);

// cl 41 weekend / public-holiday penalties — FT/PT loading and the casual
// equivalent (FT/PT loading + the 25% casual loading), as multiples of the
// ordinary rate. Matches penaltyLoading() + baseMult in standard.ts.
const WEEKEND_ROWS: { icon: React.ElementType; label: string; clause: string; ftpt: number; casual: number }[] = [
  { icon: Sun, label: 'Saturday', clause: 'cl 41.1', ftpt: 1.25, casual: 1.5 },
  { icon: Sun, label: 'Sunday', clause: 'cl 41.2', ftpt: 1.5, casual: 1.75 },
  { icon: CalendarDays, label: 'Public holiday', clause: 'cl 41.3 / 56.1', ftpt: 2.5, casual: 2.75 },
];

// cl 42.2 overtime — 150% first three hours, 200% after. Priced on the de-loaded
// ordinary rate for BOTH bases (the casual loading is not compounded on OT), so
// the FT/PT and casual columns show the same figure.
const OT_ROWS: { label: string; clause: string; mult: number }[] = [
  { label: 'Overtime — first 3 hrs', clause: 'cl 42.2', mult: 1.5 },
  { label: 'Overtime — beyond 3 hrs', clause: 'cl 42.2', mult: 2.0 },
];

const RateDetailDrawer: React.FC<RateDetailDrawerProps> = ({ detail, open, onClose }) => {
  if (!detail) return null;

  const effectiveLabel = new Date(detail.effectiveFrom + 'T00:00:00').toLocaleDateString('en-AU', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  // Derived penalty calculations (read-only display)
  const baseOrdinary = detail.ordinary ?? detail.annualised ?? 0;
  const casualRate = detail.casual;
  const casualLoading = casualRate && baseOrdinary > 0
    ? ((casualRate / baseOrdinary - 1) * 100).toFixed(0)
    : null;

  // Security classifications are salaried on an annualised rate that absorbs
  // penalties and night allowances (Sch 3 §4.1(b)) — they carry no FT/PT or
  // casual base, so the weekend/night penalty split does not apply.
  const isAnnualisedOnly =
    detail.annualised != null && detail.permanent == null && detail.casual == null;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md overflow-y-auto p-6 space-y-6"
        aria-describedby="rate-drawer-description"
      >
        <SheetHeader className="pb-4 border-b border-border/40">
          <SheetTitle className="flex items-center gap-3 text-xl font-bold">
            <div className="rounded-lg bg-primary/10 p-2">
              <DollarSign className="h-6 w-6 text-primary" aria-hidden="true" />
            </div>
            {detail.classLabel}
          </SheetTitle>
          <SheetDescription id="rate-drawer-description" className="text-sm">
            Detailed rate breakdown and penalty rates. Effective {effectiveLabel}.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-1" role="region" aria-label="Rate details checklist">
          <RateLine
            icon={DollarSign}
            label="Ordinary Hourly Rate"
            value={baseOrdinary > 0 ? money(baseOrdinary) : null}
            clause="cl 25 / Schedule 2"
            description="Base ordinary hourly rate for penalty and overtime calculations."
            accent="text-primary"
          />

          {detail.permanent != null && (
            <RateLine
              icon={DollarSign}
              label="Permanent Rate (FT/PT)"
              value={money(detail.permanent)}
              clause="cl 25 / Schedule 2"
              description="Hourly rate for full-time and part-time permanent employees."
            />
          )}

          {casualRate != null && (
            <RateLine
              icon={DollarSign}
              label="Casual Rate"
              value={money(casualRate)}
              clause="cl 12.5(b)"
              description={`Includes ${casualLoading ?? 25}% casual loading on the ordinary rate.`}
            />
          )}

          {detail.annualised != null && (
            <RateLine
              icon={Award}
              label="Annualised Rate"
              value={money(detail.annualised)}
              clause="Schedule 3 §2"
              description="Annualised security salary paid for all rostered hours in lieu of penalties, night allowances and leave loading (Sch 3 §4.1(b))."
            />
          )}

          <div className="pt-6 pb-3">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Penalty &amp; overtime rates (× ordinary)
            </p>
          </div>

          {isAnnualisedOnly ? (
            // ── Security: annualised salary absorbs penalties; only OT applies ──
            <div className="space-y-4">
              <div className="rounded-xl border border-border/40 bg-muted/30 p-4 flex items-start gap-3" role="note">
                <Award className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" aria-hidden="true" />
                <p className="text-xs text-muted-foreground leading-relaxed font-medium">
                  The annualised salary is paid for all rostered hours <span className="font-semibold text-foreground">in lieu of</span> weekend,
                  public-holiday and night-shift penalties (Sch&nbsp;3 §4.1(b)). Only overtime is paid on top.
                </p>
              </div>
              <div className="rounded-lg border border-border/40 overflow-hidden bg-muted/10">
                <table className="w-full text-sm" aria-label="Security overtime rates">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border bg-muted/30">
                      <th scope="col" className="text-left font-bold py-3 px-4 text-xs uppercase tracking-wider">Overtime</th>
                      <th scope="col" className="text-right font-bold py-3 px-4 text-xs uppercase tracking-wider">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {OT_ROWS.map((r) => (
                      <tr key={r.label} className="border-b border-border/30 last:border-0">
                        <td className="py-3 px-4">
                          <span className="flex items-center gap-2 font-semibold text-foreground">
                            <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                            {r.label}
                          </span>
                          <span className="text-xs text-muted-foreground font-medium">Sch 3 §4.2</span>
                        </td>
                        <RateCell ordinary={baseOrdinary} mult={r.mult} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            // ── Standard: weekend/PH + OT split by FT/PT vs casual (cl 41 / 42) ──
            <div className="space-y-4">
              <div className="rounded-lg border border-border/40 overflow-hidden bg-muted/10">
                <table className="w-full text-sm" aria-label="Penalty and overtime rates by employment basis">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border bg-muted/30">
                      <th scope="col" className="text-left font-bold py-3 px-4 text-xs uppercase tracking-wider">Penalty</th>
                      <th scope="col" className="text-right font-bold py-3 px-4 text-xs uppercase tracking-wider">FT/PT</th>
                      <th scope="col" className="text-right font-bold py-3 px-4 text-xs uppercase tracking-wider">Casual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {WEEKEND_ROWS.map(({ icon: Icon, label, clause, ftpt, casual }) => (
                      <tr key={label} className="border-b border-border/30">
                        <td className="py-3 px-4">
                          <span className="flex items-center gap-2 font-semibold text-foreground">
                            <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                            {label}
                          </span>
                          <span className="text-xs text-muted-foreground font-medium">{clause}</span>
                        </td>
                        <RateCell ordinary={baseOrdinary} mult={ftpt} />
                        <RateCell ordinary={baseOrdinary} mult={casual} />
                      </tr>
                    ))}
                    {OT_ROWS.map((r) => (
                      <tr key={r.label} className="border-b border-border/30 last:border-0">
                        <td className="py-3 px-4">
                          <span className="flex items-center gap-2 font-semibold text-foreground">
                            <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                            {r.label}
                          </span>
                          <span className="text-xs text-muted-foreground font-medium">{r.clause}</span>
                        </td>
                        <RateCell ordinary={baseOrdinary} mult={r.mult} />
                        <RateCell ordinary={baseOrdinary} mult={r.mult} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed font-medium px-1">
                Overtime is priced on the ordinary base rate — the 25% casual loading is not
                compounded on overtime (cl 42.2), so casual and FT/PT overtime match.
              </p>

              <div className="rounded-xl border border-border/40 bg-muted/30 p-4 flex items-start gap-3" role="note">
                <Moon className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="text-xs font-bold text-foreground">Night allowance (cl 43)</p>
                  <p className="text-xs text-muted-foreground leading-relaxed font-medium">
                    A loading on night hours, keyed to the day the shift concludes —
                    FT/PT <span className="tabular-nums font-semibold text-foreground">+20% Mon–Thu · +25% Fri · +50% Sat–Sun</span>;
                    casual <span className="tabular-nums font-semibold text-foreground">+45% · +50% · +75%</span>.
                    Not cumulative with the weekend/PH penalty — only the greater applies (cl 41.4).
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Phase 3 edit notice */}
        <div
          className="rounded-xl border border-border/40 bg-muted/30 p-5 flex items-start gap-4"
          role="note"
          aria-label="Direct edit notice"
        >
          <Lock className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div>
            <p className="text-sm font-bold text-foreground">Read-only view</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed font-medium">
              Direct rate editing is coming in Phase 3. Use the CPI preview to generate
              rate updates for the database and cost engine.
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default RateDetailDrawer;
