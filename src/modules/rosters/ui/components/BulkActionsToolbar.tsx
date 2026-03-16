import React, { useState } from 'react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { X, Trash2, TrendingUp, Loader2, Undo2, UserCheck } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/modules/core/ui/primitives/alert-dialog';
import { useToast } from '@/modules/core/hooks/use-toast';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import { cn } from '@/modules/core/lib/utils';

// =============================================================================
// STATE MACHINE
// =============================================================================

/**
 * Replaces 6 independent booleans (3 showXxxDialog + 3 isXxxing).
 * Mutex by construction — only one action can be confirming or processing at a time.
 */
type ConfirmAction = 'delete' | 'publish' | 'unpublish';

type ActionState =
  | { type: 'idle' }
  | { type: 'confirming'; action: ConfirmAction }
  | { type: 'processing'; action: ConfirmAction };

const IDLE: ActionState = { type: 'idle' };

// =============================================================================
// PROPS
// =============================================================================

interface BulkActionsToolbarProps {
  selectedCount: number;
  selectedShiftIds: string[];
  onClearSelection: () => void;
  onDelete: () => Promise<void>;
  onSelectAll?: () => void;
  onPublish?: (shiftIds: string[]) => Promise<void>;
  onUnpublish?: (shiftIds: string[]) => Promise<void>;
  onAssign?: () => void;
  onUnassign?: () => void;
  stateCounts?: {
    assignedCount: number;
    unassignedCount: number;
    draftCount: number;
    publishedCount: number;
  };
  allowedActions?: {
    canPublish: boolean;
    canUnpublish: boolean;
    /** Override tooltip when canUnpublish is false */
    canUnpublishReason?: string;
  };
}

// =============================================================================
// COMPONENT
// =============================================================================

export const BulkActionsToolbar: React.FC<BulkActionsToolbarProps> = ({
  selectedCount,
  selectedShiftIds,
  onClearSelection,
  onSelectAll,
  onDelete,
  onPublish,
  onUnpublish,
  onAssign,
  onUnassign,
  stateCounts,
  allowedActions,
}) => {
  const [actionState, setActionState] = useState<ActionState>(IDLE);
  const { toast } = useToast();

  // ── Derived booleans from state machine ──────────────────────────────────
  const showDeleteDialog    = actionState.type === 'confirming' && actionState.action === 'delete';
  const showPublishDialog   = actionState.type === 'confirming' && actionState.action === 'publish';
  const showUnpublishDialog = actionState.type === 'confirming' && actionState.action === 'unpublish';
  const isDeleting          = actionState.type === 'processing' && actionState.action === 'delete';
  const isPublishing        = actionState.type === 'processing' && actionState.action === 'publish';
  const isUnpublishing      = actionState.type === 'processing' && actionState.action === 'unpublish';
  const isBusy              = actionState.type === 'processing';

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    setActionState({ type: 'processing', action: 'delete' });
    try {
      await onDelete();
      toast({
        title: 'Shifts Deleted',
        description: `Successfully deleted ${selectedCount} shift${selectedCount > 1 ? 's' : ''}.`,
      });
      setActionState(IDLE);
      onClearSelection();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to delete shifts. Please try again.',
        variant: 'destructive',
      });
      setActionState(IDLE);
    }
  };

  const handlePublish = async () => {
    if (!onPublish) return;
    setActionState({ type: 'processing', action: 'publish' });
    try {
      await onPublish(selectedShiftIds);
      toast({
        title: 'Shifts Published',
        description: `Successfully published ${selectedCount} shift${selectedCount > 1 ? 's' : ''}.`,
      });
      setActionState(IDLE);
      onClearSelection();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to publish shifts. Please try again.',
        variant: 'destructive',
      });
      setActionState(IDLE);
    }
  };

  const handleUnpublish = async () => {
    if (!onUnpublish) return;
    setActionState({ type: 'processing', action: 'unpublish' });
    try {
      await onUnpublish(selectedShiftIds);
      toast({
        title: 'Shifts Unpublished',
        description: `Successfully unpublished ${selectedCount} shift${selectedCount > 1 ? 's' : ''}.`,
      });
      setActionState(IDLE);
      onClearSelection();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to unpublish shifts. Please try again.',
        variant: 'destructive',
      });
      setActionState(IDLE);
    }
  };

  if (selectedCount === 0) return null;

  return (
    <>
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-5 duration-300">
        <div className="bg-background/95 dark:bg-popover/90 backdrop-blur-xl border border-border shadow-[0_8px_32px_rgba(0,0,0,0.15)] rounded-full px-6 py-3 flex items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-start min-w-[120px]">
              <Badge variant="glass" className="px-3 py-1.5 text-sm font-medium bg-primary/20 text-primary dark:text-white border-primary/20 shadow-glow whitespace-nowrap flex-shrink-0">
                {selectedCount} Selected
              </Badge>
              {stateCounts && selectedCount > 0 && (
                <div className="flex gap-2 mt-1 px-1">
                  {stateCounts.assignedCount > 0 && (
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {stateCounts.assignedCount} assigned
                    </span>
                  )}
                  {stateCounts.unassignedCount > 0 && (
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {stateCounts.unassignedCount} unassigned
                    </span>
                  )}
                  {stateCounts.draftCount > 0 && (
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {stateCounts.draftCount} draft
                    </span>
                  )}
                  {stateCounts.publishedCount > 0 && (
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {stateCounts.publishedCount} published
                    </span>
                  )}
                </div>
              )}
            </div>

            {onSelectAll && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onSelectAll}
                className="gap-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-full"
              >
                <TrendingUp className="h-4 w-4" />
                Select All
              </Button>
            )}

            {/* Publish Button */}
            {onPublish && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button
                      variant="default"
                      size="sm"
                      disabled={isBusy || !(stateCounts ? stateCounts.draftCount > 0 : allowedActions?.canPublish)}
                      onClick={() => setActionState({ type: 'confirming', action: 'publish' })}
                      className={cn(
                        "gap-2 shadow-glow rounded-full",
                        (stateCounts ? stateCounts.draftCount > 0 : allowedActions?.canPublish)
                          ? "bg-emerald-500 hover:bg-emerald-600 text-white"
                          : "bg-muted text-muted-foreground/30"
                      )}
                    >
                      <TrendingUp className="h-4 w-4" />
                      Publish
                    </Button>
                  </span>
                </TooltipTrigger>
                {!(stateCounts ? stateCounts.draftCount > 0 : allowedActions?.canPublish) && (
                  <TooltipContent>
                    <p>Requires Draft shifts</p>
                  </TooltipContent>
                )}
              </Tooltip>
            )}

            {/* Unpublish Button */}
            {onUnpublish && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button
                      variant="default"
                      size="sm"
                      disabled={isBusy || !(stateCounts ? stateCounts.publishedCount > 0 : allowedActions?.canUnpublish)}
                      onClick={() => setActionState({ type: 'confirming', action: 'unpublish' })}
                      className={cn(
                        "gap-2 rounded-full",
                        (stateCounts ? stateCounts.publishedCount > 0 : allowedActions?.canUnpublish)
                          ? "bg-transparent border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 shadow-glow"
                          : "bg-muted text-muted-foreground/30"
                      )}
                    >
                      <Undo2 className="h-4 w-4" />
                      Unpublish
                    </Button>
                  </span>
                </TooltipTrigger>
                {!(stateCounts ? stateCounts.publishedCount > 0 : allowedActions?.canUnpublish) && (
                  <TooltipContent>
                    <p>{allowedActions?.canUnpublishReason ?? 'Only Published shifts can be unpublished'}</p>
                  </TooltipContent>
                )}
              </Tooltip>
            )}

            <div className="w-px h-6 bg-border mx-1" />

            {/* Assign Button */}
            {onAssign && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button
                      variant="default"
                      size="sm"
                      disabled={isBusy || (stateCounts ? stateCounts.unassignedCount === 0 : false)}
                      onClick={onAssign}
                      className={cn(
                        "gap-2 rounded-full shadow-glow",
                        (stateCounts ? stateCounts.unassignedCount > 0 : true)
                          ? "bg-primary hover:bg-primary/90 text-primary-foreground"
                          : "bg-muted text-muted-foreground/30"
                      )}
                    >
                      <UserCheck className="h-4 w-4" />
                      Assign
                    </Button>
                  </span>
                </TooltipTrigger>
                {stateCounts && stateCounts.unassignedCount === 0 && (
                  <TooltipContent>
                    <p>Requires unassigned shifts</p>
                  </TooltipContent>
                )}
              </Tooltip>
            )}

            {/* Unassign Button */}
            {onUnassign && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isBusy || (stateCounts ? stateCounts.assignedCount === 0 : false)}
                      onClick={onUnassign}
                      className={cn(
                        "gap-2 rounded-full",
                        (stateCounts ? stateCounts.assignedCount > 0 : true)
                          ? "text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                          : "text-muted-foreground/30"
                      )}
                    >
                      <X className="h-4 w-4" />
                      Unassign
                    </Button>
                  </span>
                </TooltipTrigger>
                {stateCounts && stateCounts.assignedCount === 0 && (
                  <TooltipContent>
                    <p>Requires assigned shifts</p>
                  </TooltipContent>
                )}
              </Tooltip>
            )}

            <Button
              variant="ghost"
              size="sm"
              disabled={isBusy}
              onClick={() => setActionState({ type: 'confirming', action: 'delete' })}
              className="gap-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-full"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>

            <div className="w-px h-6 bg-border mx-2" />

            <Button
              variant="ghost"
              size="icon"
              onClick={onClearSelection}
              className="text-muted-foreground hover:text-foreground rounded-full hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={(open) => !open && setActionState(IDLE)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedCount} Shift{selectedCount > 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the selected shifts
              from the roster.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Publish Confirmation */}
      <AlertDialog open={showPublishDialog} onOpenChange={(open) => !open && setActionState(IDLE)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish {selectedCount} Shift{selectedCount > 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will make the shifts visible to employees.
              <br />
              - Assigned shifts will be SENT as Offers.
              <br />
              - Unassigned shifts will go to Bidding/Open.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPublishing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-500/50"
              onClick={(e) => {
                e.preventDefault();
                handlePublish();
              }}
              disabled={isPublishing}
            >
              {isPublishing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Publishing...
                </>
              ) : (
                'Confirm Publish'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unpublish Confirmation */}
      <AlertDialog open={showUnpublishDialog} onOpenChange={(open) => !open && setActionState(IDLE)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unpublish {selectedCount} Shift{selectedCount > 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will unpublish the shifts and revert them to Draft status.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUnpublishing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700 text-white border-amber-500/50"
              onClick={(e) => {
                e.preventDefault();
                handleUnpublish();
              }}
              disabled={isUnpublishing}
            >
              {isUnpublishing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Unpublishing...
                </>
              ) : (
                'Confirm Unpublish'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
