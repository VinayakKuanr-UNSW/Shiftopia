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
      <div className="bg-white/10 dark:bg-black/5 backdrop-blur-xl border-b border-slate-200 dark:border-white/5 px-6 md:px-8 py-5 md:py-6 sticky top-0 z-20">
        <div className="flex items-center justify-between gap-4 md:gap-6">
          <div className="flex items-center gap-4 md:gap-5 min-w-0">
            <div className="p-3 md:p-3.5 rounded-2xl md:rounded-[20px] bg-primary/20 text-primary dark:text-white shadow-xl shadow-primary/5">
              <Hash className="h-6 w-6 md:h-7 md:w-7" />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2 md:gap-3">
                <h2 className="font-black text-xl md:text-2xl text-slate-900 dark:text-white tracking-tighter truncate">
                  {channelName}
                </h2>
              </div>
              <p className="text-xs md:text-[13px] font-medium text-slate-500 dark:text-blue-200/40 truncate mt-0.5">
                {channelDescription || 'Company broadcast channel'}
              </p>
            </div>
          </div>

          {/* Search */}
          <div className="relative w-48 md:w-72 hidden sm:block">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-white/30" />
            <Input
              placeholder="Search conversation..."
              value={searchQuery}
              onChange={(e) => onSearch(e.target.value)}
              className="pl-11 md:pl-12 bg-slate-100/50 dark:bg-black/20 border-slate-200/50 dark:border-white/5 text-slate-900 dark:text-white focus:border-primary/50 focus:ring-1 focus:ring-primary/20 h-10 md:h-12 rounded-2xl md:rounded-3xl text-sm font-medium transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => onSearch('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-white/40 hover:text-slate-700 dark:hover:text-white transition-colors"
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
