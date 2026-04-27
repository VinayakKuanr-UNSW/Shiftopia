/**
 * Availability List Component
 *
 * RESPONSIBILITIES:
 * - Display rules in list format
 * - Provide edit/delete actions
 *
 * MUST NOT:
 * - Direct API calls
 * - Editing state management
 * - Validation
 */

import React from 'react';
import { AvailabilityRule } from '../../model/availability.types';
import { AvailabilityListItem } from './AvailabilityListItem';

interface AvailabilityListProps {
  rules: AvailabilityRule[];
  onEditRule: (ruleId: string) => void;
  onDeleteRule: (ruleId: string) => void;
}

export const AvailabilityList: React.FC<AvailabilityListProps> = ({
  rules,
  onEditRule,
  onDeleteRule,
}) => {
  if (rules.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="text-muted-foreground mb-2">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-medium">No availability rules</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Get started by creating your first availability rule.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold mb-4">Availability Rules</h2>
      {rules.map((rule) => (
        <AvailabilityListItem
          key={rule.id}
          rule={rule}
          onEdit={() => onEditRule(rule.id)}
          onDelete={() => onDeleteRule(rule.id)}
        />
      ))}
    </div>
  );
};
