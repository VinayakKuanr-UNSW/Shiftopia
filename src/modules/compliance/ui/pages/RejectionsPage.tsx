/**
 * Compliance Rejections — Admin Audit Page
 *
 * Reads `public.compliance_rejections` (populated by the orchestrator on
 * every BLOCKING result) and gives managers a filterable view of why
 * compliance has blocked actions in the last 24h / 7d / 30d.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, ShieldX } from 'lucide-react';
import { supabase } from '@/platform/supabase/client';
import { useIsMobile } from '@/modules/core/hooks/use-mobile';
import { cn } from '@/modules/core/lib/utils';
import { PersonalPageHeader } from '@/modules/core/ui/components/PersonalPageHeader';
import { PageState } from '@/modules/core/ui/components/PageState';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Button } from '@/modules/core/ui/primitives/button';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/modules/core/ui/primitives/select';
import { format, parseISO } from 'date-fns';

// Glass card treatment shared by the header and body panels — matches the
// "Gold Standard" shell used across the app (Settings, Roster, ManagerSwaps).
const glassCard =
  'transition-all border bg-white/70 backdrop-blur-md border-white shadow-xl shadow-slate-200/50 ' +
  'dark:bg-[#1c2333]/40 dark:border-white/5 dark:shadow-2xl dark:shadow-black/20';

type Window = '24h' | '7d' | '30d';

interface Rejection {
  id: string;
  created_at: string;
  user_id: string | null;
  employee_id: string;
  operation_type: string;
  mode: string;
  stage: string | null;
  rule_id: string;
  rule_status: string;
  summary: string;
  details: string | null;
  affected_shifts: string[];
  calculation: Record<string, unknown> | null;
  bypassed: boolean;
}

function windowToDate(w: Window): Date {
  const now = Date.now();
  switch (w) {
    case '24h': return new Date(now - 24 * 60 * 60 * 1000);
    case '7d':  return new Date(now - 7  * 24 * 60 * 60 * 1000);
    case '30d': return new Date(now - 30 * 24 * 60 * 60 * 1000);
  }
}

function RejectionCard({ r }: { r: Rejection }) {
  return (
    <div className="border-t border-border/40 p-4 first:border-t-0 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline">{r.rule_id}</Badge>
        <span className="font-mono text-[11px] text-muted-foreground whitespace-nowrap">
          {format(parseISO(r.created_at), 'dd MMM HH:mm')}
        </span>
      </div>
      <p className="text-sm leading-snug">{r.summary}</p>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className="font-mono">{r.employee_id.slice(0, 8)}</span>
        <span aria-hidden>·</span>
        <span>{r.operation_type}</span>
        {r.stage && (
          <>
            <span aria-hidden>·</span>
            <span>{r.stage}</span>
          </>
        )}
        {r.bypassed && (
          <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30">
            bypassed
          </Badge>
        )}
      </div>
    </div>
  );
}

export default function RejectionsPage() {
  const isMobile = useIsMobile();
  const [window, setWindow] = useState<Window>('7d');
  const [opTypeFilter, setOpTypeFilter] = useState<string>('all');
  const [bypassedOnly, setBypassedOnly] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['compliance-rejections', window, opTypeFilter, bypassedOnly],
    queryFn: async (): Promise<Rejection[]> => {
      let q = (supabase as any)
        .from('compliance_rejections')
        .select('*')
        .gte('created_at', windowToDate(window).toISOString())
        .order('created_at', { ascending: false })
        .limit(100);

      if (opTypeFilter !== 'all') q = q.eq('operation_type', opTypeFilter);
      if (bypassedOnly) q = q.eq('bypassed', true);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Rejection[];
    },
    staleTime: 30 * 1000,
  });

  const ruleCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of data ?? []) m.set(r.rule_id, (m.get(r.rule_id) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [data]);

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 lg:p-6 space-y-4">
      {/* ── Glass header card: title + clock + filter bar ── */}
      <div className="flex-shrink-0">
        <div className={cn('rounded-[32px] p-4 lg:p-6', glassCard)}>
          <PersonalPageHeader
            title="Compliance Rejections"
            Icon={ShieldX}
            mode="managerial"
            className="mb-4 lg:mb-6"
          />

          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <Select value={window} onValueChange={(v) => setWindow(v as Window)}>
              <SelectTrigger className="w-full sm:w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">Last 24 hours</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
              </SelectContent>
            </Select>

            <Select value={opTypeFilter} onValueChange={setOpTypeFilter}>
              <SelectTrigger className="w-full sm:w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All operations</SelectItem>
                <SelectItem value="ASSIGN">Assign</SelectItem>
                <SelectItem value="BID">Bid</SelectItem>
                <SelectItem value="SWAP">Swap</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant={bypassedOnly ? 'default' : 'outline'}
              size="sm"
              onClick={() => setBypassedOnly(b => !b)}
            >
              {bypassedOnly ? 'Showing bypassed only' : 'Show bypassed only'}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="sm:ml-auto gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* ── Glass body card: top rules + table / cards ── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className={cn('h-full rounded-[32px] overflow-auto p-4 sm:p-6 space-y-4', glassCard)}>
          <p className="text-sm text-muted-foreground">
            Every BLOCKING result emitted by the V8 engine in the selected window.
          </p>

          {/* Top rules */}
          {ruleCounts.length > 0 && (
            <div className="rounded-2xl border border-border/40 bg-muted/20 p-4">
              <div className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-2">
                Top rules in this window
              </div>
              <div className="flex flex-wrap gap-2">
                {ruleCounts.map(([rule, count]) => (
                  <Badge key={rule} variant="secondary">
                    {rule} · {count}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Table */}
          <div className="rounded-2xl border border-border/40 overflow-hidden">
            {isLoading ? (
              <PageState
                state="loading"
                scope="section"
                title="Loading compliance rejections"
                skeleton={
                  <div className="space-y-2" aria-hidden="true">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                }
              />
            ) : isError ? (
              <PageState
                state="error"
                scope="section"
                title="Couldn’t load compliance rejections"
                description="The compliance rejections table may not yet be migrated."
                onRetry={() => refetch()}
              />
            ) : (data ?? []).length === 0 ? (
              <PageState
                state="empty"
                scope="section"
                title="No compliance rejections"
                description="No compliance rejections were recorded in this window."
              />
            ) : isMobile ? (
              <div>
                {(data ?? []).map(r => (
                  <RejectionCard key={r.id} r={r} />
                ))}
              </div>
            ) : (
              <table className="w-full text-sm">
            <thead className="bg-muted/30 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">When</th>
                <th className="px-4 py-2 text-left">Employee</th>
                <th className="px-4 py-2 text-left">Rule</th>
                <th className="px-4 py-2 text-left">Op</th>
                <th className="px-4 py-2 text-left">Stage</th>
                <th className="px-4 py-2 text-left">Summary</th>
                <th className="px-4 py-2 text-left">Bypassed</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map(r => (
                <tr key={r.id} className="border-t border-border/40 hover:bg-muted/20">
                  <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                    {format(parseISO(r.created_at), 'dd MMM HH:mm')}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {r.employee_id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant="outline">{r.rule_id}</Badge>
                  </td>
                  <td className="px-4 py-2 text-xs">{r.operation_type}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{r.stage ?? '—'}</td>
                  <td className="px-4 py-2 max-w-[420px] truncate" title={r.summary}>
                    {r.summary}
                  </td>
                  <td className="px-4 py-2">
                    {r.bypassed ? (
                      <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30">
                        bypassed
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
