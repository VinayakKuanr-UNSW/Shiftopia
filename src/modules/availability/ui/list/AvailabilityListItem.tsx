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

interface AvailabilityListItemProps {
  rule: AvailabilityRule;
  onEdit: () => void;
  onDelete: () => void;
}

export const AvailabilityListItem: React.FC<AvailabilityListItemProps> = ({
  rule,
  onEdit,
  onDelete,
}) => {
  const startDate = parseISO(rule.start_date);
  const hasRepeat = rule.repeat_type !== 'none';
  const repeatEndDate = rule.repeat_end_date ? parseISO(rule.repeat_end_date) : null;

  return (
    <div>
    <Card className="bg-card border border-border rounded-2xl hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          {/* Left: Rule Details */}
          <div className="flex-grow space-y-2 min-w-0">
            {/* Repeat Badge */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={hasRepeat ? 'secondary' : 'outline'}>
                {hasRepeat ? (
                  <>
                    <Repeat className="h-3 w-3 mr-1" />
                    {rule.repeat_type}
                  </>
                ) : (
                  'One-time'
                )}
              </Badge>
            </div>

            {/* Date */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">
                {format(startDate, 'MMM dd, yyyy')}
                {repeatEndDate && (
                  <span className="text-muted-foreground">
                    {' '}
                    until {format(repeatEndDate, 'MMM dd, yyyy')}
                  </span>
                )}
              </span>
            </div>

            {/* Time Range */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4 flex-shrink-0" />
              <span>
                {rule.start_time.substring(0, 5)} - {rule.end_time.substring(0, 5)}
              </span>
            </div>

            {/* Repeat Info */}
            {hasRepeat && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Repeat className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">
                  {rule.repeat_type === 'weekly' && rule.repeat_days 
                    ? `Weekly on ${rule.repeat_days.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}`
                    : `Repeats ${rule.repeat_type}`}
                </span>
              </div>
            )}

            {/* Reason */}
            {rule.reason && (
              <div className="pt-1 text-xs italic text-muted-foreground line-clamp-2">
                "{rule.reason}"
              </div>
            )}
          </div>

          {/* Right: Action Buttons */}
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
        </div>
      </CardContent>
    </Card>
    </div>
  );
};
