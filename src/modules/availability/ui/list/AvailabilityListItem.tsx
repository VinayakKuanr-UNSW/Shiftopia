/**
 * Availability List Item Component
 *
 * RESPONSIBILITIES:
 * - Display a single rule in list format
 * - Provide edit/delete buttons
 * - Show rule details
 *
 * MUST NOT:
 * - Direct API calls
 * - State management
 */

import React from 'react';
import { format, parseISO } from 'date-fns';
import { Pencil, Trash2, Calendar, Clock, Repeat } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Card, CardContent } from '@/modules/core/ui/primitives/card';
import { AvailabilityRule } from '../../model/availability.types';
import { parseRecurrenceRule } from '../../utils/validation.utils';

interface AvailabilityListItemProps {
  rule: AvailabilityRule;
  onEdit: () => void;
  onDelete: () => void;
  isLocked?: boolean;
}

// Get status color
const getStatusColor = (type: string): string => {
  switch (type) {
    case 'available':
      return 'bg-green-500 text-white';
    case 'unavailable':
      return 'bg-red-500 text-white';
    case 'preferred':
      return 'bg-blue-500 text-white';
    case 'limited':
      return 'bg-yellow-500 text-white';
    default:
      return 'bg-gray-500 text-white';
  }
};

// Format recurrence rule for display
const formatRecurrence = (recurrenceRule: string | null): string => {
  if (!recurrenceRule) return 'Does not repeat';

  const parsed = parseRecurrenceRule(recurrenceRule);

  if (parsed.repeatType === 'daily') return 'Daily';
  if (parsed.repeatType === 'monthly') return 'Monthly';
  if (parsed.repeatType === 'weekly') {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const days = parsed.repeatDays?.map((d) => dayNames[d]).join(', ');
    return `Weekly on ${days}`;
  }

  return 'Does not repeat';
};

export const AvailabilityListItem: React.FC<AvailabilityListItemProps> = ({
  rule,
  onEdit,
  onDelete,
  isLocked = false,
}) => {
  const startDate = parseISO(rule.start_date);
  const endDate = parseISO(rule.end_date);
  const sameDay = rule.start_date === rule.end_date;

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          {/* Left: Rule Details */}
          <div className="flex-grow space-y-2">
            {/* Type Badge */}
            <div className="flex items-center gap-2">
              <Badge className={getStatusColor(rule.availability_type)}>
                {rule.availability_type}
              </Badge>
              {rule.is_recurring && (
                <Badge variant="outline" className="text-xs">
                  <Repeat className="h-3 w-3 mr-1" />
                  Recurring
                </Badge>
              )}
            </div>

            {/* Date Range */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>
                {sameDay
                  ? format(startDate, 'MMM dd, yyyy')
                  : `${format(startDate, 'MMM dd, yyyy')} - ${format(endDate, 'MMM dd, yyyy')}`}
              </span>
            </div>

            {/* Time Range */}
            {rule.start_time && rule.end_time && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>
                  {rule.start_time.substring(0, 5)} - {rule.end_time.substring(0, 5)}
                </span>
              </div>
            )}

            {/* Recurrence */}
            {rule.is_recurring && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Repeat className="h-4 w-4" />
                <span>{formatRecurrence(rule.recurrence_rule)}</span>
              </div>
            )}

            {/* Reason/Notes */}
            {rule.reason && (
              <div className="text-sm text-muted-foreground italic mt-2">
                "{rule.reason}"
              </div>
            )}
          </div>

          {/* Right: Action Buttons */}
          {!isLocked && (
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={onEdit}
                title="Edit rule"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={onDelete}
                title="Delete rule"
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
