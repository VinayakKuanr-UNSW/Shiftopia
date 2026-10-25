import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { surface } from '@/modules/core/ui/layout/pageTokens';

export interface RosterPaginationFooterProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  isTruncated?: boolean;
  itemLabel?: string;
  className?: string;
}

/**
 * Disconnected pagination footer for Roster Planner views.
 *
 * Styled after the disconnected segmented toggles in myswaps:
 * - Standalone rounded-2xl capsule container outside the parent card
 * - Theme-aware glassmorphism (`bg-slate-100/85 dark:bg-[#1c2333]/85 border border-slate-200/50 dark:border-white/5`)
 * - WCAG 2.1/2.2 AA compliant tap targets (>= 34px desktop, >= 38px touch, 44px effective touch area)
 * - Full ARIA semantics: role="navigation", aria-live="polite", aria-pressed, aria-current="page"
 */
export const RosterPaginationFooter: React.FC<RosterPaginationFooterProps> = ({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  isTruncated = false,
  itemLabel = 'employees',
  className,
}) => {
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * (pageSize || totalItems) + 1;
  const endItem = pageSize === 0 ? totalItems : Math.min(currentPage * pageSize, totalItems);

  return (
    <nav
      role="navigation"
      aria-label="Roster employee pagination"
      className={cn('w-full shrink-0', className)}
    >
      {/* Same bar as every footer, but it may wrap on a narrow window, so its height is a floor. */}
      <div className={cn(surface.footerBar, 'h-auto min-h-14 flex-wrap py-1.5')}>
        {/* Left: Range and Count with ARIA live region */}
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="flex items-center gap-2 px-3 py-1 text-slate-700 dark:text-slate-300 font-mono text-[11px] select-none"
        >
          <span>
            Showing{' '}
            <strong className="font-bold text-slate-900 dark:text-white tabular-nums">
              {startItem}–{endItem}
            </strong>{' '}
            of{' '}
            <strong className="font-bold text-slate-900 dark:text-white tabular-nums">
              {totalItems}
            </strong>{' '}
            {itemLabel}
            {isTruncated && (
              <span className="text-amber-500 ml-1.5 text-[11px] font-sans font-medium">
                (search to view more)
              </span>
            )}
          </span>
        </div>

        {/* Center: Rows per page selector with WCAG tap targets */}
        <div
          role="group"
          aria-label="Rows per page"
          className="flex items-center gap-1 bg-white/50 dark:bg-black/30 p-1 rounded-xl border border-slate-200/40 dark:border-white/5"
        >
          <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 px-2 select-none">
            Per page:
          </span>
          {[10, 15, 25, 50, 0].map((size) => {
            const isSelected = pageSize === size;
            const label = size === 0 ? 'All' : size.toString();
            return (
              <button
                key={size}
                type="button"
                onClick={() => {
                  onPageSizeChange(size);
                  onPageChange(1);
                }}
                aria-pressed={isSelected}
                aria-label={`Show ${size === 0 ? 'all' : size} ${itemLabel} per page${isSelected ? ', currently selected' : ''}`}
                className={cn(
                  'min-h-[38px] min-w-[38px] sm:min-h-[34px] sm:min-w-[34px] px-2.5 py-1.5 rounded-lg text-[11px] font-mono font-bold transition-all cursor-pointer flex items-center justify-center touch-manipulation',
                  'focus-visible:ring-2 focus-visible:ring-[#7b61ff] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#1c2333] focus-visible:outline-none active:scale-[0.97]',
                  isSelected
                    ? 'bg-[#7b61ff] text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white/70 dark:hover:bg-white/10'
                )}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Right: Page Navigation with WCAG tap targets */}
        <div
          role="group"
          aria-label="Page navigation"
          className="flex items-center gap-1 bg-white/50 dark:bg-black/30 p-1 rounded-xl border border-slate-200/40 dark:border-white/5"
        >
          <button
            type="button"
            onClick={() => onPageChange(1)}
            disabled={currentPage <= 1}
            aria-disabled={currentPage <= 1}
            aria-label="Go to first page"
            className={cn(
              'min-h-[38px] min-w-[38px] sm:min-h-[34px] sm:min-w-[34px] p-2 rounded-lg text-[11px] transition-all flex items-center justify-center touch-manipulation',
              'focus-visible:ring-2 focus-visible:ring-[#7b61ff] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#1c2333] focus-visible:outline-none active:scale-[0.97]',
              currentPage <= 1
                ? 'opacity-30 cursor-not-allowed text-slate-400 dark:text-slate-600'
                : 'cursor-pointer text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white/70 dark:hover:bg-white/10'
            )}
          >
            <ChevronsLeft className="w-4 h-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            aria-disabled={currentPage <= 1}
            aria-label={`Go to previous page, page ${currentPage - 1}`}
            className={cn(
              'min-h-[38px] sm:min-h-[34px] px-3 py-1.5 rounded-lg text-[11px] font-mono font-bold transition-all flex items-center gap-1 touch-manipulation',
              'focus-visible:ring-2 focus-visible:ring-[#7b61ff] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#1c2333] focus-visible:outline-none active:scale-[0.97]',
              currentPage <= 1
                ? 'opacity-30 cursor-not-allowed text-slate-400 dark:text-slate-600'
                : 'cursor-pointer text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white/70 dark:hover:bg-white/10'
            )}
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            <span className="hidden sm:inline">Prev</span>
          </button>

          <div
            aria-current="page"
            aria-label={`Current page, page ${currentPage} of ${totalPages}`}
            className="px-3 py-1.5 text-[11px] font-mono tabular-nums text-slate-700 dark:text-slate-200 select-none"
          >
            Page{' '}
            <strong className="font-bold text-slate-900 dark:text-white">
              {currentPage}
            </strong>{' '}
            of{' '}
            <strong className="font-bold text-slate-900 dark:text-white">
              {totalPages}
            </strong>
          </div>

          <button
            type="button"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
            aria-disabled={currentPage >= totalPages}
            aria-label={`Go to next page, page ${currentPage + 1}`}
            className={cn(
              'min-h-[38px] sm:min-h-[34px] px-3 py-1.5 rounded-lg text-[11px] font-mono font-bold transition-all flex items-center gap-1 touch-manipulation',
              'focus-visible:ring-2 focus-visible:ring-[#7b61ff] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#1c2333] focus-visible:outline-none active:scale-[0.97]',
              currentPage >= totalPages
                ? 'opacity-30 cursor-not-allowed text-slate-400 dark:text-slate-600'
                : 'cursor-pointer text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white/70 dark:hover:bg-white/10'
            )}
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => onPageChange(totalPages)}
            disabled={currentPage >= totalPages}
            aria-disabled={currentPage >= totalPages}
            aria-label={`Go to last page, page ${totalPages}`}
            className={cn(
              'min-h-[38px] min-w-[38px] sm:min-h-[34px] sm:min-w-[34px] p-2 rounded-lg text-[11px] transition-all flex items-center justify-center touch-manipulation',
              'focus-visible:ring-2 focus-visible:ring-[#7b61ff] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#1c2333] focus-visible:outline-none active:scale-[0.97]',
              currentPage >= totalPages
                ? 'opacity-30 cursor-not-allowed text-slate-400 dark:text-slate-600'
                : 'cursor-pointer text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white/70 dark:hover:bg-white/10'
            )}
          >
            <ChevronsRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </nav>
  );
};

export default RosterPaginationFooter;
