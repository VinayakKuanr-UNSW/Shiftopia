import React from 'react';
import { Hash, Clock } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { motion } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import { GROUP_COLORS, GROUP_ICON_BG, GROUP_ICONS_SM } from '../constants';
import type { EmployeeBroadcastGroup } from '../../model/broadcast.types';

export interface EmployeeGroupCardProps {
  group: EmployeeBroadcastGroup;
  onClick: () => void;
  compact?: boolean;
}

export const EmployeeGroupCard: React.FC<EmployeeGroupCardProps> = ({ group, onClick, compact }) => {
  const colorClass = GROUP_COLORS[group.color || 'blue'];
  const icon = GROUP_ICONS_SM[group.icon || 'megaphone'];

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={cn(
        'relative rounded-2xl md:rounded-3xl overflow-hidden cursor-pointer transition-all duration-300',
        'bg-gradient-to-br border backdrop-blur-xl',
        colorClass,
        'shadow-lg shadow-black/20',
        compact ? 'min-h-[160px]' : 'min-h-[180px] md:min-h-[220px]',
        'flex flex-col group'
      )}
    >
      <div className="absolute inset-0 bg-black/5 dark:bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity" />

      <div className={cn('p-4 md:p-6 flex-1 flex flex-col relative z-10', compact && 'p-4')}>
        {/* Header */}
        <div className="flex items-start justify-between mb-3 md:mb-4">
          <div className="flex items-center gap-3 md:gap-4">
            <div className={cn(
              'rounded-xl md:rounded-2xl bg-gradient-to-br flex items-center justify-center border shadow-inner',
              GROUP_ICON_BG[group.color || 'blue'],
              compact ? 'w-10 h-10' : 'w-12 h-12 md:w-14 md:h-14'
            )}>
              <div className="text-slate-700 dark:text-white drop-shadow-md">
                {icon}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              {/* Hierarchy Context */}
              {(group.departmentName || group.organizationName) && (
                <div className="flex items-center gap-1.5 text-[9px] md:text-[10px] uppercase tracking-wider font-bold text-slate-400 dark:text-blue-200/50 mb-1 truncate">
                  {group.organizationName && <span className="truncate">{group.organizationName}</span>}
                  {group.organizationName && group.departmentName && <span>•</span>}
                  {group.departmentName && <span className="truncate">{group.departmentName}</span>}
                  {group.departmentName && group.subDepartmentName && (
                    <>
                      <span>/</span>
                      <span className="truncate">{group.subDepartmentName}</span>
                    </>
                  )}
                </div>
              )}
              <h3 className={cn(
                'font-bold text-slate-900 dark:text-white tracking-tight truncate',
                compact ? 'text-base' : 'text-lg md:text-xl'
              )}>
                {group.name}
              </h3>
              {!compact && (
                <p className="text-xs md:text-sm text-slate-500 dark:text-blue-200/60 line-clamp-1 mt-1 font-medium">
                  {group.description}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Badges Row - REMOVED READ/ACK */}
        <div className="flex flex-wrap gap-1.5 md:gap-2 mb-3 md:mb-4 min-h-[20px]">
          {/* Status badges removed per request */}
        </div>

        {/* Footer */}
        <div className="mt-auto pt-3 md:pt-4 border-t border-slate-200 dark:border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-1.5 md:gap-2 text-[10px] md:text-sm text-slate-400 dark:text-blue-200/40 font-medium">
            <Hash className="h-3 w-3 md:h-4 md:w-4" />
            <span>{group.channels?.length || 0} channels</span>
          </div>
          <div className="flex items-center gap-1.5 md:gap-2 text-[10px] md:text-sm text-slate-400 dark:text-blue-200/40 font-medium">
            <Clock className="h-3 w-3 md:h-4 md:w-4" />
            <span className="truncate max-w-[80px] md:max-w-none">
              {group.lastBroadcastAt
                ? formatDistanceToNow(new Date(group.lastBroadcastAt), { addSuffix: true })
                : 'No broadcasts'}
            </span>
          </div>
        </div>
      </div>

      {/* Decorative circles */}
      <div className="absolute top-0 right-0 w-32 md:w-48 h-32 md:h-48 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none blur-3xl" />
    </motion.div>
  );
};

export default EmployeeGroupCard;
