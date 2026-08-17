import React from 'react';
import { cn } from '@/modules/core/lib/utils';
import { format } from 'date-fns';
import { RosterSummaryCellDTO } from '../../api/rosterSummary.queries';
import { AlertCircle, Maximize2, Plus } from 'lucide-react';

interface GroupSummaryCellProps {
  date: Date;
  groupName: string;
  summary: RosterSummaryCellDTO | undefined;
  accent: string; // 'blue' | 'emerald' | 'red' | 'gray' | 'amber'
  onClick: () => void;
  isBulkMode?: boolean;
  selectionState?: 'all' | 'some' | 'none';
  selectableCount?: number;
  onToggleSelect?: () => void;
  /** Bulk mode entered but the per-shift list is still loading — show a neutral
   *  indicator rather than the "no selectable shifts" state, which would flash
   *  across every bucket and look like the feature is dead. */
  isLoading?: boolean;
}

const GroupSummaryCellImpl: React.FC<GroupSummaryCellProps> = ({
  date,
  groupName,
  summary,
  accent,
  onClick,
  isBulkMode = false,
  selectionState = 'none',
  selectableCount = 0,
  onToggleSelect,
  isLoading = false,
}) => {
  const colorMap: Record<string, { bg: string; text: string; bar: string; border: string; hover: string }> = {
    blue: { bg: 'bg-blue-500/10', text: 'text-blue-700 dark:text-blue-400', bar: 'bg-blue-400', border: 'border-blue-500/20', hover: 'hover:bg-blue-500/15 hover:border-blue-500/30' },
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400', bar: 'bg-emerald-400', border: 'border-emerald-500/20', hover: 'hover:bg-emerald-500/15 hover:border-emerald-500/30' },
    red: { bg: 'bg-red-500/10', text: 'text-red-700 dark:text-red-400', bar: 'bg-red-400', border: 'border-red-500/20', hover: 'hover:bg-red-500/15 hover:border-red-500/30' },
    amber: { bg: 'bg-amber-500/10', text: 'text-amber-700 dark:text-amber-400', bar: 'bg-amber-400', border: 'border-amber-500/20', hover: 'hover:bg-amber-500/15 hover:border-amber-500/30' },
    gray: { bg: 'bg-slate-500/10', text: 'text-slate-700 dark:text-slate-400', bar: 'bg-slate-400', border: 'border-slate-500/20', hover: 'hover:bg-slate-500/15 hover:border-slate-500/30' },
  };

  const colors = colorMap[accent] || colorMap.gray;
  // Without this the cell announces as an unnamed "button" — the visible content
  // is icons and abbreviations, none of which identifies the group or the date it belongs to.
  const dateLabel = format(date, 'd MMMM yyyy');

  if (!summary || summary.total_shifts === 0) {
    const Component = isBulkMode ? 'div' : 'button';
    return (
      <Component
        onClick={isBulkMode ? undefined : onClick}
        aria-label={`Open ${groupName} roster details for ${dateLabel}: no shifts`}
        className={cn(
          "w-full h-[68px] rounded-xl border border-dashed border-border/50 bg-muted/20 flex flex-col items-center justify-center transition-colors group",
          !isBulkMode && "hover:bg-muted/40 hover:border-border/80 cursor-pointer"
        )}
      >
        <Plus className="w-5 h-5 text-purple-500/80 group-hover:text-purple-400 group-hover:scale-110 transition-all duration-200" />
      </Component>
    );
  }

  const { total_shifts, assigned_shifts, open_shifts, published_shifts, total_net_minutes } = summary;
  const coveragePct = Math.min(100, Math.round((assigned_shifts / total_shifts) * 100));

  const Component = isBulkMode ? 'div' : 'button';
  const handleCellClick = (e: React.MouseEvent) => {
    if (isBulkMode) {
      if (!isLoading && selectableCount > 0 && onToggleSelect) {
        onToggleSelect();
      }
    } else {
      onClick();
    }
  };

  return (
    <Component
      onClick={handleCellClick}
      aria-label={`Open ${groupName} roster details for ${dateLabel}: ${total_shifts} shift${total_shifts === 1 ? '' : 's'}`}
      className={cn(
        "w-full rounded-xl border p-3 flex flex-col gap-2.5 transition-all group relative text-left",
        colors.bg,
        colors.border,
        !isBulkMode && colors.hover,
        !isBulkMode && "cursor-pointer",
        isBulkMode && !isLoading && selectableCount > 0 && "cursor-pointer hover:shadow-sm",
        isBulkMode && !isLoading && selectableCount === 0 && "opacity-50 cursor-not-allowed",
        isBulkMode && isLoading && "cursor-progress",
        isBulkMode && selectionState !== 'none' && "ring-2 ring-primary border-transparent"
      )}
    >
      {/* Top Right: Selection or Maximize icon */}
      <div className="absolute top-2.5 right-2.5">
        {isBulkMode ? (
          isLoading ? (
            <div className="w-4 h-4 rounded border border-muted-foreground/30 bg-muted/30 animate-pulse" title="Loading shifts…" />
          ) : selectableCount > 0 ? (
            <div className={cn(
              "w-4 h-4 rounded border flex items-center justify-center transition-all bg-background",
              selectionState === 'all'
                ? "bg-primary border-primary text-primary-foreground"
                : selectionState === 'some'
                ? "bg-primary/40 border-primary text-primary-foreground"
                : "border-muted-foreground"
            )}>
              {selectionState === 'all' && (
                <svg className="w-2.5 h-2.5 stroke-current stroke-[3] fill-none" viewBox="0 0 24 24">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
              {selectionState === 'some' && (
                <div className="w-1.5 h-0.5 bg-foreground rounded-sm" />
              )}
            </div>
          ) : (
            <div className="w-4 h-4 rounded border border-muted/50 bg-muted/20 flex items-center justify-center" title="No selectable shifts in this bucket">
              <span className="text-[9px] text-muted-foreground">🚫</span>
            </div>
          )
        ) : (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
            <Maximize2 className={cn("w-3.5 h-3.5", colors.text)} />
          </div>
        )}
      </div>

      {/* Row 1: Badges */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-200/80 text-slate-700 dark:bg-slate-800/90 dark:text-slate-200">
            {total_shifts} shift{total_shifts !== 1 ? 's' : ''}
          </span>
          
          {open_shifts > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-600 dark:text-red-400" />
              {open_shifts} open
            </span>
          )}
        </div>
      </div>

      {/* Row 2: Coverage & Bar */}
      <div className="space-y-1.5 w-full">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
            COVERAGE
          </span>
          <span className={cn(
            "text-2xl sm:text-3xl font-black tracking-tight",
            coveragePct === 0
              ? "text-red-600 dark:text-red-400"
              : coveragePct < 50
              ? "text-rose-600 dark:text-rose-400"
              : coveragePct < 80
              ? "text-amber-600 dark:text-amber-400"
              : "text-emerald-600 dark:text-emerald-400"
          )}>
            {coveragePct}%
          </span>
        </div>
        <div className="h-1.5 sm:h-2 w-full bg-slate-200/60 dark:bg-slate-800/80 rounded-full overflow-hidden">
          <div 
            className={cn(
              "h-full rounded-full transition-all duration-500",
              coveragePct === 0
                ? "bg-transparent"
                : coveragePct < 50
                ? "bg-rose-500"
                : coveragePct < 80
                ? "bg-amber-500"
                : "bg-emerald-500"
            )} 
            style={{ width: `${coveragePct}%` }}
          />
        </div>
      </div>

      {/* Row 3: Meta */}
      <div className="flex items-center justify-between text-xs font-medium text-slate-600 dark:text-slate-300 pt-0.5">
        <span>Published {published_shifts}/{total_shifts}</span>
        <span className="font-semibold text-slate-700 dark:text-slate-200">Total {(total_net_minutes / 60).toFixed(1)}h</span>
      </div>
    </Component>
  );
};

/**
 * A month-view grid renders this several hundred times, and GroupModeView builds
 * both callbacks *inside* the cell loop — so every parent render handed each
 * cell fresh `onClick`/`onToggleSelect` identities and the whole grid
 * re-reconciled. Measured at 400 cells: ~24 ms per parent render, on every
 * state change, entirely wasted when nothing about a cell had changed.
 *
 * The comparator therefore ignores the two callback identities on purpose.
 * That is only safe because everything they close over is itself compared:
 *   - onClick        → dateKey / group type / subgroup name, fixed per cell and
 *                      covered by `date` + `groupName`
 *   - onToggleSelect → the cell's eligible ids and the selection set, both of
 *                      which are reflected in `selectionState` + `selectableCount`
 * So whenever a stale closure would matter, one of the compared props has
 * already changed and the cell re-renders anyway.
 *
 * If a future prop is added, add it here too — a silent omission shows up as a
 * cell that will not update.
 */
export const GroupSummaryCell = React.memo(GroupSummaryCellImpl, (prev, next) => {
  return (
    prev.date.getTime() === next.date.getTime() &&
    prev.groupName === next.groupName &&
    prev.summary === next.summary &&
    prev.accent === next.accent &&
    prev.isBulkMode === next.isBulkMode &&
    prev.selectionState === next.selectionState &&
    prev.selectableCount === next.selectableCount &&
    prev.isLoading === next.isLoading
  );
});
