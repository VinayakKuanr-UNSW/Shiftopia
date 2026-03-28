import React, { useState, useMemo, useEffect } from 'react';
import {
    Hash,
    Users,
    MessageSquare,
    Loader2,
    Search,
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/modules/core/ui/primitives/select';
import { cn } from '@/modules/core/lib/utils';
import { useBroadcastGroup, useBroadcasts } from '../../../state/useBroadcasts';
import { BroadcastItem } from '../../components/BroadcastItem';
import { ControlRoomChannels } from './Channels';
import { ControlRoomParticipants } from './Participants';
import { CreateBroadcastRequest } from '../../../model/broadcast.types';

interface ControlRoomProps {
    groupId: string;
    onBack: () => void;
}

type FilterOption = 'all' | 'urgent' | 'pinned';

export const ControlRoom: React.FC<ControlRoomProps> = ({ groupId, onBack }) => {
    const {
        group,
        isLoading: groupLoading,
        canManage,
        createChannel,
        deleteChannel,
        addParticipant,
        removeParticipant,
        refetch: refreshGroup,
    } = useBroadcastGroup(groupId);

    const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
    const [filter, setFilter] = useState<FilterOption>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [isParticipantsOpen, setIsParticipantsOpen] = useState(true);

    const {
        isLoading: broadcastsLoading,
        pinnedBroadcasts,
        activeBroadcasts,
        createBroadcast,
        deleteBroadcast,
        togglePin,
    } = useBroadcasts(selectedChannelId);

    // Auto-select first channel
    useEffect(() => {
        if (group?.channels && group.channels.length > 0 && !selectedChannelId) {
            setSelectedChannelId(group.channels[0].id);
        }
    }, [group, selectedChannelId]);

    const filteredBroadcasts = useMemo(() => {
        let result = [...pinnedBroadcasts, ...activeBroadcasts];

        if (filter === 'urgent') {
            result = result.filter((b) => b.priority === 'urgent');
        } else if (filter === 'pinned') {
            result = result.filter((b) => b.isPinned);
        }

        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            result = result.filter(
                (b) =>
                    b.content.toLowerCase().includes(q) ||
                    b.subject?.toLowerCase().includes(q) ||
                    b.author?.name?.toLowerCase().includes(q)
            );
        }

        return result;
    }, [pinnedBroadcasts, activeBroadcasts, filter, searchQuery]);

    const handleSendBroadcast = async (data: Omit<CreateBroadcastRequest, 'channelId'>) => {
        await createBroadcast(data);
    };

    const selectedChannel = group?.channels?.find((c) => c.id === selectedChannelId);

    if (groupLoading) {
        return (
            <div className="h-screen bg-background flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-10 w-10 text-primary animate-spin" />
                    <p className="text-muted-foreground">Loading group...</p>
                </div>
            </div>
        );
    }

    if (!group) {
        return (
            <div className="h-screen bg-background flex items-center justify-center">
                <div className="text-center">
                    <p className="text-muted-foreground text-lg mb-4">Group not found</p>
                    <Button onClick={onBack}>Back to Dashboard</Button>
                </div>
            </div>
        );
    }

    return (
        <div className="h-screen bg-background flex p-4 gap-4 overflow-hidden">
            {/* Left Sidebar - Channels */}
            <div className="w-80 flex flex-col rounded-3xl border border-border bg-card/30 shadow-sm overflow-hidden backdrop-blur-md">
                <ControlRoomChannels
                    group={group}
                    selectedChannelId={selectedChannelId}
                    onSelectChannel={setSelectedChannelId}
                    canManage={canManage}
                    onBack={onBack}
                    onCreateChannel={createChannel}
                    onDeleteChannel={deleteChannel}
                    onSendBroadcast={handleSendBroadcast}
                    isSending={broadcastsLoading}
                    totalRecipients={group.participantCount}
                />
            </div>

            {/* Middle - Main Content */}
            <div className="flex-1 flex flex-col rounded-3xl border border-border bg-card/30 shadow-sm overflow-hidden backdrop-blur-md min-w-[500px] transition-all duration-300">
                {selectedChannel ? (
                    <>
                        <div className="bg-card/50 border-b border-border px-6 py-4 backdrop-blur-sm">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                                        <Hash className="h-5 w-5 text-primary" />
                                        {selectedChannel.name}
                                    </h2>
                                    <p className="text-sm text-muted-foreground">
                                        {selectedChannel.description}
                                    </p>
                                </div>

                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setIsParticipantsOpen(!isParticipantsOpen)}
                                    className={cn("bg-muted/50 hover:bg-muted", isParticipantsOpen && "text-primary bg-primary/10")}
                                    title={isParticipantsOpen ? "Hide Participants" : "Show Participants"}
                                >
                                    <Users className="h-5 w-5" />
                                </Button>
                            </div>
                        </div>

                        {/* Search + Filter pill bar */}
                        <div className="px-6 py-3 border-b border-border/50 bg-card/30 flex items-center gap-3">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search broadcasts..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-9 h-8 bg-muted/50 rounded-full text-sm"
                                />
                            </div>
                            <div className="flex items-center gap-1.5">
                                {(['all', 'urgent', 'pinned'] as FilterOption[]).map((opt) => (
                                    <button
                                        key={opt}
                                        onClick={() => setFilter(opt)}
                                        className={cn(
                                            'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                                            filter === opt
                                                ? 'bg-primary text-primary-foreground'
                                                : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                                        )}
                                    >
                                        {opt.charAt(0).toUpperCase() + opt.slice(1)}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <ScrollArea className="flex-1 p-6 relative">
                            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none opacity-50" />

                            <div className="w-full space-y-4 relative z-10">
                                {broadcastsLoading ? (
                                    <div className="flex items-center justify-center py-16">
                                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                    </div>
                                ) : filteredBroadcasts.length === 0 ? (
                                    <div className="text-center py-16">
                                        <MessageSquare className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
                                        <p className="text-muted-foreground">
                                            No broadcasts match your filter.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {filteredBroadcasts.map((bc) => (
                                            <BroadcastItem
                                                key={bc.id}
                                                broadcast={bc}
                                                onTogglePin={() => togglePin(bc.id, !bc.isPinned)}
                                                onDelete={() => deleteBroadcast(bc.id)}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </ScrollArea>
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center">
                            <Hash className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
                            <p className="text-muted-foreground text-lg">
                                Select a channel to manage broadcasts
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {/* Right Sidebar - Participants */}
            <div className={cn(
                "flex flex-col rounded-3xl border border-border bg-card/30 shadow-sm overflow-hidden backdrop-blur-md transition-all duration-300",
                isParticipantsOpen ? "w-80 opacity-100" : "w-0 opacity-0 border-none"
            )}>
                <ControlRoomParticipants
                    group={group}
                    isOpen={isParticipantsOpen}
                    canManage={canManage}
                    addParticipant={addParticipant}
                    onRemoveParticipant={removeParticipant}
                    onRefresh={refreshGroup}
                />
            </div>
        </div>
    );
};
