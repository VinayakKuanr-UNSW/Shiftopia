import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Edit, Plus, Trash, Copy } from 'lucide-react';
import { format } from 'date-fns';
import { getSydneyToday } from '@/modules/core/lib/date.utils';
import ShiftItem from '@/modules/rosters/ui/components/ShiftItem';
import { SubGroup } from '@/types';
import AddShiftDialog from '../dialogs/AddShiftDialog';
import { EditSubGroupDialog } from '../dialogs/EditSubGroupDialog';
import { useToast } from '@/modules/core/hooks/use-toast';
import { Button } from '@/modules/core/ui/primitives/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/modules/core/ui/primitives/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/modules/core/ui/primitives/dialog';

interface RosterSubGroupProps {
  templateId?: number;
  subGroup: SubGroup;
  groupId: number | string;
  groupColor: string;
  readOnly?: boolean;
  onAddShift?: (groupId: number | string, subGroupId: number | string, shift: any) => void;
  onEditSubGroup?: (groupId: number | string, subGroupId: number | string, name: string) => void;
  onDeleteSubGroup?: (groupId: number | string, subGroupId: number | string) => void;
  onCloneSubGroup?: (groupId: number | string, subGroupId: number | string) => void;
}

const RosterSubGroup: React.FC<RosterSubGroupProps> = ({
  templateId,
  subGroup,
  groupId,
  groupColor,
  readOnly,
  onAddShift,
  onEditSubGroup,
  onDeleteSubGroup,
  onCloneSubGroup
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const { toast } = useToast();

  const handleAddShift = (groupId: number | string, subGroupId: number | string, shift: any) => {
    if (onAddShift) {
      onAddShift(groupId, subGroupId, shift);
    } else {
      toast({
        title: "Shift Added",
        description: `${shift.role} shift added to ${subGroup.name}`,
      });
    }
  };

  const handleEditSubGroupWrapper = async (newName: string) => {
    if (onEditSubGroup) {
      onEditSubGroup(groupId, subGroup.id, newName);
    } else {
      toast({
        title: "Subgroup Updated",
        description: `${subGroup.name} would be updated to ${newName}`,
      });
    }
  };

  const handleDeleteSubGroup = () => {
    if (onDeleteSubGroup) {
      onDeleteSubGroup(groupId, subGroup.id);
    } else {
      toast({
        title: "Subgroup Deleted",
        description: `${subGroup.name} would be deleted`,
      });
    }
  };

  const handleCloneSubGroup = () => {
    if (onCloneSubGroup) {
      onCloneSubGroup(groupId, subGroup.id);
    } else {
      toast({
        title: "Subgroup Cloned",
        description: `A copy of ${subGroup.name} would be created`,
      });
    }
  };

  return (
    <div className="rounded-lg p-3 bg-black/20 border border-white/10 backdrop-blur-sm">
      <div
        className="flex justify-between items-center cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <h4 className="text-md font-medium text-white/90 flex items-center">
          {isExpanded ? (
            <ChevronDown className="mr-2 h-4 w-4 text-white/60" />
          ) : (
            <ChevronUp className="mr-2 h-4 w-4 text-white/60" />
          )}
          {subGroup.name}
          <span className="ml-2 text-xs text-white/60">
            {subGroup.shifts.length} shifts
          </span>
        </h4>

        {!readOnly && (
          <div className="flex items-center space-x-2">
            <AddShiftDialog
              groupId={groupId}
              subGroupId={subGroup.id}
              date={format(getSydneyToday(), 'yyyy-MM-dd')}
              onAddShift={handleAddShift}
              trigger={
                <button
                  className="p-1 rounded-lg bg-black/20 hover:bg-black/40 text-white/80 hover:text-white transition-all duration-200 hover:scale-110"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Plus size={14} />
                </button>
              }
            />

            <button
              className="p-1 rounded-lg bg-black/20 hover:bg-black/40 text-blue-400/80 hover:text-blue-400 transition-all duration-200 hover:scale-110"
              onClick={(e) => {
                e.stopPropagation();
                setIsEditDialogOpen(true);
              }}
            >
              <Edit size={14} />
            </button>
            <EditSubGroupDialog
              subGroupName={subGroup.name}
              onEditSubGroup={handleEditSubGroupWrapper}
              open={isEditDialogOpen}
              onOpenChange={setIsEditDialogOpen}
            />

            <button
              className="p-1 rounded-lg bg-black/20 hover:bg-black/40 text-indigo-400/80 hover:text-indigo-400 transition-all duration-200 hover:scale-110"
              onClick={(e) => {
                e.stopPropagation();
                handleCloneSubGroup();
              }}
            >
              <Copy size={14} />
            </button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  className="p-1 rounded-lg bg-black/20 hover:bg-black/40 text-red-400/80 hover:text-red-400 transition-all duration-200 hover:scale-110"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Trash size={14} />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent className="bg-gray-900/95 backdrop-blur-xl border-gray-800">
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Subgroup</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete the {subGroup.name} subgroup? This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction className="bg-red-500 hover:bg-red-600" onClick={handleDeleteSubGroup}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="mt-3 space-y-2">
          {subGroup.shifts.map((shift) => (
            <ShiftItem
              key={shift.id}
              id={shift.id}
              role={shift.role}
              startTime={shift.startTime}
              endTime={shift.endTime}
              breakDuration={shift.breakDuration || ""}
              remunerationLevel={String(shift.remunerationLevel || "")}
              employeeId={shift.employeeId}
              employee={shift.employee}
              status={shift.status}
            />
          ))}

          {!readOnly && subGroup.shifts.length === 0 && (
            <div className="text-center p-3 rounded-lg border border-white/5">
              <p className="text-white/60 text-sm mb-2">No shifts in this subgroup</p>
              <AddShiftDialog
                groupId={groupId}
                subGroupId={subGroup.id}
                date={format(getSydneyToday(), 'yyyy-MM-dd')}
                onAddShift={handleAddShift}
                trigger={
                  <Button variant="ghost" size="sm" className='bg-transparent hover:bg-transparent border-none text-white'>
                    <Plus size={12} className="mr-1" />
                    Add Shift
                  </Button>
                }
              />
            </div>
          )}

          {!readOnly && subGroup.shifts.length > 0 && (
            <AddShiftDialog
              groupId={groupId}
              subGroupId={subGroup.id}
              date={format(getSydneyToday(), 'yyyy-MM-dd')}
              onAddShift={handleAddShift}
              trigger={
                <button className="w-full py-1.5 mt-2 rounded-md flex items-center justify-center bg-black/20 hover:bg-black/30 text-white/70 hover:text-white border border-white/5 hover:border-white/10 transition-all duration-200 text-sm">
                  <Plus size={12} className="mr-1" />
                  <span>Add Shift</span>
                </button>
              }
            />
          )}
        </div>
      )}
    </div>
  );
};

export { RosterSubGroup };
