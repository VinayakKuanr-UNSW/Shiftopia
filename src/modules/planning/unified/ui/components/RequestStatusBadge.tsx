/**
 * RequestStatusBadge
 *
 * Renders a color-coded badge for a PlanningRequest status.
 * OPEN and MANAGER_PENDING statuses include an animated pulse dot.
 */

import React from 'react';
import {
  Clock,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  Ban,
  Hourglass,
  UserCheck,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import type { PlanningRequestStatus } from '@/modules/planning/unified/types';

// =============================================================================
// TYPES
// =============================================================================

interface RequestStatusBadgeProps {
  status: PlanningRequestStatus;
  size?: 'sm' | 'md';
}

// =============================================================================
// CONFIG
// =============================================================================

interface StatusConfig {
  label: string;
  icon: React.ElementType;
  badgeCls: string;
  dotCls: string;
  animated: boolean;
}

const STATUS_CONFIG: Record<PlanningRequestStatus, StatusConfig> = {
  OPEN: {
    label: 'Open',
    icon: Clock,
    badgeCls:
      'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    dotCls: 'bg-blue-500',
    animated: true,
  },
  MANAGER_PENDING: {
    label: 'Awaiting Manager',
    icon: UserCheck,
    badgeCls:
      'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    dotCls: 'bg-amber-500',
    animated: true,
  },
  BLOCKED: {
    label: 'Compliance Blocked',
    icon: ShieldAlert,
    badgeCls:
      'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    dotCls: 'bg-rose-500',
    animated: false,
  },
  APPROVED: {
    label: 'Approved',
    icon: CheckCircle2,
    badgeCls:
      'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    dotCls: 'bg-emerald-500',
    animated: false,
  },
  REJECTED: {
    label: 'Rejected',
    icon: XCircle,
    badgeCls:
      'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    dotCls: 'bg-rose-500/60',
    animated: false,
  },
  CANCELLED: {
    label: 'Cancelled',
    icon: Ban,
    badgeCls:
      'bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/20',
    dotCls: 'bg-slate-400',
    animated: false,
  },
  EXPIRED: {
    label: 'Expired',
    icon: Hourglass,
    badgeCls:
      'bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/20',
    dotCls: 'bg-slate-400',
    animated: false,
  },
};

// =============================================================================
// COMPONENT
// =============================================================================

export function RequestStatusBadge({
  status,
  size = 'md',
}: RequestStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  const isSmall = size === 'sm';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-black uppercase tracking-wider',
        isSmall ? 'px-2 py-0.5 text-[9px]' : 'px-2.5 py-1 text-[10px]',
        config.badgeCls,
      )}
    >
      {/* Animated pulse dot for live statuses */}
      <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
        {config.animated && (
          <span
            className={cn(
              'absolute inline-flex h-full w-full animate-ping rounded-full opacity-75',
              config.dotCls,
            )}
          />
        )}
        <span
          className={cn(
            'relative inline-flex h-1.5 w-1.5 rounded-full',
            config.dotCls,
          )}
        />
      </span>

      <Icon className={cn('flex-shrink-0', isSmall ? 'h-2.5 w-2.5' : 'h-3 w-3')} />

      <span>{config.label}</span>
    </span>
  );
}

export default RequestStatusBadge;
