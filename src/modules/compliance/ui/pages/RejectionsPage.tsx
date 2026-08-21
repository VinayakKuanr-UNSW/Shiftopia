/**
 * Compliance Rejections & V8 Rule Registry — Admin Audit Page
 *
 * Reads the 22 V8 LABOUR compliance rules as interactive bento cards,
 * with live switching to the `public.compliance_rejections` audit feed.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, ShieldX, Cpu, ListFilter, ShieldAlert, AlertTriangle } from 'lucide-react';
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
import { V8RulesTable } from '../components/V8RulesTable';

// Glass card treatment shared by the header and body panels
const glassCard =
  'transition-all border bg-white/80 dark:bg-[#161d2d]/85 backdrop-blur-xl border-border/70 dark:border-white/10 shadow-lg shadow-slate-200/40 ' +
  'dark:shadow-2xl dark:shadow-black/30';

type Window = '24h' | '7d' | '30d';
type ViewMode = 'rules' | 'audit';

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
    <div className="border-t border-border/50 dark:border-white/10 p-5 first:border-t-0 space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <Badge variant="outline" className="font-mono text-xs font-semibold px-2 py-0.5">
          {r.rule_id}
        </Badge>
        <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">
          {format(parseISO(r.created_at), 'dd MMM yyyy, HH:mm')}
        </span>
      </div>
      <p className="text-[14.5px] leading-relaxed text-foreground font-normal">{r.summary}</p>
      <div className="flex flex-wrap items-center gap-2.5 text-[13px] text-muted-foreground pt-1">
        <span className="font-mono font-medium text-foreground/80">Emp: {r.employee_id.slice(0, 8)}</span>
        <span aria-hidden>·</span>
        <span className="font-medium text-foreground/80">{r.operation_type}</span>
        {r.stage && (
          <>
            <span aria-hidden>·</span>
            <span>Stage: {r.stage}</span>
          </>
        )}
        {r.bypassed && (
          <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 text-xs">
            bypassed
          </Badge>
        )}
      </div>
    </div>
  );
}

export default function RejectionsPage() {
  const isMobile = useIsMobile();
  const [viewMode, setViewMode] = useState<ViewMode>('rules');
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
    enabled: viewMode === 'audit',
  });

  const ruleCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of data ?? []) m.set(r.rule_id, (m.get(r.rule_id) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [data]);

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 sm:p-6 lg:p-8 space-y-6">
      {/* ── Glass header card: title + view mode toggle + filters ── */}
      <div className="flex-shrink-0">
        <div className={cn('rounded-[28px] p-6 lg:p-7', glassCard)}>
          <PersonalPageHeader
            title="Compliance Engine & Rejections"
            Icon={ShieldX}
            mode="managerial"
            className="mb-6"
          />

          {/* Navigation & Controls Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
            {/* View Mode Switcher */}
            <div className="flex items-center rounded-2xl bg-muted/60 dark:bg-slate-800/80 p-1.5 border border-border/50 max-w-fit shadow-xs">
              <button
                onClick={() => setViewMode('rules')}
                className={cn(
                  'flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all',
                  viewMode === 'rules'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Cpu className="h-4 w-4" />
                <span>V8 Active Rules (22)</span>
              </button>
              <button
                onClick={() => setViewMode('audit')}
                className={cn(
                  'flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all',
                  viewMode === 'audit'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <ListFilter className="h-4 w-4" />
                <span>Rejections Audit Feed</span>
              </button>
            </div>

            {/* Audit Filter Controls (Shown only in audit log mode) */}
            {viewMode === 'audit' && (
              <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
                <Select value={window} onValueChange={(v) => setWindow(v as Window)}>
                  <SelectTrigger className="w-full sm:w-[150px] h-10 text-sm font-medium"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="24h">Last 24 hours</SelectItem>
                    <SelectItem value="7d">Last 7 days</SelectItem>
                    <SelectItem value="30d">Last 30 days</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={opTypeFilter} onValueChange={setOpTypeFilter}>
                  <SelectTrigger className="w-full sm:w-[170px] h-10 text-sm font-medium"><SelectValue /></SelectTrigger>
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
                  className="h-10 text-xs sm:text-sm font-medium"
                >
                  {bypassedOnly ? 'Showing bypassed only' : 'Show bypassed only'}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetch()}
                  className="sm:ml-auto gap-2 h-10 text-xs sm:text-sm font-medium"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Glass body card: V8 Technical Table or Audit Table ── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className={cn('h-full rounded-[28px] overflow-auto p-6 sm:p-7 space-y-6', glassCard)}>
          {viewMode === 'rules' ? (
            <V8RulesTable />
          ) : (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-bold text-foreground">Compliance Block Audit Log</h3>
                <p className="text-[14px] text-muted-foreground mt-0.5">
                  Every BLOCKING validation event recorded by the V8 compliance engine in the selected time window.
                </p>
              </div>

              {/* Top rules chips */}
              {ruleCounts.length > 0 && (
                <div className="rounded-2xl border border-border/60 dark:border-white/10 bg-muted/20 p-5">
                  <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                    Most Frequent Violations in Window
                  </div>
                  <div className="flex flex-wrap gap-2.5">
                    {ruleCounts.map(([rule, count]) => (
                      <Badge key={rule} variant="secondary" className="text-[13px] px-3 py-1 font-semibold">
                        {rule} · {count}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Table */}
              <div className="rounded-2xl border border-border/70 dark:border-white/10 overflow-hidden">
                {isLoading ? (
                  <PageState
                    state="loading"
                    scope="section"
                    title="Loading compliance rejections"
                    skeleton={
                      <div className="space-y-3 p-4" aria-hidden="true">
                        {Array.from({ length: 6 }).map((_, i) => (
                          <Skeleton key={i} className="h-12 w-full rounded-xl" />
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
                  <table className="w-full text-[14px]">
                    <thead className="bg-muted/40 dark:bg-slate-800/60 text-xs font-bold uppercase tracking-wider text-muted-foreground border-b border-border/60 dark:border-white/10">
                      <tr>
                        <th className="px-5 py-3.5 text-left">Timestamp</th>
                        <th className="px-5 py-3.5 text-left">Employee</th>
                        <th className="px-5 py-3.5 text-left">Rule ID</th>
                        <th className="px-5 py-3.5 text-left">Operation</th>
                        <th className="px-5 py-3.5 text-left">Stage</th>
                        <th className="px-5 py-3.5 text-left">Audit Summary</th>
                        <th className="px-5 py-3.5 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50 dark:divide-white/10">
                      {(data ?? []).map(r => (
                        <tr key={r.id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-5 py-3.5 font-mono text-xs whitespace-nowrap text-muted-foreground">
                            {format(parseISO(r.created_at), 'dd MMM, HH:mm')}
                          </td>
                          <td className="px-5 py-3.5 font-mono text-xs font-medium text-foreground">
                            {r.employee_id.slice(0, 8)}
                          </td>
                          <td className="px-5 py-3.5">
                            <Badge variant="outline" className="font-mono text-xs font-semibold px-2 py-0.5">
                              {r.rule_id}
                            </Badge>
                          </td>
                          <td className="px-5 py-3.5 text-[13.5px] font-medium text-foreground">{r.operation_type}</td>
                          <td className="px-5 py-3.5 text-[13.5px] text-muted-foreground">{r.stage ?? '—'}</td>
                          <td className="px-5 py-3.5 max-w-[440px] truncate text-[13.5px] text-foreground/90 font-normal" title={r.summary}>
                            {r.summary}
                          </td>
                          <td className="px-5 py-3.5">
                            {r.bypassed ? (
                              <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 text-xs">
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
          )}
        </div>
      </div>
    </div>
  );
}


