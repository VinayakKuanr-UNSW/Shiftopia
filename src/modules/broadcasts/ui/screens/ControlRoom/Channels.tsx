import React, { useState } from 'react';
import {
    Hash,
    Plus,
    Trash2,
    ChevronLeft,
    FolderPlus,
    Megaphone,
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { ComposeSection } from '../../components/ComposeSection';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/modules/core/ui/primitives/dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/modules/core/ui/primitives/alert-dialog';
import { Label } from '@/modules/core/ui/primitives/label';
import { cn } from '@/modules/core/lib/utils';
import { BroadcastGroupWithStats } from '../../../model/broadcast.types';
import { GROUP_ICONS } from '../../constants';
interface ControlRoomChannelsProps {
    group: BroadcastGroupWithStats;
    selectedChannelId: string | null;
    onSelectChannel: (channelId: string) => void;
    canManage: boolean;
    onBack: () => void;
    onCreateChannel: (data: { name: string; description: string }) => Promise<any>;
    onDeleteChannel: (channelId: string) => Promise<any>;
    onSendBroadcast: (data: any) => Promise<void>;
    isSending: boolean;
    totalRecipients: number;
}

export const ControlRoomChannels: React.FC<ControlRoomChannelsProps> = ({
    group,
    selectedChannelId,
    onSelectChannel,
    canManage,
    onBack,
    onCreateChannel,
    onDeleteChannel,
    onSendBroadcast,
    isSending,
    totalRecipients,
}) => {
    const [showAddChannel, setShowAddChannel] = useState(false);
    const [showDeleteChannel, setShowDeleteChannel] = useState<string | null>(null);
    const [showComposeDialog, setShowComposeDialog] = useState(false);
    const [newChannelName, setNewChannelName] = useState('');
    const [newChannelDescription, setNewChannelDescription] = useState('');

    const handleAddChannel = async () => {
        if (!newChannelName.trim()) return;
        try {
            await onCreateChannel({
                name: newChannelName,
                description: newChannelDescription,
            });
            setNewChannelName('');
            setNewChannelDescription('');
            setShowAddChannel(false);
        } catch (err) {
            // Error handled in parent/hook
        }
    };

    const handleDeleteChannel = async () => {
        if (!showDeleteChannel) return;
        try {
            await onDeleteChannel(showDeleteChannel);
            setShowDeleteChannel(null);
        } catch (err) {
            // Error handled in parent/hook
        }
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-card/10">
            <div className="p-5 border-b border-border/50">
                <Button
                    variant="ghost"
                    onClick={onBack}
                    className="w-full justify-start text-muted-foreground hover:text-foreground hover:bg-muted mb-4"
                >
                    <ChevronLeft className="h-5 w-5 mr-2" />
                    Back to Groups
                </Button>
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                        {GROUP_ICONS[group.icon || 'megaphone']}
                    </div>
                    <div className="flex-1 min-w-0">
                        <h2 className="font-bold text-foreground truncate">
                            {group.name}
                        </h2>
                        <p className="text-xs text-muted-foreground">
                            {group.participantCount} members
                        </p>
                    </div>
                </div>
            </div>

            <div className="p-4 flex-1 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                        Channels
                    </span>
                </div>
                <ScrollArea className="flex-1">
                    {group.channels?.length === 0 ? (
                        <div className="text-center py-8">
                            <Hash className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                            <p className="text-sm text-muted-foreground">No channels yet</p>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {group.channels?.map((channel) => (
                                <div
                                    key={channel.id}
                                    className={cn(
                                        'flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all duration-200 group',
                                        selectedChannelId === channel.id
                                            ? 'bg-primary/20 text-primary border border-primary/30'
                                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                    )}
                                    onClick={() => onSelectChannel(channel.id)}
                                >
                                    <Hash className="h-5 w-5 shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold truncate">{channel.name}</p>
                                        {channel.description && (
                                            <p className="text-xs opacity-60 truncate">
                                                {channel.description}
                                            </p>
                                        )}
                                    </div>
                                    {canManage && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6 opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setShowDeleteChannel(channel.id);
                                            }}
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </ScrollArea>

                {canManage && (
                    <div className="mt-4 pt-4 border-t border-border/50 space-y-3">
                        <Button
                            variant="secondary"
                            className="w-full justify-center bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm gap-2"
                            onClick={() => setShowComposeDialog(true)}
                        >
                            <Megaphone className="h-4 w-4" />
                            Compose Broadcast
                        </Button>
                        <Button
                            variant="ghost"
                            className="w-full justify-start text-muted-foreground hover:text-foreground hover:bg-muted/50"
                            onClick={() => setShowAddChannel(true)}
                        >
                            <Plus className="h-4 w-4 mr-2" />
                            Add New Channel
                        </Button>
                    </div>
                )}
            </div>

            {/* Dialogs */}
            <Dialog open={showComposeDialog} onOpenChange={setShowComposeDialog}>
                <DialogContent className="max-w-2xl p-0 overflow-hidden border-none bg-transparent shadow-none">
                    {selectedChannelId && (
                        <ComposeSection
                            channelId={selectedChannelId}
                            channelName={group.channels?.find(c => c.id === selectedChannelId)?.name || ''}
                            groupName={group.name}
                            totalRecipients={totalRecipients}
                            onSend={async (data) => {
                                await onSendBroadcast(data);
                                setShowComposeDialog(false);
                            }}
                            isLoading={isSending}
                        />
                    )}
                </DialogContent>
            </Dialog>
            <Dialog open={showAddChannel} onOpenChange={setShowAddChannel}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <FolderPlus className="h-5 w-5 text-primary" />
                            Add New Channel
                        </DialogTitle>
                        <DialogDescription>
                            Create a new broadcast channel in {group.name}.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <Label>Channel Name *</Label>
                            <Input
                                placeholder="e.g., Safety Updates"
                                value={newChannelName}
                                onChange={(e) => setNewChannelName(e.target.value)}
                                className="mt-1"
                            />
                        </div>
                        <div>
                            <Label>Description (optional)</Label>
                            <Input
                                placeholder="Brief description of this channel"
                                value={newChannelDescription}
                                onChange={(e) => setNewChannelDescription(e.target.value)}
                                className="mt-1"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowAddChannel(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleAddChannel} disabled={!newChannelName.trim()}>
                            Create Channel
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog
                open={!!showDeleteChannel}
                onOpenChange={() => setShowDeleteChannel(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Channel?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete the channel and all its broadcasts.
                            This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDeleteChannel}
                            className="bg-red-600 hover:bg-red-700"
                        >
                            Delete Channel
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};
