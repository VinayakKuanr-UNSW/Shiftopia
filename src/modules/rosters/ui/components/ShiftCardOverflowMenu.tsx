import React from 'react';
import {
  Pencil,
  ShieldCheck,
  Layers,
  Send,
  Undo2,
  Trash2,
  Ban,
  MoreVertical,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/modules/core/ui/primitives/dropdown-menu';
import { getShiftRemoval } from '@/modules/rosters/domain/shift-removal';
import { cn } from '@/modules/core/lib/utils';
import type { Shift } from '@/modules/rosters/domain/shift.entity';

export interface ShiftCardOverflowMenuProps {
  shift: Shift;
  onEdit?: () => void;
  onAudit?: () => void;
  onDetails?: () => void;
  onPublish?: () => void;
  onUnpublish?: () => void;
  onDelete?: () => void;
  onCancel?: () => void;
  canEdit?: boolean;
  isPast?: boolean;
  className?: string;
  triggerClassName?: string;
}

/**
 * Minimalist, theme-adaptive overflow action menu for manager roster shift cards.
 *
 * Adheres to:
 * - Reference design: Circular vertical 3-dots trigger, rounded popover, pill hover items.
 * - Icon <One word only> contract: Edit, Audit, Details, Publish, Unpublish, Delete, Cancel.
 * - Non-glass theme tokens: solid `bg-popover text-popover-foreground` adapting to dark/light.
 * - WCAG 2.1 AA / AAA: >=44px touch targets, full keyboard roving focus via Radix UI,
 *   aria-hidden decorative icons, and explicit screen-reader accessible names.
 */
export const ShiftCardOverflowMenu: React.FC<ShiftCardOverflowMenuProps> = ({
  shift,
  onEdit,
  onAudit,
  onDetails,
  onPublish,
  onUnpublish,
  onDelete,
  onCancel,
  canEdit = true,
  isPast = false,
  className,
  triggerClassName,
}) => {
  const roleName = shift.roles?.name || (shift as any).role || 'Shift';
  const removalType = getShiftRemoval(shift);

  const canPublish = !isPast && canEdit && (shift.lifecycle_status === 'Draft' || !shift.lifecycle_status) && !!onPublish;
  const canUnpublishShift = !isPast && canEdit && shift.lifecycle_status === 'Published' && !!onUnpublish;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Actions for ${roleName}`}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            // 28px to look at, 44px to hit (the ::before pad adds 8px each side)
            'relative h-7 w-7 rounded-full flex items-center justify-center transition-colors duration-150',
            "before:absolute before:-inset-2 before:content-['']",
            'text-slate-600 hover:text-slate-950 hover:bg-black/5',
            'dark:text-white/80 dark:hover:text-white dark:hover:bg-white/10',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
            triggerClassName
          )}
        >
          <MoreVertical className="h-4 w-4 shrink-0" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className={cn(
          'w-44 p-1.5 rounded-2xl bg-popover text-popover-foreground border border-border/80 shadow-xl z-50 select-none',
          'animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
          className
        )}
      >
        {/* Section 1: Primary Actions */}
        {onEdit && (
          <DropdownMenuItem
            disabled={isPast || !canEdit}
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className={cn(
              'min-h-[44px] px-3 py-2 rounded-xl text-[13px] font-medium flex items-center gap-2.5 cursor-pointer transition-colors duration-150',
              'text-popover-foreground focus:bg-accent focus:text-accent-foreground hover:bg-accent hover:text-accent-foreground',
              (isPast || !canEdit) && 'opacity-40 cursor-not-allowed hover:bg-transparent focus:bg-transparent'
            )}
          >
            <Pencil className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>Edit</span>
          </DropdownMenuItem>
        )}

        {onAudit && (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onAudit();
            }}
            className="min-h-[44px] px-3 py-2 rounded-xl text-[13px] font-medium flex items-center gap-2.5 cursor-pointer transition-colors duration-150 text-popover-foreground focus:bg-accent focus:text-accent-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <ShieldCheck className="h-4 w-4 shrink-0 text-indigo-500 dark:text-indigo-400" aria-hidden="true" />
            <span>Audit</span>
          </DropdownMenuItem>
        )}

        {onDetails && (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onDetails();
            }}
            className="min-h-[44px] px-3 py-2 rounded-xl text-[13px] font-medium flex items-center gap-2.5 cursor-pointer transition-colors duration-150 text-popover-foreground focus:bg-accent focus:text-accent-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <Layers className="h-4 w-4 shrink-0 text-cyan-500 dark:text-cyan-400" aria-hidden="true" />
            <span>Details</span>
          </DropdownMenuItem>
        )}

        {/* Section 2: Lifecycle Actions (Publish / Unpublish) */}
        {(canPublish || canUnpublishShift) && (
          <>
            <DropdownMenuSeparator className="my-1 -mx-1 h-px bg-border/60" />
            {canPublish && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onPublish();
                }}
                className="min-h-[44px] px-3 py-2 rounded-xl text-[13px] font-medium flex items-center gap-2.5 cursor-pointer transition-colors duration-150 text-popover-foreground focus:bg-accent focus:text-accent-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <Send className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                <span>Publish</span>
              </DropdownMenuItem>
            )}

            {canUnpublishShift && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onUnpublish();
                }}
                className="min-h-[44px] px-3 py-2 rounded-xl text-[13px] font-medium flex items-center gap-2.5 cursor-pointer transition-colors duration-150 text-amber-600 dark:text-amber-400 focus:bg-amber-500/10 focus:text-amber-600 dark:focus:text-amber-400 hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400"
              >
                <Undo2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Unpublish</span>
              </DropdownMenuItem>
            )}
          </>
        )}

        {/* Section 3: Destructive Actions (Delete draft vs Cancel published) */}
        {removalType && (onDelete || onCancel) && (
          <>
            <DropdownMenuSeparator className="my-1 -mx-1 h-px bg-border/60" />
            {removalType === 'delete' && onDelete && (
              <DropdownMenuItem
                disabled={isPast || !canEdit}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className={cn(
                  'min-h-[44px] px-3 py-2 rounded-xl text-[13px] font-medium flex items-center gap-2.5 cursor-pointer transition-colors duration-150',
                  'text-destructive focus:bg-destructive/10 focus:text-destructive hover:bg-destructive/10 hover:text-destructive',
                  (isPast || !canEdit) && 'opacity-40 cursor-not-allowed hover:bg-transparent focus:bg-transparent'
                )}
              >
                <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Delete</span>
              </DropdownMenuItem>
            )}

            {removalType === 'cancel' && onCancel && (
              <DropdownMenuItem
                disabled={!canEdit}
                onClick={(e) => {
                  e.stopPropagation();
                  onCancel();
                }}
                className={cn(
                  'min-h-[44px] px-3 py-2 rounded-xl text-[13px] font-medium flex items-center gap-2.5 cursor-pointer transition-colors duration-150',
                  'text-destructive focus:bg-destructive/10 focus:text-destructive hover:bg-destructive/10 hover:text-destructive',
                  !canEdit && 'opacity-40 cursor-not-allowed hover:bg-transparent focus:bg-transparent'
                )}
              >
                <Ban className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Cancel</span>
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
