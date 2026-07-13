/**
 * BaseRatesSection — enhanced rate table with search, status badges,
 * and row-click to open the detail drawer.
 *
 * Replaces the old compact RateSetCard table with a full-width, searchable
 * table showing classification, ordinary, FT/PT, casual, effective date, and
 * status. Clicking a row opens the RateDetailDrawer.
 */

import React, { useMemo, useState } from 'react';
import { Search, ChevronRight, Info } from 'lucide-react';
import { Input } from '@/modules/core/ui/primitives/input';
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from '@/modules/core/ui/primitives/tooltip';
import { cn } from '@/modules/core/lib/utils';
import type { EbaRateSet } from '../../../data/ebaRates.read.api';
import RateDetailDrawer, { type ClassificationDetail } from './RateDetailDrawer';

const money = (n: number) => `$${n.toFixed(2)}`;

const CLASS_RANK: Record<string, number> = {
  TRAINEE: 0, LEVEL_1: 1, LEVEL_2: 2, LEVEL_3: 3, LEVEL_4: 4,
  LEVEL_5: 5, LEVEL_6: 6, LEVEL_7: 7,
  SECURITY_LEVEL_3: 8, SECURITY_LEVEL_4: 9, SECURITY_LEVEL_5: 10, SECURITY_LEVEL_6: 11,
};

const classLabel = (c: string) =>
  c.replace('SECURITY_LEVEL_', 'Security L').replace('LEVEL_', 'Level ').replace('TRAINEE', 'Trainee');

interface ClassRow {
  classification: string;
  label: string;
  ordinary: number;
  permanent: number | null;
  casual: number | null;
  annualised: number | null;
}

function buildRows(set: EbaRateSet): ClassRow[] {
  const m = new Map<string, ClassRow>();
  for (const r of set.rates) {
    if (!m.has(r.classification)) {
      m.set(r.classification, {
        classification: r.classification,
        label: classLabel(r.classification),
        ordinary: 0,
        permanent: null,
        casual: null,
        annualised: null,
      });
    }
    const row = m.get(r.classification)!;
    if (r.employmentBasis === 'permanent') {
      row.ordinary = r.ordinaryHourlyRate;
      row.permanent = r.paidHourlyRate;
    } else if (r.employmentBasis === 'casual') {
      row.casual = r.paidHourlyRate;
    } else {
      row.annualised = r.paidHourlyRate;
      if (!row.ordinary) row.ordinary = r.ordinaryHourlyRate;
    }
  }
  return [...m.values()].sort(
    (a, b) => (CLASS_RANK[a.classification] ?? 99) - (CLASS_RANK[b.classification] ?? 99),
  );
}

interface BaseRatesSectionProps {
  rateSet: EbaRateSet;
  isActive: boolean;
}

const BaseRatesSection: React.FC<BaseRatesSectionProps> = ({ rateSet, isActive }) => {
  const [search, setSearch] = useState('');
  const [drawerDetail, setDrawerDetail] = useState<ClassificationDetail | null>(null);

  const allRows = useMemo(() => buildRows(rateSet), [rateSet]);

  const filteredRows = useMemo(() => {
    if (!search.trim()) return allRows;
    const q = search.toLowerCase();
    return allRows.filter((r) => r.label.toLowerCase().includes(q));
  }, [allRows, search]);

  const effectiveLabel = new Date(rateSet.effectiveFrom + 'T00:00:00').toLocaleDateString('en-AU', {
    month: 'short', year: 'numeric',
  });

  const openDrawer = (row: ClassRow) => {
    setDrawerDetail({
      classification: row.classification,
      classLabel: row.label,
      ordinary: row.ordinary || undefined,
      permanent: row.permanent ?? undefined,
      casual: row.casual ?? undefined,
      annualised: row.annualised ?? undefined,
      effectiveFrom: rateSet.effectiveFrom,
    });
  };

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div>
            <h3 className="text-xl font-bold text-foreground">Base Rates</h3>
            <p className="text-base text-muted-foreground mt-1">
              Schedule 2 — classification wage rates (ICC Sydney EA 2025)
            </p>
          </div>

          {/* Search */}
          <div className="relative w-72">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="base-rates-search"
              placeholder="Search classifications..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-10 text-sm"
              aria-label="Search classification base rates by name"
            />
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border/60 overflow-hidden bg-card/30 backdrop-blur-sm shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Base hourly wage rates by classification">
              <thead>
                <tr className="text-muted-foreground border-b border-border bg-muted/30">
                  <th scope="col" className="text-left font-bold py-4 px-5 text-xs uppercase tracking-wider">
                    <div className="flex items-center gap-2">
                      Classification
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button 
                            className="text-muted-foreground/60 hover:text-foreground transition-colors"
                            aria-label="Classification information"
                          >
                            <Info className="h-4 w-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="text-sm max-w-xs p-3">
                          ICC Sydney EA 2025 Schedule 2 classifications. Click a row for full rate breakdown.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </th>
                  <th scope="col" className="text-right font-bold py-4 px-5 text-xs uppercase tracking-wider">
                    <div className="flex items-center justify-end gap-2">
                      Ordinary
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button 
                            className="text-muted-foreground/60 hover:text-foreground transition-colors"
                            aria-label="Ordinary rate information"
                          >
                            <Info className="h-4 w-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="text-sm p-3">
                          Base ordinary hourly rate used for penalty/overtime calculations
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </th>
                  <th scope="col" className="text-right font-bold py-4 px-5 text-xs uppercase tracking-wider">FT/PT</th>
                  <th scope="col" className="text-right font-bold py-4 px-5 text-xs uppercase tracking-wider">
                    <div className="flex items-center justify-end gap-2">
                      Casual
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button 
                            className="text-muted-foreground/60 hover:text-foreground transition-colors"
                            aria-label="Casual loading information"
                          >
                            <Info className="h-4 w-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="text-sm p-3">
                          Includes 25% casual loading (cl 12.5(b))
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </th>
                  <th scope="col" className="text-right font-bold py-4 px-5 text-xs uppercase tracking-wider">Effective</th>
                  <th scope="col" className="text-right font-bold py-4 px-5 text-xs uppercase tracking-wider">Status</th>
                  <th scope="col" className="w-10"></th>
                </tr>
              </thead>
              <tbody className="text-foreground">
                {filteredRows.map((row) => (
                  <tr
                    key={row.classification}
                    onClick={() => openDrawer(row)}
                    className={cn(
                      'border-b border-border/30 last:border-0 cursor-pointer transition-colors',
                      'hover:bg-primary/5 focus-within:bg-primary/5',
                    )}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openDrawer(row);
                      }
                    }}
                    aria-haspopup="dialog"
                    aria-expanded={drawerDetail?.classification === row.classification}
                    aria-label={`${row.label} classification, ordinary rate ${money(row.ordinary)}, permanent rate ${row.permanent ? money(row.permanent) : 'not specified'}, casual rate ${row.casual ? money(row.casual) : 'not specified'}. Click to view penalty breakdowns.`}
                  >
                    <td className="py-4 px-5 font-bold text-sm text-foreground">{row.label}</td>
                    <td className="text-right py-4 px-5 tabular-nums text-muted-foreground font-semibold text-sm">
                      {money(row.ordinary)}
                    </td>
                    <td className="text-right py-4 px-5 tabular-nums font-bold text-sm">
                      {row.permanent != null ? money(row.permanent) : '—'}
                    </td>
                    <td className="text-right py-4 px-5 tabular-nums font-bold text-sm">
                      {row.casual != null ? money(row.casual) : '—'}
                    </td>
                    <td className="text-right py-4 px-5 text-muted-foreground font-medium text-sm">
                      {effectiveLabel}
                    </td>
                    <td className="text-right py-4 px-5">
                      {isActive ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-emerald-400">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          Archived
                        </span>
                      )}
                    </td>
                    <td className="py-4 pr-4 text-right">
                      <ChevronRight className="h-5 w-5 text-muted-foreground inline" aria-hidden="true" />
                    </td>
                  </tr>
                ))}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-base text-muted-foreground font-medium">
                      No classifications match "{search}"
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <RateDetailDrawer
          detail={drawerDetail}
          open={drawerDetail !== null}
          onClose={() => setDrawerDetail(null)}
        />
      </div>
    </TooltipProvider>
  );
};

export default BaseRatesSection;
