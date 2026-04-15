/**
 * Logs Pane Component
 *
 * MIDDLE PANE in the 3-pane layout
 *
 * RESPONSIBILITIES:
 * - Display all saved availability rules
 * - Provide Edit button that triggers onEditRule(rule)
 * - Provide Delete button that triggers onDeleteRule(ruleId)
 * - Show rule details (date range, time range, repeat info)
 *
 * MUST NOT:
 * - Edit rules directly
 * - Open modals
 * - Make API calls
 * - Show slot data
 */

import React, { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Pencil, Trash2, Calendar, Clock, Repeat, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Card, CardContent } from '@/modules/core/ui/primitives/card';
import { listItemSpring } from '@/modules/core/ui/motion/presets';
import { Skeleton } from '@/modules/core/ui/primitives/skeleton';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
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
import { AvailabilityRule } from '../../model/availability.types';

// ============================================================================
// TYPES
// ============================================================================

export interface LogsPaneProps {
  rules: AvailabilityRule[];
  isLoading: boolean;
  onEditRule: (rule: AvailabilityRule) => void;
  onDeleteRule: (ruleId: string) => void;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Format repeat type for display
 */
const formatRepeatType = (rule: AvailabilityRule): string => {
  if (rule.repeat_type === 'none') {
    return 'Does not repeat';
  }

  if (rule.repeat_type === 'daily') {
    return 'Repeats daily';
  }

  if (rule.repeat_type === 'fortnightly') {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    if (rule.repeat_days && rule.repeat_days.length > 0) {
      const days = rule.repeat_days.map((d) => dayNames[d]).join(', ');
      return `Repeats fortnightly on ${days}`;
    }
    return 'Repeats fortnightly';
  }

  if (rule.repeat_type === 'weekly') {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    if (rule.repeat_days && rule.repeat_days.length > 0) {
      const days = rule.repeat_days.map((d) => dayNames[d]).join(', ');
      return `Weekly on ${days}`;
    }
    return 'Repeats weekly';
  }

  return 'Unknown repeat';
};

/**
 * Format time for display (remove seconds if present)
 */
const formatTime = (time: string): string => {
  return time.substring(0, 5); // HH:mm
};

/**
 * Get badge variant based on repeat type
 */
const getRepeatBadgeVariant = (repeatType: string): 'default' | 'secondary' | 'outline' => {
  if (repeatType === 'none') return 'outline';
  return 'secondary';
};

// ============================================================================
// RULE ITEM COMPONENT
// ============================================================================

interface RuleItemProps {
  rule: AvailabilityRule;
  onEdit: () => void;
  onDelete: () => void;
}

function RuleItem({ rule, onEdit, onDelete }: RuleItemProps) {
  const startDate = parseISO(rule.start_date);
  const hasRepeat = rule.repeat_type !== 'none';
  const repeatEndDate = rule.repeat_end_date ? parseISO(rule.repeat_end_date) : null;

  return (
    <motion.div {...listItemSpring}>
    <Card className="bg-card border border-border rounded-2xl hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          {/* Left: Rule Details */}
          <div className="flex-grow space-y-2 min-w-0">
            {/* Repeat Badge */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={getRepeatBadgeVariant(rule.repeat_type)}>
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
                {formatTime(rule.start_time)} - {formatTime(rule.end_time)}
              </span>
            </div>

            {/* Repeat Info */}
            {hasRepeat && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Repeat className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">{formatRepeatType(rule)}</span>
              </div>
            )}
          </div>

          {/* Right: Action Buttons */}
          <div className="flex gap-1 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={onEdit}
              title="Edit rule"
              className="h-8 w-8"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              title="Delete rule"
              className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
    </motion.div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function LogsPane({
  rules,
  isLoading,
  onEditRule,
  onDeleteRule,
}: LogsPaneProps) {
  const [deleteConfirmRuleId, setDeleteConfirmRuleId] = useState<string | null>(null);

  const handleDeleteClick = (ruleId: string) => {
    setDeleteConfirmRuleId(ruleId);
  };

  const handleConfirmDelete = () => {
    if (deleteConfirmRuleId) {
      onDeleteRule(deleteConfirmRuleId);
      setDeleteConfirmRuleId(null);
    }
  };

  const handleCancelDelete = () => {
    setDeleteConfirmRuleId(null);
  };

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border flex-shrink-0">
        <h2 className="text-lg font-black tracking-tight text-foreground">Availability Rules</h2>
        <p className="text-sm text-muted-foreground">
          {rules.length} rule{rules.length !== 1 ? 's' : ''} configured
        </p>
      </div>

      {/* Rule List */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          {rules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="text-muted-foreground mb-2">
                <Calendar className="mx-auto h-12 w-12 text-muted-foreground/40" />
              </div>
              <h3 className="text-lg font-bold text-foreground">No availability rules</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                Use the Configure panel to create your first availability rule.
              </p>
            </div>
          ) : (
            rules.map((rule) => (
              <RuleItem
                key={rule.id}
                rule={rule}
                onEdit={() => onEditRule(rule)}
                onDelete={() => handleDeleteClick(rule.id)}
              />
            ))
          )}
        </div>
      </ScrollArea>


      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={deleteConfirmRuleId !== null}
        onOpenChange={(open) => !open && handleCancelDelete()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Availability Rule</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this availability rule? This action
              cannot be undone. Any generated slots from this rule will also be
              removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelDelete}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default LogsPane;
