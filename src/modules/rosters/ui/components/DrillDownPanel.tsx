import React, { useState, useMemo, useEffect } from 'react';
import { useShiftFormNav } from '@/modules/rosters/hooks/useShiftFormNav';
import { 
  useShiftsByDateRange,
  useDeleteShift,
  usePublishShift,
  useUnpublishShift,
  useCreateShift,
  useBulkPublishShifts,
  useBulkUnpublishShifts,
  useBulkDeleteShifts,
} from '@/modules/rosters/state/useRosterShifts';
import { useRosterStore } from '@/modules/rosters/state/useRosterStore';
import { X, Loader2, Edit2, Trash2, Send, Undo2, Lock, ChevronLeft } from 'lucide-react';
import { isSydneyPast, isSydneyStarted, formatCalendarDate } from '@/modules/core/lib/date.utils';
import { cn } from '@/modules/core/lib/utils';
import { Button } from '@/modules/core/ui/primitives/button';
import { Checkbox } from '@/modules/core/ui/primitives/checkbox';
import { SmartShiftCard } from './SmartShiftCard';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Shift } from '@/modules/rosters/domain/shift.entity';
import { ShiftHistoryTimeline } from './ShiftHistoryTimeline';
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

interface DrillDownPanelProps {
  isOpen: boolean;
  onClose: () => void;
  date: string; // yyyy-MM-dd
  groupType: string;
  subGroupName?: string; // Optional, to filter down to a single cell instead of the whole group
  organizationId?: string;
  departmentId?: string;
  subDepartmentId?: string;
  groupName: string;
  rosterId?: string;
}

export const DrillDownPanel: React.FC<DrillDownPanelProps> = ({
  isOpen,
  onClose,
  date,
  groupType,
  subGroupName,
  organizationId,
  departmentId,
  subDepartmentId,
  groupName,
  rosterId,
}) => {
  const { toast } = useToast();
  const openShiftFormNav = useShiftFormNav();

  // State for showing Shift History inside the central modal
  const [historyShiftId, setHistoryShiftId] = useState<string | null>(null);

  const isPastDate = useMemo(() => {
    if (!date) return false;
    try {
      return isSydneyPast(new Date(date + 'T00:00:00'));
    } catch {
      return false;
    }
  }, [date]);
  
  // State for Delete Dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [shiftToDelete, setShiftToDelete] = useState<Shift | null>(null);

  // Mutations
  const deleteMutation = useDeleteShift();
  const publishMutation = usePublishShift();
  const unpublishMutation = useUnpublishShift();
  const createShiftMutation = useCreateShift();

  // Fetch only when panel is open
  const queryOrgId = isOpen ? organizationId || null : null;
  const { data: shifts = [], isLoading } = useShiftsByDateRange(
    queryOrgId,
    date,
    date,
    {
      departmentIds: departmentId ? [departmentId] : undefined,
      subDepartmentIds: subDepartmentId ? [subDepartmentId] : undefined,
    }
  );

  // Filter shifts
  const filteredShifts = shifts.filter(s => {
    if (s.group_type !== groupType) return false;
    if (subGroupName && s.sub_group_name !== subGroupName) return false;
    return true;
  });

  // Bulk Mode Store selectors & actions
  const bulkModeActive = useRosterStore((s) => s.bulkModeActive);
  const selectedV8ShiftIds = useRosterStore((s) => s.selectedV8ShiftIds);
  const toggleShiftSelection = useRosterStore((s) => s.toggleShiftSelection);
  const selectMultiple = useRosterStore((s) => s.selectMultiple);
  const setSelectedV8ShiftIds = useRosterStore((s) => s.setSelectedV8ShiftIds);
  const clearSelection = useRosterStore((s) => s.clearSelection);

  // Clear selection and history mode when modal opens, closes, or changes date
  useEffect(() => {
    clearSelection();
    setHistoryShiftId(null);
    return () => {
      clearSelection();
      setHistoryShiftId(null);
    };
  }, [isOpen, date, clearSelection]);

  // Escape closes the modal (standard centered-dialog affordance)
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const selectableShifts = useMemo(() => {
    return filteredShifts.filter(s => {
      const startTimeStr = s.start_time || (s as any).startTime || (s as any).start || '00:00';
      const hasStarted = isSydneyStarted(s.shift_date, startTimeStr);
      return !isPastDate && !hasStarted;
    });
  }, [filteredShifts, isPastDate]);

  const allSelected = useMemo(() => {
    if (selectableShifts.length === 0) return false;
    return selectableShifts.every(s => selectedV8ShiftIds.has(s.id));
  }, [selectableShifts, selectedV8ShiftIds]);

  const handleSelectAllToggle = () => {
    const selectableIds = selectableShifts.map(s => s.id);
    if (selectableIds.length === 0) return;
    
    if (allSelected) {
      const nextSet = new Set(selectedV8ShiftIds);
      selectableIds.forEach(id => nextSet.delete(id));
      setSelectedV8ShiftIds(nextSet);
    } else {
      selectMultiple(selectableIds);
    }
  };

  // Local bulk action states & mutations
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const bulkPublish = useBulkPublishShifts();
  const bulkUnpublish = useBulkUnpublishShifts();
  const bulkDelete = useBulkDeleteShifts();

  const selectedInDrawerCount = useMemo(() => filteredShifts.filter(s => selectedV8ShiftIds.has(s.id)).length, [filteredShifts, selectedV8ShiftIds]);
  const selectedDrawerShiftIds = useMemo(() => filteredShifts.filter(s => selectedV8ShiftIds.has(s.id)).map(s => s.id), [filteredShifts, selectedV8ShiftIds]);

  const draftSelectedCount = useMemo(() => {
    return filteredShifts.filter(s => selectedV8ShiftIds.has(s.id) && s.lifecycle_status === 'Draft').length;
  }, [filteredShifts, selectedV8ShiftIds]);

  const publishedSelectedCount = useMemo(() => {
    return filteredShifts.filter(s => selectedV8ShiftIds.has(s.id) && s.lifecycle_status === 'Published').length;
  }, [filteredShifts, selectedV8ShiftIds]);

  const isPublishing = bulkPublish.isPending;
  const isUnpublishing = bulkUnpublish.isPending;
  const isDeleting = bulkDelete.isPending;
  const isProcessing = isPublishing || isUnpublishing || isDeleting;

  const hasDraftSelected = draftSelectedCount > 0;
  const hasPublishedSelected = publishedSelectedCount > 0;

  const handleBulkPublish = async () => {
    const draftIds = filteredShifts
      .filter(s => selectedV8ShiftIds.has(s.id) && s.lifecycle_status === 'Draft')
      .map(s => s.id);
    if (draftIds.length === 0) return;
    try {
      // bulkPublishShifts returns a partial result — some shifts are skipped (e.g.
      // unassigned shifts inside the 4h emergency window, which can't be opened for
      // bidding). Report the ACTUAL outcome rather than assuming all published.
      const result = await bulkPublish.mutateAsync(draftIds);
      const published = result.publishedIds.length;
      const skipped = [...result.complianceFailed, ...result.dbFailed];

      if (published > 0 && skipped.length === 0) {
        toast({ title: 'Shifts Published', description: `Successfully published ${published} shift${published === 1 ? '' : 's'}.` });
        clearSelection();
      } else if (published > 0) {
        toast({
          title: `Published ${published} of ${draftIds.length}`,
          description: `${skipped.length} skipped — ${skipped[0].reason}`,
          variant: 'destructive',
        });
        clearSelection();
      } else {
        // Nothing published — keep the selection so the manager can act (e.g. assign
        // an employee, then emergency-publish). Surface the first reason.
        toast({
          title: 'Nothing Published',
          description: skipped[0]?.reason ?? 'These shifts can’t be published right now.',
          variant: 'destructive',
        });
      }
    } catch (e: any) {
      toast({ title: 'Publish Failed', description: e.message || 'Error', variant: 'destructive' });
    }
  };

  const handleBulkUnpublish = async () => {
    const publishedIds = filteredShifts
      .filter(s => selectedV8ShiftIds.has(s.id) && s.lifecycle_status === 'Published')
      .map(s => s.id);
    if (publishedIds.length === 0) return;
    try {
      await bulkUnpublish.mutateAsync(publishedIds);
      toast({ title: 'Shifts Unpublished', description: `Successfully reverted ${publishedIds.length} shifts to Draft.` });
      clearSelection();
    } catch (e: any) {
      toast({ title: 'Unpublish Failed', description: e.message || 'Error', variant: 'destructive' });
    }
  };

  const handleBulkDelete = async () => {
    if (selectedDrawerShiftIds.length === 0) return;
    try {
      await bulkDelete.mutateAsync(selectedDrawerShiftIds);
      toast({ title: 'Shifts Deleted', description: `Successfully deleted ${selectedDrawerShiftIds.length} shifts.` });
      clearSelection();
      setBulkDeleteConfirmOpen(false);
    } catch (e: any) {
      toast({ title: 'Delete Failed', description: e.message || 'Error', variant: 'destructive' });
    }
  };

  const displayDate = date ? formatCalendarDate(date, 'EEEE, MMMM d, yyyy') : '';

  // Handlers
  const handlePublishShift = async (shift: Shift) => {
    try {
      await publishMutation.mutateAsync(shift.id);
      toast({ title: 'Shift Published', description: 'The shift is now visible to staff.' });
    } catch (e: any) {
      toast({ title: 'Publish Failed', description: e.message || 'Error', variant: 'destructive' });
    }
  };

  const handleUnpublishShift = async (shift: Shift) => {
    try {
      await unpublishMutation.mutateAsync({ shiftId: shift.id });
      toast({ title: 'Shift Unpublished', description: 'The shift has been moved back to Draft.' });
    } catch (e: any) {
      toast({ title: 'Unpublish Failed', description: e.message || 'Error', variant: 'destructive' });
    }
  };

  const confirmDeleteShift = async () => {
    if (!shiftToDelete) return;
    try {
      // Pass the version the UI is showing → the gateway rejects the delete with a
      // VERSION_CONFLICT if another manager changed this shift in the meantime.
      await deleteMutation.mutateAsync({
        shiftId: shiftToDelete.id,
        expectedVersion: shiftToDelete.version,
      });
      toast({ title: 'Shift Deleted', description: 'The shift was removed successfully.' });
      setDeleteDialogOpen(false);
      setShiftToDelete(null);
    } catch (e: any) {
      // e.message is concurrency-aware (e.g. "changed by another manager").
      toast({ title: 'Delete Failed', description: e.message || 'Error', variant: 'destructive' });
    }
  };


  const activeRosterId = rosterId || filteredShifts[0]?.roster_id;

  // Open the Add/Edit Shift wizard as a centered modal OVER the roster grid.
  // Custom overlay (not a Radix Dialog), so nested dropdowns keep working.
  const openShiftForm = (shift: Shift | null) => {
    if (!organizationId) {
      toast({
        title: 'Missing context',
        description: 'Cannot open the shift form without an organization.',
        variant: 'destructive',
      });
      return;
    }
    openShiftFormNav({
      editMode: !!shift,
      existingShift: shift,
      isTemplateMode: false,
      context: {
        mode: 'group',
        launchSource: shift ? 'edit' : 'grid',
        date,
        organizationId,
        departmentId,
        subDepartmentId,
        group_type: groupType,
        groupName,
        sub_group_name: subGroupName,
        subGroupName,
        rosterId: activeRosterId,
      },
    });
    // NOTE: this bucket modal is NOT closed here. The wizard sits at z-40
    // (below this panel's z-50 backdrop), so the parent (RostersPlannerPage)
    // hides this panel visually (isOpen=false via CSS opacity/pointer-events,
    // not unmount) for as long as the wizard is open, then lets it reappear
    // automatically — preserving scroll position and selection — once the
    // wizard closes. See RostersPlannerPage's `isOpen={drillDownState.isOpen
    // && !isShiftFormOpen}`.
  };

  return (
    <>
      {/* Centered modal overlay — click outside to dismiss */}
      <div
        onClick={onClose}
        aria-hidden={!isOpen}
        className={`fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/70 backdrop-blur-sm transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
          className={`relative w-full ${historyShiftId ? 'max-w-6xl' : 'max-w-5xl'} max-h-[90vh] flex flex-col rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#080b12] shadow-2xl overflow-hidden transition-all duration-300 ${isOpen ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 translate-y-3'}`}
        >
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-white/10 bg-slate-100/50 dark:bg-[#111726]/50">
          <div className="flex items-center gap-3">
            {historyShiftId ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setHistoryShiftId(null)}
                className="rounded-full h-8 w-8 hover:bg-slate-200 dark:hover:bg-white/10"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
            ) : null}
            <div>
              <h2 className="text-lg font-bold">
                {historyShiftId ? 'Shift Audit History' : `${groupName}${subGroupName ? ` - ${subGroupName}` : ''}`}
              </h2>
              <p className="text-sm text-muted-foreground">
                {historyShiftId ? 'Detailed audit log for selected shift' : displayDate}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full">
            <X className="h-5 w-5" />
          </Button>
        </div>

        {!historyShiftId && (
          <div className="p-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between bg-slate-50/50 dark:bg-[#0c101c]/50">
            <div className="text-sm font-medium">
              {filteredShifts.length} Shift{filteredShifts.length !== 1 ? 's' : ''}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs font-semibold"
                disabled={selectableShifts.length === 0}
                onClick={handleSelectAllToggle}
              >
                {allSelected ? 'Deselect All' : 'Select All'}
              </Button>
              {!isPastDate && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="h-8"
                  onClick={() => openShiftForm(null)}
                >
                  Add Shift
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 bg-slate-100 dark:bg-[#06080e]">
          {historyShiftId ? (
            <div className="min-w-0 py-1">
              <ShiftHistoryTimeline shiftId={historyShiftId} />
            </div>
          ) : isLoading ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mb-4" />
              <p>Loading full shift details...</p>
            </div>
          ) : filteredShifts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-center">
              <p>No shifts scheduled for this day.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-start pb-2">
              {filteredShifts.map((shift, idx) => {
                const startTimeStr = shift.start_time || (shift as any).startTime || (shift as any).start || '00:00';
                const hasStarted = isSydneyStarted(shift.shift_date, startTimeStr);
                const isPast = isPastDate || hasStarted;
                const isUnassigned = !shift.assigned_employee_id;
                const isDraft = shift.lifecycle_status === 'Draft';
                const isPublished = shift.lifecycle_status === 'Published';
                
                // Inline action icons (replaces the ellipsis menu). Each is
                // disabled when the action doesn't apply to the shift's state.
                const iconBtn = 'h-8 w-8 inline-flex items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/10 disabled:opacity-25 disabled:pointer-events-none';
                const canAssignOrEdit = isUnassigned || (isDraft && !hasStarted);
                const actions = (
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      title={isUnassigned ? (hasStarted ? 'Assign employee to started shift' : 'Assign / edit shift') : isDraft ? (hasStarted ? 'Edit locked — shift has started' : 'Edit shift') : 'Edit available for drafts only'}
                      disabled={!canAssignOrEdit}
                      onClick={() => openShiftForm(shift)}
                      className={cn(iconBtn, 'hover:text-white')}
                    >
                      {!isUnassigned && isDraft && hasStarted ? <Lock className="h-4 w-4" /> : <Edit2 className="h-4 w-4" />}
                    </button>

                    {isPublished ? (
                      <button
                        type="button"
                        title={hasStarted ? 'Unpublish locked — shift has started' : 'Unpublish shift'}
                        disabled={hasStarted}
                        onClick={() => handleUnpublishShift(shift)}
                        className={cn(iconBtn, 'hover:text-amber-400')}
                      >
                        <Undo2 className="h-4 w-4" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        title={hasStarted ? 'Publish locked — shift has started' : 'Publish shift'}
                        disabled={hasStarted}
                        onClick={() => handlePublishShift(shift)}
                        className={cn(iconBtn, 'hover:text-emerald-400')}
                      >
                        <Send className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      title="Delete shift"
                      onClick={() => { setShiftToDelete(shift); setDeleteDialogOpen(true); }}
                      className={cn(iconBtn, 'hover:text-rose-400')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );

                const isSelected = selectedV8ShiftIds.has(shift.id);
                return (
                  <div key={shift.id} className="min-w-0 animate-in fade-in slide-in-from-bottom-2" style={{ animationDelay: `${idx * 30}ms` }}>
                    <SmartShiftCard
                      shift={shift}
                      variant="comfortable"
                      groupColor={groupType}
                      groupName={groupName}
                      isLocked={isPast && !isUnassigned}
                      isPast={isPast}
                      isDnDActive={false}
                      isSelected={isSelected}
                      onClick={bulkModeActive ? () => toggleShiftSelection(shift.id) : () => openShiftForm(shift)}
                      headerAction={bulkModeActive ? undefined : actions}
                      onViewHistory={(id) => setHistoryShiftId(id)}
                      selectionSlot={
                        <Checkbox
                          checked={isSelected}
                          disabled={isPast}
                          onCheckedChange={() => toggleShiftSelection(shift.id)}
                          className="h-[18px] w-[18px] rounded-[5px] border-2 border-muted-foreground/40 data-[state=checked]:bg-primary data-[state=checked]:border-primary shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
                        />
                      }
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Reserved footer zone — always present so selecting never reflows the grid */}
        {!historyShiftId && (
          <div className="border-t border-slate-200 dark:border-white/10 bg-slate-100/80 dark:bg-[#0c101c]/80 px-4 min-h-[64px] flex items-center shrink-0">
            {selectedInDrawerCount > 0 ? (
              <div className="w-full flex items-center justify-between gap-3 animate-in fade-in duration-200">
                <span className="text-xs font-semibold text-muted-foreground shrink-0">
                  {selectedInDrawerCount} of {filteredShifts.length} selected
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={handleBulkPublish}
                    disabled={isProcessing || !hasDraftSelected || isPastDate}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs gap-1 shadow-none"
                  >
                    {isPublishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    Publish ({draftSelectedCount})
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleBulkUnpublish}
                    disabled={isProcessing || !hasPublishedSelected || isPastDate}
                    className="border border-amber-500/20 text-amber-500 hover:bg-amber-500/10 font-medium text-xs gap-1 bg-transparent shadow-none"
                  >
                    {isUnpublishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                    Unpublish ({publishedSelectedCount})
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setBulkDeleteConfirmOpen(true)}
                    disabled={isProcessing}
                    className="font-medium text-xs gap-1 px-3 shadow-none"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => clearSelection()}
                    className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </Button>
                </div>
              </div>
            ) : (
              <p className="w-full text-xs text-muted-foreground/50 text-center">
                Select shifts to publish, unpublish, or delete in bulk
              </p>
            )}
          </div>
        )}
        </div>
      </div>

      {/* Bulk Delete Dialog */}
      <AlertDialog open={bulkDeleteConfirmOpen} onOpenChange={setBulkDeleteConfirmOpen}>
        <AlertDialogContent className="bg-background border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Delete {selectedInDrawerCount} Shifts?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This action cannot be undone. All {selectedInDrawerCount} selected shifts will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="border-border text-muted-foreground hover:bg-muted"
              disabled={isDeleting}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={isDeleting}
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="bg-background border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Delete Shift?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This action cannot be undone. The shift will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="border-border text-muted-foreground hover:bg-muted"
              disabled={deleteMutation.isPending}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteShift}
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </>
  );
};
