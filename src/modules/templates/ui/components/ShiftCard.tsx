// src/components/templates/ShiftCard.tsx
import React from 'react';
import { Clock, Edit2, Trash2, Coffee, User, Tag, Copy } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import { cn } from '@/modules/core/lib/utils';
import {
  TemplateShift,
  formatTimeDisplay,
  calculateNetHours,
} from '@/modules/templates/model/templates.types';

interface ShiftCardProps {
  shift: TemplateShift;
  isReadOnly: boolean;
  groupColor: string;
  onEdit: () => void;
  onDelete: () => void;
  onClone?: () => void;
}

const colorClasses: Record<
  string,
  { bg: string; border: string; text: string }
> = {
  blue: {
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    text: 'text-blue-400',
  },
  green: {
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    text: 'text-emerald-400',
  },
  red: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    text: 'text-red-400',
  },
};

const ShiftCard: React.FC<ShiftCardProps> = React.memo(({
  shift,
  isReadOnly,
  groupColor,
  onEdit,
  onDelete,
  onClone,
}) => {
  const colors = colorClasses[groupColor] || colorClasses.blue;
  const netHours = calculateNetHours(
    shift.startTime,
    shift.endTime,
    shift.unpaidBreakDuration
  );
  const totalBreak =
    (shift.paidBreakDuration || 0) + (shift.unpaidBreakDuration || 0);

  return (
    <div
      className={cn(
        'group relative p-3 rounded-lg border transition-all duration-200',
        colors.bg,
        colors.border,
        'hover:border-opacity-60'
      )}
    >
      {/* Actions */}
      {!isReadOnly && (
        <div className="absolute top-2 right-2 flex items-center gap-1 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-white/50 hover:text-white hover:bg-white/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit();
                  }}
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit shift</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-white/50 hover:text-white hover:bg-white/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClone?.();
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Clone shift</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-red-400/50 hover:text-red-400 hover:bg-red-500/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete shift</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}

      {/* Shift Name / Role */}
      <div className="flex items-start gap-2 mb-2 pr-16">
        <div
          className={cn(
            'w-6 h-6 rounded flex items-center justify-center shrink-0',
            colors.bg
          )}
        >
          <User className={cn('h-3.5 w-3.5', colors.text)} />
        </div>
        <div className="min-w-0">
          <h4 className="text-sm font-medium text-white truncate">
            {shift.name || shift.roleName || 'Unnamed Shift'}
          </h4>
          {shift.roleName && shift.name && shift.name !== shift.roleName && (
            <p className="text-xs text-white/50 truncate">{shift.roleName}</p>
          )}
        </div>
      </div>

      {/* Time */}
      <div className="flex items-center gap-2 mb-2">
        <Clock className="h-3.5 w-3.5 text-white/40" />
        <span className="text-sm text-white/70">
          {formatTimeDisplay(shift.startTime)} -{' '}
          {formatTimeDisplay(shift.endTime)}
        </span>
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0 text-white/50 border-white/20"
        >
          {netHours}h net
        </Badge>
      </div>

      {/* Breaks */}
      {totalBreak > 0 && (
        <div className="flex items-center gap-2 mb-2">
          <Coffee className="h-3.5 w-3.5 text-white/40" />
          <span className="text-xs text-white/50">
            {shift.paidBreakDuration > 0 && (
              <span className="text-emerald-400/70">
                {shift.paidBreakDuration}m paid
              </span>
            )}
            {shift.paidBreakDuration > 0 &&
              shift.unpaidBreakDuration > 0 &&
              ' + '}
            {shift.unpaidBreakDuration > 0 && (
              <span>{shift.unpaidBreakDuration}m unpaid</span>
            )}
          </span>
        </div>
      )}

      {/* Remuneration Level */}
      {shift.remunerationLevel && (
        <div className="flex items-center gap-2 mb-2">
          <Tag className="h-3.5 w-3.5 text-white/40" />
          <span className="text-xs text-white/50">
            {shift.remunerationLevel}
          </span>
        </div>
      )}

      {/* Tags */}
      {(shift.skills?.length > 0 || shift.licenses?.length > 0) && (
        <div className="flex flex-wrap gap-1 mt-2">
          {shift.skills?.slice(0, 3).map((skill, idx) => (
            <Badge
              key={`skill-${idx}`}
              className="text-[9px] px-1.5 py-0 bg-purple-500/20 text-purple-400 border-purple-500/30"
            >
              {skill}
            </Badge>
          ))}
          {shift.licenses?.slice(0, 2).map((license, idx) => (
            <Badge
              key={`license-${idx}`}
              className="text-[9px] px-1.5 py-0 bg-amber-500/20 text-amber-400 border-amber-500/30"
            >
              {license}
            </Badge>
          ))}
          {(shift.skills?.length || 0) + (shift.licenses?.length || 0) > 5 && (
            <Badge className="text-[9px] px-1.5 py-0 bg-white/10 text-white/50 border-white/20">
              +{(shift.skills?.length || 0) + (shift.licenses?.length || 0) - 5}{' '}
              more
            </Badge>
          )}
        </div>
      )}

      {/* Notes Preview */}
      {shift.notes && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="text-[10px] text-white/40 mt-2 truncate cursor-help">
                📝 {shift.notes}
              </p>
            </TooltipTrigger>
            <TooltipContent className="max-w-[300px]">
              <p className="text-sm">{shift.notes}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
});

export default ShiftCard;
