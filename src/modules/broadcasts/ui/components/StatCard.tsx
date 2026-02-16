import React from 'react';
import { cn } from '@/modules/core/lib/utils';

interface StatCardProps {
    title: string;
    value: string | number;
    subtitle: string;
    icon: React.ReactNode;
    color: string;
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
                    color.replace('border-', 'bg-').replace('/50', '/20')
                )}
            >
                {icon}
            </div>
        </div>
    </div>
);
