
import { LucideIcon, CheckCircle, Clock, Play, UserCheck, FileText, AlertCircle } from 'lucide-react';
import { AuditStatus } from '@/modules/core/types';

interface EventMeta {
  Icon: LucideIcon;
  label: string;
  sub: string;
  color: string;
}

export const EVENT_META: Record<AuditStatus, EventMeta> = {
  created_draft: {
    Icon: FileText,
    label: 'Draft Created',
    sub: 'Initial timesheet entry created',
    color: 'text-gray-400'
  },
  assigned: {
    Icon: UserCheck,
    label: 'Shift Assigned',
    sub: 'Employee assigned to shift',
    color: 'text-blue-400'
  },
  accepted: {
    Icon: CheckCircle,
    label: 'Shift Accepted',
    sub: 'Employee accepted the assignment',
    color: 'text-green-400'
  },
  in_progress: {
    Icon: Play,
    label: 'Shift Started',
    sub: 'Employee clocked in',
    color: 'text-yellow-400'
  },
  completed: {
    Icon: CheckCircle,
    label: 'Shift Completed',
    sub: 'Employee clocked out',
    color: 'text-green-500'
  },
  approved_timesheet: {
    Icon: CheckCircle,
    label: 'Timesheet Approved',
    sub: 'Manager approved the timesheet',
    color: 'text-emerald-400'
  },
  cancelled: {
    Icon: AlertCircle,
    label: 'Shift Cancelled',
    sub: 'Shift was cancelled',
    color: 'text-red-400'
  },
  no_show: {
    Icon: AlertCircle,
    label: 'No Show',
    sub: 'Employee did not show up',
    color: 'text-red-500'
  },
  swapped: {
    Icon: Clock,
    label: 'Shift Swapped',
    sub: 'Shift was swapped with another employee',
    color: 'text-purple-400'
  }
};
