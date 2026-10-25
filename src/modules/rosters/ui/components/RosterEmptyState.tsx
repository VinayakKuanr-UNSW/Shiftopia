import React from 'react';
import { type LucideIcon } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';

export interface RosterEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

export const RosterEmptyState: React.FC<RosterEmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  action,
  className,
}) => {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col items-center justify-center p-12 text-center border border-dashed border-border/80 rounded-xl bg-card/40 my-8 mx-auto max-w-lg shadow-sm',
        className
      )}
    >
      <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4 shadow-xs">
        <Icon className="w-6 h-6 text-primary" aria-hidden="true" />
      </div>
      <h3 className="text-[14px] font-bold text-foreground tracking-tight mb-1">
        {title}
      </h3>
      <p className="text-[11px] text-muted-foreground max-w-xs leading-relaxed">
        {description}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
};
