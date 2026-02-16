// src/modules/templates/ui/components/editor/TemplateEditorSkeleton.tsx
// Premium loading skeleton for the template editor with shimmer animation

import React from 'react';
import { cn } from '@/modules/core/lib/utils';

interface TemplateEditorSkeletonProps {
    className?: string;
}

/**
 * Shimmer keyframes animation (add to global CSS or use inline)
 */
const shimmerStyle = `
  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
`;

/**
 * Shimmer component with gradient animation
 */
function Shimmer({ className }: { className?: string }) {
    return (
        <div
            className={cn(
                'relative overflow-hidden rounded-lg bg-slate-800/50',
                className
            )}
        >
            <div
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent"
                style={{
                    backgroundSize: '200% 100%',
                    animation: 'shimmer 1.5s ease-in-out infinite',
                }}
            />
        </div>
    );
}

/**
 * Group skeleton with nested subgroup placeholders
 */
function GroupSkeleton({ delay = 0 }: { delay?: number }) {
    return (
        <div
            className="rounded-xl border border-slate-700/50 bg-gradient-to-r from-slate-800/30 to-transparent overflow-hidden"
            style={{ animationDelay: `${delay}ms` }}
        >
            {/* Header */}
            <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Shimmer className="w-10 h-10 rounded-lg" />
                    <div className="space-y-2">
                        <Shimmer className="w-32 h-4 rounded" />
                        <Shimmer className="w-20 h-3 rounded" />
                    </div>
                </div>
                <Shimmer className="w-24 h-8 rounded-lg" />
            </div>

            {/* Subgroups */}
            <div className="px-4 pb-4 space-y-2">
                {[0, 1].map((i) => (
                    <div
                        key={i}
                        className="p-3 rounded-lg bg-slate-900/30 border border-slate-700/30"
                        style={{ animationDelay: `${delay + 100 * (i + 1)}ms` }}
                    >
                        <div className="flex items-center justify-between mb-3">
                            <Shimmer className="w-28 h-4 rounded" />
                            <Shimmer className="w-16 h-6 rounded" />
                        </div>
                        {/* Shift rows */}
                        <div className="space-y-1.5">
                            {[0, 1, 2].map((j) => (
                                <Shimmer
                                    key={j}
                                    className="w-full h-10 rounded-lg"
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

/**
 * Full editor skeleton with header and groups
 */
export function TemplateEditorSkeleton({ className }: TemplateEditorSkeletonProps) {
    return (
        <div className={cn('space-y-6 p-6', className)}>
            {/* Inject keyframes */}
            <style>{shimmerStyle}</style>

            {/* Header skeleton */}
            <div className="flex items-center justify-between">
                <div className="space-y-2">
                    <Shimmer className="w-48 h-8 rounded-lg" />
                    <Shimmer className="w-32 h-4 rounded" />
                </div>
                <div className="flex items-center gap-3">
                    <Shimmer className="w-20 h-9 rounded-lg" />
                    <Shimmer className="w-24 h-9 rounded-lg" />
                </div>
            </div>

            {/* Stats bar skeleton */}
            <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-800/30 border border-slate-700/30">
                {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-2">
                        <Shimmer className="w-8 h-8 rounded-lg" />
                        <div className="space-y-1">
                            <Shimmer className="w-12 h-5 rounded" />
                            <Shimmer className="w-16 h-3 rounded" />
                        </div>
                    </div>
                ))}
            </div>

            {/* Groups skeleton - staggered animation */}
            <div className="space-y-4">
                <GroupSkeleton delay={0} />
                <GroupSkeleton delay={150} />
                <GroupSkeleton delay={300} />
            </div>
        </div>
    );
}

/**
 * Compact single-group skeleton for sidebar
 */
export function TemplateSidebarItemSkeleton() {
    return (
        <div className="p-3 rounded-lg bg-slate-800/30 border border-slate-700/30">
            <style>{shimmerStyle}</style>
            <div className="flex items-center gap-3">
                <Shimmer className="w-10 h-10 rounded-lg" />
                <div className="flex-1 space-y-2">
                    <Shimmer className="w-3/4 h-4 rounded" />
                    <Shimmer className="w-1/2 h-3 rounded" />
                </div>
            </div>
        </div>
    );
}

/**
 * Sidebar list skeleton with staggered items
 */
export function TemplateSidebarSkeleton({ count = 5 }: { count?: number }) {
    return (
        <div className="space-y-2 p-3">
            <style>{shimmerStyle}</style>
            {Array.from({ length: count }).map((_, i) => (
                <div
                    key={i}
                    style={{ animationDelay: `${i * 50}ms` }}
                    className="animate-in fade-in slide-in-from-left-2"
                >
                    <TemplateSidebarItemSkeleton />
                </div>
            ))}
        </div>
    );
}
