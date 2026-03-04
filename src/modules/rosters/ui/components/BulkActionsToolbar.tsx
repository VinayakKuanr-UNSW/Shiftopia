import React, { useState } from 'react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { X, Trash2, TrendingUp, Loader2, Undo2 } from 'lucide-react';
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

interface BulkActionsToolbarProps {
  selectedCount: number;
  selectedShiftIds: string[];
  onClearSelection: () => void;
  onDelete: () => Promise<void>;
  onSelectAll?: () => void;
  onPublish?: (shiftIds: string[]) => Promise<void>;
  onUnpublish?: (shiftIds: string[]) => Promise<void>;
  allowedActions?: {
    canPublish: boolean;
    canUnpublish: boolean;
    /** Override tooltip when canUnpublish is false */
    canUnpublishReason?: string;
  };
}

export const BulkActionsToolbar: React.FC<BulkActionsToolbarProps> = ({
  selectedCount,
  selectedShiftIds,
  onClearSelection,
  onSelectAll,
  onDelete,
  onPublish,
  onUnpublish,
  allowedActions,
}) => {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [showUnpublishDialog, setShowUnpublishDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isUnpublishing, setIsUnpublishing] = useState(false);
  const { toast } = useToast();

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete();
      toast({
        title: 'Shifts Deleted',
        description: `Successfully deleted ${selectedCount} shift${selectedCount > 1 ? 's' : ''}.`,
      });
      setShowDeleteDialog(false);
      onClearSelection();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to delete shifts. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handlePublish = async () => {
    if (!onPublish) return;
    setIsPublishing(true);
    try {
      await onPublish(selectedShiftIds);
      toast({
        title: 'Shifts Published',
        description: `Successfully published ${selectedCount} shift${selectedCount > 1 ? 's' : ''}.`,
      });
      setShowPublishDialog(false);
      onClearSelection();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to publish shifts. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    if (!onUnpublish) return;
    setIsUnpublishing(true);
    try {
      await onUnpublish(selectedShiftIds);
      toast({
        title: 'Shifts Unpublished',
        description: `Successfully unpublished ${selectedCount} shift${selectedCount > 1 ? 's' : ''}.`,
      });
      setShowUnpublishDialog(false);
      onClearSelection();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to unpublish shifts. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsUnpublishing(false);
    }
  };

  if (selectedCount === 0) return null;

  return (
    <>
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-5 duration-300">
        <div className="bg-white dark:bg-black/80 backdrop-blur-xl border border-slate-200 dark:border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.15)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4)] rounded-full px-6 py-3 flex items-center gap-4">
          <div className="flex items-center gap-4">
            <Badge variant="glass" className="px-3 py-1.5 text-sm font-medium bg-primary/20 text-primary dark:text-white border-primary/20 shadow-glow whitespace-nowrap flex-shrink-0">
              {selectedCount} Selected
            </Badge>

            {onSelectAll && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onSelectAll}
                className="gap-2 text-slate-600 dark:text-white/70 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-full"
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
                      disabled={!allowedActions?.canPublish}
                      onClick={() => setShowPublishDialog(true)}
                      className={cn(
                        "gap-2 shadow-glow rounded-full",
                        allowedActions?.canPublish
                          ? "bg-emerald-500 hover:bg-emerald-600 text-white"
                          : "bg-slate-100 dark:bg-white/5 text-slate-300 dark:text-white/30"
                      )}
                    >
                      <TrendingUp className="h-4 w-4" />
                      Publish
                    </Button>
                  </span>
                </TooltipTrigger>
                {!allowedActions?.canPublish && (
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
                      disabled={!allowedActions?.canUnpublish}
                      onClick={() => setShowUnpublishDialog(true)}
                      className={cn(
                        "gap-2 rounded-full",
                        allowedActions?.canUnpublish
                          ? "bg-transparent border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 shadow-glow"
                          : "bg-slate-100 dark:bg-white/5 text-slate-300 dark:text-white/30"
                      )}
                    >
                      <Undo2 className="h-4 w-4" />
                      Unpublish
                    </Button>
                  </span>
                </TooltipTrigger>
                {!allowedActions?.canUnpublish && (
                  <TooltipContent>
                    <p>{allowedActions?.canUnpublishReason ?? 'Only Offered or Bidding shifts can be unpublished'}</p>
                  </TooltipContent>
                )}
              </Tooltip>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDeleteDialog(true)}
              className="gap-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-full"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>

            <div className="w-px h-6 bg-slate-200 dark:bg-white/10 mx-2" />

            <Button
              variant="ghost"
              size="icon"
              onClick={onClearSelection}
              className="text-slate-400 dark:text-white/50 hover:text-slate-700 dark:hover:text-white rounded-full hover:bg-slate-100 dark:hover:bg-white/10"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
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

      {/* Publish Confirmation Dialog */}
      <AlertDialog open={showPublishDialog} onOpenChange={setShowPublishDialog}>
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

      {/* Unpublish Confirmation Dialog */}
      <AlertDialog open={showUnpublishDialog} onOpenChange={setShowUnpublishDialog}>
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
