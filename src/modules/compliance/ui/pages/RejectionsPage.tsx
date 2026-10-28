/**
 * Compliance Rejections & V8 Rule Registry — Admin Audit Page
 *
 * Reads the 22 V8 LABOUR compliance rules as interactive bento cards,
 * with live switching to the `public.compliance_rejections` audit feed.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, ShieldX, Cpu, ListFilter } from 'lucide-react';
import { supabase } from '@/platform/supabase/client';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { useIsMobile } from '@/modules/core/hooks/use-mobile';
import { cn } from '@/modules/core/lib/utils';
import { page, surface } from '@/modules/core/ui/layout/pageTokens';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { PageLayout } from '@/modules/core/ui/layout/PageLayout';
import { ToolbarRow, ToolbarSegmented, ToolbarIconButton, toolbar } from '@/modules/core/ui/components/Toolbar';
import { PageState } from '@/modules/core/ui/components/PageState';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/modules/core/ui/primitives/table';
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
        <Badge variant="outline" className="font-mono text-[11px] font-semibold px-2 py-0.5">
          {r.rule_id}
        </Badge>
        <span className="font-mono text-[11px] text-muted-foreground whitespace-nowrap">
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
          <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 text-[11px]">
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
  const { scope, setScope, isGammaLocked } = useScopeFilter('managerial');

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
    <PageLayout>
      {/* ── Header: title + view mode toggle + filters ── */}
      <GoldStandardHeader
        title="Compliance Engine & Rejections"
        Icon={ShieldX}
        scope={scope}
        setScope={setScope}
        isGammaLocked={isGammaLocked}
        mode="managerial"
        functionBar={
          <ToolbarRow
            views={
              <ToolbarSegmented<ViewMode>
                value={viewMode}
                onValueChange={setViewMode}
                options={[
                  { id: 'rules', label: 'V8 Active Rules', count: 22, icon: <Cpu className="h-3.5 w-3.5" aria-hidden="true" /> },
                  { id: 'audit', label: 'Rejections Audit Feed', icon: <ListFilter className="h-3.5 w-3.5" aria-hidden="true" /> },
                ]}
              />
            }
            // The audit feed's controls exist only in audit mode.
            modes={viewMode === 'audit' ? (
              <Select value={window} onValueChange={(v) => setWindow(v as Window)}>
                <SelectTrigger aria-label="Time window" className={cn(toolbar.field, 'w-[150px] justify-between')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">Last 24 hours</SelectItem>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                </SelectContent>
              </Select>
            ) : undefined}
            actions={viewMode === 'audit' ? (<>
              <Select value={opTypeFilter} onValueChange={setOpTypeFilter}>
                <SelectTrigger aria-label="Operation" className={cn(toolbar.secondaryAction, 'w-[170px] justify-between')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All operations</SelectItem>
                  <SelectItem value="ASSIGN">Assign</SelectItem>
                  <SelectItem value="BID">Bid</SelectItem>
                  <SelectItem value="SWAP">Swap</SelectItem>
                </SelectContent>
              </Select>
              <button
                type="button"
                onClick={() => setBypassedOnly(b => !b)}
                aria-pressed={bypassedOnly}
                className={cn(toolbar.secondaryAction, bypassedOnly && toolbar.secondaryActionOn)}
              >
                {bypassedOnly ? 'Showing bypassed only' : 'Show bypassed only'}
              </button>
              <ToolbarIconButton icon={<RefreshCw />} tooltip="Refresh rejections" onClick={() => refetch()} variant="blue" />
            </>) : undefined}
          />
        }
      />

      {/* ── Glass body card: V8 Technical Table or Audit Table ── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className={cn('h-full overflow-auto space-y-6', page.bodyInset, surface.bodyCard)}>
          {viewMode === 'rules' ? (
            <V8RulesTable />
          ) : (
            <div className="space-y-6">
              <div>
                <h3 className="text-[14px] font-bold text-foreground">Compliance Block Audit Log</h3>
                <p className="text-[14px] text-muted-foreground mt-0.5">
                  Every BLOCKING validation event recorded by the V8 compliance engine in the selected time window.
                </p>
              </div>

              {/* Top rules chips */}
              {ruleCounts.length > 0 && (
                <div className="rounded-2xl border border-border/60 dark:border-white/10 bg-muted/20 p-5">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
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
                  <Table>
                    <TableHeader sticky>
                      <TableRow>
                        <TableHead>Timestamp</TableHead>
                        <TableHead>Employee</TableHead>
                        <TableHead>Rule ID</TableHead>
                        <TableHead>Operation</TableHead>
                        <TableHead>Stage</TableHead>
                        <TableHead>Audit Summary</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(data ?? []).map(r => (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono whitespace-nowrap text-muted-foreground">
                            {format(parseISO(r.created_at), 'dd MMM, HH:mm')}
                          </TableCell>
                          <TableCell className="font-mono font-medium">
                            {r.employee_id.slice(0, 8)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="font-mono text-[11px] font-semibold px-2 py-0.5">
                              {r.rule_id}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-medium">{r.operation_type}</TableCell>
                          <TableCell className="text-muted-foreground">{r.stage ?? '—'}</TableCell>
                          <TableCell className="max-w-[440px] truncate text-foreground/90" title={r.summary}>
                            {r.summary}
                          </TableCell>
                          <TableCell>
                            {r.bypassed ? (
                              <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 text-[11px]">
                                bypassed
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}


