import React, { useMemo } from 'react';
import { Hash, Search, X, Loader2, Shield } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { cn } from '@/modules/core/lib/utils';
import { useEmployeeBroadcasts } from '../../state/useBroadcasts';
import { MessageItem } from '../components/MessageItem';
import { EmptyMessages } from '../components/EmptyStates';

export interface ChannelViewProps {
  channelId: string;
  channelName: string;
  channelDescription?: string;
  onSearch: (query: string) => void;
  searchQuery: string;
  compact?: boolean;
}

export const ChannelView: React.FC<ChannelViewProps> = ({
  channelId,
  channelName,
  channelDescription,
  onSearch,
  searchQuery,
  compact,
}) => {
  const { broadcasts, isLoading, loadMore, hasMore, isLoadingMore } =
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

export default ChannelView;
