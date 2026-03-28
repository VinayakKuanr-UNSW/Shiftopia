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

import React, { useState, useEffect, useMemo } from 'react';
import {
  Radio,
  ChevronLeft,
  Hash,
  AlertTriangle,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { Avatar, AvatarFallback } from '@/modules/core/ui/primitives/avatar';
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
import { motion } from 'framer-motion';

import {
  useEmployeeBroadcastGroups,
} from '../../state/useBroadcasts';

import type {
  EmployeeBroadcastGroup,
  BroadcastChannelWithStats,
} from '../../model/broadcast.types';

import { GROUP_ICONS_SM, GROUP_ICON_BG } from '../constants';
import { EmployeeGroupCard } from '../components/EmployeeGroupCard';
import { ChannelItem } from '../components/ChannelItem';
import { EmptyGroups, EmptyChannels } from '../components/EmptyStates';
import { ChannelView } from '../views/ChannelView.view';

// ============================================================================
// TYPES
// ============================================================================

export interface MyBroadcastsScreenProps {
  layout: 'desktop' | 'tablet' | 'mobile';
  scope?: import('@/platform/auth/types').ScopeSelection;
}

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
            <div className="text-slate-700 dark:text-white">{GROUP_ICONS_SM[selectedGroup?.icon || 'megaphone']}</div>
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
                <EmployeeGroupCard
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
                  {React.cloneElement(GROUP_ICONS_SM[selectedGroup?.icon || 'megaphone'] as React.ReactElement, {
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
