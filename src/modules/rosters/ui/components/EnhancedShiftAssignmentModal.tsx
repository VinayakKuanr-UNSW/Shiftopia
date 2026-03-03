import React, { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/modules/core/ui/primitives/select';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Clock, User, Calendar, X, AlertTriangle } from 'lucide-react';
import { Shift, Employee } from '@/modules/core/types';
import { cn } from '@/modules/core/lib/utils';
import { supabase } from '@/platform/realtime/client';

// Compliance imports
import {
  useCompliance,
  buildComplianceInput,
  ComplianceBadge,
  ComplianceModal,
  ShiftTimeRange
} from '@/modules/compliance';

interface EnhancedShiftAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  shift: Shift | null;
  date: Date;
  groupName: string;
  subGroupName: string;
  groupColor: string;
  employees: Employee[];
  onAssign: (employeeId: string) => void;
  onUnassign?: () => void;
}

export const EnhancedShiftAssignmentModal: React.FC<EnhancedShiftAssignmentModalProps> = ({
  isOpen,
  onClose,
  shift,
  date,
  groupName,
  subGroupName,
  groupColor,
  employees,
  onAssign,
  onUnassign,
}) => {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const [existingShifts, setExistingShifts] = useState<ShiftTimeRange[]>([]);
  const [showComplianceModal, setShowComplianceModal] = useState(false);

  // Compliance hook
  const { result: complianceResult, loading: complianceLoading, check: checkCompliance, reset: resetCompliance } = useCompliance({
    autoLog: true,
    debounceMs: 300
  });

  // Reset when modal opens/closes
  useEffect(() => {
    if (shift?.employeeId) {
      setSelectedEmployeeId(shift.employeeId);
    } else {
      setSelectedEmployeeId('');
    }
    resetCompliance();
  }, [shift, resetCompliance]);

  // Fetch existing shifts for selected employee on this date
  const fetchExistingShifts = useCallback(async (employeeId: string) => {
    if (!employeeId || !date) return;

    const dateStr = format(date, 'yyyy-MM-dd');

    try {
      const { data, error } = await supabase
        .from('shifts')
        .select('id, start_time, end_time, shift_date')
        .eq('employee_id', employeeId)
        .eq('shift_date', dateStr);

      if (error) {
        console.error('[Compliance] Error fetching existing shifts:', error);
        return;
      }

      // Map to ShiftTimeRange format
      const shifts: ShiftTimeRange[] = (data || []).map(s => ({
        start_time: s.start_time,
        end_time: s.end_time,
        shift_date: s.shift_date
      }));

      setExistingShifts(shifts);
      return shifts;
    } catch (err) {
      console.error('[Compliance] Exception fetching shifts:', err);
      return [];
    }
  }, [date]);

  // Run compliance check when employee selection changes
  useEffect(() => {
    const runCheck = async () => {
      if (!selectedEmployeeId || !shift) {
        resetCompliance();
        return;
      }

      // Fetch existing shifts for this employee
      const existingForDay = await fetchExistingShifts(selectedEmployeeId);

      // Build candidate shift from current shift being assigned
      const candidateShift: ShiftTimeRange = {
        start_time: shift.startTime?.includes('T')
          ? shift.startTime.split('T')[1].substring(0, 5)
          : shift.startTime || '09:00',
        end_time: shift.endTime?.includes('T')
          ? shift.endTime.split('T')[1].substring(0, 5)
          : shift.endTime || '17:00',
        shift_date: format(date, 'yyyy-MM-dd')
      };

      // Run compliance check
      await checkCompliance(buildComplianceInput({
        employeeId: selectedEmployeeId,
        actionType: 'assign',
        candidateShift,
        existingShifts: existingForDay || []
      }));
    };

    runCheck();
  }, [selectedEmployeeId, shift, date, fetchExistingShifts, checkCompliance, resetCompliance]);

  if (!shift) return null;

  const formatTime = (time: string) => {
    if (!time) return '';
    const timePart = time.includes('T') ? time.split('T')[1].substring(0, 5) : time;
    const [hours, minutes] = timePart.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  };

  const getColorClass = (color: string) => {
    const colors: Record<string, string> = {
      blue: 'bg-blue-500',
      green: 'bg-green-500',
      red: 'bg-red-500',
      purple: 'bg-purple-500',
      sky: 'bg-sky-500',
      orange: 'bg-orange-500',
    };
    return colors[color] || colors.blue;
  };

  const filteredEmployees = employees.filter(emp => {
    if (!shift.role) return true;
    return emp.role === shift.role;
  });

  const handleAssign = () => {
    // Block if compliance fails
    if (complianceResult && !complianceResult.passed) {
      setShowComplianceModal(true);
      return;
    }

    if (selectedEmployeeId) {
      onAssign(selectedEmployeeId);
      onClose();
    }
  };

  const handleUnassign = () => {
    if (onUnassign) {
      onUnassign();
      setSelectedEmployeeId('');
    }
  };

  const currentEmployee = employees.find(e => e.id === shift.employeeId);

  // Check if assignment is blocked
  const isBlocked = complianceResult && !complianceResult.passed;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className={cn(
          "max-w-md text-white border border-gray-800",
          getColorClass(groupColor)
        )}>
          <DialogHeader>
            <div className="mb-2 inline-block bg-black/20 py-1 px-3 rounded-full text-xs">
              {groupName} • {subGroupName}
            </div>
            <DialogTitle className="text-xl font-bold">{shift.role}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            <div className="p-3 rounded-lg bg-black/20 border border-white/10 space-y-2">
              <div className="flex items-center gap-3">
                <Calendar className="text-white/70" size={18} />
                <div>
                  <div className="font-medium text-white/90">
                    {format(date, 'EEEE, MMMM d, yyyy')}
                  </div>
                  <div className="text-sm text-white/60">Shift Date</div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Clock className="text-white/70" size={18} />
                <div>
                  <div className="font-medium text-white/90">
                    {formatTime(shift.startTime)} - {formatTime(shift.endTime)}
                  </div>
                  <div className="text-sm text-white/60">
                    {shift.breakDuration ? `Break: ${shift.breakDuration}` : 'No break'}
                  </div>
                </div>
              </div>

              {shift.remunerationLevel && (
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="bg-white/10 border-white/20">
                    {shift.remunerationLevel}
                  </Badge>
                  <span className="text-sm text-white/60">Remuneration Level</span>
                </div>
              )}
            </div>

            {currentEmployee && (
              <div className="p-3 rounded-lg bg-green-500/20 border border-green-500/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <User className="text-green-300" size={18} />
                    <div>
                      <div className="font-medium text-green-200">
                        Currently Assigned
                      </div>
                      <div className="text-sm text-green-300">
                        {currentEmployee.name}
                      </div>
                    </div>
                  </div>
                  {onUnassign && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleUnassign}
                      className="text-red-300 hover:text-red-200 hover:bg-red-500/20"
                    >
                      <X size={16} />
                    </Button>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium text-white/80">
                {currentEmployee ? 'Reassign to Employee' : 'Assign to Employee'}
              </label>
              <Select
                value={selectedEmployeeId}
                onValueChange={setSelectedEmployeeId}
              >
                <SelectTrigger className="bg-white/5 border-white/10">
                  <SelectValue placeholder="Select an employee" />
                </SelectTrigger>
                <SelectContent className="bg-gray-900/95 backdrop-blur-xl border-gray-800">
                  {filteredEmployees.map((employee) => (
                    <SelectItem
                      key={employee.id}
                      value={employee.id}
                      className="hover:bg-white/10"
                    >
                      <div className="flex items-center gap-2">
                        <span>{employee.name}</span>
                        {employee.tier && (
                          <Badge variant="outline" className="text-xs">
                            {employee.tier}
                          </Badge>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                  {filteredEmployees.length === 0 && (
                    <div className="p-2 text-center text-sm text-white/60">
                      No employees available for this role
                    </div>
                  )}
                </SelectContent>
              </Select>
              {shift.role && (
                <div className="text-xs text-white/50">
                  Showing employees with role: {shift.role}
                </div>
              )}
            </div>

            {/* Compliance Badge */}
            {selectedEmployeeId && (
              <div className="p-3 rounded-lg bg-black/20 border border-white/10">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/70">Compliance Check</span>
                  <ComplianceBadge
                    result={complianceResult}
                    loading={complianceLoading}
                    onClick={() => complianceResult && setShowComplianceModal(true)}
                    size="sm"
                  />
                </div>
                {existingShifts.length > 0 && (
                  <div className="mt-2 text-xs text-white/50">
                    Employee has {existingShifts.length} other shift(s) on this day
                  </div>
                )}
              </div>
            )}

            {/* Blocking warning */}
            {isBlocked && (
              <div className="p-3 rounded-lg bg-red-500/20 border border-red-500/30 flex items-start gap-2">
                <AlertTriangle className="text-red-400 flex-shrink-0 mt-0.5" size={18} />
                <div>
                  <div className="text-sm font-medium text-red-200">Assignment Blocked</div>
                  <div className="text-xs text-red-300 mt-1">
                    {complianceResult?.blockers[0]?.summary || 'Compliance check failed'}
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="mt-6 flex justify-end gap-3">
            <Button
              onClick={onClose}
              variant="outline"
              className="border-white/20 bg-transparent"
            >
              Cancel
            </Button>
            <Button
              onClick={handleAssign}
              disabled={!selectedEmployeeId || selectedEmployeeId === shift.employeeId || isBlocked}
              className={cn(
                "bg-blue-600 hover:bg-blue-700",
                isBlocked && "opacity-50 cursor-not-allowed"
              )}
            >
              {currentEmployee ? 'Reassign' : 'Assign'} Shift
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Compliance Modal */}
      {complianceResult && (
        <ComplianceModal
          isOpen={showComplianceModal}
          onClose={() => setShowComplianceModal(false)}
          result={complianceResult}
          title="Assignment Compliance Check"
        />
      )}
    </>
  );
};
