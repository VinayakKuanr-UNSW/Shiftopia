import React from 'react';
import { Hash, Clock } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { Card, cardTokens } from '@/modules/core/ui/primitives/card';
import { GROUP_ACCENT, GROUP_ICONS_SM } from '../constants';
import type { EmployeeBroadcastGroup } from '../../model/broadcast.types';

interface EmployeeGroupCardProps {
  group: EmployeeBroadcastGroup;
  onClick: () => void;
  compact?: boolean;
}

export const EmployeeGroupCard: React.FC<EmployeeGroupCardProps> = ({ group, onClick, compact }) => {
  const accent = GROUP_ACCENT[group.color || 'blue'] ?? GROUP_ACCENT.blue;
  const icon = GROUP_ICONS_SM[group.icon || 'megaphone'];
  const context = [group.organizationName, group.departmentName, group.subDepartmentName].filter(Boolean).join(' · ');

  return (
    <Card
      interactive
      role="button"
      tabIndex={0}
      aria-label={`Open ${group.name}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(cardTokens.accent, accent.edge, cardTokens.pad, 'flex flex-col', compact ? 'min-h-[144px]' : 'min-h-[176px]')}
    >
      <div className="flex items-start gap-3">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', accent.tile)} aria-hidden="true">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          {context && <p className={cn(cardTokens.label, 'mb-1 truncate')} title={context}>{context}</p>}
          <h3 className={cn(cardTokens.title, 'truncate')}>{group.name}</h3>
          {!compact && group.description && (
            <p className={cn(cardTokens.meta, 'mt-1 line-clamp-1')}>{group.description}</p>
          )}
        </div>
      </div>

      <div className={cn(cardTokens.footer, 'mt-auto justify-between', cardTokens.meta)}>
        <span className="flex items-center gap-1.5">
          <Hash className="h-4 w-4" aria-hidden="true" />
          {group.channels?.length || 0} channels
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {group.lastBroadcastAt
              ? formatDistanceToNow(new Date(group.lastBroadcastAt), { addSuffix: true })
              : 'No broadcasts'}
          </span>
        </span>
      </div>
    </Card>
  );
};

