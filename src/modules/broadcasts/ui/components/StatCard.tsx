import React from 'react';
import { cn } from '@/modules/core/lib/utils';

type StatCardColor =
    | 'border-red-500/50'
    | 'border-blue-500/50'
    | 'border-green-500/50'
    | 'border-emerald-500/50'
    | 'border-purple-500/50'
    | 'border-orange-500/50'
    | 'border-yellow-500/50'
    | 'border-pink-500/50'
    | 'border-cyan-500/50'
    | 'border-indigo-500/50'
    | 'border-slate-500/50';

const COLOR_ICON_BG: Record<StatCardColor, string> = {
    'border-red-500/50': 'bg-red-500/20',
    'border-blue-500/50': 'bg-blue-500/20',
    'border-green-500/50': 'bg-green-500/20',
    'border-emerald-500/50': 'bg-emerald-500/20',
    'border-purple-500/50': 'bg-purple-500/20',
    'border-orange-500/50': 'bg-orange-500/20',
    'border-yellow-500/50': 'bg-yellow-500/20',
    'border-pink-500/50': 'bg-pink-500/20',
    'border-cyan-500/50': 'bg-cyan-500/20',
    'border-indigo-500/50': 'bg-indigo-500/20',
    'border-slate-500/50': 'bg-slate-500/20',
};

interface StatCardProps {
    title: string;
    value: string | number;
    subtitle: string;
    icon: React.ReactNode;
    color: StatCardColor;
}

export const StatCard: React.FC<StatCardProps> = ({
    title,
    value,
    subtitle,
    icon,
    color,
}) => (
    <div
        className={cn(
            'relative rounded-2xl border-2 p-5 overflow-hidden transition-all duration-300 hover:scale-[1.02]',
            'bg-gradient-to-br from-card to-card/80',
            color
        )}
    >
        <div className="flex items-start justify-between">
            <div>
                <p className="text-sm text-muted-foreground font-medium">{title}</p>
                <p className="text-3xl font-bold text-foreground mt-1">{value}</p>
                <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
            </div>
            <div
                className={cn(
                    'w-12 h-12 rounded-xl flex items-center justify-center',
                    COLOR_ICON_BG[color]
                )}
            >
                {icon}
            </div>
        </div>
    </div>
);
