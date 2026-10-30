import React from 'react';
import {
  FileText,
  User,
  Send,
  Calendar,
  Gavel,
  Users,
  ArrowLeftRight,
  Play,
  Check,
  X,
  HelpCircle,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { SHIFT_STATE_BADGE_TOKENS, type ShiftStateID } from '../../domain/shift-fsm';

interface ShiftStateCircleBadgeProps {
  stateId: ShiftStateID | string;
  className?: string;
  title?: string;
}

const STATE_ICONS: Record<ShiftStateID, LucideIcon> = {
  S1: FileText,           // Draft: document
  S2: User,               // Draft (Assigned): single person
  S3: Send,               // Offered: paper airplane
  S4: Calendar,           // Confirmed: calendar with grid
  S5: Gavel,              // Bidding: gavel
  S9: Users,              // Trade (Peer): peer employees
  S10: ArrowLeftRight,    // Trade (Mgr): swap / manager arrows
  S11: Play,              // In Progress: play triangle
  S13: Check,             // Completed: checkmark
  S15: X,                 // Cancelled: cross
  UNKNOWN: HelpCircle,    // Unknown fallback
};

/**
 * Small, circular status badge displaying the state icon inside the circle
 * with semantic color tokens:
 * - Draft (S1): FileText
 * - Draft Assigned (S2): User
 * - Offered (S3): Send (paper airplane)
 * - Confirmed (S4): Calendar
 * - Bidding (S5): Gavel
 * - Trade Peer (S9): Users
 * - Trade Mgr (S10): ArrowLeftRight
 * - In Progress (S11): Play
 * - Completed (S13): Check
 * - Cancelled (S15): X
 */
export const ShiftStateCircleBadge: React.FC<ShiftStateCircleBadgeProps> = ({
  stateId,
  className,
  title,
}) => {
  const canonicalId = (stateId as ShiftStateID) in SHIFT_STATE_BADGE_TOKENS
    ? (stateId as ShiftStateID)
    : 'UNKNOWN';
  const token = SHIFT_STATE_BADGE_TOKENS[canonicalId] || SHIFT_STATE_BADGE_TOKENS.UNKNOWN;
  const IconComponent = STATE_ICONS[canonicalId] || STATE_ICONS.UNKNOWN;

  return (
    <span
      className={cn(
        "w-[22px] h-[22px] min-w-[22px] min-h-[22px] aspect-square rounded-full",
        "flex items-center justify-center shrink-0 select-none",
        "border",
        className
      )}
      style={{
        backgroundColor: token.bg,
        color: token.text,
        borderColor: token.border || 'transparent',
      }}
      title={title || `${canonicalId} — ${token.label}`}
      aria-label={`Shift state: ${canonicalId} (${token.label})`}
    >
      <IconComponent
        className={cn(
          "w-3 h-3 shrink-0",
          canonicalId === 'S11' && "translate-x-[0.5px]"
        )}
        strokeWidth={canonicalId === 'S13' || canonicalId === 'S15' ? 2.6 : 2.2}
        aria-hidden="true"
      />
    </span>
  );
};

