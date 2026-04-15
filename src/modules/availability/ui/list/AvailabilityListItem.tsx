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
import { motion } from 'framer-motion';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Card, CardContent } from '@/modules/core/ui/primitives/card';
import { AvailabilityRule } from '../../model/availability.types';
import { parseRecurrenceRule } from '../../utils/validation.utils';
import { listItemSpring } from '@/modules/core/ui/motion/presets';

interface AvailabilityListItemProps {
  rule: AvailabilityRule;
  onEdit: () => void;
  onDelete: () => void;
}

// Get status color — light/dark safe
const getStatusColor = (type: string): string => {
  switch (type) {
    case 'available':
      return 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20';
    case 'unavailable':
      return 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20';
    case 'preferred':
      return 'bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-500/20';
    case 'limited':
      return 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20';
    default:
      return 'bg-muted text-muted-foreground border border-border';
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
}) => {
  const startDate = parseISO(rule.start_date);
  const endDate = parseISO(rule.end_date);
  const sameDay = rule.start_date === rule.end_date;

  return (
    <motion.div {...listItemSpring}>
    <Card className="bg-card border border-border rounded-2xl hover:shadow-md transition-shadow">
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
    </motion.div>
  );
};
