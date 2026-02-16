import React from 'react';
import { Trash2, Megaphone, Settings, Building2, Theater } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { cn } from '@/modules/core/lib/utils';
import { BroadcastGroupWithStats } from '../../model/broadcast.types';

const GROUP_ICONS: Record<string, React.ReactNode> = {
    megaphone: <Megaphone className="h-6 w-6" />,
    settings: <Settings className="h-6 w-6" />,
    building: <Building2 className="h-6 w-6" />,
    theater: <Theater className="h-6 w-6" />,
};

const GROUP_COLORS: Record<string, string> = {
    blue: 'from-blue-600/40 to-blue-900/40 border-blue-500/50',
    green: 'from-emerald-600/40 to-emerald-900/40 border-emerald-500/50',
    purple: 'from-purple-600/40 to-purple-900/40 border-purple-500/50',
    red: 'from-red-600/40 to-red-900/40 border-red-500/50',
};

interface GroupCardProps {
    group: BroadcastGroupWithStats;
    onClick: () => void;
    onDelete: () => void;
}

export const GroupCard: React.FC<GroupCardProps> = ({ group, onClick, onDelete }) => {
    const colorClass = GROUP_COLORS[group.color || 'blue'];
    const icon = GROUP_ICONS[group.icon || 'megaphone'];

    return (
        <div
            className={cn(
                'relative rounded-2xl overflow-hidden transition-all duration-300',
                'bg-gradient-to-br border-2 backdrop-blur-sm',
                colorClass,
                'hover:shadow-xl hover:shadow-black/20 hover:scale-[1.02]',
                'min-h-[240px] flex flex-col'
            )}
        >
            <div className="p-6 flex-1 flex flex-col">
                <div className="flex items-start justify-between mb-4">
                    <div
                        className="flex items-center gap-4 cursor-pointer"
                        onClick={onClick}
                    >
                        <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center">
                            {icon}
                        </div>
                        <div>
                            <h3 className="font-bold text-xl text-white">{group.name}</h3>
                            <p className="text-sm text-white/60 line-clamp-1 mt-1">
                                {group.description}
                            </p>
                        </div>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-white/40 hover:text-red-400 hover:bg-red-500/20"
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete();
                        }}
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>

                <div
                    className="grid grid-cols-2 gap-3 mb-4 cursor-pointer"
                    onClick={onClick}
                >
                    <div className="bg-black/20 rounded-xl p-3">
                        <p className="text-xs text-white/50 uppercase tracking-wide">
                            Channels
                        </p>
                        <p className="text-xl font-bold text-white">{group.channelCount}</p>
                    </div>
                    <div className="bg-black/20 rounded-xl p-3">
                        <p className="text-xs text-white/50 uppercase tracking-wide">
                            Participants
                        </p>
                        <p className="text-xl font-bold text-white">
                            {group.participantCount}
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap gap-2 mb-4">
                    {group.activeBroadcastCount > 0 && (
                        <Badge className="bg-primary/20 text-primary border-primary/30">
                            {group.activeBroadcastCount} active
                        </Badge>
                    )}
                    <Badge variant="outline" className="text-white/60 border-white/20">
                        {group.totalBroadcastCount} total
                    </Badge>
                </div>

                <div
                    className="mt-auto pt-3 border-t border-white/10 cursor-pointer"
                    onClick={onClick}
                >
                    <Button
                        variant="ghost"
                        className="w-full text-white/70 hover:text-white hover:bg-white/10"
                    >
                        Open Control Room
                    </Button>
                </div>
            </div>

            <div className="absolute top-0 right-0 w-40 h-40 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none" />
        </div>
    );
};
