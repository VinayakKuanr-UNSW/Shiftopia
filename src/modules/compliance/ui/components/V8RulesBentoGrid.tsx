import React, { useMemo, useState } from 'react';
import {
  ShieldAlert,
  AlertTriangle,
  Clock,
  FileText,
  Scale,
  Award,
  CalendarCheck,
  Search,
  Cpu,
  Info,
  SlidersHorizontal,
  CheckCircle2,
  Lock,
  Layers,
  X,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Input } from '@/modules/core/ui/primitives/input';
import { Button } from '@/modules/core/ui/primitives/button';
import { RULE_REGISTRY } from '@/modules/compliance/registry/rules';
import type { RuleSpec, RuleCategory, RuleTier } from '@/modules/compliance/registry/types';

interface V8RulesBentoGridProps {
  className?: string;
  onSelectRule?: (ruleId: string) => void;
}

// Category visual configuration with accessible contrast and clean modern tones
const CATEGORY_CONFIG: Record<
  RuleCategory,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badgeBg: string;
    accentGlow: string;
  }
> = {
  TIME: {
    label: 'Time & Rest',
    icon: Clock,
    badgeBg: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25',
    accentGlow: 'hover:border-sky-500/40 dark:hover:border-sky-500/30',
  },
  CONTRACT: {
    label: 'Contract & Hours',
    icon: FileText,
    badgeBg: 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/25',
    accentGlow: 'hover:border-purple-500/40 dark:hover:border-purple-500/30',
  },
  LEGAL: {
    label: 'Legal & Statutory',
    icon: Scale,
    badgeBg: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25',
    accentGlow: 'hover:border-emerald-500/40 dark:hover:border-emerald-500/30',
  },
  SKILL: {
    label: 'Skills & Quals',
    icon: Award,
    badgeBg: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25',
    accentGlow: 'hover:border-amber-500/40 dark:hover:border-amber-500/30',
  },
  AVAILABILITY: {
    label: 'Availability',
    icon: CalendarCheck,
    badgeBg: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25',
    accentGlow: 'hover:border-rose-500/40 dark:hover:border-rose-500/30',
  },
  STRUCTURE: {
    label: 'Structure',
    icon: Lock,
    badgeBg: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/25',
    accentGlow: 'hover:border-slate-500/40 dark:hover:border-slate-500/30',
  },
};

function formatEmploymentScope(scope: RuleSpec['employment']): string {
  if (scope === 'ALL') return 'All Staff';
  if (Array.isArray(scope)) {
    return scope
      .map((s) => {
        switch (s) {
          case 'FT':
            return 'Full-Time';
          case 'PT':
            return 'Part-Time';
          case 'FPT':
            return 'Flexi-PT';
          case 'CASUAL':
            return 'Casual';
          default:
            return s;
        }
      })
      .join(', ');
  }
  return String(scope);
}

function formatAuthority(auth: RuleSpec['authority']): string {
  if (auth.source === 'eba') {
    return auth.clauses.length > 0 ? `EBA ${auth.clauses.join(', ')}` : 'EBA';
  }
  if (auth.source === 'statute') {
    return auth.instrument || 'Statute (Migration Act)';
  }
  if (auth.source === 'policy') {
    return auth.instrument || 'Scheduling Policy';
  }
  return auth.instrument || 'Operational Contract';
}

export const V8RulesBentoGrid: React.FC<V8RulesBentoGridProps> = ({
  className,
  onSelectRule,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedTier, setSelectedTier] = useState<string>('ALL');

  // Strictly filter only LABOUR rules (the exact 22 rules that V8 engine evaluates)
  const v8LabourRules = useMemo(() => {
    return Object.values(RULE_REGISTRY).filter((rule) => rule.layer === 'LABOUR');
  }, []);

  // Summary Metrics
  const stats = useMemo(() => {
    const total = v8LabourRules.length;
    const blocking = v8LabourRules.filter((r) => r.tier === 'BLOCKING').length;
    const warnings = v8LabourRules.filter((r) => r.tier === 'WARNING').length;
    const solverSynced = v8LabourRules.filter((r) => r.engines.solver !== null).length;
    return { total, blocking, warnings, solverSynced };
  }, [v8LabourRules]);

  // Filtered Rules
  const filteredRules = useMemo(() => {
    return v8LabourRules.filter((rule) => {
      // Category filter
      if (selectedCategory !== 'ALL' && rule.category !== selectedCategory) {
        return false;
      }
      // Tier filter
      if (selectedTier !== 'ALL' && rule.tier !== selectedTier) {
        return false;
      }
      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesId = rule.id.toLowerCase().includes(q);
        const matchesName = rule.name.toLowerCase().includes(q);
        const matchesDesc = rule.description.toLowerCase().includes(q);
        const matchesClause = rule.authority.clauses.some((c) => c.toLowerCase().includes(q));
        const matchesSolver = rule.engines.solver?.toLowerCase().includes(q);
        if (!matchesId && !matchesName && !matchesDesc && !matchesClause && !matchesSolver) {
          return false;
        }
      }
      return true;
    });
  }, [v8LabourRules, selectedCategory, selectedTier, searchQuery]);

  const availableCategories: RuleCategory[] = ['TIME', 'CONTRACT', 'LEGAL', 'SKILL', 'AVAILABILITY'];

  return (
    <div className={cn('space-y-8', className)}>
      {/* ── TOP KPI SUMMARY CARDS ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5">
        {/* Total V8 Rules */}
        <div className="relative overflow-hidden rounded-2xl border border-border/70 dark:border-white/10 bg-card dark:bg-[#161d2d]/90 p-5 sm:p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-muted-foreground">V8 Active Rules</span>
            <div className="rounded-xl bg-primary/10 p-2 text-primary">
              <Cpu className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">{stats.total}</span>
            <span className="text-sm font-semibold text-muted-foreground">Rules</span>
          </div>
          <p className="mt-1.5 text-[13px] text-muted-foreground leading-normal">
            100% evaluated by the V8 Compliance Engine
          </p>
        </div>

        {/* Hard Blocking Rules */}
        <div className="relative overflow-hidden rounded-2xl border border-rose-500/30 dark:border-rose-500/20 bg-rose-500/5 dark:bg-rose-950/20 p-5 sm:p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-rose-700 dark:text-rose-300">Hard Blocking</span>
            <div className="rounded-xl bg-rose-500/15 p-2 text-rose-600 dark:text-rose-400">
              <ShieldAlert className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-extrabold tracking-tight text-rose-700 dark:text-rose-300">{stats.blocking}</span>
            <span className="text-sm font-semibold text-rose-600/80 dark:text-rose-400/80">Enforced</span>
          </div>
          <p className="mt-1.5 text-[13px] text-muted-foreground leading-normal">
            Non-negotiable legal caps & hard stops
          </p>
        </div>

        {/* Advisory Warnings */}
        <div className="relative overflow-hidden rounded-2xl border border-amber-500/30 dark:border-amber-500/20 bg-amber-500/5 dark:bg-amber-950/20 p-5 sm:p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-amber-700 dark:text-amber-300">Advisory Guardrails</span>
            <div className="rounded-xl bg-amber-500/15 p-2 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-extrabold tracking-tight text-amber-700 dark:text-amber-300">{stats.warnings}</span>
            <span className="text-sm font-semibold text-amber-600/80 dark:text-amber-400/80">Warnings</span>
          </div>
          <p className="mt-1.5 text-[13px] text-muted-foreground leading-normal">
            Operational preferences & contractual agreements
          </p>
        </div>

        {/* CP-SAT Solver Parity */}
        <div className="relative overflow-hidden rounded-2xl border border-sky-500/30 dark:border-sky-500/20 bg-sky-500/5 dark:bg-sky-950/20 p-5 sm:p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-sky-700 dark:text-sky-300">CP-SAT Solver Synced</span>
            <div className="rounded-xl bg-sky-500/15 p-2 text-sky-600 dark:text-sky-400">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-extrabold tracking-tight text-sky-700 dark:text-sky-300">{stats.solverSynced}</span>
            <span className="text-sm font-semibold text-sky-600/80 dark:text-sky-400/80">Constraints</span>
          </div>
          <p className="mt-1.5 text-[13px] text-muted-foreground leading-normal">
            Mathematical parity with Python solver engine
          </p>
        </div>
      </div>

      {/* ── SEARCH & FILTER CONTROLS ── */}
      <div className="space-y-4 rounded-2xl border border-border/70 dark:border-white/10 bg-card dark:bg-[#161d2d]/90 p-5 sm:p-6 shadow-sm">
        {/* Search input with generous height */}
        <div className="relative w-full">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            placeholder="Search by rule name, rule ID (e.g. V8_NO_OVERLAP), EBA clause (e.g. cl 40), or solver constraint..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-12 pr-10 bg-background/80 border-border/70 text-[14px] sm:text-[15px] h-12 rounded-xl focus-visible:ring-2 focus-visible:ring-primary shadow-xs"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Filter Pills Row */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pt-1">
          {/* Category Tabs */}
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <button
              onClick={() => setSelectedCategory('ALL')}
              className={cn(
                'rounded-xl px-3.5 py-2 text-[13px] font-semibold transition-all shadow-xs',
                selectedCategory === 'ALL'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted/60 dark:bg-slate-800/80 text-muted-foreground hover:text-foreground hover:bg-muted',
              )}
            >
              All Categories ({v8LabourRules.length})
            </button>
            {availableCategories.map((cat) => {
              const count = v8LabourRules.filter((r) => r.category === cat).length;
              const config = CATEGORY_CONFIG[cat];
              const Icon = config.icon;
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-semibold transition-all shadow-xs',
                    selectedCategory === cat
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-muted/60 dark:bg-slate-800/80 text-muted-foreground hover:text-foreground hover:bg-muted',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{config.label}</span>
                  <span className="text-xs opacity-75">({count})</span>
                </button>
              );
            })}
          </div>

          {/* Tier Segmented Filter */}
          <div className="flex items-center rounded-xl bg-muted/60 dark:bg-slate-800/80 p-1 border border-border/40 shrink-0">
            <button
              onClick={() => setSelectedTier('ALL')}
              className={cn(
                'rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-all',
                selectedTier === 'ALL'
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              All Tiers
            </button>
            <button
              onClick={() => setSelectedTier('BLOCKING')}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-all',
                selectedTier === 'BLOCKING'
                  ? 'bg-rose-500 text-white shadow-xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="h-2 w-2 rounded-full bg-rose-400 inline-block" />
              Blocking ({stats.blocking})
            </button>
            <button
              onClick={() => setSelectedTier('WARNING')}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-all',
                selectedTier === 'WARNING'
                  ? 'bg-amber-500 text-white shadow-xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="h-2 w-2 rounded-full bg-amber-400 inline-block" />
              Warnings ({stats.warnings})
            </button>
          </div>
        </div>
      </div>

      {/* ── 2-COLUMN ENTERPRISE RULE CARDS GRID ── */}
      {filteredRules.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/70 dark:border-white/10 bg-card dark:bg-[#161d2d]/60 p-12 text-center">
          <SlidersHorizontal className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
          <h3 className="text-base font-bold text-foreground">No V8 compliance rules match your filter</h3>
          <p className="mt-1.5 text-sm text-muted-foreground">Try clearing your search query or switching to "All Categories".</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSearchQuery('');
              setSelectedCategory('ALL');
              setSelectedTier('ALL');
            }}
            className="mt-5 text-sm font-medium"
          >
            Reset Filters
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 sm:gap-6">
          {filteredRules.map((rule) => {
            const catConfig = CATEGORY_CONFIG[rule.category] || CATEGORY_CONFIG.TIME;
            const CatIcon = catConfig.icon;
            const isBlocking = rule.tier === 'BLOCKING';

            return (
              <div
                key={rule.id}
                onClick={() => onSelectRule?.(rule.id)}
                className={cn(
                  'group relative flex flex-col justify-between rounded-2xl p-6 sm:p-7 border transition-all duration-200',
                  'bg-card dark:bg-[#161d2d]/95 border-border/70 dark:border-white/10 shadow-sm hover:shadow-md',
                  catConfig.accentGlow,
                )}
              >
                {/* ── 1. Header: Category + Rule ID + Prominent Status ── */}
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-3.5">
                    {/* Category & Rule ID Tag */}
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12.5px] font-semibold border',
                          catConfig.badgeBg,
                        )}
                      >
                        <CatIcon className="h-3.5 w-3.5" />
                        {catConfig.label}
                      </span>

                      <code className="font-mono text-[12.5px] font-medium text-muted-foreground bg-muted/60 dark:bg-slate-800/80 px-2 py-0.5 rounded-md border border-border/40">
                        {rule.id}
                      </code>
                    </div>

                    {/* Prominent High-Contrast Status Pill */}
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-bold border tracking-wide uppercase shadow-xs',
                        isBlocking
                          ? 'bg-rose-500/15 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/30'
                          : 'bg-amber-500/15 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30',
                      )}
                    >
                      {isBlocking ? (
                        <>
                          <ShieldAlert className="h-3.5 w-3.5" />
                          BLOCKING
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="h-3.5 w-3.5" />
                          WARNING
                        </>
                      )}
                    </span>
                  </div>

                  {/* ── 2. Rule Name (Large & Dominant) ── */}
                  <h4 className="text-lg sm:text-[18px] font-bold text-foreground tracking-tight leading-snug group-hover:text-primary transition-colors">
                    {rule.name}
                  </h4>

                  {/* ── 3. Rule Description (14–15px Generous Typography) ── */}
                  <p className="mt-3 text-[14.5px] sm:text-[15px] leading-relaxed text-foreground/85 dark:text-slate-300 font-normal">
                    {rule.description}
                  </p>

                  {/* ── 4. Known Gap Callout if present ── */}
                  {rule.knownGap && (
                    <div className="mt-4 rounded-xl bg-amber-500/10 border border-amber-500/25 p-3.5 flex items-start gap-2.5">
                      <Info className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <p className="text-[13px] leading-relaxed text-amber-800 dark:text-amber-200 font-medium">
                        {rule.knownGap}
                      </p>
                    </div>
                  )}
                </div>

                {/* ── 5. Structured Metadata Grid ── */}
                <div className="mt-5 pt-4 border-t border-border/60 dark:border-white/10 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Authority */}
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Legal Authority
                      </span>
                      <span className="text-[13.5px] font-semibold text-foreground">
                        {formatAuthority(rule.authority)}
                      </span>
                    </div>

                    {/* Employee Scope */}
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Applies To
                      </span>
                      <span className="text-[13.5px] font-semibold text-foreground">
                        {formatEmploymentScope(rule.employment)}
                      </span>
                    </div>
                  </div>

                  {/* Solver Parity & Engine Layer */}
                  <div className="flex items-center justify-between pt-1 text-[12.5px]">
                    <div className="flex items-center gap-1.5 font-medium">
                      <span className="text-muted-foreground">Solver Mapping:</span>
                      {rule.engines.solver ? (
                        <span className="inline-flex items-center gap-1 text-sky-700 dark:text-sky-300 font-mono font-semibold bg-sky-500/10 dark:bg-sky-950/40 px-2 py-0.5 rounded border border-sky-500/25">
                          <Cpu className="h-3.5 w-3.5" /> {rule.engines.solver}
                        </span>
                      ) : (
                        <span className="text-muted-foreground font-mono">
                          Advisory (V8 Layer Only)
                        </span>
                      )}
                    </div>

                    <span className="text-xs text-muted-foreground font-mono">
                      Engine Layer: LABOUR
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default V8RulesBentoGrid;
