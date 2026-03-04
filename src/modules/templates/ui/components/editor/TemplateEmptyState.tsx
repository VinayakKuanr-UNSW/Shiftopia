// src/modules/templates/ui/components/editor/TemplateEmptyState.tsx
// Compelling empty state with distinctive visual design

import React from 'react';
import { FileText, Layers, Plus, Sparkles } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { Button } from '@/modules/core/ui/primitives/button';

interface TemplateEmptyStateProps {
    type: 'no-templates' | 'no-selection' | 'empty-group' | 'empty-subgroup';
    onAction?: () => void;
    className?: string;
}

/**
 * Floating decoration element for visual interest
 */
function FloatingDeco({ className, style }: { className?: string; style?: React.CSSProperties }) {
    return (
        <div
            className={cn(
                'absolute w-24 h-24 rounded-full opacity-20 blur-2xl',
                className
            )}
            style={{
                animation: 'float 6s ease-in-out infinite',
                ...style,
            }}
        />
    );
}

const floatAnimation = `
  @keyframes float {
    0%, 100% { transform: translateY(0px) rotate(0deg); }
    50% { transform: translateY(-15px) rotate(5deg); }
  }
  @keyframes pulse-glow {
    0%, 100% { opacity: 0.5; transform: scale(1); }
    50% { opacity: 0.8; transform: scale(1.05); }
  }
`;

export function TemplateEmptyState({
    type,
    onAction,
    className,
}: TemplateEmptyStateProps) {
    const configs = {
        'no-templates': {
            icon: <Layers className="h-12 w-12" />,
            title: 'No Templates Yet',
            description: 'Create your first roster template to get started. Templates make scheduling faster and more consistent.',
            action: 'Create Template',
            gradient: 'from-violet-500/20 via-fuchsia-500/10 to-transparent',
            iconBg: 'bg-gradient-to-br from-violet-500 to-fuchsia-600',
            decoColors: ['bg-violet-500', 'bg-fuchsia-500'],
        },
        'no-selection': {
            icon: <FileText className="h-12 w-12" />,
            title: 'Select a Template',
            description: 'Choose a template from the sidebar to start editing, or create a new one.',
            action: 'Create New',
            gradient: 'from-blue-500/20 via-cyan-500/10 to-transparent',
            iconBg: 'bg-gradient-to-br from-blue-500 to-cyan-600',
            decoColors: ['bg-blue-500', 'bg-cyan-500'],
        },
        'empty-group': {
            icon: <Sparkles className="h-10 w-10" />,
            title: 'No Subgroups',
            description: 'Add subgroups to organize your shifts by role, location, or team.',
            action: 'Add Subgroup',
            gradient: 'from-emerald-500/20 via-teal-500/10 to-transparent',
            iconBg: 'bg-gradient-to-br from-emerald-500 to-teal-600',
            decoColors: ['bg-emerald-500', 'bg-teal-500'],
        },
        'empty-subgroup': {
            icon: <Plus className="h-10 w-10" />,
            title: 'No Shifts',
            description: 'Add shifts to this subgroup to define work schedules.',
            action: 'Add Shift',
            gradient: 'from-amber-500/20 via-orange-500/10 to-transparent',
            iconBg: 'bg-gradient-to-br from-amber-500 to-orange-600',
            decoColors: ['bg-amber-500', 'bg-orange-500'],
        },
    };

    const config = configs[type];

    return (
        <div
            className={cn(
                'relative flex flex-col items-center justify-center text-center p-12 rounded-2xl overflow-hidden',
                'bg-gradient-to-br',
                config.gradient,
                'border border-white/5',
                className
            )}
        >
            {/* Floating decorations */}
            <style>{floatAnimation}</style>
            <FloatingDeco className={cn(config.decoColors[0], 'top-4 -left-8')} />
            <FloatingDeco
                className={cn(config.decoColors[1], 'bottom-8 -right-12')}
                style={{ animationDelay: '2s' }}
            />

            {/* Icon */}
            <div
                className={cn(
                    'relative p-5 rounded-2xl text-primary-foreground mb-6 shadow-lg',
                    config.iconBg
                )}
                style={{
                    animation: 'pulse-glow 3s ease-in-out infinite',
                }}
            >
                {config.icon}
                {/* Glow effect */}
                <div
                    className={cn(
                        'absolute inset-0 rounded-2xl blur-xl opacity-50 -z-10',
                        config.iconBg
                    )}
                />
            </div>

            {/* Text */}
            <h3 className="text-xl font-semibold text-foreground mb-2 tracking-tight">
                {config.title}
            </h3>
            <p className="text-muted-foreground max-w-sm mb-6 leading-relaxed">
                {config.description}
            </p>

            {/* Action button */}
            {onAction && (
                <Button
                    onClick={onAction}
                    className={cn(
                        'group relative overflow-hidden px-6 py-2.5',
                        'bg-background/10 hover:bg-background/20 backdrop-blur-sm',
                        'border border-border/20 hover:border-border/50 text-foreground',
                        'transition-all duration-300 ease-out',
                        'hover:shadow-lg hover:shadow-primary/5',
                        'hover:scale-105'
                    )}
                >
                    <Plus className="h-4 w-4 mr-2 transition-transform group-hover:rotate-90 duration-300" />
                    {config.action}
                </Button>
            )}

            {/* Mesh gradient overlay */}
            <div
                className="absolute inset-0 opacity-30 pointer-events-none"
                style={{
                    backgroundImage: `
            radial-gradient(at 20% 30%, ${config.decoColors[0].replace('bg-', 'var(--')}/ 0.15) 0%, transparent 50%),
            radial-gradient(at 80% 70%, ${config.decoColors[1].replace('bg-', 'var(--')}/ 0.1) 0%, transparent 50%)
          `,
                }}
            />
        </div>
    );
}
