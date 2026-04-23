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
  searchQuery?: string;
  refreshTrigger?: number;
  onInChannelChange?: (inChannel: boolean) => void;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function MyBroadcastsScreen({ 
  layout, 
  scope,
  searchQuery: hoistedSearchQuery = '',
  refreshTrigger = 0,
  onInChannelChange,
}: MyBroadcastsScreenProps) {
  const { toast } = useToast();
  const { user } = useAuth();

  // State
  const [selectedGroup, setSelectedGroup] = useState<EmployeeBroadcastGroup | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<BroadcastChannelWithStats | null>(null);
  const [internalSearchQuery, setInternalSearchQuery] = useState('');
  
  // Use hoisted search for group filtering, internal search for channel filtering
  const effectiveGroupSearch = hoistedSearchQuery;
  const effectiveChannelSearch = internalSearchQuery;

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

  // Sync refresh
  useEffect(() => {
    if (refreshTrigger > 0) {
      refetch();
    }
  }, [refreshTrigger, refetch]);

  // Sync state with parent
  useEffect(() => {
    onInChannelChange?.(!!selectedGroup);
  }, [selectedGroup, onInChannelChange]);

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
    setInternalSearchQuery('');
  };

  const handleBack = () => {
    setSelectedGroup(null);
    setSelectedChannel(null);
    setInternalSearchQuery('');
  };

  // Filter groups using hoisted search
  const finalFilteredGroups = useMemo(() => {
    let result = filteredGroups;
    if (effectiveGroupSearch) {
      const q = effectiveGroupSearch.toLowerCase();
      result = result.filter(g => g.name.toLowerCase().includes(q));
    }
    return result;
  }, [filteredGroups, effectiveGroupSearch]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen w-full">
        <div className="flex flex-col items-center gap-4 md:gap-6 p-6 md:p-8 rounded-2xl md:rounded-3xl bg-card border border-border backdrop-blur-3xl shadow-sm">
          <Loader2 className="h-12 w-12 md:h-16 md:w-16 text-primary animate-spin" />
          <div className="text-center">
            <h3 className="text-lg md:text-xl font-bold text-foreground mb-1">Loading System</h3>
            <p className="text-muted-foreground text-sm md:text-base">Retrieving broadcast frequencies...</p>
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
            <h3 className="text-lg md:text-xl font-bold text-foreground mb-2">Connection Error</h3>
            <p className="text-red-700 dark:text-red-300 mb-4 md:mb-6 text-sm md:text-base">{error.message}</p>
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
  // RENDER: CHANNEL SIDEBAR
  // ========================================

  const renderChannelSidebar = (compact?: boolean) => (
    <div className={cn('flex flex-col h-full', !compact && 'bg-muted/30 backdrop-blur-xl border-r border-border')}>
      <div className={cn('p-4 md:p-6 border-b border-border', compact && 'p-4')}>
        <Button
          variant="ghost"
          className="w-full justify-start text-muted-foreground hover:text-foreground hover:bg-muted/50 mb-4 -ml-2"
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
            <div className="text-foreground">{GROUP_ICONS_SM[selectedGroup?.icon || 'megaphone']}</div>
          </div>
          <h2 className="font-bold text-lg text-foreground truncate">{selectedGroup?.name}</h2>
        </div>
      </div>

      <ScrollArea className="flex-1 px-3 md:px-4 py-4">
        <div className="space-y-1">
          <p className="px-3 md:px-4 text-[10px] md:text-xs font-bold text-muted-foreground/60 uppercase tracking-widest mb-2 md:mb-3">
            Channels
          </p>
          {selectedGroup?.channels?.length === 0 ? (
            <div className="px-4 py-6 md:py-8 text-center text-xs md:text-sm text-muted-foreground/50 italic">
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
                  setInternalSearchQuery('');
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
        <div className="p-3 md:p-4 border-t border-border bg-muted/40">
          <div className="flex items-center gap-2 md:gap-3">
            <Avatar className="h-8 w-8 md:h-9 md:w-9 border border-border">
              <AvatarFallback className="bg-primary text-primary-foreground text-[10px] md:text-xs">
                {user?.name?.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="text-xs md:text-sm font-bold text-foreground truncate">{user?.name}</p>
              <p className="text-[10px] md:text-xs text-muted-foreground truncate">{user?.role}</p>
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
        ? 'grid-cols-1 sm:grid-cols-2'
        : layout === 'tablet'
          ? 'grid-cols-1 sm:grid-cols-2'
          : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

    return (
    return (
      <div className="w-full h-full p-4 md:p-8 overflow-y-auto">
        {finalFilteredGroups.length === 0 ? (
          <EmptyGroups />
        ) : (
          <div className={cn('grid gap-4 md:gap-6', gridCols)}>
            {finalFilteredGroups.map((group, index) => (
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
        <div className="flex-1 flex flex-col min-w-0 relative bg-background/50">
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2 pointer-events-none" />

          {selectedChannel ? (
            <ChannelView
              channelId={selectedChannel.id}
              channelName={selectedChannel.name}
              channelDescription={selectedChannel.description}
              onSearch={setInternalSearchQuery}
              searchQuery={internalSearchQuery}
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
        <div className="flex-1 flex flex-col min-w-0 relative bg-background/50">
          {selectedChannel ? (
            <ChannelView
              channelId={selectedChannel.id}
              channelName={selectedChannel.name}
              channelDescription={selectedChannel.description}
              onSearch={setInternalSearchQuery}
              searchQuery={internalSearchQuery}
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
      <div className="flex-shrink-0 bg-card/90 backdrop-blur-xl border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={handleBack} className="text-muted-foreground hover:text-foreground">
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'p-1.5 rounded-lg bg-gradient-to-br border',
                  GROUP_ICON_BG[selectedGroup?.color || 'blue']
                )}
              >
                <div className="text-foreground">
                  {React.cloneElement(GROUP_ICONS_SM[selectedGroup?.icon || 'megaphone'] as React.ReactElement, {
                    className: 'h-4 w-4',
                  })}
                </div>
              </div>
              <h2 className="font-bold text-base text-foreground truncate max-w-[150px]">{selectedGroup?.name}</h2>
            </div>
          </div>

          {/* Channel Selector Sheet */}
          <Sheet open={channelSheetOpen} onOpenChange={setChannelSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 border-border text-foreground">
                <Hash className="h-4 w-4" />
                <span className="truncate max-w-[80px]">{selectedChannel?.name || 'Select'}</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="bg-card border-border h-[60vh]">
              <SheetHeader>
                <SheetTitle className="text-foreground">Select Channel</SheetTitle>
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
                        setInternalSearchQuery('');
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
      <div className="flex-1 flex flex-col min-w-0 relative bg-background/50 overflow-hidden">
        {selectedChannel ? (
          <ChannelView
            channelId={selectedChannel.id}
            channelName={selectedChannel.name}
            channelDescription={selectedChannel.description}
            onSearch={setInternalSearchQuery}
            searchQuery={internalSearchQuery}
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
