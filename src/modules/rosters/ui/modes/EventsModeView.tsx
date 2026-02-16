import React, { useState, useMemo } from 'react';
import { Calendar, Users, DollarSign, AlertTriangle, Plus, ChevronDown, ChevronRight } from 'lucide-react';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Progress } from '@/modules/core/ui/primitives/progress';
import { Card } from '@/modules/core/ui/primitives/card';
import { Button } from '@/modules/core/ui/primitives/button';
import { format, differenceInHours, parseISO } from 'date-fns';
import { EnhancedAddShiftModal } from '@/modules/rosters/ui/dialogs/EnhancedAddShiftModal';
import { Shift } from '@/modules/rosters/api/shifts.api';
import { useEvents } from '@/modules/rosters/state/useRosterShifts';
import { SmartShiftCard, ComplianceInfo } from '@/modules/rosters/ui/components/SmartShiftCard';
import { cn } from '@/modules/core/lib/utils';
import { isShiftLocked } from '@/modules/rosters/domain/policies/canEditShift.policy';

interface EventsModeViewProps {
  selectedDate: Date;
  viewType: 'day' | '3day' | 'week' | 'month';
  /** Shifts data from parent */
  shifts?: Shift[];
  /** Loading state from parent */
  isShiftsLoading?: boolean;
  /** Organization ID for fetching events */
  organizationId?: string;
  /** Compliance data map */
  complianceMap?: Record<string, ComplianceInfo>;
}

interface EventGroup {
  eventId: string;
  eventName: string;
  eventDate: Date | null;
  startTime: string;
  endTime: string;
  location: string;
  shifts: Shift[];
  totalHours: number;
  assignedCount: number;
  unassignedCount: number;
}

export const EventsModeView: React.FC<EventsModeViewProps> = ({
  selectedDate,
  viewType,
  shifts = [],
  isShiftsLoading = false,
  organizationId,
  complianceMap,
}) => {
  const [isAddShiftOpen, setIsAddShiftOpen] = useState(false);
  const [shiftContext, setShiftContext] = useState<any>({});
  const [collapsedEvents, setCollapsedEvents] = useState<Set<string>>(new Set());

  // Fetch events from the organization
  const { data: events = [] } = useEvents(organizationId);

  // Group shifts by event_ids
  const eventGroups = useMemo((): EventGroup[] => {
    const groupMap = new Map<string, Shift[]>();
    const noEventShifts: Shift[] = [];

    // Group shifts by their event IDs
    shifts.forEach(shift => {
      const eventIds = shift.event_ids || [];
      if (eventIds.length === 0) {
        noEventShifts.push(shift);
      } else {
        eventIds.forEach(eventId => {
          if (!groupMap.has(eventId)) {
            groupMap.set(eventId, []);
          }
          groupMap.get(eventId)!.push(shift);
        });
      }
    });

    // Build EventGroup objects
    const groups: EventGroup[] = [];

    groupMap.forEach((groupShifts, eventId) => {
      const eventData = events.find((e: any) => e.id === eventId);

      let totalHours = 0;
      let assignedCount = 0;
      let unassignedCount = 0;

      groupShifts.forEach(shift => {
        // Calculate hours
        if (shift.start_time && shift.end_time) {
          const [sh, sm] = shift.start_time.split(':').map(Number);
          const [eh, em] = shift.end_time.split(':').map(Number);
          const hours = (eh * 60 + em - sh * 60 - sm) / 60;
          totalHours += hours > 0 ? hours : 0;
        }
        // Count assigned vs unassigned
        if (shift.assigned_employee_id) {
          assignedCount++;
        } else {
          unassignedCount++;
        }
      });

      groups.push({
        eventId,
        eventName: eventData?.name || `Event ${eventId.slice(0, 8)}...`,
        eventDate: eventData?.event_date ? parseISO(eventData.event_date) : null,
        startTime: eventData?.start_time || groupShifts[0]?.start_time || '00:00',
        endTime: eventData?.end_time || groupShifts[0]?.end_time || '00:00',
        location: eventData?.location || 'Unknown Location',
        shifts: groupShifts,
        totalHours,
        assignedCount,
        unassignedCount,
      });
    });

    // Add "Unassigned to Event" group if there are orphan shifts
    if (noEventShifts.length > 0) {
      let totalHours = 0;
      let assignedCount = 0;
      let unassignedCount = 0;

      noEventShifts.forEach(shift => {
        if (shift.start_time && shift.end_time) {
          const [sh, sm] = shift.start_time.split(':').map(Number);
          const [eh, em] = shift.end_time.split(':').map(Number);
          const hours = (eh * 60 + em - sh * 60 - sm) / 60;
          totalHours += hours > 0 ? hours : 0;
        }
        if (shift.assigned_employee_id) {
          assignedCount++;
        } else {
          unassignedCount++;
        }
      });

      groups.push({
        eventId: '_no_event_',
        eventName: 'Unassigned to Event',
        eventDate: null,
        startTime: '',
        endTime: '',
        location: 'General Roster',
        shifts: noEventShifts,
        totalHours,
        assignedCount,
        unassignedCount,
      });
    }

    // Sort by event date, then name
    return groups.sort((a, b) => {
      if (a.eventId === '_no_event_') return 1;
      if (b.eventId === '_no_event_') return -1;
      if (a.eventDate && b.eventDate) {
        return a.eventDate.getTime() - b.eventDate.getTime();
      }
      return a.eventName.localeCompare(b.eventName);
    });
  }, [shifts, events]);

  const toggleEventCollapse = (eventId: string) => {
    setCollapsedEvents(prev => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  };

  const getStaffingPercentage = (group: EventGroup) => {
    const total = group.assignedCount + group.unassignedCount;
    if (total === 0) return 100;
    return (group.assignedCount / total) * 100;
  };

  const getStatusBadge = (group: EventGroup) => {
    const pct = getStaffingPercentage(group);
    if (pct === 100) return { label: 'Fully Staffed', variant: 'default' as const };
    if (pct >= 80) return { label: 'Nearly Staffed', variant: 'secondary' as const };
    return { label: 'Understaffed', variant: 'destructive' as const };
  };

  const handleAddShiftClick = (group: EventGroup) => {
    setShiftContext({
      mode: 'events',
      date: group.eventDate ? format(group.eventDate, 'yyyy-MM-dd') : format(selectedDate, 'yyyy-MM-dd'),
      eventStartTime: group.startTime,
      eventEndTime: group.endTime,
      eventId: group.eventId !== '_no_event_' ? group.eventId : undefined,
    });
    setIsAddShiftOpen(true);
  };

  if (isShiftsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          Loading events...
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b border-border/40">
        <div className="text-sm text-muted-foreground">
          {eventGroups.length} event{eventGroups.length !== 1 ? 's' : ''} • {shifts.length} total shifts
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-6 space-y-4">
          {eventGroups.map(group => {
            const isCollapsed = collapsedEvents.has(group.eventId);
            const status = getStatusBadge(group);

            return (
              <Card key={group.eventId} className="overflow-hidden">
                {/* Event Header */}
                <button
                  onClick={() => toggleEventCollapse(group.eventId)}
                  className={cn(
                    "w-full p-4 flex items-center justify-between hover:bg-muted/50 transition-colors",
                    group.eventId === '_no_event_' && "bg-muted/30"
                  )}
                >
                  <div className="flex items-center gap-3">
                    {isCollapsed ? (
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-muted-foreground" />
                    )}
                    <div className="text-left">
                      <h3 className="font-semibold text-lg">{group.eventName}</h3>
                      <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                        {group.eventDate && (
                          <>
                            <Calendar className="h-4 w-4" />
                            {format(group.eventDate, 'MMM d, yyyy')}
                            {group.startTime && ` • ${group.startTime} - ${group.endTime}`}
                          </>
                        )}
                        <span>• {group.location}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right text-sm">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span>{group.assignedCount}/{group.shifts.length} assigned</span>
                      </div>
                      <div className="text-muted-foreground">
                        {group.totalHours.toFixed(1)}h total
                      </div>
                    </div>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </div>
                </button>

                {/* Staffing Progress */}
                <div className="px-4 pb-2">
                  <Progress value={getStaffingPercentage(group)} className="h-1.5" />
                </div>

                {/* Shift Cards (Collapsible) */}
                {!isCollapsed && (
                  <div className="p-4 pt-2 border-t border-border/40">
                    {group.unassignedCount > 0 && (
                      <div className="mb-3 p-2 bg-destructive/10 border border-destructive/20 rounded-md flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-destructive" />
                        <span className="text-sm text-destructive">
                          {group.unassignedCount} unfilled shift{group.unassignedCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                    )}

                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {group.shifts.map(shift => (
                        <SmartShiftCard
                          key={shift.id}
                          shift={shift}
                          variant="compact"
                          groupColor="blue"
                          compliance={complianceMap?.[shift.id]}
                          isLocked={isShiftLocked(shift.shift_date, shift.end_time || shift.start_time)}
                        />
                      ))}
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full mt-3"
                      onClick={() => handleAddShiftClick(group)}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Shift to Event
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}

          {eventGroups.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              No events or shifts for this period
            </div>
          )}
        </div>
      </ScrollArea>

      <EnhancedAddShiftModal
        isOpen={isAddShiftOpen}
        onClose={() => setIsAddShiftOpen(false)}
        context={shiftContext}
      />
    </div>
  );
};
