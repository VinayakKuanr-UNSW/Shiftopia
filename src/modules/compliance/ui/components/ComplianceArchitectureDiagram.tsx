import React, { useState } from 'react';
import {
  Layers,
  ArrowRight,
  ShieldCheck,
  Cpu,
  Database,
  Lock,
  Sparkles,
  GitBranch,
  ChevronDown,
  ChevronUp,
  FileCode,
  Scale,
  CheckCircle2,
  AlertCircle,
  Clock,
  Workflow,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { Badge } from '@/modules/core/ui/primitives/badge';

interface ComplianceArchitectureDiagramProps {
  className?: string;
}

export const ComplianceArchitectureDiagram: React.FC<ComplianceArchitectureDiagramProps> = ({
  className,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeStage, setActiveStage] = useState<number | null>(null);

  const stages = [
    {
      step: '01',
      title: 'Shift Shape Gate',
      subtitle: 'Single Shift Geometry',
      layer: 'SHAPE LAYER (12 Rules)',
      engine: 'TypeScript Pre-Validation',
      icon: Clock,
      color: 'sky',
      borderClass: 'border-sky-500/30 hover:border-sky-500/60',
      bgClass: 'bg-sky-500/5',
      badgeClass: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
      constraints: ['HC-8 (Min Engagement)', 'Max 12h Span', 'Mandatory Meal & Rest Breaks'],
      description:
        'Evaluated instantly at shift creation / editing before any employee is assigned. Rejects degenerate durations (< 3h/4h) or invalid break structures.',
    },
    {
      step: '02',
      title: 'CP-SAT Solver',
      subtitle: 'Macro Schedule Optimizer',
      layer: 'SOLVER LAYER (OR-Tools)',
      engine: 'Python CP-SAT (model_builder.py)',
      icon: Cpu,
      color: 'purple',
      borderClass: 'border-purple-500/30 hover:border-purple-500/60',
      bgClass: 'bg-purple-500/5',
      badgeClass: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30',
      constraints: ['HC-1 (Coverage)', 'HC-6 (Capacity)', 'HC-7 (Min Contract)', 'SC-1..6 (Objective)'],
      description:
        'Solves roster-wide combinatorial assignments using lexicographic objectives: Hard Legal Caps » Coverage » Soft Availability » Fatigue/Fairness » Cost.',
    },
    {
      step: '03',
      title: 'V8 Labour Auditor',
      subtitle: 'Micro Assignment Engine',
      layer: 'LABOUR LAYER (22 Rules)',
      engine: 'TypeScript V8Engine.evaluate()',
      icon: ShieldCheck,
      color: 'emerald',
      borderClass: 'border-emerald-500/30 hover:border-emerald-500/60',
      bgClass: 'bg-emerald-500/5',
      badgeClass: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
      constraints: ['HC-2 (Overlap)', 'HC-3 (Rest Gap)', 'HC-4 (Caps)', 'HC-5 (Eligibility)', 'HC-9..13'],
      description:
        'Audits live candidate assignments, shift swaps, and manual manager edits against the ICC Sydney EBA and statutory rules (16 Blocking, 6 Warnings).',
    },
    {
      step: '04',
      title: 'Database Backstop',
      subtitle: 'Transactional Isolation',
      layer: 'TRANSACTION BACKSTOP',
      engine: 'PostgreSQL sm_apply_shift_op',
      icon: Database,
      color: 'amber',
      borderClass: 'border-amber-500/30 hover:border-amber-500/60',
      bgClass: 'bg-amber-500/5',
      badgeClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
      constraints: ['pg_advisory_xact_lock', 'CAS Optimistic Lock', 'compliance_rejections Audit'],
      description:
        'Routes all mutations through sm_apply_shift_op with employee advisory locks and CAS version checks to guarantee zero lost updates or race conditions.',
    },
  ];

  return (
    <div
      className={cn(
        'rounded-2xl border border-border/70 dark:border-white/10 bg-card dark:bg-[#161d2d]/95 p-5 sm:p-6 shadow-sm space-y-4 transition-all',
        className,
      )}
    >
      {/* Top Header & Toggle */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary border border-primary/20">
            <Workflow className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <span>Shiftopia Multi-Layer Compliance & Solver Architecture</span>
              <Badge variant="outline" className="font-mono text-xs font-semibold py-0 px-2">
                4-Stage Pipeline
              </Badge>
            </h3>
            <p className="text-xs sm:text-[13px] text-muted-foreground mt-0.5">
              How Shift Shape, CP-SAT Solver Macro Constraints, V8 Labour Rules, and Database Locks synchronize.
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground bg-muted/60 dark:bg-slate-800/80 px-3 py-1.5 rounded-lg border border-border/40 transition-colors"
        >
          <span>{isExpanded ? 'Collapse Diagram' : 'Expand Diagram'}</span>
          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Expandable Architecture Content */}
      {isExpanded && (
        <div className="pt-2 space-y-6">
          {/* Visual 4-Stage Connected Flow */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 relative">
            {stages.map((stage, idx) => {
              const Icon = stage.icon;
              const isLast = idx === stages.length - 1;
              const isActive = activeStage === idx;

              return (
                <div
                  key={stage.step}
                  onMouseEnter={() => setActiveStage(idx)}
                  onMouseLeave={() => setActiveStage(null)}
                  className={cn(
                    'relative rounded-xl border p-4 sm:p-5 transition-all cursor-pointer flex flex-col justify-between space-y-3',
                    stage.bgClass,
                    stage.borderClass,
                    isActive && 'ring-2 ring-primary/40 shadow-md',
                  )}
                >
                  {/* Top Step & Layer Badge */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-extrabold text-muted-foreground">
                      STAGE {stage.step}
                    </span>
                    <span
                      className={cn(
                        'font-mono text-[10.5px] font-bold px-2 py-0.5 rounded-md border tracking-wide uppercase',
                        stage.badgeClass,
                      )}
                    >
                      {stage.layer.split(' ')[0]}
                    </span>
                  </div>

                  {/* Stage Title & Icon */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-foreground shrink-0" />
                      <h4 className="text-[15px] font-extrabold text-foreground leading-snug">
                        {stage.title}
                      </h4>
                    </div>
                    <span className="text-xs font-semibold text-muted-foreground block">
                      {stage.subtitle}
                    </span>
                  </div>

                  {/* Description */}
                  <p className="text-[12.5px] text-foreground/80 leading-relaxed">
                    {stage.description}
                  </p>

                  {/* Constraints Tag List */}
                  <div className="pt-2 border-t border-border/40 space-y-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                      Key Constraints Enforced:
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {stage.constraints.map((c, cIdx) => (
                        <code
                          key={cIdx}
                          className="font-mono text-[11px] bg-background/80 px-1.5 py-0.5 rounded border border-border/50 text-foreground/90 font-medium"
                        >
                          {c}
                        </code>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Lexicographic Objective Hierarchy Callout */}
          <div className="rounded-xl border border-border/60 bg-muted/30 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-foreground font-semibold">
              <Scale className="h-4 w-4 text-primary shrink-0" />
              <span>Lexicographic Solver Hierarchy:</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11.5px]">
              <span className="bg-rose-500/15 text-rose-700 dark:text-rose-300 px-2 py-0.5 rounded border border-rose-500/30 font-bold">
                1. Legal Hard Caps (HC-1..13)
              </span>
              <span className="text-muted-foreground">»</span>
              <span className="bg-sky-500/15 text-sky-700 dark:text-sky-300 px-2 py-0.5 rounded border border-sky-500/30 font-bold">
                2. Shift Coverage (100%)
              </span>
              <span className="text-muted-foreground">»</span>
              <span className="bg-purple-500/15 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded border border-purple-500/30 font-bold">
                3. Soft Availability (SC-1..2)
              </span>
              <span className="text-muted-foreground">»</span>
              <span className="bg-amber-500/15 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded border border-amber-500/30 font-bold">
                4. Fatigue & Fairness (SC-4)
              </span>
              <span className="text-muted-foreground">»</span>
              <span className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/30 font-bold">
                5. Cost / Overtime (SC-5)
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ComplianceArchitectureDiagram;
