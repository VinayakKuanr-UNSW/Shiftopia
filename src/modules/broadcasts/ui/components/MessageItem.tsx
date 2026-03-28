import React from 'react';
import { format } from 'date-fns';
import { Pin, Paperclip, Download } from 'lucide-react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Avatar, AvatarFallback } from '@/modules/core/ui/primitives/avatar';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import { cn } from '@/modules/core/lib/utils';
import { motion } from 'framer-motion';
import DOMPurify from 'dompurify';
import { PRIORITY_CONFIG, ROLE_ICONS, FILE_ICONS } from '../constants';
import { formatFileSize } from '../utils';
import type {
  BroadcastWithDetails,
  BroadcastAttachment,
  BroadcastParticipantRole,
} from '../../model/broadcast.types';

export interface MessageItemProps {
  message: BroadcastWithDetails;
  compact?: boolean;
}

export const MessageItem: React.FC<MessageItemProps> = ({ message, compact }) => {
  const priorityConfig = PRIORITY_CONFIG[message.priority];
  const roleIcon = ROLE_ICONS[message.authorRole as BroadcastParticipantRole];

  const handleDownload = (attachment: BroadcastAttachment) => {
    window.open(attachment.fileUrl, '_blank');
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      layout
      className={cn(
        'rounded-2xl md:rounded-3xl border transition-all duration-300 overflow-hidden relative',
        message.isPinned
          ? 'bg-amber-50/80 dark:bg-[#1a2744]/60 backdrop-blur-xl border-amber-200 dark:border-amber-500/20 shadow-lg'
          : 'bg-white dark:bg-[#1a2744]/40 backdrop-blur-md border-slate-100 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-[#1a2744]/50',
        message.priority === 'urgent' && !message.isPinned && 'border-red-500/30 bg-red-900/10'
      )}
    >
      {/* Pinned indicator */}
      {message.isPinned && (
        <div className="px-4 md:px-6 py-1.5 md:py-2 bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-500/10 flex items-center gap-2 text-amber-700 dark:text-amber-300 text-[10px] md:text-xs font-bold uppercase tracking-wider backdrop-blur-sm">
          <Pin className="h-3 w-3 md:h-3.5 md:w-3.5" />
          <span>Pinned Message</span>
        </div>
      )}

      <div className={cn('p-4 md:p-6 lg:p-8', compact && 'p-4')}>
        {/* Author & Meta */}
        <div className="flex items-start justify-between mb-4 md:mb-6">
          <div className="flex items-center gap-3 md:gap-4">
            <Avatar className={cn('border-2 border-slate-200 dark:border-white/10 shadow-lg', compact ? 'h-10 w-10' : 'h-10 w-10 md:h-12 md:w-12')}>
              <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold text-sm md:text-lg">
                {message.author?.name?.split(' ').map((n) => n[0]).join('') || '?'}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn('font-bold text-slate-900 dark:text-white', compact ? 'text-base' : 'text-base md:text-lg')}>
                  {message.author?.name || 'Unknown'}
                </span>
                {roleIcon && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>{roleIcon}</TooltipTrigger>
                      <TooltipContent>
                        <p className="capitalize">{message.authorRole}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                <Badge
                  variant="outline"
                  className={cn('text-[9px] md:text-[10px] px-1.5 md:px-2 py-0.5 border', priorityConfig.bg, priorityConfig.color)}
                >
                  {priorityConfig.icon}
                  <span className="ml-1">{priorityConfig.label}</span>
                </Badge>
              </div>
              <p className="text-xs md:text-sm text-slate-400 dark:text-blue-200/40 mt-0.5 md:mt-1 font-medium">
                {format(new Date(message.createdAt), compact ? "MMM d, h:mm a" : "EEEE, MMM d, yyyy 'at' h:mm a")}
              </p>
            </div>
          </div>

          {/* New badge removed */}
        </div>

        {/* Subject */}
        {message.subject && (
          <h4 className={cn('font-bold text-slate-900 dark:text-white mb-3 md:mb-4 tracking-tight', compact ? 'text-base' : 'text-lg md:text-xl')}>
            {message.subject}
          </h4>
        )}

        {/* Content */}
        <div
          className={cn(
            'text-slate-700 dark:text-blue-100/90 leading-relaxed mb-4 md:mb-6 prose dark:prose-invert max-w-none prose-p:text-slate-700 dark:prose-p:text-blue-100/90 prose-headings:text-slate-900 dark:prose-headings:text-white prose-strong:text-slate-900 dark:prose-strong:text-white prose-a:text-primary',
            compact ? 'text-sm' : 'text-sm md:text-base'
          )}
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(message.content) }}
        />

        {/* Attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="mb-4 md:mb-6 space-y-2 md:space-y-3 p-3 md:p-4 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/5">
            <p className="text-[10px] md:text-xs text-slate-500 dark:text-blue-200/60 uppercase tracking-widest font-bold flex items-center gap-2 mb-2 md:mb-3">
              <Paperclip className="h-3 w-3 md:h-3.5 md:w-3.5" />
              Attachments ({message.attachments.length})
            </p>
            <div className="flex flex-wrap gap-2 md:gap-3">
              {message.attachments.map((att) => (
                <div
                  key={att.id}
                  className="flex items-center gap-2 md:gap-3 px-2 md:px-3 py-2 md:py-2.5 rounded-lg bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10 hover:border-slate-300 dark:hover:border-white/20 transition-all cursor-pointer group w-full sm:w-auto min-w-[160px] md:min-w-[200px]"
                  onClick={() => handleDownload(att)}
                >
                  <div className="p-1.5 md:p-2 rounded-md bg-slate-100 dark:bg-white/5">
                    {FILE_ICONS[att.fileType] || FILE_ICONS.other}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs md:text-sm font-medium text-slate-800 dark:text-white truncate max-w-[100px] md:max-w-[140px]">
                      {att.fileName}
                    </p>
                    <p className="text-[9px] md:text-[10px] text-slate-400 dark:text-blue-200/40 font-mono">
                      {att.fileSize != null ? formatFileSize(att.fileSize) : ''}
                    </p>
                  </div>
                  <div className="p-1 md:p-1.5 rounded-full bg-slate-100 dark:bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Download className="h-3 w-3 md:h-3.5 md:w-3.5 text-slate-600 dark:text-white" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Acknowledgement UI Removed */}
      </div>
    </motion.div>
  );
};

export default MessageItem;
