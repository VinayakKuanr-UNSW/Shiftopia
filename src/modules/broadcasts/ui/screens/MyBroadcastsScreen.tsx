/**
 * My Broadcasts Screen - Main Orchestrator Component (Employee View)
 *
 * This is the ROOT component for the Employee Broadcasts UI.
 * It orchestrates the layout and manages all state.
 *
 * RESPONSIBILITIES:
 * - Coordinate data fetching via useEmployeeBroadcastGroups
 * - Manage hierarchy filter state (client-side)
 * - Manage selected group/channel state
 * - Pass data down to views
 * - Handle responsive layout switching
 *
 * MUST NOT:
 * - Allow creating groups (Manager only)
 * - Make API calls directly
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Radio,
  ChevronLeft,
  Hash,
  Bell,
  Search,
  Pin,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Paperclip,
  Download,
  FileText,
  Image,
  FileSpreadsheet,
  File,
  MessageSquare,
  Megaphone,
  Settings,
  Building2,
  Theater,
  Wifi,
  WifiOff,
  RefreshCw,
  Eye,
  Shield,
  Crown,
  X,
  Loader2,
  Menu,
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/modules/core/ui/primitives/avatar';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/modules/core/ui/primitives/sheet';
import { cn } from '@/modules/core/lib/utils';
import { useToast } from '@/modules/core/hooks/use-toast';
import { useAuth } from '@/platform/auth/useAuth';
import { motion, AnimatePresence } from 'framer-motion';
import DOMPurify from 'dompurify';

import { OrgDeptSelector } from '@/modules/core/ui/components/OrgDeptSelector';
import {
  useEmployeeBroadcastGroups,
  useEmployeeBroadcasts,
} from '../../state/useBroadcasts';

import type {
  EmployeeBroadcastGroup,
  BroadcastChannelWithStats,
  BroadcastWithDetails,
  BroadcastPriority,
  BroadcastParticipantRole,
  BroadcastAttachment,
} from '../../model/broadcast.types';

// ============================================================================
// TYPES
// ============================================================================

export interface MyBroadcastsScreenProps {
  layout: 'desktop' | 'tablet' | 'mobile';
  scope?: import('@/platform/auth/types').ScopeSelection;
}

// ============================================================================
// CONSTANTS

// ============================================================================

const PRIORITY_CONFIG: Record<
  BroadcastPriority,
  { label: string; color: string; bg: string; icon: React.ReactNode }
> = {
  urgent: {
    label: 'Urgent',
    color: 'text-red-400',
    bg: 'bg-red-500/10 border-red-500/20 shadow-[0_0_10px_rgba(239,68,68,0.2)]',
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
  },
  high: {
    label: 'High',
    color: 'text-orange-400',
    bg: 'bg-orange-500/10 border-orange-500/20',
    icon: <Bell className="h-3.5 w-3.5" />,
  },
  normal: {
    label: 'Normal',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10 border-blue-500/20',
    icon: <MessageSquare className="h-3.5 w-3.5" />,
  },
  low: {
    label: 'Low',
    color: 'text-slate-400',
    bg: 'bg-slate-500/10 border-slate-500/20',
    icon: <MessageSquare className="h-3.5 w-3.5" />,
  },
};


const GROUP_ICONS: Record<string, React.ReactNode> = {
  megaphone: <Megaphone className="h-5 w-5" />,
  settings: <Settings className="h-5 w-5" />,
  building: <Building2 className="h-5 w-5" />,
  theater: <Theater className="h-5 w-5" />,
};

const GROUP_COLORS: Record<string, string> = {
  blue: 'from-blue-50 via-blue-50/60 to-slate-50 border-blue-200 hover:border-blue-300 dark:from-blue-600/20 dark:via-transparent dark:to-blue-900/40 dark:border-blue-500/20 dark:hover:border-blue-500/40',
  green: 'from-emerald-50 via-emerald-50/60 to-slate-50 border-emerald-200 hover:border-emerald-300 dark:from-emerald-600/20 dark:via-transparent dark:to-emerald-900/40 dark:border-emerald-500/20 dark:hover:border-emerald-500/40',
  purple: 'from-purple-50 via-purple-50/60 to-slate-50 border-purple-200 hover:border-purple-300 dark:from-purple-600/20 dark:via-transparent dark:to-purple-900/40 dark:border-purple-500/20 dark:hover:border-purple-500/40',
  red: 'from-red-50 via-red-50/60 to-slate-50 border-red-200 hover:border-red-300 dark:from-red-600/20 dark:via-transparent dark:to-red-900/40 dark:border-red-500/20 dark:hover:border-red-500/40',
};

const GROUP_ICON_BG: Record<string, string> = {
  blue: 'from-blue-100 to-blue-200/60 border-blue-200 dark:from-blue-500/20 dark:to-blue-600/10 dark:border-white/10',
  green: 'from-emerald-100 to-emerald-200/60 border-emerald-200 dark:from-emerald-500/20 dark:to-emerald-600/10 dark:border-white/10',
  purple: 'from-purple-100 to-purple-200/60 border-purple-200 dark:from-purple-500/20 dark:to-purple-600/10 dark:border-white/10',
  red: 'from-red-100 to-red-200/60 border-red-200 dark:from-red-500/20 dark:to-red-600/10 dark:border-white/10',
};

const ROLE_ICONS: Record<BroadcastParticipantRole, React.ReactNode> = {
  admin: <Shield className="h-3 w-3 text-red-400" />,
  broadcaster: <Crown className="h-3 w-3 text-amber-400" />,
  lead: <Crown className="h-3 w-3 text-blue-400" />,
  member: null,
};

const FILE_ICONS: Record<string, React.ReactNode> = {
  pdf: <FileText className="h-4 w-4 text-red-400" />,
  image: <Image className="h-4 w-4 text-green-400" />,
  document: <FileText className="h-4 w-4 text-blue-400" />,
  spreadsheet: <FileSpreadsheet className="h-4 w-4 text-emerald-400" />,
  other: <File className="h-4 w-4 text-gray-400" />,
};

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

// Group Card Component
interface GroupCardProps {
  group: EmployeeBroadcastGroup;
  onClick: () => void;
  compact?: boolean;
}

const GroupCard: React.FC<GroupCardProps> = ({ group, onClick, compact }) => {
  const colorClass = GROUP_COLORS[group.color || 'blue'];
  const icon = GROUP_ICONS[group.icon || 'megaphone'];

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

// Channel Item Component
interface ChannelItemProps {
  channel: BroadcastChannelWithStats;
  isActive: boolean;
  onClick: () => void;
  compact?: boolean;
}

const ChannelItem: React.FC<ChannelItemProps> = ({ channel, isActive, onClick, compact }) => (
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

// Message Item Component
interface MessageItemProps {
  message: BroadcastWithDetails;
  compact?: boolean;
}

const MessageItem: React.FC<MessageItemProps> = ({ message, compact }) => {
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
                      {formatFileSize(att.fileSize)}
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

// Empty States
const EmptyGroups: React.FC = () => (
  <div className="flex flex-col items-center justify-center h-[50vh] md:h-[60vh] p-6 md:p-8 text-center">
    <div className="w-24 h-24 md:w-32 md:h-32 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center mb-4 md:mb-6 border border-slate-200 dark:border-white/10 shadow-2xl relative">
      <div className="absolute inset-0 bg-primary/10 blur-3xl rounded-full" />
      <Radio className="h-10 w-10 md:h-12 md:w-12 text-slate-400 dark:text-blue-200/60 relative z-10" />
    </div>
    <h3 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white mb-2">No Broadcast Groups</h3>
    <p className="text-slate-500 dark:text-blue-200/60 max-w-sm leading-relaxed text-sm md:text-base">
      You haven't been added to any broadcast groups yet. Contact your manager if you believe this is an error.
    </p>
  </div>
);

const EmptyMessages: React.FC = () => (
  <div className="flex flex-col items-center justify-center h-full p-6 md:p-8 text-center min-h-[300px] md:min-h-[400px]">
    <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center mb-4 md:mb-6 border border-slate-200 dark:border-white/10">
      <MessageSquare className="h-8 w-8 md:h-10 md:w-10 text-slate-300 dark:text-white/20" />
    </div>
    <h3 className="text-lg md:text-xl font-bold text-slate-900 dark:text-white mb-2">No Messages</h3>
    <p className="text-slate-400 dark:text-blue-200/40 max-w-xs mx-auto text-sm">
      No broadcasts have been sent to this channel yet.
    </p>
  </div>
);

const EmptyChannels: React.FC = () => (
  <div className="flex flex-col items-center justify-center h-full p-6 md:p-8 text-center">
    <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-slate-100 dark:bg-white/5 flex items-center justify-center mb-4 md:mb-5 border border-slate-200 dark:border-white/10">
      <Hash className="h-6 w-6 md:h-8 md:w-8 text-slate-300 dark:text-white/20" />
    </div>
    <h3 className="text-base md:text-lg font-bold text-slate-900 dark:text-white mb-2">No Channels</h3>
    <p className="text-slate-400 dark:text-blue-200/40 text-sm">This group doesn't have any channels configured.</p>
  </div>
);

// Channel View Component
interface ChannelViewProps {
  channelId: string;
  channelName: string;
  channelDescription?: string;
  onSearch: (query: string) => void;
  searchQuery: string;
  compact?: boolean;
}

const ChannelView: React.FC<ChannelViewProps> = ({
  channelId,
  channelName,
  channelDescription,
  onSearch,
  searchQuery,
  compact,
}) => {
  const { broadcasts, isLoading, refetch, loadMore, hasMore, isLoadingMore } =
    useEmployeeBroadcasts(channelId);

  const filteredBroadcasts = useMemo(() => {
    if (!searchQuery.trim()) return broadcasts;
    const query = searchQuery.toLowerCase();
    return broadcasts.filter(
      (m) =>
        m.content.toLowerCase().includes(query) ||
        m.subject?.toLowerCase().includes(query) ||
        m.author?.name?.toLowerCase().includes(query)
    );
  }, [broadcasts, searchQuery]);

  const sortedBroadcasts = useMemo(() => {
    return [...filteredBroadcasts].sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [filteredBroadcasts]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 md:h-12 md:w-12 text-primary animate-spin" />
          <p className="text-blue-200/60 font-medium animate-pulse text-sm md:text-base">Loading messages...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Channel Header */}
      <div className="bg-white/90 dark:bg-[#1a2744]/40 backdrop-blur-xl border-b border-slate-200 dark:border-white/5 px-4 md:px-8 py-4 md:py-5 sticky top-0 z-20">
        <div className="flex items-center justify-between gap-3 md:gap-4">
          <div className="flex items-center gap-3 md:gap-4 min-w-0">
            <div className="p-2 md:p-2.5 rounded-lg md:rounded-xl bg-primary/20 text-primary dark:text-white shadow-sm">
              <Hash className="h-5 w-5 md:h-6 md:w-6" />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2 md:gap-3">
                <h2 className="font-bold text-lg md:text-xl text-slate-900 dark:text-white tracking-tight truncate">
                  {channelName}
                </h2>
                {/* Badges removed */}
              </div>
              <p className="text-xs md:text-sm text-slate-500 dark:text-blue-200/60 truncate">
                {channelDescription || 'Company broadcast channel'}
              </p>
            </div>
          </div>

          {/* Search */}
          <div className="relative w-40 md:w-64 hidden sm:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-white/40" />
            <Input
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => onSearch(e.target.value)}
              className="pl-9 md:pl-10 bg-slate-100 dark:bg-black/20 border-slate-200 dark:border-white/10 text-slate-900 dark:text-white focus:border-primary/50 h-9 md:h-10 rounded-lg md:rounded-xl text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => onSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-white/40 hover:text-slate-700 dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 bg-transparent">
        <div className="p-4 md:p-6 lg:p-8 min-h-full">
          {sortedBroadcasts.length === 0 ? (
            searchQuery ? (
              <div className="text-center py-16 md:py-20">
                <p className="text-slate-500 dark:text-blue-200/60 text-base md:text-lg">No messages match your search.</p>
              </div>
            ) : (
              <EmptyMessages />
            )
          ) : (
            <div className="space-y-4 md:space-y-6 w-full">
              {sortedBroadcasts.map((message) => (
                <MessageItem
                  key={message.id}
                  message={message}
                  compact={compact}
                />
              ))}

              {/* Load More Button */}
              {hasMore && (
                <div className="pt-4 flex justify-center">
                  <Button
                    variant="outline"
                    onClick={() => loadMore()}
                    disabled={isLoadingMore}
                    className="text-slate-500 dark:text-blue-200/60 hover:text-slate-900 dark:hover:text-white border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5 bg-white dark:bg-black/20"
                  >
                    {isLoadingMore ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      'Load Older Messages'
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Read-only notice */}
          <div className="mt-8 md:mt-12 mb-4 md:mb-6 flex justify-center">
            <div className="px-3 md:px-4 py-1.5 md:py-2 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/5 text-[10px] md:text-xs font-medium text-slate-400 dark:text-white/40 flex items-center gap-2">
              <Shield className="h-3 w-3" />
              <span>Broadcast Channel - Read Only Access</span>
            </div>
          </div>
        </div>
      </ScrollArea>
    </>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function MyBroadcastsScreen({ layout, scope }: MyBroadcastsScreenProps) {
  const { toast } = useToast();
  const { user } = useAuth();

  // State
  const [selectedGroup, setSelectedGroup] = useState<EmployeeBroadcastGroup | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<BroadcastChannelWithStats | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [channelSheetOpen, setChannelSheetOpen] = useState(false);

  // Data

  const { groups, isLoading, error, refetch } =
    useEmployeeBroadcastGroups();

  // Online/Offline detection
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast({ title: 'Back online', description: 'Connection restored' });
      refetch();
    };
    const handleOffline = () => {
      setIsOnline(false);
      toast({
        title: 'Offline',
        description: 'You are now offline. Some features may be unavailable.',
        variant: 'destructive',
      });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [toast, refetch]);

  // Auto-select first channel when group is selected
  useEffect(() => {
    if (selectedGroup && selectedGroup.channels?.length > 0 && !selectedChannel) {
      setSelectedChannel(selectedGroup.channels[0]);
    }
  }, [selectedGroup, selectedChannel]);

  // Filter groups
  const filteredGroups = useMemo(() => {
    if (!scope) return groups;
    return groups.filter((g) => {
      // Must match explicit scope selections if group has hierarchy defined
      if (g.organizationId && scope.org_ids.length > 0 && !scope.org_ids.includes(g.organizationId)) return false;
      if (g.departmentId && scope.dept_ids.length > 0 && !scope.dept_ids.includes(g.departmentId)) return false;
      if (g.subDepartmentId && scope.subdept_ids.length > 0 && !scope.subdept_ids.includes(g.subDepartmentId)) return false;
      return true;
    });
  }, [groups, scope]);


  // Handlers
  const handleSelectGroup = (group: EmployeeBroadcastGroup) => {
    setSelectedGroup(group);
    setSelectedChannel(null);
    setSearchQuery('');
  };

  const handleBack = () => {
    setSelectedGroup(null);
    setSelectedChannel(null);
    setSearchQuery('');
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen w-full">
        <div className="flex flex-col items-center gap-4 md:gap-6 p-6 md:p-8 rounded-2xl md:rounded-3xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 backdrop-blur-3xl shadow-sm dark:shadow-none">
          <Loader2 className="h-12 w-12 md:h-16 md:w-16 text-primary animate-spin" />
          <div className="text-center">
            <h3 className="text-lg md:text-xl font-bold text-slate-900 dark:text-white mb-1">Loading System</h3>
            <p className="text-slate-500 dark:text-blue-200/60 text-sm md:text-base">Retrieving broadcast frequencies...</p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center h-screen w-full p-4">
        <div className="flex flex-col items-center gap-4 md:gap-6 p-6 md:p-8 max-w-md text-center rounded-2xl md:rounded-3xl bg-red-500/10 border border-red-500/20 backdrop-blur-3xl">
          <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-red-500/20 flex items-center justify-center shadow-[0_0_30px_rgba(239,68,68,0.3)]">
            <AlertTriangle className="h-8 w-8 md:h-10 md:w-10 text-red-500" />
          </div>
          <div>
            <h3 className="text-lg md:text-xl font-bold text-slate-900 dark:text-white mb-2">Connection Error</h3>
            <p className="text-red-700 dark:text-red-200/80 mb-4 md:mb-6 text-sm md:text-base">{error.message}</p>
            <Button onClick={() => refetch()} className="gap-2 bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20">
              <RefreshCw className="h-4 w-4" />
              Retry Connection
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ========================================
  // RENDER: HEADER (Groups View)
  // ========================================

  const renderGroupsHeader = () => (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white/80 dark:bg-[#1a2744]/40 backdrop-blur-2xl border border-slate-200 dark:border-white/10 rounded-2xl md:rounded-3xl px-4 md:px-8 py-6 md:py-8 mb-6 md:mb-8 relative overflow-hidden shadow-sm dark:shadow-none"
    >
      <div className="absolute top-0 right-0 w-64 md:w-96 h-64 md:h-96 bg-primary/10 rounded-full blur-[80px] -translate-y-1/2 translate-x-1/2 pointer-events-none" />

      <div className="relative z-10 flex flex-col items-start gap-4 md:gap-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 md:gap-6 w-full">
          <div className="flex items-center gap-4 md:gap-6">
            <div className="w-12 h-12 md:w-16 md:h-16 rounded-xl md:rounded-2xl bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center shadow-lg shadow-primary/20">
              <Radio className="h-6 w-6 md:h-8 md:w-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Broadcasts</h1>
              <p className="text-slate-500 dark:text-blue-200/60 mt-1 font-medium text-sm md:text-base">
                Company announcements and updates
              </p>
            </div>
          </div>

          {/* Status indicators */}
          <div className="flex flex-wrap items-center gap-2 md:gap-3">
            {/* Status indicators removed */}
            {isOnline ? (
              <div className="flex items-center gap-1.5 md:gap-2 px-2 md:px-3 py-1 md:py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] md:text-xs font-bold uppercase tracking-wider">
                <div className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                Online
              </div>
            ) : (
              <div className="flex items-center gap-1.5 md:gap-2 px-2 md:px-3 py-1 md:py-1.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] md:text-xs font-bold uppercase tracking-wider">
                <div className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-red-500" />
                Offline
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );



  // ========================================
  // RENDER: CHANNEL SIDEBAR
  // ========================================

  const renderChannelSidebar = (compact?: boolean) => (
    <div className={cn('flex flex-col h-full', !compact && 'bg-slate-50 dark:bg-[#0d1424]/90 backdrop-blur-xl border-r border-slate-200 dark:border-white/5')}>
      <div className={cn('p-4 md:p-6 border-b border-slate-200 dark:border-white/5', compact && 'p-4')}>
        <Button
          variant="ghost"
          className="w-full justify-start text-slate-500 dark:text-blue-200/60 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 mb-4 -ml-2"
          onClick={handleBack}
        >
          <ChevronLeft className="h-4 w-4 mr-2" />
          Back to Groups
        </Button>

        <div className="flex items-center gap-3 mb-2">
          <div
            className={cn(
              'p-2 rounded-xl bg-gradient-to-br border',
              GROUP_ICON_BG[selectedGroup?.color || 'blue']
            )}
          >
            <div className="text-slate-700 dark:text-white">{GROUP_ICONS[selectedGroup?.icon || 'megaphone']}</div>
          </div>
          <h2 className="font-bold text-lg text-slate-900 dark:text-white truncate">{selectedGroup?.name}</h2>
        </div>
      </div>

      <ScrollArea className="flex-1 px-3 md:px-4 py-4">
        <div className="space-y-1">
          <p className="px-3 md:px-4 text-[10px] md:text-xs font-bold text-slate-400 dark:text-blue-200/40 uppercase tracking-widest mb-2 md:mb-3">
            Channels
          </p>
          {selectedGroup?.channels?.length === 0 ? (
            <div className="px-4 py-6 md:py-8 text-center text-xs md:text-sm text-slate-400 dark:text-white/30 italic">
              No channels
            </div>
          ) : (
            selectedGroup?.channels?.map((channel) => (
              <ChannelItem
                key={channel.id}
                channel={channel}
                isActive={selectedChannel?.id === channel.id}
                onClick={() => {
                  setSelectedChannel(channel);
                  setSearchQuery('');
                  setChannelSheetOpen(false);
                }}
                compact={compact}
              />
            ))
          )}
        </div>
      </ScrollArea>

      {/* User Profile Mini */}
      {user && (
        <div className="p-3 md:p-4 border-t border-slate-200 dark:border-white/5 bg-slate-100/60 dark:bg-black/20">
          <div className="flex items-center gap-2 md:gap-3">
            <Avatar className="h-8 w-8 md:h-9 md:w-9 border border-slate-200 dark:border-white/10">
              <AvatarFallback className="bg-primary text-white text-[10px] md:text-xs">
                {user?.name?.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="text-xs md:text-sm font-bold text-slate-900 dark:text-white truncate">{user?.name}</p>
              <p className="text-[10px] md:text-xs text-slate-400 dark:text-blue-200/40 truncate">{user?.role}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ========================================
  // GROUPS VIEW (No group selected)
  // ========================================

  if (!selectedGroup) {
    const gridCols =
      layout === 'mobile'
        ? 'grid-cols-1'
        : layout === 'tablet'
          ? 'grid-cols-1 sm:grid-cols-2'
          : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

    return (
      <div className="w-full min-h-screen p-4 md:p-8 bg-transparent">
        {renderGroupsHeader()}

        {filteredGroups.length === 0 ? (
          <EmptyGroups />
        ) : (
          <div className={cn('grid gap-4 md:gap-6', gridCols)}>
            {filteredGroups.map((group, index) => (
              <motion.div
                key={group.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <GroupCard
                  group={group}
                  onClick={() => handleSelectGroup(group)}
                  compact={layout === 'mobile'}
                />
              </motion.div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ========================================
  // DESKTOP LAYOUT (Group Selected)
  // ========================================

  if (layout === 'desktop') {
    return (
      <div className="flex h-screen w-full bg-transparent overflow-hidden">
        {/* Sidebar - Channels List */}
        <div className="w-[280px] lg:w-[300px] shrink-0 z-20">{renderChannelSidebar()}</div>

        {/* Main Content - Messages */}
        <div className="flex-1 flex flex-col min-w-0 relative bg-white dark:bg-[#0d1424]/50">
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2 pointer-events-none" />

          {selectedChannel ? (
            <ChannelView
              channelId={selectedChannel.id}
              channelName={selectedChannel.name}
              channelDescription={selectedChannel.description}
              onSearch={setSearchQuery}
              searchQuery={searchQuery}
            />
          ) : (
            <EmptyChannels />
          )}
        </div>
      </div>
    );
  }

  // ========================================
  // TABLET LAYOUT (Group Selected)
  // ========================================

  if (layout === 'tablet') {
    return (
      <div className="flex h-screen w-full bg-transparent overflow-hidden">
        {/* Sidebar - Channels List (narrower) */}
        <div className="w-[220px] shrink-0 z-20">{renderChannelSidebar(true)}</div>

        {/* Main Content - Messages */}
        <div className="flex-1 flex flex-col min-w-0 relative bg-white dark:bg-[#0d1424]/50">
          {selectedChannel ? (
            <ChannelView
              channelId={selectedChannel.id}
              channelName={selectedChannel.name}
              channelDescription={selectedChannel.description}
              onSearch={setSearchQuery}
              searchQuery={searchQuery}
              compact
            />
          ) : (
            <EmptyChannels />
          )}
        </div>
      </div>
    );
  }

  // ========================================
  // MOBILE LAYOUT (Group Selected)
  // ========================================

  return (
    <div className="flex flex-col h-screen w-full bg-transparent overflow-hidden">
      {/* Mobile Header */}
      <div className="flex-shrink-0 bg-white/90 dark:bg-[#1a2744]/60 backdrop-blur-xl border-b border-slate-200 dark:border-white/5 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={handleBack} className="text-slate-500 dark:text-white/60 hover:text-slate-900 dark:hover:text-white">
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'p-1.5 rounded-lg bg-gradient-to-br border',
                  GROUP_ICON_BG[selectedGroup?.color || 'blue']
                )}
              >
                <div className="text-slate-700 dark:text-white">
                  {React.cloneElement(GROUP_ICONS[selectedGroup?.icon || 'megaphone'] as React.ReactElement, {
                    className: 'h-4 w-4',
                  })}
                </div>
              </div>
              <h2 className="font-bold text-base text-slate-900 dark:text-white truncate max-w-[150px]">{selectedGroup?.name}</h2>
            </div>
          </div>

          {/* Channel Selector Sheet */}
          <Sheet open={channelSheetOpen} onOpenChange={setChannelSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 border-slate-200 dark:border-white/10 text-slate-700 dark:text-white">
                <Hash className="h-4 w-4" />
                <span className="truncate max-w-[80px]">{selectedChannel?.name || 'Select'}</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="bg-white dark:bg-[#0d1424] border-slate-200 dark:border-white/10 h-[60vh]">
              <SheetHeader>
                <SheetTitle className="text-slate-900 dark:text-white">Select Channel</SheetTitle>
              </SheetHeader>
              <ScrollArea className="h-full py-4">
                <div className="space-y-1">
                  {selectedGroup?.channels?.map((channel) => (
                    <ChannelItem
                      key={channel.id}
                      channel={channel}
                      isActive={selectedChannel?.id === channel.id}
                      onClick={() => {
                        setSelectedChannel(channel);
                        setSearchQuery('');
                        setChannelSheetOpen(false);
                      }}
                    />
                  ))}
                </div>
              </ScrollArea>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Main Content - Messages */}
      <div className="flex-1 flex flex-col min-w-0 relative bg-white dark:bg-[#0d1424]/50 overflow-hidden">
        {selectedChannel ? (
          <ChannelView
            channelId={selectedChannel.id}
            channelName={selectedChannel.name}
            channelDescription={selectedChannel.description}
            onSearch={setSearchQuery}
            searchQuery={searchQuery}
            compact
          />
        ) : (
          <EmptyChannels />
        )}
      </div>
    </div>
  );
}

export default MyBroadcastsScreen;
