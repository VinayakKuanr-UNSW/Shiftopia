import React, { useState, useMemo, useEffect } from 'react';
import {
    Hash,
    Users,
    MessageSquare,
    Loader2,
    Archive,
    Search,
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/modules/core/ui/primitives/tabs';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/modules/core/ui/primitives/select';
import { cn } from '@/modules/core/lib/utils';
import { useBroadcastGroup, useBroadcasts } from '../../state/useBroadcasts';
import { BroadcastItem } from '../components/BroadcastItem';
import { ComposeSection } from '../components/ComposeSection';
import { ControlRoomChannels } from './ControlRoomChannels';
import { ControlRoomParticipants } from './ControlRoomParticipants';

interface ControlRoomProps {
    groupId: string;
    onBack: () => void;
}

export const ControlRoom: React.FC<ControlRoomProps> = ({ groupId, onBack }) => {
    // Use the group hook
    const {
        group,
        isLoading: groupLoading,
        canBroadcast,
        canManage,
        createChannel,
        deleteChannel,
        removeParticipant,
        refetch: refreshGroup,
    } = useBroadcastGroup(groupId);

    const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
    const [filter, setFilter] = useState<'all' | 'urgent' | 'pinned'>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');
    const [isParticipantsOpen, setIsParticipantsOpen] = useState(true);

    // Use broadcasts hook
    const {
        broadcasts,
        isLoading: broadcastsLoading,
        pinnedBroadcasts,
        activeBroadcasts,
        archivedCount,
        createBroadcast,
        archiveBroadcast,
        togglePin,
        unarchiveBroadcast,
    } = useBroadcasts(selectedChannelId);

    // Auto-select first channel
    useEffect(() => {
        if (group?.channels && group.channels.length > 0 && !selectedChannelId) {
            setSelectedChannelId(group.channels[0].id);
        }
    }, [group, selectedChannelId]);

    // Filter broadcasts
    const filteredBroadcasts = useMemo(() => {
        let result =
            activeTab === 'active'
                ? [...pinnedBroadcasts, ...activeBroadcasts]
                : broadcasts.filter((b) => b.isArchived);

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
    }, [
        broadcasts,
        pinnedBroadcasts,
        activeBroadcasts,
        filter,
        searchQuery,
        activeTab,
    ]);

    // Handlers
    const handleSendBroadcast = async (data: any) => {
        await createBroadcast(data);
    };

    const selectedChannel = group?.channels?.find(
        (c) => c.id === selectedChannelId
    );

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
        <div className="h-screen bg-background flex overflow-x-auto overflow-y-hidden">
            {/* Left Sidebar - Channels */}
            <ControlRoomChannels
                group={group}
                selectedChannelId={selectedChannelId}
                onSelectChannel={setSelectedChannelId}
                canManage={canManage}
                onBack={onBack}
                onCreateChannel={createChannel}
                onDeleteChannel={deleteChannel}
            />

            {/* Middle - Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden min-w-[500px] transition-all duration-300">
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

                                <div className="flex items-center gap-3">
                                    <div className="relative w-64 hidden md:block">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            placeholder="Search broadcasts..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="pl-10 bg-muted/50"
                                        />
                                    </div>
                                    <Select
                                        value={filter}
                                        onValueChange={(v: any) => setFilter(v)}
                                    >
                                        <SelectTrigger className="w-40">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">All</SelectItem>
                                            <SelectItem value="urgent">Urgent</SelectItem>
                                            <SelectItem value="pinned">Pinned</SelectItem>
                                        </SelectContent>
                                    </Select>

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
                        </div>

                        <ScrollArea className="flex-1 p-6 relative">
                            {/* Content Background Accent */}
                            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none opacity-50" />

                            <div className="max-w-5xl mx-auto space-y-8 relative z-10">
                                {canBroadcast && (
                                    <div className="shadow-lg shadow-primary/5 rounded-2xl">
                                        <ComposeSection
                                            channelId={selectedChannelId!}
                                            channelName={selectedChannel.name}
                                            groupName={group.name}
                                            totalRecipients={group.participantCount}
                                            onSend={handleSendBroadcast}
                                            isLoading={broadcastsLoading}
                                        />
                                    </div>
                                )}

                                <Tabs
                                    value={activeTab}
                                    onValueChange={(v: any) => setActiveTab(v)}
                                >
                                    <TabsList className="bg-muted/50">
                                        <TabsTrigger value="active">Active Broadcasts</TabsTrigger>
                                        <TabsTrigger value="archived">
                                            Archived ({archivedCount})
                                        </TabsTrigger>
                                    </TabsList>

                                    <TabsContent value="active" className="mt-6 space-y-4">
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
                                                        onArchive={() => archiveBroadcast(bc.id)}
                                                        onTogglePin={() => togglePin(bc.id, !bc.isPinned)}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                    </TabsContent>

                                    <TabsContent value="archived" className="mt-6 space-y-4">
                                        {broadcasts.filter((b) => b.isArchived).length === 0 ? (
                                            <div className="text-center py-16">
                                                <Archive className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
                                                <p className="text-muted-foreground">
                                                    No archived broadcasts.
                                                </p>
                                            </div>
                                        ) : (
                                            <div className="space-y-4">
                                                {broadcasts.filter((b) => b.isArchived).map((bc) => (
                                                    <BroadcastItem
                                                        key={bc.id}
                                                        broadcast={bc}
                                                        onArchive={() => unarchiveBroadcast(bc.id)}
                                                        onTogglePin={() => togglePin(bc.id, !bc.isPinned)}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                    </TabsContent>
                                </Tabs>
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
            <ControlRoomParticipants
                group={group} // Group is BroadcastGroupFull which works
                isOpen={isParticipantsOpen}
                canManage={canManage}
                onRemoveParticipant={removeParticipant}
                onRefresh={refreshGroup}
            />
        </div>
    );
};
