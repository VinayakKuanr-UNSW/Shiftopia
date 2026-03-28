import React from 'react';
import { Hash } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import type { BroadcastChannelWithStats } from '../../model/broadcast.types';

export interface ChannelItemProps {
  channel: BroadcastChannelWithStats;
  isActive: boolean;
  onClick: () => void;
  compact?: boolean;
}

export const ChannelItem: React.FC<ChannelItemProps> = ({ channel, isActive, onClick, compact }) => (
  <div
    onClick={onClick}
    className={cn(
      'flex items-center gap-2 md:gap-3 px-3 md:px-4 py-2.5 md:py-3.5 rounded-lg md:rounded-xl cursor-pointer transition-all duration-200 group',
      isActive
        ? 'bg-primary/20 text-slate-900 dark:text-white border border-primary/30'
        : 'text-slate-500 dark:text-blue-200/60 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white border border-transparent'
    )}
  >
    <div className={cn(
      'p-1.5 md:p-2 rounded-md md:rounded-lg transition-colors',
      isActive ? 'bg-primary/20' : 'bg-slate-100 dark:bg-white/5 group-hover:bg-slate-200 dark:group-hover:bg-white/10'
    )}>
      <Hash className="h-3.5 w-3.5 md:h-4 md:w-4 shrink-0" />
    </div>

    <div className="flex-1 min-w-0">
      <p className={cn('font-semibold truncate', compact ? 'text-xs' : 'text-sm')}>{channel.name}</p>
      {!compact && channel.description && (
        <p className="text-[10px] md:text-xs text-slate-400 dark:text-white/40 truncate mt-0.5">
          {channel.description}
        </p>
      )}
    </div>
    {/* Unread badge removed */}
  </div>
);

export default ChannelItem;
